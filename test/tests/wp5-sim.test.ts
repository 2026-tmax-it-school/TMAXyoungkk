import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Category, GpsSample, Op, Plan, SimPresetId, Trip } from '../src/types';
import { DEFAULT_NOTIFY_PREFS, LOCATION_INTERVAL_MS } from '../src/core/constants';
import { acceptWhileForeground, initialBackground, onAppPhase } from '../src/core/live/background';
import type { LiveDay } from '../src/core/live/context';
import { liveDayFromTrip } from '../src/core/live/context';
import { acknowledgeDelay, engineAppPhase, ingestSample, initialEngine, type EngineEffect, type EngineState } from '../src/core/live/engine';
import { closingMinutes, doneSpotIds, replanPosition } from '../src/core/live/session';
import {
  initialWatchProfile,
  nextWatchProfile,
  STATIONARY_SWITCH_SAMPLES,
  throttleSample,
  watchRequest,
  type ThrottleState,
} from '../src/core/live/throttle';
import { applyOp } from '../src/core/ops';
import { buildPlan } from '../src/core/planner';
import { replanForDelay } from '../src/core/planner/replan';
import { appendTrack, pruneTracks } from '../src/core/live/track';
import { createSimClock, type SimSpeed } from '../src/core/sim/clock';
import { PRESET_SEED, SIM_PRESETS, SIM_SPEEDS } from '../src/core/sim/presets';
import { replayTrack } from '../src/core/sim/replay';
import { closingTarget, generateTrack, offsetCoord, samplesBetween } from '../src/core/sim/track';
import { liveModeFor } from '../src/core/live/mode';
import { isTrackExpired } from '../src/core/tripStatus';
import { atKst, toMin } from '../src/core/util';
import { scenarioPlace } from '../src/data/scenario';
import { runScenario } from '../src/demo/scenarioRunner';
import { createExtractionProvider } from '../src/services/extraction';
import { createSimLocation, type SimTimer } from '../src/services/location/sim';
import { createPlaceProvider } from '../src/services/places';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV, seqIds } from './helpers/fakes';
import { SCENARIO_T0 } from './helpers/fixtures';

/**
 * 여행 시뮬레이터(WP5). SimClock 배속·정지·점프, 결정적 궤적(30초), 프리셋 9종의 이벤트 열,
 * 30초 스로틀·정지 시 갱신 중단, 권한 거부 → 수동 진행, 백그라운드 정지와 공백 미복원, 위치 로그 90일.
 */

const DATE = '2026-10-18';
const at = (hhmm: string) => atKst(DATE, hhmm);

/** 10/18 시나리오 순서(앞 세 곳은 HANDOFF 골든, 뒤 두 곳은 시뮬레이터 확인용) */
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

function replay(preset: SimPresetId, seed?: number) {
  const { day, categories } = day1018();
  const track = generateTrack({ day, preset, categories, seed });
  return { track, day, ...replayTrack({ track, day }) };
}

/* ---------- SimClock ---------- */

test('SimClock: 1·10·60·300배, 일시정지, 점프', () => {
  assert.deepEqual([...SIM_SPEEDS], [1, 10, 60, 300]);
  const base = fixedClock(1_000_000);
  const start = at('09:00');
  for (const speed of SIM_SPEEDS as readonly SimSpeed[]) {
    const c = createSimClock(base, start, speed);
    assert.equal(c.now(), start, '재생 전에는 멈춰 있다');
    c.play();
    base.advance(1000);
    assert.equal(c.now(), start + 1000 * speed);
    c.pause();
    const paused = c.now();
    base.advance(5000);
    assert.equal(c.now(), paused, '일시정지 중에는 흐르지 않는다');
    base.advance(-6000);
  }
  const c = createSimClock(base, start, 60);
  c.play();
  base.advance(1000);
  c.setSpeed(300);
  base.advance(1000);
  assert.equal(c.now(), start + 60_000 + 300_000, '배속을 바꿔도 지난 시각은 유지된다');
  const end = atKst('2026-10-20', '09:00');
  c.jumpTo(end);
  assert.equal(c.now(), end, '10/20으로 점프(여행 종료)');
  base.advance(1000);
  assert.equal(c.now(), end + 300_000);
});

