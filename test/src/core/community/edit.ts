import type { CommunityEditDraft, CommunityPhoto, CommunityPost } from '../ports';
import { photoSignature, type ComposeContent } from './draft';

/**
 * 커뮤니티 글 고치기 규칙(WP6 소유, 2026-10-17). 순수 함수만 둔다.
 * 화면은 CommunityComposeScreen(editPostId로 연다), 서버는 POST /community/posts/:id/update.
 *
 * - 고치는 글은 '남긴 예전 사진'(kept, 서버 주소로 보인다)과 '새로 고른 사진'(photos, base64)을 따로 든다.
 *   보이는 순서는 남긴 사진 → 새 사진이고, 서버에도 그 순서로 보낸다(남긴 사진은 {id}만).
 * - 바뀐 것이 있는지는 처음 연 글(original)과 비교한다. 고치기는 임시 저장을 쓰지 않는다(새 글 임시 저장을 읽지도 덮지도 않는다).
 *   그래서 나갈 때는 바뀐 것이 있으면 묻고(고친 내용은 버려진다), 없으면 그냥 나간다.
 */

export interface EditContent extends ComposeContent {
  /** 남긴 예전 사진(보이는 순서) */
  kept: CommunityPhoto[];
}

/** 저장 뒤 알림 문장 */
export const EDIT_SAVED_TEXT = '글을 고쳤어요';

/** 고칠 글 → 처음 내용 */
export function editContentOf(post: CommunityPost): EditContent {
  return { title: post.title, body: post.body, tags: [...post.tags], photos: [], kept: post.photos.map((p) => ({ ...p })) };
}

function editSignature(c: EditContent): string {
  return JSON.stringify([c.title.trim(), c.body.trim(), c.tags, c.kept.map((p) => p.id), photoSignature(c.photos)]);
}

/** 처음 연 글과 달라졌는지(제목·본문 앞뒤 공백은 보지 않는다) */
export function isEditDirty(current: EditContent, original: EditContent): boolean {
  return editSignature(current) !== editSignature(original);
}

/** 고치기 화면을 떠날 때. 저장했거나 바뀐 것이 없으면 leave, 아니면 ask(임시 저장이 없으니 clear는 없다) */
export function editLeaveDecision(opts: { current: EditContent; original: EditContent; published: boolean }): 'leave' | 'ask' {
  if (opts.published) return 'leave';
  return isEditDirty(opts.current, opts.original) ? 'ask' : 'leave';
}

/** 화면 내용 → 서버에 보낼 고친 글(제목·본문은 앞뒤 공백을 뗀다) */
export function editDraftOf(c: EditContent): CommunityEditDraft {
  return { title: c.title.trim(), body: c.body.trim(), tags: c.tags, photos: c.photos, keepPhotoIds: c.kept.map((p) => p.id) };
}
