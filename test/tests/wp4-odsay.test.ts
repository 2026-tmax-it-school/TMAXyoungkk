import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import {
  createRouteProvider,
  INTERCITY_KM,
  ODSAY_FALLBACK_TTL_MS,
  odsayErrorCode,
  odsayStepText,
  parseOdsayLanes,
  parseOdsayRoute,
  transitBreakdown,
} from '../src/services/routes';
import { SCENARIO_TRANSIT } from '../src/data/scenario-tuning';
import { haversineKm } from '../src/core/util';
import { createApiProxy, isProxyPath, ODSAY_ROUTES, type UpstreamFetch } from '../server/proxy.mjs';
import { createSyncStore } from '../server/sync-server.mjs';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';

/**
 * WP4 대중교통 실제 노선(ODsay, 서버 경유). 사용자가 따라 탈 수 있게 버스 번호·지하철 노선·승하차 정류장·정류장 수를 안내하고,
 * 선은 노선(또는 지나는 정류장)을 따른다. ODsay를 못 쓰면 추정 모델이고, 장거리는 시외(열차·고속버스)로 추정한다
 * (예전 서울역 → 경주역 18시간 문제). 서버 중계는 키를 서버에만 두고 응답에서 가린다.
 */

const API = 'http://10.0.0.5:8787';
// 서울역 · 시청역 근처 · 경주역(신경주)
const SEOUL: LatLng = { latitude: 37.5547, longitude: 126.9707 };
const CITY_HALL: LatLng = { latitude: 37.5657, longitude: 126.9769 };
const GYEONGJU: LatLng = { latitude: 35.7983, longitude: 129.1393 };

/** 도시 안: 걷기 → 버스 → 걷기 → 지하철 → 걷기 */
const CITY_BODY = {
  result: {
    searchType: 0,
    path: [
      {
        pathType: 3,
        info: { totalTime: 27, totalDistance: 3450, payment: 1500, busTransitCount: 1, subwayTransitCount: 1, mapObj: '1234:1:10:12@5678:2:3:5' },
        subPath: [
          { trafficType: 3, distance: 210, sectionTime: 3 },
          {
            trafficType: 2,
            distance: 1800,
            sectionTime: 9,
            stationCount: 4,
            lane: [{ busNo: '402', type: 11 }, { busNo: '405', type: 11 }],
            startName: '서울역버스환승센터',
            startX: 126.9718,
            startY: 37.5558,
            endName: '숭례문',
            endX: 126.9752,
            endY: 37.5601,
            passStopList: { stations: [{ stationName: '중간', x: '126.9735', y: '37.5580' }] },
          },
          { trafficType: 3, distance: 120, sectionTime: 2 },
          {
            trafficType: 1,
            distance: 1100,
            sectionTime: 4,
            stationCount: 1,
            way: '청량리',
            lane: [{ name: '수도권 1호선', subwayCode: 1 }],
            startName: '시청',
            startX: 126.9772,
            startY: 37.5636,
            endName: '종각',
            endX: 126.9829,
            endY: 37.5702,
          },
          { trafficType: 3, distance: 220, sectionTime: 3 },
        ],
      },
    ],
  },
};

/** 도시 사이: 열차(KTX) */
const INTERCITY_BODY = {
  result: {
    searchType: 1,
    path: [
      {
        pathType: 11,
        info: { totalTime: 128, totalDistance: 340000, payment: 49300 },
        subPath: [{ trafficType: 4, sectionTime: 128, distance: 340000, trainType: 'KTX', startName: '서울', endName: '신경주' }],
      },
    ],
  },
};

const LANE_BODY = {
  result: {
    lane: [
      { section: [{ graphPos: [{ x: 126.9718, y: 37.5558 }, { x: 126.973, y: 37.557 }, { x: 126.9752, y: 37.5601 }] }] },
      { section: [{ graphPos: [{ x: 126.9772, y: 37.5636 }, { x: 126.9829, y: 37.5702 }] }] },
    ],
  },
};

