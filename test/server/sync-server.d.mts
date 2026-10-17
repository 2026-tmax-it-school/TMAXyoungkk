/**
 * sync-server.mjs의 타입 선언(WP2 소유). 테스트가 '../server/sync-server.mjs'를 확장자까지 적어 import할 때 쓴다.
 * 서버 자체는 앱 번들에 들어가지 않는다.
 */
import type { AuthServiceOptions, AuthStore } from './auth.mjs';
import type { CommunityStore } from './community.mjs';
import type { ApiProxyOptions } from './proxy.mjs';

export type InviteJudgement = 'ok' | 'notFound' | 'expired' | 'revoked' | 'full';

export interface StoredOp {
  id: string;
  tripId: string;
  seq: number;
  [key: string]: unknown;
}

export interface Ack {
  opId: string;
  seq: number;
}

export type InviteLookupResult =
  | { tripId: string; status: InviteJudgement }
  | { tripId: string; error: 'revoked' }
  | { error: 'notFound' };

type Awaitable<T> = T | Promise<T>;

/** 메모리와 PostgreSQL 저장소가 같이 따르는 모양. 메모리는 동기로, PostgreSQL은 Promise로 돌려준다. */
export interface SyncStore {
  readonly kind: 'memory' | 'postgres';
  /** 계정·로그인 저장소(PostgreSQL 저장소가 준다). 없으면 서버가 메모리 계정 저장소를 쓴다 */
  readonly authStore?: AuthStore;
  readonly communityStore?: CommunityStore;
  push(tripId: string, ops: readonly unknown[], now?: number): Awaitable<Ack[]>;
  pull(tripId: string, after: number): Awaitable<StoredOp[]>;
  lookup(code: string, now: number): Awaitable<InviteLookupResult>;
  reset(): Awaitable<void>;
  /** 보관 기한이 지나 지운 tripId(정렬) */
  purgeExpired(now: number): Awaitable<string[]>;
  health(): Awaitable<boolean>;
  routeCache: {
    get(key: string, now?: number): Awaitable<unknown>;
    put(key: string, response: unknown, now?: number): Awaitable<void>;
  };
  close(): Awaitable<void>;
}

export interface MemorySyncStore extends SyncStore {
  readonly kind: 'memory';
  push(tripId: string, ops: readonly unknown[], now?: number): Ack[];
  pull(tripId: string, after: number): StoredOp[];
  lookup(code: string, now: number): InviteLookupResult;
  reset(): void;
  purgeExpired(now: number): string[];
  health(): boolean;
  routeCache: {
    get(key: string, now?: number): unknown;
    put(key: string, response: unknown, now?: number): void;
  };
  close(): void;
}

export function judgeInvite(ops: readonly unknown[], code: string, now: number): InviteJudgement;

/** 메모리 경로 캐시 상한(개수, JSON 글자 수 합) */
export const MEMORY_ROUTE_CACHE_LIMIT: Readonly<{ entries: number; chars: number }>;

export function createSyncStore(opts?: {
  warn?: (message: string) => void;
  /** 메모리 경로 캐시 상한. 넘으면 오래 둔 것부터 버린다 */
  routeCacheLimit?: { entries: number; chars: number };
}): MemorySyncStore;

/** 시연 리셋 허용 여부. 메모리는 늘 허용, PostgreSQL은 SYNC_ALLOW_RESET=1일 때만 */
export function allowResetFromEnv(env: Record<string, string | undefined>, kind: SyncStore['kind']): boolean;

export function isDirectRun(moduleUrl: string, argv1: string | undefined): boolean;

export function storeFromEnv(
  env: Record<string, string | undefined>,
  opts?: { openPostgres?: (url: string) => Promise<SyncStore> },
): Promise<SyncStore>;

export function startSyncServer(opts?: {
  port?: number;
  host?: string;
  now?: () => number;
  store?: SyncStore;
  /** 거짓이면 POST /reset은 403(기본: 메모리 저장소만 허용) */
  allowReset?: boolean;
  purgeEveryMs?: number;
  log?: (message: string) => void;
  /** 키 숨기는 중계 설정(server/proxy.mjs). 기본은 카카오 키 없음·공개 OSRM, false면 중계 경로도 404 */
  proxy?: ApiProxyOptions | false;
  /** 계정·로그인 설정(server/auth.mjs). store 기본은 저장소의 authStore 또는 메모리, devOutbox·mockSocial 기본은 꺼짐(메모리 저장소여도). false면 /auth도 404 */
  auth?: AuthServiceOptions | false;
}): Promise<{ url: string; close: () => Promise<void> }>;