/* ---------- 궤적 ---------- */

test('generateTrack은 30초 간격이고 같은 시드면 같은 궤적, 다른 시드면 다르다', () => {
  const { day, categories } = day1018();
  const a = generateTrack({ day, preset: 'normal', categories });
  const b = generateTrack({ day, preset: 'normal', categories });
  assert.deepEqual(a, b);
  for (let i = 1; i < a.samples.length; i += 1) assert.equal(a.samples[i].t - a.samples[i - 1].t, LOCATION_INTERVAL_MS);
  assert.ok(a.samples.every((s) => typeof s.accuracyM === 'number'), '정확도를 담는다');
  const c = generateTrack({ day, preset: 'normal', categories, seed: 99 });
  assert.notDeepEqual(a.samples[10].coord, c.samples[10].coord);
});

test('프리셋은 9종이고 id가 겹치지 않으며 시드가 고정돼 있다', () => {
  const ids = SIM_PRESETS.map((p) => p.id);
  assert.deepEqual(ids, ['normal', 'delay25', 'closed', 'gpsShadow', 'passBy', 'nextDoor', 'denied', 'freeTime', 'full1018']);
  for (const id of ids) assert.equal(typeof PRESET_SEED[id], 'number');
});

test('같은 시드면 같은 이벤트 열이다(프리셋 9종 전부)', () => {
  for (const p of SIM_PRESETS) {
    assert.deepEqual(replay(p.id).timeline, replay(p.id).timeline, p.id);
  }
});

const kinds = (tl: { kind: string }[]) => tl.map((e) => e.kind);
const spotsOf = (tl: { kind: string; spotId?: string }[], kind: string) => tl.filter((e) => e.kind === kind).map((e) => e.spotId);

test('정상: 다섯 곳 모두 도착, 조정안·건너뜀·음영 없음', () => {
  const r = replay('normal');
  assert.equal(spotsOf(r.timeline, 'arrived').length, 5);
  for (const k of ['delay', 'skipped', 'shadowOn']) assert.equal(kinds(r.timeline).includes(k), false, k);
});

test('지연 25분: 불국사에서 오래 머물러 석굴암 조정안이 나온다', () => {
  const r = replay('delay25');
  const d = r.timeline.find((e) => e.kind === 'delay');
  assert.ok(d && d.kind === 'delay');
  assert.equal(d.spotId, 's-gj-seokguram');
  assert.ok(d.delayMin >= 15);
  const arrivedA = r.timeline.find((e) => e.kind === 'arrived');
  assert.ok(arrivedA && arrivedA.t < d.t, '도착 뒤에 조정안');
});

test('영업 종료: 지연이 커져 조정안이 다시 나오고, 스팟이 바뀌어도 조정안끼리는 30분 간격이다', () => {
  const { day, categories, closeMin } = day1018();
  const track = generateTrack({ day, preset: 'closed', categories, closeMin });
  const r = replayTrack({ track, day });
  const ds = r.timeline.filter((e) => e.kind === 'delay');
  assert.ok(ds.length >= 2);
  for (let i = 1; i < ds.length; i += 1) assert.ok(ds[i].t - ds[i - 1].t >= 30 * 60_000, '동일 유형 30분 1회');
  const target = closingTarget(day, closeMin);
  assert.ok(target);
  assert.equal(day.items[target.index].spotId, 's-gj-museum', '마감까지 여유가 가장 적은 스팟(박물관 18:00)');
  const max = Math.max(...ds.map((e) => (e.kind === 'delay' ? e.delayMin : 0)));
  assert.ok(max >= target.marginMin, `최대 지연 ${max}분이 마감 여유 ${target.marginMin}분을 넘는다`);
});

