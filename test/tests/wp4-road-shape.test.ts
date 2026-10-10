import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import type { RouteLeg } from '../src/core/ports';
import { legShape, polylineProgress, type MapLeg } from '../src/core/map/model';
import { offsetCoord } from '../src/core/sim/track';
import {
  createLocalRoutes,
  createOsmRoutes,
  createRouteCache,
  createRouteProvider,
  OSM_ROUTING_URL,
  osmRouteUrl,
  osmStepText,
  parseKakaoRoute,
  parseOsmRoute,
} from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';

/**
 * 경로 선 모양을 실제 길(OpenStreetMap OSRM)에서 받는다. 경로 없음은 로컬 모델 그대로다.
 * 시간도 실제 길에서 받는다(2026-10-09 결정). 행렬(OSRM table)·구간표 우선·route와 matrix 일치는 wp4-road-time이 본다.
 * 네트워크는 쓰지 않는다(fakeFetch).
 */

// 예시 데이터 구간표에 없는 두 점(경주 시내). 로컬 모델이 직선거리로 추정한다
const A: LatLng = { latitude: 35.8301, longitude: 129.2101 };
const B: LatLng = { latitude: 35.8352, longitude: 129.2203 };

/** A에서 동쪽으로 갔다가 북쪽으로 꺾어 B로 가는 길 */
const CORNER: LatLng = { latitude: 35.8301, longitude: 129.2203 };

function osrmBody(coords: LatLng[] = [A, CORNER, B]) {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 1490.4,
        duration: 1100,
        geometry: { type: 'LineString', coordinates: coords.map((c) => [c.longitude, c.latitude]) },
        legs: [
          {
            steps: [
              { distance: 920, name: '교촌길', maneuver: { type: 'depart', bearing_after: 88 } },
              { distance: 0, name: '교촌길', maneuver: { type: 'new name', modifier: 'straight' } },
              { distance: 570, name: '첨성로', maneuver: { type: 'turn', modifier: 'left' } },
              { distance: 0, name: '', maneuver: { type: 'arrive', modifier: 'right' } },
            ],
          },
        ],
      },
    ],
  };
}

test('OSRM 주소는 경도,위도 순서이고 도보는 routed-foot, 자동차는 routed-car다. 대중교통은 묻지 않는다', () => {
  const walk = osmRouteUrl(OSM_ROUTING_URL, 'walk', A, B);
  assert.equal(
    walk,
    'https://routing.openstreetmap.de/routed-foot/route/v1/foot/129.2101,35.8301;129.2203,35.8352?overview=full&geometries=geojson&steps=true',
  );
  assert.ok(osmRouteUrl(`${OSM_ROUTING_URL}/`, 'car', A, B)?.startsWith('https://routing.openstreetmap.de/routed-car/route/v1/driving/'));
  assert.equal(osmRouteUrl(OSM_ROUTING_URL, 'transit', A, B), undefined);
});

test('OSRM 응답을 위도·경도 선, 길 거리, 한국어 안내 줄로 바꾼다(이름만 바뀌는 직진은 앞 줄에 합친다)', () => {
  const s = parseOsmRoute(osrmBody());
  assert.ok(s);
  assert.deepEqual(s.polyline, [A, CORNER, B]);
  assert.equal(s.meters, 1490);
  assert.deepEqual(s.steps, [
    { text: '동쪽으로 출발 · 교촌길', meters: 920 },
    { text: '좌회전 · 첨성로', meters: 570 },
    { text: '목적지 도착', meters: 0 },
  ]);
  assert.equal(parseOsmRoute({ code: 'NoRoute', routes: [] }), null);
  assert.equal(parseOsmRoute({ code: 'Ok', routes: [{ geometry: { coordinates: [[129.2, 35.8]] } }] }), null, '한 점은 선이 아니다');
  assert.equal(parseOsmRoute(null), null);
});

test('안내 줄 글: 회전 방향, 갈림길, 회전교차로', () => {
  assert.equal(osmStepText({ name: '첨성로', maneuver: { type: 'turn', modifier: 'right' } }), '우회전 · 첨성로');
  assert.equal(osmStepText({ maneuver: { type: 'turn', modifier: 'uturn' } }), '유턴');
  assert.equal(osmStepText({ maneuver: { type: 'end of road', modifier: 'slight left' } }), '왼쪽 방향');
  assert.equal(osmStepText({ maneuver: { type: 'fork', modifier: 'slight right' } }), '오른쪽 길로');
  assert.equal(osmStepText({ name: '보문로', maneuver: { type: 'roundabout', exit: 2 } }), '회전교차로에서 2번째 출구 · 보문로');
  assert.equal(osmStepText({ maneuver: { type: 'depart' } }), '출발');
  assert.equal(osmStepText({ maneuver: { type: 'depart', bearing_after: 350 } }), '북쪽으로 출발');
});

