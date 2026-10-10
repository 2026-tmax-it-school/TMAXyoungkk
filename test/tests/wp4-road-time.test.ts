import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import type { FetchLike } from '../src/core/ports';
import { ROUTE_CALL_BUDGET } from '../src/core/constants';
import { buildPlan } from '../src/core/planner';
import { haversineKm } from '../src/core/util';
import { scenarioPlace } from '../src/data/scenario';
import {
  createLocalRoutes,
  createOsmRoutes,
  createRouteCache,
  createRouteProvider,
  KAKAO_FALLBACK_TTL_MS,
  OSM_ROUTING_URL,
  OSM_TABLE_MAX_COORDS,
  OSRM_CAR_TIME_FACTOR,
  osmTableUrl,
  osrmMinutes,
  parseOsmTable,
} from '../src/services/routes';
import { createApiProxy, PROXY_DEFAULTS } from '../server/proxy.mjs';
import { fakeFetch, fixedClock, memoryKV, type FakeFetchCall } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * 실제 길 기준 이동 시간(2026-10-09 결정, WP4). 도로 경로 서버(roadShapes)를 켜면 계획 행렬이 OSRM table로 도보·자동차 시간을 받는다.
 * - 예시 구간표에 있는 구간은 구간표 값(시연 수치)이고 묻지 않는다
 * - 표에 없는 구간은 table 한 번으로 묻고 calls는 구간 수다. 좌표가 많으면 나눠 묻는다
 * - 실패·시간 초과는 직선 추정 + provisional(캐시하지 않음), 길로 못 이은 구간은 직선 추정으로 캐시한다
 * - 자동차 OSRM 시간은 교통 보정 계수를 곱한다. 같은 구간이면 route()와 matrix()가 같은 분이다
 * 네트워크는 쓰지 않는다(URL을 읽어 답하는 가짜 OSRM).
 */

// 예시 데이터 구간표에 없는 경주 시내 점들
const A: LatLng = { latitude: 35.8301, longitude: 129.2101 };
const B: LatLng = { latitude: 35.8352, longitude: 129.2203 };
const C: LatLng = { latitude: 35.8401, longitude: 129.2301 };
const coord = (id: string) => scenarioPlace(id).coord;

/** 기본 가짜 길 시간(초). 도보는 직선 1km에 900초, 자동차는 120초 */
const walkSeconds = (a: LatLng, b: LatLng) => Math.round(haversineKm(a, b) * 900);
const carSeconds = (a: LatLng, b: LatLng) => Math.round(haversineKm(a, b) * 120);

function coordsOf(url: string): LatLng[] {
  const path = new URL(url).pathname;
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
    .split(';')
    .map((p) => {
      const [x, y] = p.split(',').map(Number);
      return { longitude: x, latitude: y };
    });
}

/**
 * URL을 읽어 OSRM처럼 답하는 가짜. table은 sources×destinations 표, route는 두 점 선과 duration.
 * table(a, b)가 null이면 그 칸은 길로 못 이은 것이다. route를 따로 주지 않으면 table과 같은 초다
 */