test('GPS 음영: 음영 안내가 켜졌다 꺼지고 도착 판정은 그대로다', () => {
  const r = replay('gpsShadow');
  const k = kinds(r.timeline);
  assert.ok(k.indexOf('shadowOn') >= 0 && k.indexOf('shadowOff') > k.indexOf('shadowOn'));
  assert.equal(spotsOf(r.timeline, 'arrived').length, 5);
});

test('지나침: 불국사는 건너뜀, 석굴암은 도착', () => {
  const r = replay('passBy');
  assert.deepEqual(spotsOf(r.timeline, 'skipped'), ['s-gj-bulguksa']);
  assert.equal(spotsOf(r.timeline, 'arrived')[0], 's-gj-seokguram');
});

test('옆 건물: 120m 옆에서 머문 5분은 도착이 아니고, 들어간 뒤에 도착한다', () => {
  const r = replay('nextDoor');
  const { day } = day1018();
  const first = r.effects.find((e): e is Extract<EngineEffect, { kind: 'visit' }> => e.kind === 'visit');
  assert.ok(first);
  assert.equal(first.spotId, 's-gj-bulguksa');
  assert.equal(first.status, 'arrived');
  // 이동 25분 + 옆 건물 5분 + 1분 뒤에야 반경에 들어간다
  const departBase = day.items[0].arriveMin - day.items[0].travelMin;
  assert.ok((first.arrivedAt ?? 0) >= at('00:00') + (departBase + 25 + 5) * 60_000);
});

test('권한 거부: 샘플이 없고 수동 진행 모드가 된다', () => {
  const r = replay('denied');
  assert.equal(r.track.permission, 'denied');
  assert.equal(r.track.samples.length, 0);
  assert.equal(r.timeline.length, 0);
  assert.equal(liveModeFor('sim', 'denied'), 'manual');
  assert.equal(liveModeFor('device', 'denied'), 'manual');
  assert.equal(liveModeFor('device', 'granted'), 'device');
  assert.equal(liveModeFor('sim', 'granted'), 'sim');
});

test('빈 시간: 불국사를 일찍 나서 빈 시간 추천 차례가 온다', () => {
  const r = replay('freeTime');
  const ft = r.timeline.find((e) => e.kind === 'freeTime');
  assert.ok(ft && ft.kind === 'freeTime');
  assert.equal(ft.spotId, 's-gj-seokguram');
  assert.ok(ft.gapMin >= 30);
});

test('10/18 종합: 한 번 재생으로 도착 → 조정안 → 빈 시간 → 사진(EXIF 있음·없음 섞인 3장 포함)', () => {
  const r = replay('full1018');
  const first = (k: string) => r.timeline.findIndex((e) => e.kind === k);
  const iArr = first('arrived');
  const iDelay = first('delay');
  const iFree = first('freeTime');
  const iPhoto = first('photo');
  assert.ok(iArr >= 0 && iDelay > iArr, '도착 뒤 조정안');
  assert.ok(iFree > iDelay, '조정안 뒤 빈 시간');
  assert.ok(iPhoto > iDelay, '사진 이벤트');
  const photos = r.timeline.filter((e) => e.kind === 'photo');
  assert.ok(photos.some((p) => p.kind === 'photo' && p.multiple), '3장 묶음(1장은 EXIF 없음)');
  const ft = r.timeline[iFree];
  assert.equal(ft.kind === 'freeTime' && ft.spotId, 's-gj-museum', '점심 뒤 박물관 가는 길');
});

