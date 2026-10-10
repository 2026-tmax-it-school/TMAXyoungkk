import type {
  CommunityCtx,
  CommunityFail,
  CommunityKind,
  CommunityPhoto,
  CommunityPost,
  CommunityProvider,
  CommunityResult,
  FetchLike,
} from '../../core/ports';
import { resolvePhotoUrl } from '../../core/community';

/**
 * 커뮤니티 서버 제공자(WP6 소유, 2026-10-10). server/community.mjs(/community/…)와 짝이다.
 * EXPO_PUBLIC_API_URL(없으면 EXPO_PUBLIC_SYNC_URL)이 있을 때 registry가 고른다. 글쓰기·지우기는 계정 서버 Bearer가 필요하다
 * (ctx.token). 읽기는 로그인 없이 되고, 토큰이 있으면 서버가 내 글에 mine을 켠다. 서버에 닿지 못하면 unreachable이다.
 */

const FAILS: readonly CommunityFail[] = ['loginRequired', 'badPost', 'tooMany', 'tooLarge', 'unreachable', 'notFound'];
const asFail = (c: unknown): CommunityFail => (FAILS.includes(c as CommunityFail) ? (c as CommunityFail) : 'badPost');

function isPost(v: unknown): v is CommunityPost {
  const p = v as CommunityPost;
  return (
    !!p &&
    typeof p.id === 'string' &&
    (p.kind === 'photo' || p.kind === 'diary') &&
    typeof p.body === 'string' &&
    typeof p.authorNickname === 'string' &&
    typeof p.createdAt === 'number' &&
    Array.isArray(p.photos)
  );
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
      if (q.kind) params.set('kind', q.kind as CommunityKind);
      const r = await call(`/community/posts${params.size ? `?${params.toString()}` : ''}`, { token: ctx.token });
      if (!r || r.status !== 200 || !Array.isArray(r.body.posts)) return failOf(r);
      return {
        ok: true,
        value: { posts: (r.body.posts as unknown[]).filter(isPost), next: typeof r.body.next === 'string' ? r.body.next : null },
      };
    },

    async create(draft, ctx) {
      if (!ctx.token) return { ok: false, code: 'loginRequired' };
      const r = await call('/community/posts', { body: draft, token: ctx.token });
      if (!r || r.status !== 200 || !isPost(r.body.post)) return failOf(r);
      return { ok: true, value: r.body.post };
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
