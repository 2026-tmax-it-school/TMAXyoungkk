import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import type { FetchLike, Region } from '../src/core/ports';
import { parseApiUrl, parseRoadShapes, pickKakaoKey, roadShapeSource } from '../src/config';
import { regionById } from '../src/data/regions';
import { scenarioPlace } from '../src/data/scenario';
import { createKakaoClient, isKakaoDisabled, KAKAO_PROXY_PATHS, KakaoHttpError } from '../src/services/kakaoHttp';
import { createKakaoPlaces, KAKAO_CATEGORY_URL, KAKAO_KEYWORD_URL } from '../src/services/places/kakao';
import { createLocalPlaces } from '../src/services/places/local';
import {
  createKakaoRoutes,
  createLocalRoutes,
  createRouteProvider,
  KAKAO_DIRECTIONS_URL,
  KAKAO_FALLBACK_TTL_MS,
  OSM_PROXY_PATH,
  OSM_ROUTING_URL,
  osmProxyBase,
  osmRouteUrl,
} from '../src/services/routes';
import { KAKAO_ROUTES } from '../server/proxy.mjs';
import { KAKAO_ADDRESS_URL, KAKAO_REGION_CODE_URL } from '../src/services/regions';
import { fakeFetch, fixedClock, memoryKV, type FakeFetchCall } from './helpers/fakes';

/**
 * 키 숨기는 서버를 거치는 앱 쪽(EXPO_PUBLIC_API_URL, 2026-10-09 결정). fakeFetch로 본다(네트워크 없음).
 * - 카카오 요청은 서버 주소로 가고 키도 인증 헤더도 없다. 키를 같이 줘도 쓰지 않는다
 * - 도로 모양 기본 주소가 서버의 /osrm이고 주소 꼴은 공개 서버와 같다
 * - 서버 경유에서 실패하면(서버에 카카오 키 없음 503, 일시 503·429·5xx, 닿지 못함, 시간 초과) 장소는 로컬 장소 사전,
 *   자동차는 실제 길(OSRM, wp4-road-time) · 로컬 모델(구간표 우선)로 넘어가고 그 결과는 캐시에 두지 않는다. 그동안 제공자 id는 'local'이다.
 *   서버에 카카오 키 없음(503 kakaoDisabled)이면 실제 대체 값은 짧게만 캐시한다(쉬는 시간은 wp4-kakao-off)
 * - 예시 구간표에 있는 자동차 구간은 카카오가 있어도 구간표 시간이다(2026-10-09 결정)
 * - 설정 고르기(config.ts의 순수 함수)
 * 실제 HTTP 서버를 거치는 통합은 tests/wp2-proxy.test.ts가 본다.
 */

const API = 'https://api.example.test';
const region = regionById('gyeongju') as Region;
const A: LatLng = { latitude: 35.8301, longitude: 129.2101 };
const B: LatLng = { latitude: 35.8352, longitude: 129.2203 };
const coord = (id: string) => scenarioPlace(id).coord;

