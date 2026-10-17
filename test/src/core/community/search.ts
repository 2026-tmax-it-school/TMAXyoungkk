/**
 * 커뮤니티 검색 규칙(WP6 소유, 2026-10-17). 제목과 태그만 본다. 서버(server/community.mjs normalizeSearch·matchesSearch)와
 * 같은 규칙·같은 값이다(테스트가 확인한다). 이 기기 모의 커뮤니티가 같은 함수로 거른다.
 */

export const SEARCH_MAX = 30;

/** 검색어 맞추기: 앞뒤 공백을 떼고 안쪽 공백은 하나로 모은다. 너무 길면 자른다. 비면 빈 문자열 */
export function normalizeSearch(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX).trim();
}

/** 태그 쪽 비교 값: '#' 앞을 떼고 공백을 없애고 영문은 소문자. 비면 null(제목만 본다) */
export function searchTagPart(q: string): string | null {
  const t = q.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
  return t.length > 0 ? t : null;
}

/** 글이 검색어에 맞는지: 제목에 들어 있거나(대소문자 무시) 태그 중 하나에 들어 있다 */
export function matchesSearch(post: { title: string; tags: readonly string[] }, q: string): boolean {
  if (post.title.toLowerCase().includes(q.toLowerCase())) return true;
  const t = searchTagPart(q);
  return t != null && post.tags.some((x) => x.includes(t));
}
