import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Spot, Transport, Trip } from '../src/types';
import { EXACT_ORDER_MAX, ROUTE_CACHE_TTL_MS, ROUTE_CALL_BUDGET } from '../src/core/constants';
import type { RouteProvider, TravelMatrix } from '../src/core/ports';
import { buildPlan } from '../src/core/planner';
import { bestOrder, heldKarp, tourCost, type OrderInput } from '../src/core/planner/order';
import { sameCoord } from '../src/core/planner/estimate';
import { applyDrafts } from '../src/core/planner/preview';
import { addDays } from '../src/core/util';
import { createLocalRoutes, createRouteCache } from '../src/services/routes';
import { fixedClock, memoryKV, seededRng } from './helpers/fakes';

/**
 * QA(로직): FR-501 루트 정렬과 비기능 경로 비용.
 * - 하루 10곳 이하는 정확해(완전탐색 최적과 같은 비용), 11곳 이상은 근사(모든 스팟을 한 번씩).
 * - 재계산 1회당 경로 조회 100구간 이하. 캐시에서 나온 구간은 세지 않는다.
 * - 동일 구간은 24시간 캐시. 24시간 정각까지는 캐시, 1ms 지나면 다시 조회한다.
 * 조회 수는 계획이 알려 주는 routeCalls만 믿지 않고, 안쪽 제공자에 실제로 들어온 구간을 따로 센다.
 */

test('명세 수치: 정확해 상한 10곳, 경로 조회 100구간, 캐시 24시간', () => {
  assert.equal(EXACT_ORDER_MAX, 10);
  assert.equal(ROUTE_CALL_BUDGET, 100);
  assert.equal(ROUTE_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
});

/* ---------- 정렬 ---------- */

function randomInput(seed: number, n: number, loop: boolean): OrderInput {
  const rng = seededRng(seed);
  const pts = Array.from({ length: n + 1 }, () => [rng.float() * 100, rng.float() * 100]);
  const skew = Array.from({ length: n + 1 }, () => Array.from({ length: n + 1 }, () => rng.float() * 8));
  const d = (a: number, b: number) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) + skew[a][b];
  return { n, start: (j) => d(n, j), end: (j) => (loop ? d(j, n) : 0), step: d };
}

