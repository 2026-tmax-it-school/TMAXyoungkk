import type { CommunityCtx, FetchLike, ItineraryFail, ItineraryProvider, ItineraryResult, SharedItinerary } from '../../core/ports';

/**
 * 일정 공유 서버 제공자(WP2 소유, 2026-10-17). server/itineraries.mjs(/itineraries/…)와 짝이다.
 * 둘러보기와 가져오기 수는 로그인 없이 되고, 올리기·좋아요·지우기는 계정 서버 Bearer(ctx.token)가 필요하다.
 * 서버에 닿지 못하면 unreachable이다.
 */

const FAILS: readonly ItineraryFail[] = ['loginRequired', 'badItinerary', 'tooMany', 'tooLarge', 'unreachable', 'notFound', 'badRequest'];
const asFail = (c: unknown): ItineraryFail => (FAILS.includes(c as ItineraryFail) ? (c as ItineraryFail) : 'badRequest');

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** 서버 응답 일정 → 앱 일정. 모양이 틀리면 null */
export function toItinerary(v: unknown): SharedItinerary | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p.id !== 'string' || typeof p.title !== 'string') return null;
  return {
    id: p.id,
    title: p.title,
    regionId: str(p.regionId),
    regionLabel: str(p.regionLabel),
    note: str(p.note),
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
    dayCount: num(p.dayCount),
    placeCount: num(p.placeCount),
    authorNickname: str(p.authorNickname) || '여행자',
    createdAt: num(p.createdAt),
    views: num(p.views),
    likes: num(p.likes),
    imports: num(p.imports),
    score: num(p.score),
    mine: p.mine === true,
    liked: p.liked === true,
    ...(Array.isArray(p.days) ? { days: p.days as SharedItinerary['days'] } : {}),
    ...(p.base && typeof p.base === 'object' ? { base: p.base as SharedItinerary['base'] } : {}),
  };
}

export function createHttpItineraries(opts: { url: string; fetch: FetchLike; timeoutMs?: number }): ItineraryProvider {
  const base = opts.url.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 20_000;

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

  const failOf = <T,>(r: { status: number; body: Record<string, unknown> } | null): ItineraryResult<T> => {
    if (!r) return { ok: false, code: 'unreachable' };
    if (r.status === 413) return { ok: false, code: 'tooLarge' };
    return { ok: false, code: asFail(r.body.error), ...(typeof r.body.detail === 'string' ? { detail: r.body.detail } : {}) };
  };
  const one = (r: { status: number; body: Record<string, unknown> } | null): ItineraryResult<SharedItinerary> => {
    const item = r && r.status === 200 ? toItinerary(r.body.item) : null;
    return item ? { ok: true, value: item } : failOf(r);
  };
  const id = (v: string) => encodeURIComponent(v);

  return {
    id: 'server',

    async list(q, ctx: CommunityCtx) {
      const params = new URLSearchParams({ sort: q.sort });
      if (q.q) params.set('q', q.q);
      if (q.region) params.set('region', q.region);
      if (q.offset) params.set('offset', String(q.offset));
      const r = await call(`/itineraries?${params.toString()}`, { token: ctx.token });
      if (!r || r.status !== 200 || !Array.isArray(r.body.items)) return failOf(r);
      return {
        ok: true,
        value: {
          items: (r.body.items as unknown[]).map(toItinerary).filter((x): x is SharedItinerary => x != null),
          next: typeof r.body.next === 'number' ? r.body.next : null,
        },
      };
    },
    async get(itemId, ctx) {
      return one(await call(`/itineraries/${id(itemId)}`, { token: ctx.token }));
    },
    async share(draft, ctx) {
      if (!ctx.token) return { ok: false, code: 'loginRequired' };
      return one(await call('/itineraries', { body: draft, token: ctx.token }));
    },
    async like(itemId, on, ctx) {
      if (!ctx.token) return { ok: false, code: 'loginRequired' };
      return one(await call(`/itineraries/${id(itemId)}/like`, { body: { on }, token: ctx.token }));
    },
    async countImport(itemId, ctx) {
      const r = await call(`/itineraries/${id(itemId)}/import`, { body: {}, token: ctx.token });
      return r && r.status === 200 ? { ok: true, value: true } : failOf(r);
    },
    async remove(itemId, ctx) {
      if (!ctx.token) return { ok: false, code: 'loginRequired' };
      const r = await call(`/itineraries/${id(itemId)}/delete`, { body: {}, token: ctx.token });
      return r && r.status === 200 ? { ok: true, value: true } : failOf(r);
    },
  };
}
