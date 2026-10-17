/**
 * postgres-store.mjs의 타입 선언(WP2 소유). 테스트는 PGlite를 sqlDb()로 감싸 같은 저장소를 돌린다.
 */
import type { AuthStore } from '../auth.mjs';
import type { CommunityStore } from '../community.mjs';
import type { Ack, InviteLookupResult, StoredOp, SyncStore } from '../sync-server.mjs';
import type { DayView, LegView, SpotView, TripView } from './projection.mjs';

export interface QueryResult {
  rows: any[];
}

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

export interface TxClient extends Queryable {
  /** 여러 문장 SQL(마이그레이션) */
  exec(sql: string): Promise<unknown>;
}

export interface SqlDb extends Queryable {
  tx<T>(fn: (q: TxClient) => Promise<T>): Promise<T>;
}

/** pg.Pool(connect·query) 또는 PGlite(transaction·exec·query) */
export function sqlDb(client: unknown): SqlDb;

export function jsonText(value: unknown): string;

export interface PostgresSyncStore extends SyncStore {
  readonly kind: 'postgres';
  readonly authStore: AuthStore;
  readonly communityStore: CommunityStore;
  push(tripId: string, ops: readonly unknown[], now?: number): Promise<Ack[]>;
  pull(tripId: string, after: number): Promise<StoredOp[]>;
  lookup(code: string, now: number): Promise<InviteLookupResult>;
  reset(): Promise<void>;
  purgeExpired(now: number): Promise<string[]>;
  health(): Promise<boolean>;
  routeCache: {
    get(key: string, now?: number): Promise<unknown>;
    put(key: string, response: unknown, now?: number): Promise<void>;
  };
  readView(tripId: string): Promise<{ trip: TripView | null; spots: SpotView[]; days: DayView[]; legs: LegView[] }>;
  rebuildView(tripId: string): Promise<boolean>;
  close(): Promise<void>;
}

export function createPostgresStore(
  db: SqlDb,
  opts?: { close?: () => Promise<void>; warn?: (message: string) => void },
): PostgresSyncStore;

export function openPostgresStore(
  url: string,
  opts?: { createPool?: (url: string) => unknown; warn?: (message: string) => void },
): Promise<PostgresSyncStore>;