test('도시 안: 탑승 시간만 더하고(걷기 빼고), 버스 번호·승하차·정류장 수, 지하철 노선·방면·승하차 역을 안내한다', () => {
  const out = parseOdsayRoute(CITY_BODY, SEOUL, CITY_HALL, { toName: '종각 젊음의거리' });
  assert.equal(out?.kind, 'leg');
  if (out?.kind !== 'leg') return;
  const leg = out.leg;
  assert.equal(leg.minutes, 13, '버스 9분 + 지하철 4분(걷기 8분은 넣지 않는다)');
  assert.equal(leg.meters, 2900);
  assert.equal(leg.estimated, false);
  assert.equal(leg.road, 'odsay');
  assert.deepEqual(
    leg.steps.map((s) => s.text),
    [
      '402, 405번 버스 중 하나 · 서울역버스환승센터에서 승차 · 숭례문에서 하차 (4개 정류장, 9분)',
      '수도권 1호선 · 청량리 방면 · 시청역에서 승차 · 종각역에서 하차 (1개 역, 4분)',
      '종각 젊음의거리 도착',
    ],
  );
  assert.deepEqual(
    leg.steps.map((s) => s.kind),
    ['bus', 'subway', 'arrive'],
  );
  assert.match(leg.note ?? '', /ODsay/);
  assert.match(leg.note ?? '', /요금 1,500원/);
  assert.match(leg.note ?? '', /환승 1회/);
  // 선: 출발 → 승차 정류장 → 지나는 정류장 → 하차 정류장 → (지하철) → 도착. 찻길이 아니다
  assert.deepEqual(leg.polyline[0], SEOUL);
  assert.deepEqual(leg.polyline[2], { latitude: 37.558, longitude: 126.9735 });
  assert.deepEqual(leg.polyline[leg.polyline.length - 1], CITY_HALL);
  assert.equal(leg.polyline.length, 7);
});

test('경로가 여럿이면 탑승 시간이 가장 짧은 경로 하나만 보인다(버스 12분 · 지하철 2분이면 지하철)', () => {
  const body = {
    result: {
      path: [
        {
          pathType: 2,
          info: { totalTime: 22, payment: 1500, mapObj: 'bus' },
          subPath: [
            { trafficType: 3, sectionTime: 10, distance: 700 },
            { trafficType: 2, sectionTime: 12, distance: 900, stationCount: 3, lane: [{ busNo: '55' }], startName: '성남역', endName: '이매고교' },
          ],
        },
        {
          pathType: 1,
          info: { totalTime: 2, payment: 1550, mapObj: 'subway' },
          subPath: [
            { trafficType: 3, sectionTime: 0, distance: 0 },
            { trafficType: 1, sectionTime: 2, distance: 800, stationCount: 1, way: '여주', lane: [{ name: '경강선' }], startName: '성남', endName: '이매' },
            { trafficType: 3, sectionTime: 0, distance: 0 },
          ],
        },
      ],
    },
  };
  const out = parseOdsayRoute(body, SEOUL, CITY_HALL, { toName: '이매역' });
  assert.equal(out?.kind, 'leg');
  if (out?.kind !== 'leg') return;
  assert.equal(out.leg.minutes, 2);
  assert.deepEqual(out.leg.steps.map((s) => s.text), ['경강선 · 여주 방면 · 성남역에서 승차 · 이매역에서 하차 (1개 역, 2분)', '이매역 도착']);
  assert.match(out.leg.note ?? '', /요금 1,550원/);
});

test('노선 모양(loadLane)이 있으면 교통 구간의 선을 노선 모양으로 그린다', () => {
  const lanes = parseOdsayLanes(LANE_BODY);
  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].length, 3);
  const out = parseOdsayRoute(CITY_BODY, SEOUL, CITY_HALL, { lanes });
  assert.equal(out?.kind, 'leg');
  if (out?.kind !== 'leg') return;
  assert.deepEqual(out.leg.polyline, [SEOUL, ...lanes[0], ...lanes[1], CITY_HALL]);
});

test('도시 사이: 열차(KTX) 구간과 2시간대 소요', () => {
  const out = parseOdsayRoute(INTERCITY_BODY, SEOUL, GYEONGJU, { toName: '경주역' });
  assert.equal(out?.kind, 'leg');
  if (out?.kind !== 'leg') return;
  assert.equal(out.leg.minutes, 128);
  assert.equal(out.leg.steps[0].text, '열차(KTX) · 서울에서 승차 · 신경주에서 하차 (128분)');
  assert.equal(out.leg.steps[0].kind, 'train');
  assert.match(out.leg.note ?? '', /요금 49,300원/);
  assert.equal(odsayStepText({ trafficType: 5, sectionTime: 250, startName: '서울경부', endName: '경주' }), '고속버스 · 서울경부에서 승차 · 경주에서 하차 (250분)');
});

