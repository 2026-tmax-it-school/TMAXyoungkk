import type { KV } from '../../core/ports';
import { createDraftStore, type DraftStore } from '../../services/community/drafts';
import { getServices } from '../../services/registry';

/**
 * 글쓰기 화면이 쓰는 임시 저장소(WP6 소유, 2026-10-11). registry의 앱 KV('young-trip/svc/app/', 앱을 껐다 켜도 남는다) 위에
 * services/community/drafts.ts를 하나만 만들어 둔다. 테스트가 서비스를 덮어 KV가 바뀌면 새로 만든다.
 */
let cached: { kv: KV; store: DraftStore } | null = null;

export function communityDrafts(): DraftStore {
  const kv = getServices().kv;
  if (!cached || cached.kv !== kv) cached = { kv, store: createDraftStore(kv) };
  return cached.store;
}
