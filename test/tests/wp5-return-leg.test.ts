import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DayPlan } from '../src/types';
import type { RouteLeg } from '../src/core/ports';
import { buildPlan } from '../src/core/planner';
import { coordLookup, dayLegs, legGeometryKey, legShape } from '../src/core/map/model';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { fixturePlan1018, scenarioTrip } from './helpers/fixtures';

/**
 * 지도·길찾기의 복귀 구간(마지막 스팟 → 기점, WP5, 2026-10-09 리뷰 반영).
 * 복귀 구간의 수단과 추정 여부는 계획의 DayPlan.returnLeg 값이다(구간 지정, 경로 없음 대체 수단, 직선 추정).
 * 예전에는 마지막 도착 구간의 수단과 estimated:false를 붙여 13 길찾기의 '추정' 칩이 빠지고 다른 수단의 선을 그렸다.
 */

const trip = scenarioTrip();
const coordOf = coordLookup(trip);

function withReturn(returnLeg: DayPlan['returnLeg']): DayPlan {
  const d = fixturePlan1018();
  return returnLeg ? { ...d, returnLeg } : { ...d, returnLeg: undefined };
}

const lastLeg = (day: DayPlan) => {
  const legs = dayLegs(day, coordOf, trip.transport);
  const ret = legs[legs.length - 1];
  assert.equal(ret.toId, 'base');
  return ret;
};

test('복귀 구간은 계획의 returnLeg 수단·추정 여부를 쓴다(선 모양 키도 그 수단이다)', () => {
  const day = withReturn({ transport: 'walk', estimated: true, notices: [] });
  const ret = lastLeg(day);
  assert.equal(ret.transport, 'walk');
  assert.equal(ret.estimated, true, "13 길찾기의 '추정' 칩이 붙는다");
  assert.equal(ret.key, legGeometryKey(ret.from, ret.to, 'walk'), '그 수단의 경로 모양을 받는다');
  assert.equal(ret.minutes, day.returnMin);
  // 추정 구간에 길 모양이 없으면 직선이다(FR-802 예외)
  const straight: RouteLeg = { transport: 'walk', minutes: 20, meters: 1500, polyline: [ret.from, ret.to], steps: [], estimated: true };
  assert.deepEqual(legShape(ret, straight), [ret.from, ret.to]);

  const real = lastLeg(withReturn({ transport: 'transit', estimated: false, notices: [] }));
  assert.deepEqual([real.transport, real.estimated], ['transit', false]);
});

test('returnLeg가 없는 예전 계획은 마지막 도착 구간 수단이고 추정이 아니다', () => {
  const day = withReturn(undefined);
  const ret = lastLeg(day);
  assert.equal(ret.transport, day.items[day.items.length - 1].legTransport);
  assert.equal(ret.estimated, false);
});

test('실제 계획: 복귀 구간이 직선 추정이면 지도 구간도 추정이고, 구간 지정 수단이면 그 수단이다', async () => {
  // 길 서버가 늘 503이라 표에 없는 구간은 직선 추정(임시)이다
  const routes = createRouteProvider({ fetch: fakeFetch(() => ({ status: 503, body: {} })), clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const plan = await buildPlan(trip, { routes, now: 0 });
  const days = plan.days.filter((d) => d.returnLeg && d.items.length > 0 && !d.noReturn);
  assert.ok(days.length > 0);
  for (const d of days) {
    const ret = lastLeg(d);
    assert.equal(ret.transport, d.returnLeg?.transport, d.date);
    assert.equal(ret.estimated, d.returnLeg?.estimated, d.date);
  }

  // 복귀 구간을 대중교통으로 지정하면 지도 구간도 대중교통이다(마지막 도착 구간은 자동차 그대로)
  const day = days[0];
  const legs = trip.spots.map((s) => ({ date: day.date, fromId: s.id, toId: 'base', transport: 'transit' as const }));
  const trip2 = { ...trip, legs: [...(trip.legs ?? []), ...legs] };
  const plan2 = await buildPlan(trip2, { routes, now: 0 });
  const d2 = plan2.days.find((d) => d.date === day.date);
  assert.ok(d2 && d2.items.length > 0);
  assert.equal(d2.returnLeg?.transport, 'transit');
  const ret2 = dayLegs(d2, coordLookup(trip2), trip2.transport).find((l) => l.toId === 'base');
  assert.equal(ret2?.transport, 'transit');
  assert.equal(ret2?.estimated, true, '대중교통은 모의 모델이라 언제나 추정');
});
