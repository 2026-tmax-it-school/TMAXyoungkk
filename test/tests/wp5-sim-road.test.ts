import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { Category, GpsSample, LatLng, Plan, SimPresetId, Trip } from '../src/types';
import type { RouteLeg } from '../src/core/ports';
import type { LiveDay } from '../src/core/live/context';
import { liveDayFromTrip } from '../src/core/live/context';
import type { EngineEffect } from '../src/core/live/engine';
import { coordLookup, dayLegs, legGeometryKey, legShape, polylineProgress, stepIndexAt, type MapLeg } from '../src/core/map/model';
import { gatherLegShapes, newShapeKeys } from '../src/core/sim/legShapes';
import { SIM_PRESETS } from '../src/core/sim/presets';
import { replayTrack, type TimelineEntry } from '../src/core/sim/replay';
import { generateTrack, offsetCoord, RESUME_SNAP_M, type GenerateTrackInput } from '../src/core/sim/track';
import { atKst, toMin } from '../src/core/util';
import { scenarioPlace } from '../src/data/scenario';
import { runScenario } from '../src/demo/scenarioRunner';
import { createExtractionProvider } from '../src/services/extraction';
import { createPlaceProvider } from '../src/services/places';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV, seqIds } from './helpers/fakes';
import { SCENARIO_T0 } from './helpers/fixtures';

/**
 * 시뮬레이터 점이 길을 따라간다(WP5). 구간 모양(지도 선과 같은 legShape)을 주면 점이 그 선 위로 거리 비율로 가고,
 * 모양이 없으면 기존과 같은 샘플이다. 길이 핀에서 떨어져 시작·끝나도 도착 판정(반경 100m, 3분)이 그대로이고,
 * 13 길찾기의 진행률(polylineProgress)과 안내 줄(stepIndexAt)이 시뮬레이터 점과 맞는다. 네트워크는 쓰지 않는다(fakeFetch).
 */

const DATE = '2026-10-18';
const at = (hhmm: string) => atKst(DATE, hhmm);
const M_PER_DEG = 111_320;

/** 10/18 시나리오 순서(tests/wp5-sim.test.ts와 같은 시간표) */
function day1018(): { day: LiveDay; categories: Record<string, Category>; closeMin: Record<string, number> } {
  const rows: [string, string, string, number][] = [
    ['gj-bulguksa', '09:25', '10:55', 25],
    ['gj-seokguram', '11:07', '12:37', 12],
    ['gj-gyochon-hanjeongsik', '12:57', '13:57', 20],
    ['gj-museum', '14:10', '15:40', 13],
    ['gj-woljeonggyo', '15:52', '17:22', 12],
  ];
  const categories: Record<string, Category> = {};
  const closeMin: Record<string, number> = {};
  const items = rows.map(([pid, a, d, travel]) => {
    const p = scenarioPlace(pid);
    categories[`s-${pid}`] = p.category;
    if (p.hours) closeMin[`s-${pid}`] = toMin(p.hours.close);
    return { spotId: `s-${pid}`, name: p.name, coord: p.coord, arriveMin: toMin(a), departMin: toMin(d), travelMin: travel, transport: 'car' as const };
  });
  return {
    day: { tripId: 'trip-scenario', date: DATE, dayStartMs: at('00:00'), startMin: toMin('09:00'), base: scenarioPlace('gj-lahan-select').coord, items },
    categories,
    closeMin,
  };
}

/**
 * 가짜 길. a 옆 60m에서 시작해 옆으로 크게 돌았다가 b 옆 70m에서 끝난다(길 경로는 가까운 길 위에서 시작·끝난다).
 * bend는 구간 길이에 대한 옆으로 비킨 정도다. 마디 사이를 8등분해 실제 응답처럼 점이 많다.
 */