test('ODsay 오류: 경로 없음 코드(-98 너무 가까움, -99 결과 없음)는 경로 없음, 그 밖은 알 수 없음', () => {
  assert.equal(odsayErrorCode({ error: { code: '-98', msg: '출, 도착지가 700m이내입니다.' } }), '-98');
  assert.equal(odsayErrorCode({ error: [{ code: '500', message: 'server' }] }), '500');
  assert.equal(odsayErrorCode(CITY_BODY), undefined);
  assert.deepEqual(parseOdsayRoute({ error: { code: '-98' } }, SEOUL, CITY_HALL), { kind: 'none', reason: '-98' });
  assert.equal(parseOdsayRoute({ error: [{ code: '-8', message: 'key' }] }, SEOUL, CITY_HALL), undefined);
  assert.equal(parseOdsayRoute({ result: {} }, SEOUL, CITY_HALL), undefined);
});

test('서버 경유: 대중교통 경로는 /odsay/search와 /odsay/lane을 묻고 키는 앱 주소에 없다. 실제 노선이 나온다', async () => {
  const f = fakeFetch((c) => (c.url.includes('/odsay/lane') ? { body: LANE_BODY } : c.url.includes('/odsay/search') ? { body: CITY_BODY } : { body: {} }));
  const routes = createRouteProvider({ apiUrl: API, fetch: f, clock: fixedClock(0), kv: memoryKV() });
  const leg = await routes.route(SEOUL, CITY_HALL, 'transit');
  assert.equal(leg?.road, 'odsay');
  assert.equal(leg?.estimated, false);
  assert.ok(leg?.steps.some((s) => s.text.includes('402, 405번 버스')));
  const search = f.calls.find((c) => c.url.includes('/odsay/search'));
  assert.ok(search);
  const u = new URL(search.url);
  assert.equal(u.searchParams.get('SX'), String(SEOUL.longitude));
  assert.equal(u.searchParams.get('EY'), String(CITY_HALL.latitude));
  assert.equal(u.searchParams.has('apiKey'), false);
  const lane = f.calls.find((c) => c.url.includes('/odsay/lane'));
  assert.equal(new URL(lane!.url).searchParams.get('mapObject'), '0:0@1234:1:10:12@5678:2:3:5');
  // 다시 물으면 캐시(24시간)에서 나온다
  const before = f.calls.length;
  await routes.route(SEOUL, CITY_HALL, 'transit');
  assert.equal(f.calls.length, before);
});

test('서버에 ODsay 키가 없으면(503) 추정으로 넘어가고 짧게만 캐시한다. 추정 선은 직선이다(찻길을 빌리지 않는다)', async () => {
  const f = fakeFetch((c) =>
    c.url.includes('/odsay/') ? { status: 503, body: { error: 'odsayDisabled', reason: '키 없음' } } : { status: 503, body: { error: 'kakaoDisabled' } },
  );
  const routes = createRouteProvider({ apiUrl: API, fetch: f, clock: fixedClock(0), kv: memoryKV() });
  const leg = await routes.route(SEOUL, GYEONGJU, 'transit');
  assert.ok(leg);
  assert.equal(leg.estimated, true);
  assert.equal(leg.road, undefined);
  assert.deepEqual(leg.polyline, [SEOUL, GYEONGJU]);
  assert.match(leg.note ?? '', /실제 노선 아님/);
  assert.equal((leg as { ttlMs?: number }).ttlMs, ODSAY_FALLBACK_TTL_MS);
  assert.equal(f.calls.filter((c) => c.url.includes('routed-car') || c.url.includes('navi/directions')).length, 0, '자동차 경로를 묻지 않는다');
});

test('서버가 ODsay에 닿지 못하면(502) 추정이지만 임시 결과라 다시 물으면 실제 노선이다', async () => {
  let down = true;
  const f = fakeFetch((c) =>
    c.url.includes('/odsay/search') ? (down ? { status: 502, body: { error: 'upstreamFailed' } } : { body: INTERCITY_BODY }) : { status: 404, body: {} },
  );
  const routes = createRouteProvider({ apiUrl: API, fetch: f, clock: fixedClock(0), kv: memoryKV() });
  const first = await routes.route(SEOUL, GYEONGJU, 'transit');
  assert.equal(first?.provisional, true);
  down = false;
  const again = await routes.route(SEOUL, GYEONGJU, 'transit');
  assert.equal(again?.road, 'odsay');
  assert.equal(again?.minutes, 128);
});

