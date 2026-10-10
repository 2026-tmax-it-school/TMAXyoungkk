/**
 * auth-store.mjs의 타입 선언(WP2 소유).
 */
import type { AuthStore } from '../auth.mjs';
import type { SqlDb } from './postgres-store.mjs';

export function createPgAuthStore(db: SqlDb): AuthStore & { readonly kind: 'postgres' };
