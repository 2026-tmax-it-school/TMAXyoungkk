import type { NotifyLogEntry, NotifyPrefs, Session } from '../types';
import {
  DEVICE_TOKEN_BYTES,
  SESSION_EXPIRY_NOTICE_MS,
  SESSION_TTL_MS,
  TOKEN_VISIBLE_TAIL,
} from './constants';
import { shouldNotify } from './notify';
import type { AccountPublic, KV, Rng } from './ports';
import { base64url, makeIdGen, maskToken } from './util';

/**
 * 게스트 세션과 계정 세션(FR-105, FR-102, WP1 소유). 순수 함수다. 난수·시각·저장소는 주입받는다.
 * - 게스트: 주입 Rng로 128비트 base64url 기기 토큰을 만든다. 30일 유효, 쓸 때마다 now + 30일.
 * - 계정: 같은 규칙(30일, 사용 시 갱신). 기기 토큰은 이 기기 것을 그대로 쓴다.
 * - 만료: now > expiresAt이면 폐기한다. 게스트는 복구할 수 없다(bootstrap notices로 안내).
 * 화면에는 토큰 끝 4자리만 보인다(tokenTail).
 */

export function newDeviceToken(rng: Rng): string {
  return base64url(rng.bytes(DEVICE_TOKEN_BYTES));
}

/**
 * 게스트 발급. deviceToken을 넘기면 이 기기 토큰을 그대로 쓴다(로그아웃·만료 뒤 새 게스트도 같은 기기).
 * 로그인 시도 제한과 화면의 끝 4자리가 같은 토큰을 보게 하려는 것이다. userId는 늘 새로 만든다.
 */
export function issueGuest(input: { nickname: string; rng: Rng; now: number; deviceToken?: string }): Session {
  return {
    userId: makeIdGen(input.rng).next('u'),
    deviceToken: input.deviceToken ?? newDeviceToken(input.rng),
    nickname: input.nickname,
    kind: 'guest',
    issuedAt: input.now,
    expiresAt: input.now + SESSION_TTL_MS,
  };
}

/**
 * 계정 로그인·승격 뒤의 세션. userId는 계정 것을 쓴다(승격이면 게스트 userId와 같다).
 * 기기 토큰은 이 기기 것을 유지하고, 없으면 새로 만든다.
 */
export function accountSession(input: {
  account: AccountPublic;
  deviceToken?: string;
  rng: Rng;
  now: number;
}): Session {
  return {
    userId: input.account.userId,
    deviceToken: input.deviceToken ?? newDeviceToken(input.rng),
    nickname: input.account.nickname,
    kind: 'account',
    accountId: input.account.accountId,
    email: input.account.email,
    issuedAt: input.now,
    expiresAt: input.now + SESSION_TTL_MS,
  };
}

export function isExpired(session: Session, now: number): boolean {
  return now > session.expiresAt;
}

/** 쓸 때마다 now + 30일로 늘린다. 이미 만료됐으면 늘리지 않는다. */
export function touch(session: Session, now: number): Session {
  if (isExpired(session, now)) return session;
  return { ...session, expiresAt: now + SESSION_TTL_MS };
}

export type TouchResult = { state: 'ok'; session: Session } | { state: 'expired'; expired: Session } | { state: 'none' };

/** 부팅·사용 때 한 번 부른다. 만료면 폐기(state expired)하고, 아니면 연장한 세션을 돌려준다. */
export function touchOrExpire(session: Session | undefined, now: number): TouchResult {
  if (!session) return { state: 'none' };
  if (isExpired(session, now)) return { state: 'expired', expired: session };
  return { state: 'ok', session: touch(session, now) };
}

/**
 * 앱을 쓰는 중 갱신 간격. 시각이 흐를 때마다(30초 틱, 시뮬레이터 가속) 저장하지 않도록
 * 마지막 갱신에서 앱 시각으로 1시간이 지났거나 이미 만료됐을 때만 touch한다(프로토타입 가정).
 */
export const SESSION_TOUCH_GAP_MS = 60 * 60 * 1000;

/** 지금 touch할 차례인지. 마지막 갱신 시각은 expiresAt - 30일이다. */
export function touchDue(session: Session, now: number, gapMs = SESSION_TOUCH_GAP_MS): boolean {
  if (isExpired(session, now)) return true;
  return now - (session.expiresAt - SESSION_TTL_MS) >= gapMs;
}

/** 만료 안내 문구. 게스트는 복구 불가, 계정은 다시 로그인하면 여행방이 그대로 있다. */
export function expiredNotice(expired: Pick<Session, 'kind'>): string {
  return expired.kind === 'guest'
    ? '게스트 세션이 30일 동안 쓰이지 않아 만료됐습니다. 이 게스트와 그 여행방은 복구할 수 없어 닉네임으로 새로 시작합니다.'
    : '로그인이 만료됐습니다. 다시 로그인하면 이 기기의 여행방을 그대로 이어 씁니다.';
}

/** 토큰 끝 4자리만 보인다. 원문은 화면에 두지 않는다. */
export function tokenTail(session: Pick<Session, 'deviceToken'>): string {
  return maskToken(session.deviceToken, TOKEN_VISIBLE_TAIL);
}

/* ---------- 저장·복원 ---------- */

/**
 * 세션 저장 형식. 스토어는 zustand persist로 같은 필드를 저장하고,
 * 이 두 함수는 같은 규칙(저장한 그대로 읽고, 만료면 폐기)을 KV 주입으로 검증할 때 쓴다.
 */
