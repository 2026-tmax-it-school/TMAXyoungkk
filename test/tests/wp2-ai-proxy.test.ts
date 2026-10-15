import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAiHandlers, DEFAULT_GEMINI_MODEL, startAiProxy } from '../server/ai-proxy.mjs';
import { createExtractionProvider } from '../src/services/extraction';
import { regionById } from '../src/data/regions';

/**
 * AI 프록시(Gemini). 키는 서버에만 있고 응답·오류에 나오지 않는다. 실제 네트워크 없이 가짜 fetch로 본다.
 */

const KEY = 'AIzaTEST-SECRET-KEY';

type Call = { url: string; init?: { headers?: Record<string, string>; body?: string } };

function fakeUpstream(answer: (url: string) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: Call['init']) => {
    calls.push({ url, init });
    const a = answer(url);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const gem = (obj: unknown) => ({ body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });

test('추출: 키는 헤더로만 보내고, 원문에 없는 표현은 버린다', async () => {
  const up = fakeUpstream(() => gem({ phrases: [{ phrase: '황리단길' }, { phrase: '없는곳' }, '대릉원'] }));
  const h = createAiHandlers({ apiKey: KEY, fetch: up.f });
  const out = await h.extract({ text: '내일 황리단길 갔다가 대릉원 가자', region: { id: 'gyeongju', name: '경주' } });
  assert.deepEqual(out, { phrases: [{ phrase: '황리단길' }, { phrase: '대릉원' }] });
  const c = up.calls[0];
  assert.ok(c.url.endsWith(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`));
  assert.ok(!c.url.includes(KEY), '키를 주소에 싣지 않는다');
  assert.equal(c.init?.headers?.['x-goog-api-key'], KEY);
});

test('추천: 카카오 키가 없으면 빈 목록(앱이 로컬로 대체), 있으면 카카오 좌표로 맞춘다', async () => {
  const none = createAiHandlers({ apiKey: KEY, fetch: fakeUpstream(() => gem({})).f });
  assert.deepEqual(await none.recommend({ region: { name: '경주' }, limit: 5 }), { items: [], fallback: false });

  let n = 0;
  const up = fakeUpstream((url) =>
    url.includes('generativelanguage')
      ? gem({ items: [{ name: '대릉원', reason: '고분 산책' }, { name: '황리단길', reason: '골목 구경' }, { name: '기존', reason: 'x' }] })
      : { body: { documents: [{ id: n === 2 ? 'old' : String(++n), place_name: `장소${n}`, category_group_code: 'AT4', x: '129.2', y: '35.8' }] } },
  );
  const h = createAiHandlers({ apiKey: KEY, kakaoKey: 'KK', fetch: up.f });
  const out = await h.recommend({ region: { name: '경주' }, tags: ['역사'], existing: ['kakao:old'], limit: 5 });
  assert.deepEqual(out.items.map((i) => [i.place, i.reason]), [
    [{ placeId: 'kakao:1', name: '장소1', coord: { latitude: 35.8, longitude: 129.2 }, category: '관광지' }, '고분 산책'],
    [{ placeId: 'kakao:2', name: '장소2', coord: { latitude: 35.8, longitude: 129.2 }, category: '관광지' }, '골목 구경'],
  ]);
});

test('일기: 블록 수와 문장 수가 다르면 실패한다', async () => {
  const blocks = [{ time: '10:00', placeName: '대릉원', photoCount: 2, memberNames: [] }];
  const ok = createAiHandlers({ apiKey: KEY, fetch: fakeUpstream(() => gem({ texts: [' 고분 사이를 걸었다. '] })).f });
  assert.deepEqual(await ok.diary({ date: '2026-10-20', blocks }), { texts: ['고분 사이를 걸었다.'] });
  const bad = createAiHandlers({ apiKey: KEY, fetch: fakeUpstream(() => gem({ texts: ['a', 'b'] })).f });
  await assert.rejects(bad.diary({ date: '2026-10-20', blocks }));
});

test('서버: 앱 클라이언트와 붙고, 실패해도 키를 내보내지 않으며, 허용하지 않은 경로는 404다', async () => {
  const up = fakeUpstream(() => gem({ phrases: [{ phrase: '첨성대' }] }));
  const proxy = await startAiProxy({ apiKey: KEY, fetch: up.f });
  try {
    const app = createExtractionProvider({ aiProxyUrl: proxy.url, fetch: (u, i) => fetch(u, i) });
    const got = await app.phrases('첨성대 야경 보자', { region: regionById('gyeongju')! });
    assert.deepEqual(got.map((p) => p.phrase), ['첨성대']);

    assert.equal((await fetch(`${proxy.url}/models`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(`${proxy.url}/extract`)).status, 404);
  } finally {
    await proxy.close();
  }

  const failing = await startAiProxy({ apiKey: KEY, fetch: fakeUpstream(() => ({ status: 403, body: { error: KEY } })).f });
  try {
    const r = await fetch(`${failing.url}/extract`, { method: 'POST', body: JSON.stringify({ text: '첨성대' }) });
    assert.equal(r.status, 502);
    assert.ok(!(await r.text()).includes(KEY));
  } finally {
    await failing.close();
  }
});
