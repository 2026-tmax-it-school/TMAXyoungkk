import type { Clock, IdGen, ItineraryProvider, SharedItinerary } from '../../core/ports';

/**
 * 이 기기 모의 일정 공유(WP2 소유, 2026-10-17). 서버 주소가 없을 때 쓴다. 메모리에만 두므로 앱을 새로 열면 사라진다.
 * 인기 점수·정렬은 서버와 같다(가져오기×5 + 좋아요×3 + 조회). 조회수는 모의라서 열 때마다 한 번만 센다.
 */
export function createLocalItineraries(opts: { clock: Clock; ids: IdGen }): ItineraryProvider {
  const items = new Map<string, SharedItinerary>();
  const owner = new Map<string, string>();
  const likedBy = new Set<string>();
  const viewed = new Set<string>();
  const PAGE = 20;
  const score = (i: SharedItinerary) => i.imports * 5 + i.likes * 3 + i.views;
  const view = (i: SharedItinerary, userId?: string, detail = false): SharedItinerary => {
    const { days, base, ...rest } = i;
    return { ...rest, score: score(i), mine: userId != null && owner.get(i.id) === userId, liked: userId != null && likedBy.has(`${i.id}|${userId}`), ...(detail ? { days, base } : {}) };
  };

  return {
    id: 'local',

    async list(q, ctx) {
      let all = [...items.values()];
      if (q.region) all = all.filter((i) => i.regionId === q.region);
      if (q.q) {
        const l = q.q.toLowerCase();
        const t = l.replace(/^#+/, '').replace(/\s+/g, '');
        all = all.filter((i) => i.title.toLowerCase().includes(l) || i.regionLabel.toLowerCase().includes(l) || (t.length > 0 && i.tags.some((x) => x.includes(t))));
      }
      const by = {
        popular: (a: SharedItinerary, b: SharedItinerary) => score(b) - score(a) || b.createdAt - a.createdAt,
        new: (a: SharedItinerary, b: SharedItinerary) => b.createdAt - a.createdAt,
        views: (a: SharedItinerary, b: SharedItinerary) => b.views - a.views || b.createdAt - a.createdAt,
      }[q.sort];
      all.sort(by);
      const offset = q.offset ?? 0;
      const page = all.slice(offset, offset + PAGE);
      return { ok: true, value: { items: page.map((i) => view(i, ctx.userId)), next: all.length > offset + PAGE ? offset + PAGE : null } };
    },

    async get(id, ctx) {
      const i = items.get(id);
      if (!i) return { ok: false, code: 'notFound' };
      const key = `${id}|${ctx.userId ?? ''}`;
      if (!viewed.has(key)) {
        viewed.add(key);
        i.views += 1;
      }
      return { ok: true, value: view(i, ctx.userId, true) };
    },

    async share(draft, ctx) {
      if (!ctx.userId) return { ok: false, code: 'loginRequired' };
      const placeCount = draft.days.reduce((n, d) => n + d.places.length, 0);
      if (placeCount === 0) return { ok: false, code: 'badItinerary', detail: '장소를 한 곳 이상 담아 주세요' };
      const id = opts.ids.next('itn');
      const item: SharedItinerary = {
        id,
        title: draft.title,
        regionId: draft.regionId,
        regionLabel: draft.regionLabel,
        note: draft.note,
        tags: draft.tags,
        dayCount: draft.days.length,
        placeCount,
        authorNickname: ctx.nickname || '여행자',
        createdAt: opts.clock.now(),
        views: 0,
        likes: 0,
        imports: 0,
        score: 0,
        mine: true,
        liked: false,
        days: draft.days,
        base: draft.base ?? null,
      };
      items.set(id, item);
      owner.set(id, ctx.userId);
      return { ok: true, value: view(item, ctx.userId, true) };
    },

    async like(id, on, ctx) {
      if (!ctx.userId) return { ok: false, code: 'loginRequired' };
      const i = items.get(id);
      if (!i) return { ok: false, code: 'notFound' };
      const key = `${id}|${ctx.userId}`;
      if (on && !likedBy.has(key)) {
        likedBy.add(key);
        i.likes += 1;
      } else if (!on && likedBy.has(key)) {
        likedBy.delete(key);
        i.likes -= 1;
      }
      return { ok: true, value: view(i, ctx.userId) };
    },

    async countImport(id) {
      const i = items.get(id);
      if (!i) return { ok: false, code: 'notFound' };
      i.imports += 1;
      return { ok: true, value: true };
    },

    async remove(id, ctx) {
      if (!ctx.userId || owner.get(id) !== ctx.userId) return { ok: false, code: 'notFound' };
      items.delete(id);
      owner.delete(id);
      return { ok: true, value: true };
    },
  };
}
