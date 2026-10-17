import type { ChatSummary, ChatSummaryRequest } from '../ports';
import type { Trip } from '../../types';

/**
 * AI 대화 요약 규칙(WP3 소유, 2026-10-17, 순수). 서버(server/ai.mjs parseSummaryBody)와 한도가 같다.
 * - 요청 만들기: 여행방의 채팅(보낸 사람 닉네임·글)과 담은 후보(이름·분류)만 보낸다. 최근 80개, 글당 200자까지.
 * - 규칙 요약(localSummary): AI를 쓸 수 없을 때 대신하는 간단한 정리. 대화 줄 수·말한 사람·후보·빠진 것을 센다.
 */

export const SUMMARY_MESSAGES_MAX = 80;
export const SUMMARY_TEXT_MAX = 200;
/** 요약을 만들 최소 대화 수 */
export const SUMMARY_MIN_MESSAGES = 2;

export function buildSummaryRequest(trip: Trip): ChatSummaryRequest {
  const messages = trip.messages
    .filter((m) => m.text.trim() !== '')
    .slice(-SUMMARY_MESSAGES_MAX)
    .map((m) => ({ who: trip.members.find((x) => x.id === m.memberId)?.nickname ?? '여행자', text: m.text.trim().slice(0, SUMMARY_TEXT_MAX) }));
  const spots = trip.spots.filter((s) => !s.removedByUser).slice(0, 40).map((s) => ({ name: s.name, category: s.category }));
  return { title: trip.title, region: trip.region, start: trip.startDate, end: trip.endDate, messages, spots };
}

/** AI를 쓸 수 없을 때의 간단한 정리 */
export function localSummary(req: Pick<ChatSummaryRequest, 'title' | 'start' | 'end' | 'messages' | 'spots'>): ChatSummary {
  const who = [...new Set(req.messages.map((m) => m.who))];
  const names = req.spots.map((s) => s.name);
  const overview =
    `${req.title}(${req.start === req.end ? req.start : `${req.start} ~ ${req.end}`}) 대화가 ${req.messages.length}줄 있었어요.` +
    (who.length > 0 ? ` ${who.slice(0, 3).join('·')}${who.length > 3 ? ` 외 ${who.length - 3}명` : ''}이 이야기했고,` : '') +
    (names.length > 0 ? ` 후보 ${names.length}곳이 모였어요.` : ' 아직 후보로 담긴 곳은 없어요.');
  const decided = names.slice(0, 6).map((n) => `${n}을(를) 후보로 담았어요`);
  const open: string[] = [];
  if (names.length === 0) open.push('가고 싶은 장소를 채팅에 적어 후보로 담아 보세요');
  else open.push('후보 중 가고 싶은 곳을 골라 날짜별로 정해 보세요');
  return { overview, decided, open, source: 'local' };
}

/** 서버 응답 → 요약. 모양이 틀리면 null */
export function parseSummary(v: unknown): ChatSummary | null {
  const o = v as { overview?: unknown; decided?: unknown; open?: unknown } | null;
  if (!o || typeof o.overview !== 'string' || o.overview.trim() === '') return null;
  const lines = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()).slice(0, 8) : []);
  return { overview: o.overview.trim(), decided: lines(o.decided), open: lines(o.open), source: 'ai' };
}
