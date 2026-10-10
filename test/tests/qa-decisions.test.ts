import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import { MVP_TRANSPORTS } from '../src/core/constants';
import { buildPlan } from '../src/core/planner';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';
import { listFiles, read, stripComments } from './setup/scan';

/**
 * QA(로직): 확정 결정이 코드에서 되돌려지지 않았는지 본다(02 설계 리뷰, plan.json decisions).
 * - 1단계 수단은 도보·자동차뿐이다. 대중교통은 2차 모의 모델이라 언제나 추정(estimated)이고 외부 호출이 없다.
 * - 국내 전용: 바탕 지도는 카카오맵이 기본이다(2026-10-10 결정). 구글 지도는 선택 대체이고 구글 경로·장소 호출은 없다.
 *   카카오·구글 지도 SDK는 각자 어댑터 파일 안에서만 쓴다.
 * - 실제 길 시간(2026-10-09 결정): 도로 경로 서버(roadShapes, OpenStreetMap OSRM)를 켜면 도보·자동차 시간도 실제 길에서 받는다
 *   (계획 행렬은 OSRM table. wp4-road-time). 자동차는 카카오가 있으면 카카오가 먼저다. 끄면(테스트·골든) 외부 호출이 없다.
 *   예전 결정 '도보·대중교통은 외부로 묻지 않는다'는 도로 경로 서버가 꺼졌을 때만 남는다.
 * - 확정 버튼 없음·자동 선별: 계획은 사용자 확정 단계 없이 후보에서 바로 확정·제외를 낸다.
 */

test('1단계 여행방 기본 수단은 자동차·도보뿐이다(대중교통은 2차)', () => {
  assert.deepEqual([...MVP_TRANSPORTS].sort(), ['car', 'walk']);
});

const A: LatLng = { latitude: 35.7901, longitude: 129.332 };
const B: LatLng = { latitude: 35.7952, longitude: 129.349 };

test('도로 경로 서버를 끄면(roadShapes 없음) 카카오 키가 있어도 도보·대중교통은 외부로 묻지 않고 추정값이다. 자동차만 카카오에 묻는다', async () => {
  const fetch = fakeFetch(() => ({
    body: { routes: [{ result_code: 0, summary: { distance: 2100, duration: 600 }, sections: [] }] },
  }));
  const routes = createRouteProvider({ kakaoKey: 'QA-FAKE', fetch, clock: fixedClock(0), kv: memoryKV() });
  const walk = await routes.matrix([A], [B], 'walk');
  const transit = await routes.matrix([A], [B], 'transit');
  assert.equal(fetch.calls.length, 0, '도보·대중교통은 fetch 0회');
  assert.equal(walk.estimated, true);
  assert.equal(transit.estimated, true);
  const car = await routes.matrix([A], [B], 'car');
  assert.equal(fetch.calls.length, 1);
  assert.ok(fetch.calls[0].url.includes('kakaomobility.com'));
  assert.equal(car.minutes[0][0], 10);
});

test('도로 경로 서버를 켜면 도보 시간도 실제 길(OSRM table)에서 받는다. 자동차는 카카오가 먼저고 대중교통은 그대로 외부 호출 없이 추정이다', async () => {
  const fetch = fakeFetch((c) => {
    if (c.url.includes('kakaomobility.com')) {
      return { body: { routes: [{ result_code: 0, summary: { distance: 2100, duration: 600 }, sections: [] }] } };
    }
    if (c.url.includes('/table/v1/')) return { body: { code: 'Ok', durations: [[1500]], distances: [[1900]] } };
    return { status: 404, body: {} };
  });
  const routes = createRouteProvider({ kakaoKey: 'QA-FAKE', fetch, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const walk = await routes.matrix([A], [B], 'walk');
  assert.equal(fetch.calls.length, 1);
  assert.ok(fetch.calls[0].url.startsWith('https://routing.openstreetmap.de/routed-foot/table/v1/foot/'));
  assert.equal(walk.minutes[0][0], 25, '1500초 = 25분(도보는 OSRM 그대로)');
  assert.equal(walk.estimated, false);

  const transit = await routes.matrix([A], [B], 'transit');
  assert.equal(fetch.calls.length, 1, '대중교통은 묻지 않는다');
  assert.equal(transit.estimated, true);

  const car = await routes.matrix([A], [B], 'car');
  assert.equal(fetch.calls.length, 2);
  assert.ok(fetch.calls[1].url.includes('kakaomobility.com'), '자동차는 카카오가 먼저(OSRM에 묻지 않는다)');
  assert.equal(car.minutes[0][0], 10);
});

test('국내 전용: 바탕 지도는 카카오가 기본, 구글은 선택 대체(구글 경로·장소 API 호출 없음, 지도 SDK는 어댑터 안에서만)', () => {
  const googleAdapters = ['src/components/map/GoogleMapView.tsx', 'src/components/map/GoogleMapView.web.tsx', 'src/components/map/googleScript.ts'];
  const kakaoAdapters = [
    'src/components/map/KakaoMapView.tsx',
    'src/components/map/KakaoMapView.web.tsx',
    'src/components/map/kakaoScript.ts',
    'src/components/map/kakaoHtml.ts',
  ];
  const apiHits: string[] = [];
  const sdkHits: string[] = [];
  const kakaoSdkHits: string[] = [];
  for (const f of listFiles('src', ['.ts', '.tsx'])) {
    const code = stripComments(read(f));
    // 구글 길찾기·장소·지오코딩은 국내 도보·자동차 경로를 주지 않거나 제공자 두 벌이 된다
    if (/googleapis\.com\/maps\/api\/(directions|place|distancematrix|geocode)|(routes|places)\.googleapis\.com/.test(code)) apiHits.push(f);
    if (!googleAdapters.includes(f) && /maps\.googleapis\.com|['"]react-native-maps['"]/.test(code)) sdkHits.push(f);
    // 카카오맵 SDK(주소, kakao.maps 전역, 앱 WebView)는 카카오 어댑터 안에서만
    if (!kakaoAdapters.includes(f) && /\/v2\/maps\/sdk\.js|\bkakao\.maps\b|['"]react-native-webview['"]/.test(code)) kakaoSdkHits.push(f);
  }
  assert.deepEqual(apiHits, []);
  assert.deepEqual(sdkHits, []);
  assert.deepEqual(kakaoSdkHits, []);
});

test('자동 선별: 사용자 확정 단계 없이 계산 한 번으로 확정 스팟과 제외 스팟이 모두 나온다', async () => {
  const trip = scenarioTrip();
  assert.ok(trip.spots.every((s) => !('confirmed' in s)), '스팟에 사용자 확정 필드가 없다');
  const plan = await buildPlan(trip, { routes: createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(0), kv: memoryKV() }), now: 0 });
  const confirmed = plan.days.reduce((n, d) => n + d.items.length, 0);
  assert.equal(confirmed, 11);
  assert.equal(plan.excluded.length, 3);
});
