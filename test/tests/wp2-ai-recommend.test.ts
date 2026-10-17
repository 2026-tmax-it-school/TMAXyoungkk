import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FetchLike } from '../src/core/ports';
import { regionById } from '../src/data/regions';
import { placeFromKakao as appPlaceFromKakao, type KakaoPlaceDoc } from '../src/services/places/kakao';
import { createPlaceProvider } from '../src/services/places';
import { createRecommendProvider } from '../src/services/recommend';
import {
  AI_LIMITS,
  aiOptionsFromEnv,
  clientIp,
  createAiRecommender,
  GEMINI_BASE_URL,
  isAiPath,
  KAKAO_KEYWORD_URL,
  NEUTRAL_REASON,
  placeFromKakao,
  safeReason,
  usesThinkingBudget,
  type AiFetch,
  type AiRecommenderOptions,
} from '../server/ai.mjs';
import { startSyncServer } from '../server/sync-server.mjs';

/**
 * AI 여행지 추천 서버(server/ai.mjs, 2026-10-17). Gemini와 카카오는 가짜 fetch로 바꿔 끼워 네트워크 없이 본다.
 * 아이디어를 카카오로 확인해 지역 밖·기존·중복·'기타'를 버리는지, 키가 없으면 503, Gemini 시간 초과·틀린 JSON,
 * IP별 속도 제한, 10분 캐시, 입력 상한, 채팅 글 같은 모르는 이름 거부, 실제 HTTP 서버와 앱 추천 제공자 연결을 본다.
 */

const GEMINI_KEY = 'TEST-GEMINI-KEY-abcdef0123';
const KAKAO_KEY = 'TEST-KAKAO-KEY-9876543210';
const T0 = Date.UTC(2026, 9, 17, 1, 0, 0);
const GJ = regionById('gyeongju')!;

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } };

const doc = (id: string, name: string, lat: number, lng: number, code: string, cat: string): KakaoPlaceDoc => ({
  id,
  place_name: name,
  category_group_code: code,
  category_name: cat,
  road_address_name: `경북 경주시 ${name}길 1`,
  x: String(lng),
  y: String(lat),
});

const IDEAS = [
  { keyword: '경주 황리단길 카페', category: '카페', reason: '카페 좋아하는 취향에 맞아요' },
  { keyword: '경주 대릉원', category: '관광지', reason: '역사 태그와 잘 맞아요' },
  { keyword: '경주 해운대', category: '관광지', reason: '바다를 보러 가요' },
  { keyword: '경주 첨성대 카페', category: '카페', reason: '같은 곳이 또 나와요' },
  { keyword: '경주 교촌마을', category: '관광지', reason: '한옥 골목을 걸어요' },
  { keyword: '경주 불국사', category: '관광지', reason: '이미 담은 곳이에요' },
  { keyword: '경주 보문호', category: '공원', reason: '저녁 빈 시간에 산책하기 좋아요' },
];

/** 검색어 → 카카오 문서 */
const KAKAO_DOCS: Record<string, KakaoPlaceDoc[]> = {
  '경주 황리단길 카페': [doc('1', '황리단길 카페', 35.837, 129.21, 'CE7', '음식점 > 카페')],
  // 기존 후보(kakao:2)는 건너뛰고 다음 결과를 쓴다
  '경주 대릉원': [doc('2', '대릉원 입구', 35.838, 129.211, 'AT4', '여행 > 관광,명소'), doc('3', '대릉원', 35.8381, 129.2121, 'AT4', '여행 > 관광,명소 > 고분')],
  // 지역 밖(부산)
  '경주 해운대': [doc('4', '해운대해수욕장', 35.1587, 129.1604, 'AT4', '여행 > 관광,명소 > 해수욕장')],
  // 이미 고른 곳과 같은 장소(중복)
  '경주 첨성대 카페': [doc('1', '황리단길 카페', 35.837, 129.21, 'CE7', '음식점 > 카페')],
  // 숙박은 건너뛴다
  '경주 교촌마을': [doc('5', '교촌한옥스테이', 35.8296, 129.2154, 'AD5', '여행 > 숙박 > 한옥스테이'), doc('6', '경주교촌마을', 35.8293, 129.2149, 'AT4', '여행 > 관광,명소 > 민속마을')],
  // 이미 담은 장소 이름과 같다(placeId가 달라도 버린다)
  '경주 불국사': [doc('8', '불국사', 35.7901, 129.3321, 'AT4', '여행 > 관광,명소 > 사찰')],
  '경주 보문호': [doc('7', '보문호수 산책길', 35.8434, 129.2873, 'AT4', '여행 > 공원 > 호수')],
};

