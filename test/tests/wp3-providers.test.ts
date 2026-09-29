import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Place } from '../src/types';
import type { Region } from '../src/core/ports';
import { regionById } from '../src/data/regions';
import { createExtractionProvider } from '../src/services/extraction';
import { createPlaceProvider } from '../src/services/places';
import { KAKAO_CATEGORY_URL, KAKAO_KEYWORD_URL, mapKakaoCategory } from '../src/services/places/kakao';
import { createRecommendProvider } from '../src/services/recommend';
import { fakeFetch, fakePlaces, type FakeFetchCall } from './helpers/fakes';

/**
 * 제공자 어댑터(WP3). 실제 네트워크 없이 fakeFetch로 요청 형식과 응답 변환을 본다.
 * - 카카오 로컬 키워드·카테고리 검색(프로토타입 가정 · 국내 SDK 선정 미결정). 실키 동작과 웹 CORS는 확인하지 못했다.
 * - AI 프록시 추출·추천. 실패하면 규칙 기반·로컬로 대체한다.
 */

const region = regionById('gyeongju') as Region;

function params(call: FakeFetchCall): URLSearchParams {
  return new URL(call.url).searchParams;
}

const KAKAO_DOCS = {
  documents: [
    {
      id: '101',
      place_name: '황남빵',
      category_name: '음식점 > 간식 > 제과,베이커리',
      category_group_code: 'FD6',
      address_name: '경북 경주시 황남동 1',
      road_address_name: '경북 경주시 태종로 783',
      x: '129.2104',
      y: '35.8371',
    },
    {
      id: '102',
      place_name: '황남빵',
      category_name: '음식점 > 간식 > 제과,베이커리',
      category_group_code: 'FD6',
      address_name: '경북 경주시 신평동 2',
      road_address_name: '',
      x: '129.2869',
      y: '35.8398',
    },
    { id: '103', place_name: '좌표없음', x: 'abc', y: '' },
  ],
  meta: { total_count: 3 },
};

test('카카오 키워드 검색: 헤더·검색어·지역 중심·반경을 보내고, 동명 여러 건을 그대로 돌려준다', async () => {
  const fetch = fakeFetch(() => ({ body: KAKAO_DOCS }));
  const places = createPlaceProvider({ kakaoKey: 'TESTKEY', fetch });
  assert.equal(places.id, 'kakao');
  const out = await places.search('황남빵', region);
  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0];
  assert.ok(call.url.startsWith(`${KAKAO_KEYWORD_URL}?`));
  assert.equal(call.init?.method, 'GET');
  assert.equal(call.init?.headers?.Authorization, 'KakaoAK TESTKEY');
  const q = params(call);
  assert.equal(q.get('query'), '황남빵');
  assert.equal(q.get('x'), String(region.center.longitude));
  assert.equal(q.get('y'), String(region.center.latitude));
  assert.equal(q.get('radius'), String(Math.min(region.radiusKm * 1000, 20000)), '첫 요청은 지역 반경(카카오 상한 20km)으로 거른다');
  assert.equal(q.get('sort'), 'accuracy');
  assert.deepEqual(
    out.map((p) => [p.placeId, p.name, p.category, p.address, p.coord.latitude]),
    [
      ['kakao:101', '황남빵', '식당', '경북 경주시 태종로 783', 35.8371],
      ['kakao:102', '황남빵', '식당', '경북 경주시 신평동 2', 35.8398],
    ],
  );
  assert.equal(out[0].kind, '제과,베이커리');
});

test('카카오 키워드 검색: 반경 안이 0건이면 반경 없이 한 번 더 찾는다(목적지 밖 확인용)', async () => {
  const far = { id: '201', place_name: '감은사지 삼층석탑', category_group_code: 'AT4', x: '129.4867', y: '35.7427' };
  const fetch = fakeFetch((call) => ({ body: { documents: params(call).get('radius') ? [] : [far] } }));
  const places = createPlaceProvider({ kakaoKey: 'K', fetch });
  const bias = { latitude: 35.8, longitude: 129.3 };
  const out = await places.search('감은사지', region, bias);
  assert.equal(fetch.calls.length, 2);
  assert.ok(params(fetch.calls[0]).get('radius'));
  assert.equal(params(fetch.calls[0]).get('x'), String(region.center.longitude), '반경의 중심은 지역 중심');
  assert.equal(params(fetch.calls[1]).get('radius'), null);
  assert.equal(params(fetch.calls[1]).get('x'), String(bias.longitude));
  assert.deepEqual(out.map((p) => p.placeId), ['kakao:201']);
  // 반경 안에서 찾으면 두 번째 요청은 없다
  const hit = fakeFetch(() => ({ body: KAKAO_DOCS }));
  await createPlaceProvider({ kakaoKey: 'K', fetch: hit }).search('황남빵', region);
  assert.equal(hit.calls.length, 1);
});

