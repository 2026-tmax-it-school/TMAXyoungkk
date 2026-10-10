import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import type { LatLng } from '../src/types';
import type { FetchLike, Region } from '../src/core/ports';
import { regionById } from '../src/data/regions';
import { createKakaoPlaces, KAKAO_KEYWORD_URL } from '../src/services/places/kakao';
import { createLocalPlaces } from '../src/services/places/local';
import { createRouteProvider, KAKAO_DIRECTIONS_URL } from '../src/services/routes';
import { migrate } from '../server/db/migrate.mjs';
import { createPostgresStore, sqlDb, type PostgresSyncStore, type SqlDb } from '../server/db/postgres-store.mjs';
import {
  createApiProxy,
  isProxyPath,
  KOREA_BOUNDS,
  OSRM_PUBLIC_URL,
  PROXY_DEFAULTS,
  proxyOptionsFromEnv,
  type ApiProxy,
  type ApiProxyOptions,
  type UpstreamFetch,
} from '../server/proxy.mjs';
import { ROUTE_CACHE_TTL_MS } from '../server/retention.mjs';
import { createSyncStore, MEMORY_ROUTE_CACHE_LIMIT, startSyncServer } from '../server/sync-server.mjs';
import { fixedClock, memoryKV } from './helpers/fakes';

/**
 * 키 숨기는 중계(server/proxy.mjs, 2026-10-09 결정). 상류(카카오·OSRM)는 가짜 fetch로 바꿔 끼워 네트워크 없이 본다.
 * 키 헤더는 서버에서만 붙는다, 허용 목록 밖은 상류에 닿지 않는다, IP별 속도 제한, 24시간 캐시(메모리·PGlite),
 * 키가 없으면 503, 공개 OSRM 동시 요청 2개(차례 대기 상한), 겹치는 요청 합치기, 상류 시간 초과·실패 전달,
 * 국내 좌표만, 메모리 경로 캐시 상한, 중계를 끈 서버.
 * 끝에는 실제 HTTP 서버에 앱 어댑터(kakaoHttp·osm)를 붙여 키 없이 거쳐 가는지 본다.
 */

const KEY = 'SERVER-KAKAO-KEY-0123456789';
const T0 = Date.UTC(2026, 9, 9, 1, 0, 0);
const A: LatLng = { latitude: 35.8301, longitude: 129.2101 };
const B: LatLng = { latitude: 35.8352, longitude: 129.2203 };
const PAIR = `${A.longitude},${A.latitude};${B.longitude},${B.latitude}`;
const FOOT = `/osrm/routed-foot/route/v1/foot/${PAIR}?overview=full&geometries=geojson&steps=true`;

interface UpCall {
  url: string;
  headers: Record<string, string>;
}
type UpReply = { status?: number; body?: unknown };

/** 가짜 상류. 받은 주소·헤더를 적고 handler 응답을 준다 */
function upstream(handler: (url: URL) => UpReply | Promise<UpReply> = () => ({ body: { code: 'Ok', routes: [] } })) {
  const calls: UpCall[] = [];
  const fetch: UpstreamFetch = async (url, init) => {
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    const r = await handler(new URL(url));
    const status = r.status ?? 200;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

function osrmBody(coords: LatLng[] = [A, B]) {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 1490.4,
        duration: 1100,
        geometry: { type: 'LineString', coordinates: coords.map((c) => [c.longitude, c.latitude]) },
        legs: [{ steps: [{ distance: 1490, name: '첨성로', maneuver: { type: 'depart', bearing_after: 88 } }] }],
      },
    ],
  };
}

const KAKAO_DOCS = {
  documents: [
    {
      id: '101',
      place_name: '황남빵',
      category_name: '음식점 > 간식 > 제과,베이커리',
      category_group_code: 'FD6',
      address_name: '경북 경주시 황남동 1',
      x: '129.2104',
      y: '35.8371',
    },
  ],
  meta: { total_count: 1 },
};

const KAKAO_ROUTE = {
  routes: [
    {
      result_code: 0,
      summary: { distance: 4210, duration: 720 },
      sections: [{ roads: [{ vertexes: [129.2101, 35.8301, 129.215, 35.832, 129.2203, 35.8352] }], guides: [] }],
    },
  ],
};

function proxyWith(opts: ApiProxyOptions & { clock?: { now(): number } } = {}): ApiProxy {
  const store = createSyncStore();
  const clock = opts.clock ?? fixedClock(T0);
  return createApiProxy({ cache: store.routeCache, now: () => clock.now(), kakaoKey: KEY, ...opts });
}

function call(proxy: ApiProxy, path: string, o: { method?: string; ip?: string } = {}) {
  return proxy.handle({ method: o.method ?? 'GET', url: new URL(path, 'http://localhost'), rawLength: path.length, ip: o.ip ?? '10.0.0.1' });
}

const coords = (n: number) =>
  Array.from({ length: n }, (_, i) => `${(129.2 + i * 0.001).toFixed(4)},${(35.8 + i * 0.001).toFixed(4)}`).join(';');
/** 서로 다른 두 점 구간(i마다 다르다) */
const pair = (i: number) => `${(129.2 + i * 0.01).toFixed(4)},35.8000;${(129.21 + i * 0.01).toFixed(4)},35.8100`;