function osrmFake(
  opts: {
    table?: (a: LatLng, b: LatLng) => number | null;
    route?: (a: LatLng, b: LatLng) => number;
    reply?: (c: FakeFetchCall) => { status?: number; body?: unknown } | undefined;
  } = {},
) {
  return fakeFetch((c) => {
    const special = opts.reply?.(c);
    if (special) return special;
    const u = new URL(c.url);
    const pts = coordsOf(c.url);
    const table = opts.table ?? (u.pathname.includes('/routed-car/') ? carSeconds : walkSeconds);
    if (u.pathname.includes('/table/v1/')) {
      const list = (k: string) => (u.searchParams.get(k) ?? '').split(';').map(Number);
      const src = list('sources');
      const dst = list('destinations');
      return {
        body: {
          code: 'Ok',
          durations: src.map((s) => dst.map((d) => table(pts[s], pts[d]))),
          distances: src.map((s) => dst.map((d) => (table(pts[s], pts[d]) == null ? null : Math.round(haversineKm(pts[s], pts[d]) * 1300)))),
        },
      };
    }
    if (u.pathname.includes('/route/v1/')) {
      const [a, b] = pts;
      return {
        body: {
          code: 'Ok',
          routes: [
            {
              distance: Math.round(haversineKm(a, b) * 1300),
              duration: (opts.route ?? ((x: LatLng, y: LatLng) => table(x, y) ?? 0))(a, b),
              geometry: { coordinates: [[a.longitude, a.latitude], [B.longitude, A.latitude], [b.longitude, b.latitude]] },
              legs: [],
            },
          ],
        },
      };
    }
    return { status: 404, body: { error: 'notFound' } };
  });
}

const tableCalls = (f: { calls: FakeFetchCall[] }) => f.calls.filter((c) => c.url.includes('/table/v1/'));

test('table 주소: 경도,위도 좌표들과 sources·destinations 번호, annotations=duration,distance. 도보 routed-foot, 자동차 routed-car, 대중교통은 묻지 않는다', () => {
  assert.equal(
    osmTableUrl(`${OSM_ROUTING_URL}/`, 'walk', [A, B, C], [0], [1, 2]),
    'https://routing.openstreetmap.de/routed-foot/table/v1/foot/129.2101,35.8301;129.2203,35.8352;129.2301,35.8401?sources=0&destinations=1;2&annotations=duration,distance',
  );
  assert.ok(osmTableUrl(OSM_ROUTING_URL, 'car', [A, B], [0], [1])?.startsWith('https://routing.openstreetmap.de/routed-car/table/v1/driving/'));
  assert.equal(osmTableUrl(OSM_ROUTING_URL, 'transit', [A, B], [0], [1]), undefined);
  assert.equal(OSM_TABLE_MAX_COORDS, PROXY_DEFAULTS.tableMaxCoords, '서버 중계의 좌표 수 상한과 같다');
});

test('table 응답 읽기: 초·미터 표, 길로 못 이은 칸은 null, 크기가 다르거나 code가 Ok가 아니면 실패(null)', () => {
  const ok = parseOsmTable({ code: 'Ok', durations: [[0, 610.4, null]], distances: [[0, 820, null]] }, 1, 3);
  assert.deepEqual(ok, { seconds: [[0, 610.4, null]], meters: [[0, 820, null]] });
  assert.deepEqual(parseOsmTable({ code: 'Ok', durations: [[61]] }, 1, 1)?.meters, [[null]], '거리는 없어도 된다');
  assert.deepEqual(parseOsmTable({ code: 'Ok', durations: [[-1, 'x']] }, 1, 2)?.seconds, [[null, null]], '이상한 값은 길 없음');
  assert.equal(parseOsmTable({ code: 'Ok', durations: [[1, 2]] }, 2, 2), null, '행 수가 다르다');
  assert.equal(parseOsmTable({ code: 'Ok', durations: [[1]] }, 1, 2), null, '열 수가 다르다');
  assert.equal(parseOsmTable({ code: 'InvalidQuery', durations: [[1]] }, 1, 1), null);
  assert.equal(parseOsmTable({ code: 'Ok' }, 1, 1), null);
  assert.equal(parseOsmTable(null, 1, 1), null);
});

test('분 바꾸기: 도보는 OSRM 초 그대로, 자동차는 교통 보정 계수를 곱한다. 1분보다 짧아도 1분이다', () => {
  assert.ok(OSRM_CAR_TIME_FACTOR > 1, '교통 정보가 없어 짧게 나오는 자동차 시간을 늘린다');
  assert.equal(osrmMinutes(1500, 'walk'), 25);
  assert.equal(osrmMinutes(600, 'car'), Math.round(10 * OSRM_CAR_TIME_FACTOR));
  assert.equal(osrmMinutes(10, 'walk'), 1);
  assert.equal(osrmMinutes(0, 'car'), 1);
});