test('카카오 주변·지도 선택: 카테고리 검색을 거리순으로 부르고 제외 목록을 뺀다', async () => {
  const fetch = fakeFetch((call) => {
    const code = params(call).get('category_group_code');
    const d = code === 'AT4' ? 30 : code === 'CE7' ? 10 : 50;
    return {
      body: {
        documents: [
          { id: `${code}-1`, place_name: `${code} 장소`, category_group_code: code, x: '129.22', y: '35.83', distance: String(d) },
        ],
      },
    };
  });
  const places = createPlaceProvider({ kakaoKey: 'K', fetch });
  const near = await places.nearby({ latitude: 35.83, longitude: 129.22 }, 800, { excludePlaceIds: ['kakao:FD6-1'] });
  assert.ok(fetch.calls.every((c) => c.url.startsWith(`${KAKAO_CATEGORY_URL}?`)));
  assert.equal(params(fetch.calls[0]).get('radius'), '800');
  assert.equal(params(fetch.calls[0]).get('sort'), 'distance');
  assert.deepEqual(near.map((p) => p.placeId), ['kakao:CE7-1', 'kakao:AT4-1', 'kakao:CT1-1']);
  const at = await places.at({ latitude: 35.83, longitude: 129.22 }, 200);
  assert.equal(at?.placeId, 'kakao:CE7-1');
  assert.equal(at?.category, '카페');
});

test('카카오 실패는 던진다(호출 쪽이 검색 실패·결과 없음으로 다룬다)', async () => {
  const places = createPlaceProvider({ kakaoKey: 'K', fetch: fakeFetch(() => ({ status: 401, body: {} })) });
  await assert.rejects(places.search('불국사', region));
});

test('카카오 카테고리 매핑', () => {
  assert.equal(mapKakaoCategory('FD6', '음식점 > 한식'), '식당');
  assert.equal(mapKakaoCategory('CE7', '음식점 > 카페'), '카페');
  assert.equal(mapKakaoCategory('AT4', '여행 > 관광,명소 > 문화유적'), '관광지');
  assert.equal(mapKakaoCategory('AT4', '여행 > 공원 > 도시근린공원'), '공원');
  assert.equal(mapKakaoCategory('CT1', '문화,예술 > 문화시설 > 박물관'), '관광지');
  assert.equal(mapKakaoCategory(undefined, '쇼핑 > 전통시장'), '쇼핑');
  assert.equal(mapKakaoCategory('', '가정,생활'), '기타');
  assert.equal(mapKakaoCategory('', '가정,생활 > 여행사'), '기타', "업종 '여행사'는 관광지가 아니다");
  assert.equal(mapKakaoCategory('', '여행 > 관광,명소'), '관광지');
});

test('키가 없으면 로컬 장소 사전이고 네트워크를 쓰지 않는다', async () => {
  const fetch = fakeFetch();
  const places = createPlaceProvider({ fetch });
  assert.equal(places.id, 'local');
  const r = await places.search('동궁과 월지', region);
  assert.equal(r[0].placeId, 'gj-donggung');
  assert.equal((await places.search('황남빵', region)).length, 2);
  assert.equal(fetch.calls.length, 0);
});

test('AI 프록시 추출: POST /extract, 응답을 원문 부분 문자열로 바로잡는다', async () => {
  const fetch = fakeFetch(() => ({ body: { phrases: [{ phrase: '교촌마을을' }, { phrase: '지어낸곳' }, { phrase: '불국사' }] } }));
  const ex = createExtractionProvider({ aiProxyUrl: 'https://proxy.example/ai/', fetch });
  assert.equal(ex.id, 'ai');
  const text = '교촌마을을 걷고 불국사 가자';
  const out = await ex.phrases(text, { region });
  assert.equal(fetch.calls[0].url, 'https://proxy.example/ai/extract');
  assert.equal(fetch.calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(fetch.calls[0].init?.body ?? '{}'), { text, region: { id: 'gyeongju', name: '경주' } });
  assert.deepEqual(out.map((p) => p.phrase), ['교촌마을', '불국사']);
  for (const p of out) assert.equal(text.slice(p.start, p.end), p.phrase);
});

