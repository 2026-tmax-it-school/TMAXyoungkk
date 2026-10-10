import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { Category, LatLng } from '../src/types';
import { DEFAULT_NOTIFY_PREFS } from '../src/core/constants';
import { initialTracker, type ArrivalTracker } from '../src/core/live/arrival';
import type { LiveDay } from '../src/core/live/context';
import { evaluateTiming } from '../src/core/live/delay';
import { acknowledgeDelay, ingestSample, initialEngine, type EngineState } from '../src/core/live/engine';
import {
  BACK_SLACK_M,
  makePath,
  ON_ROAD_M,
  pathLength,
  pinnedShape,
  pointAtDistance,
  progressOnPath,
  projectOnPath,
  SNAP_TOLERANCE_M,
} from '../src/core/live/legPath';
import { legGeometryKey } from '../src/core/map/model';
import { SIM_PRESETS } from '../src/core/sim/presets';
import { replayTrack, type TimelineEntry } from '../src/core/sim/replay';
import { generateTrack, offsetCoord, seededFloat, type GenerateTrackInput } from '../src/core/sim/track';
import { atKst, haversineKm, toMin } from '../src/core/util';
import { scenarioPlace } from '../src/data/scenario';

/**
 * 길 위 진행(WP5, 2026-10-09 리뷰 5). 시뮬레이터 점이 길을 따라가면서 생긴 두 문제의 회귀 테스트다.
 * 1. 지연 판정의 남은 시간이 직선 남은 거리 비율이라, 처음 12km를 옆으로 가는 60분 구간에서 제때 가는 점에도 15분 지연
 *    조정안이 떴다(보통 프리셋, 시연 재생까지 멈춤). 이제 엔진이 아는 구간 길 모양(EngineCtx.legShapes)으로
 *    예정 이동 시간 × (1 - 길 위 진행 비율)을 쓴다. 모양이 없거나 길에서 멀면 예전 직선 비율이다.
 * 2. 이어서 만들기가 길에서 가장 가까운 한 점에 붙어, 유턴해 출발지 옆 14m를 다시 지나는 길에서 출발지의 점이
 *    돌아오는 차선에 붙고 유턴을 건너뛰었다. 이제 가까운 후보 가운데 앞쪽에 붙고, 직전 진행을 알면 그 뒤로 붙인다.
 * 네트워크는 쓰지 않는다.
 */

const DATE = '2026-10-18';
const at = (hhmm: string) => atKst(DATE, hhmm);
const M_PER_DEG = 111_320;
const ctxOf = (day: LiveDay, legShapes?: Record<string, LatLng[]>) => ({
  tripId: day.tripId,
  day,
  prefs: DEFAULT_NOTIFY_PREFS,
  source: 'sim' as const,
  ...(legShapes ? { legShapes } : {}),
});

/* ---------- 가짜 길 ---------- */

/** 처음 sideM만큼 옆(북쪽, 고속도로 나들목 쪽)으로 갔다가 도착지로 가는 ㄱ자 길 */
function lRoad(a: LatLng, b: LatLng, sideM: number): LatLng[] {
  const corner = offsetCoord(a, sideM, 0);
  const pts: LatLng[] = [];
  for (let i = 0; i <= 10; i += 1) pts.push(offsetCoord(a, (sideM * i) / 10, 0));
  for (let i = 1; i <= 30; i += 1) {
    const f = i / 30;
    pts.push({ latitude: corner.latitude + (b.latitude - corner.latitude) * f, longitude: corner.longitude + (b.longitude - corner.longitude) * f });
  }
  return pts;
}