test('도보 경로: 선·거리·안내 줄과 시간이 실제 길이다(시간은 그 경로의 초, 추정 아님)', async () => {
  const local = createLocalRoutes();
  const fetch = fakeFetch(() => ({ body: osrmBody() }));
  const osm = createOsmRoutes({ fetch, fallback: local });
  const base = await local.route(A, B, 'walk');
  const leg = await osm.route(A, B, 'walk');
  assert.ok(base && leg);
  assert.equal(base.estimated, true, '로컬 모델은 직선 추정');
  assert.equal(fetch.calls.length, 1, '경로 한 번에 모양과 시간을 같이 받는다');
  assert.ok(fetch.calls[0].url.includes('/routed-foot/route/'));
  assert.equal(leg.road, 'osm');
  assert.deepEqual(leg.polyline, [A, CORNER, B]);
  assert.equal(leg.meters, 1490);
  assert.equal(leg.minutes, 18, '1100초 = 18분(도보는 OSRM 그대로)');
  assert.equal(leg.estimated, false);
  assert.equal(leg.steps[1].text, '좌회전 · 첨성로');
  assert.ok(leg.note?.includes('OpenStreetMap'));
  assert.equal(leg.provisional, undefined);
});

test('길 모양 없이 만든 제공자(테스트·골든)는 행렬도 경로도 길 서버에 묻지 않는다', async () => {
  const fetch = fakeFetch(() => ({ body: osrmBody() }));
  const plain = createRouteProvider({ fetch, clock: fixedClock(0), kv: memoryKV() });
  const walk = await plain.matrix([A], [B], 'walk');
  await plain.matrix([A], [B], 'car');
  const leg = await plain.route(A, B, 'walk');
  assert.equal(fetch.calls.length, 0);
  assert.equal(walk.estimated, true, '직선 추정 그대로');
  assert.deepEqual(leg?.polyline, [A, B]);
  assert.equal(leg?.road, undefined);
  assert.equal(leg?.estimated, true);
});

test('길 서버가 실패하면 직선 추정에 provisional을 달고, 캐시는 그 결과를 두지 않아 다음에 다시 묻는다', async () => {
  let fail = true;
  const fetch = fakeFetch(() => (fail ? { status: 503, body: 'busy' } : { body: osrmBody() }));
  const routes = createRouteCache({ clock: fixedClock(0), kv: memoryKV() }).wrap(
    createOsmRoutes({ fetch, fallback: createLocalRoutes() }),
  );
  const first = await routes.route(A, B, 'car');
  assert.equal(first?.provisional, true);
  assert.deepEqual(first?.polyline, [A, B]);
  assert.equal(first?.road, undefined);

  fail = false;
  const second = await routes.route(A, B, 'car');
  assert.equal(fetch.calls.length, 2, '실패는 캐시하지 않는다');
  assert.equal(second?.road, 'osm');
  assert.ok(fetch.calls[1].url.includes('/routed-car/'));

  await routes.route(A, B, 'car');
  assert.equal(fetch.calls.length, 2, '성공은 24시간 캐시에서 나온다');
});

test('길 서버가 답하지 않으면 시간 초과 뒤 직선 추정으로 넘어간다', async () => {
  const fetch = fakeFetch(() => new Promise<{ body?: unknown }>(() => {}));
  const osm = createOsmRoutes({ fetch, fallback: createLocalRoutes(), timeoutMs: 20 });
  const leg = await osm.route(A, B, 'walk');
  assert.equal(leg?.provisional, true);
  assert.deepEqual(leg?.polyline, [A, B]);
});

test('로컬 모델이 경로 없음(null)이면 길 서버에 묻지 않는다', async () => {
  const fetch = fakeFetch(() => ({ body: osrmBody() }));
  const none = createLocalRoutes({ table: { car: {}, walk: { 'p>q': null }, transit: {} }, places: [
    { placeId: 'p', coord: A },
    { placeId: 'q', coord: B },
  ] });
  const osm = createOsmRoutes({ fetch, fallback: none });
  assert.equal(await osm.route(A, B, 'walk'), null);
  assert.equal(fetch.calls.length, 0);
});