test('중계 경로는 /kakao/…와 /osrm/…뿐이다', () => {
  assert.equal(isProxyPath('/kakao/local/keyword'), true);
  assert.equal(isProxyPath('/osrm/routed-foot/route/v1/foot/1,2;3,4'), true);
  assert.equal(isProxyPath('/osrm'), true);
  assert.equal(isProxyPath('/kakaox/local'), false);
  assert.equal(isProxyPath('/trips/t1/ops'), false);
  assert.equal(isProxyPath('/health'), false);
});

test('서버 환경 변수: 기본은 키 없음·공개 OSRM·동시 2개·분당 300회, OSRM_URL이 주소가 아니거나 수가 아니면 시작하지 않는다', () => {
  assert.deepEqual(proxyOptionsFromEnv({}), {
    kakaoKey: '',
    osrmUrl: OSRM_PUBLIC_URL,
    osrmConcurrency: PROXY_DEFAULTS.osrmConcurrency,
    ratePerMin: PROXY_DEFAULTS.ratePerMin,
  });
  assert.equal(PROXY_DEFAULTS.ratePerMin, 300);
  assert.equal(PROXY_DEFAULTS.osrmConcurrency, 2);
  assert.deepEqual(
    proxyOptionsFromEnv({ KAKAO_REST_KEY: ` ${KEY} `, OSRM_URL: 'http://127.0.0.1:5000/', OSRM_CONCURRENCY: '4', PROXY_RATE_PER_MIN: '0' }),
    { kakaoKey: KEY, osrmUrl: 'http://127.0.0.1:5000', osrmConcurrency: 4, ratePerMin: 0 },
  );
  assert.throws(() => proxyOptionsFromEnv({ OSRM_URL: 'routing.example' }), /OSRM_URL/);
  assert.throws(() => proxyOptionsFromEnv({ PROXY_RATE_PER_MIN: 'many' }), /정수/);
  assert.throws(() => proxyOptionsFromEnv({ OSRM_CONCURRENCY: '-1' }), /정수/);
});

test('카카오 키워드 검색: 서버 키로 KakaoAK 헤더를 붙이고 허용한 매개변수만 이름 순으로 넘긴다. 응답은 그대로 주되 키 글자는 가린다', async () => {
  const up = upstream(() => ({ body: { ...KAKAO_DOCS, meta: { total_count: 1, echo: `KakaoAK ${KEY}` } } }));
  const proxy = proxyWith({ fetch: up.fetch });
  const res = await call(proxy, '/kakao/local/keyword?query=%ED%99%A9%EB%82%A8%EB%B9%B5&y=35.8&x=129.2&radius=20000&sort=accuracy&size=15');
  assert.equal(res.status, 200);
  assert.equal(up.calls.length, 1);
  const sent = new URL(up.calls[0].url);
  assert.equal(`${sent.origin}${sent.pathname}`, KAKAO_KEYWORD_URL);
  assert.deepEqual(
    [...sent.searchParams],
    [
      ['query', '황남빵'],
      ['radius', '20000'],
      ['size', '15'],
      ['sort', 'accuracy'],
      ['x', '129.2'],
      ['y', '35.8'],
    ],
  );
  assert.deepEqual(up.calls[0].headers, { Authorization: `KakaoAK ${KEY}` }, '앱 헤더는 넘기지 않고 서버 키만 붙인다');
  const body = res.body as typeof KAKAO_DOCS & { meta: { echo: string } };
  assert.equal(body.documents[0].place_name, '황남빵');
  assert.equal(body.meta.echo, 'KakaoAK [숨김]');
  assert.equal(JSON.stringify(res).includes(KEY), false, '응답 어디에도 키가 없다');
  assert.equal(res.headers['X-Cache'], undefined, '장소 검색은 캐시하지 않는다');
  await call(proxy, '/kakao/local/keyword?query=%ED%99%A9%EB%82%A8%EB%B9%B5&y=35.8&x=129.2&radius=20000&sort=accuracy&size=15');
  assert.equal(up.calls.length, 2);
});

test('카카오 카테고리 검색·자동차 길찾기도 같은 헤더로 넘긴다. 길찾기 성공 응답은 24시간 캐시한다', async () => {
  const up = upstream((u) => ({ body: u.hostname === 'apis-navi.kakaomobility.com' ? KAKAO_ROUTE : KAKAO_DOCS }));
  const clock = fixedClock(T0);
  const proxy = proxyWith({ fetch: up.fetch, clock });
  const cat = await call(proxy, '/kakao/local/category?category_group_code=FD6&x=129.2&y=35.8&radius=500&sort=distance&size=15');
  assert.equal(cat.status, 200);
  assert.ok(up.calls[0].url.startsWith('https://dapi.kakao.com/v2/local/search/category.json?category_group_code=FD6&radius=500'));

  const path = `/kakao/navi/directions?origin=${A.longitude},${A.latitude}&destination=${B.longitude},${B.latitude}&priority=RECOMMEND&summary=false`;
  const first = await call(proxy, path);
  assert.equal(first.status, 200);
  assert.equal(first.headers['X-Cache'], 'miss');
  const sent = new URL(up.calls[1].url);
  assert.equal(`${sent.origin}${sent.pathname}`, KAKAO_DIRECTIONS_URL);
  assert.equal(sent.searchParams.get('origin'), `${A.longitude},${A.latitude}`);
  assert.deepEqual(up.calls[1].headers, { Authorization: `KakaoAK ${KEY}` });
  assert.deepEqual(first.body, KAKAO_ROUTE);

  const again = await call(proxy, path);
  assert.equal(again.headers['X-Cache'], 'hit');
  assert.deepEqual(again.body, KAKAO_ROUTE);
  assert.equal(up.calls.length, 2, '같은 길찾기는 상류에 다시 묻지 않는다');
  clock.advance(ROUTE_CACHE_TTL_MS);
  await call(proxy, path);
  assert.equal(up.calls.length, 3, '24시간이 지나면 다시 묻는다');
});