function geminiBody(ideas: unknown) {
  return { candidates: [{ content: { parts: [{ text: typeof ideas === 'string' ? ideas : JSON.stringify({ ideas }) }] } }] };
}

type GeminiReply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** 가짜 상류. gemini는 Gemini 응답을 정한다(기본 IDEAS). headers는 소문자 이름 */
function upstream(gemini?: (call: Call) => Promise<GeminiReply> | GeminiReply) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init?: Call['init']) => {
    calls.push({ url, init });
    let status = 200;
    let body: unknown = {};
    let headers: Record<string, string> = {};
    if (url.startsWith(GEMINI_BASE_URL)) {
      const r: GeminiReply = gemini ? await gemini({ url, init }) : { body: geminiBody(IDEAS) };
      status = r.status ?? 200;
      body = r.body;
      headers = r.headers ?? {};
    } else if (url.startsWith(KAKAO_KEYWORD_URL)) {
      const q = new URL(url).searchParams.get('query') ?? '';
      body = { documents: KAKAO_DOCS[q] ?? [] };
    } else {
      status = 404;
    }
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
  }) as AiFetch;
  return {
    fetch,
    calls,
    gemini: () => calls.filter((c) => c.url.startsWith(GEMINI_BASE_URL)),
    kakao: () => calls.filter((c) => c.url.startsWith(KAKAO_KEYWORD_URL)),
  };
}

function body(over: Record<string, unknown> = {}) {
  return {
    region: { id: GJ.id, name: GJ.name, center: GJ.center, radiusKm: GJ.radiusKm },
    dates: ['2026-10-17', '2026-10-18'],
    tags: ['역사', '카페'],
    existing: ['kakao:2', 'gj-bulguksa'],
    limit: 5,
    candidates: ['불국사', '첨성대'],
    freeSlots: ['10/17 18:00-21:00'],
    ...over,
  };
}

function service(over: AiRecommenderOptions = {}) {
  const up = upstream();
  const logs: string[] = [];
  let t = T0;
  const ai = createAiRecommender({
    geminiKey: GEMINI_KEY,
    kakaoKey: KAKAO_KEY,
    fetch: up.fetch,
    now: () => t,
    // 재시도 사이는 기다리지 않는다(재시도 테스트는 따로 바꿔 끼운다)
    sleep: async () => {},
    log: (m) => logs.push(m),
    ...over,
  });
  return { ai, up, logs, advance: (ms: number) => (t += ms) };
}

const post = (ai: ReturnType<typeof createAiRecommender>, b: unknown, ip = '10.0.0.1') =>
  ai.handle({ method: 'POST', path: 'recommend', body: b, ip });

type Items = { items: { place: { placeId: string; name: string; category: string }; reason: string }[]; fallback: boolean };

test('설정: GEMINI_API_KEY·GEMINI_MODEL(기본 gemini-2.5-flash)·GEMINI_FALLBACK_MODEL·TRUST_PROXY, /ai 경로', () => {
  assert.deepEqual(aiOptionsFromEnv({}), { geminiKey: '', model: 'gemini-2.5-flash', fallbackModel: '', trustProxy: false });
  assert.deepEqual(
    aiOptionsFromEnv({ GEMINI_API_KEY: ' k ', GEMINI_MODEL: 'gemini-2.5-pro', GEMINI_FALLBACK_MODEL: ' gemini-2.5-flash-lite ', TRUST_PROXY: '1' }),
    { geminiKey: 'k', model: 'gemini-2.5-pro', fallbackModel: 'gemini-2.5-flash-lite', trustProxy: true },
  );
  assert.equal(aiOptionsFromEnv({ GEMINI_MODEL: '../x?y' }).model, 'gemini-2.5-flash');
  assert.equal(aiOptionsFromEnv({ GEMINI_FALLBACK_MODEL: '../x?y' }).fallbackModel, '');
  assert.equal(aiOptionsFromEnv({ TRUST_PROXY: 'no' }).trustProxy, false);
  assert.ok(isAiPath('/ai/recommend'));
  assert.ok(!isAiPath('/aix') && !isAiPath('/kakao/ai'));
});

