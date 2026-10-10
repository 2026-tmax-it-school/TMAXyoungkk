import type { CommunityDraft, CommunityKind } from '../ports';
import type { DiaryEntry } from '../../types';

/**
 * 커뮤니티 규칙(WP6 소유, 2026-10-10). 앱 사용자 전체가 보는 사진·일기 글. 서버(server/community.mjs)와 값이 같다.
 * 순수 함수만 둔다(시계는 호출하는 쪽이 넘긴다).
 */

export const COMMUNITY_KINDS: readonly CommunityKind[] = ['photo', 'diary'];
export const KIND_LABEL: Record<CommunityKind, string> = { photo: '사진', diary: '일기' };

export const TITLE_MAX = 60;
export const BODY_MAX = 4000;
export const PHOTOS_MAX = 4;
/** 한 장 상한(바이트). 앱은 줄여서 올리고 서버는 이 값을 넘으면 거절한다 */
export const PHOTO_BYTES_MAX = 1_500_000;

/** base64 글자 수 → 원래 바이트 수 */
export function base64Bytes(data: string): number {
  const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - pad;
}

export interface DraftCheck {
  ok: boolean;
  /** 화면에 보일 문장. 없으면 올릴 수 있다 */
  problem?: string;
}

/** 올리기 전 검사. 서버와 같은 규칙이라 서버가 거절할 글을 미리 막는다 */
export function checkDraft(d: CommunityDraft): DraftCheck {
  const title = d.title.trim();
  const body = d.body.trim();
  if (title.length > TITLE_MAX) return { ok: false, problem: `제목은 ${TITLE_MAX}자까지입니다` };
  if (body.length > BODY_MAX) return { ok: false, problem: `본문은 ${BODY_MAX}자까지입니다` };
  if (d.photos.length > PHOTOS_MAX) return { ok: false, problem: `사진은 ${PHOTOS_MAX}장까지입니다` };
  for (const p of d.photos) {
    if (base64Bytes(p.data) > PHOTO_BYTES_MAX) return { ok: false, problem: '사진 한 장이 너무 큽니다. 다른 사진을 골라 주세요' };
  }
  if (d.kind === 'photo' && d.photos.length === 0) return { ok: false, problem: '사진을 한 장 이상 골라 주세요' };
  if (d.kind === 'diary' && body.length === 0) return { ok: false, problem: '일기 내용을 입력해 주세요' };
  return { ok: true };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 올린 시각 → '방금'·'5분 전'·'3시간 전'·'2일 전'·'10월 3일' */
export function timeAgo(createdAt: number, now: number): string {
  const d = now - createdAt;
  if (d < MIN) return '방금';
  if (d < HOUR) return `${Math.floor(d / MIN)}분 전`;
  if (d < DAY) return `${Math.floor(d / HOUR)}시간 전`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}일 전`;
  const kst = new Date(createdAt + 9 * HOUR);
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

/** 일기 한 편 → 글 본문(블록 시간·장소·글을 줄로 잇는다). 비어 있으면 빈 문자열 */
export function diaryAsText(entry: Pick<DiaryEntry, 'blocks'>): string {
  return entry.blocks
    .map((b) => b.text.trim())
    .filter((t) => t.length > 0)
    .join('\n')
    .slice(0, BODY_MAX);
}

/** 화면의 사진 주소. 서버가 준 상대 주소('/community/…')에는 서버 주소를 붙이고, data: 주소는 그대로 쓴다 */
export function resolvePhotoUrl(base: string, url: string): string {
  if (/^(data:|https?:|blob:)/.test(url)) return url;
  return `${base.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** 서버 오류 코드 → 화면 문장 */
export function failText(code: string, detail?: string): string {
  if (detail) return detail;
  switch (code) {
    case 'loginRequired':
      return '로그인하면 글을 올릴 수 있어요';
    case 'tooMany':
      return '한 시간에 올릴 수 있는 글을 넘었어요. 잠시 뒤 다시 시도해 주세요';
    case 'tooLarge':
      return '사진이 너무 커서 올리지 못했어요. 사진 수를 줄여 주세요';
    case 'unreachable':
      return '서버에 닿지 못했어요. 잠시 뒤 다시 시도해 주세요';
    case 'notFound':
      return '글을 찾지 못했어요';
    default:
      return '글을 올리지 못했어요';
  }
}
