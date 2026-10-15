import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createKakaoSdkClient, type KakaoServices } from '../src/services/kakaoSdk';
import { createKakaoPlaces, KAKAO_CATEGORY_URL, KAKAO_KEYWORD_URL } from '../src/services/places/kakao';
import { createLocalPlaces } from '../src/services/places/local';
import { createRegionSearch, KAKAO_ADDRESS_URL } from '../src/services/regions';
import { regionById } from '../src/data/regions';
import { fakeFetch } from './helpers/fakes';

/**
 * 웹 지도 SDK services로 하는 장소·지역 검색(2026-10-15). 카카오 앱의 REST 키가 403(disabled OPEN_MAP_AND_LOCAL)이어도
 * 지도 JavaScript 키로 검색이 됐다. SDK 콜백을 REST 응답 모양({documents})으로 바꿔 places/kakao·regions가 그대로 쓴다.
 */

type Call = { fn: string; args: unknown[] };

function fakeServices(reply: (fn: string, args: unknown[]) => [unknown[], string]): { services: KakaoServices; calls: Call[] } {
  const calls: Call[] = [];
  const answer = (fn: string, args: unknown[], cb: (d: unknown[], s: string) => void) => {
    calls.push({ fn, args });
    const [data, status] = reply(fn, args);
    setTimeout(() => cb(data, status), 0);
  };
  const services: KakaoServices = {
    Places: class {
      keywordSearch(q: string, cb: (d: unknown[], s: string) => void, o?: Record<string, unknown>) {
        answer('keywordSearch', [q, o], cb);
      }
      categorySearch(code: string, cb: (d: unknown[], s: string) => void, o?: Record<string, unknown>) {
        answer('categorySearch', [code, o], cb);
      }
    },
    Geocoder: class {
      addressSearch(q: string, cb: (d: unknown[], s: string) => void, o?: Record<string, unknown>) {
        answer('addressSearch', [q, o], cb);
      }
      coord2RegionCode(x: number, y: number, cb: (d: unknown[], s: string) => void) {
        answer('coord2RegionCode', [x, y], cb);
      }
    },
  };
  return { services, calls };
}

const HWANGNI = {
  id: '27313251',
  place_name: '황리단길',
  category_group_code: 'AT4',
  category_name: '여행 > 관광,명소 > 테마거리',
  road_address_name: '경북 경주시 포석로',
  x: '129.2105',
  y: '35.8371',
};

test('SDK 클라이언트: 키워드·카테고리·주소·행정구역을 SDK 함수로 보내고 {documents}로 돌려준다', async () => {
  const { services, calls } = fakeServices(() => [[HWANGNI], 'OK']);
  const c = createKakaoSdkClient({ load: async () => ({ services }) });
  assert.equal(c.viaServer, false);

  assert.deepEqual(await c.get(KAKAO_KEYWORD_URL, { query: '황리단길', x: 129.2, y: 35.8, radius: 20000, sort: 'accuracy', size: 15, page: undefined }), {
    documents: [HWANGNI],
  });
  assert.deepEqual(calls[0], { fn: 'keywordSearch', args: ['황리단길', { x: 129.2, y: 35.8, radius: 20000, sort: 'accuracy', size: 15 }] });

  await c.get(KAKAO_CATEGORY_URL, { category_group_code: 'CE7', x: '129.2', y: '35.8', radius: 500, sort: 'distance', size: 1 });
  assert.deepEqual(calls[1], { fn: 'categorySearch', args: ['CE7', { x: 129.2, y: 35.8, radius: 500, sort: 'distance', size: 1 }] });

  await c.get(KAKAO_ADDRESS_URL, { query: '익산', size: 30 });
  assert.deepEqual(calls[2], { fn: 'addressSearch', args: ['익산', { size: 30 }] });

  await c.get('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json', { x: 126.9, y: 35.9 });
  assert.deepEqual(calls[3], { fn: 'coord2RegionCode', args: [126.9, 35.9] });
});

