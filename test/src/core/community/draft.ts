import type { CommunityPhotoInput } from '../ports';
import { BODY_MAX, PHOTOS_MAX, TITLE_MAX } from './limits';
import { cleanTags, TAGS_MAX } from './tags';

/**
 * 커뮤니티 글 임시 저장 규칙(WP6 소유, 2026-10-11). 순수 함수만 둔다(시각은 부르는 쪽이 넘긴다).
 * 저장소 어댑터는 services/community/drafts.ts(KV), 화면은 CommunityComposeScreen이다.
 *
 * - 임시 저장은 로그인한 사람(userId)마다 하나다. 글·제목·태그·어디서 열었는지(여행방·날짜)·저장 시각은 '글 기록'에,
 *   사진(base64)은 '사진 기록'에 따로 둔다. 웹 localStorage는 몇 MB라 사진 저장이 실패할 수 있는데, 그래도 글은 남게 하려고 나눴다.
 *   글 기록에는 사진 서명(photoSignature)을 두고, 사진 기록의 서명이 같을 때만 사진을 되살린다(다른 때 저장한 사진이 섞이지 않게).
 * - 나갈 때: 올린 뒤면 그냥 나간다. 쓴 것이 없으면(빈 글) 묻지 않고, 예전에 저장한 글이 있으면 지운다(보이는 그대로 남긴다).
 *   마지막으로 저장한 것과 같으면 그냥 나간다. 그 밖에는 '나가시겠습니까?'를 묻는다(저장하고 나가기 · 취소).
 * - 열 때: 저장한 글이 없으면 새 글(일기에서 열었으면 일기로 채운다). 있으면 이어 쓴다.
 *   일기에서 열었는데 저장한 글이 다른 곳(다른 날 일기, 그냥 연 글)에서 온 것이면 어느 쪽으로 쓸지 묻는다.
 */

export const DRAFT_VERSION = 1;

export interface DraftOrigin {
  tripId: string;
  date: string;
}

/** 화면에서 쓰는 글 내용(올리기·저장·비교의 단위) */
export interface ComposeContent {
  title: string;
  body: string;
  tags: string[];
  photos: CommunityPhotoInput[];
}

export interface SavedDraft extends ComposeContent {
  origin: DraftOrigin | null;
  /** 저장한 시각(ms) */
  updatedAt: number;
}

export const EMPTY_CONTENT: ComposeContent = Object.freeze({ title: '', body: '', tags: [], photos: [] }) as ComposeContent;

/** KV 키(사람마다). services/community/drafts.ts가 'young-trip/svc/app/' 접두사 KV에 쓴다 */
export function draftKeys(userId: string): { text: string; photos: string; recent: string } {
  return {
    text: `community/draft/${userId}`,
    photos: `community/draft-photos/${userId}`,
    recent: `community/recent-tags/${userId}`,
  };
}

/** 쓴 것이 하나도 없는지(공백만 있는 제목·본문은 빈 것) */
export function isEmptyContent(c: ComposeContent): boolean {
  return c.title.trim() === '' && c.body.trim() === '' && c.tags.length === 0 && c.photos.length === 0;
}

/** 사진 목록 서명. 같은 사진 목록이면 같은 값(전체 base64를 비교하지 않으려고 길이·앞뒤 일부만 본다) */
export function photoSignature(photos: readonly CommunityPhotoInput[]): string {
  return photos.map((p) => `${p.mime}:${p.data.length}:${p.data.slice(0, 16)}:${p.data.slice(-16)}`).join('|');
}

/** 글 내용 서명(비교용) */
export function contentSignature(c: ComposeContent): string {
  return JSON.stringify([c.title, c.body, c.tags, photoSignature(c.photos)]);
}

export function sameContent(a: ComposeContent, b: ComposeContent): boolean {
  return contentSignature(a) === contentSignature(b);
}

/** 저장하지 않은 바뀐 내용이 있는지. 빈 글은 바뀐 것으로 보지 않는다 */
export function isDirty(current: ComposeContent, saved: ComposeContent | null): boolean {
  if (isEmptyContent(current)) return false;
  return !sameContent(current, saved ?? EMPTY_CONTENT);
}

export type LeaveDecision = 'leave' | 'ask' | 'clear';

