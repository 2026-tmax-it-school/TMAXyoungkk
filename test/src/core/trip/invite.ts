import type { Invite, Op, Trip } from '../../types';
import { INVITE_CODE_BYTES, INVITE_TTL_MS, INVITE_URL_PREFIX, MEMBER_CAPACITY } from '../constants';
import { activeMembers } from '../group';
import type { Rng } from '../ports';
import { base32 } from '../util';

/**
 * 초대 코드(FR-301, WP2 소유). 주입 난수 5바이트(40비트)를 Crockford base32 8자 'XXXX-XXXX'로 만든다.
 * 7일 유효, 정원 6명(방장 포함 활성 멤버 수 기준). 재발급하면 이전 코드는 무효(revoked)다.
 * 이전 코드는 문서에 남지 않으므로 로그의 trip/issueInvite를 훑어 revoked로 판정한다(lookup.ts).
 * 이 파일은 ops를 import하지 않는다(members 리듀서가 여기를 쓰므로 순환을 피한다).
 */
export function makeInviteCode(rng: Rng): string {
  const s = base32(rng.bytes(INVITE_CODE_BYTES));
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

/** 새 초대. issueInvite op의 본문이다. */
export function newInvite(rng: Rng, now: number): Invite {
  return { code: makeInviteCode(rng), issuedAt: now, expiresAt: now + INVITE_TTL_MS, capacity: MEMBER_CAPACITY };
}

/**
 * 사람이 입력한 코드를 정규화한다. 대문자, 공백·하이픈·링크 앞부분 제거, Crockford 규칙으로 헷갈리는 글자 보정
 * (I·L → 1, O → 0). 8자가 아니면 빈 문자열이다.
 */
export function normalizeInviteCode(input: string): string {
  let s = input.trim();
  const slash = s.lastIndexOf('/j/');
  if (slash >= 0) s = s.slice(slash + 3);
  s = s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (s.length !== 8) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

/**
 * 초대 링크 '{주소}/j/XXXX-XXXX'. base는 앱이 실제로 열리는 주소다(config INVITE_BASE_URL: 설정값 → 웹이면 지금 앱 주소).
 * 없으면 'https://youngtrip.app/j/…'(아직 운영하지 않는 예약 도메인이라 브라우저에서는 열리지 않는다)
 */
export function inviteUrl(code: string, base?: string): string {
  const b = base?.trim().replace(/\/+$/, '');
  return b ? `${b}/j/${code}` : `${INVITE_URL_PREFIX}${code}`;
}

/** 화면 표시용 'youngtrip.app/j/XXXX-XXXX', 'localhost:8090/j/XXXX-XXXX' */
export function inviteUrlShort(code: string, base?: string): string {
  return inviteUrl(code, base).replace(/^https?:\/\//, '');
}

/**
 * 초대 링크 주소 고르기. 설정값(EXPO_PUBLIC_INVITE_BASE_URL)이 http(s) 주소면 그것, 아니면 웹의 지금 앱 주소(origin),
 * 둘 다 없으면 undefined(예약 도메인). 끝 '/'와 경로는 뗀다
 */
export function pickInviteBase(configured: string | undefined, webOrigin: string | undefined): string | undefined {
  for (const raw of [configured, webOrigin]) {
    const v = (raw ?? '').trim();
    const m = v.match(/^(https?:\/\/[^\s/?#]+)/);
    if (m) return m[1];
  }
  return undefined;
}

export type InviteStatus = 'ok' | 'expired' | 'revoked' | 'full' | 'notFound';

/** 초대 판정. 무효 → 만료 → 정원 순서로 본다. 정원은 방장 포함 활성 멤버 수가 capacity에 닿으면 초과다. */
export function inviteStatus(trip: Trip, code: string, now: number): InviteStatus {
  if (trip.deletedAt != null) return 'notFound';
  const inv = trip.invite;
  if (!inv || inv.code !== code) return 'notFound';
  if (inv.revokedAt != null && inv.revokedAt <= now) return 'revoked';
  if (now >= inv.expiresAt) return 'expired';
  if (activeMembers(trip).length >= inv.capacity) return 'full';
  return 'ok';
}

/** 남은 자리. 초대가 없으면 0 */
export function seatsLeft(trip: Trip): number {
  if (!trip.invite) return 0;
  return Math.max(0, trip.invite.capacity - activeMembers(trip).length);
}

/** 이 로그 안에서 한 번이라도 발급된 코드인지 */
export function wasIssued(ops: readonly Op[], code: string): boolean {
  return ops.some((o) => o.type === 'trip/issueInvite' && o.invite.code === code);
}

/** 합류 실패 사유를 화면 문구로 */
export const INVITE_ERROR_TEXT: Record<Exclude<InviteStatus, 'ok'>, string> = {
  notFound: '초대 코드를 찾을 수 없습니다. 코드를 다시 확인해 주세요.',
  expired: '초대 링크가 만료되었습니다(7일). 방장에게 새 링크를 받아 주세요.',
  revoked: '새 링크가 만들어져 이 링크는 더 이상 쓸 수 없습니다. 방장에게 새 링크를 받아 주세요.',
  full: '정원이 찼습니다(6명). 방장이 멤버를 정리하면 다시 합류할 수 있습니다.',
};