test('이어서 만들기: 조정안 적용 뒤 지금 위치에서 남은 스팟으로 궤적을 다시 만든다', () => {
  const { day, categories } = day1018();
  const t = at('11:10');
  const coord = day.items[0].coord;
  const tr = generateTrack({ day, preset: 'full1018', categories, resume: { t, coord, doneSpotIds: ['s-gj-bulguksa'] } });
  assert.equal(tr.startAt, t);
  assert.ok(tr.samples[0].t === t);
  const rr = replayTrack({ track: tr, day });
  assert.equal(spotsOf(rr.timeline, 'arrived').includes('s-gj-bulguksa'), false);
  assert.ok(spotsOf(rr.timeline, 'arrived').includes('s-gj-seokguram'));
});

/* ---------- 재생 ---------- */

test('샘플 넘기기: 구간 안 샘플만, 10분 넘는 점프는 마지막 하나만(공백은 채우지 않음)', () => {
  const samples: GpsSample[] = Array.from({ length: 100 }, (_, i) => ({ t: i * 30_000, coord: { latitude: 0, longitude: 0 }, accuracyM: 10 }));
  assert.equal(samplesBetween(samples, 0, 90_000).length, 3);
  const jumped = samplesBetween(samples, 0, 40 * 60_000);
  assert.equal(jumped.length, 1);
  assert.equal(jumped[0].t, 40 * 60_000);
  assert.deepEqual(samplesBetween(samples, 100, 50), []);
});

test('createSimLocation: 시계에 맞춰 흘리고, 거부면 아무것도 넘기지 않는다', async () => {
  const clock = fixedClock(0);
  const samples: GpsSample[] = Array.from({ length: 40 }, (_, i) => ({ t: i * 30_000, coord: { latitude: 0, longitude: 0 }, accuracyM: 10 }));
  let tick: () => void = () => {};
  const timer: SimTimer = {
    every(_ms, fn) {
      tick = fn;
      return () => {
        tick = () => {};
      };
    },
  };
  const got: number[] = [];
  const loc = createSimLocation({ clock, samples, timer });
  assert.equal(await loc.permission(), 'granted');
  const off = loc.watch((s) => got.push(s.t), { intervalMs: 30_000 });
  assert.deepEqual(got, [0], '시작 위치 하나');
  clock.set(90_000);
  tick();
  assert.deepEqual(got, [0, 30_000, 60_000, 90_000]);
  clock.set(90_000 + 20 * 60_000);
  tick();
  assert.equal(got.length, 5, '점프는 마지막 하나만');
  off();
  clock.advance(60_000);
  tick();
  assert.equal(got.length, 5, '멈춘 뒤에는 넘기지 않는다');

  const denied = createSimLocation({ clock, samples, timer, permission: 'denied' });
  assert.equal(await denied.request(), 'denied');
  const none: number[] = [];
  denied.watch((s) => none.push(s.t), { intervalMs: 30_000 });
  assert.equal(none.length, 0);
});

/* ---------- 실제 계획(runScenario)으로 재생 ---------- */

async function realPlan(): Promise<{ trip: Trip; plan: Plan; routes: ReturnType<typeof createRouteProvider> }> {
  const clock = fixedClock(SCENARIO_T0);
  const fetch = fakeFetch(() => ({ status: 500, body: '키 없는 테스트에서 네트워크를 쓰면 안 된다' }));
  const routes = createRouteProvider({ fetch, clock, kv: memoryKV() });
  const { trip, plan } = await runScenario({
    ids: seqIds(),
    clock,
    places: createPlaceProvider({ fetch }),
    extraction: createExtractionProvider({ fetch }),
    routes,
  });
  return { trip, plan, routes };
}

function categoriesOf(trip: Trip): Record<string, Category> {
  const out: Record<string, Category> = {};
  for (const sp of trip.spots) out[sp.id] = sp.category;
  return out;
}

