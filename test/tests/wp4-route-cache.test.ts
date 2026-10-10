import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { LatLng, Transport } from '../src/types';
import type { RouteLeg, RouteProvider, TravelMatrix } from '../src/core/ports';
import { buildPlan } from '../src/core/planner';
import { compareLeg } from '../src/core/planner/legs';
import { SCENARIO_ROUTE_TABLE } from '../src/data/scenario-tuning';
import { scenarioPlace } from '../src/data/scenario';
import { createLocalRoutes, createRouteCache, createRouteProvider, routeCacheSignature } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV, type FakeFetchCall } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * 경로 캐시(WP4, 2026-10-09 리뷰 반영).
 * - 색인 형식 v:2와 제공자 서명. 도로 모양·카카오 방식·예시 구간표가 바뀌면 예전 항목(길 모양 없이 낸 직선 추정 등)을 버린다
 * - clearCache() 중에 진행 중이던 요청이 끝나도 지운 항목이 되살아나지 않는다
 * - 같은 구간을 동시에 물으면 안쪽 제공자에는 한 번만 묻는다(대중교통 선이 빌리는 자동차 모양도 캐시를 거친다)
 * - 추정 표시는 칸마다다(목적지 여럿을 한 번에 물어도 실제 시간 칸은 추정이 아니다)
 * - 앱은 캐시 시계로 실제 시계(systemClock)를 넘긴다
 * 네트워크는 쓰지 않는다.
 */

// 예시 데이터 구간표에 없는 경주 시내 점들
const A: LatLng = { latitude: 35.8301, longitude: 129.2101 };
const B: LatLng = { latitude: 35.8352, longitude: 129.2203 };
const C: LatLng = { latitude: 35.8401, longitude: 129.2301 };

const isTable = (c: FakeFetchCall) => c.url.includes('/table/v1/');
const okTable = (n = 1) => ({ body: { code: 'Ok', durations: [Array.from({ length: n }, () => 600)], distances: [Array.from({ length: n }, () => 1000)] } });
const routeBody = {
  code: 'Ok',
  routes: [{ distance: 1500, duration: 300, geometry: { coordinates: [[A.longitude, A.latitude], [129.215, 35.832], [B.longitude, B.latitude]] }, legs: [] }],
};