test('행렬: 표에 없는 구간을 table 한 번으로 묻고 calls는 구간 수다(같은 지점 쌍은 0분, 세지 않는다)', async () => {
  const f = osrmFake();
  const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes() });
  const m = await osm.matrix([A, B], [B, C], 'walk');
  assert.equal(f.calls.length, 1, '여러 구간을 한 번에');
  // 같은 좌표는 한 번만 보낸다: A, B, C
  assert.deepEqual(coordsOf(f.calls[0].url), [A, B, C]);
  const q = new URL(f.calls[0].url).searchParams;
  assert.equal(q.get('sources'), '0;1');
  assert.equal(q.get('destinations'), '1;2');
  assert.equal(m.calls, 3, 'A>B, A>C, B>C');
  assert.equal(m.cacheHits, 0);
  assert.equal(m.estimated, false);
  assert.deepEqual(m.minutes, [
    [osrmMinutes(walkSeconds(A, B), 'walk'), osrmMinutes(walkSeconds(A, C), 'walk')],
    [0, osrmMinutes(walkSeconds(B, C), 'walk')],
  ]);
  const car = await osm.matrix([A], [C], 'car');
  assert.ok(f.calls[1].url.includes('/routed-car/table/v1/driving/'));
  assert.equal(car.minutes[0][0], osrmMinutes(carSeconds(A, C), 'car'), '자동차는 교통 보정');
});

test('구간표 우선: 예시 구간표 구간은 묻지 않고 구간표 값이다(시연 수치). 섞인 행렬은 표에 없는 구간만 묻는다', async () => {
  const f = osrmFake();
  const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes() });
  const bul = coord('gj-bulguksa');
  const seok = coord('gj-seokguram');
  // 불국사↔석굴암 자동차 12분(scenario-tuning)
  const known = await osm.matrix([bul, seok], [seok, bul], 'car');
  assert.deepEqual(known.minutes, [
    [12, 0],
    [0, 12],
  ]);
  assert.equal(known.calls, 2);
  assert.equal(known.estimated, false);
  assert.equal(f.calls.length, 0, '구간표 구간은 묻지 않는다');

  const mixed = await osm.matrix([bul], [seok, A], 'car');
  assert.equal(mixed.minutes[0][0], 12);
  assert.equal(mixed.minutes[0][1], osrmMinutes(carSeconds(bul, A), 'car'));
  assert.equal(mixed.calls, 2);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(coordsOf(f.calls[0].url), [bul, A], '표에 없는 구간의 좌표만 보낸다');

  // 경로: 선은 실제 길, 시간은 구간표(불국사→교촌 한정식 28분)
  const leg = await osm.route(bul, coord('gj-gyochon-hanjeongsik'), 'car');
  assert.equal(leg?.road, 'osm');
  assert.equal(leg?.minutes, 28);
  assert.equal(leg?.estimated, false);
  assert.match(leg?.note ?? '', /예시 구간표/);

  // 구간표가 경로 없음(null)이면 묻지 않고 null이다
  const places = [
    { placeId: 'p', coord: A },
    { placeId: 'q', coord: B },
  ];
  const none = { car: {}, walk: { 'p>q': null }, transit: {} };
  const g = osrmFake();
  const noWay = createOsmRoutes({ fetch: g, fallback: createLocalRoutes({ table: none, places }), table: none, places });
  const nm = await noWay.matrix([A], [B, C], 'walk');
  assert.equal(nm.minutes[0][0], null);
  assert.equal(typeof nm.minutes[0][1], 'number');
  assert.deepEqual(coordsOf(g.calls[0].url), [A, C]);
  assert.equal(await noWay.route(A, B, 'walk'), null);
});