test('영업 종료(실제 10/18 계획): 도착 예정이 마감을 넘기면 그 스팟 빼기(영업 종료)가 조정안 1순위다', async () => {
  const { trip, plan, routes } = await realPlan();
  const pd = plan.days.find((d) => d.date === DATE);
  assert.ok(pd && pd.items.length >= 3);
  const day = liveDayFromTrip(trip, pd);
  const closeMin = closingMinutes(trip, DATE);
  const target = closingTarget(day, closeMin);
  assert.ok(target, '마감이 있는 스팟이 있다');
  const targetId = day.items[target.index].spotId;
  const track = generateTrack({ day, preset: 'closed', categories: categoriesOf(trip), closeMin });
  const ctx = { tripId: trip.id, day, prefs: DEFAULT_NOTIFY_PREFS, source: 'sim' as const };
  let st: EngineState = initialEngine();
  const firsts: { kind: string; spotId?: string; label: string }[] = [];
  for (const smp of track.samples) {
    const r = ingestSample(st, smp, ctx);
    st = r.state;
    for (const e of r.effects) {
      if (e.kind !== 'delay') continue;
      const out = await replanForDelay(
        {
          trip,
          plan,
          date: DATE,
          now: smp.t,
          position: replanPosition(day, st.tracker, smp.coord),
          visitedSpotIds: doneSpotIds(st.tracker, 'arrived'),
          skippedSpotIds: doneSpotIds(st.tracker, 'skipped'),
          delayMin: e.delayMin,
        },
        { routes, now: smp.t },
      );
      const a = out.adjustments[0];
      if (a) {
        const op = a.ops[0];
        firsts.push({ kind: a.kind, spotId: op && op.type === 'spot/remove' ? op.spotId : undefined, label: a.label });
      }
      st = acknowledgeDelay(st, e.delayMin);
    }
  }
  const closed = firsts.find((x) => x.kind === 'exclude' && x.spotId === targetId);
  assert.ok(closed, `조정안 첫 줄: ${firsts.map((x) => x.label).join(' / ')}`);
  assert.match(closed.label, /영업 종료/);
});

test('10/18 종합(실제 계획): 도착 → 조정안 → 빈 시간 → 사진, 첫 조정안을 적용한 뒤에도 빈 시간·사진이 이어진다', async () => {
  const { trip, plan, routes } = await realPlan();
  const pd = plan.days.find((d) => d.date === DATE);
  assert.ok(pd);
  const day = liveDayFromTrip(trip, pd);
  const categories = categoriesOf(trip);
  const track = generateTrack({ day, preset: 'full1018', categories });

  // 1) 그대로(거절) 재생해도 순서가 이어진다
  const whole = replayTrack({ track, day });
  const idx = (k: string) => whole.timeline.findIndex((e) => e.kind === k);
  assert.ok(idx('arrived') >= 0 && idx('delay') > idx('arrived') && idx('freeTime') > idx('delay'));
  assert.ok(whole.timeline.some((e) => e.kind === 'photo' && e.multiple), '3장 묶음(1장은 EXIF 없음)');

  // 2) 첫 조정안에서 멈추고 적용한다
  const ctx = { tripId: trip.id, day, prefs: DEFAULT_NOTIFY_PREFS, source: 'sim' as const };
  let st: EngineState = initialEngine();
  let hit: { t: number; delayMin: number; coord: GpsSample['coord'] } | undefined;
  for (const smp of track.samples) {
    const r = ingestSample(st, smp, ctx);
    st = r.state;
    const d = r.effects.find((e) => e.kind === 'delay');
    if (d && d.kind === 'delay') {
      hit = { t: smp.t, delayMin: d.delayMin, coord: smp.coord };
      break;
    }
  }
  assert.ok(hit, '조정안 차례가 온다');
  const out = await replanForDelay(
    {
      trip,
      plan,
      date: DATE,
      now: hit.t,
      position: hit.coord,
      visitedSpotIds: doneSpotIds(st.tracker, 'arrived'),
      skippedSpotIds: doneSpotIds(st.tracker, 'skipped'),
      delayMin: hit.delayMin,
    },
    { routes, now: hit.t },
  );
  const adj = out.adjustments[0];
  assert.ok(adj, '조정안이 하나 이상이다');
  let next: Trip | undefined = trip;
  adj.ops.forEach((draft, i) => {
    const op = { ...draft, id: `op-adj-${i}`, tripId: trip.id, actorId: trip.members[0].id, at: hit.t } as Op;
    next = applyOp(next, op);
  });
  assert.ok(next);
  const plan2 = await buildPlan(next, { routes, now: hit.t });
  const pd2 = plan2.days.find((d) => d.date === DATE);
  assert.ok(pd2);
  const day2 = liveDayFromTrip(next, pd2);
  st = acknowledgeDelay(st, hit.delayMin);

  // 3) 지금 위치에서 궤적을 이어 만들고 같은 엔진으로 계속 흘린다
  const resumed = generateTrack({
    day: day2,
    preset: 'full1018',
    categories: categoriesOf(next),
    resume: { t: hit.t, coord: hit.coord, doneSpotIds: doneSpotIds(st.tracker) },
  });
  const ctx2 = { ...ctx, day: day2 };
  const kinds: string[] = [];
  for (const smp of resumed.samples) {
    const r = ingestSample(st, smp, ctx2);
    st = r.state;
    for (const e of r.effects) {
      if (e.kind === 'delay') st = acknowledgeDelay(st, e.delayMin);
      kinds.push(e.kind === 'visit' ? e.status : e.kind);
    }
  }
  assert.ok(kinds.includes('arrived'), '적용 뒤에도 다음 스팟 도착이 잡힌다');
  assert.ok(kinds.includes('freeTime'), `적용 뒤에도 빈 시간 추천 차례가 온다(${adj.label})`);
  assert.ok(resumed.events.some((e) => e.multiple), '이어 만든 궤적에도 사진 이벤트(3장 묶음)가 있다');
});

