import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GpsSample, LatLng } from '../src/types';
import {
  cancelArrival,
  initialTracker,
  isRemaining,
  manualArrive,
  nextIndex,
  stepArrival,
  type ArrivalEvent,
  type ArrivalTracker,
} from '../src/core/live/arrival';
import type { LiveDay } from '../src/core/live/context';
import {
  cancelArrivalEngine,
  engineAppPhase,
  ingestSample,
  initialEngine,
  LAST_SAMPLE_MAX_AGE_MS,
  tickAt,
  visitId,
} from '../src/core/live/engine';
import { offsetCoord } from '../src/core/sim/track';
import { DEFAULT_NOTIFY_PREFS } from '../src/core/constants';
import { atKst } from '../src/core/util';

/**
 * FR-602 도착 감지(WP5). 50m 이하 샘플만, 반경 100m 안 3분 이상, 수동 취소, 지나침 → 건너뜀.
 */

const A: LatLng = { latitude: 35.7901, longitude: 129.332 };
const B: LatLng = offsetCoord(A, 0, 2000);
const C: LatLng = offsetCoord(A, 0, 4000);
const DAY0 = atKst('2026-10-18', '00:00');
const T0 = atKst('2026-10-18', '09:25');

const day: LiveDay = {
  tripId: 't1',
  date: '2026-10-18',
  dayStartMs: DAY0,
  startMin: 540,
  base: offsetCoord(A, -3000, 0),
  items: [
    { spotId: 'a', name: '불국사', coord: A, arriveMin: 565, departMin: 655, travelMin: 25, transport: 'car' },
    { spotId: 'b', name: '석굴암', coord: B, arriveMin: 667, departMin: 757, travelMin: 12, transport: 'car' },
    { spotId: 'c', name: '교촌마을 한정식', coord: C, arriveMin: 777, departMin: 837, travelMin: 20, transport: 'car' },
  ],
};

const s = (t: number, coord: LatLng, accuracyM: number | null = 12): GpsSample => ({ t, coord, accuracyM });

/** t0부터 stepSec 간격으로 durSec 동안 같은 자리에 머무는 샘플 */
function dwell(t0: number, coord: LatLng, durSec: number, accuracyM: number | null = 12, stepSec = 30): GpsSample[] {
  const out: GpsSample[] = [];
  for (let x = 0; x <= durSec; x += stepSec) out.push(s(t0 + x * 1000, coord, accuracyM));
  return out;
}

function run(samples: GpsSample[], tr: ArrivalTracker = initialTracker()): { tracker: ArrivalTracker; events: ArrivalEvent[] } {
  let cur = tr;
  const events: ArrivalEvent[] = [];
  for (const x of samples) {
    const r = stepArrival(cur, x, day);
    cur = r.tracker;
    events.push(...r.events);
  }
  return { tracker: cur, events };
}

test('반경 100m 안에 3분 머물면 도착이고, 도착 시각은 반경에 들어온 시각이다', () => {
  const r = run(dwell(T0, offsetCoord(A, 30, 0), 180));
  assert.equal(r.tracker.statuses.a, 'arrived');
  const ev = r.events.find((e) => e.kind === 'arrived');
  assert.deepEqual(ev, { kind: 'arrived', spotId: 'a', at: T0 });
});

test('2분 59초는 도착이 아니다', () => {
  const samples = [s(T0, A), s(T0 + 90_000, A), s(T0 + 179_000, A)];
  const r = run(samples);
  assert.equal(r.tracker.statuses.a, undefined);
  assert.equal(r.events.length, 0);
  // 1초 더 머물면 도착
  const r2 = run([s(T0 + 180_000, A)], r.tracker);
  assert.equal(r2.tracker.statuses.a, 'arrived');
});

test('정확도 50m 초과 샘플(80m)은 판정에서 빠진다', () => {
  const r = run(dwell(T0, A, 600, 80));
  assert.equal(r.tracker.statuses.a, undefined);
  // 경계: 50m 샘플은 쓴다
  const r2 = run(dwell(T0, A, 180, 50));
  assert.equal(r2.tracker.statuses.a, 'arrived');
});