test('열린 중계 금지: 모르는 경로·매개변수, 같은 이름 두 번, 범위 밖 값, 좌표 수 상한, GET 아닌 요청은 상류에 닿지 않는다', async () => {
  const up = upstream();
  const proxy = proxyWith({ fetch: up.fetch, ratePerMin: 0 });
  const xy = 'x=129.2&y=35.8&radius=500';
  const cases: [string, number, string?][] = [
    ['/kakao/local/keyword?query=a&callback=steal', 400],
    ['/kakao/local/keyword?query=a&query=b', 400],
    ['/kakao/local/keyword', 400],
    ['/kakao/local/keyword?query=%20%20', 400],
    [`/kakao/local/keyword?query=${'가'.repeat(101)}`, 400],
    ['/kakao/local/keyword?query=a&radius=50000', 400],
    ['/kakao/local/keyword?query=a&x=500&y=35', 400],
    ['/kakao/local/keyword?query=a&size=100', 400],
    ['/kakao/local/category?category_group_code=FD6', 400],
    [`/kakao/local/category?category_group_code=ZZ9&${xy}`, 400],
    [`/kakao/local/category?category_group_code=FD6&${xy}&rect=1,2,3,4`, 400],
    ['/kakao/navi/directions?origin=129.2,35.8', 400],
    ['/kakao/navi/directions?origin=129.2,35.8&destination=129.3,35.9&waypoints=129.25,35.85', 400],
    ['/kakao/navi/directions?origin=129.2&destination=129.3,35.9', 400],
    ['/kakao/navi/destinations?origin=129.2,35.8', 404],
    ['/kakao/v2/local/search/keyword.json?query=a', 404],
    ['/kakao/constructor', 404],
    ['/kakao', 404],
    [`/osrm/routed-bike/route/v1/bike/${PAIR}`, 404],
    [`/osrm/routed-foot/nearest/v1/foot/${PAIR}`, 404],
    [`/osrm/routed-foot/route/v2/foot/${PAIR}`, 404],
    [`/osrm/routed-foot/route/v1/driving/${PAIR}`, 400],
    ['/osrm/routed-foot/route/v1/foot/129.2,35.8', 400],
    ['/osrm/routed-foot/route/v1/foot/129.2,35.8;abc,35.9', 400],
    ['/osrm/routed-foot/route/v1/foot/129.2,35.8;129.3,95', 400],
    [`/osrm/routed-foot/route/v1/foot/${coords(3)}`, 400],
    [`/osrm/routed-foot/route/v1/foot/${PAIR}?alternatives=true`, 400],
    // 국내 범위 밖(도쿄, 뉴욕, 북쪽 39도 넘음)
    ['/osrm/routed-foot/route/v1/foot/139.69,35.68;139.70,35.69', 400],
    ['/osrm/routed-car/route/v1/driving/-73.98,40.75;-73.97,40.76', 400],
    ['/osrm/routed-car/route/v1/driving/127.0,37.5;127.1,39.5', 400],
    ['/kakao/local/keyword?query=a&x=139.69&y=35.68&radius=500', 400],
    ['/kakao/local/category?category_group_code=FD6&x=126.9&y=32.5&radius=500', 400],
    ['/kakao/navi/directions?origin=139.69,35.68&destination=129.3,35.9', 400],
    [`/osrm/routed-car/table/v1/driving/${coords(51)}`, 400],
    [`/osrm/routed-car/table/v1/driving/${coords(3)}?sources=0;5`, 400],
    [`/osrm/routed-foot/route/v1/foot/${PAIR}?overview=full&hint=x`, 400],
    [`/osrm/routed-foot/route/v1/foot/${PAIR}?steps=maybe`, 400],
    [`/kakao/local/keyword?query=${'a'.repeat(5000)}`, 414],
  ];
  for (const [path, status] of cases) {
    const res = await call(proxy, path);
    assert.equal(res.status, status, path.slice(0, 120));
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = await call(proxy, FOOT, { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.Allow, 'GET, OPTIONS');
  }
  assert.equal(up.calls.length, 0, '하나도 상류에 닿지 않았다');

  // 상한 안쪽은 넘긴다(제주·독도 끝까지 국내 범위)
  assert.deepEqual(KOREA_BOUNDS, { minLng: 124, maxLng: 132, minLat: 33, maxLat: 39 });
  assert.equal((await call(proxy, `/osrm/routed-foot/route/v1/foot/${coords(2)}`)).status, 200);
  assert.equal((await call(proxy, `/osrm/routed-car/table/v1/driving/${coords(50)}?sources=0&annotations=duration,distance`)).status, 200);
  assert.equal((await call(proxy, `/osrm/routed-car/table/v1/driving/${coords(3)}?sources=0;2&destinations=all`)).status, 200);
  assert.equal((await call(proxy, '/kakao/local/keyword?query=a&x=126.5312&y=33.2496&radius=500')).status, 200, '제주');
  assert.equal((await call(proxy, '/kakao/navi/directions?origin=131.8669,37.2426&destination=130.9057,37.4844')).status, 200, '독도·울릉도');
  assert.equal(up.calls.length, 5);
  assert.ok(up.calls[1].url.endsWith('?annotations=duration,distance&sources=0'), 'OSRM 값은 주소 꼴 그대로(;·, 그대로)');
  assert.ok(up.calls[2].url.endsWith(`/routed-car/table/v1/driving/${coords(3)}?destinations=all&sources=0;2`), up.calls[2].url);
});

test('카카오 키가 없으면 카카오 경로는 503과 이유를 주고 상류에 묻지 않는다. OSRM 중계는 그대로 된다', async () => {
  const up = upstream(() => ({ body: osrmBody() }));
  const proxy = proxyWith({ fetch: up.fetch, kakaoKey: '' });
  assert.equal(proxy.info().kakao, false);
  const res = await call(proxy, '/kakao/local/keyword?query=%EB%B6%88%EA%B5%AD%EC%82%AC');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'kakaoDisabled', reason: '서버에 KAKAO_REST_KEY가 없어 카카오를 중계하지 않는다' });
  assert.equal((await call(proxy, `/kakao/navi/directions?origin=129.2,35.8&destination=129.3,35.9`)).status, 503);
  assert.equal(up.calls.length, 0);
  assert.equal((await call(proxy, FOOT)).status, 200);
  assert.equal(up.calls.length, 1);
});