function bentRoad(a: LatLng, b: LatLng, bend = 0.25): LatLng[] {
  const n = (b.latitude - a.latitude) * M_PER_DEG;
  const e = (b.longitude - a.longitude) * M_PER_DEG * Math.cos((a.latitude * Math.PI) / 180);
  const len = Math.hypot(n, e);
  // 진행 방향 왼쪽 수직
  const pn = -e / len;
  const pe = n / len;
  const pt = (f: number, side: number) => offsetCoord(a, n * f + pn * side, e * f + pe * side);
  const knots: [number, number][] = [
    [0, 60],
    [0.4, len * bend],
    [0.75, -len * bend * 0.4],
    [1, -70],
  ];
  const out: LatLng[] = [];
  for (let k = 0; k + 1 < knots.length; k += 1) {
    for (let j = 0; j < 8; j += 1) {
      const t = j / 8;
      out.push(pt(knots[k][0] + (knots[k + 1][0] - knots[k][0]) * t, knots[k][1] + (knots[k + 1][1] - knots[k][1]) * t));
    }
  }
  out.push(pt(1, -70));
  return out;
}

/** 지도와 같은 원리로 핀에 이은 선(시험 기준) */
function pinnedLine(raw: LatLng[], from: LatLng, to: LatLng): LatLng[] {
  return [from, ...raw, to];
}

/** 점에서 선까지 거리(m). 짧은 구간이라 평면 근사 */
function distToLine(line: LatLng[], c: LatLng): number {
  const kx = Math.cos((c.latitude * Math.PI) / 180);
  const xy = (q: LatLng) => ({ x: (q.longitude - c.longitude) * M_PER_DEG * kx, y: (q.latitude - c.latitude) * M_PER_DEG });
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = xy(line[i]);
    const b = xy(line[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t, a.y + dy * t));
  }
  return best;
}

function lineLength(line: LatLng[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i += 1) {
    const kx = Math.cos((line[i].latitude * Math.PI) / 180);
    s += Math.hypot((line[i].longitude - line[i - 1].longitude) * M_PER_DEG * kx, (line[i].latitude - line[i - 1].latitude) * M_PER_DEG);
  }
  return s;
}

/** 그날 구간(기점 → 스팟들 → 기점 복귀)마다 가짜 길. 키는 지도와 같은 legGeometryKey */
function roadsFor(day: LiveDay, bend = 0.25): { raw: Record<string, LatLng[]>; pinned: Record<string, LatLng[]>; straight: LatLng[][] } {
  const raw: Record<string, LatLng[]> = {};
  const pinned: Record<string, LatLng[]> = {};
  const straight: LatLng[][] = [];
  let prev = day.base as LatLng;
  const add = (a: LatLng, b: LatLng) => {
    const k = legGeometryKey(a, b, 'car');
    raw[k] = bentRoad(a, b, bend);
    pinned[k] = pinnedLine(raw[k], a, b);
    straight.push([a, b]);
  };
  for (const it of day.items) {
    add(prev, it.coord);
    prev = it.coord;
  }
  add(prev, day.base as LatLng);
  return { raw, pinned, straight };
}

const nearest = (lines: LatLng[][], c: LatLng) => Math.min(...lines.map((l) => distToLine(l, c)));

/* ---------- 선을 따라간다 ---------- */

test('구간 모양을 주면 점이 그 길(핀에 이은 선) 위로 가고, 모양이 없으면 직선 위로 간다', () => {
  const { day, categories } = day1018();
  const roads = roadsFor(day);
  const shaped = generateTrack({ day, preset: 'normal', categories, legShapes: roads.raw });
  const plain = generateTrack({ day, preset: 'normal', categories });
  const lines = Object.values(roads.pinned);
  // 이동 흔들림 ±8m, 머묾 흔들림 ±12m(핀은 선의 끝점이다)
  for (const s of shaped.samples) assert.ok(nearest(lines, s.coord) <= 20, `${new Date(s.t).toISOString()} 길에서 ${nearest(lines, s.coord).toFixed(0)}m`);
  for (const s of plain.samples) assert.ok(nearest(roads.straight, s.coord) <= 20, '모양이 없으면 직선 위');
  const offStraight = shaped.samples.filter((s) => nearest(roads.straight, s.coord) > 300);
  assert.ok(offStraight.length > 20, `직선을 질러가지 않는다(직선에서 300m 넘게 떨어진 샘플 ${offStraight.length}개)`);
  // 시각·이벤트는 모양과 상관없다
  assert.deepEqual(
    shaped.samples.map((s) => s.t),
    plain.samples.map((s) => s.t),
  );
  assert.deepEqual([shaped.startAt, shaped.endAt, shaped.events], [plain.startAt, plain.endAt, plain.events]);
  // 같은 입력·같은 모양이면 같은 궤적이다
  assert.deepEqual(generateTrack({ day, preset: 'normal', categories, legShapes: roads.raw }), shaped);
});