test('대중교통 선은 자동차 길 모양을 빌린다. 시간·안내 줄은 모의 모델이고 버스 구간 거리만 길 거리다', async () => {
  const fetch = fakeFetch(() => ({ body: osrmBody() }));
  const routes = createRouteProvider({ fetch, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const plain = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(0), kv: memoryKV() });
  const leg = await routes.route(A, B, 'transit');
  const model = await plain.route(A, B, 'transit');
  assert.ok(leg && model);
  assert.ok(fetch.calls[0].url.includes('/routed-car/'));
  assert.equal(leg.road, 'osm');
  assert.deepEqual(leg.polyline, [A, CORNER, B]);
  assert.equal(leg.minutes, model.minutes);
  assert.equal(leg.estimated, true);
  assert.equal(leg.meters, 1490);
  assert.deepEqual(
    leg.steps.map((s) => s.text),
    model.steps.map((s) => s.text),
  );
  assert.ok(leg.note?.includes('찻길 모양'));
  assert.deepEqual(model.polyline, [A, B], '길 모양이 없으면 직선 그대로');
});

test('대중교통 선: 자동차 경로가 실패하면(카카오 직접 호출이 던짐) 직선이지만 임시 결과라 캐시에 두지 않고, 다시 되면 길 모양이다', async () => {
  let kakaoDown = true;
  const kakaoBody = {
    routes: [
      {
        result_code: 0,
        summary: { distance: 2100, duration: 600 },
        sections: [{ roads: [{ vertexes: [A.longitude, A.latitude, CORNER.longitude, CORNER.latitude, B.longitude, B.latitude] }] }],
      },
    ],
  };
  const fetch = fakeFetch((c) => (c.url.includes('kakaomobility') ? (kakaoDown ? { status: 500, body: {} } : { body: kakaoBody }) : { body: osrmBody() }));
  const routes = createRouteProvider({ kakaoKey: 'K', fetch, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const first = await routes.route(A, B, 'transit');
  assert.deepEqual([first?.road, first?.provisional, first?.polyline.length], [undefined, true, 2]);
  kakaoDown = false;
  const again = await routes.route(A, B, 'transit');
  assert.equal(again?.road, 'kakao', '직선을 하루 내내 캐시하지 않았다');
  assert.equal(again?.provisional, undefined);
  assert.deepEqual(again?.polyline, [A, CORNER, B]);
});

test('카카오 자동차 경로는 길 모양(road: kakao)이다', () => {
  const leg = parseKakaoRoute(
    {
      routes: [
        {
          result_code: 0,
          summary: { distance: 1500, duration: 300 },
          sections: [{ roads: [{ vertexes: [A.longitude, A.latitude, CORNER.longitude, CORNER.latitude, B.longitude, B.latitude] }] }],
        },
      ],
    },
    A,
    B,
  );
  assert.equal(leg?.road, 'kakao');
  const noShape = parseKakaoRoute({ routes: [{ result_code: 0, summary: { distance: 1, duration: 60 }, sections: [] }] }, A, B);
  assert.equal(noShape?.road, undefined);
});

function mapLeg(estimated: boolean): MapLeg {
  return { index: 1, key: 'k', fromId: 'a', toId: 'b', fromName: 'A', toName: 'B', from: A, to: B, transport: 'walk', estimated, minutes: 12 };
}

test('지도 선: 길 모양이면 시간이 추정이어도 길을 따르고, 길 위 시작·끝이 핀과 떨어져 있으면 핀까지 잇는다', () => {
  const start = offsetCoord(A, 0, 15);
  const end = offsetCoord(B, -12, 0);
  const geo: RouteLeg = { transport: 'walk', minutes: 12, meters: 1490, polyline: [start, CORNER, end], steps: [], estimated: true, road: 'osm' };
  assert.deepEqual(legShape(mapLeg(true), geo), [A, start, CORNER, end, B]);
  assert.deepEqual(legShape(mapLeg(true), { ...geo, polyline: [A, CORNER, B] }), [A, CORNER, B], '이미 핀에서 시작·끝나면 그대로');
  assert.deepEqual(legShape(mapLeg(true), { ...geo, road: undefined }), [A, B], '길 모양이 아닌 추정은 직선');
  assert.deepEqual(legShape(mapLeg(true), null), [A, B]);
});

test('길을 따라 잰 진행률: 꺾인 길의 모퉁이는 길이 비율, 길에서 조금 벗어나도 가장 가까운 지점으로 잰다', () => {
  const line = [A, CORNER, B];
  assert.equal(polylineProgress(line, A), 0);
  assert.equal(polylineProgress(line, B), 1);
  const corner = polylineProgress(line, CORNER);
  // 동쪽 약 920m, 북쪽 약 570m
  assert.ok(corner > 0.58 && corner < 0.66, `모퉁이 ${corner}`);
  const near = polylineProgress(line, offsetCoord(CORNER, 200, 10));
  assert.ok(near > corner && near < 1, `북쪽 길 위 ${near}`);
  assert.equal(polylineProgress([A], B), 1);
  assert.equal(polylineProgress([], B), 0);
});
