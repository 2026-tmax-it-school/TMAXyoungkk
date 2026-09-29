import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Place } from '../src/types';
import { DEFAULT_NOTIFY_PREFS, FREE_TIME_MIN, WALKABLE_RADIUS_M } from '../src/core/constants';
import { initialTracker, manualArrive, stepArrival } from '../src/core/live/arrival';
import type { LiveDay } from '../src/core/live/context';
import { evaluateAt, initialEngine, type EngineState } from '../src/core/live/engine';
import { findFreeTime, pickFreeTime } from '../src/core/live/freetime';
import { offsetCoord } from '../src/core/sim/track';
import { atKst } from '../src/core/util';

/**
 * FR-604 빈 시간 추천(3차, WP5). 다음 일정까지 30분 이상이면 도보 반경(800m, 가정)에서 2~3곳, 29분이면 없음,
 * 주변 결과가 없으면 생략하고 아무것도 보이지 않는다.
 */

const A: LatLng = { latitude: 35.8296, longitude: 129.2148 };
const B: LatLng = offsetCoord(A, 0, 1500);
const at = (hhmm: string) => atKst('2026-10-18', hhmm);
const day: LiveDay = {
  tripId: 't1',
  date: '2026-10-18',
  dayStartMs: atKst('2026-10-18', '00:00'),
  startMin: 540,
  base: null,
  items: [
    // 교촌마을 한정식 12:57–13:57, 다음 스팟 14:10(이동 13분)
    { spotId: 'a', name: '교촌마을 한정식', coord: A, arriveMin: 777, departMin: 837, travelMin: 13, transport: 'car' },
    { spotId: 'b', name: '국립경주박물관', coord: B, arriveMin: 850, departMin: 940, travelMin: 13, transport: 'car' },
  ],
};
const ctx = { tripId: 't1', day, prefs: DEFAULT_NOTIFY_PREFS, source: 'sim' as const };

const place = (id: string): Place => ({ placeId: id, name: id, coord: A, category: '카페' });

/** A에 도착했다가 반경을 벗어난 상태(이동 중) */
function leftA(): EngineState {
  let tr = manualArrive(initialTracker(), day, 'a', at('12:57')).tracker;
  tr = stepArrival(tr, { t: at('13:05'), coord: offsetCoord(A, 0, 200), accuracyM: 10 }, day).tracker;
  assert.equal(tr.current?.left, true);
  return { ...initialEngine(), tracker: tr };
}

test('30분이면 2~3곳, 29분이면 없다', () => {
  const three = [place('p1'), place('p2'), place('p3'), place('p4')];
  assert.equal(FREE_TIME_MIN, 30);
  assert.equal(pickFreeTime(30, 0, three)?.places.length, 3);
  assert.equal(pickFreeTime(30, 0, three.slice(0, 2))?.places.length, 2);
  assert.equal(pickFreeTime(29, 0, three), null);
});

test('주변 결과가 없거나 1곳뿐이면 추천을 생략한다', () => {
  assert.equal(pickFreeTime(45, 0, []), null);
  assert.equal(pickFreeTime(45, 0, [place('p1')]), null);
});

test('findFreeTime은 도보 반경 800m로 nearby를 부르고 기존 후보를 뺀다', async () => {
  const calls: { radius: number; exclude?: string[]; limit?: number }[] = [];
  const places = {
    async nearby(_c: LatLng, radius: number, opts?: { excludePlaceIds?: string[]; limit?: number }) {
      calls.push({ radius, exclude: opts?.excludePlaceIds, limit: opts?.limit });
      return [place('p1'), place('p2')];
    },
  };
  const r = await findFreeTime({ gapMin: 35, until: 1, position: A, places, excludePlaceIds: ['gj-museum'] });
  assert.equal(r?.places.length, 2);
  assert.equal(WALKABLE_RADIUS_M, 800);
  assert.deepEqual(calls, [{ radius: 800, exclude: ['gj-museum'], limit: 3 }]);
  // 29분이면 조회하지도 않는다
  await findFreeTime({ gapMin: 29, until: 1, position: A, places, excludePlaceIds: [] });
  assert.equal(calls.length, 1);
});

test('주변 조회가 비거나 실패하면 null(표시 없음)', async () => {
  const empty = { nearby: async () => [] as Place[] };
  assert.equal(await findFreeTime({ gapMin: 40, until: 1, position: A, places: empty, excludePlaceIds: [] }), null);
  const broken = {
    nearby: async (): Promise<Place[]> => {
      throw new Error('offline');
    },
  };
  assert.equal(await findFreeTime({ gapMin: 40, until: 1, position: A, places: broken, excludePlaceIds: [] }), null);
});

test('스팟을 떠나 이동 중이고 다음 일정까지 30분 이상이면 빈 시간 효과가 나온다', () => {
  const st = leftA();
  // 13:05, A에서 200m. 남은 이동 약 13×(1300/1500)≈11분 → ETA 13:16, 예정 14:10 → 54분
  const r = evaluateAt(st, at('13:05'), ctx, offsetCoord(A, 0, 200));
  const ft = r.effects.find((e) => e.kind === 'freeTime');
  assert.ok(ft && ft.kind === 'freeTime');
  assert.ok(ft.gapMin >= 30);
  assert.equal(ft.until, at('14:10'));
});

test('다음 일정까지 29분이면 빈 시간 효과가 없다', () => {
  const st = leftA();
  // 위치를 A 바로 옆에 두면 남은 이동은 약 13분. 13:28이면 ETA 13:41 → 예정 14:10까지 29분
  const pos = offsetCoord(A, 0, 1);
  const r29 = evaluateAt(st, at('13:28'), ctx, pos);
  assert.equal(r29.state.timing?.gapMin, 29);
  assert.equal(r29.effects.filter((e) => e.kind === 'freeTime').length, 0);
  const r30 = evaluateAt(st, at('13:27'), ctx, pos);
  assert.equal(r30.state.timing?.gapMin, 30);
  assert.equal(r30.effects.filter((e) => e.kind === 'freeTime').length, 1);
});

test('스팟에 머무는 중이거나 위치를 모르면 빈 시간을 찾지 않는다', () => {
  const staying = { ...initialEngine(), tracker: manualArrive(initialTracker(), day, 'a', at('12:57')).tracker };
  assert.equal(evaluateAt(staying, at('13:00'), ctx, A).effects.filter((e) => e.kind === 'freeTime').length, 0);
  assert.equal(evaluateAt(leftA(), at('13:05'), ctx).effects.filter((e) => e.kind === 'freeTime').length, 0);
});

test('notifyPrefs.freeTime이 꺼져 있으면 없다', () => {
  const r = evaluateAt(leftA(), at('13:05'), { ...ctx, prefs: { ...DEFAULT_NOTIFY_PREFS, freeTime: false } }, offsetCoord(A, 0, 200));
  assert.equal(r.effects.filter((e) => e.kind === 'freeTime').length, 0);
});
