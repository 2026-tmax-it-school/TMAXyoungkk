import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GpsSample, LatLng, Place } from '../src/types';
import {
  ARRIVAL_ACCURACY_M,
  ARRIVAL_DWELL_MS,
  ARRIVAL_RADIUS_M,
  DEFAULT_NOTIFY_PREFS,
  DELAY_THRESHOLD_MIN,
  FREE_TIME_MIN,
  WALKABLE_RADIUS_M,
} from '../src/core/constants';
import { distanceM, initialTracker, manualArrive, stepArrival, type ArrivalEvent, type ArrivalTracker } from '../src/core/live/arrival';
import type { LiveDay } from '../src/core/live/context';
import { delayMinutes, evaluateTiming, hasFreeTime, isDelayed, proposeForDelay, type Timing } from '../src/core/live/delay';
import { evaluateAt, initialEngine, type EngineState } from '../src/core/live/engine';
import { findFreeTime, pickFreeTime } from '../src/core/live/freetime';
import { offsetCoord } from '../src/core/sim/track';
import { atKst } from '../src/core/util';
import { buildPlan, type PlanDeps } from '../src/core/planner';
import { applyDrafts } from '../src/core/planner/preview';
import { replanForDelay } from '../src/core/planner/replan';
import { scenarioPlace } from '../src/data/scenario';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * QA(로직): 여행 진행 중 판정의 명세 수치 경계.
 * - 도착(FR-602): 정확도 50m 이하 샘플만, 반경 100m, 3분 머묾.
 * - 지연(FR-603): ETA가 계획보다 15분 이상 늦으면 조정안.
 * - 빈 시간(FR-604): 다음 일정까지 30분 이상이면 도보 반경에서 2~3곳.
 * 수치는 상수를 그대로 쓰지 않고 명세 값을 직접 적어 상수가 바뀌면 여기서 드러나게 한다.
 */

test('명세 수치: 정확도 50m, 반경 100m, 머묾 3분, 지연 15분, 빈 시간 30분', () => {
  assert.equal(ARRIVAL_ACCURACY_M, 50);
  assert.equal(ARRIVAL_RADIUS_M, 100);
  assert.equal(ARRIVAL_DWELL_MS, 3 * 60 * 1000);
  assert.equal(DELAY_THRESHOLD_MIN, 15);
  assert.equal(FREE_TIME_MIN, 30);
});

/* ---------- 도착 ---------- */

const A: LatLng = { latitude: 35.7901, longitude: 129.332 };
const B: LatLng = offsetCoord(A, 0, 3000);
const at = (hhmm: string) => atKst('2026-10-18', hhmm);
const T0 = at('09:25');
const SEC = 1000;

const day: LiveDay = {
  tripId: 't-qa',
  date: '2026-10-18',
  dayStartMs: at('00:00'),
  startMin: 540,
  base: offsetCoord(A, -3000, 0),
  items: [
    { spotId: 'a', name: '불국사', coord: A, arriveMin: 565, departMin: 655, travelMin: 25, transport: 'car' },
    { spotId: 'b', name: '석굴암', coord: B, arriveMin: 667, departMin: 757, travelMin: 12, transport: 'car' },
  ],
};

const smp = (t: number, coord: LatLng, accuracyM: number | null = 10): GpsSample => ({ t, coord, accuracyM });

function run(samples: GpsSample[], tr: ArrivalTracker = initialTracker()) {
  let cur = tr;
  const events: ArrivalEvent[] = [];
  for (const x of samples) {
    const r = stepArrival(cur, x, day);
    cur = r.tracker;
    events.push(...r.events);
  }
  return { tracker: cur, events, arrived: events.filter((e) => e.kind === 'arrived') };
}

/** 같은 자리에서 t0부터 dur ms 뒤까지 30초 간격(마지막은 정확히 dur) */
function stay(t0: number, coord: LatLng, durMs: number, acc: number | null = 10): GpsSample[] {
  const out: GpsSample[] = [];
  for (let x = 0; x < durMs; x += 30 * SEC) out.push(smp(t0 + x, coord, acc));
  out.push(smp(t0 + durMs, coord, acc));
  return out;
}

test('도착: 반경 안 정확히 3분 0초면 도착, 2분 59.999초면 아니다', () => {
  const near = offsetCoord(A, 40, 0);
  assert.equal(run(stay(T0, near, ARRIVAL_DWELL_MS)).arrived.length, 1);
  assert.equal(run(stay(T0, near, ARRIVAL_DWELL_MS - 1)).arrived.length, 0);
});

test('도착: 정확도 50m 샘플은 쓰고 51m 샘플은 쓰지 않는다', () => {
  const near = offsetCoord(A, 20, 0);
  assert.equal(run(stay(T0, near, ARRIVAL_DWELL_MS, 50)).arrived.length, 1);
  assert.equal(run(stay(T0, near, ARRIVAL_DWELL_MS, 51)).arrived.length, 0);
  assert.equal(run(stay(T0, near, 10 * 60 * SEC, 50.5)).arrived.length, 0, '10분 머물러도 정확도 초과면 아니다');
});