export const SESSION_KV_KEY = 'session';

export async function saveSession(kv: KV, session: Session | undefined): Promise<void> {
  if (!session) await kv.remove(SESSION_KV_KEY);
  else await kv.set(SESSION_KV_KEY, JSON.stringify(session));
}

export function isSession(v: unknown): v is Session {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.userId === 'string' &&
    typeof s.deviceToken === 'string' &&
    typeof s.nickname === 'string' &&
    (s.kind === 'guest' || s.kind === 'account') &&
    typeof s.issuedAt === 'number' &&
    typeof s.expiresAt === 'number'
  );
}

/** 재실행 때 기존 세션을 복원한다. 깨진 값은 없는 것으로, 만료면 지우고 expired로 알린다. */
export async function restoreSession(kv: KV, now: number): Promise<TouchResult> {
  const raw = await kv.get(SESSION_KV_KEY);
  let parsed: unknown;
  try {
    parsed = raw == null ? undefined : JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const r = touchOrExpire(isSession(parsed) ? parsed : undefined, now);
  if (r.state === 'expired') await kv.remove(SESSION_KV_KEY);
  if (r.state === 'ok') await saveSession(kv, r.session);
  return r;
}

/* ---------- 만료 전 알림(sessionExpiry, 프로토타입 가정) ---------- */

/** 게스트 세션 만료 3일 전부터 앱 안 알림 대상이다. 계정 세션은 다시 로그인하면 되므로 알리지 않는다. */
export function isExpirySoon(session: Session, now: number): boolean {
  if (session.kind !== 'guest' || isExpired(session, now)) return false;
  return session.expiresAt - now <= SESSION_EXPIRY_NOTICE_MS;
}

/** 만료 알림 key. 세션이 연장되면 expiresAt이 바뀌어 새 창이 된다. */
export function sessionExpiryKey(session: Pick<Session, 'userId' | 'expiresAt'>): string {
  return `${session.userId}:${session.expiresAt}`;
}

/**
 * 만료 3일 전 알림을 띄울지. 공유 core/notify의 30분 1회·끄기 규칙을 따른다.
 * 여기에 '한 번' 규칙을 AND로 더한다: 같은 key(세션 창)를 이미 띄웠으면(notifiedKey) 다시 띄우지 않는다.
 * recordNotify는 30분이 지난 기록을 정리하므로 '한 번'은 세션 스토어의 영구 표식이 맡는다.
 * 부팅과 앱 사용 중(keepSession) 모두 연장 전 세션으로 판정한다(extended). 쓰면 30일 연장되므로
 * 연장 전 세션이 3일 창 안이면 '만료가 N일 남아 있었다'고 알린다.
 */
export function sessionExpiryNotice(
  session: Session | undefined,
  now: number,
  log: NotifyLogEntry[],
  prefs: NotifyPrefs,
  opts: { extended?: boolean; notifiedKey?: string } = {},
): { entry: NotifyLogEntry; text: string } | null {
  if (!session || !isExpirySoon(session, now)) return null;
  const entry: NotifyLogEntry = { kind: 'sessionExpiry', key: sessionExpiryKey(session), at: now };
  if (opts.notifiedKey === entry.key) return null;
  if (!shouldNotify(log, entry, prefs)) return null;
  const days = Math.max(0, Math.ceil((session.expiresAt - now) / (24 * 60 * 60 * 1000)));
  const tail = '이메일 계정으로 승격하면 기기를 바꿔도 여행방을 이어 쓸 수 있습니다.';
  return {
    entry,
    text: opts.extended
      ? `게스트 세션 만료가 ${days}일 남아 있었습니다. 지금 사용해 30일 연장했습니다. ${tail}`
      : `게스트 세션이 ${days}일 뒤 만료됩니다. 앱을 쓰면 30일 연장됩니다. ${tail}`,
  };
}

/* ---------- 앱 사용 중 세션 유지(FR-105·FR-102 '사용할 때마다 갱신') ---------- */

export type KeepResult =
  | { state: 'idle' }
  | { state: 'none' }
  | { state: 'expired'; expired: Session; text: string }
  | { state: 'touched'; session: Session; notice?: { entry: NotifyLogEntry; text: string } };

/**
 * 시각이 흐를 때(시뮬레이터 시각 포함) 부른다. 갱신 차례가 아니면 idle.
 * 만료면 폐기할 세션과 안내 문구(게스트 복구 불가 / 계정 재로그인)를, 아니면 연장한 세션과
 * 연장 전 세션 기준 만료 3일 전 알림(있으면)을 돌려준다. 저장과 토스트는 부르는 쪽이 한다.
 */
export function keepSession(
  session: Session | undefined,
  now: number,
  log: NotifyLogEntry[],
  prefs: NotifyPrefs,
  notifiedKey?: string,
): KeepResult {
  if (!session) return { state: 'none' };
  if (!touchDue(session, now)) return { state: 'idle' };
  const r = touchOrExpire(session, now);
  if (r.state === 'expired') return { state: 'expired', expired: r.expired, text: expiredNotice(r.expired) };
  if (r.state === 'none') return { state: 'none' };
  const notice = sessionExpiryNotice(session, now, log, prefs, { extended: true, notifiedKey }) ?? undefined;
  return { state: 'touched', session: r.session, notice };
}