test('실패 대체: 503·시간 초과·읽을 수 없는 응답이면 행렬 전체를 직선 추정으로 내고 provisional이다(캐시하지 않고 다음에 다시 묻는다)', async () => {
  const local = createLocalRoutes();
  const expect = await local.matrix([A, B], [B, C], 'walk');
  const failures: [string, FetchLike, number?][] = [
    ['서버 503', fakeFetch(() => ({ status: 503, body: { error: 'busy' } }))],
    ['읽을 수 없는 응답', fakeFetch(() => ({ body: '<html>oops</html>' }))],
    ['표 크기가 다름', fakeFetch(() => ({ body: { code: 'Ok', durations: [[1]] } }))],
    ['다른 400', fakeFetch(() => ({ status: 400, body: { code: 'InvalidQuery' } }))],
    ['닿지 못함', async () => Promise.reject(new Error('Network request failed'))],
    ['시간 초과', () => new Promise(() => {}), 20],
  ];
  for (const [why, f, timeoutMs] of failures) {
    const osm = createOsmRoutes({ fetch: f, fallback: local, timeoutMs });
    const m = await osm.matrix([A, B], [B, C], 'walk');
    assert.deepEqual(m.minutes, expect.minutes, why);
    assert.equal(m.calls, expect.calls, `${why}: 구간 수 그대로`);
    assert.equal(m.estimated, true, why);
    assert.equal((m as { provisional?: boolean }).provisional, true, why);
  }

  // 캐시를 붙이면 실패 값은 두지 않고, 다시 되면 실제 길 값을 둔다
  let down = true;
  const f = osrmFake({ reply: () => (down ? { status: 503, body: { error: 'busy' } } : undefined) });
  const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(createOsmRoutes({ fetch: f, fallback: local }));
  const m1 = await routes.matrix([A], [B], 'walk');
  assert.equal(m1.estimated, true);
  down = false;
  const m2 = await routes.matrix([A], [B], 'walk');
  assert.equal(f.calls.length, 2, '실패는 캐시하지 않는다');
  assert.equal(m2.estimated, false);
  assert.equal(m2.cacheHits, 0);
  assert.equal(m2.minutes[0][0], osrmMinutes(walkSeconds(A, B), 'walk'));
  const m3 = await routes.matrix([A], [B], 'walk');
  assert.equal(f.calls.length, 2, '실제 길 값은 24시간 캐시에서 나온다');
  assert.deepEqual([m3.calls, m3.cacheHits, m3.estimated], [0, 1, false]);
});

test('길로 못 이은 구간: table의 null 칸과 한 구간 400 NoRoute·NoSegment는 직선 추정으로 두고 캐시한다. 여러 구간 400은 임시 결과다', async () => {
  const local = createLocalRoutes();
  const island: LatLng = { latitude: 35.85, longitude: 129.25 };
  const onIsland = (p: LatLng) => p.latitude === island.latitude && p.longitude === island.longitude;
  const f = osrmFake({ table: (a, b) => (onIsland(a) || onIsland(b) ? null : walkSeconds(a, b)) });
  const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(createOsmRoutes({ fetch: f, fallback: local }));
  const m = await routes.matrix([A], [B, island], 'walk');
  assert.equal(m.minutes[0][0], osrmMinutes(walkSeconds(A, B), 'walk'));
  assert.equal(m.minutes[0][1], (await local.matrix([A], [island], 'walk')).minutes[0][0], '직선 추정');
  assert.equal(m.estimated, true);
  await routes.matrix([A], [island], 'walk');
  assert.equal(f.calls.length, 1, '경로 없음은 캐시된다');

  for (const code of ['NoRoute', 'NoSegment']) {
    const g = fakeFetch(() => ({ status: 400, body: { code, message: 'Impossible route between points' } }));
    const r = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(createOsmRoutes({ fetch: g, fallback: local }));
    const one = await r.matrix([A], [B], 'walk');
    assert.equal(one.estimated, true, code);
    assert.deepEqual(one.minutes, (await local.matrix([A], [B], 'walk')).minutes);
    await r.matrix([A], [B], 'walk');
    assert.equal(g.calls.length, 1, `${code}: 한 구간이면 다시 묻지 않는다`);
    const many = await r.matrix([A], [C, island], 'walk');
    assert.equal(many.estimated, true);
    await r.matrix([A], [C, island], 'walk');
    assert.equal(g.calls.length, 3, `${code}: 여러 구간이면 어느 점 때문인지 몰라 다음에 다시 묻는다`);
  }
});