test('추정 모델: 서울역 → 경주역은 시외(열차·고속버스)로 보아 2~4시간이다(예전 18시간)', () => {
  const km = haversineKm(SEOUL, GYEONGJU);
  assert.ok(km > INTERCITY_KM);
  const b = transitBreakdown(SEOUL, GYEONGJU, SCENARIO_TRANSIT);
  assert.equal(b.intercity, true);
  assert.ok(b.total >= 120 && b.total <= 240, `총 ${b.total}분`);
  // 시내 거리는 예전 모델 그대로
  assert.equal(transitBreakdown(SEOUL, CITY_HALL, SCENARIO_TRANSIT).intercity, false);
});

/* ---------- 서버 중계 ---------- */

const ODSAY_KEY = 'odsay-SECRET-key';

function upstream(handler: (url: URL) => { status?: number; body?: unknown }) {
  const calls: string[] = [];
  const fetch: UpstreamFetch = async (url) => {
    calls.push(url);
    const r = handler(new URL(url));
    const status = r.status ?? 200;
    const text = JSON.stringify(r.body ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

function call(proxy: ReturnType<typeof createApiProxy>, path: string) {
  return proxy.handle({ method: 'GET', url: new URL(path, 'http://localhost'), rawLength: path.length, ip: '10.0.0.1' });
}

const SEARCH = `/odsay/search?SX=${SEOUL.longitude}&SY=${SEOUL.latitude}&EX=${GYEONGJU.longitude}&EY=${GYEONGJU.latitude}&OPT=0`;

test('중계: /odsay/search는 서버 키를 apiKey로 붙여 ODsay에 묻고, 응답의 키 글자는 가리며, 성공은 캐시한다', async () => {
  assert.equal(isProxyPath('/odsay/search'), true);
  assert.ok(ODSAY_ROUTES.search.upstream.includes('searchPubTransPathT'));
  const up = upstream(() => ({ body: { ...INTERCITY_BODY, echo: ODSAY_KEY } }));
  const proxy = createApiProxy({ cache: createSyncStore().routeCache, now: () => 0, odsayKey: ODSAY_KEY, fetch: up.fetch });
  const r = await call(proxy, SEARCH);
  assert.equal(r.status, 200);
  const u = new URL(up.calls[0]);
  assert.equal(u.origin + u.pathname, 'https://api.odsay.com/v1/api/searchPubTransPathT');
  assert.equal(u.searchParams.get('apiKey'), ODSAY_KEY);
  assert.equal(JSON.stringify(r.body).includes(ODSAY_KEY), false);
  await call(proxy, SEARCH);
  assert.equal(up.calls.length, 1, '두 번째는 캐시');
  assert.equal(proxy.info().odsay, true);
});

test('중계: 키가 없으면 503 odsayDisabled, 모르는 매개변수·국외 좌표는 400, ODsay의 200+error는 캐시하지 않는다', async () => {
  const none = createApiProxy({ fetch: upstream(() => ({})).fetch });
  assert.deepEqual([(await call(none, SEARCH)).status, ((await call(none, SEARCH)).body as { error: string }).error], [503, 'odsayDisabled']);
  const up = upstream(() => ({ body: { error: { code: '-99', msg: '검색결과가 없습니다.' } } }));
  const proxy = createApiProxy({ cache: createSyncStore().routeCache, now: () => 0, odsayKey: ODSAY_KEY, fetch: up.fetch });
  assert.equal((await call(proxy, `${SEARCH}&apiKey=x`)).status, 400);
  assert.equal((await call(proxy, '/odsay/search?SX=10&SY=37&EX=129&EY=35')).status, 400);
  assert.equal((await call(proxy, '/odsay/unknown?SX=1')).status, 404);
  await call(proxy, SEARCH);
  await call(proxy, SEARCH);
  assert.equal(up.calls.length, 2, '실패 응답은 캐시하지 않는다');
  const lane = await call(proxy, `/odsay/lane?mapObject=${encodeURIComponent('0:0@1234:1:10:12')}`);
  assert.equal(lane.status, 200);
  assert.equal((await call(proxy, '/odsay/lane?mapObject=%3Cscript%3E')).status, 400);
});