test('서버 장소 모양은 앱 placeFromKakao와 같다', () => {
  for (const docs of Object.values(KAKAO_DOCS)) for (const d of docs) assert.deepEqual(placeFromKakao(d), appPlaceFromKakao(d));
  assert.equal(placeFromKakao({ id: '', place_name: 'x', x: '1', y: '2' }), null);
});

test('정상: Gemini 아이디어를 카카오로 확인하고 지역 밖·기존·중복·기타·같은 이름을 버린다', async () => {
  const { ai, up } = service();
  const r = await post(ai, body());
  assert.equal(r.status, 200);
  const out = r.body as Items;
  assert.equal(out.fallback, false);
  assert.deepEqual(
    out.items.map((i) => i.place.placeId),
    ['kakao:1', 'kakao:3', 'kakao:6', 'kakao:7'],
  );
  assert.deepEqual(out.items.map((i) => i.place.category), ['카페', '관광지', '관광지', '공원']);
  assert.equal(out.items[3].reason, '저녁 빈 시간에 산책하기 좋아요');
  // Gemini: 키는 헤더로만, JSON 응답 틀, 지시문에 맥락(이미 담은 장소·빈 시간)
  const g = up.gemini();
  assert.equal(g.length, 1);
  assert.equal(g[0].url, `${GEMINI_BASE_URL}/gemini-2.5-flash:generateContent`);
  assert.equal(g[0].init?.headers?.['x-goog-api-key'], GEMINI_KEY);
  assert.ok(!g[0].url.includes(GEMINI_KEY));
  const sent = JSON.parse(g[0].init?.body ?? '{}');
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(sent.generationConfig.responseSchema.properties.ideas.items.properties.category.enum, ['식당', '카페', '관광지', '쇼핑', '공원']);
  const prompt: string = sent.contents[0].parts[0].text;
  assert.match(prompt, /경주/);
  assert.match(prompt, /불국사/);
  assert.match(prompt, /10\/17 18:00-21:00/);
  assert.match(prompt, /'~요'/);
  // 카카오: 아이디어마다 지역 중심·반경(20km 상한) 검색, 서버 키 헤더
  const k = up.kakao();
  assert.equal(k.length, IDEAS.length);
  const q = new URL(k[0].url).searchParams;
  assert.equal(q.get('x'), String(GJ.center.longitude));
  assert.equal(q.get('y'), String(GJ.center.latitude));
  assert.equal(q.get('radius'), '20000');
  assert.equal(k[0].init?.headers?.Authorization, `KakaoAK ${KAKAO_KEY}`);
  // 응답에 키가 섞이지 않는다
  assert.ok(!JSON.stringify(r.body).includes(GEMINI_KEY) && !JSON.stringify(r.body).includes(KAKAO_KEY));
});

test('limit만큼만 돌려주고 이유는 한 줄·60자로 자른다', async () => {
  const long = '가'.repeat(80);
  const { ai } = service({
    fetch: upstream(() => ({ body: geminiBody(IDEAS.map((i) => ({ ...i, reason: `${long}\n둘째 줄` }))) })).fetch,
  });
  const r = await post(ai, body({ limit: 3 }));
  const out = r.body as Items;
  assert.equal(out.items.length, 3);
  for (const it of out.items) {
    assert.ok(it.reason.length <= AI_LIMITS.reasonMax);
    assert.ok(!it.reason.includes('\n'));
  }
});

test('키가 없으면 503(aiDisabled·groundingDisabled)이고 상류를 부르지 않는다', async () => {
  const noGemini = service({ geminiKey: '' });
  const r = await post(noGemini.ai, body());
  assert.equal(r.status, 503);
  assert.equal((r.body as { error: string }).error, 'aiDisabled');
  assert.equal(noGemini.up.calls.length, 0);
  const noKakao = service({ kakaoKey: '' });
  const r2 = await post(noKakao.ai, body());
  assert.equal(r2.status, 503);
  assert.equal((r2.body as { error: string }).error, 'groundingDisabled');
  assert.equal(noKakao.up.calls.length, 0);
});