test('route·matrix 일치: 행렬을 먼저 받으면 경로의 분이 행렬 값이다. 경로를 먼저 받으면 행렬이 그 분을 쓰고 묻지 않는다', async () => {
  // table과 route가 일부러 다른 초를 낸다(카카오 실시간 교통처럼 묻는 때마다 다를 수 있다)
  const f = osrmFake({ table: () => 900, route: () => 960 });
  const routes = createRouteProvider({ fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });

  const m = await routes.matrix([A], [B], 'walk');
  assert.equal(m.minutes[0][0], 15);
  const leg = await routes.route(A, B, 'walk');
  assert.equal(leg?.minutes, 15, '계획이 쓴 값과 같다(경로 초 960이 아니다)');
  assert.equal(leg?.estimated, false);
  assert.equal(leg?.road, 'osm');
  assert.equal((await routes.route(A, B, 'walk'))?.minutes, 15, '캐시에서 나와도 같다');

  const before = tableCalls(f).length;
  const first = await routes.route(B, C, 'walk');
  assert.equal(first?.minutes, 16, '경로가 먼저면 경로의 시간');
  const after = await routes.matrix([B], [C], 'walk');
  assert.equal(after.minutes[0][0], 16, '행렬도 같은 분');
  assert.deepEqual([after.calls, after.cacheHits, after.estimated], [0, 1, false], '캐시에서 나온 구간이다');
  assert.equal(tableCalls(f).length, before, 'table에 묻지 않았다');

  // 자동차도 같은 식(교통 보정)이고, 둘 중 하나가 추정이면 맞추지 않는다(대중교통은 언제나 모의 모델)
  const car = await routes.matrix([A], [C], 'car');
  assert.equal(car.minutes[0][0], osrmMinutes(900, 'car'));
  const carLeg = await routes.route(A, C, 'car');
  assert.equal(carLeg?.minutes, car.minutes[0][0]);
  assert.match(carLeg?.note ?? '', /교통 보정/);
  const transit = await routes.matrix([A], [C], 'transit');
  const transitLeg = await routes.route(A, C, 'transit');
  assert.equal(transitLeg?.minutes, transit.minutes[0][0]);
  assert.equal(transitLeg?.estimated, true);
});

test('route: 실제 길 시간이면 estimated가 아니다. 경로에 시간이 없거나 길 서버가 실패하면 시간은 직선 추정이다', async () => {
  const local = createLocalRoutes();
  const real = await createOsmRoutes({ fetch: osrmFake({ route: () => 1100 }), fallback: local }).route(A, B, 'walk');
  assert.deepEqual([real?.minutes, real?.estimated, real?.road], [18, false, 'osm']);
  assert.match(real?.note ?? '', /실제 길 기준/);

  const noTime = fakeFetch(() => ({
    body: { code: 'Ok', routes: [{ distance: 1490, geometry: { coordinates: [[A.longitude, A.latitude], [B.longitude, B.latitude]] }, legs: [] }] },
  }));
  const shapeOnly = await createOsmRoutes({ fetch: noTime, fallback: local }).route(A, B, 'walk');
  const base = await local.route(A, B, 'walk');
  assert.deepEqual([shapeOnly?.minutes, shapeOnly?.estimated, shapeOnly?.road], [base?.minutes, true, 'osm']);
  assert.match(shapeOnly?.note ?? '', /시간은 추정/);

  const failed = await createOsmRoutes({ fetch: fakeFetch(() => ({ status: 503, body: {} })), fallback: local }).route(A, B, 'walk');
  assert.deepEqual([failed?.minutes, failed?.estimated, failed?.provisional], [base?.minutes, true, true]);
});