test('모양이 없거나 맞는 구간이 없거나 두 점(직선)이면 기존과 같은 샘플이다(프리셋 9종, 이어서 만들기 포함)', () => {
  const { day, categories, closeMin } = day1018();
  const straightOnly: Record<string, LatLng[]> = {};
  let prev = day.base as LatLng;
  for (const it of day.items) {
    straightOnly[legGeometryKey(prev, it.coord, 'car')] = [prev, it.coord];
    prev = it.coord;
  }
  // 수단이 다르면 다른 구간이다(키가 맞지 않는다)
  const otherTransport: Record<string, LatLng[]> = {};
  for (const [k, v] of Object.entries(roadsFor(day).raw)) otherTransport[k.replace(/^car:/, 'walk:')] = v;
  for (const p of SIM_PRESETS) {
    const base: GenerateTrackInput = { day, preset: p.id, categories, closeMin };
    const plain = generateTrack(base);
    assert.deepEqual(generateTrack({ ...base, legShapes: {} }), plain, p.id);
    assert.deepEqual(generateTrack({ ...base, legShapes: straightOnly }), plain, `${p.id} 두 점`);
    assert.deepEqual(generateTrack({ ...base, legShapes: otherTransport }), plain, `${p.id} 다른 수단`);
    const resume = { t: at('11:10'), coord: day.items[0].coord, doneSpotIds: ['s-gj-bulguksa'] };
    assert.deepEqual(generateTrack({ ...base, resume, legShapes: {} }), generateTrack({ ...base, resume }), `${p.id} 이어서`);
  }
});

/* ---------- 도착 판정은 그대로 ---------- */

const arrivalsOf = (tl: TimelineEntry[]) => tl.filter((e) => e.kind === 'arrived' || e.kind === 'skipped');
const firstSpot = (tl: TimelineEntry[], kind: 'delay' | 'freeTime') => {
  const e = tl.find((x) => x.kind === kind);
  return e && 'spotId' in e ? e.spotId : undefined;
};

test('길이 핀에서 떨어져 시작·끝나도 도착·건너뜀 순서와 시각, 조정안·빈 시간 대상, 사진 이벤트가 직선일 때와 같다(프리셋 9종)', () => {
  const { day, categories, closeMin } = day1018();
  const roads = roadsFor(day);
  for (const raw of Object.values(roads.raw)) assert.ok(raw.length > 20);
  // 가짜 길은 핀에서 60~70m 떨어져 시작·끝난다
  const k0 = legGeometryKey(day.base as LatLng, day.items[0].coord, 'car');
  assert.ok(distToLine([roads.raw[k0][0]], day.base as LatLng) >= 50);
  assert.ok(distToLine([roads.raw[k0][roads.raw[k0].length - 1]], day.items[0].coord) >= 50);
  for (const p of SIM_PRESETS) {
    const input: GenerateTrackInput = { day, preset: p.id as SimPresetId, categories, closeMin };
    const line = replayTrack({ track: generateTrack(input), day });
    const road = replayTrack({ track: generateTrack({ ...input, legShapes: roads.raw }), day });
    const a = arrivalsOf(line.timeline);
    const b = arrivalsOf(road.timeline);
    assert.deepEqual(
      b.map((e) => `${e.kind}:${'spotId' in e ? e.spotId : ''}`),
      a.map((e) => `${e.kind}:${'spotId' in e ? e.spotId : ''}`),
      p.id,
    );
    b.forEach((e, i) => assert.ok(Math.abs(e.t - a[i].t) <= 2 * 60_000, `${p.id} ${e.kind} 시각 차 ${(e.t - a[i].t) / 60_000}분`));
    assert.equal(firstSpot(road.timeline, 'delay'), firstSpot(line.timeline, 'delay'), `${p.id} 조정안 대상`);
    assert.equal(firstSpot(road.timeline, 'freeTime'), firstSpot(line.timeline, 'freeTime'), `${p.id} 빈 시간 대상`);
    assert.deepEqual(
      road.timeline.filter((e) => e.kind === 'photo'),
      line.timeline.filter((e) => e.kind === 'photo'),
    );
    if (p.id === 'normal' || p.id === 'gpsShadow' || p.id === 'nextDoor') assert.equal(b.filter((e) => e.kind === 'arrived').length, 5, p.id);
  }
});

