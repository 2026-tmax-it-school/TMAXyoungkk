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
 * - 국내 전용·SDK 중립: 실제 경로 제공자는 카카오 자동차 1종이다. 구글 경로·지도 호출은 없다.
 * - 확정 버튼 없음·자동 선별: 계획은 사용자 확정 단계 없이 후보에서 바로 확정·제외를 낸다.
 */

test('1단계 여행방 기본 수단은 자동차·도보뿐이다(대중교통은 2차)', () => {
  assert.deepEqual([...MVP_TRANSPORTS].sort(), ['car', 'walk']);
});

const A: LatLng = { latitude: 35.7901, longitude: 129.332 };
const B: LatLng = { latitude: 35.7952, longitude: 129.349 };

test('카카오 키가 있어도 도보·대중교통은 외부로 묻지 않고 추정값이다. 자동차만 카카오에 묻는다', async () => {
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

test('국내 전용: 구글은 바탕 지도로만 쓴다(구글 경로·장소 API 호출 없음, 지도 SDK는 어댑터 안에서만)', () => {
  const adapters = ['src/components/map/GoogleMapView.tsx', 'src/components/map/GoogleMapView.web.tsx'];
  const apiHits: string[] = [];
  const sdkHits: string[] = [];
  for (const f of listFiles('src', ['.ts', '.tsx'])) {
    const code = stripComments(read(f));
    // 구글 길찾기·장소·지오코딩은 국내 도보·자동차 경로를 주지 않거나 제공자 두 벌이 된다
    if (/googleapis\.com\/maps\/api\/(directions|place|distancematrix|geocode)|(routes|places)\.googleapis\.com/.test(code)) apiHits.push(f);
    if (!adapters.includes(f) && /maps\.googleapis\.com|['"]react-native-maps['"]/.test(code)) sdkHits.push(f);
  }
  assert.deepEqual(apiHits, []);
  assert.deepEqual(sdkHits, []);
});

test('자동 선별: 사용자 확정 단계 없이 계산 한 번으로 확정 스팟과 제외 스팟이 모두 나온다', async () => {
  const trip = scenarioTrip();
  assert.ok(trip.spots.every((s) => !('confirmed' in s)), '스팟에 사용자 확정 필드가 없다');
  const plan = await buildPlan(trip, { routes: createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(0), kv: memoryKV() }), now: 0 });
  const confirmed = plan.days.reduce((n, d) => n + d.items.length, 0);
  assert.equal(confirmed, 11);
  assert.equal(plan.excluded.length, 3);
});