const KAKAO_DOCS = {
  documents: [{ id: '101', place_name: '황남빵', category_group_code: 'FD6', x: '129.2104', y: '35.8371', distance: '120' }],
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
const OSRM = {
  code: 'Ok',
  routes: [
    {
      distance: 1490,
      geometry: { coordinates: [[129.2101, 35.8301], [129.2203, 35.8301], [129.2203, 35.8352]] },
      legs: [{ steps: [{ distance: 1490, name: '첨성로', maneuver: { type: 'depart', bearing_after: 88 } }] }],
    },
  ],
};
const OFF = { status: 503, body: { error: 'kakaoDisabled', reason: '서버에 KAKAO_REST_KEY가 없어 카카오를 중계하지 않는다' } };

/** 서버 흉내. kakao는 카카오 경로 응답(없으면 503), 나머지는 OSRM */
function serverFetch(kakao: { status?: number; body?: unknown } | undefined = undefined) {
  return fakeFetch((c) => {
    const u = new URL(c.url);
    if (u.pathname.startsWith('/kakao/')) return kakao ?? OFF;
    if (u.pathname.startsWith('/osrm/')) return { body: OSRM };
    return { status: 404, body: { error: 'notFound' } };
  });
}

function assertNoKey(calls: FakeFetchCall[], key?: string) {
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${API}/`), c.url);
    assert.equal(c.init?.headers?.Authorization, undefined, c.url);
    if (key) assert.equal(c.url.includes(key), false, c.url);
  }
}

test('카카오 주소와 서버 중계 경로가 짝이 맞다(server/proxy.mjs KAKAO_ROUTES)', () => {
  assert.deepEqual(
    Object.keys(KAKAO_PROXY_PATHS).sort(),
    [KAKAO_DIRECTIONS_URL, KAKAO_CATEGORY_URL, KAKAO_KEYWORD_URL, KAKAO_ADDRESS_URL, KAKAO_REGION_CODE_URL].sort(),
  );
  for (const [url, path] of Object.entries(KAKAO_PROXY_PATHS)) {
    const route = KAKAO_ROUTES[path.replace(/^\/kakao\//, '')];
    assert.ok(route, path);
    assert.equal(route.upstream, url, '서버가 같은 카카오 주소로 넘긴다');
  }
});

test('서버 경유 클라이언트: 서버 경로로 보내고 키·인증 헤더가 없다. 키를 같이 줘도 쓰지 않는다. 중계하지 않는 주소와 POST는 던진다', async () => {
  const f = fakeFetch(() => ({ body: KAKAO_DOCS }));
  const client = createKakaoClient({ apiUrl: `${API}/`, key: 'APP-KEY', fetch: f });
  assert.equal(client.viaServer, true);
  await client.get(KAKAO_KEYWORD_URL, { query: '불국사', x: 129.3, y: 35.79, radius: undefined });
  assert.equal(f.calls[0].url, `${API}/kakao/local/keyword?query=%EB%B6%88%EA%B5%AD%EC%82%AC&x=129.3&y=35.79`);
  assert.deepEqual(f.calls[0].init, { method: 'GET' });
  assertNoKey(f.calls, 'APP-KEY');

  await assert.rejects(() => client.get('https://dapi.kakao.com/v2/local/geo/coord2address.json', { x: 1, y: 2 }), /중계하지 않는/);
  await assert.rejects(() => client.post(KAKAO_DIRECTIONS_URL, {}), /POST/);
  assert.equal(f.calls.length, 1);

  const direct = createKakaoClient({ key: 'APP-KEY', fetch: f });
  assert.equal(direct.viaServer, false);
  await direct.get(KAKAO_KEYWORD_URL, { query: 'a' });
  assert.equal(f.calls[1].init?.headers?.Authorization, 'KakaoAK APP-KEY', '직접 호출(시연 한정)은 그대로다');
});

test('실패는 상태 코드와 서버 본문의 error를 담아 던진다. 서버에 키가 없는 것(503 kakaoDisabled)과 일시 장애를 가른다', async () => {
  for (const [status, body, code, disabled] of [
    [503, OFF.body, 'kakaoDisabled', true],
    [503, { errorType: 'ServiceUnavailable' }, undefined, false],
    [503, { error: 'busy' }, 'busy', false],
    [500, {}, undefined, false],
    [429, { errorType: 'RateLimitExceeded' }, undefined, false],
    [401, '<html>denied</html>', undefined, false],
  ] as const) {
    const client = createKakaoClient({ apiUrl: API, fetch: fakeFetch(() => ({ status, body })) });
    const err = await client.get(KAKAO_KEYWORD_URL, { query: 'a' }).catch((e: unknown) => e);
    assert.ok(err instanceof KakaoHttpError);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    assert.equal(isKakaoDisabled(err), disabled, `${status} ${String(code)}`);
    assert.equal(client.lastError(), code ? `HTTP ${status} ${code}` : `HTTP ${status}`);
  }
  const down = createKakaoClient({
    apiUrl: API,
    fetch: async () => {
      throw new Error('Network request failed');
    },
  });
  const err = await down.get(KAKAO_KEYWORD_URL, { query: 'a' }).catch((e: unknown) => e);
  assert.ok(err instanceof KakaoHttpError);
  assert.equal(err.status, 0, '서버에 닿지 못하면 상태 0');
  assert.equal(err.code, 'network');
  assert.equal(isKakaoDisabled(err), false);
});

test('카카오 요청에는 시간 제한이 있다(서버에 닿지 못해 멈춘 요청을 끝없이 기다리지 않는다)', async () => {
  const hang: FetchLike = () => new Promise(() => {});
  const client = createKakaoClient({ apiUrl: API, fetch: hang, timeoutMs: 20 });
  const err = await client.get(KAKAO_KEYWORD_URL, { query: 'a' }).catch((e: unknown) => e);
  assert.ok(err instanceof KakaoHttpError);
  assert.equal(err.status, 0);
  assert.equal(err.code, 'timeout');
  assert.equal(client.lastError(), '시간 초과');
  // 서버 경유는 시간 초과도 로컬 대체로 넘어간다(장소는 로컬 장소 사전, 자동차는 추정 경로)
  const local = createLocalPlaces();
  const places = createKakaoPlaces({ apiUrl: API, fetch: hang, fallback: local, timeoutMs: 20 });
  assert.deepEqual(await places.search('불국사', region), await local.search('불국사', region));
  assert.equal(places.id, 'local');
  const routes = createKakaoRoutes({ apiUrl: API, fetch: hang, fallback: createLocalRoutes(), timeoutMs: 20 });
  const car = await routes.route(A, B, 'car');
  assert.equal(car?.estimated, true);
  assert.equal(car?.provisional, true);
});

test('서버에 닿지 못하면 다음 요청 하나만 다시 확인하고, 확인하는 동안 다른 요청은 기다리지 않고 바로 실패한다', async () => {
  let reachable = false;
  const calls: string[] = [];
  const f: FetchLike = async (url) => {
    calls.push(url);
    await new Promise((r) => setTimeout(r, 5));
    if (!reachable) throw new Error('Network request failed');
    return { ok: true, status: 200, text: async () => JSON.stringify(KAKAO_DOCS) };
  };
  const client = createKakaoClient({ apiUrl: API, fetch: f });
  const first = await client.get(KAKAO_KEYWORD_URL, { query: 'a' }).catch((e: unknown) => e);
  assert.ok(first instanceof KakaoHttpError && first.code === 'network');
  // 확인 요청이 나가 있는 동안 나머지는 서버에 묻지 않는다
  const probe = client.get(KAKAO_KEYWORD_URL, { query: 'b' }).catch((e: unknown) => e);
  const quick = await Promise.all([1, 2, 3].map((i) => client.get(KAKAO_KEYWORD_URL, { query: `q${i}` }).catch((e: unknown) => e)));
  for (const e of quick) assert.ok(e instanceof KakaoHttpError && e.status === 0 && e.code === 'unreachable');
  assert.equal(calls.length, 2, '처음 요청과 확인 요청만 나갔다');
  assert.ok((await probe) instanceof KakaoHttpError);
  // 서버가 돌아오면 확인 요청이 성공하고 그 뒤로는 그대로 묻는다
  reachable = true;
  assert.deepEqual(await client.get(KAKAO_KEYWORD_URL, { query: 'c' }), KAKAO_DOCS);
  await Promise.all([client.get(KAKAO_KEYWORD_URL, { query: 'd' }), client.get(KAKAO_KEYWORD_URL, { query: 'e' })]);
  assert.equal(calls.length, 5);
  // 직접 호출에는 이 규칙이 없다(서버 경유만)
  const direct = createKakaoClient({ key: 'K', fetch: f });
  reachable = false;
  await direct.get(KAKAO_KEYWORD_URL, { query: 'a' }).catch(() => undefined);
  const both = await Promise.all([1, 2].map(() => direct.get(KAKAO_KEYWORD_URL, { query: 'a' }).catch((e: unknown) => e)));
  for (const e of both) assert.ok(e instanceof KakaoHttpError && e.code === 'network');
});

test('장소 서버 경유: 실패하면(서버에 키 없음 503, 일시 503·429·500, 닿지 못함) search·nearby·at이 로컬 장소 사전으로 넘어가고 id가 local이 된다. 다시 되면 kakao다', async () => {
  const local = createLocalPlaces();
  const ok = serverFetch({ body: KAKAO_DOCS });
  const places = createKakaoPlaces({ apiUrl: API, fetch: ok, fallback: local });
  assert.equal(places.id, 'kakao');
  assert.deepEqual(
    (await places.search('황남빵', region)).map((p) => p.placeId),
    ['kakao:101'],
  );
  assert.ok(ok.calls[0].url.startsWith(`${API}/kakao/local/keyword?`));
  // anywhere(자유 길찾기, 여행방 지역 없음)면 지역 반경 단계 없이 전국에서 한 번만 찾는다
  const anywhere = serverFetch({ body: KAKAO_DOCS });
  await createKakaoPlaces({ apiUrl: API, fetch: anywhere, fallback: local }).search('황남빵', region, undefined, { anywhere: true });
  assert.equal(anywhere.calls.length, 1);
  assert.ok(!anywhere.calls[0].url.includes('radius='));
  await places.nearby(coord('gj-bulguksa'), 800);
  assert.ok(ok.calls.slice(1).every((c) => c.url.startsWith(`${API}/kakao/local/category?`)));
  assertNoKey(ok.calls);

  const failures: [string, FetchLike][] = [
    ['서버에 키 없음', serverFetch()],
    ['카카오 일시 503', serverFetch({ status: 503, body: { errorType: 'ServiceUnavailable' } })],
    ['카카오 한도 429', serverFetch({ status: 429, body: { errorType: 'RateLimitExceeded' } })],
    ['서버 500', serverFetch({ status: 500, body: {} })],
    [
      '서버에 닿지 못함',
      async () => {
        throw new Error('Network request failed');
      },
    ],
  ];
  for (const [why, f] of failures) {
    const fallback = createKakaoPlaces({ apiUrl: API, fetch: f, fallback: local });
    assert.deepEqual(await fallback.search('황남빵', region), await local.search('황남빵', region), why);
    assert.equal(fallback.id, 'local', `${why}: 예시 데이터 결과라 id가 local`);
    assert.deepEqual(await fallback.nearby(coord('gj-bulguksa'), 800), await local.nearby(coord('gj-bulguksa'), 800), why);
    assert.deepEqual(await fallback.at(coord('gj-bulguksa'), 100), await local.at(coord('gj-bulguksa'), 100), why);
  }
  assert.ok((await local.search('황남빵', region)).length >= 2, '로컬 사전의 동명 장소');

  // 서버가 돌아오면 다시 카카오다
  let up = false;
  const flaky = createKakaoPlaces({
    apiUrl: API,
    fetch: fakeFetch(() => (up ? { body: KAKAO_DOCS } : OFF)),
    fallback: local,
  });
  await flaky.search('황남빵', region);
  assert.equal(flaky.id, 'local');
  up = true;
  assert.deepEqual(
    (await flaky.search('황남빵', region)).map((p) => p.placeId),
    ['kakao:101'],
  );
  assert.equal(flaky.id, 'kakao');

  const direct = createKakaoPlaces({ key: 'K', fetch: fakeFetch(() => OFF) });
  await assert.rejects(() => direct.search('황남빵', region), /503/, '대체를 주지 않으면(직접 호출) 그대로 던진다');
});

test('도로 모양: 서버 주소가 있으면 기본 주소가 서버의 /osrm이고 주소 꼴은 공개 서버와 같다. 따로 준 주소가 먼저다', async () => {
  assert.equal(OSM_PROXY_PATH, '/osrm');
  assert.equal(osmProxyBase(`${API}//`), `${API}/osrm`);
  const viaServer = osmRouteUrl(osmProxyBase(API), 'walk', A, B);
  const pub = osmRouteUrl(OSM_ROUTING_URL, 'walk', A, B);
  assert.equal(viaServer?.slice(`${API}/osrm`.length), pub?.slice(OSM_ROUTING_URL.length));

  const f = serverFetch({ body: KAKAO_ROUTE });
  const routes = createRouteProvider({ apiUrl: API, fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const walk = await routes.route(A, B, 'walk');
  assert.equal(walk?.road, 'osm');
  assert.equal(f.calls[0].url, viaServer);
  assert.deepEqual(f.calls[0].init, { method: 'GET' });

  const mine = fakeFetch(() => ({ body: OSRM }));
  const custom = createRouteProvider({
    apiUrl: API,
    fetch: mine,
    clock: fixedClock(0),
    kv: memoryKV(),
    roadShapes: { baseUrl: 'https://osrm.mine.test' },
  });
  await custom.route(A, B, 'walk');
  assert.ok(mine.calls[0].url.startsWith('https://osrm.mine.test/routed-foot/route/v1/foot/'));

  const plain = fakeFetch(() => ({ body: OSRM }));
  await createRouteProvider({ fetch: plain, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} }).route(A, B, 'walk');
  assert.ok(plain.calls[0].url.startsWith(`${OSM_ROUTING_URL}/routed-foot/`), '서버 주소가 없으면 공개 서버');
});

test('경로 서버 경유: 자동차는 키 없이 서버 길찾기로 간다. 키를 같이 줘도 쓰지 않는다', async () => {
  const f = serverFetch({ body: KAKAO_ROUTE });
  const routes = createRouteProvider({ apiUrl: API, kakaoKey: 'APP-KEY', fetch: f, clock: fixedClock(0), kv: memoryKV() });
  assert.equal(routes.id, 'kakao');
  const car = await routes.route(A, B, 'car');
  assert.equal(car?.road, 'kakao');
  assert.equal(car?.minutes, 12);
  assert.equal(car?.estimated, false);
  const u = new URL(f.calls[0].url);
  assert.equal(`${u.origin}${u.pathname}`, `${API}/kakao/navi/directions`);
  assert.equal(u.searchParams.get('origin'), `${A.longitude},${A.latitude}`);
  assert.equal(u.searchParams.get('priority'), 'RECOMMEND');
  const m = await routes.matrix([A], [{ latitude: 35.8401, longitude: 129.2301 }], 'car');
  assert.equal(m.minutes[0][0], 12);
  assert.equal(m.estimated, false);
  assert.equal(f.calls.length, 2);
  assertNoKey(f.calls, 'APP-KEY');
});

test('예시 구간표에 있는 자동차 구간은 카카오가 있어도 구간표 시간이다. 행렬은 묻지 않고, 경로는 선 모양만 카카오다', async () => {
  const local = createLocalRoutes();
  // 불국사↔석굴암 12분, 불국사→교촌 한정식 28분(scenario-tuning)
  const pts = [coord('gj-bulguksa'), coord('gj-seokguram')];
  for (const opts of [{ apiUrl: API }, { key: 'K' }]) {
    const f = fakeFetch(() => ({ body: KAKAO_ROUTE }));
    const kakao = createKakaoRoutes({ ...opts, fetch: f, fallback: local });
    const m = await kakao.matrix(pts, pts, 'car');
    const expect = await local.matrix(pts, pts, 'car');
    assert.deepEqual(m.minutes, expect.minutes, '시연 수치 그대로(불국사-석굴암 12분 등)');
    assert.equal(m.calls, expect.calls, '구간 수로 센다(로컬 모드와 같은 건수)');
    assert.equal(f.calls.length, 0, '구간표 구간은 카카오에 묻지 않는다');
    // 표에 없는 구간만 카카오
    const mixed = await kakao.matrix([coord('gj-bulguksa')], [coord('gj-seokguram'), A], 'car');
    assert.equal(mixed.minutes[0][0], 12);
    assert.equal(mixed.minutes[0][1], 12);
    assert.equal(f.calls.length, 1);
    // 경로: 선은 카카오, 시간은 구간표
    const leg = await kakao.route(coord('gj-bulguksa'), coord('gj-gyochon-hanjeongsik'), 'car');
    assert.equal(leg?.road, 'kakao');
    assert.equal(leg?.minutes, 28);
    assert.equal(leg?.meters, 4210, '거리·선은 카카오');
    assert.equal(leg?.estimated, false);
    assert.match(leg?.note ?? '', /예시 구간표/);
  }
});

test('경로 서버 경유: 실패하면 행렬은 로컬 모델(구간표 우선), 경로는 도로 모양으로 넘어간다. 서버에 키 없음의 실제 대체 값은 짧게만, 임시 값은 두지 않는다. 직접 호출은 던진다', async () => {
  const local = createLocalRoutes();
  const pts = [coord('gj-bulguksa'), coord('gj-seokguram')];
  const C: LatLng = { latitude: 35.8401, longitude: 129.2301 };

  const failures: [string, FetchLike][] = [
    ['서버에 키 없음', serverFetch()],
    ['카카오 일시 503', serverFetch({ status: 503, body: { errorType: 'ServiceUnavailable' } })],
    ['카카오 한도 429', serverFetch({ status: 429, body: {} })],
    ['서버 500', serverFetch({ status: 500, body: {} })],
  ];
  for (const [why, f] of failures) {
    const kakao = createKakaoRoutes({ apiUrl: API, fetch: f, fallback: local });
    const m = await kakao.matrix([A, B], [B, C], 'car');
    const expect = await local.matrix([A, B], [B, C], 'car');
    assert.deepEqual(m.minutes, expect.minutes, why);
    assert.equal(m.calls, expect.calls, `${why}: 서버 시도는 호출 수에 더하지 않는다`);
    assert.equal(m.estimated, true);
    assert.equal(kakao.id, 'local', why);
  }

  // 캐시까지 붙인 제공자: 임시 결과(OSRM table도 실패)는 두지 않고, 실제 대체 값(OSRM 길 모양)은 짧게만 둔다.
  // 서버에 키를 넣으면 짧은 보관 시간이 지난 뒤 카카오에 다시 묻는다
  let up = false;
  const f = fakeFetch((c) => {
    const u = new URL(c.url);
    if (u.pathname.startsWith('/osrm/')) return { body: OSRM };
    return up ? { body: KAKAO_ROUTE } : OFF;
  });
  const clock = fixedClock(0);
  const routes = createRouteProvider({ apiUrl: API, fetch: f, clock, kv: memoryKV(), roadShapes: {} });
  const m1 = await routes.matrix([A], [C], 'car');
  assert.equal(m1.estimated, true);
  assert.equal(m1.calls, 1);
  assert.equal(routes.id, 'local', '캐시·대중교통 감싸기를 지나도 id가 바뀐다');
  const t1 = await routes.matrix(pts, pts, 'car');
  assert.deepEqual(t1.minutes, (await local.matrix(pts, pts, 'car')).minutes, '구간표 값(불국사-석굴암 12분)');
  const car1 = await routes.route(A, B, 'car');
  assert.equal(car1?.road, 'osm', '선은 서버를 거친 OSRM 길');
  assert.equal(car1?.estimated, true);
  assert.equal(car1?.provisional, undefined, '서버에 키 없음의 실제 대체 경로는 임시 결과가 아니다');
  assert.equal((car1 as { ttlMs?: number } | null)?.ttlMs, KAKAO_FALLBACK_TTL_MS, '짧게만 캐시한다');
  assert.ok(f.calls.some((c) => c.url.startsWith(`${API}/osrm/routed-car/route/v1/driving/`)));
  assertNoKey(f.calls);

  up = true;
  const before = f.calls.length;
  const m2 = await routes.matrix([A], [C], 'car');
  assert.equal(m2.minutes[0][0], 12, '서버가 돌아오면 카카오 값');
  assert.equal(m2.estimated, false);
  assert.equal(m2.cacheHits, 0, '임시 대체 값은 캐시에 없었다');
  assert.equal((await routes.route(A, B, 'car'))?.road, 'osm', '짧은 보관 시간 안에는 대체 경로가 캐시에서 나온다');
  assert.equal(f.calls.length, before + 1);
  clock.advance(KAKAO_FALLBACK_TTL_MS + 1);
  const car2 = await routes.route(A, B, 'car');
  assert.equal(car2?.road, 'kakao', '보관 시간이 지나면 카카오에 다시 묻는다');
  assert.equal(car2?.provisional, undefined);
  assert.equal(routes.id, 'kakao');
  assert.equal(f.calls.length, before + 2);
  // 이번 것은 캐시된다
  await routes.matrix([A], [C], 'car');
  await routes.route(A, B, 'car');
  assert.equal(f.calls.length, before + 2);

  const down = createKakaoRoutes({
    apiUrl: API,
    fetch: async () => {
      throw new Error('Network request failed');
    },
    fallback: local,
  });
  assert.equal((await down.route(A, B, 'car'))?.provisional, true, '서버에 닿지 못해도 대체');
  const direct = createKakaoRoutes({ key: 'K', fetch: fakeFetch(() => OFF), fallback: local });
  await assert.rejects(() => direct.matrix([A], [B], 'car'), /503/, '직접 호출은 503도 던진다(계획이 직선거리로 대체)');
  await assert.rejects(() => direct.route(A, B, 'car'), /503/);
  assert.equal(direct.id, 'kakao');
});

test('도로 모양: OSRM이 길로 이을 수 없다고 하면(400 NoRoute·NoSegment) 직선 추정을 그대로 두고 캐시한다. 다른 실패는 임시 결과다', async () => {
  for (const code of ['NoRoute', 'NoSegment']) {
    const f = fakeFetch(() => ({ status: 400, body: { code, message: 'Impossible route between points' } }));
    const routes = createRouteProvider({ apiUrl: API, fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
    const walk = await routes.route(A, B, 'walk');
    assert.equal(walk?.provisional, undefined, code);
    assert.equal(walk?.road, undefined);
    assert.equal(walk?.polyline.length, 2, '두 점 직선');
    await routes.route(A, B, 'walk');
    assert.equal(f.calls.length, 1, `${code}: 같은 구간을 다시 묻지 않는다`);
  }
  const busy = fakeFetch(() => ({ status: 503, body: { error: 'busy' } }));
  const routes = createRouteProvider({ apiUrl: API, fetch: busy, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  assert.equal((await routes.route(A, B, 'walk'))?.provisional, true);
  await routes.route(A, B, 'walk');
  assert.equal(busy.calls.length, 2, '서버가 바쁘면 다음에 다시 묻는다');
  const bad = fakeFetch(() => ({ status: 400, body: { code: 'InvalidQuery' } }));
  const r2 = createRouteProvider({ apiUrl: API, fetch: bad, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  assert.equal((await r2.route(A, B, 'walk'))?.provisional, true, '다른 400은 실패로 본다');
});

test('설정 고르기: 서버 주소는 http(s)만, 서버 주소가 있으면 카카오 키를 쓰지 않고 남은 키를 알린다, 도로 모양 끄기(off·false·0·no·none)와 출처', () => {
  assert.equal(parseApiUrl(' http://192.168.0.5:8787/ '), 'http://192.168.0.5:8787');
  assert.equal(parseApiUrl('https://api.example.test//'), 'https://api.example.test');
  for (const bad of [undefined, '', '192.168.0.5:8787', 'ftp://x', 'http://', 'http:///x', 'http://a b']) {
    assert.equal(parseApiUrl(bad), '', String(bad));
  }
  assert.deepEqual(pickKakaoKey('', 'APP-KEY'), { key: 'APP-KEY', ignored: false });
  assert.deepEqual(pickKakaoKey('', undefined), { key: '', ignored: false });
  assert.deepEqual(pickKakaoKey(API, 'APP-KEY'), { key: '', ignored: true }, '서버 주소가 있으면 키를 쓰지 않는다(번들에는 남는다)');
  assert.deepEqual(pickKakaoKey(API, ''), { key: '', ignored: false });

  assert.equal(parseRoadShapes('off'), undefined);
  assert.equal(parseRoadShapes(' OFF '), undefined);
  for (const off of ['false', 'FALSE', '0', 'no', 'No', 'none', ' none ']) assert.equal(parseRoadShapes(off), undefined, `${off}: 끈다`);
  for (const on of ['', 'on', 'true', '1', 'yes']) assert.deepEqual(parseRoadShapes(on), {}, `${on}: 기본 주소`);
  assert.deepEqual(parseRoadShapes(undefined), {});
  assert.deepEqual(parseRoadShapes('https://osrm.mine.test'), { baseUrl: 'https://osrm.mine.test' });
  assert.equal(roadShapeSource(parseRoadShapes(''), API), 'server');
  assert.equal(roadShapeSource(parseRoadShapes(''), ''), 'public');
  assert.equal(roadShapeSource(parseRoadShapes('https://osrm.mine.test'), API), 'custom');
  assert.equal(roadShapeSource(parseRoadShapes('off'), API), undefined);
});
