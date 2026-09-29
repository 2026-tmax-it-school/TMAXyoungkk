import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Spot, Trip } from '../src/types';
import type { RouteProvider } from '../src/core/ports';
import { buildPlan } from '../src/core/planner';
import { bestOrder, heldKarp, nearestTwoOpt, tourCost, type OrderInput } from '../src/core/planner/order';
import { createLocalRoutes } from '../src/services/routes';
import { seededRng } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * FR-501 순서 최적화. 10개 이하는 Held-Karp 정확해(orderMethod exact), 11개 이상은 NN+2-opt 근사(approx),
 * 수동 순서가 있는 날은 manual. 경로 제공자가 던지거나 null이면 직선거리 대체와 estimated.
 */

function randomInput(seed: number, n: number, mode: 'cycle' | 'path' | 'free'): OrderInput {
  const rng = seededRng(seed);
  const pts = Array.from({ length: n + 1 }, () => [rng.float() * 100, rng.float() * 100]);
  // 비대칭 비용(일방통행 흉내)
  const skew = Array.from({ length: n + 1 }, () => Array.from({ length: n + 1 }, () => rng.float() * 5));
  const d = (a: number, b: number) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) + skew[a][b];
  return {
    n,
    start: (j) => (mode === 'free' ? 0 : d(n, j)),
    end: (j) => (mode === 'cycle' ? d(j, n) : 0),
    step: (i, j) => d(i, j),
  };
}

function bruteBest(inp: OrderInput): number {
  const idx = Array.from({ length: inp.n }, (_, i) => i);
  let best = Infinity;
  const perm = (arr: number[], k: number) => {
    if (k === arr.length) {
      best = Math.min(best, tourCost(arr, inp));
      return;
    }
    for (let i = k; i < arr.length; i += 1) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      perm(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  perm(idx, 0);
  return best;
}

test('8개 이하 무작위 100회: Held-Karp가 완전탐색 최적값과 같다(복귀 있음 순환, 복귀 없음 경로, 기점 없음)', () => {
  const modes = ['cycle', 'path', 'free'] as const;
  for (let seed = 1; seed <= 100; seed += 1) {
    const n = 1 + (seed % 8);
    const mode = modes[seed % 3];
    const inp = randomInput(seed, n, mode);
    const order = heldKarp(inp);
    assert.equal(order.length, n);
    assert.equal(new Set(order).size, n);
    assert.ok(Math.abs(tourCost(order, inp) - bruteBest(inp)) < 1e-9, `seed ${seed} n ${n} ${mode}`);
  }
});

test('10개 이하는 exact, 11개 이상은 approx이고 근사도 모든 스팟을 한 번씩 돈다', () => {
  assert.equal(bestOrder(randomInput(1, 10, 'cycle')).method, 'exact');
  const big = randomInput(2, 12, 'cycle');
  const r = bestOrder(big);
  assert.equal(r.method, 'approx');
  assert.equal(new Set(r.order).size, 12);
  // 근사는 최근접 이웃만 쓴 것보다 나쁘지 않다
  assert.ok(tourCost(nearestTwoOpt(big), big) <= tourCost(r.order, big) + 1e-9);
});

const CENTER: LatLng = { latitude: 35.8562, longitude: 129.2247 };

function gridTrip(n: number, extra: (s: Spot, i: number) => Spot = (s) => s): Trip {
  const t = scenarioTrip();
  const spots: Spot[] = Array.from({ length: n }, (_, i) =>
    extra(
      {
        id: `g${String(i).padStart(2, '0')}`,
        placeId: `g${i}`,
        name: `격자${i}`,
        category: '카페',
        coord: { latitude: CENTER.latitude + (i % 4) * 0.004, longitude: CENTER.longitude + Math.floor(i / 4) * 0.004 },
        proposals: [{ memberId: 'm-minji', source: 'manual', at: i }],
        pinned: false,
        stayMin: 10,
        createdAt: i,
        edited: {},
      },
      i,
    ),
  );
  return {
    ...t,
    endDate: t.startDate,
    days: [{ date: t.startDate, base: { name: '숙소', coord: CENTER }, noReturn: false, dayStart: '08:00', dayEnd: '23:00' }],
    spots,
  };
}

const emptyLocal = () => createLocalRoutes({ table: { car: {}, walk: {}, transit: {} }, places: [] });

test('buildPlan: 하루 10곳이면 exact, 12곳이면 approx', async () => {
  const p10 = await buildPlan(gridTrip(10), { routes: emptyLocal(), now: 0 });
  assert.equal(p10.days[0].items.length, 10);
  assert.equal(p10.days[0].orderMethod, 'exact');
  const p12 = await buildPlan(gridTrip(12), { routes: emptyLocal(), now: 0 });
  assert.equal(p12.days[0].items.length, 12);
  assert.equal(p12.days[0].orderMethod, 'approx');
});

test('수동 순서가 있는 날은 manual이고 사용자 순서를 바꾸지 않는다', async () => {
  const want = ['g04', 'g00', 'g03', 'g01', 'g02'];
  const trip = gridTrip(5, (s) => ({ ...s, manualOrder: { date: '2026-10-17', index: want.indexOf(s.id) } }));
  const p = await buildPlan(trip, { routes: emptyLocal(), now: 0 });
  assert.equal(p.days[0].orderMethod, 'manual');
  assert.deepEqual(
    p.days[0].items.map((i) => i.spotId),
    want,
  );
  assert.ok(p.days[0].items.every((i) => i.manual));
});

test('경로 제공자가 던지면 직선거리로 대체하고 estimated를 세운다', async () => {
  const broken: RouteProvider = {
    id: 'local',
    matrix: async () => {
      throw new Error('down');
    },
    route: async () => {
      throw new Error('down');
    },
    clearCache: async () => {},
  };
  const p = await buildPlan(gridTrip(4), { routes: broken, now: 0 });
  assert.equal(p.days[0].items.length, 4);
  assert.equal(p.estimated, true);
  assert.ok(p.days[0].items.every((i) => i.legEstimated));
  assert.ok(p.days[0].items.some((i) => i.notices.some((n) => n.kind === 'estimated')));
});

test('자동차 경로가 없으면(null) 도보로 대체 계산하고 fallbackTransport를 단다', async () => {
  const noCar: RouteProvider = {
    id: 'local',
    matrix: async (o, d, t) => ({
      minutes: o.map(() => d.map(() => (t === 'car' ? null : 7))),
      calls: o.length * d.length,
      cacheHits: 0,
      estimated: false,
    }),
    route: async () => null,
    clearCache: async () => {},
  };
  const p = await buildPlan(gridTrip(3), { routes: noCar, now: 0 });
  const it = p.days[0].items[0];
  assert.equal(it.legTransport, 'walk');
  assert.ok(it.notices.some((n) => n.kind === 'fallbackTransport'));
  assert.equal(p.estimated, true);
});