test('Gemini 시간 초과는 요청을 끊고 503, 틀린 JSON은 502, 재시도 뒤 429는 503 aiBusy. 기록은 상태 한 줄(키·지시문 없음)', async () => {
  let aborted = false;
  const hang = upstream(
    (call) =>
      new Promise((_, reject) => {
        call.init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }),
  );
  const slow = service({ fetch: hang.fetch, timeoutMs: 30 });
  const r = await post(slow.ai, body());
  assert.equal(r.status, 503);
  assert.equal((r.body as { error: string }).error, 'aiTimeout');
  assert.ok(aborted, '시간이 지나면 요청을 끊는다');
  assert.equal(hang.kakao().length, 0);

  const bad = service({ fetch: upstream(() => ({ body: geminiBody('이건 JSON이 아니에요') })).fetch });
  const r2 = await post(bad.ai, body());
  assert.equal(r2.status, 502);
  assert.equal((r2.body as { error: string }).error, 'aiBadResponse');

  const notJson = service({ fetch: upstream(() => ({ body: '<html>' })).fetch });
  assert.equal((await post(notJson.ai, body())).status, 502);

  const downUp = upstream(() => ({ status: 429, body: { error: { message: `quota ${GEMINI_KEY}` } } }));
  const down = service({ fetch: downUp.fetch });
  const r3 = await post(down.ai, body());
  assert.equal(r3.status, 503, '재시도 뒤에도 429면 바쁨');
  assert.equal((r3.body as { error: string }).error, 'aiBusy');
  assert.equal(r3.headers['Retry-After'], '5');
  assert.equal(downUp.gemini().length, 3, '두 번까지 다시 묻는다');
  assert.ok(!JSON.stringify(r3.body).includes(GEMINI_KEY));
  for (const logs of [slow.logs, bad.logs, down.logs]) {
    assert.equal(logs.length, 1);
    assert.ok(logs[0].length < 60);
    assert.ok(!logs[0].includes(GEMINI_KEY) && !logs[0].includes('경주') && !logs[0].includes('불국사'));
  }
  assert.match(down.logs[0], /429/);
  // 실패는 캐시하지 않는다
  assert.equal((await post(down.ai, body())).status, 503);
  assert.equal(down.logs.length, 2);
});

test('캐시: 같은 요청(배열 순서 무관)은 10분 동안 Gemini에 다시 묻지 않는다', async () => {
  const { ai, up, advance } = service();
  const a = await post(ai, body());
  assert.equal(a.headers['X-Cache'], 'miss');
  const b = await post(ai, body({ tags: ['카페', '역사'], candidates: ['첨성대', '불국사'] }));
  assert.equal(b.headers['X-Cache'], 'hit');
  assert.deepEqual(b.body, a.body);
  assert.equal(up.gemini().length, 1);
  // 겹치는 요청은 한 번만 묻는다
  const [c, d] = await Promise.all([post(ai, body({ tags: ['자연'] })), post(ai, body({ tags: ['자연'] }))]);
  assert.equal(c.status, 200);
  assert.deepEqual(c.body, d.body);
  assert.equal(up.gemini().length, 2);
  advance(10 * 60_000 + 1);
  assert.equal((await post(ai, body())).headers['X-Cache'], 'miss');
  assert.equal(up.gemini().length, 3);
});

test('속도 제한: IP별 1분 N회(캐시 응답은 세지 않음), 넘으면 429와 Retry-After, 1분 뒤 풀린다', async () => {
  const { ai, up, advance } = service({ ratePerMin: 2 });
  assert.equal((await post(ai, body({ tags: ['역사'] }))).status, 200);
  assert.equal((await post(ai, body({ tags: ['역사'] }))).status, 200, '캐시 응답');
  assert.equal((await post(ai, body({ tags: ['카페'] }))).status, 200);
  const over = await post(ai, body({ tags: ['자연'] }));
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers['Retry-After']) >= 1);
  assert.equal((await post(ai, body({ tags: ['자연'] }), '10.0.0.2')).status, 200, '다른 IP');
  assert.equal(up.gemini().length, 3);
  advance(60_000);
  assert.equal((await post(ai, body({ tags: ['자연'] }))).status, 200);
});