test('좌표가 상한(50개)을 넘으면 상한 안에서 출발지 여럿씩 묶어 나눠 묻는다. 요청마다 상한 이하이고 calls는 구간 수다', async () => {
  const f = osrmFake();
  const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes() });
  const grid = (n: number, lat0: number) => Array.from({ length: n }, (_, i) => ({ latitude: lat0 + i * 0.001, longitude: 129.2 + (i % 7) * 0.002 }));
  const origins = grid(30, 35.8);
  const destinations = grid(30, 35.9);
  const m = await osm.matrix(origins, destinations, 'walk');
  assert.equal(m.calls, 900);
  assert.equal(m.estimated, false);
  assert.equal(f.calls.length, 2, '출발지 20곳 + 목적지 30곳, 남은 출발지 10곳 + 목적지 30곳(출발지마다 한 번이면 30번)');
  for (const c of f.calls) assert.ok(coordsOf(c.url).length <= OSM_TABLE_MAX_COORDS);
  for (let i = 0; i < 30; i += 1) {
    for (let j = 0; j < 30; j += 1) assert.equal(m.minutes[i][j], osrmMinutes(walkSeconds(origins[i], destinations[j]), 'walk'), `${i},${j}`);
  }

  // 한 출발지의 목적지가 상한을 넘어도 나눈다
  const g = osrmFake();
  const wide = await createOsmRoutes({ fetch: g, fallback: createLocalRoutes() }).matrix([A], grid(120, 35.7), 'walk');
  assert.equal(wide.calls, 120);
  assert.equal(g.calls.length, 3, '49개씩');
  assert.ok(wide.minutes[0].every((v) => typeof v === 'number'));
});