test('OSRM: OSRM_URL 상류에 같은 경로 꼴로 묻고 키 헤더를 붙이지 않는다. 성공은 24시간 캐시하고 실패는 캐시하지 않는다', async () => {
  let reply: UpReply = { body: osrmBody() };
  const up = upstream(() => reply);
  const clock = fixedClock(T0);
  const proxy = proxyWith({ fetch: up.fetch, clock, osrmUrl: 'https://osrm.example.test/' });
  const first = await call(proxy, FOOT);
  assert.equal(first.status, 200);
  assert.equal(first.headers['X-Cache'], 'miss');
  assert.equal(
    up.calls[0].url,
    `https://osrm.example.test/routed-foot/route/v1/foot/${PAIR}?geometries=geojson&overview=full&steps=true`,
  );
  assert.deepEqual(up.calls[0].headers, {}, 'OSRM에는 카카오 키도 앱 헤더도 보내지 않는다');
  assert.deepEqual(first.body, osrmBody());

  const hit = await call(proxy, FOOT);
  assert.equal(hit.headers['X-Cache'], 'hit');
  assert.deepEqual(hit.body, osrmBody());
  // 매개변수 순서만 다른 요청도 같은 캐시를 쓴다
  await call(proxy, `/osrm/routed-foot/route/v1/foot/${PAIR}?steps=true&overview=full&geometries=geojson`);
  assert.equal(up.calls.length, 1);
  // 수단이 다르면 다른 요청이다
  await call(proxy, `/osrm/routed-car/route/v1/driving/${PAIR}?overview=full&geometries=geojson&steps=true`);
  assert.equal(up.calls.length, 2);
  assert.ok(up.calls[1].url.startsWith('https://osrm.example.test/routed-car/route/v1/driving/'));

  clock.advance(ROUTE_CACHE_TTL_MS);
  assert.equal((await call(proxy, FOOT)).headers['X-Cache'], 'miss', '24시간이 지나면 다시 묻는다');
  assert.equal(up.calls.length, 3);

  reply = { status: 400, body: { code: 'NoRoute', message: 'Impossible route between points' } };
  const other = `/osrm/routed-foot/route/v1/foot/${coords(2)}?overview=full`;
  const fail = await call(proxy, other);
  assert.equal(fail.status, 400, '상류 상태 코드를 그대로 준다');
  assert.deepEqual(fail.body, { code: 'NoRoute', message: 'Impossible route between points' });
  await call(proxy, other);
  assert.equal(up.calls.length, 5, '실패는 캐시하지 않는다');
});

