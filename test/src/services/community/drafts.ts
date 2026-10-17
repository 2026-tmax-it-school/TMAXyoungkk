import type { KV } from '../../core/ports';
import {
  draftKeys,
  isEmptyContent,
  parsePhotoRecord,
  parseTextRecord,
  photoRecord,
  photoSignature,
  rememberTags,
  cleanTags,
  RECENT_TAGS_MAX,
  textRecord,
  type SavedDraft,
} from '../../core/community';

/**
 * 커뮤니티 글 임시 저장소(WP6 소유, 2026-10-11). 규칙은 core/community/draft.ts, 여기는 KV에 읽고 쓰는 얇은 어댑터다.
 * 앱에서는 registry의 'young-trip/svc/app/' KV(AsyncStorage, 웹은 localStorage)를 넘겨 앱을 껐다 켜도 남는다.
 *
 * - 글 기록을 먼저 쓰고 사진 기록을 따로 쓴다. 사진(base64)이 커서 저장 공간이 모자라 실패해도 글은 남는다.
 *   사진 저장이 실패하면 예전 사진 기록을 지워(서명이 맞지 않는 사진이 되살아나지 않게) photos: 'failed'를 돌려준다.
 * - 사진이 지난번 저장과 같으면 다시 쓰지 않는다(글자를 고칠 때마다 몇 MB를 쓰지 않게).
 * - 어떤 저장소 오류도 밖으로 던지지 않는다. 읽기 실패는 '저장한 글 없음'으로 본다.
 */

export interface DraftSaveResult {
  /** 글 기록을 썼는지 */
  ok: boolean;
  /** saved: 사진까지 썼다, unchanged: 지난번과 같아 건너뛰었다, failed: 사진은 쓰지 못했다(글은 ok에 따른다) */
  photos: 'saved' | 'unchanged' | 'failed';
}

export interface DraftStore {
  load(userId: string): Promise<SavedDraft | null>;
  save(userId: string, draft: SavedDraft): Promise<DraftSaveResult>;
  clear(userId: string): Promise<void>;
  recentTags(userId: string): Promise<string[]>;
  rememberTags(userId: string, used: readonly string[]): Promise<void>;
}

export function createDraftStore(kv: KV): DraftStore {
  /** 사람마다 마지막으로 저장(또는 불러온) 사진 서명 */
  const lastPhotoSig = new Map<string, string>();

  const quiet = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };

  async function recentTags(userId: string): Promise<string[]> {
    try {
      const raw = await kv.get(draftKeys(userId).recent);
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? cleanTags(v.filter((t): t is string => typeof t === 'string'), RECENT_TAGS_MAX) : [];
    } catch {
      return [];
    }
  }

  return {
    async load(userId) {
      const keys = draftKeys(userId);
      let text: ReturnType<typeof parseTextRecord> = null;
      try {
        text = parseTextRecord(await kv.get(keys.text));
      } catch {
        return null;
      }
      if (!text) return null;
      let photos: SavedDraft['photos'] = [];
      if (text.photoSig) {
        try {
          photos = parsePhotoRecord(await kv.get(keys.photos), text.photoSig) ?? [];
        } catch {
          photos = [];
        }
      }
      lastPhotoSig.set(userId, photoSignature(photos));
      const draft: SavedDraft = { title: text.title, body: text.body, tags: text.tags, origin: text.origin, updatedAt: text.updatedAt, photos };
      return isEmptyContent(draft) ? null : draft;
    },

    async save(userId, draft) {
      const keys = draftKeys(userId);
      if (isEmptyContent(draft)) {
        await quiet(() => kv.remove(keys.text));
        await quiet(() => kv.remove(keys.photos));
        lastPhotoSig.set(userId, '');
        return { ok: true, photos: 'saved' };
      }
      const ok = await quiet(() => kv.set(keys.text, textRecord(draft)));
      const sig = photoSignature(draft.photos);
      if (lastPhotoSig.get(userId) === sig) return { ok, photos: 'unchanged' };
      if (draft.photos.length === 0) {
        await quiet(() => kv.remove(keys.photos));
        lastPhotoSig.set(userId, sig);
        return { ok, photos: 'saved' };
      }
      if (await quiet(() => kv.set(keys.photos, photoRecord(draft.photos)))) {
        lastPhotoSig.set(userId, sig);
        return { ok, photos: 'saved' };
      }
      await quiet(() => kv.remove(keys.photos));
      lastPhotoSig.delete(userId);
      return { ok, photos: 'failed' };
    },

    async clear(userId) {
      const keys = draftKeys(userId);
      await quiet(() => kv.remove(keys.text));
      await quiet(() => kv.remove(keys.photos));
      lastPhotoSig.set(userId, '');
    },

    recentTags,

    async rememberTags(userId, used) {
      if (used.length === 0) return;
      const next = rememberTags(await recentTags(userId), used);
      await quiet(() => kv.set(draftKeys(userId).recent, JSON.stringify(next)));
    },
  };
}
