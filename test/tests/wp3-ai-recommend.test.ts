import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Place } from '../src/types';
import { pickRecommendProxyUrl } from '../src/config';
import { freeSlotsOfPlan } from '../src/core/recommend';
import { regionById } from '../src/data/regions';
import { createPlaceProvider } from '../src/services/places';
import { createRecommendProvider } from '../src/services/recommend';
import { contextNames, createAiRecommend, providerBacked } from '../src/services/recommend/ai';
import { createLocalRecommend } from '../src/services/recommend/local';
import { fakeFetch } from './helpers/fakes';
import { read, stripComments } from './setup/scan';

/**
 * AI 여행지 추천 앱 쪽(2026-10-17). 추천 프록시 주소 고르기(AI_PROXY_URL, 없으면 API_URL/ai),
 * 요청 맥락(지역 중심·반경, 기존 장소 이름, 빈 시간. 채팅 글·멤버 이름 없음), 빈 시간 계산, 23 화면의 'AI 추천' 칩.
 */

const GJ = regionById('gyeongju')!;
const P = (placeId: string, name: string, lat = 35.84, lng = 129.21): Place => ({
  placeId,
  name,
  coord: { latitude: lat, longitude: lng },
  category: '관광지',
});

test('추천 프록시 주소: AI_PROXY_URL이 먼저, 없으면 API_URL/ai, 둘 다 없으면 빈 값', () => {
  assert.equal(pickRecommendProxyUrl('https://ai.example', 'http://127.0.0.1:8787'), 'https://ai.example');
  assert.equal(pickRecommendProxyUrl('', 'http://127.0.0.1:8787'), 'http://127.0.0.1:8787/ai');
  assert.equal(pickRecommendProxyUrl(undefined, 'http://127.0.0.1:8787'), 'http://127.0.0.1:8787/ai');
  assert.equal(pickRecommendProxyUrl('  ', ''), '');
  // registry: 추천만 RECOMMEND_PROXY_URL, 추출·일기는 AI_PROXY_URL 그대로
  const reg = stripComments(read('src/services/registry.ts'));
  assert.match(reg, /recommend: createRecommendProvider\(\{ aiProxyUrl: RECOMMEND_PROXY_URL \|\| undefined/);
  assert.match(reg, /const aiProxyUrl = AI_PROXY_URL \|\| undefined;/);
  assert.match(reg, /extraction: createExtractionProvider\(\{ aiProxyUrl,/);
  assert.match(reg, /diary: createDiaryWriter\(\{ aiProxyUrl,/);
});

test('요청 맥락: 지역 중심·반경, 기존 장소 이름(30개), 빈 시간(10개). 채팅 글·멤버 이름은 없다', async () => {
  const ok = fakeFetch(() => ({ body: { items: [], fallback: false } }));
  const rec = createRecommendProvider({ aiProxyUrl: 'http://127.0.0.1:8787/ai', fetch: ok, places: createPlaceProvider({ fetch: fakeFetch() }) });
  const existing = [
    P('kakao:a', '불국사'),
    P('custom-1', '민수네 집'),
    P('kakao:b', ' 첨성대  야경 '),
    P('kakao:c', '불국사'),
    ...Array.from({ length: 40 }, (_, i) => P(`kakao:x${i}`, `장소 ${i}`)),
  ];
  const slots = Array.from({ length: 12 }, (_, i) => `10/17 ${String(9 + i).padStart(2, '0')}:00-23:00`);
  const r = await rec.recommend({ region: GJ, dates: ['2026-10-17'], tags: ['역사'], existing, limit: 5, freeSlots: slots });
  assert.equal(ok.calls[0].url, 'http://127.0.0.1:8787/ai/recommend');
  const sent = JSON.parse(String(ok.calls[0].init?.body));
  assert.deepEqual(Object.keys(sent).sort(), ['candidates', 'dates', 'existing', 'freeSlots', 'limit', 'region', 'tags']);
  assert.deepEqual(sent.region, { id: GJ.id, name: GJ.name, center: GJ.center, radiusKm: GJ.radiusKm });
  assert.equal(sent.candidates.length, 30);
  assert.deepEqual(sent.candidates.slice(0, 2), ['불국사', '첨성대 야경'], '직접 적은 장소 이름(민수네 집)은 보내지 않는다');
  assert.ok(!sent.candidates.includes('민수네 집'));
  assert.ok(sent.existing.includes('custom-1'), '겹침 확인용 placeId는 그대로 보낸다');
  assert.equal(sent.freeSlots.length, 10);
  assert.equal(r.source, 'local', '빈 결과면 로컬로 대체');
  assert.equal(r.aiUnavailable, true);
  assert.deepEqual(contextNames([P('kakao:a', 'x'.repeat(80))])[0].length, 40);
  assert.ok(providerBacked({ placeId: 'gj-bulguksa' }) && providerBacked({ placeId: 'kakao:1' }));
  assert.ok(!providerBacked({ placeId: 'custom-1' }));
  assert.deepEqual(contextNames([P('gj-bulguksa', '불국사'), P('u1', '우리 회사 앞')]), ['불국사']);
});

test('빈 시간: 스팟 사이(이동 시간 뺌)·마지막 뒤(복귀 뺌)·빈 날 전체, 60분 미만은 뺀다', () => {
  const item = (arrive: string, depart: string, travelMin = 0) => ({ arrive, depart, travelMin }) as never;
  const slots = freeSlotsOfPlan([
    {
      date: '2026-10-17',
      startMin: 9 * 60,
      endLimitMin: 21 * 60,
      returnMin: 30,
      items: [item('09:00', '11:00'), item('11:40', '13:00', 20), item('15:00', '17:00', 30)],
    },
    { date: '2026-10-18', startMin: 10 * 60, endLimitMin: 18 * 60, returnMin: 0, items: [] },
  ]);
  assert.deepEqual(slots, ['10/17 13:00-14:30', '10/17 17:00-20:30', '10/18 10:00-18:00']);
  assert.equal(freeSlotsOfPlan([{ date: '2026-10-18', startMin: 0, endLimitMin: 600, returnMin: 0, items: [] }], 60, 0).length, 0);
});

test('23 화면: 결과 출처가 ai면 AI 추천 칩, 로컬이면 칩 없음, 빈 시간 맥락을 함께 보낸다', () => {
  const src = stripComments(read('src/screens/RecommendScreen.tsx'));
  assert.match(src, /resultSource\(result\.r\) === 'ai'[^]*?<Chip text="AI 추천"/);
  assert.equal(src.match(/<Chip text="AI 추천"/g)?.length, 1);
  assert.match(src, /freeSlots: plan \? freeSlotsOfPlan\(plan\.days\) : \[\]/);
  // 이유 줄은 카드마다 그대로
  assert.match(src, /\{reason \? <Txt v="mt">\{reason\}<\/Txt> : null\}/);
  // 고르는 중·실패 안내는 '~요'
  assert.match(src, /추천을 고르는 중이에요/);
  assert.match(src, /추천을 불러오지 못했어요/);
  assert.doesNotMatch(src, /messages|memberNames|chat/);
});

/* ---------- 리뷰 반영(2026-10-17): 시간 제한·대체·채우기·화면 ---------- */

const local = createLocalRecommend({ places: createPlaceProvider({ fetch: fakeFetch() }) });
const REQ = { region: GJ, dates: ['2026-10-17'], tags: ['역사'], existing: [] as Place[], limit: 5 };
const aiPlace = (id: string, name: string): Place => ({ ...P(id, name), category: '카페' });

test('앱 시간 제한: 프록시가 답하지 않으면 시간이 지나 로컬로 대체하고 aiUnavailable을 세운다(실패·0곳도 같다)', async () => {
  const hang = fakeFetch(() => new Promise(() => {}));
  const rec = createAiRecommend({ url: 'http://127.0.0.1:8787/ai', fetch: hang, fallback: local, timeoutMs: 30 });
  const started = Date.now();
  const r = await rec.recommend(REQ);
  assert.ok(Date.now() - started < 2000);
  assert.equal(r.source, 'local');
  assert.equal(r.aiUnavailable, true);
  assert.ok(r.items.length >= 3);
  // 503(바쁨)도 같은 대체
  const busy = createAiRecommend({ url: 'http://x/ai', fetch: fakeFetch(() => ({ status: 503, body: { error: 'aiBusy' } })), fallback: local });
  const r2 = await busy.recommend(REQ);
  assert.equal(r2.aiUnavailable, true);
  assert.equal(r2.source, 'local');
});

test('끊긴 요청(새 요청이 대신함)은 로컬로 대체하지 않고 던진다', async () => {
  const ac = new AbortController();
  const hang = fakeFetch(() => new Promise(() => {}));
  const rec = createAiRecommend({ url: 'http://x/ai', fetch: hang, fallback: local, timeoutMs: 5000 });
  const p = rec.recommend({ ...REQ, signal: ac.signal });
  ac.abort();
  await assert.rejects(p);
  await assert.rejects(rec.recommend({ ...REQ, signal: ac.signal }), '이미 끊긴 신호');
});

test('AI가 1~2곳만 남으면 버리지 않고 로컬로 채운다. AI 곳이 절반을 넘을 때만 출처 ai', async () => {
  const two = [
    { place: aiPlace('kakao:91', '황리단길 작은 카페'), reason: '카페 취향에 맞아요' },
    { place: aiPlace('kakao:92', '대릉원 옆 찻집'), reason: '역사 산책 뒤 쉬어 가요' },
  ];
  const f = fakeFetch(() => ({ body: { items: two, fallback: false } }));
  const rec = createAiRecommend({ url: 'http://x/ai', fetch: f, fallback: local });
  const r5 = await rec.recommend(REQ);
  assert.equal(r5.items.length, 5);
  assert.deepEqual(r5.items.slice(0, 2).map((i) => i.place.placeId), ['kakao:91', 'kakao:92'], 'AI 곳이 앞');
  assert.equal(r5.source, 'local', '5곳 중 2곳이면 로컬');
  assert.ok(!r5.aiUnavailable);
  assert.equal(new Set(r5.items.map((i) => i.place.placeId)).size, 5);
  const r3 = await rec.recommend({ ...REQ, limit: 3 });
  assert.equal(r3.items.length, 3);
  assert.equal(r3.source, 'ai', '3곳 중 2곳이면 ai');
});

test('23 화면: 태그 호출은 잠깐 기다리고, 가장 최근 요청만 반영하며, AI를 받지 못하면 이전 AI 결과를 지키거나 다시 시도를 보인다', () => {
  const src = stripComments(read('src/screens/RecommendScreen.tsx'));
  // 가장 최근 요청만(reqNo)
  assert.match(src, /const no = \+\+reqNo\.current;/);
  assert.ok((src.match(/if \(no !== reqNo\.current\) return;/g)?.length ?? 0) >= 2);
  // 태그를 바꾸면 기다렸다가 부른다(첫 진입은 바로), 정리할 때 타이머를 지우고 요청을 끊는다
  assert.match(src, /firstLoad\.current \? 0 : RECOMMEND_TAG_DEBOUNCE_MS/);
  assert.match(src, /setTimeout\(\(\) => void load\(\), delay\)/);
  assert.match(src, /clearTimeout\(timer\);[^]*?reqNo\.current \+= 1;[^]*?ctl\.current\?\.abort\(\);/);
  assert.match(src, /signal: ac\?\.signal/);
  // '다시 추천 받기'·'다시 시도'는 바로 부른다
  assert.match(src, /<Btn title="다시 추천 받기" variant="quiet" onPress=\{\(\) => void load\(\)\}/);
  // aiUnavailable: 같은 태그의 AI 결과는 지키고 토스트
  assert.match(src, /r\.aiUnavailable && prev && resultSource\(prev\.r\) === 'ai'[^]*?sameTags\(prev\.tags, asked\)[^]*?toast\('지금은 AI 추천이 바빠요\. 잠시 뒤 다시 시도해 주세요'/);
  // 없으면 로컬 목록 + 맞는 안내 + 다시 시도. 태그 부족 안내보다 먼저 본다
  assert.match(src, /const aiDown = !loadFailed && !!result\?\.r\.aiUnavailable;\s*const failed = loadFailed \|\| aiDown;/);
  assert.match(
    src,
    /\) : failed \? \([^]*?text=\{aiDown \? 'AI 추천을 잠시 받지 못해 많이 찾는 곳을 보여 드려요' : '추천을 불러오지 못했어요[^]*?label: '다시 시도'[^]*?\) : result\?\.r\.fallback \?/,
  );
  read('src/core/recommend.ts').includes('RECOMMEND_TAG_DEBOUNCE_MS = 450') || assert.fail('디바운스 450ms');
});