/** 진행 방향 옆으로 크게 돌았다가 오는 길(wp5-sim-road와 같은 꼴). 핀 옆 60~70m에서 시작·끝난다 */
function bentRoad(a: LatLng, b: LatLng, bend: number): LatLng[] {
  const n = (b.latitude - a.latitude) * M_PER_DEG;
  const e = (b.longitude - a.longitude) * M_PER_DEG * Math.cos((a.latitude * Math.PI) / 180);
  const len = Math.hypot(n, e);
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

/** 기점 → S1(60분, 동쪽 40km) → S2(15분). 보통 프리셋으로 제때 가는 하루 */
function farDay(travel = 60, distM = 40_000): LiveDay {
  const base = { latitude: 35.8, longitude: 129.0 };
  const s1 = offsetCoord(base, 0, distM);
  const s2 = offsetCoord(s1, 6000, 0);
  const a1 = toMin('09:00') + travel;
  return {
    tripId: 't',
    date: DATE,
    dayStartMs: at('00:00'),
    startMin: toMin('09:00'),
    base,
    items: [
      { spotId: 's1', name: 'S1', coord: s1, arriveMin: a1, departMin: a1 + 90, travelMin: travel, transport: 'car' },
      { spotId: 's2', name: 'S2', coord: s2, arriveMin: a1 + 105, departMin: a1 + 180, travelMin: 15, transport: 'car' },
    ],
  };
}

/**
 * 유턴 길. A에서 동쪽 600m(남쪽 차선)로 갔다가 유턴해 반대 차선(북쪽 14m)으로 A 옆을 다시 지나 B로 간다.
 * A 체류 09:10~10:00, B 도착 10:12(12분).
 */
function uturnDay(): { day: LiveDay; road: LatLng[]; key: string; A: LatLng; B: LatLng } {
  const base = { latitude: 35.8, longitude: 129.2 };
  const A = offsetCoord(base, 3000, 0);
  const B = offsetCoord(A, 2000, -1500);
  const road = [
    A,
    offsetCoord(A, 0, 300),
    offsetCoord(A, 0, 600),
    offsetCoord(A, 14, 600),
    offsetCoord(A, 14, 300),
    offsetCoord(A, 14, 0),
    offsetCoord(A, 14, -800),
    B,
  ];
  const day: LiveDay = {
    tripId: 't',
    date: DATE,
    dayStartMs: at('00:00'),
    startMin: toMin('09:00'),
    base,
    items: [
      { spotId: 'a', name: 'A', coord: A, arriveMin: toMin('09:10'), departMin: toMin('10:00'), travelMin: 10, transport: 'car' },
      { spotId: 'b', name: 'B', coord: B, arriveMin: toMin('10:12'), departMin: toMin('11:00'), travelMin: 12, transport: 'car' },
    ],
  };
  return { day, road, key: legGeometryKey(A, B, 'car'), A, B };
}

/** 돌아오는 차선에서 A 옆을 지나는 지점의 누적 거리(동 600 + 유턴 14 + 서 600) */
const RETURN_AT_A = 600 + 14 + 600;

const eastOf = (A: LatLng, c: LatLng) => (c.longitude - A.longitude) * M_PER_DEG * Math.cos((A.latitude * Math.PI) / 180);
const delays = (tl: TimelineEntry[]) => tl.filter((e) => e.kind === 'delay');
const arrivals = (tl: TimelineEntry[]) =>
  tl.filter((e) => e.kind === 'arrived' || e.kind === 'skipped').map((e) => `${e.kind}:${'spotId' in e ? e.spotId : ''}@${e.t}`);

/* ---------- 선에 붙이기(core/live/legPath) ---------- */

test('선에 붙이기: 길이 겹치면 앞쪽 길에, 직전 진행을 알면 그 뒤에 붙고, 길에서 멀면 길 위 진행이 없다', () => {
  const { road, A, B } = uturnDay();
  const path = makePath(pinnedShape(road, A, B));
  assert.ok(Math.abs(pathLength(path) - (RETURN_AT_A + 800 + haversineKm(offsetCoord(A, 14, -800), B) * 1000)) < 5);
  // 출발지에 있으면(흔들림 남북 ±12m) 돌아오는 차선이 더 가까워도 출발 쪽에 붙는다(가장 가까운 점이면 8m부터 1214m에 붙었다)
  for (const dn of [-8, 0, 6, 8, 12]) {
    const on = projectOnPath(path, offsetCoord(A, dn, 0));
    assert.ok(on.along < 1, `${dn}m: ${on.along.toFixed(0)}m`);
    assert.equal(on.distM.toFixed(3), Math.abs(dn).toFixed(3));
  }
  // 돌아오는 차선에서 A 옆을 지나는 중: 직전 진행을 알면 그 차선, 모르면 앞쪽(출발) 차선
  const back = offsetCoord(A, 14, 0);
  assert.ok(Math.abs(projectOnPath(path, back, RETURN_AT_A - 170).along - RETURN_AT_A) < 1);
  assert.ok(projectOnPath(path, back).along < 1);
  // 나가는 차선을 가는 중이면 직전 진행이 있어도 나가는 차선이다(뒤쪽 후보로 건너뛰지 않는다)
  assert.ok(Math.abs(projectOnPath(path, offsetCoord(A, 3, 300), 130).along - 300) < 1);
  // 직전 진행보다 많이 뒤인 후보만 있으면(되돌아감) 그래도 붙인다
  assert.ok(Math.abs(projectOnPath(path, offsetCoord(A, -3, 300), 2500).along - 300) < 1);
  assert.ok(BACK_SLACK_M >= SNAP_TOLERANCE_M);
  // 길 위 진행 비율과 길에서 멀 때
  const mid = pointAtDistance(path, pathLength(path) / 2);
  assert.ok(Math.abs((progressOnPath(path, mid)?.fraction ?? -1) - 0.5) < 1e-6);
  assert.equal(progressOnPath(path, offsetCoord(A, -(ON_ROAD_M + 30), 0)), undefined);
});

test('선에 붙이기: 겹친 점(길이 0인 선분)·점 하나뿐인 선에서도 유한한 값이고, 늘 가장 가까운 거리 + 20m 안이다', () => {
  const rnd = seededFloat(4242);
  for (let iter = 0; iter < 200; iter += 1) {
    const a = { latitude: 35.8 + rnd() * 0.1, longitude: 129.2 + rnd() * 0.1 };
    const pts: LatLng[] = [a];
    const n = 2 + Math.floor(rnd() * 30);
    for (let i = 0; i < n; i += 1) {
      const last = pts[pts.length - 1];
      pts.push(rnd() < 0.15 ? { ...last } : offsetCoord(last, (rnd() - 0.5) * 800, (rnd() - 0.5) * 800));
    }
    const path = makePath(pts);
    const c = offsetCoord(pts[Math.floor(rnd() * pts.length)], (rnd() - 0.5) * 300, (rnd() - 0.5) * 300);
    const prev = rnd() < 0.5 ? rnd() * pathLength(path) : undefined;
    const on = projectOnPath(path, c, prev);
    const best = projectOnPath(path, c, -Infinity);
    assert.ok(Number.isFinite(on.along) && Number.isFinite(on.distM));
    assert.ok(on.along >= 0 && on.along <= pathLength(path) + 1e-6);
    assert.ok(on.distM <= best.distM + SNAP_TOLERANCE_M + 1e-6);
  }
  const one = makePath([{ latitude: 35.8, longitude: 129.2 }, { latitude: 35.8, longitude: 129.2 }]);
  const on = projectOnPath(one, offsetCoord({ latitude: 35.8, longitude: 129.2 }, 30, 40));
  assert.equal(on.along, 0);
  assert.ok(Math.abs(on.distM - 50) < 0.5);
});

/* ---------- 1. 지연 판정의 남은 시간 ---------- */

test('지연 판정: 길 모양을 알면 남은 시간 = 예정 이동 시간 × (1 - 길 위 진행 비율)이고 길 위 진행을 남긴다', () => {
  const day = farDay();
  const base = day.base as LatLng;
  const key = legGeometryKey(base, day.items[0].coord, 'car');
  const road = lRoad(base, day.items[0].coord, 12_000);
  const path = makePath(pinnedShape(road, base, day.items[0].coord));
  const tr: ArrivalTracker = initialTracker();
  // 09:00 출발, 10:00 도착 예정. 12분 뒤 길의 20% 지점(아직 옆으로 가는 중)이면 제때다
  const now = at('09:12');
  const pos = pointAtDistance(path, pathLength(path) * 0.2);
  const t = evaluateTiming(day, tr, now, pos, { shapes: { [key]: road } });
  assert.ok(t);
  assert.equal(t.phase, 'moving');
  assert.ok(Math.abs(t.etaMin - (toMin('09:12') + 60 * 0.8)) < 1e-6, `${t.etaMin}`);
  assert.equal(t.delayMin, 0);
  assert.equal(t.along?.key, key);
  assert.ok(Math.abs((t.along?.alongM ?? 0) - pathLength(path) * 0.2) < 1);
  // 같은 자리를 직선 비율로 재면(모양 모름) 도착지까지 직선거리가 처음보다 멀어 늦게 본다
  const plain = evaluateTiming(day, tr, now, pos);
  assert.ok(plain && plain.etaMin - t.etaMin > 10, `${plain?.etaMin}`);
  assert.equal(plain.along, undefined);
  // 길에서 멀면(다른 길) 직선 비율이고, 같은 구간의 직전 진행은 이어 둔다
  const off = offsetCoord(pos, 0, 2000);
  const far = evaluateTiming(day, tr, now, off, { shapes: { [key]: road }, prev: t.along });
  assert.deepEqual({ ...far, along: undefined }, { ...evaluateTiming(day, tr, now, off), along: undefined });
  assert.deepEqual(far?.along, t.along);
});

test('지연 판정: 모양이 없거나 두 점(직선)이거나 다른 수단 키면 예전과 같다', () => {
  const day = farDay(25, 12_000);
  const base = day.base as LatLng;
  const s1 = day.items[0].coord;
  const key = legGeometryKey(base, s1, 'car');
  const tr = initialTracker();
  const variants = [{}, { shapes: {} }, { shapes: { [key]: [base, s1] } }, { shapes: { [key.replace(/^car:/, 'walk:')]: lRoad(base, s1, 3000) } }];
  for (const hhmm of ['08:50', '09:05', '09:20', '09:40']) {
    for (const f of [0, 0.3, 0.7, 1.2]) {
      const pos = { latitude: base.latitude + (s1.latitude - base.latitude) * f, longitude: base.longitude + (s1.longitude - base.longitude) * f };
      const want = evaluateTiming(day, tr, at(hhmm), pos);
      for (const v of variants) assert.deepEqual(evaluateTiming(day, tr, at(hhmm), pos, v), want, `${hhmm} ${f} ${JSON.stringify(Object.keys(v))}`);
    }
    // 위치를 모를 때도 같다
    assert.deepEqual(evaluateTiming(day, tr, at(hhmm), undefined, { shapes: { [key]: lRoad(base, s1, 3000) } }), evaluateTiming(day, tr, at(hhmm)));
  }
});

test('보통 프리셋: 처음 12~20km를 옆으로 가는 60분 길을 제때 따라가도 지연 조정안이 뜨지 않는다(리뷰 재현)', () => {
  const day = farDay();
  const base = day.base as LatLng;
  const key = legGeometryKey(base, day.items[0].coord, 'car');
  const plain = replayTrack({ track: generateTrack({ day, preset: 'normal' }), day });
  assert.equal(delays(plain.timeline).length, 0);
  for (const side of [8000, 12_000, 20_000]) {
    const shapes = { [key]: lRoad(base, day.items[0].coord, side) };
    const track = generateTrack({ day, preset: 'normal', legShapes: shapes });
    // 스토어와 같이 엔진도 궤적을 만든 모양으로 잰다
    const road = replayTrack({ track, day, legShapes: shapes });
    assert.deepEqual(delays(road.timeline), [], `옆 ${side}m`);
    assert.deepEqual(arrivals(road.timeline), arrivals(plain.timeline), `옆 ${side}m 도착`);
    if (side >= 12_000) {
      // 엔진이 모양을 모르면(직선 비율) 이 길에서 거짓 지연이 난다. 그래서 엔진에 모양을 넘긴다
      const legacy = replayTrack({ track, day });
      assert.ok(delays(legacy.timeline).length > 0, `옆 ${side}m 직선 비율`);
    }
  }
});

test('보통 프리셋: 크게 휜 길(구간 25~90분)을 따라가도 지연·빈 시간이 직선일 때와 같다', () => {
  for (const travel of [25, 45, 60, 90]) {
    for (const bend of [0.2, 0.4]) {
      const day = farDay(travel, travel * 600);
      const base = day.base as LatLng;
      const s1 = day.items[0].coord;
      const s2 = day.items[1].coord;
      const shapes = {
        [legGeometryKey(base, s1, 'car')]: bentRoad(base, s1, bend),
        [legGeometryKey(s1, s2, 'car')]: bentRoad(s1, s2, bend),
      };
      const plain = replayTrack({ track: generateTrack({ day, preset: 'normal' }), day });
      const road = replayTrack({ track: generateTrack({ day, preset: 'normal', legShapes: shapes }), day, legShapes: shapes });
      const kinds = (tl: TimelineEntry[]) => tl.filter((e) => e.kind === 'delay' || e.kind === 'freeTime').map((e) => e.kind);
      assert.deepEqual(kinds(road.timeline), kinds(plain.timeline), `${travel}분 ${bend}`);
    }
  }
});

test('10/18 프리셋 9종: 엔진이 길 모양으로 재도 도착·조정안·빈 시간 순서와 대상이 직선일 때와 같다', () => {
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
  const day: LiveDay = { tripId: 't', date: DATE, dayStartMs: at('00:00'), startMin: toMin('09:00'), base: scenarioPlace('gj-lahan-select').coord, items };
  const shapes: Record<string, LatLng[]> = {};
  let prev = day.base as LatLng;
  for (const it of items) {
    shapes[legGeometryKey(prev, it.coord, 'car')] = bentRoad(prev, it.coord, 0.3);
    prev = it.coord;
  }
  shapes[legGeometryKey(prev, day.base as LatLng, 'car')] = bentRoad(prev, day.base as LatLng, 0.3);
  const brief = (tl: TimelineEntry[]) =>
    tl.filter((e) => e.kind !== 'shadowOn' && e.kind !== 'shadowOff' && e.kind !== 'photo').map((e) => `${e.kind}:${'spotId' in e ? e.spotId : ''}`);
  for (const p of SIM_PRESETS) {
    const input: GenerateTrackInput = { day, preset: p.id, categories, closeMin };
    const line = replayTrack({ track: generateTrack(input), day });
    const road = replayTrack({ track: generateTrack({ ...input, legShapes: shapes }), day, legShapes: shapes });
    assert.deepEqual(brief(road.timeline).slice(0, 8), brief(line.timeline).slice(0, 8), p.id);
    assert.deepEqual(arrivals(road.timeline).map((s) => s.split('@')[0]), arrivals(line.timeline).map((s) => s.split('@')[0]), `${p.id} 도착`);
  }
});

test('엔진: 유턴 길에서 돌아오는 차선이 출발지 옆을 지날 때도 길 위 진행이 뒤로 가지 않는다(직전 진행)', () => {
  const { day, road, key, A } = uturnDay();
  const shapes = { [key]: road };
  const track = generateTrack({ day, preset: 'normal', legShapes: shapes });
  const ctx = ctxOf(day, shapes);
  let st: EngineState = initialEngine();
  const seen: { t: number; along: number; noPrev?: number; east: number }[] = [];
  for (const s of track.samples) {
    const r = ingestSample(st, s, ctx);
    st = r.state;
    for (const e of r.effects) if (e.kind === 'delay') st = acknowledgeDelay(st, e.delayMin);
    if (st.timing?.along?.key === key && s.t < at('10:12')) {
      const noPrev = evaluateTiming(day, st.tracker, s.t, s.coord, { shapes })?.along?.alongM;
      seen.push({ t: s.t, along: st.timing.along.alongM, noPrev, east: eastOf(A, s.coord) });
    }
  }
  assert.ok(seen.length >= 20);
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i].along >= seen[i - 1].along - 30, `${i}: ${seen[i - 1].along} → ${seen[i].along}`);
  // A 옆(동서 ±150m)을 돌아오는 차선으로 지나는 샘플: 직전 진행이 있으면 돌아오는 차선, 없으면 출발 쪽에 붙었을 자리
  const passing = seen.filter((x) => x.along > 900 && Math.abs(x.east) < 150);
  assert.ok(passing.length >= 1);
  for (const x of passing) {
    assert.ok(Math.abs(x.along - RETURN_AT_A) < 200, `${x.along}`);
    assert.ok((x.noPrev ?? 0) < 400, `직전 진행 없이면 ${x.noPrev}`);
  }
  assert.equal(st.tracker.statuses.b, 'arrived');
});

