/**
 * auth.mjs의 타입 선언(WP2 소유). 테스트가 '../server/auth.mjs'를 확장자까지 적어 import할 때 쓴다.
 */

import type { OAuthClientOptions } from './oauth.mjs';

type Awaitable<T> = T | Promise<T>;

export const SESSION_TTL_MS: number;
export const PASSWORD_MIN_LENGTH: number;
export const NICKNAME_MAX: number;
export const LOGIN_MAX_FAILS: number;
export const LOGIN_LOCK_MS: number;
export const IP_ATTEMPT_LIMIT: number;
export const ATTEMPT_WINDOW_MS: number;
export const EMAIL_IP_ATTEMPT_LIMIT: number;
export const MAIL_LIMIT: number;
export const VERIFY_TTL_MS: number;
export const RESET_TTL_MS: number;
export const LINK_TTL_MS: number;
export const OUTBOX_LIMIT: number;
export const OAUTH_STATE_TTL_MS: number;
export const OAUTH_STATE_LIMIT: number;

export function normalizeEmail(email: unknown): string;
export function isEmailLike(email: unknown): boolean;
export function passwordViolations(password: unknown): string[];
export function nicknameProblem(nickname: unknown): string | null;
export function hashPassword(password: string, opts?: { cost?: number }): Promise<string>;
export function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean>;
export function newToken(): string;
export function tokenHash(token: string): string;

export interface AuthAccountRecord {
  accountId: string;
  userId: string;
  email: string | null;
  nickname: string | null;
  passwordHash: string | null;
  verifiedAt: number | null;
  providers: string[];
  profile: Record<string, unknown>;
  createdAt: number;
  deletedAt: number | null;
  /** 게스트 승격 확인값(SHA-256(기기 토큰)). 같은 userId의 인증 전 가입은 이 값이 같을 때만 대체한다 */
  upgradeProof?: string | null;
}

export interface AuthSessionRecord {
  tokenHash: string;
  accountId: string;
  deviceToken: string | null;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

export type AccountConflict = 'ok' | 'email' | 'nickname' | 'userId' | 'conflict';

/** 메모리와 PostgreSQL 계정 저장소가 같이 따르는 모양 */
export interface AuthStore {
  readonly kind: 'memory' | 'postgres';
  accountById(id: string): Awaitable<AuthAccountRecord | null>;
  accountByEmail(email: string): Awaitable<AuthAccountRecord | null>;
  accountByUserId(userId: string): Awaitable<AuthAccountRecord | null>;
  /** 닉네임(공백·대소문자 무시)으로 찾는다. 아이디 로그인용 */
  accountByNickname(nickname: string): Awaitable<AuthAccountRecord | null>;
  nicknameTaken(nickname: string, exceptId?: string): Awaitable<boolean>;
  insertAccount(rec: AuthAccountRecord): Awaitable<AccountConflict>;
  updateAccount(id: string, patch: Partial<AuthAccountRecord>): Awaitable<AccountConflict>;
  removeAccount(id: string): Awaitable<void>;
  identity(provider: string, subject: string): Awaitable<string | null>;
  putIdentity(provider: string, subject: string, accountId: string, now?: number): Awaitable<'ok' | 'conflict'>;
  dropIdentities(accountId: string): Awaitable<void>;
  putSession(s: AuthSessionRecord): Awaitable<void>;
  session(hash: string): Awaitable<AuthSessionRecord | null>;
  touchSession(hash: string, lastUsedAt: number, expiresAt: number): Awaitable<void>;
  dropSession(hash: string): Awaitable<void>;
  dropSessions(accountId: string): Awaitable<void>;
  putToken(t: { tokenHash: string; kind: 'verify' | 'reset' | 'link'; accountId: string; data?: Record<string, unknown>; createdAt: number; expiresAt: number }): Awaitable<void>;
  useToken(hash: string, kind: 'verify' | 'reset' | 'link', now: number): Awaitable<{ accountId: string; data: Record<string, any> } | null>;
  dropTokens(accountId: string, kind?: 'verify' | 'reset' | 'link'): Awaitable<void>;
  putOAuthState(st: { stateHash: string; provider: 'google' | 'kakao'; redirectUri: string; createdAt: number; expiresAt: number }): Awaitable<void>;
  /** 한 번만 쓴다. 제공자가 다르거나 만료·사용한 값이면 null */
  useOAuthState(hash: string, provider: 'google' | 'kakao', now: number): Awaitable<{ redirectUri: string } | null>;
  hit(key: string, now: number, windowMs: number): Awaitable<{ count: number; windowStart: number }>;
  bumpFail(key: string, now: number, max: number, lockMs: number): Awaitable<{ count: number; lockedUntil: number | null }>;
  setLock(key: string, lock: { fails: number; lockedUntil: number | null }, now: number): Awaitable<void>;
  purge(now: number): Awaitable<void>;
  reset(): Awaitable<void>;
}

export function createMemoryAuthStore(): AuthStore;

export interface OutboxMail {
  id: string;
  kind: 'verify' | 'reset' | 'link';
  to: string;
  subject: string;
  token: string;
  sentAt: number;
  invalidated: boolean;
}

export interface AuthServiceOptions {
  store?: AuthStore;
  now?: () => number;
  /** 개발용 보낸편지함(GET /auth/outbox)을 연다 */
  devOutbox?: boolean;
  /** 모의 소셜(/auth/social, /auth/social/confirm)을 연다. 기본은 devOutbox와 같다. 아니면 404 */
  mockSocial?: boolean;
  /** scrypt N(테스트만 줄인다. 기본 16384) */
  passwordCost?: number;
  log?: (message: string) => void;
  /** 실제 소셜 로그인(구글·카카오 OAuth). 키가 없는 제공자는 503이다 */
  oauth?: OAuthClientOptions;
}

export interface AuthService {
  handle(req: {
    method: string | undefined;
    path: string;
    url: URL;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    ip: string;
  }): Promise<{ status: number; body: unknown }>;
  purge(): Promise<void>;
  outbox(): OutboxMail[];
}

export function createAuthService(opts?: AuthServiceOptions): AuthService;
export function isAuthPath(pathname: string): boolean;
export function devOutboxFromEnv(env: Record<string, string | undefined>): boolean;