test('AI 프록시 추출 실패·형식 오류면 규칙 기반으로 대체한다', async () => {
  for (const handler of [() => ({ status: 502 }), () => ({ body: { nope: 1 } }), () => ({ body: 'not json' })]) {
    const ex = createExtractionProvider({ aiProxyUrl: 'https://proxy.example', fetch: fakeFetch(handler) });
    const out = await ex.phrases('불국사랑 석굴암', { region });
    assert.deepEqual(out.map((p) => p.phrase), ['불국사', '석굴암']);
  }
  assert.equal(createExtractionProvider({ fetch: fakeFetch() }).id, 'rules');
});

const pool: Place[] = [
  { placeId: 'p1', name: '가', coord: { latitude: 35.83, longitude: 129.22 }, category: '관광지', tags: ['역사'], popularity: 50 },
  { placeId: 'p2', name: '나', coord: { latitude: 35.84, longitude: 129.21 }, category: '관광지', tags: ['역사'], popularity: 60 },
  { placeId: 'p3', name: '다', coord: { latitude: 35.82, longitude: 129.23 }, category: '카페', tags: ['카페'], popularity: 70 },
  { placeId: 'p4', name: '라', coord: { latitude: 36.08, longitude: 129.57 }, category: '관광지', tags: ['자연'], popularity: 90 },
];

test('AI 프록시 추천: 기존 후보·지역 밖·형식 오류를 걸러 내고, 3곳 미만이면 로컬로 대체한다', async () => {
  const ok = fakeFetch(() => ({
    body: {
      items: [
        { place: pool[0], reason: '역사 좋아하면\n두 줄' },
        { place: pool[1], reason: '가까워요' },
        { place: pool[2], reason: '커피' },
        { place: pool[3], reason: '지역 밖' },
        { place: { name: '모양 틀림' }, reason: 'x' },
      ],
      fallback: false,
    },
  }));
  const rec = createRecommendProvider({ aiProxyUrl: 'https://proxy.example', fetch: ok, places: fakePlaces(pool) });
  assert.equal(rec.id, 'ai');
  const r = await rec.recommend({ region, dates: [], tags: ['역사'], existing: [], limit: 5 });
  assert.equal(ok.calls[0].url, 'https://proxy.example/recommend');
  assert.deepEqual(r.items.map((i) => i.place.placeId), ['p1', 'p2', 'p3']);
  assert.equal(r.items[0].reason, '역사 좋아하면');
  const bad = createRecommendProvider({ aiProxyUrl: 'https://proxy.example', fetch: fakeFetch(() => ({ status: 500 })), places: fakePlaces(pool) });
  const r2 = await bad.recommend({ region, dates: [], tags: ['역사'], existing: [pool[0]], limit: 3 });
  assert.ok(r2.items.every((i) => i.place.placeId !== 'p1' && i.place.placeId !== 'p4'));
  assert.deepEqual(r2.items.map((i) => i.place.placeId).sort(), ['p2', 'p3']);
});

test('카카오 경로 오탐: 접미사 일상어는 검색어로 나가지 않고, 기점·기타 결과는 후보가 되지 않는다', async () => {
  const { extractForMessage } = await import('../src/core/extract');
  const { seqIds } = await import('./helpers/fakes');
  // 어떤 검색어든 지역 안 업체 하나를 돌려주는 카카오(최악의 경우)
  const fetch = fakeFetch((call) => ({
    body: {
      documents: [
        { id: '9', place_name: `${params(call).get('query')} 경주점`, category_group_code: '', category_name: '가정,생활 > 여행사', x: String(region.center.longitude), y: String(region.center.latitude) },
      ],
    },
  }));
  const deps = {
    extraction: createExtractionProvider({ fetch: fakeFetch() }),
    places: createPlaceProvider({ kakaoKey: 'K', fetch }),
    region,
    ids: seqIds(),
    at: 0,
  };
  const t = { spots: [], days: [] } as unknown as Parameters<typeof extractForMessage>[0];
  for (const text of ['여행사 통해서 예약했어', '간호사 친구가 추천했대', '미용사 언니가 알려줬어']) {
    const r = await extractForMessage(t, { id: 'm', text, memberId: 'm-a' }, deps);
    assert.equal(r.created.length + r.ambiguous.length, 0, text);
  }
  assert.equal(fetch.calls.length, 0, '접미사 일상어는 검색하지 않는다');
  // 이름이 맞아도 카테고리가 '기타'면 자동 추출하지 않는다
  const r = await extractForMessage(t, { id: 'm', text: '안압지 가자', memberId: 'm-a' }, deps);
  assert.equal(r.created.length, 0);
});