/* ---------- 2. 이어서 만들기 ---------- */

test('이어서 만들기: 유턴 길의 출발지에서 이으면(흔들림 ±12m) 유턴까지 가서 예정 이동 시간 뒤에 도착한다(리뷰 재현)', () => {
  const { day, road, key, A, B } = uturnDay();
  const shapes = { [key]: road };
  for (const dn of [-8, 0, 6, 8, 12]) {
    const r = generateTrack({ day, preset: 'normal', legShapes: shapes, resume: { t: at('09:40'), coord: offsetCoord(A, dn, 0), doneSpotIds: ['a'] } });
    // A는 끝난 스팟이라 09:40부터 바로 B로 간다(남은 길 비율 × 12분). 유턴(동쪽 600m)까지 간다
    const firstLeg = r.samples.filter((s) => s.t > at('09:40') && s.t < at('09:46'));
    const maxEast = Math.max(...firstLeg.map((s) => eastOf(A, s.coord)));
    assert.ok(maxEast > 450, `${dn}m: 동쪽 ${maxEast.toFixed(0)}m`);
    const atB = r.samples.find((s) => haversineKm(s.coord, B) * 1000 < 25);
    assert.ok(atB && Math.abs(atB.t - at('09:52')) <= 60_000, `${dn}m: B ${atB ? new Date(atB.t).toISOString() : '-'}`);
  }
});