test('옆 건물: 길을 따라와도 120m 옆에서 머문 5분은 도착이 아니고, 들어간 뒤에 도착한다', () => {
  const { day, categories } = day1018();
  const roads = roadsFor(day);
  const r = replayTrack({ track: generateTrack({ day, preset: 'nextDoor', categories, legShapes: roads.raw }), day });
  const first = r.effects.find((e): e is Extract<EngineEffect, { kind: 'visit' }> => e.kind === 'visit');
  assert.ok(first);
  assert.equal(first.spotId, 's-gj-bulguksa');
  assert.equal(first.status, 'arrived');
  const departBase = day.items[0].arriveMin - day.items[0].travelMin;
  assert.ok((first.arrivedAt ?? 0) >= at('00:00') + (departBase + 25 + 5) * 60_000);
});

/* ---------- 이어서 만들기 ---------- */

test('이어서 만들기: 길 가까이에서 이으면 남은 길을 따라가고, 길에서 멀면(다른 길) 직선으로 간다', () => {
  const { day, categories } = day1018();
  const roads = roadsFor(day);
  const k0 = legGeometryKey(day.base as LatLng, day.items[0].coord, 'car');
  const full = generateTrack({ day, preset: 'normal', categories, legShapes: roads.raw });
  const arrivedAt = (track: ReturnType<typeof generateTrack>) => {
    const r = replayTrack({ track, day });
    return r.timeline.find((e) => e.kind === 'arrived' && e.spotId === 's-gj-bulguksa')?.t;
  };
  // 기점 → 불국사 길의 40% 지점(09:10)에서 이어 만든다
  const mid = full.samples.find((s) => s.t === at('09:10'));
  assert.ok(mid);
  const near = generateTrack({ day, preset: 'normal', categories, legShapes: roads.raw, resume: { t: mid.t, coord: mid.coord, doneSpotIds: [] } });
  const firstLeg = near.samples.filter((s) => s.t < at('09:24'));
  assert.ok(firstLeg.length > 20);
  // 이은 자리(흔들린 샘플)에서 시작하므로 흔들림 두 번만큼 둔다
  for (const s of firstLeg) assert.ok(distToLine(roads.pinned[k0], s.coord) <= 25, '남은 길 위');
  const ta = arrivedAt(full);
  const tb = arrivedAt(near);
  assert.ok(ta && tb);
  assert.ok(Math.abs(tb - ta) <= 2 * 60_000, `남은 길 비율로 시간을 줄여 원래 도착과 맞는다(${(tb - ta) / 60_000}분 차)`);

  // 길에서 멀면 직선이다. 첫 구간 샘플은 모양 없이 이어 만든 것과 같다. 길이 가장 많이 비킨 쪽으로 600m 더 나간 자리
  const b0 = day.base as LatLng;
  const n0 = (day.items[0].coord.latitude - b0.latitude) * M_PER_DEG;
  const e0 = (day.items[0].coord.longitude - b0.longitude) * M_PER_DEG * Math.cos((b0.latitude * Math.PI) / 180);
  const len0 = Math.hypot(n0, e0);
  const far = offsetCoord(mid.coord, (-e0 / len0) * 600, (n0 / len0) * 600);
  assert.ok(distToLine(roads.pinned[k0], far) > RESUME_SNAP_M);
  const resume = { t: mid.t, coord: far, doneSpotIds: [] };
  const a = generateTrack({ day, preset: 'normal', categories, legShapes: roads.raw, resume });
  const b = generateTrack({ day, preset: 'normal', categories, resume });
  assert.deepEqual(a.samples.slice(0, 10), b.samples.slice(0, 10));
  for (const s of a.samples.slice(0, 10)) assert.ok(distToLine([far, day.items[0].coord], s.coord) <= 12);
  // 다음 구간(불국사 → 석굴암)부터는 길을 따라간다
  const k1 = legGeometryKey(day.items[0].coord, day.items[1].coord, 'car');
  const leg1 = a.samples.filter((s) => s.t > at('10:56') && s.t < at('11:06'));
  assert.ok(leg1.length > 10);
  for (const s of leg1) assert.ok(distToLine(roads.pinned[k1], s.coord) <= 20);
});

