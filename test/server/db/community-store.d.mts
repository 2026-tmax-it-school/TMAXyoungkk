import type { CommunityStore } from '../community.mjs';
import type { SqlDb } from './postgres-store.mjs';

export function createPgCommunityStore(db: SqlDb): CommunityStore;
