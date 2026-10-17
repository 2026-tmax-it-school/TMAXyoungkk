import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildSummaryRequest, localSummary, parseSummary, SUMMARY_MESSAGES_MAX, SUMMARY_TEXT_MAX } from '../src/core/chatSummary';
import { createSummaryProvider } from '../src/services/summary';
import type { Trip } from '../src/types';
import { fakeFetch } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * AI 대화 요약(2026-10-17): 요청 만들기(최근 80줄·200자·닉네임), 규칙 요약, 응답 읽기, AI 실패 때 규칙 요약 + aiUnavailable,
 * 서버 주소가 없으면 규칙 요약, 화면 규칙(동의 확인 뒤 요청, 늦은 응답 버림). 서버 규칙은 wp2-ai-recommend.test.ts가 맡는다.
 */

const read = (p: string) => readFileSync(p, 'utf8');
const tripWith = (n: number): Trip => {
  const t = scenarioTrip();
  const me = t.members[0].id;
  t.messages = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, memberId: me, text: `${i}번째 말 `.padEnd(300, '가'), sentAt: i, status: 'sent' as const }));
  return t;
};

test('요청: 최근 80줄, 글당 200자, 보낸 사람은 닉네임, 후보는 이름·분류만', () => {
  const t = tripWith(100);
  const r = buildSummaryRequest(t);
  assert.equal(r.messages.length, SUMMARY_MESSAGES_MAX);
  assert.ok(r.messages.every((m) => m.text.length <= SUMMARY_TEXT_MAX));
  assert.ok(r.messages[SUMMARY_MESSAGES_MAX - 1].text.startsWith('99번째'));
  assert.equal(r.messages[0].who, t.members[0].nickname);
  assert.ok(r.spots.every((s) => Object.keys(s).sort().join() === 'category,name'));
  assert.equal(r.title, t.title);
});

test('규칙 요약: 줄 수·말한 사람·후보를 센다', () => {
  const s = localSummary({ title: '경주', start: '2026-10-23', end: '2026-10-24', messages: [{ who: '민지', text: 'a' }, { who: '준호', text: 'b' }], spots: [{ name: '불국사', category: '관광지' }] });
  assert.equal(s.source, 'local');
  assert.match(s.overview, /2줄/);
  assert.match(s.overview, /민지·준호/);
  assert.deepEqual(s.decided, ['불국사을(를) 후보로 담았어요']);
  const empty = localSummary({ title: '경주', start: '2026-10-23', end: '2026-10-23', messages: [], spots: [] });
  assert.match(empty.open[0], /장소를 채팅에 적어/);
});

test('응답 읽기: 요약 글이 없으면 null, 줄은 글자만 8개까지', () => {
  assert.equal(parseSummary(null), null);
  assert.equal(parseSummary({ overview: '  ' }), null);
  const s = parseSummary({ overview: ' 요약 ', decided: ['a', 1, ''], open: Array.from({ length: 12 }, (_, i) => `o${i}`) })!;
  assert.equal(s.overview, '요약');
  assert.deepEqual(s.decided, ['a']);
  assert.equal(s.open.length, 8);
  assert.equal(s.source, 'ai');
});

test('제공자: AI 서버가 있으면 /summary로 요청, 실패하면 규칙 요약 + aiUnavailable, 주소가 없으면 규칙 요약', async () => {
  const req = buildSummaryRequest(tripWith(5));
  const ok = fakeFetch(() => ({ body: { overview: 'AI 요약이에요', decided: ['정해진 것'], open: [] } }));
  const ai = createSummaryProvider({ aiProxyUrl: 'http://x/ai', fetch: ok });
  assert.equal(ai.id, 'ai');
  const s = await ai.summarize(req);
  assert.equal(s.source, 'ai');
  assert.equal(ok.calls[0].url, 'http://x/ai/summary');
  const sent = JSON.parse(ok.calls[0].init?.body ?? '{}');
  assert.deepEqual(Object.keys(sent).sort(), ['end', 'messages', 'region', 'spots', 'start', 'title']);
  const down = createSummaryProvider({ aiProxyUrl: 'http://x/ai', fetch: fakeFetch(() => ({ status: 503, body: {} })) });
  const f = await down.summarize(req);
  assert.equal(f.source, 'local');
  assert.equal(f.aiUnavailable, true);
  const bad = createSummaryProvider({ aiProxyUrl: 'http://x/ai', fetch: fakeFetch(() => ({ body: { nope: 1 } })) });
  assert.equal((await bad.summarize(req)).aiUnavailable, true);
  const none = createSummaryProvider({ fetch: fakeFetch() });
  assert.equal(none.id, 'local');
  assert.equal((await none.summarize(req)).source, 'local');
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(ai.summarize({ ...req, signal: ac.signal }));
});

test('화면: 채팅 설정과 입력 줄에서 열고, 처음 한 번 동의, 늦은 응답은 버린다', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /label="AI 대화 요약"/);
  assert.match(chat, /title="AI 요약"/);
  assert.match(chat, /title="대화를 AI로 요약할까요"/);
  assert.match(chat, /getServices\(\)\.summary\.id === 'ai' && !summaryConsented/);
  assert.match(chat, /sumTicket\.current/);
  assert.match(chat, /title="AI 대화 요약"/);
});
