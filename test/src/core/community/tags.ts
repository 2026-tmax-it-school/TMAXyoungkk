/**
 * 커뮤니티 태그 규칙(WP6 소유, 2026-10-11). 서버(server/community.mjs normalizeTag·parseTags)와 같은 규칙·같은 값이다.
 * 순수 함수만 둔다.
 *
 * 맞추기: 앞뒤 공백과 앞의 '#'(여러 개)를 떼고, 가운데 띄어쓰기는 붙이고('제주 맛집' → '제주맛집'), NFC로 맞추고,
 * 영문은 소문자로 바꾼다. 남은 글자가 한글·영문(글자)·숫자·_뿐이고 1~12자면 그 값, 아니면 null.
 * 글당 5개까지, 같은 태그는 하나로 합치고 넣은 순서를 둔다. 화면에는 앞에 '#'을 붙여 보인다.
 */

export const TAGS_MAX = 5;
export const TAG_LEN_MAX = 12;

/** 글쓰기 화면의 기본 추천 태그 */
export const BASIC_TAGS: readonly string[] = ['여행일기', '맛집', '카페', '풍경', '숙소'];

/** 최근에 쓴 태그를 몇 개까지 기억하는지 */
export const RECENT_TAGS_MAX = 8;

export const TAG_RULE_TEXT = `태그는 한글·영문·숫자·_로 ${TAG_LEN_MAX}자까지예요`;
export const TAG_FULL_TEXT = `태그는 ${TAGS_MAX}개까지예요`;

const TAG_CHARS = /^[\p{L}\p{Nd}_]+$/u;

/** 태그 하나를 맞춘다. 규칙에 맞지 않으면 null */
export function normalizeTag(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.normalize('NFC').trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
  if (t.length === 0 || [...t].length > TAG_LEN_MAX || !TAG_CHARS.test(t)) return null;
  return t;
}

/** 여러 값을 맞춰 겹치지 않게 모은다. 틀린 값은 버리고 max개에서 멈춘다(최근 태그·추천처럼 알아서 고르는 목록용) */
export function cleanTags(raw: readonly string[], max = TAGS_MAX): string[] {
  const out: string[] = [];
  for (const r of raw) {
    if (out.length >= max) break;
    const t = normalizeTag(r);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 태그 하나를 더한다. 이미 있으면 그대로(문제 아님), 틀리거나 다 찼으면 problem */
export function addTag(tags: readonly string[], raw: string): { tags: string[]; problem?: string } {
  if (raw.trim().replace(/^#+/, '').trim() === '') return { tags: [...tags] };
  const t = normalizeTag(raw);
  if (!t) return { tags: [...tags], problem: TAG_RULE_TEXT };
  if (tags.includes(t)) return { tags: [...tags] };
  if (tags.length >= TAGS_MAX) return { tags: [...tags], problem: TAG_FULL_TEXT };
  return { tags: [...tags, t] };
}

/**
 * 태그 입력 칸의 글자 → 다 친 태그(done)와 아직 치는 중인 글자(rest).
 * 띄어쓰기·쉼표·줄바꿈, 그리고 맨 앞이 아닌 '#'이 태그를 끝낸다('#맛집#카페' 붙여 넣기도 둘로 나뉜다).
 */
export function splitTagInput(text: string): { done: string[]; rest: string } {
  const unified = text.replace(/(?!^)#/g, ' ');
  const parts = unified.split(/[\s,，、]+/);
  const rest = parts.pop() ?? '';
  return { done: parts.filter((p) => p.replace(/^#+/, '').length > 0), rest };
}

/** 입력 칸에 남은 글자까지 붙인 태그(올리기·임시 저장 직전). 틀린 글자는 붙이지 않는다 */
export function withPendingTag(tags: readonly string[], pending: string): string[] {
  return addTag(tags, pending).tags;
}

/** 불러온 글에서 많이 쓴 태그(같으면 먼저 나온 순). 피드 위 태그 줄에 쓴다 */
export function popularTags(posts: readonly { tags: readonly string[] }[], limit = 8): string[] {
  const count = new Map<string, number>();
  for (const p of posts) for (const t of p.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

/**
 * 글쓰기 화면 추천 태그. 여행 지역(일기에서 열었을 때) → 최근에 쓴 태그 → 기본 태그 순으로, 이미 단 태그는 빼고 limit개.
 */
export function tagSuggestions(opts: { current: readonly string[]; region?: string | null; recent?: readonly string[]; limit?: number }): string[] {
  const pool = cleanTags([...(opts.region ? [opts.region] : []), ...(opts.recent ?? []), ...BASIC_TAGS], Number.MAX_SAFE_INTEGER);
  return pool.filter((t) => !opts.current.includes(t)).slice(0, opts.limit ?? 8);
}

/** 올린 태그를 최근 목록 앞에 둔다(겹치면 앞으로 옮긴다) */
export function rememberTags(recent: readonly string[], used: readonly string[], max = RECENT_TAGS_MAX): string[] {
  return cleanTags([...used, ...recent], max);
}