/* ---------- 13 길찾기 진행률·안내 줄 ---------- */

test('길찾기: 지도 선(legShape) 기준 진행률과 안내 줄이 시뮬레이터 점의 실제 진행과 맞다', () => {
  const { day, categories } = day1018();
  const base = day.base as LatLng;
  const it0 = day.items[0];
  const leg: MapLeg = {
    index: 0,
    key: legGeometryKey(base, it0.coord, 'car'),
    fromId: 'base',
    toId: it0.spotId,
    fromName: '숙소',
    toName: it0.name,
    from: base,
    to: it0.coord,
    transport: 'car',
    estimated: false,
    minutes: it0.travelMin,
  };
  const raw = bentRoad(base, it0.coord);
  // 안내 줄 세 개(꺾이는 마디마다)와 도착 줄. 거리는 길을 따라 잰다
  const part = (from: number, to: number) => Math.round(lineLength(raw.slice(from, to + 1)));
  const steps = [
    { text: '동쪽으로 출발', meters: part(0, 8) },
    { text: '우회전', meters: part(8, 16) },
    { text: '좌회전', meters: part(16, 24) },
    { text: '목적지 도착', meters: 0 },
  ];
  const geo: RouteLeg = { transport: 'car', minutes: 25, meters: part(0, 24), polyline: raw, steps, estimated: false, road: 'osm' };
  const shape = legShape(leg, geo);
  assert.equal(shape.length, raw.length + 2, '지도 선도 끝점을 핀에 잇는다');
  const track = generateTrack({ day, preset: 'normal', categories, legShapes: { [leg.key]: shape } });
  const t0 = at('09:00');
  const t1 = at('09:25');
  const moving = track.samples.filter((s) => s.t > t0 && s.t < t1);
  assert.equal(moving.length, 49);
  let lastIdx = 0;
  const seen = new Set<number>();
  for (const s of moving) {
    const f = (s.t - t0) / (t1 - t0);
    const progress = polylineProgress(shape, s.coord);
    assert.ok(Math.abs(progress - f) < 0.02, `진행률 ${progress.toFixed(3)} · 실제 ${f.toFixed(3)}`);
    const idx = stepIndexAt(steps, progress);
    // 줄 경계 근처(±2%)가 아니면 실제 진행으로 고른 줄과 같다
    if (stepIndexAt(steps, f - 0.02) === stepIndexAt(steps, f + 0.02)) assert.equal(idx, stepIndexAt(steps, f));
    assert.ok(idx >= lastIdx, '안내 줄이 뒤로 가지 않는다');
    lastIdx = idx;
    seen.add(idx);
  }
  assert.deepEqual([...seen], [0, 1, 2], '세 줄을 차례로 지난다');
  // 직선으로 가던 예전 점이면 길 기준 진행률이 실제 진행과 크게 어긋났다(그래서 점이 길을 따라가야 한다)
  const plain = generateTrack({ day, preset: 'normal', categories }).samples.filter((s) => s.t > t0 && s.t < t1);
  const worst = Math.max(...plain.map((s) => Math.abs(polylineProgress(shape, s.coord) - (s.t - t0) / (t1 - t0))));
  assert.ok(worst > 0.05, `직선 점의 진행률 오차 ${worst.toFixed(3)}`);
});

/* ---------- 구간 모양 모으기 ---------- */

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