test('IP별 1분 요청 수 상한: 넘으면 429와 Retry-After, 다른 IP와 다음 1분은 받는다(캐시에서 나간 응답도 센다)', async () => {
  const up = upstream(() => ({ body: osrmBody() }));
  const clock = fixedClock(T0);
  const proxy = proxyWith({ fetch: up.fetch, clock, ratePerMin: 3 });
  for (let i = 0; i < 3; i += 1) assert.equal((await call(proxy, FOOT, { ip: '10.0.0.7' })).status, 200);
  assert.equal(up.calls.length, 1, '둘째부터는 캐시');
  clock.advance(20_000);
  const limited = await call(proxy, FOOT, { ip: '10.0.0.7' });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { error: 'rateLimited' });
  assert.equal(limited.headers['Retry-After'], '40');
  // 잘못된 요청도 센다(모르는 경로로 상한을 피하지 못한다)
  assert.equal((await call(proxy, '/kakao/nothing', { ip: '10.0.0.7' })).status, 429);
  assert.equal((await call(proxy, FOOT, { ip: '10.0.0.8' })).status, 200, '다른 IP는 따로 센다');
  clock.advance(40_000);
  assert.equal((await call(proxy, FOOT, { ip: '10.0.0.7' })).status, 200, '다음 1분');
  // 0이면 끈다
  const open = proxyWith({ fetch: up.fetch, clock, ratePerMin: 0 });
  for (let i = 0; i < 20; i += 1) assert.equal((await call(open, FOOT)).status, 200);
});

/** 동시에 몇 개가 상류에 걸려 있는지 세는 가짜 상류. release()로 걸린 요청을 모두 끝낸다 */
function heldUpstream() {
  let active = 0;
  let max = 0;
  let waiters: (() => void)[] = [];
  const up = upstream(async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise<void>((resolve) => waiters.push(resolve));
    active -= 1;
    return { body: osrmBody() };
  });
  return {
    ...up,
    max: () => max,
    held: () => waiters.length,
    release() {
      const w = waiters;
      waiters = [];
      w.forEach((r) => r());
    },
  };
}

async function settle(until: () => boolean) {
  for (let i = 0; i < 200 && !until(); i += 1) await new Promise((r) => setTimeout(r, 1));
}

test('공개 OSRM에는 동시에 2개까지만 보낸다(설정이 더 커도). 다른 OSRM 서버는 설정대로다', async () => {
  const up = heldUpstream();
  const proxy = proxyWith({ fetch: up.fetch, osrmConcurrency: 8, ratePerMin: 0 });
  assert.equal(proxy.info().osrmConcurrency, 2);
  assert.equal(proxyWith({ osrmUrl: 'http://127.0.0.1:5000', osrmConcurrency: 8 }).info().osrmConcurrency, 8);

  let done = false;
  const all = Promise.all(Array.from({ length: 6 }, (_, i) => call(proxy, `/osrm/routed-foot/route/v1/foot/${pair(i)}`))).finally(
    () => (done = true),
  );
  for (let round = 0; round < 10 && !done; round += 1) {
    await settle(() => up.held() > 0 || done);
    assert.ok(up.held() <= 2, `한 번에 ${up.held()}개`);
    up.release();
  }
  const res = await all;
  assert.deepEqual(
    res.map((r) => r.status),
    [200, 200, 200, 200, 200, 200],
  );
  assert.equal(up.calls.length, 6);
  assert.equal(up.max(), 2);
});

test('같은 요청이 겹치면 상류에는 한 번만 묻는다. 기다리는 요청이 상한을 넘으면 503 busy다', async () => {
  const up = heldUpstream();
  const proxy = proxyWith({ fetch: up.fetch, ratePerMin: 0 });
  const same = [call(proxy, FOOT), call(proxy, FOOT), call(proxy, FOOT)];
  await settle(() => up.held() > 0);
  up.release();
  assert.deepEqual(
    (await Promise.all(same)).map((r) => r.status),
    [200, 200, 200],
  );
  assert.equal(up.calls.length, 1);

  const up2 = heldUpstream();
  const tight = proxyWith({ fetch: up2.fetch, ratePerMin: 0, osrmUrl: 'http://127.0.0.1:5000', osrmConcurrency: 1, queueMax: 1 });
  const p1 = call(tight, `/osrm/routed-foot/route/v1/foot/${pair(1)}`);
  const p2 = call(tight, `/osrm/routed-foot/route/v1/foot/${pair(2)}`);
  await settle(() => up2.held() > 0);
  const busy = await call(tight, `/osrm/routed-foot/route/v1/foot/${pair(3)}`);
  assert.equal(busy.status, 503);
  assert.equal((busy.body as { error: string }).error, 'busy');
  assert.equal(busy.headers['Retry-After'], '1');
  up2.release();
  await settle(() => up2.held() > 0);
  up2.release();
  assert.deepEqual([(await p1).status, (await p2).status], [200, 200]);
  assert.equal(up2.max(), 1);
});

