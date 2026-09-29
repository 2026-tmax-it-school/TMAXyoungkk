import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Plan, Trip } from '../src/types';
import { toMin } from '../src/core/util';
import { SCENARIO_EXPECTED } from '../src/data/scenario';
import { runScenario } from '../src/demo/scenarioRunner';
import { createExtractionProvider } from '../src/services/extraction';
import { createPlaceProvider } from '../src/services/places';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV, seqIds } from './helpers/fakes';
import { SCENARIO_T0 } from './helpers/fixtures';

/**
 * 골든 e2e(기반 소유). 채팅 13줄 → 추출 → 사용자 조작 → buildPlan이 HANDOFF 수치를 재현한다.
 * WP3(추출)·WP4(계획)·WP1(runScenario)이 채운 뒤 통합 게이트에서 todo를 풀었다. 미통과는 병합 불가다.
 * 키 없는 로컬 제공자만 쓴다(키가 없으면 local, 시나리오 구간표 우선).
 */

async function run(): Promise<{ trip: Trip; plan: Plan }> {
  const clock = fixedClock(SCENARIO_T0);
  const fetch = fakeFetch(() => ({ status: 500, body: '키 없는 테스트에서 네트워크를 쓰면 안 된다' }));
  const { trip, plan } = await runScenario({
    ids: seqIds(),
    clock,
    places: createPlaceProvider({ fetch }),
    extraction: createExtractionProvider({ fetch }),
    routes: createRouteProvider({ fetch, clock, kv: memoryKV() }),
  });
  assert.equal(fetch.calls.length, 0, '로컬 제공자는 네트워크를 쓰지 않는다');
  return { trip, plan };
}

function summary(trip: Trip, plan: Plan) {
  const nameOf = (id: string) => trip.spots.find((s) => s.id === id)?.name;
  return {
    candidates: trip.spots.length,
    confirmed: plan.days.reduce((n, d) => n + d.items.length, 0),
    excluded: plan.excluded
      .map((e) => ({ name: nameOf(e.spotId), code: e.reasonCode, reason: e.reason, nearestDate: e.nearestDate }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

test(
  '시나리오 골든: 후보 14 · 확정 11 · 제외 3과 10/18 타임라인, 두 번 돌려도 같다',
  async () => {
    const first = await run();
    const s = summary(first.trip, first.plan);
    assert.equal(s.candidates, SCENARIO_EXPECTED.totals.candidates);
    assert.equal(s.confirmed, SCENARIO_EXPECTED.totals.confirmed);
    assert.equal(s.excluded.length, SCENARIO_EXPECTED.totals.excluded);

    const expectedExcluded = SCENARIO_EXPECTED.candidates
      .filter((c) => c.result === 'excluded')
      .map((c) => ({ name: c.name, code: c.reasonCode, reason: c.reason, nearestDate: c.nearestDate }))
      .sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(s.excluded, expectedExcluded);

    // 제안자 수 4/3/2
    const count = (name: string) =>
      new Set(first.trip.spots.find((x) => x.name === name)?.proposals.map((p) => p.memberId)).size;
    assert.equal(count('황리단길'), 4);
    assert.equal(count('불국사'), 3);
    assert.equal(count('석굴암'), 2);

    const day = first.plan.days.find((d) => d.date === SCENARIO_EXPECTED.day1018.date);
    assert.ok(day, '10/18 계획');
    assert.equal(day.startMin, toMin(SCENARIO_EXPECTED.day1018.start));
    const head = day.items.slice(0, 3).map((i) => ({ name: i.name, arrive: i.arrive, depart: i.depart, travel: i.travelMin }));
    assert.deepEqual(
      head,
      SCENARIO_EXPECTED.timeline1018.map((t) => ({
        name: SCENARIO_EXPECTED.candidates.find((c) => c.placeId === t.placeId)?.name,
        arrive: t.arrive,
        depart: t.depart,
        travel: t.travelMin,
      })),
    );
    assert.equal(day.items.length, SCENARIO_EXPECTED.day1018.count);
    const last = day.items[day.items.length - 1];
    assert.ok(toMin(last.depart) <= toMin(SCENARIO_EXPECTED.day1018.endBy), `마지막 출발 ${last.depart}`);
    assert.equal(day.items.find((i) => i.name === '교촌마을 한정식')?.pinned, true);

    const second = await run();
    assert.deepEqual(summary(second.trip, second.plan), s);
  },
);