/** 완전탐색(힙 알고리즘). n=10이면 약 363만 순열 */
function bruteBest(inp: OrderInput): number {
  const a = Array.from({ length: inp.n }, (_, i) => i);
  const c = new Array(inp.n).fill(0);
  let best = tourCost(a, inp);
  let i = 0;
  while (i < inp.n) {
    if (c[i] < i) {
      const k = i % 2 === 0 ? 0 : c[i];
      [a[k], a[i]] = [a[i], a[k]];
      const v = tourCost(a, inp);
      if (v < best) best = v;
      c[i] += 1;
      i = 0;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
  return best;
}

test('정확해: 9곳(순환·경로)과 10곳에서 Held-Karp 비용이 완전탐색 최적과 같다', () => {
  for (const [seed, n, loop] of [
    [31, 9, true],
    [32, 9, false],
    [33, 10, true],
  ] as const) {
    const inp = randomInput(seed, n, loop);
    const r = bestOrder(inp);
    assert.equal(r.method, 'exact', `${n}곳`);
    assert.equal(new Set(r.order).size, n);
    assert.ok(Math.abs(tourCost(r.order, inp) - bruteBest(inp)) < 1e-9, `seed ${seed} ${n}곳`);
    assert.deepEqual(r.order, heldKarp(inp));
  }
});

test('경계: 10곳은 exact, 11곳은 approx이고 근사도 11곳을 한 번씩 돈다', () => {
  assert.equal(bestOrder(randomInput(40, 10, true)).method, 'exact');
  for (let seed = 41; seed <= 45; seed += 1) {
    const inp = randomInput(seed, 11, seed % 2 === 0);
    const r = bestOrder(inp);
    assert.equal(r.method, 'approx');
    assert.deepEqual([...r.order].sort((x, y) => x - y), Array.from({ length: 11 }, (_, i) => i));
  }
});

const CENTER: LatLng = { latitude: 35.8562, longitude: 129.2247 };
const START = '2026-11-02';

function spot(i: number, coord: LatLng, extra: Partial<Spot> = {}): Spot {
  return {
    id: `q${String(i).padStart(2, '0')}`,
    placeId: `qp${i}`,
    name: `스팟${i}`,
    category: '카페',
    coord,
    proposals: [{ memberId: `m${i % 3}`, source: 'chat', at: i }],
    pinned: false,
    stayMin: 10,
    createdAt: 1000 + i * 60_000,
    edited: {},
    ...extra,
  };
}

function trip(spots: Spot[], nDays = 1, transport: Transport = 'car', dayEnd = '23:00'): Trip {
  const dates = Array.from({ length: nDays }, (_, i) => addDays(START, i));
  return {
    id: 'qa-route',
    title: 'QA',
    region: 'gyeongju',
    startDate: START,
    endDate: dates[dates.length - 1],
    transport,
    dayStart: '08:00',
    dayEnd,
    days: dates.map((date, i) => ({ date, base: i === 0 ? { name: '숙소', coord: CENTER } : 'inherit', noReturn: false })),
    legs: [],
    members: [],
    spots,
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 0,
    createdBy: 'u',
    lastSeq: 0,
  };
}

const grid = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    spot(i, { latitude: CENTER.latitude + (i % 4) * 0.003, longitude: CENTER.longitude + Math.floor(i / 4) * 0.003 }),
  );
const emptyLocal = () => createLocalRoutes({ table: { car: {}, walk: {}, transit: {} }, places: [] });

test('buildPlan 경계: 하루 10곳이면 exact, 11곳이면 approx이고 확정 스팟은 모두 시간표에 있다', async () => {
  const p10 = await buildPlan(trip(grid(10)), { routes: emptyLocal(), now: 0 });
  assert.equal(p10.days[0].items.length, 10);
  assert.equal(p10.days[0].orderMethod, 'exact');
  const p11 = await buildPlan(trip(grid(11)), { routes: emptyLocal(), now: 0 });
  assert.equal(p11.days[0].items.length, 11);
  assert.equal(p11.days[0].orderMethod, 'approx');
});

/* ---------- 경로 호출 예산과 캐시 ---------- */

/** 안쪽 제공자에 실제로 들어온 구간 수(같은 지점 쌍 제외)를 센다 */
function counting(inner: RouteProvider): RouteProvider & { segments: number } {
  const self = {
    id: inner.id,
    segments: 0,
    async matrix(o: LatLng[], d: LatLng[], t: Transport): Promise<TravelMatrix> {
      for (const a of o) for (const b of d) if (!sameCoord(a, b)) self.segments += 1;
      return inner.matrix(o, d, t);
    },
    route: inner.route,
    clearCache: inner.clearCache,
  };
  return self;
}

function randomTrip(seed: number): Trip {
  const rng = seededRng(seed);
  const r = () => rng.float();
  const n = 14 + Math.floor(r() * 17); // 14~30곳
  const spots = Array.from({ length: n }, (_, i) =>
    spot(i, { latitude: CENTER.latitude + (r() - 0.5) * 0.35, longitude: CENTER.longitude + (r() - 0.5) * 0.35 }, {
      stayMin: 30 + Math.floor(r() * 4) * 20,
      proposals: Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => ({ memberId: `m${k}`, source: 'chat' as const, at: i })),
    }),
  );
  return trip(spots, 2 + Math.floor(r() * 3), r() < 0.7 ? 'car' : 'walk', '20:00');
}

test('예산: 스팟 14~30곳 무작위 20회, 첫 계산도 안쪽 제공자 조회가 100구간 이하이고 routeCalls와 같다', async () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const inner = counting(emptyLocal());
    const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(inner);
    const plan = await buildPlan(randomTrip(seed), { routes, now: 0 });
    assert.ok(inner.segments <= ROUTE_CALL_BUDGET, `seed ${seed}: ${inner.segments}구간`);
    assert.equal(plan.routeCalls, inner.segments, `seed ${seed}: routeCalls가 실제 조회와 다르다`);
  }
});

