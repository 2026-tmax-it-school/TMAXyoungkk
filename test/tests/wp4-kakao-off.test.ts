import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import type { FetchLike } from '../src/core/ports';
import { buildPlan } from '../src/core/planner';
import { ENSURE_CONCURRENCY } from '../src/core/planner/travel';
import {
  createKakaoRoutes,
  createLocalRoutes,
  createOsmRoutes,
  createRouteProvider,
  KAKAO_DISABLED_COOLDOWN_MS,
  KAKAO_FALLBACK_TTL_MS,
  type RouteMatrix,
} from '../src/services/routes';
import { createApiProxy } from '../server/proxy.mjs';
import { fakeFetch, fixedClock, memoryKV, type FakeFetchCall } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * 서버에 카카오 키가 없을 때(503 kakaoDisabled, 기본 서버 설정)의 자동차 경로(WP4, 2026-10-09 리뷰 반영).
 * 예전에는 자동차 구간마다 카카오 503 + 대체 요청이 함께 나가고 대체 값은 캐시에 두지 않아, 재계산마다 같은 수(시나리오 152건)를
 * 되풀이하다 서버 요청 한도(분당 300)에 걸려 429 → 길 서버 쉬는 시간 → 직선 추정이 됐다.
 * - netClock(실제 시계)이 있으면 KAKAO_DISABLED_COOLDOWN_MS 동안 카카오에 묻지 않는다
 * - 그동안 대체 제공자가 낸 실제 값(임시 아님)은 KAKAO_FALLBACK_TTL_MS만 캐시한다(서버에 키를 넣으면 몇 분 안에 카카오로 돌아간다)
 * - 일시 장애(카카오 503·429·500)와 대체 제공자 실패는 예전처럼 임시 결과(캐시 안 함)다
 * 네트워크는 쓰지 않는다(가짜 fetch, 멈춘 시계).
 */

const API = 'https://api.example.test';
// 예시 데이터 구간표에 없는 경주 시내 점들
const A: LatLng = { latitude: 35.8301, longitude: 129.2101 };
const B: LatLng = { latitude: 35.8352, longitude: 129.2203 };
const C: LatLng = { latitude: 35.8401, longitude: 129.2301 };

const OFF = { status: 503, body: { error: 'kakaoDisabled' } };
const isKakao = (c: FakeFetchCall) => new URL(c.url).pathname.startsWith('/kakao/');
const kakaoCalls = (f: { calls: FakeFetchCall[] }) => f.calls.filter(isKakao).length;
const provisional = (m: RouteMatrix) => m.provisional;

/** OSRM table처럼 답하는 가짜(초 = 좌표 차이에 비례, 결정적) */
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

test('카카오 키 없음을 들으면 쉬는 시간 동안 자동차도 카카오에 묻지 않고 대체 제공자로 간다. 쉬는 시간이 지나면 다시 묻는다', async () => {
  const f = fakeFetch(() => OFF);
  const clock = fixedClock(5_000);
  const local = createLocalRoutes();
  const kakao = createKakaoRoutes({ apiUrl: API, fetch: f, fallback: local, netClock: clock });

  const m1: RouteMatrix = await kakao.matrix([A], [B], 'car');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(m1.minutes, (await local.matrix([A], [B], 'car')).minutes);
  assert.equal(provisional(m1), undefined, '서버 설정이라 임시 결과가 아니다');
  assert.equal(m1.ttlMs, KAKAO_FALLBACK_TTL_MS, '짧게만 캐시한다');
  assert.equal(kakao.id, 'local');

  clock.advance(KAKAO_DISABLED_COOLDOWN_MS - 1);
  const m2: RouteMatrix = await kakao.matrix([A], [C], 'car');
  const leg = await kakao.route(B, C, 'car');
  assert.equal(f.calls.length, 1, '쉬는 동안에는 행렬도 경로도 카카오에 묻지 않는다');
  assert.equal(m2.ttlMs, KAKAO_FALLBACK_TTL_MS);
  assert.equal((leg as { ttlMs?: number } | null)?.ttlMs, KAKAO_FALLBACK_TTL_MS);
  assert.equal(leg?.provisional, undefined);

  clock.advance(1);
  await kakao.matrix([A], [C], 'car');
  assert.equal(f.calls.length, 2, '쉬는 시간이 끝나면 다시 묻는다');

  // netClock이 없으면 쉬지 않는다(대체 값을 짧게 캐시하는 것은 같다)
  const g = fakeFetch(() => OFF);
  const plain = createKakaoRoutes({ apiUrl: API, fetch: g, fallback: local });
  const p1: RouteMatrix = await plain.matrix([A], [B], 'car');
  await plain.matrix([A], [C], 'car');
  assert.equal(g.calls.length, 2);
  assert.equal(p1.ttlMs, KAKAO_FALLBACK_TTL_MS);
});