/* ---------- 배터리: 30초 스로틀과 정지 ---------- */

test('스로틀: 30초에 1개만 넘기고, 20m 안에서 멈춰 있으면 위치 로그를 갱신하지 않는다', () => {
  const origin = { latitude: 35.8, longitude: 129.2 };
  let st: ThrottleState = {};
  const emitted: number[] = [];
  const recorded: number[] = [];
  // 10초 간격으로 3분 동안 제자리(5m 흔들림), 그다음 이동
  for (let i = 0; i <= 18; i += 1) {
    const coord = i < 12 ? offsetCoord(origin, (i % 2) * 5, 0) : offsetCoord(origin, (i - 11) * 100, 0);
    const r = throttleSample(st, { t: i * 10_000, coord, accuracyM: 10 });
    st = r.state;
    if (r.decision.emit) emitted.push(i * 10_000);
    if (r.decision.record) recorded.push(i * 10_000);
  }
  assert.deepEqual(emitted, [0, 30_000, 60_000, 90_000, 120_000, 150_000, 180_000]);
  assert.deepEqual(recorded, [0, 120_000, 150_000, 180_000], '정지 중(30~90초)은 기록하지 않고 움직이면 다시 기록한다');
});

test('정지가 2분(4샘플) 이어지면 기기 감시를 20m 이동 때만 받는 방식으로 바꾸고, 움직이면 되돌린다', () => {
  let st = initialWatchProfile;
  const still = { emit: true, record: false, stationary: true };
  const moving = { emit: true, record: true, stationary: false };
  const changes: string[] = [];
  for (let i = 0; i < STATIONARY_SWITCH_SAMPLES; i += 1) {
    const r = nextWatchProfile(st, still);
    st = r.state;
    if (r.changed) changes.push(st.profile);
  }
  assert.deepEqual(changes, ['stationary']);
  assert.deepEqual(watchRequest('stationary', LOCATION_INTERVAL_MS), { timeIntervalMs: 60_000, distanceIntervalM: 20 });
  assert.deepEqual(watchRequest('active', LOCATION_INTERVAL_MS), { timeIntervalMs: 30_000, distanceIntervalM: 0 });
  const back = nextWatchProfile(st, moving);
  assert.equal(back.changed, true);
  assert.equal(back.state.profile, 'active');
  assert.equal(nextWatchProfile(back.state, { emit: false, record: false, stationary: false }).changed, false, '거른 샘플은 세지 않는다');
});

