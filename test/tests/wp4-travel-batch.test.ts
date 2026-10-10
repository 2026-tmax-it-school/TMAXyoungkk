import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Transport } from '../src/types';
import type { RouteProvider, TravelMatrix } from '../src/core/ports';
import { ROUTE_CALL_BUDGET } from '../src/core/constants';
import { buildPlan } from '../src/core/planner';
import { sameCoord } from '../src/core/planner/estimate';
import { createTravelBook, ENSURE_BATCH_MAX, type Pair } from '../src/core/planner/travel';
import { scenarioPlace } from '../src/data/scenario';
import { createLocalRoutes, createRouteProvider, OSM_TABLE_MAX_COORDS } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV, type FakeFetchCall } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * 구간 장부 묶어 묻기(WP4, 2026-10-09 리뷰 반영). 예전에는 구간마다 matrix([a], [b])를 불러 계획 한 번에
 * 두 점짜리 OSRM table 요청이 구간 수만큼(시나리오 76~100건) 나갔다. 이제 출발지·수단이 같은 구간을 묶어 한 번에 묻는다.
 * - 호출 수(routeCalls)는 그대로 구간 수다(계약 A11). 예산 100구간도 그대로다
 * - 추정 표시는 칸마다다(묶음 안의 구간표 칸이 추정으로 바뀌지 않는다)
 * - 진행 숫자는 묶음이 끝날 때마다 오르고 줄지 않으며 마지막은 새로 묻는 구간 수다
 * - 한 묶음이 실패하면 그 묶음의 구간만 직선 추정(failed)이다
 * 네트워크는 쓰지 않는다.
 */

const pt = (i: number): LatLng => ({ latitude: 35.8 + i * 0.002, longitude: 129.2 + (i % 5) * 0.003 });

/** 안쪽 제공자에 들어온 행렬 요청을 적는다 */
function recording(inner: RouteProvider = createLocalRoutes(), fail?: (o: LatLng, t: Transport) => boolean) {
  const asks: { o: LatLng[]; d: LatLng[]; t: Transport }[] = [];
  const routes: RouteProvider = {
    id: inner.id,
    async matrix(o, d, t): Promise<TravelMatrix> {
      asks.push({ o, d, t });
      if (fail?.(o[0], t)) throw new Error('제공자 실패');
      return inner.matrix(o, d, t);
    },
    route: (a, b, t) => inner.route(a, b, t),
    clearCache: () => inner.clearCache(),
  };
  return { routes, asks };
}

function tableBody(url: string) {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname);
  const coords = path
    .slice(path.lastIndexOf('/') + 1)
    .split(';')
    .map((p) => p.split(',').map(Number));
  const list = (k: string) => (u.searchParams.get(k) ?? '').split(';').map(Number);
  const durations = list('sources').map((s) =>
    list('destinations').map((d) => Math.round(Math.hypot(coords[s][0] - coords[d][0], coords[s][1] - coords[d][1]) * 60000)),
  );
  return { code: 'Ok', durations, distances: durations };
}
const tables = (f: { calls: FakeFetchCall[] }) => f.calls.filter((c) => c.url.includes('/table/v1/'));
const destCount = (c: FakeFetchCall) => (new URL(c.url).searchParams.get('destinations') ?? '').split(';').length;

test('출발지·수단이 같은 구간은 matrix([출발지], [목적지들]) 한 번으로 묻는다. 호출 수는 구간 수 그대로다', async () => {
  const { routes, asks } = recording();
  const book = createTravelBook(routes);
  const pairs: Pair[] = [];
  for (const t of ['car', 'walk'] as const) for (const o of [0, 1]) for (const d of [2, 3, 4]) pairs.push({ a: pt(o), b: pt(d), t });
  // 같은 구간이 두 번 와도, 같은 지점 쌍이 와도 한 번만(같은 지점은 묻지 않는다)
  pairs.push({ a: pt(0), b: pt(2), t: 'car' }, { a: pt(1), b: pt(1), t: 'car' });
  const n = await book.ensure(pairs);
  assert.equal(n, 12);
  assert.equal(asks.length, 4, '출발지 2곳 × 수단 2개');
  for (const a of asks) {
    assert.equal(a.o.length, 1);
    assert.equal(a.d.length, 3);
  }
  assert.deepEqual(book.stats(), { calls: 12, cacheHits: 0, asked: 12 });
  // 결과는 한 구간씩 물은 것과 같다
  const local = createLocalRoutes();
  for (const p of pairs) {
    if (sameCoord(p.a, p.b)) continue;
    const one = await local.matrix([p.a], [p.b], p.t);
    assert.equal(book.get(p.a, p.b, p.t).minutes, one.minutes[0][0]);
    assert.equal(book.has(p.a, p.b, p.t), true);
  }
});