test('예산: 편집 뒤 재계산도 1회당 100구간 이하이고, 캐시에서 나온 구간은 세지 않는다', async () => {
  const clock = fixedClock(0);
  const inner = counting(emptyLocal());
  const routes = createRouteCache({ clock, kv: memoryKV() }).wrap(inner);
  const t0 = randomTrip(7);
  await buildPlan(t0, { routes, now: 0 });
  const before = inner.segments;
  // 체류를 바꾸고 새 스팟을 더해 배치가 달라지게 한다
  const edited = applyDrafts(t0, [{ type: 'schedule/setStay', spotId: t0.spots[0].id, stayMin: 200 }], 1);
  const withNew = { ...edited, spots: [...edited.spots, spot(99, { latitude: CENTER.latitude + 0.05, longitude: CENTER.longitude - 0.05 })] };
  clock.advance(60_000);
  const again = await buildPlan(withNew, { routes, now: clock.now() });
  const delta = inner.segments - before;
  assert.ok(delta <= ROUTE_CALL_BUDGET, `재계산 ${delta}구간`);
  assert.equal(again.routeCalls, delta);
  assert.ok(again.cacheHits > 0, '앞 계산에서 받은 구간은 캐시에서 나온다');
});

test('캐시: 24시간 정각까지는 안쪽 제공자를 부르지 않고, 24시간 + 1ms면 다시 부른다', async () => {
  const clock = fixedClock(1_000_000);
  const inner = counting(emptyLocal());
  const routes = createRouteCache({ clock, kv: memoryKV() }).wrap(inner);
  const a = CENTER;
  const b: LatLng = { latitude: CENTER.latitude + 0.02, longitude: CENTER.longitude };
  const first = await routes.matrix([a], [b], 'car');
  assert.equal(first.calls, 1);
  assert.equal(inner.segments, 1);

  clock.advance(ROUTE_CACHE_TTL_MS);
  const cached = await routes.matrix([a], [b], 'car');
  assert.equal(cached.calls, 0);
  assert.equal(cached.cacheHits, 1);
  assert.equal(inner.segments, 1);
  assert.deepEqual(cached.minutes, first.minutes);

  clock.advance(1);
  const expired = await routes.matrix([a], [b], 'car');
  assert.equal(expired.calls, 1);
  assert.equal(inner.segments, 2);
});

test('캐시: 구간은 수단과 방향별이다(자동차 A→B 캐시가 도보 A→B나 자동차 B→A를 대신하지 않는다)', async () => {
  const inner = counting(emptyLocal());
  const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(inner);
  const a = CENTER;
  const b: LatLng = { latitude: CENTER.latitude + 0.02, longitude: CENTER.longitude };
  await routes.matrix([a], [b], 'car');
  await routes.matrix([a], [b], 'walk');
  await routes.matrix([b], [a], 'car');
  assert.equal(inner.segments, 3);
  await routes.matrix([a, b], [b, a], 'car');
  assert.equal(inner.segments, 3, '아는 두 구간은 캐시, 같은 지점 쌍은 조회하지 않는다');
});

test('캐시: 새로 만든 캐시(새로고침)도 같은 KV면 24시간 안의 구간을 다시 묻지 않는다', async () => {
  const clock = fixedClock(0);
  const kv = memoryKV();
  const inner1 = counting(emptyLocal());
  const t = randomTrip(3);
  const p1 = await buildPlan(t, { routes: createRouteCache({ clock, kv }).wrap(inner1), now: 0 });
  assert.ok(inner1.segments > 0);
  clock.advance(ROUTE_CACHE_TTL_MS - 1);
  const inner2 = counting(emptyLocal());
  const p2 = await buildPlan(t, { routes: createRouteCache({ clock, kv }).wrap(inner2), now: clock.now() });
  assert.equal(inner2.segments, 0);
  assert.equal(p2.routeCalls, 0);
  assert.deepEqual(p2.excluded, p1.excluded);
  assert.deepEqual(
    p2.days.map((d) => d.items.map((i) => i.spotId)),
    p1.days.map((d) => d.items.map((i) => i.spotId)),
  );
});