test('이어서 만들기: 같은 구간 직전 진행(엔진 Timing.along)을 넘기면 돌아오는 차선에서 이어 가고, 키가 다르면 쓰지 않는다', () => {
  const { day, road, key, A, B } = uturnDay();
  const shapes = { [key]: road };
  const coord = offsetCoord(A, 14, 0);
  const t = at('10:03');
  const base = { day, preset: 'normal' as const, legShapes: shapes };
  const withAlong = generateTrack({ ...base, resume: { t, coord, doneSpotIds: ['a'], along: { key, alongM: RETURN_AT_A - 150 } } });
  const noAlong = generateTrack({ ...base, resume: { t, coord, doneSpotIds: ['a'] } });
  const otherKey = generateTrack({ ...base, resume: { t, coord, doneSpotIds: ['a'], along: { key: `walk:${key.slice(4)}`, alongM: RETURN_AT_A - 150 } } });
  const leg = (tr: ReturnType<typeof generateTrack>) => tr.samples.filter((s) => s.t < at('10:20'));
  // 돌아오는 차선에서 이으면 동쪽(유턴)으로 다시 가지 않고 남은 길만큼 일찍 닿는다
  assert.ok(Math.max(...leg(withAlong).map((s) => eastOf(A, s.coord))) < 30);
  const arriveAt = (tr: ReturnType<typeof generateTrack>) => tr.samples.find((s) => haversineKm(s.coord, B) * 1000 < 25)?.t ?? Infinity;
  assert.ok(arriveAt(withAlong) < arriveAt(noAlong));
  // 직전 진행을 모르면 출발 쪽 길에 붙는다(출발지에서 이을 때가 대부분이라 그쪽이 맞다)
  assert.ok(Math.max(...leg(noAlong).map((s) => eastOf(A, s.coord))) > 450);
  assert.deepEqual(otherKey, noAlong);
  // 결정적이다
  assert.deepEqual(generateTrack({ ...base, resume: { t, coord, doneSpotIds: ['a'], along: { key, alongM: RETURN_AT_A - 150 } } }), withAlong);
});