test(`묶음은 목적지 ${ENSURE_BATCH_MAX}개까지다. 진행 숫자는 묶음마다 오르고 줄지 않으며 마지막은 새로 묻는 수다`, async () => {
  const { routes, asks } = recording();
  const book = createTravelBook(routes);
  const pairs: Pair[] = Array.from({ length: 30 }, (_, j) => ({ a: pt(0), b: pt(j + 1), t: 'car' as const }));
  const seen: [number, number][] = [];
  await book.ensure(pairs, (done, total) => seen.push([done, total]));
  assert.deepEqual(
    asks.map((a) => a.d.length),
    [ENSURE_BATCH_MAX, ENSURE_BATCH_MAX, 30 - 2 * ENSURE_BATCH_MAX],
  );
  assert.equal(seen.length, 3);
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i][0] >= seen[i - 1][0], '줄지 않는다');
  assert.ok(seen.every(([, total]) => total === 30));
  assert.equal(seen[seen.length - 1][0], 30);
  const again: number[] = [];
  assert.equal(await book.ensure(pairs, (d) => again.push(d)), 0, '아는 구간은 다시 묻지 않는다');
  assert.deepEqual(again, []);
});

test('추정 표시는 칸마다다: 묶음 안에 구간표 구간과 직선 추정 구간이 섞여도 구간표 구간은 추정이 아니다', async () => {
  const bulguksa = scenarioPlace('gj-bulguksa').coord;
  const seokguram = scenarioPlace('gj-seokguram').coord;
  const far: LatLng = { latitude: 35.84, longitude: 129.23 };
  const routes = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(0), kv: memoryKV() });
  const book = createTravelBook(routes);
  await book.ensure([
    { a: bulguksa, b: seokguram, t: 'car' },
    { a: bulguksa, b: far, t: 'car' },
  ]);
  assert.deepEqual([book.get(bulguksa, seokguram, 'car').minutes, book.get(bulguksa, seokguram, 'car').estimated], [12, false]);
  assert.equal(book.get(bulguksa, far, 'car').estimated, true);
});

test('한 묶음이 실패하면 그 묶음의 구간만 직선 추정(failed)이고 다른 묶음은 그대로다', async () => {
  const bad = pt(0);
  const { routes } = recording(createLocalRoutes(), (o) => sameCoord(o, bad));
  const book = createTravelBook(routes);
  await book.ensure([
    { a: bad, b: pt(1), t: 'car' },
    { a: bad, b: pt(2), t: 'car' },
    { a: pt(3), b: pt(4), t: 'car' },
  ]);
  assert.equal(book.get(bad, pt(1), 'car').failed, true);
  assert.equal(book.get(bad, pt(2), 'car').failed, true);
  assert.equal(book.get(pt(3), pt(4), 'car').failed, undefined);
  assert.equal(book.stats().calls, 1, '실패한 묶음은 호출 수에 들어가지 않는다(제공자가 답하지 않았다)');
});

test('계획: 도로 경로 서버를 켜도 길 서버 table 요청이 구간 수보다 훨씬 적다(목적지 여럿씩). 예산·결정성·진행 숫자는 그대로다', async () => {
  const f = fakeFetch((c) => (c.url.includes('/table/v1/') ? { body: tableBody(c.url) } : { status: 404, body: {} }));
  const routes = createRouteProvider({ fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const trip = scenarioTrip();
  const seen: number[] = [];
  const p1 = await buildPlan(trip, { routes, now: 0, onStep: (s) => (s.key === 'matrix' ? seen.push(s.done) : undefined) });
  assert.ok(p1.routeCalls > 0 && p1.routeCalls <= ROUTE_CALL_BUDGET, `${p1.routeCalls}구간`);
  const sent = tables(f);
  assert.ok(sent.length * 2 <= p1.routeCalls, `table ${sent.length}번, 구간 ${p1.routeCalls}개(예전에는 구간마다 한 번)`);
  assert.ok(sent.some((c) => destCount(c) > 1), '목적지 여럿을 한 요청에');
  for (const c of sent) assert.ok(destCount(c) + 1 <= OSM_TABLE_MAX_COORDS);
  // 진행 숫자: 0에서 시작해 줄지 않고, 중간 숫자가 있다(묶음이 끝날 때마다 오른다)
  assert.equal(seen[0], 0);
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] >= seen[i - 1], `줄지 않는다: ${seen.join(',')}`);
  assert.ok(seen.some((d) => d > 0 && d < seen[seen.length - 1]), '중간 숫자가 있다');

  // 같은 입력이면 같은 계획(새 캐시로 다시)
  const g = fakeFetch((c) => (c.url.includes('/table/v1/') ? { body: tableBody(c.url) } : { status: 404, body: {} }));
  const p2 = await buildPlan(trip, { routes: createRouteProvider({ fetch: g, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} }), now: 0 });
  assert.equal(p2.routeCalls, p1.routeCalls);
  assert.equal(tables(g).length, sent.length);
  assert.deepEqual(
    p2.days.map((d) => d.items.map((i) => [i.spotId, i.arrive, i.legEstimated])),
    p1.days.map((d) => d.items.map((i) => [i.spotId, i.arrive, i.legEstimated])),
  );
});