test('도착: 반경 95m는 안, 105m는 밖이다', () => {
  const in95 = offsetCoord(A, 95, 0);
  const out105 = offsetCoord(A, 105, 0);
  assert.ok(distanceM(in95, A) < ARRIVAL_RADIUS_M && distanceM(out105, A) > ARRIVAL_RADIUS_M);
  assert.equal(run(stay(T0, in95, ARRIVAL_DWELL_MS)).arrived.length, 1);
  assert.equal(run(stay(T0, out105, 10 * 60 * SEC)).arrived.length, 0);
});

test('도착: 머무는 중 반경 밖(정확한 샘플)으로 나가면 머문 시간이 처음부터 다시 잰다', () => {
  const near = offsetCoord(A, 30, 0);
  const samples = [
    ...stay(T0, near, 2 * 60 * SEC),
    smp(T0 + 2 * 60 * SEC + 30 * SEC, offsetCoord(A, 300, 0)),
    ...stay(T0 + 3 * 60 * SEC, near, 2 * 60 * SEC),
  ];
  const r = run(samples);
  assert.equal(r.arrived.length, 0, '2분 + 2분은 이어진 3분이 아니다');
  const more = run(stay(T0 + 5 * 60 * SEC + 30 * SEC, near, 60 * SEC), r.tracker);
  assert.equal(more.arrived.length, 1, '다시 들어온 뒤 3분이 차면 도착');
  assert.equal(more.arrived[0].at, T0 + 3 * 60 * SEC, '도착 시각은 다시 들어온 시각');
});

test('도착: 중간의 정확도 초과 샘플(80m, 먼 좌표)은 판정에서 빠지고 머문 시간을 끊지 않는다', () => {
  const near = offsetCoord(A, 30, 0);
  const samples = [
    smp(T0, near),
    smp(T0 + 60 * SEC, near),
    smp(T0 + 90 * SEC, offsetCoord(A, 500, 0), 80),
    smp(T0 + 120 * SEC, near),
    smp(T0 + ARRIVAL_DWELL_MS, near),
  ];
  const r = run(samples);
  assert.equal(r.arrived.length, 1);
  assert.equal(r.arrived[0].at, T0);
});

/* ---------- 지연 ---------- */

test('지연: 14분은 조정안이 없고 15분부터 있다(경계는 이상)', async () => {
  assert.equal(isDelayed(14), false);
  assert.equal(isDelayed(15), true);
  assert.equal(delayMinutes(667, 667 + 14.99), 14);
  assert.equal(delayMinutes(667, 667 + 15), 15);
  assert.equal(delayMinutes(667, 660), 0, '앞서면 0');
  let made = 0;
  const make = async () => {
    made += 1;
    return [];
  };
  assert.equal(await proposeForDelay(14, make), null);
  assert.deepEqual(await proposeForDelay(15, make), []);
  assert.equal(made, 1);
});

function atA(): EngineState {
  return { ...initialEngine(), tracker: manualArrive(initialTracker(), day, 'a', at('09:25')).tracker };
}
const ctx = { tripId: day.tripId, day, prefs: DEFAULT_NOTIFY_PREFS, source: 'sim' as const };

test('지연: 불국사에 머무는 중, 예정 출발(10:55)보다 14분 늦게 있으면 없음, 15분이면 석굴암 조정안', () => {
  // ETA = max(지금, 10:55) + 12분. 예정 도착 11:07
  const t14 = evaluateAt(atA(), at('11:09'), ctx);
  assert.equal(t14.state.timing?.delayMin, 14);
  assert.equal(t14.effects.filter((e) => e.kind === 'delay').length, 0);
  const t15 = evaluateAt(atA(), at('11:10'), ctx);
  assert.equal(t15.state.timing?.delayMin, 15);
  const d = t15.effects.find((e) => e.kind === 'delay');
  assert.ok(d && d.kind === 'delay' && d.spotId === 'b' && d.delayMin === 15);
});

test('지연: 예정 출발 전에는 머무는 시간이 길어도 지연이 아니다(남은 체류를 줄여 맞춘다)', () => {
  const t = evaluateTiming(day, atA().tracker, at('10:50'));
  assert.equal(t?.phase, 'atSpot');
  assert.equal(t?.delayMin, 0);
});

test('지연: 위치를 모르는 수동 진행은 직전 예정 출발 + 이동 시간으로 잰다(15분 경계 같음)', () => {
  // 아무 곳도 도착하지 않은 상태에서 첫 스팟(불국사 09:25, 기점 출발 09:00 + 25분)
  const tr = initialTracker();
  assert.equal(evaluateTiming(day, tr, at('09:14'))?.delayMin, 14);
  assert.equal(evaluateTiming(day, tr, at('09:15'))?.delayMin, 15);
});

/* ---------- 빈 시간 ---------- */

const timing = (gapMin: number, over: Partial<Timing> = {}): Timing => ({
  nextIdx: 1,
  spotId: 'b',
  name: '석굴암',
  phase: 'moving',
  plannedArriveMin: 667,
  etaMin: 667 - gapMin,
  delayMin: 0,
  gapMin,
  betweenSpots: true,
  ...over,
});