test('서버 중계를 거친 table 요청이 서버 검사를 통과하고, 상류에는 같은 꼴로 간다', async () => {
  const API = 'https://api.example.test';
  const upstream = osrmFake();
  const proxy = createApiProxy({ fetch: upstream, osrmUrl: 'https://osrm.example.test', ratePerMin: 0 });
  const app: FetchLike & { calls: string[] } = Object.assign(
    async (url: string) => {
      app.calls.push(url);
      const u = new URL(url);
      const r = await proxy.handle({ method: 'GET', url: u, rawLength: u.pathname.length + u.search.length });
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
    },
    { calls: [] as string[] },
  );
  const routes = createRouteProvider({ apiUrl: API, fetch: app, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const m = await routes.matrix([A], [B], 'walk');
  assert.equal(m.estimated, false);
  assert.equal(m.minutes[0][0], osrmMinutes(walkSeconds(A, B), 'walk'));
  assert.ok(app.calls[0].startsWith(`${API}/osrm/routed-foot/table/v1/foot/`));
  // 서버는 매개변수를 이름 순으로 다시 적는다. 경로와 값은 앱이 만든 그대로다
  assert.equal(upstream.calls.length, 1);
  const sent = new URL(app.calls[0]);
  const got = new URL(upstream.calls[0].url);
  assert.equal(`${got.origin}${got.pathname}`, `https://osrm.example.test${sent.pathname.slice('/osrm'.length)}`);
  assert.deepEqual(Object.fromEntries(got.searchParams), Object.fromEntries(sent.searchParams));
});

test('자동차: 카카오가 있으면 카카오가 먼저다. 서버에 카카오 키가 없으면 실제 길(OSRM) 값을 짧게만 캐시하고, 키가 들어오면 그 뒤 카카오다', async () => {
  const API = 'https://api.example.test';
  let kakaoUp = false;
  const kakaoRoute = { routes: [{ result_code: 0, summary: { distance: 4210, duration: 720 }, sections: [] }] };
  const f = osrmFake({
    reply: (c) => {
      if (!new URL(c.url).pathname.startsWith('/kakao/')) return undefined;
      return kakaoUp ? { body: kakaoRoute } : { status: 503, body: { error: 'kakaoDisabled' } };
    },
  });
  const clock = fixedClock(0);
  const routes = createRouteProvider({ apiUrl: API, fetch: f, clock, kv: memoryKV(), roadShapes: {} });
  const m1 = await routes.matrix([A], [C], 'car');
  assert.equal(m1.minutes[0][0], osrmMinutes(carSeconds(A, C), 'car'), '서버에 카카오 키가 없으면 실제 길 시간');
  assert.equal(m1.estimated, false);
  assert.ok(tableCalls(f).some((c) => c.url.startsWith(`${API}/osrm/routed-car/table/v1/driving/`)));
  kakaoUp = true;
  const cached = await routes.matrix([A], [C], 'car');
  assert.deepEqual([cached.minutes[0][0], cached.cacheHits], [m1.minutes[0][0], 1], '짧은 보관 시간 안에는 캐시(재계산마다 다시 묻지 않는다)');
  clock.advance(KAKAO_FALLBACK_TTL_MS + 1);
  const m2 = await routes.matrix([A], [C], 'car');
  assert.equal(m2.minutes[0][0], 12, '보관 시간이 지나면 카카오 값');
  assert.equal(m2.cacheHits, 0);
  const walk = await routes.matrix([A], [C], 'walk');
  assert.equal(walk.minutes[0][0], osrmMinutes(walkSeconds(A, C), 'walk'), '도보는 카카오가 있어도 OSRM');
});

test('예산: 도로 경로 서버를 켠 계획도 재계산 1회 100구간 이하이고 routeCalls는 구간 수다. 길 서버 요청은 구간 수를 넘지 않고, 다시 계산하면 캐시에서 나온다', async () => {
  const f = osrmFake();
  const routes = createRouteProvider({ fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const trip = scenarioTrip();
  const p1 = await buildPlan(trip, { routes, now: 0 });
  assert.ok(p1.routeCalls > 0);
  assert.ok(p1.routeCalls <= ROUTE_CALL_BUDGET, `${p1.routeCalls}구간`);
  assert.ok(tableCalls(f).length <= p1.routeCalls, `table ${tableCalls(f).length}번`);
  assert.equal(f.calls.length, tableCalls(f).length, '계획은 경로(route)를 부르지 않는다');

  const before = f.calls.length;
  const p2 = await buildPlan(trip, { routes, now: 0 });
  assert.equal(p2.routeCalls, 0);
  assert.ok(p2.cacheHits > 0);
  assert.equal(f.calls.length, before);
  assert.deepEqual(
    p2.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
    p1.days.map((d) => d.items.map((i) => [i.spotId, i.arrive])),
  );

  // 예산 안에서 모든 구간을 물은 계획은 구간표 또는 실제 길 시간이라 추정 표시('시간 추정')가 없다
  const small = { ...trip, spots: trip.spots.slice(0, 5) };
  const p3 = await buildPlan(small, { routes: createRouteProvider({ fetch: osrmFake(), clock: fixedClock(0), kv: memoryKV(), roadShapes: {} }), now: 0 });
  assert.ok(p3.routeCalls < ROUTE_CALL_BUDGET);
  assert.ok(p3.days.some((d) => d.items.length > 0));
  assert.equal(p3.estimated, false);
  assert.ok(p3.days.every((d) => d.items.every((it) => !it.legEstimated) && !d.returnLeg?.estimated));
  const plain = await buildPlan(small, { routes: createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(0), kv: memoryKV() }), now: 0 });
  assert.equal(plain.estimated, true, '길 서버가 없으면 표에 없는 구간은 직선 추정');
});
