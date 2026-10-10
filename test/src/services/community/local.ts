import type { Clock, CommunityPost, CommunityPhoto, CommunityProvider, IdGen } from '../../core/ports';
import { checkDraft } from '../../core/community';

/**
 * 이 기기 모의 커뮤니티(WP6 소유, 2026-10-10). 서버 주소가 없을 때 쓴다. 메모리에만 두므로 앱을 새로 열면 사라진다
 * (프로토타입). 사진은 data: 주소로 그대로 보인다. 같은 기기의 계정만 쓰고 다른 사람은 볼 수 없다.
 * 규칙(종류별 필수 값, 한도)은 서버와 같은 core/community/checkDraft를 쓴다.
 */
export function createLocalCommunity(opts: { clock: Clock; ids: IdGen }): CommunityProvider {
  const posts: CommunityPost[] = [];
  const authorOf = new Map<string, string>();
  const PAGE = 20;

  return {
    id: 'local',

    async list(q, ctx) {
      let all = [...posts].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      if (q.kind) all = all.filter((p) => p.kind === q.kind);
      if (q.before) {
        const [ms, id] = q.before.split(':');
        all = all.filter((p) => p.createdAt < Number(ms) || (p.createdAt === Number(ms) && p.id < id));
      }
      const page = all.slice(0, PAGE);
      const next = all.length > PAGE ? `${page[page.length - 1].createdAt}:${page[page.length - 1].id}` : null;
      return { ok: true, value: { posts: page.map((p) => ({ ...p, mine: authorOf.get(p.id) === ctx.userId && ctx.userId != null })), next } };
    },

    async create(draft, ctx) {
      if (!ctx.userId) return { ok: false, code: 'loginRequired' };
      const check = checkDraft(draft);
      if (!check.ok) return { ok: false, code: 'badPost', detail: check.problem };
      const id = opts.ids.next('cmt');
      const photos: CommunityPhoto[] = draft.photos.map((p, i) => ({ id: `${id}-${i}`, url: `data:${p.mime};base64,${p.data}` }));
      const post: CommunityPost = {
        id,
        kind: draft.kind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        authorId: ctx.userId,
        authorNickname: ctx.nickname || '여행자',
        createdAt: opts.clock.now(),
        photos,
        mine: true,
      };
      posts.push(post);
      authorOf.set(id, ctx.userId);
      return { ok: true, value: post };
    },

    async remove(postId, ctx) {
      const i = posts.findIndex((p) => p.id === postId);
      if (i < 0 || authorOf.get(postId) !== ctx.userId) return { ok: false, code: 'notFound' };
      posts.splice(i, 1);
      authorOf.delete(postId);
      return { ok: true, value: true };
    },

    photoUri: (photo) => photo.url,
  };
}