test('구간 모양 모으기: 지도와 같은 모양을 받는 대로 담고, 직선·실패는 빼며, 늦게 온 모양은 새 키로 알린다', async () => {
  const { day } = day1018();
  const base = day.base as LatLng;
  const pts = [base, ...day.items.map((i) => i.coord)];
  const legs: MapLeg[] = pts.slice(0, 4).map((a, i) => ({
    index: i,
    key: legGeometryKey(a, pts[i + 1], 'car'),
    fromId: `p${i}`,
    toId: `p${i + 1}`,
    fromName: '',
    toName: '',
    from: a,
    to: pts[i + 1],
    transport: 'car',
    estimated: false,
    minutes: 10,
  }));
  const roadLeg = (l: MapLeg): RouteLeg => ({ transport: 'car', minutes: 10, meters: 1000, polyline: bentRoad(l.from, l.to), steps: [], estimated: false, road: 'osm' });
  const late = deferred<RouteLeg | null>();
  const g = gatherLegShapes(legs, (l) => {
    if (l.index === 0) return Promise.resolve(roadLeg(l));
    // 로컬 추정(직선)은 담지 않는다
    if (l.index === 1) return Promise.resolve({ ...roadLeg(l), polyline: [l.from, l.to], road: undefined, estimated: true });
    if (l.index === 2) return Promise.reject(new Error('경로 서버 응답 시간 초과'));
    return late.promise;
  });
  await flush();
  assert.deepEqual(Object.keys(g.got), [legs[0].key]);
  assert.deepEqual(g.got[legs[0].key], legShape(legs[0], roadLeg(legs[0])), '지도 선과 같은 모양(끝점을 핀에 이음)');
  // 상한에서 받은 만큼으로 궤적을 만든다
  const atLimit = { ...g.got };
  late.resolve(roadLeg(legs[3]));
  await g.done;
  assert.deepEqual(newShapeKeys(g.got, atLimit), [legs[3].key], '늦게 온 모양');
  assert.deepEqual(newShapeKeys(g.got, g.got), []);
});

/* ---------- 실제 계획 + 길 모양 제공자 ---------- */

/** OSRM 꼴 응답. 주소의 두 점 사이에 가짜 길을 준다 */
function osrmFor(url: string): { status: number; body: unknown } {
  const m = /\/route\/v1\/[a-z]+\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)\?/.exec(url);
  if (!m) return { status: 404, body: 'not found' };
  const a = { longitude: Number(m[1]), latitude: Number(m[2]) };
  const b = { longitude: Number(m[3]), latitude: Number(m[4]) };
  const road = bentRoad(a, b, 0.2);
  const meters = Math.round(lineLength(road));
  return {
    status: 200,
    body: {
      code: 'Ok',
      routes: [
        {
          distance: meters,
          geometry: { type: 'LineString', coordinates: road.map((c) => [c.longitude, c.latitude]) },
          legs: [{ steps: [{ distance: meters, name: '', maneuver: { type: 'depart', bearing_after: 90 } }, { distance: 0, maneuver: { type: 'arrive' } }] }],
        },
      ],
    },
  };
}

async function realPlan(): Promise<{ trip: Trip; plan: Plan }> {
  const clock = fixedClock(SCENARIO_T0);
  const fetch = fakeFetch(() => ({ status: 500, body: '키 없는 테스트에서 네트워크를 쓰면 안 된다' }));
  const { trip, plan } = await runScenario({
    ids: seqIds(),
    clock,
    places: createPlaceProvider({ fetch }),
    extraction: createExtractionProvider({ fetch }),
    routes: createRouteProvider({ fetch, clock, kv: memoryKV() }),
  });
  return { trip, plan };
}