/* ---------- 스토어 연결(소스 규칙) ---------- */

test('스토어: 엔진 입력에 받은 구간 모양을 넣고, 이어서 만들기에 엔진의 길 위 진행을 넘기며, 모양은 계획 구간 조회로만 채운다', () => {
  const src = readFileSync('src/store/live.ts', 'utf8');
  assert.match(src, /if \(run\.ctx\.prefs !== prefs \|\| run\.ctx\.legShapes !== run\.legShapes\) run\.ctx = \{ \.\.\.run\.ctx, prefs, legShapes: run\.legShapes \};/);
  assert.match(src, /ctx: \{ tripId, day: liveDay, prefs, source: requested === 'sim' \? 'sim' : 'device', legShapes \},/);
  assert.match(src, /along: run\.engine\.timing\?\.along,/);
  // 구간 모양은 계획 구간(gatherDayShapes → routes.route)으로 받은 것뿐이다. 실제 위치(샘플)로 묻지 않는다
  const assigns = [...src.matchAll(/legShapes = ([^;\n]+)/g)].map((m) => m[1]);
  assert.deepEqual(assigns.sort(), ['{ ...run.legShapes, ...g.got }', '{ ...shapes.got }'].sort());
  const engine = readFileSync('src/core/live/engine.ts', 'utf8');
  assert.match(engine, /evaluateTiming\(ctx\.day, st\.tracker, now, position, \{ shapes: ctx\.legShapes, prev: st\.timing\?\.along \}\)/);
});
