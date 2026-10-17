import type { CommunityCtx, CommunityFail, CommunityPhoto, CommunityPost, CommunityProvider, CommunityResult, FetchLike } from '../../core/ports';
import { resolvePhotoUrl } from '../../core/community';

/**
 * 커뮤니티 서버 제공자(WP6 소유, 2026-10-10). server/community.mjs(/community/…)와 짝이다.
 * EXPO_PUBLIC_API_URL(없으면 EXPO_PUBLIC_SYNC_URL)이 있을 때 registry가 고른다. 글쓰기·지우기는 계정 서버 Bearer가 필요하다
 * (ctx.token). 읽기는 로그인 없이 되고, 토큰이 있으면 서버가 내 글에 mine을 켠다. 서버에 닿지 못하면 unreachable이다.
 * 2026-10-11: 글 종류(kind)는 보내지 않는다(서버가 사진 유무로 정한다). 태그를 보내고 ?tag=로 거른다.
 * 응답 글은 모양을 확인하고 필요한 값만 옮긴다(예전 서버라 tags가 없으면 []).
 */

const FAILS: readonly CommunityFail[] = ['loginRequired', 'badPost', 'tooMany', 'tooLarge', 'unreachable', 'notFound'];
const asFail = (c: unknown): CommunityFail => (FAILS.includes(c as CommunityFail) ? (c as CommunityFail) : 'badPost');

/** 서버 응답 글 → 앱 글. 모양이 틀리면 null */
function toPost(v: unknown): CommunityPost | null {
  const p = v as Record<string, unknown> | null;
  if (
    !p ||
    typeof p.id !== 'string' ||
    typeof p.body !== 'string' ||
    typeof p.authorNickname !== 'string' ||
    typeof p.createdAt !== 'number' ||
    !Array.isArray(p.photos)
  ) {
    return null;
  }
  return {
    id: p.id,
    title: typeof p.title === 'string' ? p.title : '',
    body: p.body,
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
    authorId: typeof p.authorId === 'string' ? p.authorId : '',
    authorNickname: p.authorNickname,
    createdAt: p.createdAt,
    photos: (p.photos as unknown[]).filter(
      (x): x is CommunityPhoto => !!x && typeof (x as CommunityPhoto).id === 'string' && typeof (x as CommunityPhoto).url === 'string',
    ),
    mine: p.mine === true,
  };
}

export function createHttpCommunity(opts: { url: string; fetch: FetchLike; timeoutMs?: number }): CommunityProvider {
  const base = opts.url.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function call(path: string, init: { body?: unknown; token?: string } = {}): Promise<{ status: number; body: Record<string, unknown> } | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        opts.fetch(`${base}${path}`, {
          method: init.body === undefined ? 'GET' : 'POST',
          headers: {
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
      const text = await res.text();
      let body: unknown = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = {};
      }
      return { status: res.status, body: body && typeof body === 'object' ? (body as Record<string, unknown>) : {} };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const failOf = <T,>(r: { status: number; body: Record<string, unknown> } | null): CommunityResult<T> => {
    if (!r) return { ok: false, code: 'unreachable' };
    if (r.status === 413) return { ok: false, code: 'tooLarge' };
    return { ok: false, code: asFail(r.body.error), ...(typeof r.body.detail === 'string' ? { detail: r.body.detail } : {}) };
  };

  return {
    id: 'server',

    async list(q, ctx: CommunityCtx) {
      const params = new URLSearchParams();
      if (q.before) params.set('before', q.before);
      if (q.tag) params.set('tag', q.tag);
      const r = await call(`/community/posts${params.size ? `?${params.toString()}` : ''}`, { token: ctx.token });
      if (!r || r.status !== 200 || !Array.isArray(r.body.posts)) return failOf(r);
      return {
        ok: true,
        value: {
          posts: (r.body.posts as unknown[]).map(toPost).filter((p): p is CommunityPost => p != null),
          next: typeof r.body.next === 'string' ? r.body.next : null,
        },
      };
    },

    async create(draft, ctx) {
      if (!ctx.token) return { ok: false, code: 'loginRequired' };
      const r = await call('/community/posts', {
        body: { title: draft.title, body: draft.body, tags: draft.tags, photos: draft.photos },
        token: ctx.token,
      });
      const post = r && r.status === 200 ? toPost(r.body.post) : null;
      if (!post) return failOf(r);
      return { ok: true, value: post };
    },

    async remove(postId, ctx) {
      if (!ctx.token) return { ok: false, code: 'loginRequired' };
      const r = await call(`/community/posts/${encodeURIComponent(postId)}/delete`, { body: {}, token: ctx.token });
      if (!r || r.status !== 200) return failOf(r);
      return { ok: true, value: true };
    },

    photoUri: (photo: CommunityPhoto) => resolvePhotoUrl(base, photo.url),
  };
}