/**
 * 글쓰기 화면을 떠날 때 할 일. leave: 그냥 나간다, ask: '나가시겠습니까?'를 묻는다, clear: 묻지 않고 저장한 글을 지우고 나간다.
 */
export function leaveDecision(opts: { current: ComposeContent; saved: ComposeContent | null; published: boolean }): LeaveDecision {
  if (opts.published) return 'leave';
  if (isEmptyContent(opts.current)) return opts.saved && !isEmptyContent(opts.saved) ? 'clear' : 'leave';
  return isDirty(opts.current, opts.saved) ? 'ask' : 'leave';
}

export type OpenPlan = 'fresh' | 'diary' | 'restore' | 'ask';

const sameOrigin = (a: DraftOrigin | null, b: DraftOrigin | null) =>
  (a == null && b == null) || (a != null && b != null && a.tripId === b.tripId && a.date === b.date);

/**
 * 글쓰기 화면을 열 때. fresh: 빈 새 글, diary: 일기로 채운 새 글, restore: 저장한 글 이어 쓰기,
 * ask: 일기에서 열었는데 다른 곳에서 쓰던 글이 있어 어느 쪽으로 쓸지 묻는다.
 */
export function openPlan(opts: { saved: SavedDraft | null; origin: DraftOrigin | null }): OpenPlan {
  const saved = opts.saved && !isEmptyContent(opts.saved) ? opts.saved : null;
  if (!saved) return opts.origin ? 'diary' : 'fresh';
  if (!opts.origin || sameOrigin(saved.origin, opts.origin)) return 'restore';
  return 'ask';
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** 글 기록(사진 없이)을 JSON으로. photoSig는 함께 저장할 사진의 서명 */
export function textRecord(d: SavedDraft): string {
  return JSON.stringify({
    v: DRAFT_VERSION,
    title: d.title,
    body: d.body,
    tags: d.tags,
    origin: d.origin,
    updatedAt: d.updatedAt,
    photoSig: photoSignature(d.photos),
  });
}

export interface TextRecord extends Omit<SavedDraft, 'photos'> {
  photoSig: string;
}

/** 글 기록 읽기. 모양이 틀리거나 버전이 다르면 null(깨진 기록이 화면을 막지 않게) */
export function parseTextRecord(raw: string | null): TextRecord | null {
  if (!raw) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || v.v !== DRAFT_VERSION) return null;
  const o = v.origin as Record<string, unknown> | null | undefined;
  const origin = o && typeof o.tripId === 'string' && typeof o.date === 'string' ? { tripId: o.tripId, date: o.date } : null;
  return {
    title: str(v.title, TITLE_MAX),
    body: str(v.body, BODY_MAX),
    tags: Array.isArray(v.tags) ? cleanTags(v.tags.filter((t): t is string => typeof t === 'string'), TAGS_MAX) : [],
    origin,
    updatedAt: typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
    photoSig: typeof v.photoSig === 'string' ? v.photoSig : '',
  };
}

/** 사진 기록을 JSON으로 */
export function photoRecord(photos: readonly CommunityPhotoInput[]): string {
  return JSON.stringify({ v: DRAFT_VERSION, sig: photoSignature(photos), photos });
}

/** 사진 기록 읽기. 글 기록의 서명(expectedSig)과 같을 때만 사진을 돌려준다 */
export function parsePhotoRecord(raw: string | null, expectedSig: string): CommunityPhotoInput[] | null {
  if (!raw || !expectedSig) return null;
  try {
    const v = JSON.parse(raw) as { v?: unknown; sig?: unknown; photos?: unknown };
    if (v.v !== DRAFT_VERSION || v.sig !== expectedSig || !Array.isArray(v.photos)) return null;
    const photos = (v.photos as unknown[])
      .filter((p): p is CommunityPhotoInput => !!p && typeof (p as CommunityPhotoInput).mime === 'string' && typeof (p as CommunityPhotoInput).data === 'string')
      .slice(0, PHOTOS_MAX);
    return photoSignature(photos) === expectedSig ? photos : null;
  } catch {
    return null;
  }
}

/** 저장한 글 위 안내 문장 */
export function restoredText(timeAgoText: string): string {
  return `${timeAgoText} 저장한 글을 이어서 써요`;
}