test('SDK 클라이언트: 결과 없음은 빈 목록, 오류·SDK 없음·맡지 않는 주소·POST는 던진다', async () => {
  const zero = createKakaoSdkClient({ load: async () => ({ services: fakeServices(() => [[], 'ZERO_RESULT']).services }) });
  assert.deepEqual(await zero.get(KAKAO_KEYWORD_URL, { query: '없는곳' }), { documents: [] });

  const err = createKakaoSdkClient({ load: async () => ({ services: fakeServices(() => [[], 'ERROR']).services }) });
  await assert.rejects(err.get(KAKAO_KEYWORD_URL, { query: '경주' }), /SDK 검색 실패/);
  assert.equal(err.lastError(), 'SDK ERROR');

  const noLib = createKakaoSdkClient({ load: async () => ({}) });
  await assert.rejects(noLib.get(KAKAO_KEYWORD_URL, { query: '경주' }), /services 라이브러리 없음/);

  const failLoad = createKakaoSdkClient({
    load: async () => {
      throw new Error('auth');
    },
  });
  await assert.rejects(failLoad.get(KAKAO_KEYWORD_URL, { query: '경주' }), /SDK를 싣지 못함/);

  const ok = createKakaoSdkClient({ load: async () => ({ services: fakeServices(() => [[], 'OK']).services }) });
  await assert.rejects(ok.get('https://apis-navi.kakaomobility.com/v1/directions', {}), /맡지 않는 주소/);
  await assert.rejects(ok.post('https://apis-navi.kakaomobility.com/v1/waypoints/directions', {}), /POST/);
});

test('장소 검색: SDK 클라이언트로 카카오 장소를 돌려주고, SDK가 실패하면 로컬 장소 사전으로 넘어간다', async () => {
  const gyeongju = regionById('gyeongju');
  assert.ok(gyeongju);
  const fetch = fakeFetch(() => ({ status: 500, body: {} }));
  const calls = fetch.calls;

  const { services } = fakeServices(() => [[HWANGNI], 'OK']);
  const places = createKakaoPlaces({ client: createKakaoSdkClient({ load: async () => ({ services }) }), fetch, fallback: createLocalPlaces() });
  const found = await places.search('황리단길', gyeongju);
  assert.equal(places.id, 'kakao');
  assert.equal(found[0]?.placeId, 'kakao:27313251');
  assert.equal(found[0]?.name, '황리단길');
  assert.equal(calls.length, 0, 'SDK 클라이언트를 주면 REST로 fetch하지 않는다');

  const broken = createKakaoPlaces({
    client: createKakaoSdkClient({ load: async () => ({ services: fakeServices(() => [[], 'ERROR']).services }) }),
    fetch,
    fallback: createLocalPlaces(),
  });
  await broken.search('불국사', gyeongju);
  assert.equal(broken.id, 'local');
});

test('지역 검색: SDK 클라이언트의 주소 검색으로 목록에 없는 시·군을 찾는다', async () => {
  const { services } = fakeServices(() => [
    [
      {
        address_name: '전북 익산시',
        address_type: 'REGION',
        x: '126.9577',
        y: '35.9483',
        address: { region_1depth_name: '전북', region_2depth_name: '익산시', region_3depth_name: '' },
      },
    ],
    'OK',
  ]);
  const fetch = fakeFetch(() => ({ status: 500, body: {} }));
  const calls = fetch.calls;
  const regions = createRegionSearch({ fetch, client: createKakaoSdkClient({ load: async () => ({ services }) }) });
  const found = await regions.search('익산');
  assert.equal(found[0]?.name, '익산');
  assert.equal(calls.length, 0);
});

test('레지스트리: 웹·서버 주소 없음·지도 키가 있으면 장소·지역 검색에 SDK 클라이언트를 쓴다', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/services/registry.ts', 'utf8');
  assert.match(src, /!apiUrl && Platform\.OS === 'web' && KAKAO_MAP_JS_KEY \? createKakaoSdkClient\(\{ load: loadKakaoSdk \}\)/);
  assert.match(src, /createKakaoPlaces\(\{ client: sdk, fetch: appFetch, fallback: createLocalPlaces\(\) \}\)/);
  assert.match(src, /createRegionSearch\(\{ apiUrl, kakaoKey, fetch: appFetch, client: sdk \}\)/);
});