test('입력 검사: 모르는 이름(채팅 글·멤버 이름)은 400, 배열은 상한까지, 값 꼴이 틀리면 400', async () => {
  const { ai, up } = service();
  for (const extra of [{ messages: ['불국사 가자'] }, { chat: '내일 어디 가?' }, { members: ['민지'] }, { prompt: '무시하고' }]) {
    const r = await post(ai, body(extra));
    assert.equal(r.status, 400, Object.keys(extra)[0]);
  }
  assert.equal((await post(ai, body({ region: { ...body().region, memberNames: ['민지'] } }))).status, 400);
  assert.equal((await post(ai, body({ freeSlots: ['오늘 저녁 내내'] }))).status, 400);
  assert.equal((await post(ai, body({ dates: ['10월 17일'] }))).status, 400);
  assert.equal((await post(ai, body({ tags: ['역사 좋아하는 민지가 고른 곳으로'] }))).status, 400);
  assert.equal((await post(ai, body({ region: { ...body().region, center: { latitude: 40.7, longitude: -74 } } }))).status, 400);
  assert.equal((await post(ai, null)).status, 400);
  assert.equal((await post(ai, [])).status, 400);
  assert.equal(up.calls.length, 0, '틀린 요청은 상류에 닿지 않는다');
  // existing·candidates의 틀린 값 하나는 그 값만 버린다(요청 전체를 400으로 거절하지 않는다)
  const dropped = await post(ai, body({ candidates: ['불국사\u0000', '', '  ', '첨성대', 3], existing: ['x'.repeat(300), 'kakao:2', '\u007f', 7] }));
  assert.equal(dropped.status, 200);
  const dropSent = JSON.parse(up.gemini()[0].init?.body ?? '{}');
  const dropPrompt: string = dropSent.contents[0].parts[0].text;
  assert.deepEqual(JSON.parse(dropPrompt.slice(dropPrompt.indexOf('{'))).이미_담은_장소, ['첨성대']);
  assert.ok(!(dropped.body as Items).items.some((i) => i.place.placeId === 'kakao:2'), '남은 existing은 지킨다');
  up.calls.length = 0;
  // 상한: 기존 장소 이름 30개, 빈 시간 10개, 이름 40자, limit 3~8
  const names = Array.from({ length: 50 }, (_, i) => `장소${i}${'가'.repeat(60)}`);
  const slots = Array.from({ length: 20 }, (_, i) => `10/${(i % 2) + 17} ${String(9 + (i % 10)).padStart(2, '0')}:00-23:00`);
  const r = await post(ai, body({ candidates: names, freeSlots: slots, limit: 99 }));
  assert.equal(r.status, 200);
  const sent = JSON.parse(up.gemini()[0].init?.body ?? '{}');
  const prompt: string = sent.contents[0].parts[0].text;
  const ctx = JSON.parse(prompt.slice(prompt.indexOf('{')));
  assert.equal(ctx.이미_담은_장소.length, AI_LIMITS.candidates);
  assert.ok(ctx.이미_담은_장소.every((n: string) => n.length <= AI_LIMITS.nameMax));
  assert.equal(ctx.빈_시간.length, AI_LIMITS.freeSlots);
  assert.ok((r.body as Items).items.length <= AI_LIMITS.limitMax);
  // 405·404
  assert.equal((await ai.handle({ method: 'GET', path: 'recommend' })).status, 405);
  assert.equal((await ai.handle({ method: 'POST', path: 'extract', body: {} })).status, 404);
});