test('OSRM 차례를 기다리다 시간 상한(queueWaitMs)을 넘기면 상류에 묻지 않고 503 busy다. 앞 요청은 그대로 끝난다', async () => {
  assert.equal(PROXY_DEFAULTS.queueWaitMs, 6000);
  const up = heldUpstream();
  const proxy = proxyWith({ fetch: up.fetch, ratePerMin: 0, osrmUrl: 'http://127.0.0.1:5000', osrmConcurrency: 1, queueWaitMs: 20 });
  const first = call(proxy, `/osrm/routed-foot/route/v1/foot/${pair(1)}`);
  await settle(() => up.held() > 0);
  const waited = await call(proxy, `/osrm/routed-foot/route/v1/foot/${pair(2)}`);
  assert.equal(waited.status, 503);
  assert.equal((waited.body as { error: string }).error, 'busy');
  assert.equal(waited.headers['Retry-After'], '1');
  assert.equal(up.calls.length, 1, '기다리다 포기한 요청은 상류에 닿지 않는다');
  up.release();
  assert.equal((await first).status, 200);
  // 자리가 비면 다음 요청은 바로 간다
  const next = call(proxy, `/osrm/routed-foot/route/v1/foot/${pair(3)}`);
  await settle(() => up.held() > 0);
  up.release();
  assert.equal((await next).status, 200);
  assert.equal(up.calls.length, 2);
});

test('상류 시간 초과는 504, 닿지 못하면 502, 상류 실패 상태는 그대로, JSON이 아닌 성공 응답은 502다. 기록에 키·좌표가 없다', async () => {
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const hang = proxyWith({ fetch: () => new Promise(() => {}), timeoutMs: 20, log });
  const slow = await call(hang, FOOT);
  assert.equal(slow.status, 504);
  assert.deepEqual(slow.body, { error: 'upstreamTimeout' });

  const down = proxyWith({
    fetch: async () => {
      throw new Error('connect ECONNREFUSED');
    },
    log,
  });
  assert.deepEqual(await call(down, '/kakao/local/keyword?query=abc'), { status: 502, body: { error: 'upstreamFailed' }, headers: {} });

  const limited = proxyWith({ fetch: upstream(() => ({ status: 429, body: { errorType: 'RateLimitExceeded', message: 'API limit has been exceeded.' } })).fetch });
  const r429 = await call(limited, '/kakao/local/keyword?query=abc');
  assert.equal(r429.status, 429);
  assert.deepEqual(r429.body, { errorType: 'RateLimitExceeded', message: 'API limit has been exceeded.' });

  const denied = proxyWith({
    fetch: upstream(() => ({ status: 401, body: { errorType: 'AccessDeniedError', message: `wrong appKey(${KEY})` } })).fetch,
    log,
  });
  const r401 = await call(denied, '/kakao/local/keyword?query=abc');
  assert.equal(r401.status, 401);
  assert.equal(JSON.stringify(r401.body).includes(KEY), false, '실패 응답에서도 키를 가린다');
  await call(denied, '/kakao/navi/directions?origin=129.2,35.8&destination=129.3,35.9');
  assert.equal(logs.filter((m) => m.includes('카카오가 서버 키를 거부했다(401)')).length, 1, '키 거부는 한 번만 기록한다');

  const html = proxyWith({ fetch: upstream(() => ({ status: 200, body: '<html>maintenance</html>' })).fetch });
  assert.deepEqual((await call(html, FOOT)).body, { error: 'badUpstream' });
  const html500 = proxyWith({ fetch: upstream(() => ({ status: 500, body: '<html>oops</html>' })).fetch });
  assert.deepEqual(await call(html500, FOOT), { status: 500, body: { error: 'upstream', status: 500 }, headers: {} });

  assert.ok(logs.length >= 3);
  for (const m of logs) {
    assert.equal(m.includes(KEY), false, m);
    assert.equal(m.includes(String(A.longitude)), false, m);
  }
});

test('캐시가 망가져도 중계는 된다(읽기·쓰기 실패는 없는 캐시로 본다)', async () => {
  const up = upstream(() => ({ body: osrmBody() }));
  const logs: string[] = [];
  const proxy = createApiProxy({
    fetch: up.fetch,
    cache: {
      get: () => Promise.reject(new Error('db down')),
      put: () => Promise.reject(new Error('db down')),
    },
    log: (m) => logs.push(m),
  });
  assert.equal((await call(proxy, FOOT)).status, 200);
  assert.equal((await call(proxy, FOOT)).status, 200);
  assert.equal(up.calls.length, 2);
  assert.ok(logs.some((m) => m.includes('경로 캐시 읽기 실패')));
  assert.ok(logs.some((m) => m.includes('경로 캐시 쓰기 실패')));
});