test('실제 10/18 계획: 지도 구간(dayLegs)의 길 모양을 받아 재생해도 도착 → 조정안 → 빈 시간 → 사진 순서와 도착 스팟이 같다', async () => {
  const { trip, plan } = await realPlan();
  const pd = plan.days.find((d) => d.date === DATE);
  assert.ok(pd && pd.items.length >= 3);
  const day = liveDayFromTrip(trip, pd);
  const categories: Record<string, Category> = {};
  for (const sp of trip.spots) categories[sp.id] = sp.category;

  // 스토어와 같은 흐름: 지도 구간 → routes.route(24시간 캐시) → 지도 선 모양
  const fetch = fakeFetch((call) => osrmFor(call.url));
  const routes = createRouteProvider({ fetch, clock: fixedClock(SCENARIO_T0), kv: memoryKV(), roadShapes: {} });
  const legs = dayLegs(pd, coordLookup(trip), trip.transport);
  const g = gatherLegShapes(legs, (l) => routes.route(l.from, l.to, l.transport));
  await g.done;
  assert.equal(Object.keys(g.got).length, legs.length, '구간마다 길 모양');
  assert.equal(fetch.calls.length, legs.length, '구간마다 한 번 묻는다');
  // 다시 모으면 24시간 캐시에서 온다
  await gatherLegShapes(legs, (l) => routes.route(l.from, l.to, l.transport)).done;
  assert.equal(fetch.calls.length, legs.length);

  const track = generateTrack({ day, preset: 'full1018', categories, legShapes: g.got });
  // 점은 지도 선 위에 있다. 복귀 없는 날은 지도에 복귀 선이 없어 마지막 스팟 → 기점만 직선이다
  const lines = Object.values(g.got);
  const lastCoord = day.items[day.items.length - 1].coord;
  if (pd.noReturn && day.base) lines.push([lastCoord, day.base]);
  const off = track.samples.filter((s: GpsSample) => nearest(lines, s.coord) > 20);
  assert.equal(off.length, 0, `길 밖 샘플 ${off.length}개`);

  const road = replayTrack({ track, day });
  const line = replayTrack({ track: generateTrack({ day, preset: 'full1018', categories }), day });
  const idx = (k: string) => road.timeline.findIndex((e) => e.kind === k);
  assert.ok(idx('arrived') >= 0 && idx('delay') > idx('arrived') && idx('freeTime') > idx('delay'));
  assert.ok(road.timeline.some((e) => e.kind === 'photo' && e.multiple), '3장 묶음(1장은 EXIF 없음)');
  assert.deepEqual(
    arrivalsOf(road.timeline).map((e) => `${e.kind}:${'spotId' in e ? e.spotId : ''}`),
    arrivalsOf(line.timeline).map((e) => `${e.kind}:${'spotId' in e ? e.spotId : ''}`),
  );
});

/* ---------- 스토어·지도 연결 ---------- */

test('스토어: 궤적을 만들기 전에 그날 구간 모양을 상한까지 기다리고, 늦게 받은 모양과 이어 만들기도 같은 방식이다', () => {
  const src = readFileSync('src/store/live.ts', 'utf8');
  const startLive = /const startLive = async[\s\S]*?\n {6}\};\n/.exec(src)?.[0] ?? '';
  assert.match(
    startLive,
    /shapes = gatherDayShapes\(doc, day\);\n\s+await waitShapes\(shapes, SHAPE_WAIT_MS\);\n\s+if \(seq !== startSeq\) return;[\s\S]*?track = generateTrack\(\{ \.\.\.simInput, legShapes \}\);/,
  );
  assert.match(startLive, /if \(shapes\) addLateShapes\(rt, shapes\);/);
  // 기다리는 사이 그날 계획이 바뀌었으면 바뀐 계획으로 다시 시작한다
  assert.match(startLive, /!sameLiveDay\(liveDay, liveDayFromTrip\(freshDoc, freshDay\)\)\) \{\n\s+void startLive\(tripId, date, requested\);\n\s+return;/);
  assert.match(src, /const SHAPE_WAIT_MS = 1_500;/);
  // 지도 선과 같은 구간·같은 메모(useLegGeometry)로 받는다
  assert.match(src, /gatherLegShapes\(dayLegs\(day, coordLookup\(trip\), trip\.transport\), legGeometry\)/);
  // 계획이 바뀌어 이어 만들 때도 아는 모양으로 바로 만들고, 새 구간은 받는 대로 다시 만든다
  assert.match(src, /rebuildSimTrack\(run\);\n\s+addLateShapes\(run, gatherDayShapes\(trip, day\)\);/);
  assert.match(src, /const track = generateTrack\(\{ \.\.\.run\.simInput, legShapes: run\.legShapes \}\);/);
  const geo = readFileSync('src/components/map/useLegGeometry.ts', 'utf8');
  assert.match(geo, /if \(r && !r\.provisional\) memo\.set\(leg\.key, r\);/, '임시 결과(직선)는 메모에 두지 않는다');
  assert.match(geo, /export function legGeometry\(leg: MapLeg\)/);
});
