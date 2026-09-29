import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import { RECOMPUTE_MS, ROUTE_CACHE_TTL_MS, ROUTE_CALL_BUDGET } from '../src/core/constants';
import type { RouteProvider } from '../src/core/ports';
import { buildPlan } from '../src/core/planner';
import { createLocalRoutes, createRouteCache, createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * 비기능: 재계산 1회 경로 조회 100구간 이하, 동일 구간 24시간 캐시, 루트 재계산 3초 이내.
 */

test('시나리오 첫 계산은 100구간 이하, 같은 입력을 24시간 안에 다시 계산하면 0구간', async () => {
  const clock = fixedClock(SCENARIO_T0);
  const kv = memoryKV();
  const routes = createRouteProvider({ fetch: fakeFetch(), clock, kv });
  const first = await buildPlan(scenarioTrip(), { routes, now: clock.now() });
  assert.ok(first.routeCalls > 0);
  assert.ok(first.routeCalls <= ROUTE_CALL_BUDGET, `첫 계산 ${first.routeCalls}구간`);
  assert.equal(first.cacheHits, 0);

  clock.advance(ROUTE_CACHE_TTL_MS);
  const second = await buildPlan(scenarioTrip(), { routes, now: clock.now() });
  assert.equal(second.routeCalls, 0, '24시간 정각까지는 캐시');
  assert.ok(second.cacheHits > 0);
  assert.deepEqual(second.excluded, first.excluded);

  // 새로고침(같은 KV로 제공자를 새로 만든다) 뒤에도 캐시가 남는다
  const reopened = createRouteProvider({ fetch: fakeFetch(), clock, kv });
  const third = await buildPlan(scenarioTrip(), { routes: reopened, now: clock.now() });
  assert.equal(third.routeCalls, 0);
});

test('캐시는 구간을 받은 시각부터 24시간이고, 1초 지나면 다시 조회한다', async () => {
  const clock = fixedClock(SCENARIO_T0);
  const routes = createRouteProvider({ fetch: fakeFetch(), clock, kv: memoryKV() });
  const first = await buildPlan(scenarioTrip(), { routes, now: clock.now() });
  clock.advance(ROUTE_CACHE_TTL_MS + 1000);
  const again = await buildPlan(scenarioTrip(), { routes, now: clock.now() });
  assert.equal(again.routeCalls, first.routeCalls);
});

test('clearCache 뒤에는 다시 조회한다', async () => {
  const clock = fixedClock(SCENARIO_T0);
  const routes = createRouteProvider({ fetch: fakeFetch(), clock, kv: memoryKV() });
  const first = await buildPlan(scenarioTrip(), { routes, now: clock.now() });
  await routes.clearCache();
  const again = await buildPlan(scenarioTrip(), { routes, now: clock.now() });
  assert.equal(again.routeCalls, first.routeCalls);
});

test('캐시 단위는 구간이다: 행렬 요청 중 아는 구간은 cacheHits, 모르는 구간만 안쪽에 묻는다', async () => {
  const clock = fixedClock(0);
  const inner = createLocalRoutes({ table: { car: {}, walk: {}, transit: {} }, places: [] });
  let innerCalls = 0;
  const counting: RouteProvider = {
    ...inner,
    matrix: async (o, d, t) => {
      const m = await inner.matrix(o, d, t);
      innerCalls += m.calls;
      return m;
    },
  };
  const cached = createRouteCache({ clock, kv: memoryKV() }).wrap(counting);
  const pts: LatLng[] = [0, 1, 2].map((i) => ({ latitude: 35.8 + i * 0.01, longitude: 129.2 }));
  const a = await cached.matrix([pts[0]], [pts[1], pts[2]], 'car');
  assert.deepEqual([a.calls, a.cacheHits], [2, 0]);
  const b = await cached.matrix([pts[0], pts[1]], [pts[1], pts[2]], 'car');
  // (0→1),(0→2)는 캐시, (1→1)은 같은 지점, (1→2)만 새로
  assert.deepEqual([b.calls, b.cacheHits], [1, 2]);
  assert.equal(innerCalls, 3);
  const c = await cached.matrix([pts[0]], [pts[1]], 'walk');
  assert.equal(c.calls, 1, '수단이 다르면 다른 구간');
});

test('스팟 14곳 재계산은 RECOMPUTE_MS(3초) 안에 끝난다', async () => {
  const clock = fixedClock(SCENARIO_T0);
  const routes = createRouteProvider({ fetch: fakeFetch(), clock, kv: memoryKV() });
  const trip = scenarioTrip();
  assert.equal(trip.spots.length, 14);
  const t0 = performance.now();
  await buildPlan(trip, { routes, now: clock.now() });
  const ms = performance.now() - t0;
  assert.ok(ms < RECOMPUTE_MS, `${ms.toFixed(0)}ms`);
  // 도보(더 많은 제외·교환)도 같은 예산 안이다
  const t1 = performance.now();
  await buildPlan({ ...trip, transport: 'walk' }, { routes, now: clock.now() });
  assert.ok(performance.now() - t1 < RECOMPUTE_MS);
});

test('onStep은 실제 단계(위치 확인 → 이동시간 조회 → 배치 N/M → 제외 사유)를 순서대로 알린다', async () => {
  const clock = fixedClock(SCENARIO_T0);
  const routes = createRouteProvider({ fetch: fakeFetch(), clock, kv: memoryKV() });
  const seen: string[] = [];
  const plan = await buildPlan(scenarioTrip(), {
    routes,
    now: clock.now(),
    onStep: (s) => {
      if (seen[seen.length - 1] !== s.key) seen.push(s.key);
    },
  });
  assert.deepEqual([...new Set(seen)], ['locate', 'matrix', 'allocate', 'reasons']);
  const alloc = plan.steps.find((s) => s.key === 'allocate');
  assert.equal(alloc?.label, '배치 14/14');
  const reasons = plan.steps.find((s) => s.key === 'reasons');
  assert.deepEqual([reasons?.done, reasons?.total], [3, 3]);
});

test('조회값이 직선거리 추정보다 길어도(실제 제공자) 고정 없는 날은 넘치지 않는다: 마지막 조회 뒤 한 번 더 배치한다', async () => {
  const { estimateMinutes } = await import('../src/core/planner/estimate');
  // 모든 구간을 추정의 1.6배로 돌려주는 가짜 제공자
  const slow: RouteProvider = {
    id: 'local',
    async matrix(o, d, t) {
      const minutes = o.map((a) => d.map((b) => (a.latitude === b.latitude && a.longitude === b.longitude ? 0 : Math.round(estimateMinutes(a, b, t) * 1.6))));
      return { minutes, calls: o.length * d.length, cacheHits: 0, estimated: false };
    },
    async route() {
      return null;
    },
    async clearCache() {},
  };
  const trip = scenarioTrip();
  const p = await buildPlan(trip, { routes: slow, now: 0 });
  const forced = (id: string) => {
    const s = trip.spots.find((x) => x.id === id);
    return !!s && (s.pinned || (!!s.fixedDate && s.fixedDate >= trip.startDate && s.fixedDate <= trip.endDate));
  };
  for (const d of p.days) {
    if (d.overMin > 0) assert.ok(d.items.some((it) => forced(it.spotId)), `${d.date}: 고정 없이 ${d.overMin}분 넘는다`);
  }
  assert.ok(p.routeCalls <= ROUTE_CALL_BUDGET);
});

test('08 단계 시간: 배치 중 추가 조회 시간은 이동시간 조회 단계에 더하고 0으로 덮어쓰지 않는다', async () => {
  const clock = fixedClock(SCENARIO_T0);
  const inner = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
  // 조회 한 번에 시계가 5ms 간다
  const ticking: RouteProvider = {
    ...inner,
    async matrix(o, d, t) {
      clock.advance(5);
      return inner.matrix(o, d, t);
    },
  };
  const p = await buildPlan(scenarioTrip(), { routes: ticking, now: 0, clock });
  const matrix = p.steps.find((s) => s.key === 'matrix');
  const allocate = p.steps.find((s) => s.key === 'allocate');
  assert.ok(matrix && matrix.ms > 0, '이동시간 조회 시간이 남는다');
  assert.ok(allocate && allocate.ms >= 0);
  const total = p.steps.reduce((n, s) => n + s.ms, 0);
  assert.ok(total <= clock.now() - SCENARIO_T0, '단계 시간 합은 전체 시간을 넘지 않는다');
});