test('정확도를 모르는 샘플(웹 null)도 판정에서 빠지고 음영으로 세지 않는다', () => {
  const r = run(dwell(T0, A, 600, null));
  assert.equal(r.tracker.statuses.a, undefined);
  assert.equal(r.tracker.shadow, false);
});

test('옆 건물(120m)에 5분 머물러도 도착이 아니다', () => {
  const door = offsetCoord(A, 120, 0);
  const r = run(dwell(T0, door, 300, 10));
  assert.equal(r.tracker.statuses.a, undefined);
  assert.equal(r.events.length, 0);
});

test('수동 취소하면 cancelled가 되고 그 스팟이 다시 남은 일정이 된다', () => {
  const r = run(dwell(T0, A, 180));
  assert.equal(nextIndex(r.tracker, day), 1);
  const cancelled = cancelArrival(r.tracker, 'a');
  assert.equal(cancelled.statuses.a, 'cancelled');
  assert.equal(isRemaining(cancelled, 'a'), true);
  assert.equal(nextIndex(cancelled, day), 0, '취소한 스팟이 다시 다음 목적지다');
  // 반경 안에 그대로 있어도 곧바로 다시 잡지 않는다
  const still = run(dwell(T0 + 240_000, A, 300), cancelled);
  assert.equal(still.tracker.statuses.a, 'cancelled');
  // 반경을 벗어났다가 돌아와 3분 머물면 다시 도착
  const away = run([s(T0 + 600_000, offsetCoord(A, 500, 0))], still.tracker);
  const back = run(dwell(T0 + 700_000, A, 180), away.tracker);
  assert.equal(back.tracker.statuses.a, 'arrived');
});

test('지나친 뒤 다음 스팟에 도착하면 앞 스팟은 건너뜀이다', () => {
  // A를 1분만 지나가고 B에 3분 머문다
  const pass = [s(T0, A), s(T0 + 60_000, offsetCoord(A, 0, 300))];
  const r = run([...pass, ...dwell(T0 + 600_000, B, 180)]);
  assert.equal(r.tracker.statuses.a, 'skipped');
  assert.equal(r.tracker.statuses.b, 'arrived');
  const kinds = r.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['skipped', 'arrived']);
});

test('수동 도착 처리(권한 거부 모드)도 앞 스팟을 건너뜀으로 둔다', () => {
  const r = manualArrive(initialTracker(), day, 'b', T0);
  assert.equal(r.tracker.statuses.a, 'skipped');
  assert.equal(r.tracker.statuses.b, 'arrived');
});

test('정확도 초과가 연속 3샘플이면 GPS 음영 안내, 정확한 샘플이 오면 끈다', () => {
  const bad = [s(T0, A, 120), s(T0 + 30_000, A, 120)];
  const r2 = run(bad);
  assert.equal(r2.tracker.shadow, false, '2샘플은 아직 아니다');
  const r3 = run([s(T0 + 60_000, A, 120)], r2.tracker);
  assert.equal(r3.tracker.shadow, true);
  assert.deepEqual(r3.events.map((e) => e.kind), ['shadowOn']);
  const ok = run([s(T0 + 90_000, A, 10)], r3.tracker);
  assert.equal(ok.tracker.shadow, false);
  assert.equal(ok.events[0].kind, 'shadowOff');
});

test('엔진은 도착을 journal/visit 효과로 내고 같은 날·스팟·멤버는 같은 visit id다', () => {
  const ctx = { tripId: 't1', day, prefs: DEFAULT_NOTIFY_PREFS, source: 'sim' as const };
  let st = initialEngine();
  const effects = [];
  for (const x of dwell(T0, A, 180)) {
    const r = ingestSample(st, x, ctx);
    st = r.state;
    effects.push(...r.effects);
  }
  const visits = effects.filter((e) => e.kind === 'visit');
  assert.equal(visits.length, 1);
  assert.equal(visits[0].kind === 'visit' && visits[0].status, 'arrived');
  assert.ok(effects.some((e) => e.kind === 'arrivalNotice'));
  assert.equal(visitId('2026-10-18', 'a', 'm1'), visitId('2026-10-18', 'a', 'm1'));
  const c = cancelArrivalEngine(st, 'a');
  assert.equal(c.tracker.statuses.a, 'cancelled');
});

