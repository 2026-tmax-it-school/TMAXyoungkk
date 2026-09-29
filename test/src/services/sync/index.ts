import type { Clock, FetchLike, KV, SyncTransport } from '../../core/ports';
import { createHttpTransport } from './http';
import { createLoopbackTransport, type Chaos } from './loopback';

/**
 * 동기화 전송 팩토리(WP2 소유). EXPO_PUBLIC_SYNC_URL이 있으면 HTTP 폴링, 없으면 이 기기 안의 루프백.
 * WebSocket은 쓰지 않는다.
 */
export function createSyncTransport(opts: {
  syncUrl?: string;
  fetch: FetchLike;
  clock: Clock;
  kv: KV;
  chaos?: Chaos;
}): SyncTransport {
  if (opts.syncUrl) return createHttpTransport({ url: opts.syncUrl, fetch: opts.fetch, clock: opts.clock });
  return createLoopbackTransport({ clock: opts.clock, kv: opts.kv, chaos: opts.chaos });
}