test('빈 시간: 30분이면 참, 29분이면 거짓. 스팟에 머무는 중이거나 아직 떠나지 않았으면 거짓', () => {
  assert.equal(hasFreeTime(timing(30)), true);
  assert.equal(hasFreeTime(timing(29)), false);
  assert.equal(hasFreeTime(timing(60, { phase: 'atSpot' })), false);
  assert.equal(hasFreeTime(timing(60, { betweenSpots: false })), false);
  assert.equal(hasFreeTime(null), false);
});

const place = (id: string, coord: LatLng = A): Place => ({ placeId: id, name: id, coord, category: '카페' });

test('빈 시간: 추천은 2~3곳이다(4곳 이상이면 3곳, 1곳이면 생략)', () => {
  const five = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => place(id));
  assert.equal(pickFreeTime(30, 0, five)?.places.length, 3);
  assert.equal(pickFreeTime(30, 0, five.slice(0, 2))?.places.length, 2);
  assert.equal(pickFreeTime(30, 0, five.slice(0, 1)), null);
  assert.equal(pickFreeTime(29, 0, five), null);
});

test('빈 시간: 도보 반경 800m 밖 장소는 추천하지 않고, 기존 후보도 뺀다', async () => {
  const pos = offsetCoord(A, 0, 1500);
  const all = [
    place('near1', offsetCoord(pos, 200, 0)),
    place('near2', offsetCoord(pos, 0, 700)),
    place('cand', offsetCoord(pos, 100, 100)),
    place('far', offsetCoord(pos, 900, 0)),
  ];
  let asked: { radius: number; exclude: string[] } | undefined;
  const places = {
    async nearby(c: LatLng, radiusM: number, o: { excludePlaceIds?: string[]; limit?: number } = {}) {
      asked = { radius: radiusM, exclude: o.excludePlaceIds ?? [] };
      return all
        .filter((p) => !(o.excludePlaceIds ?? []).includes(p.placeId) && distanceM(c, p.coord) <= radiusM)
        .slice(0, o.limit ?? 20);
    },
  };
  const ft = await findFreeTime({ gapMin: 30, until: 0, position: pos, places, excludePlaceIds: ['cand'] });
  assert.equal(asked?.radius, WALKABLE_RADIUS_M);
  assert.deepEqual(ft?.places.map((p) => p.placeId).sort(), ['near1', 'near2']);
  assert.equal(await findFreeTime({ gapMin: 29, until: 0, position: pos, places, excludePlaceIds: [] }), null);
});

/* ---------- 지연 → 조정안(WP5 경계 × WP4 조정안) ---------- */

test('지연 15분 경계 × 실제 조정안: 14분이면 조정안 생성 함수를 부르지 않고, 40분이면 조정안을 내며 고정 스팟은 빼지 않는다', async () => {
  const deps: PlanDeps = {
    routes: createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() }),
    now: SCENARIO_T0,
  };
  const trip = scenarioTrip();
  const plan = await buildPlan(trip, deps);
  let calls = 0;
  const make = async (delayMin: number) => {
    calls += 1;
    const r = await replanForDelay(
      {
        trip,
        plan,
        date: '2026-10-18',
        now: SCENARIO_T0,
        position: scenarioPlace('gj-seokguram').coord,
        visitedSpotIds: ['s-gj-bulguksa', 's-gj-seokguram'],
        skippedSpotIds: [],
        delayMin,
      },
      deps,
    );
    return r.adjustments;
  };
  assert.equal(await proposeForDelay(14, make), null);
  assert.equal(calls, 0);
  const adj = await proposeForDelay(40, make);
  assert.equal(calls, 1);
  assert.ok(adj && adj.length > 0, '40분 지연이면 조정안이 있다');

  const pinned = new Set(trip.spots.filter((s) => s.pinned).map((s) => s.id));
  assert.ok(pinned.size > 0, '시나리오에는 고정 스팟(교촌마을 한정식)이 있다');
  for (const a of adj ?? []) {
    for (const d of a.ops) {
      if (d.type === 'spot/remove') assert.ok(!pinned.has(d.spotId), `${a.label}: 고정 스팟을 뺀다`);
    }
  }

  // 빼기 조정안을 적용하면 그 스팟은 '지연 조정안으로 뺌' 사유로 제외 목록에 보인다(조용히 사라지지 않는다)
  const ex = (adj ?? []).find((a) => a.kind === 'exclude');
  assert.ok(ex, '40분 지연이면 빼기 조정안이 있다');
  const after = await buildPlan(applyDrafts(trip, ex.ops, SCENARIO_T0 + 1), deps);
  const removed = ex.ops.filter((d) => d.type === 'spot/remove');
  assert.ok(removed.length > 0);
  for (const d of removed) {
    const e = after.excluded.find((x) => x.spotId === (d as { spotId: string }).spotId);
    assert.equal(e?.reasonCode, 'userRemoved');
    assert.equal(e?.reason, '지연 조정안으로 뺌');
  }
});