/** 안쪽 제공자. 행렬·경로 호출을 세고, gate를 열 때까지 답을 미룰 수 있다 */
function slowLocal() {
  const local = createLocalRoutes();
  let open!: () => void;
  let gate: Promise<void> = Promise.resolve();
  const self = {
    id: 'local' as const,
    matrixCalls: 0,
    routeCalls: 0,
    fail: false,
    hold() {
      gate = new Promise<void>((r) => (open = r));
    },
    release() {
      open();
    },
    async matrix(o: LatLng[], d: LatLng[], t: Transport): Promise<TravelMatrix> {
      self.matrixCalls += 1;
      await gate;
      if (self.fail) throw new Error('안쪽 실패');
      return local.matrix(o, d, t);
    },
    async route(a: LatLng, b: LatLng, t: Transport): Promise<RouteLeg | null> {
      self.routeCalls += 1;
      await gate;
      return local.route(a, b, t);
    },
    async clearCache() {},
  };
  return self;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('서명: 길 모양 없이 낸 직선 추정은 같은 KV라도 도로 모양을 켠 제공자가 쓰지 않는다. 같은 설정이면 새로 만들어도 캐시에서 나온다', async () => {
  const kv = memoryKV();
  const clock = fixedClock(0);
  const before = createRouteProvider({ fetch: fakeFetch(), clock, kv });
  const m0 = await before.matrix([A], [B], 'walk');
  assert.equal(m0.estimated, true, '도로 모양을 끈 제공자는 직선 추정');

  const f = fakeFetch(() => okTable());
  const after = createRouteProvider({ fetch: f, clock, kv, roadShapes: {} });
  const m1 = await after.matrix([A], [B], 'walk');
  assert.equal(f.calls.filter(isTable).length, 1, '예전 직선 추정을 쓰지 않고 길 서버에 묻는다');
  assert.deepEqual([m1.minutes[0][0], m1.estimated, m1.cacheHits], [10, false, 0]);

  const g = fakeFetch(() => okTable());
  const again = createRouteProvider({ fetch: g, clock, kv, roadShapes: {} });
  const m2 = await again.matrix([A], [B], 'walk');
  assert.equal(g.calls.length, 0, '같은 설정이면 새로고침 뒤에도 캐시');
  assert.deepEqual([m2.minutes[0][0], m2.cacheHits], [10, 1]);
});

test('서명: 도로 모양 켬·주소, 카카오 방식, 예시 구간표가 바뀌면 달라진다. 카카오 키 값은 들어가지 않는다', () => {
  const API = 'https://api.example.test';
  const sigs = [
    routeCacheSignature({}),
    routeCacheSignature({ roadShapes: {} }),
    routeCacheSignature({ roadShapes: { baseUrl: 'https://osrm.mine.test' } }),
    routeCacheSignature({ apiUrl: API, roadShapes: {} }),
    routeCacheSignature({ apiUrl: API }),
    routeCacheSignature({ kakaoKey: 'SECRET-KEY' }),
    routeCacheSignature({ kakaoKey: 'SECRET-KEY', roadShapes: {} }),
  ];
  assert.equal(new Set(sigs).size, sigs.length, sigs.join(' '));
  assert.equal(routeCacheSignature({ roadShapes: {} }), routeCacheSignature({ roadShapes: {} }), '같은 설정은 같은 서명');
  assert.equal(routeCacheSignature({ kakaoKey: 'SECRET-KEY' }), routeCacheSignature({ kakaoKey: 'OTHER-KEY' }), '키 값이 아니라 방식만 본다');
  for (const s of sigs) assert.equal(s.includes('SECRET'), false);

  const row = SCENARIO_ROUTE_TABLE.walk;
  const before = routeCacheSignature({});
  row['x-test>y-test'] = 5;
  try {
    assert.notEqual(routeCacheSignature({}), before, '예시 구간표가 바뀌면 다른 서명');
  } finally {
    delete row['x-test>y-test'];
  }
  assert.equal(routeCacheSignature({}), before);
});

test('색인 v:1이나 다른 서명의 색인은 버린다(예전 항목을 쓰지 않는다)', async () => {
  const kv = memoryKV();
  const key = `walk|${A.latitude.toFixed(5)},${A.longitude.toFixed(5)}>${B.latitude.toFixed(5)},${B.longitude.toFixed(5)}`;
  await kv.set('index', JSON.stringify({ v: 1, m: { [key]: { at: 0, m: 999, est: false } }, r: {} }));
  const inner = slowLocal();
  const m = await createRouteCache({ clock: fixedClock(0), kv, signature: 's1' }).wrap(inner).matrix([A], [B], 'walk');
  assert.notEqual(m.minutes[0][0], 999);
  assert.equal(inner.matrixCalls, 1);
  assert.match((await kv.get('index')) ?? '', /"v":2/);

  const same = slowLocal();
  await createRouteCache({ clock: fixedClock(0), kv, signature: 's1' }).wrap(same).matrix([A], [B], 'walk');
  assert.equal(same.matrixCalls, 0, '같은 서명이면 쓴다');
  const other = slowLocal();
  await createRouteCache({ clock: fixedClock(0), kv, signature: 's2' }).wrap(other).matrix([A], [B], 'walk');
  assert.equal(other.matrixCalls, 1, '서명이 다르면 버린다');
});

test('받은 시각이 지금보다 뒤인 항목(시계가 되돌아감)은 지난 것으로 본다', async () => {
  const clock = fixedClock(1_000_000);
  const inner = slowLocal();
  const routes = createRouteCache({ clock, kv: memoryKV() }).wrap(inner);
  await routes.matrix([A], [B], 'walk');
  clock.set(0);
  await routes.matrix([A], [B], 'walk');
  assert.equal(inner.matrixCalls, 2);
});

test('clearCache: 진행 중이던 행렬·경로 요청이 끝나도 지운 항목이 KV에 되살아나지 않고, 그 답은 새 캐시에 두지 않는다', async () => {
  const kv = memoryKV();
  const inner = slowLocal();
  const routes = createRouteCache({ clock: fixedClock(0), kv }).wrap(inner);
  await routes.route(A, C, 'walk');
  assert.ok((await kv.get('index'))?.includes(C.latitude.toFixed(5)));

  inner.hold();
  const pendingMatrix = routes.matrix([A], [B], 'walk');
  const pendingRoute = routes.route(B, C, 'walk');
  await tick();
  await routes.clearCache();
  assert.equal(await kv.get('index'), null);
  inner.release();
  await pendingMatrix;
  await pendingRoute;
  await tick();
  const raw = await kv.get('index');
  assert.equal(raw?.includes(C.latitude.toFixed(5)) ?? false, false, '지운 경로가 되살아나지 않는다');

  const calls = inner.matrixCalls;
  await routes.matrix([A], [B], 'walk');
  assert.equal(inner.matrixCalls, calls + 1, 'clear 전에 시작한 답은 새 캐시에 없다');
  await routes.matrix([A], [B], 'walk');
  assert.equal(inner.matrixCalls, calls + 1, '새로 받은 답은 캐시된다');
});

test('같은 구간을 동시에 물으면 안쪽에는 한 번만 묻고 답을 나눠 쓴다(나눠 받은 구간은 cacheHits). 실패도 같이 받고 다음에 다시 묻는다', async () => {
  const inner = slowLocal();
  const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(inner);
  inner.hold();
  const p1 = routes.matrix([A], [B, C], 'walk');
  await tick();
  const p2 = routes.matrix([A], [C], 'walk');
  const r1 = routes.route(A, B, 'car');
  const r2 = routes.route(A, B, 'car');
  await tick();
  inner.release();
  const [m1, m2, l1, l2] = await Promise.all([p1, p2, r1, r2]);
  assert.equal(inner.matrixCalls, 1);
  assert.equal(inner.routeCalls, 1);
  assert.deepEqual([m1.calls, m1.cacheHits], [2, 0]);
  assert.deepEqual([m2.calls, m2.cacheHits], [0, 1]);
  assert.equal(m2.minutes[0][0], m1.minutes[0][1]);
  assert.deepEqual(l1, l2);

  const failing = slowLocal();
  const r = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(failing);
  failing.hold();
  failing.fail = true;
  const q1 = r.matrix([A], [B], 'walk');
  await tick();
  const q2 = r.matrix([A], [B], 'walk');
  failing.release();
  await assert.rejects(q1);
  await assert.rejects(q2, '같이 기다리던 요청도 실패한다');
  failing.fail = false;
  const ok = await r.matrix([A], [B], 'walk');
  assert.equal(failing.matrixCalls, 2, '실패한 구간은 다음에 다시 묻는다');
  assert.equal(ok.calls, 1);
});

test('미리보기 계획 두 개를 동시에 계산해도 같은 구간은 길 서버에 한 번만 묻는다(두 계획의 호출 수 합 = 계획 하나)', async () => {
  const tableFetch = () =>
    fakeFetch((c) => {
      const u = new URL(c.url);
      const n = (u.searchParams.get('destinations') ?? '').split(';').length;
      return isTable(c) ? okTable(n) : { status: 404, body: {} };
    });
  const trip = scenarioTrip();
  const single = tableFetch();
  const one = await buildPlan(trip, { routes: createRouteProvider({ fetch: single, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} }), now: 0 });

  const f = tableFetch();
  const routes = createRouteProvider({ fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const [p1, p2] = await Promise.all([buildPlan(trip, { routes, now: 0 }), buildPlan(trip, { routes, now: 0 })]);
  assert.equal(f.calls.length, single.calls.length, `동시 ${f.calls.length}건, 하나 ${single.calls.length}건`);
  assert.equal(p1.routeCalls + p2.routeCalls, one.routeCalls);
  assert.deepEqual(
    p2.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
    p1.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
  );
});

test('구간 비교: 자동차·도보 길 모양을 한 번씩 묻고, 대중교통 추정은 길 서버에 묻지 않는다(직선). 다시 열면 요청이 없다', async () => {
  const f = fakeFetch(() => ({ body: routeBody }));
  const routes = createRouteProvider({ fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const options = await compareLeg(routes, A, B, 'car');
  const paths = f.calls.map((c) => new URL(c.url).pathname.split('/').slice(1, 3).join('/'));
  assert.deepEqual(paths.sort(), ['routed-car/route', 'routed-foot/route']);
  const transit = options.find((o) => o.transport === 'transit')?.leg;
  assert.equal(transit?.road, undefined, '대중교통 추정은 찻길 모양을 빌리지 않는다');
  assert.equal(transit?.estimated, true);
  await compareLeg(routes, A, B, 'car');
  assert.equal(f.calls.length, 2);
});

test('추정 표시는 칸마다다: 구간표 칸과 직선 추정 칸이 한 행렬에 섞여도 캐시에서 나올 때까지 칸마다 맞다', async () => {
  const bulguksa = scenarioPlace('gj-bulguksa').coord;
  const seokguram = scenarioPlace('gj-seokguram').coord;
  const inner = slowLocal();
  const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(inner);
  const m1 = await routes.matrix([bulguksa], [seokguram, A], 'car');
  assert.equal(m1.estimated, true);
  assert.deepEqual(m1.estimatedCells, [[false, true]]);
  const m2 = await routes.matrix([bulguksa], [seokguram, A], 'car');
  assert.equal(m2.cacheHits, 2);
  assert.deepEqual(m2.estimatedCells, [[false, true]]);
  const m3 = await routes.matrix([bulguksa], [seokguram], 'car');
  assert.deepEqual([m3.estimated, m3.estimatedCells], [false, [[false]]]);
});

test('묻는 목적지가 같은 출발지들은 안쪽 제공자에 한 번에 묻는다(구간 수는 그대로)', async () => {
  const seen: { o: number; d: number }[] = [];
  const local = createLocalRoutes();
  const inner: RouteProvider = {
    id: 'local',
    async matrix(o, d, t) {
      seen.push({ o: o.length, d: d.length });
      return local.matrix(o, d, t);
    },
    route: local.route,
    clearCache: local.clearCache,
  };
  const D: LatLng = { latitude: 35.845, longitude: 129.24 };
  const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(inner);
  const m = await routes.matrix([A, B], [C, D], 'walk');
  assert.deepEqual(seen, [{ o: 2, d: 2 }]);
  assert.equal(m.calls, 4);
  await routes.matrix([A], [C], 'walk');
  const more = await routes.matrix([A, B, C], [C, D], 'walk');
  // A·B는 다 알고, C→D만 새로(C→C는 같은 지점)
  assert.deepEqual([more.calls, more.cacheHits], [1, 4]);
  assert.deepEqual(seen[seen.length - 1], { o: 1, d: 1 });
});

test('앱은 경로 캐시 시계로 실제 시계(systemClock)를 넘긴다(시뮬레이터 가상 시각이면 300배속에서 24시간 캐시가 몇 분이 된다)', () => {
  const src = readFileSync('src/services/registry.ts', 'utf8');
  const call = /createRouteProvider\(\{([^}]*)\}\)/.exec(src)?.[1] ?? '';
  assert.match(call, /\bclock: systemClock\b/);
  assert.match(call, /\bnetClock: systemClock\b/);
  assert.doesNotMatch(call, /liveClock/);
});