test('도착 알림은 prefs.arrival이 꺼져 있으면 내지 않는다(기록은 그대로)', () => {
  const ctx = { tripId: 't1', day, prefs: { ...DEFAULT_NOTIFY_PREFS, arrival: false }, source: 'sim' as const };
  let st = initialEngine();
  const kinds: string[] = [];
  for (const x of dwell(T0, A, 180)) {
    const r = ingestSample(st, x, ctx);
    st = r.state;
    kinds.push(...r.effects.map((e) => e.kind));
  }
  assert.ok(kinds.includes('visit'));
  assert.equal(kinds.includes('arrivalNotice'), false);
});

/* ---------- 리뷰 반영(04 코드리뷰) ---------- */

test('취소한 스팟을 두고 다음 스팟에 도착하면 앞 스팟은 건너뜀이고, 다음 목적지는 그 뒤다', () => {
  let tr = manualArrive(initialTracker(), day, 'a', T0).tracker;
  tr = cancelArrival(tr, 'a');
  assert.equal(tr.suppressed, 'a');
  const r = manualArrive(tr, day, 'b', T0 + 60 * 60_000);
  assert.equal(r.tracker.statuses.a, 'skipped');
  assert.equal(r.tracker.statuses.b, 'arrived');
  assert.deepEqual(r.events.map((e) => e.kind), ['skipped', 'arrived']);
  assert.equal(r.tracker.suppressed, undefined, '건너뜀이 된 스팟의 재감지 막음도 푼다');
  assert.equal(nextIndex(r.tracker, day), 2, '지나온 A가 아니라 C가 다음 목적지다');
  // GPS 도착으로 B에 들어가도 같다
  const g = run(dwell(T0 + 60 * 60_000, B, 180), tr);
  assert.equal(g.tracker.statuses.a, 'skipped');
  assert.equal(nextIndex(g.tracker, day), 2);
});

test('머무는 스팟 반경 안에서는 순서가 뒤인 옆 스팟(30m)을 도착으로 잡지 않는다', () => {
  const X = A;
  const Y = offsetCoord(A, 30, 0);
  const near: LiveDay = {
    ...day,
    items: [
      { spotId: 'x', name: '교촌마을 한정식', coord: X, arriveMin: 565, departMin: 625, travelMin: 25, transport: 'car' },
      { spotId: 'z', name: '월정교', coord: C, arriveMin: 640, departMin: 700, travelMin: 10, transport: 'car' },
      { spotId: 'y', name: '교리김밥', coord: Y, arriveMin: 715, departMin: 745, travelMin: 10, transport: 'car' },
    ],
  };
  let tr = initialTracker();
  // X와 Y 사이(Y 쪽으로 조금 치우친 자리)에서 20분 머문다
  const spot = offsetCoord(A, 18, 0);
  for (let x = 0; x <= 20 * 60; x += 30) tr = stepArrival(tr, s(T0 + x * 1000, spot), near).tracker;
  assert.equal(tr.statuses.x, 'arrived');
  assert.equal(tr.statuses.y, undefined, '옆 스팟이 저절로 도착되지 않는다');
  assert.equal(tr.statuses.z, undefined, '사이 스팟이 건너뜀이 되지 않는다');
});

