import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Plan, Trip } from '../src/types';
import { buildPlan } from '../src/core/planner';
import { createRouteProvider } from '../src/services/routes';
import { SCENARIO_EXPECTED } from '../src/data/scenario';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * 골든(HANDOFF 부록 B). scenarioTrip + createRouteProvider(키 없음 → 로컬, 시나리오 구간표 우선)로
 * 자동차 계획을 만들면 후보 14 · 확정 11 · 제외 3과 10/18 앞 세 곳 시각이 정확히 나온다.
 */

async function plan(trip: Trip = scenarioTrip()): Promise<Plan> {
  const routes = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
  return buildPlan(trip, { routes, now: SCENARIO_T0 });
}

const confirmedIds = (p: Plan) => p.days.flatMap((d) => d.items.map((i) => i.spotId));

test('후보 14 · 확정 11 · 제외 3', async () => {
  const p = await plan();
  assert.equal(scenarioTrip().spots.length, SCENARIO_EXPECTED.totals.candidates);
  assert.equal(confirmedIds(p).length, SCENARIO_EXPECTED.totals.confirmed);
  assert.equal(p.excluded.length, SCENARIO_EXPECTED.totals.excluded);
  assert.equal(p.overCapacity.length, 0);
});

test('제외 3곳의 이름·사유 코드·문장·가장 가까운 날짜', async () => {
  const p = await plan();
  for (const c of SCENARIO_EXPECTED.candidates.filter((x) => x.result === 'excluded')) {
    const e = p.excluded.find((x) => x.spotId === `s-${c.placeId}`);
    assert.ok(e, `${c.name}이 제외되어야 한다`);
    assert.equal(e.name, c.name);
    assert.equal(e.reasonCode, c.reasonCode);
    assert.equal(e.reason, c.reason);
    assert.equal(e.nearestDate, c.nearestDate);
    assert.equal(e.proposerCount, c.proposers.length);
  }
});

test('확정 스팟과 배치 날짜가 부록 B와 같다', async () => {
  const p = await plan();
  const ids = new Set(confirmedIds(p));
  for (const c of SCENARIO_EXPECTED.candidates.filter((x) => x.result === 'confirmed')) {
    assert.ok(ids.has(`s-${c.placeId}`), `${c.name}이 확정되어야 한다`);
    if (c.date) {
      const day = p.days.find((d) => d.items.some((i) => i.spotId === `s-${c.placeId}`));
      assert.equal(day?.date, c.date, `${c.name} 날짜`);
    }
  }
});

test('10/18: 09:00 출발 → 불국사 09:25–10:55 → 석굴암 11:07–12:37 → 교촌마을 한정식 12:57–13:57, 7곳 21:00 안', async () => {
  const p = await plan();
  const d = p.days.find((x) => x.date === SCENARIO_EXPECTED.day1018.date);
  assert.ok(d);
  assert.equal(d.startMin, 9 * 60);
  SCENARIO_EXPECTED.timeline1018.forEach((t, i) => {
    const it = d.items[i];
    assert.equal(it.spotId, `s-${t.placeId}`);
    assert.equal(it.arrive, t.arrive);
    assert.equal(it.depart, t.depart);
    assert.equal(it.travelMin, t.travelMin);
  });
  assert.equal(d.items.length, SCENARIO_EXPECTED.day1018.count);
  assert.ok(d.startMin + d.usedMin <= 21 * 60, '복귀까지 21:00 안');
  assert.equal(d.overMin, 0);
  const gyochon = d.items.find((i) => i.spotId === 's-gj-gyochon-hanjeongsik');
  assert.equal(gyochon?.pinned, true);
  assert.equal(d.orderMethod, 'exact');
});

test('두 번 계산해도 같다(결정성)', async () => {
  const a = await plan();
  const b = await plan();
  assert.deepEqual(
    a.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
    b.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
  );
  assert.deepEqual(a.excluded, b.excluded);
});

test('도보로 바꾸면 제외가 늘어난다', async () => {
  const car = await plan();
  const walk = await plan({ ...scenarioTrip(), transport: 'walk' });
  assert.ok(walk.excluded.length > car.excluded.length, `도보 제외 ${walk.excluded.length} > 자동차 ${car.excluded.length}`);
  // 조용한 제외는 없다
  for (const e of walk.excluded) assert.ok(e.reason.length > 0);
});