test('HTTP 서버: POST /ai/recommend, 큰 본문 413, ai:false면 404, 앱 추천 제공자가 API_URL/ai로 붙는다', async () => {
  const up = upstream();
  const server = await startSyncServer({
    purgeEveryMs: 0,
    proxy: { kakaoKey: KAKAO_KEY, fetch: up.fetch },
    ai: { geminiKey: GEMINI_KEY },
  });
  const off = await startSyncServer({ purgeEveryMs: 0, proxy: false, ai: false });
  const nokey = await startSyncServer({ purgeEveryMs: 0, proxy: { kakaoKey: KAKAO_KEY, fetch: up.fetch } });
  try {
    const res = await fetch(`${server.url}/ai/recommend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(((await res.json()) as Items).items.length, 4);
    const big = await fetch(`${server.url}/ai/recommend`, { method: 'POST', body: JSON.stringify(body({ candidates: ['가'.repeat(12 * 1024)] })) });
    assert.equal(big.status, 413);
    assert.equal((await fetch(`${off.url}/ai/recommend`, { method: 'POST', body: '{}' })).status, 404);
    const disabled = await fetch(`${nokey.url}/ai/recommend`, { method: 'POST', body: JSON.stringify(body()) });
    assert.equal(disabled.status, 503);
    assert.equal(((await disabled.json()) as { error: string }).error, 'aiDisabled');

    // 앱: 추천 제공자가 `${API_URL}/ai/recommend`로 묻는다. AI 결과면 source 'ai', 키가 없으면 로컬로 대체
    const appFetch = globalThis.fetch as unknown as FetchLike;
    const places = createPlaceProvider({ fetch: appFetch });
    const req = { region: GJ, dates: ['2026-10-17'], tags: ['역사'], existing: [], limit: 5, freeSlots: ['10/17 18:00-21:00'] };
    const rec = createRecommendProvider({ aiProxyUrl: `${server.url}/ai`, fetch: appFetch, places });
    const r = await rec.recommend(req);
    assert.equal(r.source, 'ai');
    assert.ok(r.items.length >= 3);
    assert.ok(r.items.every((i) => i.place.placeId.startsWith('kakao:')));
    const fallback = createRecommendProvider({ aiProxyUrl: `${nokey.url}/ai`, fetch: appFetch, places });
    const r2 = await fallback.recommend(req);
    assert.equal(r2.source, 'local');
    assert.ok(r2.items.length >= 3);
  } finally {
    await server.close();
    await off.close();
    await nokey.close();
  }
});

/* ---------- 리뷰 반영(2026-10-17): 재시도·대체 모델·오류 구분·캐시·IP·이유 ---------- */

/** 차례대로 답하는 Gemini. 다 쓰면 마지막 답을 되풀이한다 */
function scripted(replies: (GeminiReply | 'throw')[], onCall?: (call: Call) => void) {
  let i = 0;
  return upstream((call) => {
    onCall?.(call);
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (r === 'throw') throw new Error('socket hang up');
    return r;
  });
}
const OK: GeminiReply = { body: geminiBody(IDEAS) };
const modelOf = (c: Call) => decodeURIComponent(c.url.slice(GEMINI_BASE_URL.length + 1).split(':')[0]);

test('재시도: 503 다음 200이면 200(Gemini 두 번), 연결 끊김도 다시 묻는다, 속도 제한은 요청 하나로 센다', async () => {
  const up = scripted([{ status: 503 }, OK]);
  const sleeps: number[] = [];
  const { ai, logs } = service({ fetch: up.fetch, ratePerMin: 1, random: () => 0, sleep: async (ms) => void sleeps.push(ms) });
  const r = await post(ai, body());
  assert.equal(r.status, 200);
  assert.equal(up.gemini().length, 2);
  assert.deepEqual(sleeps, [250]);
  assert.equal(logs.length, 0);
  assert.equal((await post(ai, body({ tags: ['자연'] }))).status, 429, '재시도는 따로 세지 않는다(1회 = 요청 하나)');

  const net = scripted(['throw', OK]);
  const n = service({ fetch: net.fetch });
  assert.equal((await post(n.ai, body())).status, 200);
  assert.equal(net.gemini().length, 2);
});

test('재시도: 503이 세 번이면 503 aiBusy(Retry-After 5), 403은 다시 묻지 않고 502 aiConfig(설정 확인 기록), 500은 502 aiFailed', async () => {
  const busy = scripted([{ status: 503 }]);
  const b = service({ fetch: busy.fetch });
  const r = await post(b.ai, body());
  assert.equal(r.status, 503);
  assert.equal((r.body as { error: string }).error, 'aiBusy');
  assert.equal(r.headers['Retry-After'], '5');
  assert.equal(busy.gemini().length, 3);
  assert.equal(busy.kakao().length, 0);

  const cfg = scripted([{ status: 403, body: { error: { message: GEMINI_KEY } } }]);
  const c = service({ fetch: cfg.fetch });
  const r2 = await post(c.ai, body());
  assert.equal(r2.status, 502);
  assert.equal((r2.body as { error: string }).error, 'aiConfig');
  assert.equal(cfg.gemini().length, 1, '설정 오류는 다시 묻지 않는다');
  assert.match(c.logs[0], /AI 추천 설정 확인 필요\(gemini 403\)/);
  assert.ok(!c.logs[0].includes(GEMINI_KEY));
  for (const st of [400, 401, 404]) {
    const x = scripted([{ status: st }]);
    assert.equal((await post(service({ fetch: x.fetch }).ai, body())).status, 502);
    assert.equal(x.gemini().length, 1);
  }

  const err = scripted([{ status: 500 }]);
  const e = service({ fetch: err.fetch });
  const r3 = await post(e.ai, body());
  assert.equal(r3.status, 502);
  assert.equal((r3.body as { error: string }).error, 'aiFailed');
  assert.equal(err.gemini().length, 3);
});

test('재시도: 마감을 넘기지 않는다(남은 시간이 1.5초보다 적으면 그만), Retry-After는 마감 안에 들 때만 따른다', async () => {
  let clock = 0;
  const starts: number[] = [];
  const slow = scripted([{ status: 503 }], () => {
    starts.push(clock);
    clock += 4000;
  });
  const { ai } = service({
    fetch: slow.fetch,
    timeoutMs: 9000,
    clock: () => clock,
    random: () => 0,
    sleep: async (ms) => void (clock += ms),
  });
  const r = await post(ai, body());
  assert.equal(r.status, 503);
  // 0 → 4000(쉬고 4250) → 8250: 남은 750ms < 1.5초라 세 번째는 묻지 않는다
  assert.deepEqual(starts, [0, 4250]);
  assert.ok(starts.every((t) => 9000 - t >= 1500));

  const sleeps: number[] = [];
  const ra = scripted([{ status: 429, headers: { 'retry-after': '2' } }, OK]);
  const a = service({ fetch: ra.fetch, random: () => 0, sleep: async (ms) => void sleeps.push(ms) });
  assert.equal((await post(a.ai, body())).status, 200);
  assert.deepEqual(sleeps, [2000], 'Retry-After 2초가 마감 안에 들어 따른다');

  const sleeps2: number[] = [];
  const far = scripted([{ status: 429, headers: { 'retry-after': '60' } }, OK]);
  const f = service({ fetch: far.fetch, random: () => 0, sleep: async (ms) => void sleeps2.push(ms) });
  assert.equal((await post(f.ai, body())).status, 200);
  assert.deepEqual(sleeps2, [250], '마감을 넘는 Retry-After는 기본 쉬는 시간');
});

test('대체 모델: 503·429 바로 뒤와 마지막 재시도는 GEMINI_FALLBACK_MODEL, thinkingBudget은 gemini-2.5-flash 계열에만', async () => {
  const a = scripted([{ status: 503 }, { status: 503 }, OK]);
  const s1 = service({ fetch: a.fetch, fallbackModel: 'gemini-2.5-flash-lite' });
  assert.equal((await post(s1.ai, body())).status, 200);
  assert.deepEqual(a.gemini().map(modelOf), ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite']);
  assert.equal(s1.ai.info().fallbackModel, 'gemini-2.5-flash-lite');

  const b = scripted([{ status: 500 }, { status: 500 }, OK]);
  const s2 = service({ fetch: b.fetch, fallbackModel: 'gemini-3-flash-preview' });
  assert.equal((await post(s2.ai, body())).status, 200);
  assert.deepEqual(b.gemini().map(modelOf), ['gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-3-flash-preview'], '500은 마지막 재시도만 대체');
  const cfgOf = (c: Call) => JSON.parse(c.init?.body ?? '{}').generationConfig;
  assert.deepEqual(cfgOf(b.gemini()[0]).thinkingConfig, { thinkingBudget: 0 });
  assert.equal(cfgOf(b.gemini()[2]).thinkingConfig, undefined, '다른 세대 flash에는 thinkingBudget을 보내지 않는다');

  // 대체 모델이 없으면 같은 모델로만 다시 묻는다
  const c = scripted([{ status: 503 }, OK]);
  assert.equal((await post(service({ fetch: c.fetch }).ai, body())).status, 200);
  assert.deepEqual(c.gemini().map(modelOf), ['gemini-2.5-flash', 'gemini-2.5-flash']);

  assert.ok(usesThinkingBudget('gemini-2.5-flash') && usesThinkingBudget('gemini-2.5-flash-lite'));
  assert.ok(!usesThinkingBudget('gemini-3-flash') && !usesThinkingBudget('gemini-2.5-pro') && !usesThinkingBudget('my-flash'));
});

test('캐시: 확인된 곳이 3곳 미만이면 캐시하지 않는다. limit에 모자라면 아이디어별 다음 검색 결과로 채운다', async () => {
  const thinIdeas = [IDEAS[0], IDEAS[1], IDEAS[2], IDEAS[5]];
  const thin = upstream(() => ({ body: geminiBody(thinIdeas) }));
  const { ai } = service({ fetch: thin.fetch });
  const r = await post(ai, body());
  assert.equal(r.status, 200);
  assert.equal((r.body as Items).items.length, 2);
  const again = await post(ai, body());
  assert.equal(again.headers['X-Cache'], 'miss');
  assert.equal(thin.gemini().length, 2, '적은 결과는 다시 묻는다');

  const two = upstream(() => ({ body: geminiBody([IDEAS[1], IDEAS[4]]) }));
  const s = service({ fetch: two.fetch });
  const r2 = await post(s.ai, body({ existing: [], candidates: [], limit: 3 }));
  assert.deepEqual(
    (r2.body as Items).items.map((i) => i.place.placeId),
    ['kakao:2', 'kakao:6', 'kakao:3'],
    '대릉원 둘째 결과로 채운다',
  );
});

test('IP: ::ffff: 접두사를 떼고, TRUST_PROXY일 때만 X-Forwarded-For 첫 주소로 센다', async () => {
  assert.equal(clientIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(clientIp('10.0.0.9', '1.2.3.4, 10.0.0.9'), '10.0.0.9');
  assert.equal(clientIp('10.0.0.9', '1.2.3.4, 10.0.0.9', true), '1.2.3.4');
  assert.equal(clientIp('10.0.0.9', ['::ffff:5.6.7.8'], true), '5.6.7.8');
  assert.equal(clientIp('10.0.0.9', '', true), '10.0.0.9');

  const mapped = service({ ratePerMin: 1 });
  assert.equal((await mapped.ai.handle({ method: 'POST', path: 'recommend', body: body(), ip: '::ffff:10.0.0.1' })).status, 200);
  assert.equal((await mapped.ai.handle({ method: 'POST', path: 'recommend', body: body({ tags: ['자연'] }), ip: '10.0.0.1' })).status, 429);

  const plain = service({ ratePerMin: 1 });
  const h = (b: unknown, xff: string) => plain.ai.handle({ method: 'POST', path: 'recommend', body: b, ip: '10.9.9.9', forwardedFor: xff });
  assert.equal((await h(body(), '1.1.1.1')).status, 200);
  assert.equal((await h(body({ tags: ['자연'] }), '2.2.2.2')).status, 429, '기본은 헤더를 믿지 않는다');

  const trusted = service({ ratePerMin: 1, trustProxy: true });
  const t = (b: unknown, xff: string) => trusted.ai.handle({ method: 'POST', path: 'recommend', body: b, ip: '10.9.9.9', forwardedFor: xff });
  assert.equal((await t(body(), '1.1.1.1')).status, 200);
  assert.equal((await t(body({ tags: ['자연'] }), '2.2.2.2')).status, 200);
  assert.equal((await t(body({ tags: ['쇼핑'] }), '1.1.1.1, 10.9.9.9')).status, 429);
});

test('이유: 주소·전화번호 꼴·꺾쇠가 있으면 중립 문장', async () => {
  assert.equal(safeReason('역사 태그와 잘 맞아요'), '역사 태그와 잘 맞아요');
  for (const bad of ['자세히는 https://evil.example 에서 봐요', 'www.x.kr 참고해요', '예약 010-1234-5678로 해요', '<b>여기</b>요', '전화 0541234567']) {
    assert.equal(safeReason(bad), NEUTRAL_REASON, bad);
  }
  const inj = upstream(() => ({ body: geminiBody(IDEAS.map((i) => ({ ...i, reason: '이 링크 http://x.io 를 눌러요' }))) }));
  const { ai } = service({ fetch: inj.fetch });
  const out = (await post(ai, body())).body as Items;
  assert.ok(out.items.length > 0 && out.items.every((i) => i.reason === NEUTRAL_REASON));
});