/* ---------- 백그라운드 ---------- */

test('백그라운드가 되면 멈추고, 돌아와도 그 사이 경로를 채우지 않는다', () => {
  const r1 = onAppPhase(initialBackground, 'background', 1000);
  assert.equal(r1.stop, true);
  assert.equal(acceptWhileForeground(r1.state, 2000), false);
  const r2 = onAppPhase(r1.state, 'active', 5000);
  assert.equal(r2.resumed, true);
  assert.equal(r2.stop, false);
  assert.deepEqual(r2.state.gaps, [{ from: 1000, to: 5000 }]);
  assert.equal(acceptWhileForeground(r2.state, 3000), false, '늦게 온 공백 구간 샘플은 버린다');
  assert.equal(acceptWhileForeground(r2.state, 5000), true);
});

test('엔진: 백그라운드 공백 구간의 샘플은 위치 로그·판정에 쓰지 않는다', () => {
  const { day } = day1018();
  const ctx = { tripId: 't', day, prefs: DEFAULT_NOTIFY_PREFS, source: 'device' as const };
  const coord = day.items[0].coord;
  let st = initialEngine();
  st = ingestSample(st, { t: at('09:20'), coord, accuracyM: 10 }, ctx).state;
  st = engineAppPhase(st, 'background', at('09:21')).state;
  const during = ingestSample(st, { t: at('09:25'), coord: offsetCoord(coord, 500, 0), accuracyM: 10 }, ctx);
  assert.deepEqual(during.effects, []);
  st = engineAppPhase(during.state, 'active', at('09:40')).state;
  const late = ingestSample(st, { t: at('09:30'), coord: offsetCoord(coord, 900, 0), accuracyM: 10 }, ctx);
  assert.deepEqual(late.effects, [], '돌아온 뒤 늦게 온 공백 샘플도 버린다');
  const after = ingestSample(late.state, { t: at('09:41'), coord: offsetCoord(coord, 900, 0), accuracyM: 10 }, ctx);
  assert.ok(after.effects.some((e) => e.kind === 'track'));
});

/* ---------- 위치 로그 90일 ---------- */

test('위치 로그는 시간순이고, 공유 isTrackExpired로 90일 뒤 지운다', () => {
  const p = (t: number) => ({ t, coord: { latitude: 0, longitude: 0 }, accuracyM: 10, source: 'sim' as const });
  let track = appendTrack({}, 'trip1', DATE, p(10));
  track = appendTrack(track, 'trip1', DATE, p(20));
  track = appendTrack(track, 'trip1', DATE, p(15));
  assert.deepEqual(track.trip1[DATE].map((x) => x.t), [10, 15], '되감기면 뒤쪽을 자른다');
  const trip: Pick<Trip, 'endDate'> = { endDate: '2026-10-19' };
  const boundary = atKst('2026-10-20', '00:00') + 90 * 24 * 3600_000;
  assert.equal(isTrackExpired(trip, boundary - 1000), false);
  assert.equal(isTrackExpired(trip, boundary + 1000), true);
  assert.ok(pruneTracks(track, { trip1: trip }, boundary - 1000).trip1);
  assert.equal(pruneTracks(track, { trip1: trip }, boundary + 1000).trip1, undefined);
  assert.equal(pruneTracks(track, {}, 0).trip1, undefined, '이 기기에 없는 방의 로그도 지운다');
});
