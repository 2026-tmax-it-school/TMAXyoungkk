import type { AuthProvider, Clock, Hasher, KV, Rng } from '../../core/ports';
import { createLocalAuth } from './local';

export type { SocialInput } from './local';

/** 인증 제공자 팩토리(WP1 소유). 서버가 없어 단말 저장 모의 인증 하나다(프로토타입 · 단말 저장). */
export function createAuthProvider(opts: { clock: Clock; rng: Rng; hasher: Hasher; kv: KV }): AuthProvider {
  return createLocalAuth(opts);
}