test('메모리 경로 캐시는 개수·크기 상한이 있다. 넘으면 오래 둔 것부터 버리고, 넣을 때 24시간 지난 것을 지운다', () => {
  assert.deepEqual(MEMORY_ROUTE_CACHE_LIMIT, { entries: 2000, chars: 20 * 1024 * 1024 });
  const store = createSyncStore({ routeCacheLimit: { entries: 3, chars: 200 } });
  const c = store.routeCache;
  for (const k of ['a', 'b', 'c', 'd']) c.put(k, { k }, T0);
  assert.equal(c.get('a', T0), null, '개수 상한: 가장 먼저 넣은 것부터 버린다');
  assert.deepEqual(['b', 'c', 'd'].map((k) => c.get(k, T0)), [{ k: 'b' }, { k: 'c' }, { k: 'd' }]);
  // 다시 넣으면 새것이 된다(먼저 버려지지 않는다)
  c.put('b', { k: 'b2' }, T0);
  c.put('e', { k: 'e' }, T0);
  assert.equal(c.get('c', T0), null);
  assert.deepEqual(c.get('b', T0), { k: 'b2' });
  // 크기 상한(JSON 글자 수 합)
  const small = createSyncStore({ routeCacheLimit: { entries: 10, chars: 200 } }).routeCache;
  small.put('a', { k: 'a' }, T0);
  small.put('b', { k: 'b' }, T0);
  small.put('big', { s: 'x'.repeat(150) }, T0);
  assert.ok(small.get('a', T0), '합이 상한 안이면 그대로 둔다');
  small.put('c', { s: 'x'.repeat(30) }, T0);
  assert.equal(small.get('a', T0), null, '합이 넘으면 오래된 것부터 버린다');
  assert.equal(small.get('b', T0), null);
  assert.ok(small.get('big', T0));
  assert.ok(small.get('c', T0));
  small.put('huge', { s: 'x'.repeat(300) }, T0);
  assert.equal(small.get('huge', T0), null, '상한보다 큰 응답 하나는 두지 않는다');
  assert.ok(small.get('big', T0), '그때 다른 것을 버리지 않는다');
  // 24시간 지난 것은 넣을 때 지운다(상한이 남아 있어도)
  const roomy = createSyncStore({ routeCacheLimit: { entries: 10, chars: 10_000 } }).routeCache;
  roomy.put('old', { k: 1 }, T0);
  roomy.put('new', { k: 2 }, T0 + ROUTE_CACHE_TTL_MS);
  assert.equal(roomy.get('old', T0), null, '지난 것은 지웠다(옛 시각으로 물어도 없다)');
  assert.deepEqual(roomy.get('new', T0 + ROUTE_CACHE_TTL_MS), { k: 2 });
});

test('중계를 끈 서버(proxy:false)는 /kakao·/osrm도 404다', async () => {
  const up = upstream(() => ({ body: osrmBody() }));
  const server = await startSyncServer({ purgeEveryMs: 0, proxy: false });
  const on = await startSyncServer({ purgeEveryMs: 0, proxy: { fetch: up.fetch } });
  try {
    for (const path of [FOOT, '/kakao/local/keyword?query=abc']) {
      const res = await fetch(`${server.url}${path}`);
      assert.equal(res.status, 404, path);
      assert.deepEqual(await res.json(), { error: 'notFound' });
    }
    assert.equal((await fetch(`${on.url}${FOOT}`)).status, 200, '기본은 중계가 켜져 있다');
    assert.equal((await fetch(`${on.url}/kakao/local/keyword?query=abc`)).status, 503, '기본은 카카오 키 없음');
    assert.equal(up.calls.length, 1);
  } finally {
    await server.close();
    await on.close();
  }
});

describe('경로 캐시 PostgreSQL(PGlite)', () => {
  let pg: PGlite;
  let db: SqlDb;
  let store: PostgresSyncStore;
  before(async () => {
    pg = new PGlite();
    await pg.waitReady;
    db = sqlDb(pg);
    await migrate(db);
    store = createPostgresStore(db, { warn: () => {} });
  });
  after(async () => {
    await pg?.close();
  });

  test('중계 응답이 route_cache에 들어가고, 다음 요청은 DB에서 나간다. 24시간 지나면 보관 정리가 지운다', async () => {
    const up = upstream((u) => ({ body: u.hostname === 'apis-navi.kakaomobility.com' ? KAKAO_ROUTE : osrmBody() }));
    const clock = fixedClock(T0);
    const proxy = createApiProxy({ fetch: up.fetch, cache: store.routeCache, now: () => clock.now(), kakaoKey: KEY });
    assert.equal((await call(proxy, FOOT)).headers['X-Cache'], 'miss');
    await call(proxy, `/kakao/navi/directions?origin=129.2,35.8&destination=129.3,35.9`);
    await call(proxy, '/kakao/local/keyword?query=abc');
    const { rows } = await db.query('SELECT key, response FROM route_cache ORDER BY key');
    assert.deepEqual(
      rows.map((r: { key: string }) => r.key.split(':')[0]),
      ['kakao-navi-directions', 'osrm-route'],
      '장소 검색은 두지 않는다',
    );
    assert.equal(JSON.stringify(rows).includes(KEY), false);
    assert.equal(JSON.stringify(rows).includes('129.2101'), true, '응답 본문 그대로');
    assert.ok(rows.every((r: { key: string }) => /^[a-z-]+:[0-9a-f]{64}$/.test(r.key)), '키는 요청 해시라 좌표가 키에 드러나지 않는다');

    // 같은 DB를 쓰는 다른 서버 프로세스(새 중계)도 캐시를 쓴다
    const again = createApiProxy({ fetch: up.fetch, cache: store.routeCache, now: () => clock.now(), kakaoKey: KEY });
    const hit = await call(again, FOOT);
    assert.equal(hit.headers['X-Cache'], 'hit');
    assert.deepEqual(hit.body, osrmBody());
    assert.equal(up.calls.length, 3);

    clock.advance(ROUTE_CACHE_TTL_MS);
    await store.purgeExpired(clock.now());
    assert.equal((await db.query('SELECT count(*)::int AS c FROM route_cache')).rows[0].c, 0);
  });

  test('HTTP 서버가 PostgreSQL 저장소의 경로 캐시를 쓴다', async () => {
    const up = upstream(() => ({ body: osrmBody() }));
    const server = await startSyncServer({ store, purgeEveryMs: 0, now: () => T0 + 2 * ROUTE_CACHE_TTL_MS, proxy: { fetch: up.fetch } });
    try {
      const path = `/osrm/routed-car/route/v1/driving/${coords(2)}?overview=full&geometries=geojson&steps=true`;
      const first = await fetch(`${server.url}${path}`);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('x-cache'), 'miss');
      assert.equal(first.headers.get('access-control-allow-origin'), '*');
      const second = await fetch(`${server.url}${path}`);
      assert.equal(second.headers.get('x-cache'), 'hit');
      assert.deepEqual(await second.json(), osrmBody());
      assert.equal(up.calls.length, 1);
      assert.equal((await db.query("SELECT count(*)::int AS c FROM route_cache WHERE key LIKE 'osrm-route:%'")).rows[0].c, 1);
    } finally {
      await server.close();
    }
  });
});

