import type { Member, OpDraft, Trip } from '../types';
import {
  DEVICE_ATTEMPT_LIMIT,
  DEVICE_ATTEMPT_WINDOW_MS,
  LOGIN_LOCK_MS,
  LOGIN_MAX_FAILS,
  NICKNAME_MAX,
  PASSWORD_MIN_LENGTH,
  PROFILE_IMAGE_MAX_BYTES,
} from './constants';

/**
 * 계정 순수 판정(FR-101~104, 계정 탈퇴, WP1 소유). 모의 인증(services/auth/local)과 화면이 같이 쓴다.
 * 시각은 인자로 받는다.
 */

/* ---------- FR-101 가입 입력 ---------- */

/** 비교용 이메일. 앞뒤 공백을 빼고 소문자로 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailLike(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** FR-101 비밀번호 규칙: 8자 이상, 영문과 숫자 포함. 위반 항목을 돌려준다. */
export function passwordViolations(password: string): string[] {
  const out: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) out.push(`${PASSWORD_MIN_LENGTH}자 이상`);
  if (!/[A-Za-z]/.test(password)) out.push('영문 포함');
  if (!/[0-9]/.test(password)) out.push('숫자 포함');
  return out;
}

/** 닉네임 입력 문제. 없으면 null */
export function nicknameProblem(nickname: string): string | null {
  const n = nickname.trim();
  if (n.length === 0) return '닉네임을 입력해 주세요';
  if (n.length > NICKNAME_MAX) return `닉네임은 ${NICKNAME_MAX}자까지입니다`;
  return null;
}

/** 닉네임 중복 비교는 공백을 빼고 대소문자를 무시한다. */
export function sameNickname(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/* ---------- FR-102 로그인 시도 제한 ---------- */

/** 계정 기준 연속 실패 상태 */
export interface LockState {
  fails: number;
  lockedUntil?: number;
}

export function isLocked(s: LockState, now: number): boolean {
  return s.lockedUntil != null && now < s.lockedUntil;
}

/** 잠금이 풀렸으면 실패 횟수를 0으로 되돌린다. */
export function settleLock(s: LockState, now: number): LockState {
  if (s.lockedUntil != null && now >= s.lockedUntil) return { fails: 0 };
  return s;
}

/** 비밀번호가 틀렸을 때. 5회째에 10분 잠근다. */
export function registerFailure(s: LockState, now: number): LockState {
  const cur = settleLock(s, now);
  const fails = cur.fails + 1;
  if (fails >= LOGIN_MAX_FAILS) return { fails: 0, lockedUntil: now + LOGIN_LOCK_MS };
  return { fails };
}

/**
 * 기기 토큰 기준 시도 제한(10분 20회). 서버가 없어 IP 대신 기기 토큰으로 센다(프로토타입 가정).
 * 창 안의 시도 시각만 남긴다.
 */
export function pruneAttempts(attempts: number[], now: number): number[] {
  return attempts.filter((t) => now - t < DEVICE_ATTEMPT_WINDOW_MS);
}

/** 이번 시도를 받아도 되는지. 막히면 풀리는 시각을 준다. */
export function deviceAttemptCheck(attempts: number[], now: number): { ok: true } | { ok: false; retryAt: number } {
  const inWindow = pruneAttempts(attempts, now);
  if (inWindow.length < DEVICE_ATTEMPT_LIMIT) return { ok: true };
  return { ok: false, retryAt: Math.min(...inWindow) + DEVICE_ATTEMPT_WINDOW_MS };
}

/* ---------- FR-104 프로필 이미지 ---------- */

/** 5MB를 넘으면 압축 대상이다. */
export function needsImageCompression(bytes: number): boolean {
  return bytes > PROFILE_IMAGE_MAX_BYTES;
}

/**
 * 압축 뒤 예상 크기. 모의 압축은 한도의 90% 안으로 줄인다고 가정한다(실제 압축은 네이티브 image-picker quality).
 * 한도 이하면 그대로다.
 */
export function compressedImageBytes(bytes: number): number {
  if (!needsImageCompression(bytes)) return bytes;
  const target = Math.floor(PROFILE_IMAGE_MAX_BYTES * 0.9);
  // 원본이 클수록 더 많이 줄인다. 품질 0.7 기준 대략 1/3로 줄고 한도 90%를 넘지 않는다.
  return Math.min(target, Math.round(bytes * 0.34));
}

/** '5.2MB', '812KB' */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/* ---------- 게스트 승격·계정 탈퇴 ---------- */

/** 이 사람(userId)의 멤버 기록. 나간 방도 포함한다. */
export function ownMembers(trip: Trip, userId: string): Member[] {
  return trip.members.filter((m) => m.userId === userId);
}

/**
 * 승격 때 보낼 op. 활성 멤버로 참여 중인 방마다 member/accountLinked 하나.
 * userId는 그대로 두므로(승격은 userId 유지) 데이터는 옮기지 않는다. 이관 범위는 미결정이다.
 */
export function planAccountLink(
  trips: Trip[],
  userId: string,
): { tripId: string; actorId: string; drafts: OpDraft[] }[] {
  const out: { tripId: string; actorId: string; drafts: OpDraft[] }[] = [];
  for (const t of trips) {
    if (t.deletedAt != null) continue;
    const me = ownMembers(t, userId).find((m) => m.leftAt == null);
    if (!me || !me.isGuest) continue;
    out.push({ tripId: t.id, actorId: me.id, drafts: [{ type: 'member/accountLinked', userId }] });
  }
  return out;
}

/**
 * 계정 탈퇴 초안(비기능 데이터 보존). 참여한(나간 방 포함) 방마다
 * 본인이 올린 사진의 journal/photoRemoved와 본인 멤버의 member/anonymize를 만든다.
 * 채팅과 제안 이력은 memberId를 유지한 채 남는다(익명 처리는 멤버 표시 이름으로).
 * 한 방에 본인 멤버 기록이 여럿이면(나갔다 다시 합류) 멤버마다 따로 묶는다. anonymize는 본인만 보낼 수 있어서다.
 * actorId는 그 묶음을 보낼 멤버다. 스토어는 actingAs를 따르지 않고 이 값으로 보낸다(계약 A11).
 */
export function planAccountDeletion(
  trips: Trip[],
  userId: string,
): { tripId: string; actorId: string; drafts: OpDraft[] }[] {
  const out: { tripId: string; actorId: string; drafts: OpDraft[] }[] = [];
  for (const t of trips) {
    if (t.deletedAt != null) continue;
    for (const me of ownMembers(t, userId)) {
      const drafts: OpDraft[] = [];
      for (const p of t.photos) {
        if (p.memberId === me.id) drafts.push({ type: 'journal/photoRemoved', photoId: p.id });
      }
      if (!me.anonymized) drafts.push({ type: 'member/anonymize', memberId: me.id });
      if (drafts.length > 0) out.push({ tripId: t.id, actorId: me.id, drafts });
    }
  }
  return out;
}
