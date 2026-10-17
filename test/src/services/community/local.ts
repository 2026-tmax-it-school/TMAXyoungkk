import type { Clock, CommunityPost, CommunityPhoto, CommunityProvider, IdGen } from '../../core/ports';
import { checkDraft, cleanTags, matchesSearch, normalizeTag } from '../../core/community';

/**
 * 이 기기 모의 커뮤니티(WP6 소유, 2026-10-10). 서버 주소가 없을 때 쓴다. 메모리에만 두므로 앱을 새로 열면 사라진다
 * (프로토타입). 사진은 data: 주소로 그대로 보인다. 같은 기기의 계정만 쓰고 다른 사람은 볼 수 없다.
 * 규칙(본문이나 사진 하나, 한도, 태그)은 서버와 같은 core/community/checkDraft를 쓴다. 태그 거르기도 서버처럼 맞춘 값으로 본다.
 * 고치기(2026-10-17)도 서버와 같다: 본인 글만, 남길 사진은 그 글의 사진만, 남긴 사진 → 새 사진 순서, editedAt을 둔다.
 */
export function createLocalCommunity(opts: { clock: Clock; ids: IdGen }): CommunityProvider {
  const posts: CommunityPost[] = [];
  const authorOf = new Map<string, string>();
  /** 좋아요 '글|사용자', 조회 '글|보는사람' (모의라 하루가 아니라 이 실행 동안 한 번) */
  const likedBy = new Set<string>();
  const viewedBy = new Set<string>();
  const PAGE = 20;

  return {
    id: 'local',

    async list(q, ctx) {
      let all = [...posts].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      if (q.tag) {
        const tag = normalizeTag(q.tag);
        all = tag ? all.filter((p) => p.tags.includes(tag)) : [];
      }
      if (q.q) all = all.filter((p) => matchesSearch(p, q.q as string));
      if (q.before) {
        const [ms, id] = q.before.split(':');
        all = all.filter((p) => p.createdAt < Number(ms) || (p.createdAt === Number(ms) && p.id < id));
      }
      const page = all.slice(0, PAGE);
      const next = all.length > PAGE ? `${page[page.length - 1].createdAt}:${page[page.length - 1].id}` : null;
      const mark = (p: CommunityPost): CommunityPost => ({ ...p, mine: authorOf.get(p.id) === ctx.userId && ctx.userId != null, liked: ctx.userId != null && likedBy.has(`${p.id}|${ctx.userId}`) });
      return { ok: true, value: { posts: page.map(mark), next } };
    },

    async create(draft, ctx) {
      if (!ctx.userId) return { ok: false, code: 'loginRequired' };
      const check = checkDraft(draft);
      if (!check.ok) return { ok: false, code: 'badPost', detail: check.problem };
      const id = opts.ids.next('cmt');
      const photos: CommunityPhoto[] = draft.photos.map((p, i) => ({ id: `${id}-${i}`, url: `data:${p.mime};base64,${p.data}` }));
      const post: CommunityPost = {
        id,
        title: draft.title.trim(),
        body: draft.body.trim(),
        tags: cleanTags(draft.tags),
        authorId: ctx.userId,
        authorNickname: ctx.nickname || '여행자',
        createdAt: opts.clock.now(),
        photos,
        mine: true,
        views: 0,
        likes: 0,
        liked: false,
      };
      posts.push(post);
      authorOf.set(id, ctx.userId);
      return { ok: true, value: post };
    },

    async update(postId, draft, ctx) {
      if (!ctx.userId) return { ok: false, code: 'loginRequired' };
      const i = posts.findIndex((p) => p.id === postId);
      if (i < 0 || authorOf.get(postId) !== ctx.userId) return { ok: false, code: 'notFound' };
      const cur = posts[i];
      const keep = draft.keepPhotoIds;
      if (new Set(keep).size !== keep.length || keep.some((id) => !cur.photos.some((p) => p.id === id))) {
        return { ok: false, code: 'badPost', detail: '사진 값이 올바르지 않습니다' };
      }
      const check = checkDraft(draft, keep.length);
      if (!check.ok) return { ok: false, code: 'badPost', detail: check.problem };
      const kept = keep.map((id) => cur.photos.find((p) => p.id === id)!);
      const fresh: CommunityPhoto[] = draft.photos.map((p) => ({ id: opts.ids.next('cph'), url: `data:${p.mime};base64,${p.data}` }));
      const post: CommunityPost = {
        ...cur,
        title: draft.title.trim(),
        body: draft.body.trim(),
        tags: cleanTags(draft.tags),
        editedAt: opts.clock.now(),
        photos: [...kept, ...fresh],
        mine: true,
      };
      posts[i] = post;
      return { ok: true, value: post };
    },

    async remove(postId, ctx) {
      const i = posts.findIndex((p) => p.id === postId);
      if (i < 0 || authorOf.get(postId) !== ctx.userId) return { ok: false, code: 'notFound' };
      posts.splice(i, 1);
      authorOf.delete(postId);
      return { ok: true, value: true };
    },

    async like(postId, on, ctx) {
      if (!ctx.userId) return { ok: false, code: 'loginRequired' };
      const i = posts.findIndex((p) => p.id === postId);
      if (i < 0) return { ok: false, code: 'notFound' };
      const key = `${postId}|${ctx.userId}`;
      let likes = posts[i].likes ?? 0;
      if (on && !likedBy.has(key)) {
        likedBy.add(key);
        likes += 1;
      } else if (!on && likedBy.has(key)) {
        likedBy.delete(key);
        likes -= 1;
      }
      posts[i] = { ...posts[i], likes };
      return { ok: true, value: { ...posts[i], mine: authorOf.get(postId) === ctx.userId, liked: likedBy.has(key) } };
    },

    async view(postId, ctx) {
      const i = posts.findIndex((p) => p.id === postId);
      if (i < 0) return { ok: false, code: 'notFound' };
      const key = `${postId}|${ctx.userId ?? ''}`;
      if (authorOf.get(postId) !== ctx.userId && !viewedBy.has(key)) {
        viewedBy.add(key);
        posts[i] = { ...posts[i], views: (posts[i].views ?? 0) + 1 };
      }
      return { ok: true, value: posts[i].views ?? 0 };
    },

    photoUri: (photo) => photo.url,
  };
}