test('머무는 스팟 반경 안이어도 순서상 다음 스팟 쪽으로 옮겨 3분 머물면 그 스팟 도착이다', () => {
  const X = A;
  const Y = offsetCoord(A, 60, 0);
  const pair: LiveDay = {
    ...day,
    items: [
      { spotId: 'x', name: '황리단길', coord: X, arriveMin: 565, departMin: 625, travelMin: 25, transport: 'walk' },
      { spotId: 'y', name: '황남빵', coord: Y, arriveMin: 630, departMin: 660, travelMin: 2, transport: 'walk' },
    ],
  };
  let tr = initialTracker();
  for (let x = 0; x <= 600; x += 30) tr = stepArrival(tr, s(T0 + x * 1000, X), pair).tracker;
  assert.equal(tr.statuses.x, 'arrived');
  for (let x = 0; x <= 180; x += 30) tr = stepArrival(tr, s(T0 + 700_000 + x * 1000, Y), pair).tracker;
  assert.equal(tr.statuses.y, 'arrived');
});

test('샘플이 끊겨도 시계가 흐르면(tickAt) 마지막 위치로 3분 머묾을 재 도착한다. 5분 넘게 끊긴 샘플은 믿지 않는다', () => {
  const ctx = { tripId: 't1', day, prefs: DEFAULT_NOTIFY_PREFS, source: 'device' as const };
  const entered = ingestSample(initialEngine(), s(T0, A), ctx).state;
  assert.equal(entered.tracker.candidate?.spotId, 'a');
  const early = tickAt(entered, T0 + 179_000, ctx);
  assert.equal(early.state.tracker.statuses.a, undefined);
  const ok = tickAt(early.state, T0 + 180_000, ctx);
  assert.equal(ok.state.tracker.statuses.a, 'arrived');
  const v = ok.effects.find((e) => e.kind === 'visit');
  assert.ok(v && v.kind === 'visit' && v.arrivedAt === T0, '도착 시각은 반경에 들어온 시각');
  assert.equal(ok.effects.some((e) => e.kind === 'track'), false, '시계 판정은 위치 로그를 남기지 않는다');
  const stale = tickAt(entered, T0 + LAST_SAMPLE_MAX_AGE_MS + 1000, ctx);
  assert.equal(stale.state.tracker.statuses.a, undefined);
});

test('정확도를 모르는 샘플이 연속 3개면 정확도 모름 안내를 켜고, 정확한 샘플이 오면 끈다', () => {
  const r2 = run([s(T0, A, null), s(T0 + 30_000, A, null)]);
  assert.equal(r2.tracker.accuracyUnknown ?? false, false);
  const r3 = run([s(T0 + 60_000, A, null)], r2.tracker);
  assert.equal(r3.tracker.accuracyUnknown, true);
  assert.deepEqual(r3.events.map((e) => e.kind), ['unknownOn']);
  const ok = run([s(T0 + 90_000, A, 10)], r3.tracker);
  assert.equal(ok.tracker.accuracyUnknown, false);
  assert.equal(ok.events[0].kind, 'unknownOff');
  const ctx = { tripId: 't1', day, prefs: DEFAULT_NOTIFY_PREFS, source: 'device' as const };
  let st = initialEngine();
  const kinds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const r = ingestSample(st, s(T0 + i * 30_000, A, null), ctx);
    st = r.state;
    kinds.push(...r.effects.map((e) => e.kind));
  }
  assert.ok(kinds.includes('accuracyUnknown'));
});

test('앱으로 돌아오면 꺼지기 전 반경 진입 기록을 버린다(꺼진 동안 머문 시간을 채우지 않는다)', () => {
  const ctx = { tripId: 't1', day, prefs: DEFAULT_NOTIFY_PREFS, source: 'device' as const };
  let st = ingestSample(initialEngine(), s(T0, A), ctx).state;
  st = engineAppPhase(st, 'background', T0 + 10_000).state;
  st = engineAppPhase(st, 'active', T0 + 20 * 60_000).state;
  assert.equal(st.tracker.candidate, undefined);
  const one = ingestSample(st, s(T0 + 20 * 60_000 + 1000, A), ctx);
  assert.equal(one.state.tracker.statuses.a, undefined, '돌아와 샘플 하나로는 도착이 아니다');
  let cur = one.state;
  for (let x = 30; x <= 180; x += 30) cur = ingestSample(cur, s(T0 + 20 * 60_000 + 1000 + x * 1000, A), ctx).state;
  assert.equal(cur.tracker.statuses.a, 'arrived');
});
