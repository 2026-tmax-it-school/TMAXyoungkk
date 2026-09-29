/**
 * sync-server.mjs의 타입 선언(WP2 소유). 테스트가 '../server/sync-server.mjs'를 확장자까지 적어 import할 때 쓴다.
 * 서버 자체는 앱 번들에 들어가지 않는다.
 */

export type InviteJudgement = 'ok' | 'notFound' | 'expired' | 'revoked' | 'full';

export interface StoredOp {
  id: string;
  tripId: string;
  seq: number;
  [key: string]: unknown;
}

export function judgeInvite(ops: readonly unknown[], code: string, now: number): InviteJudgement;

export function createSyncStore(): {
  push(tripId: string, ops: readonly unknown[]): { opId: string; seq: number }[];
  pull(tripId: string, after: number): StoredOp[];
  lookup(
    code: string,
    now: number,
  ): { tripId: string; status: InviteJudgement } | { tripId: string; error: 'revoked' } | { error: 'notFound' };
  reset(): void;
};

export function isDirectRun(moduleUrl: string, argv1: string | undefined): boolean;

export function startSyncServer(opts?: {
  port?: number;
  host?: string;
  now?: () => number;
}): Promise<{ url: string; close: () => Promise<void> }>;
