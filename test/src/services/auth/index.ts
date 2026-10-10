import type { AuthProvider, Clock, FetchLike, Hasher, KV, Rng } from '../../core/ports';
import { createHttpAuth } from './http';
import { createLocalAuth } from './local';

export type { SocialInput } from './local';

/**
 * 인증 제공자 팩토리(WP1 소유).
 * - serverUrl(계정 서버, config AUTH_URL)이 있으면 서버 인증(http.ts). 세션 토큰은 kv에 둔다
 * - 없으면 이 기기 모의 인증(local.ts, 프로토타입 · 단말 저장)
 */
export function createAuthProvider(opts: {
  clock: Clock;
  rng: Rng;
  hasher: Hasher;
  kv: KV;
  serverUrl?: string;
  fetch?: FetchLike;
}): AuthProvider {
  if (opts.serverUrl && opts.fetch) return createHttpAuth({ url: opts.serverUrl, fetch: opts.fetch, kv: opts.kv });
  return createLocalAuth(opts);
}