describe('HTTP: 앱 어댑터가 키 없이 서버를 거친다', () => {
  const region = regionById('gyeongju') as Region;
  /** 앱 쪽 fetch. 서버로 보낸 주소·헤더를 적는다(실제 HTTP, localhost) */
  function appFetch(): FetchLike & { calls: { url: string; headers?: Record<string, string> }[] } {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fn = (async (url, init) => {
      calls.push({ url, headers: init?.headers });
      const res = await fetch(url, { method: init?.method, headers: init?.headers, body: init?.body });
      return { ok: res.ok, status: res.status, text: () => res.text() };
    }) as FetchLike & { calls: typeof calls };
    fn.calls = calls;
    return fn;
  }

  test('서버에 키가 있으면 장소·자동차는 카카오, 도보 선은 OSRM을 서버가 대신 묻는다. 앱 요청에는 키도 인증 헤더도 없다', async () => {
    const up = upstream((u) => {
      if (u.hostname === 'dapi.kakao.com') return { body: KAKAO_DOCS };
      if (u.hostname === 'apis-navi.kakaomobility.com') return { body: KAKAO_ROUTE };
      return { body: osrmBody([A, { latitude: 35.8301, longitude: 129.2203 }, B]) };
    });
    const server = await startSyncServer({ purgeEveryMs: 0, proxy: { kakaoKey: KEY, fetch: up.fetch, osrmUrl: 'https://osrm.example.test' } });
    try {
      const f = appFetch();
      const places = createKakaoPlaces({ apiUrl: `${server.url}/`, fetch: f, fallback: createLocalPlaces() });
      const found = await places.search('황남빵', region);
      assert.deepEqual(
        found.map((p) => p.placeId),
        ['kakao:101'],
      );
      assert.ok(f.calls[0].url.startsWith(`${server.url}/kakao/local/keyword?query=`));

      const routes = createRouteProvider({ apiUrl: server.url, fetch: f, clock: fixedClock(T0), kv: memoryKV(), roadShapes: {} });
      const car = await routes.route(A, B, 'car');
      assert.equal(car?.road, 'kakao');
      assert.equal(car?.minutes, 12);
      const walk = await routes.route(A, B, 'walk');
      assert.equal(walk?.road, 'osm');
      assert.equal(walk?.polyline.length, 3);

      for (const c of f.calls) {
        assert.ok(c.url.startsWith(server.url), c.url);
        assert.equal(c.headers?.Authorization, undefined);
        assert.equal(c.url.includes(KEY), false);
      }
      assert.deepEqual(
        up.calls.map((c) => new URL(c.url).hostname),
        ['dapi.kakao.com', 'apis-navi.kakaomobility.com', 'osrm.example.test'],
      );
      assert.deepEqual(
        up.calls.map((c) => c.headers.Authorization),
        [`KakaoAK ${KEY}`, `KakaoAK ${KEY}`, undefined],
      );
    } finally {
      await server.close();
    }
  });

  test('서버에 키가 없으면(503) 장소는 로컬 장소 사전, 자동차는 추정으로 넘어간다', async () => {
    const up = upstream(() => ({ body: osrmBody() }));
    const server = await startSyncServer({ purgeEveryMs: 0, proxy: { fetch: up.fetch } });
    try {
      const f = appFetch();
      const places = createKakaoPlaces({ apiUrl: server.url, fetch: f, fallback: createLocalPlaces() });
      const found = await places.search('황남빵', region);
      assert.ok(found.length >= 1);
      assert.ok(found.every((p) => !p.placeId.startsWith('kakao:')), '로컬 장소 사전 결과');

      const routes = createRouteProvider({ apiUrl: server.url, fetch: f, clock: fixedClock(T0), kv: memoryKV() });
      const m = await routes.matrix([A], [B], 'car');
      assert.equal(m.estimated, true);
      assert.ok((m.minutes[0][0] ?? 0) > 0);
      assert.equal(up.calls.length, 0, '카카오 상류에는 묻지 않았다');
    } finally {
      await server.close();
    }
  });
});