test('일시 장애(카카오 503·429·500)는 쉬지 않고 임시 결과다. 키 없음 동안 대체 제공자(OSRM)도 실패하면 임시 결과다', async () => {
  const local = createLocalRoutes();
  for (const reply of [{ status: 503, body: { errorType: 'ServiceUnavailable' } }, { status: 429, body: {} }, { status: 500, body: {} }]) {
    const f = fakeFetch(() => reply);
    const kakao = createKakaoRoutes({ apiUrl: API, fetch: f, fallback: local, netClock: fixedClock(0) });
    const m: RouteMatrix = await kakao.matrix([A], [B], 'car');
    assert.equal(provisional(m), true, String(reply.status));
    assert.equal(m.ttlMs, undefined);
    assert.equal((await kakao.route(A, B, 'car'))?.provisional, true);
    assert.equal(f.calls.length, 2, `${reply.status}: 다음 요청도 카카오에 묻는다`);
  }

  // 서버에 카카오 키도 없고 길 서버도 503이면 대체 값은 직선 추정 임시 결과다(짧게도 두지 않는다)
  const f = fakeFetch((c) => (isKakao(c) ? OFF : { status: 503, body: {} }));
  const osm = createOsmRoutes({ fetch: f, fallback: local, baseUrl: `${API}/osrm` });
  const kakao = createKakaoRoutes({ apiUrl: API, fetch: f, fallback: osm, netClock: fixedClock(0) });
  const m: RouteMatrix = await kakao.matrix([A], [B], 'car');
  assert.deepEqual([provisional(m), m.ttlMs, m.estimated], [true, undefined, true]);
  const leg = await kakao.route(A, B, 'car');
  assert.deepEqual([leg?.provisional, (leg as { ttlMs?: number } | null)?.ttlMs], [true, undefined]);
});

test('캐시: 키 없음 동안의 실제 대체 값은 짧은 보관 시간 안에는 다시 묻지 않고, 지나면 카카오에 다시 묻는다', async () => {
  let enabled = false;
  const f = fakeFetch((c) => {
    if (isKakao(c)) {
      return enabled ? { body: { routes: [{ result_code: 0, summary: { distance: 4210, duration: 720 }, sections: [] }] } } : OFF;
    }
    return { body: tableBody(c.url) };
  });
  const clock = fixedClock(0);
  const net = fixedClock(0);
  const routes = createRouteProvider({ apiUrl: API, fetch: f, clock, kv: memoryKV(), roadShapes: {}, netClock: net });
  const m1 = await routes.matrix([A], [B, C], 'car');
  assert.equal(m1.estimated, false, '실제 길(OSRM) 값');
  assert.equal(kakaoCalls(f), 1);
  const n1 = f.calls.length;

  enabled = true;
  clock.advance(KAKAO_FALLBACK_TTL_MS);
  net.advance(KAKAO_FALLBACK_TTL_MS);
  const again = await routes.matrix([A], [B, C], 'car');
  assert.equal(f.calls.length, n1, '보관 시간 정각까지는 캐시');
  assert.deepEqual([again.calls, again.cacheHits], [0, 2]);

  clock.advance(1);
  net.advance(1);
  const m2 = await routes.matrix([A], [B, C], 'car');
  assert.deepEqual(m2.minutes, [[12, 12]], '키가 들어온 뒤 보관 시간이 지나면 카카오 값');
  assert.equal(routes.id, 'kakao');
  // 카카오 값은 24시간 캐시다
  clock.advance(KAKAO_FALLBACK_TTL_MS * 10);
  const n2 = f.calls.length;
  await routes.matrix([A], [B, C], 'car');
  assert.equal(f.calls.length, n2);
});

test('예시 시나리오: 기본 서버(카카오 키 없음, 분당 300 요청 한도)를 거쳐 1분 안에 세 번 계산해도 429가 없고, 다시 계산하면 요청이 0이다', async () => {
  const upstream = fakeFetch((c) => ({ body: tableBody(c.url) }));
  const proxyClock = fixedClock(0);
  const proxy = createApiProxy({ fetch: upstream, osrmUrl: 'https://osrm.example.test', now: () => proxyClock.now() });
  const statuses: number[] = [];
  const app: FetchLike & { calls: string[] } = Object.assign(
    async (url: string) => {
      app.calls.push(url);
      const u = new URL(url);
      const r = await proxy.handle({ method: 'GET', url: u, rawLength: u.pathname.length + u.search.length, ip: '10.0.0.7' });
      statuses.push(r.status);
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
    },
    { calls: [] as string[] },
  );
  const routes = createRouteProvider({ apiUrl: API, fetch: app, clock: fixedClock(0), kv: memoryKV(), roadShapes: {}, netClock: fixedClock(0) });
  const trip = scenarioTrip();
  const p1 = await buildPlan(trip, { routes, now: 0 });
  const first = app.calls.length;
  assert.ok(p1.routeCalls > 0);
  assert.ok(first < p1.routeCalls, `첫 계산 요청 ${first}건(구간 ${p1.routeCalls}개)`);
  const kakaoAsked = app.calls.filter((u) => new URL(u).pathname.startsWith('/kakao/')).length;
  assert.ok(kakaoAsked >= 1 && kakaoAsked <= ENSURE_CONCURRENCY, `카카오 503은 첫 물결만(${kakaoAsked}건)`);

  const p2 = await buildPlan(trip, { routes, now: 0 });
  const p3 = await buildPlan(trip, { routes, now: 0 });
  assert.equal(app.calls.length, first, '다시 계산하면 캐시(짧은 보관 시간)에서 나온다');
  assert.equal(statuses.includes(429), false, '서버 요청 한도에 걸리지 않는다');
  assert.equal(p3.routeCalls, 0);
  assert.deepEqual(
    p2.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
    p1.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
  );
});
