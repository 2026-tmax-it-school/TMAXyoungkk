/**
 * 공유한 여행 일정 서비스(WP2 소유, 2026-10-17). 앱 사용자가 자기 일정을 올리면 다른 사람이 둘러보고(조회수·좋아요·가져온 수로
 * 인기순) '이 일정으로 여행방 만들기'로 가져온다. 올리는 것은 장소와 날짜별 순서뿐이다(채팅·사진·멤버·위치 기록 없음).
 *
 *   GET  /itineraries?sort=popular|new|views&q=&region=&tag=&offset=&limit=   → {items, next}   누구나(Bearer면 mine·liked 표시)
 *   GET  /itineraries/:id                                                   → {item}(plan 포함) 조회수 +1(사람·하루 한 번)
 *   POST /itineraries            Bearer {title,regionId,regionLabel,note,tags,days:[{title,places:[…]}]} → {item}
 *   POST /itineraries/:id/like   Bearer {on}                                → {item}
 *   POST /itineraries/:id/import                                            → {ok} 가져온 수 +1
 *   POST /itineraries/:id/delete Bearer(본인 것만)                           → {ok}
 *
 * 인기 점수 = 가져온 수 × 5 + 좋아요 × 3 + 조회수. 같으면 최신이 위다. 올리기는 계정당 한 시간에 10개까지.
 * 계정이 탈퇴하면 그 계정이 올린 일정과 좋아요가 지워진다(removeByAccount).
 */
import { randomBytes, createHash } from 'node:crypto';

import { normalizeTag, parseTags } from './community.mjs';

export const TITLE_MAX = 60;
export const NOTE_MAX = 300;
export const DAYS_MAX = 7;
export const PLACES_PER_DAY_MAX = 10;
export const PLACE_NAME_MAX = 40;
export const SEARCH_MAX = 30;
export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 50;
export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const BODY_MAX = 256 * 1024;
export const CATEGORIES = Object.freeze(['식당', '카페', '관광지', '쇼핑', '공원', '기타']);
export const SORTS = Object.freeze(['popular', 'new', 'views']);

const newId = () => `itn-${randomBytes(12).toString('base64url')}`;
const clampText = (v, max) => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const inKorea = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 32.5 && lat < 39.5 && lng > 123.5 && lng < 132.5;

/** 인기 점수 */
export function popularity(it) {
  return it.imports * 5 + it.likes * 3 + it.views;
}

/** 요청 본문 → 검사한 일정. 문제가 있으면 {error, detail} */
export function parseItineraryInput(body) {
  if (!body || typeof body !== 'object') return { error: 'badItinerary', detail: '일정을 읽지 못했습니다' };
  const title = clampText(body.title, TITLE_MAX + 1);
  if (title.length === 0) return { error: 'badItinerary', detail: '일정 이름을 입력해 주세요' };
  if (title.length > TITLE_MAX) return { error: 'badItinerary', detail: `일정 이름은 ${TITLE_MAX}자까지입니다` };
  const regionId = clampText(body.regionId, 200);
  if (!regionId) return { error: 'badItinerary', detail: '지역이 없습니다' };
  const note = clampText(body.note, NOTE_MAX + 1);
  if (note.length > NOTE_MAX) return { error: 'badItinerary', detail: `소개는 ${NOTE_MAX}자까지입니다` };
  const parsed = parseTags(body.tags);
  if ('error' in parsed) return { error: 'badItinerary', detail: parsed.detail };
  const tags = parsed.tags;
  if (!Array.isArray(body.days) || body.days.length === 0) return { error: 'badItinerary', detail: '날짜별 장소가 없습니다' };
  if (body.days.length > DAYS_MAX) return { error: 'badItinerary', detail: `일정은 ${DAYS_MAX}일까지 올릴 수 있습니다` };
  const days = [];
  let placeCount = 0;
  for (const d of body.days) {
    if (!d || !Array.isArray(d.places)) return { error: 'badItinerary', detail: '날짜별 장소가 올바르지 않습니다' };
    if (d.places.length > PLACES_PER_DAY_MAX) return { error: 'badItinerary', detail: `하루는 ${PLACES_PER_DAY_MAX}곳까지입니다` };
    const places = [];
    for (const p of d.places) {
      const name = clampText(p?.name, PLACE_NAME_MAX + 1);
      const lat = Number(p?.coord?.latitude);
      const lng = Number(p?.coord?.longitude);
      if (!name || name.length > PLACE_NAME_MAX) return { error: 'badItinerary', detail: '장소 이름이 올바르지 않습니다' };
      if (!inKorea(lat, lng)) return { error: 'badItinerary', detail: '장소 좌표가 올바르지 않습니다' };
      places.push({
        name,
        category: CATEGORIES.includes(p.category) ? p.category : '기타',
        kind: clampText(p.kind, 30),
        address: clampText(p.address, 80),
        coord: { latitude: Math.round(lat * 1e5) / 1e5, longitude: Math.round(lng * 1e5) / 1e5 },
        note: clampText(p.note, 80),
      });
    }
    placeCount += places.length;
    days.push({ title: clampText(d.title, 40), places });
  }
  if (placeCount === 0) return { error: 'badItinerary', detail: '장소를 한 곳 이상 담아 주세요' };
  let base = null;
  const b = body.base;
  if (b && typeof b === 'object' && clampText(b.name, 40) && inKorea(Number(b.coord?.latitude), Number(b.coord?.longitude))) {
    base = {
      name: clampText(b.name, 40),
      address: clampText(b.address, 80),
      coord: { latitude: Math.round(Number(b.coord.latitude) * 1e5) / 1e5, longitude: Math.round(Number(b.coord.longitude) * 1e5) / 1e5 },
    };
  }
  return { title, regionId, regionLabel: clampText(body.regionLabel, 40), note, tags, days, base, placeCount };
}

/** 저장소 일정 → 응답. detail이면 plan(날짜별 장소)까지 */
export function publicItinerary(rec, viewerAccountId, liked, detail) {
  return {
    id: rec.id,
    title: rec.title,
    regionId: rec.regionId,
    regionLabel: rec.regionLabel,
    note: rec.note,
    tags: rec.tags,
    dayCount: rec.dayCount,
    placeCount: rec.placeCount,
    authorId: rec.userId,
    authorNickname: rec.nickname,
    createdAt: rec.createdAt,
    views: rec.views,
    likes: rec.likes,
    imports: rec.imports,
    score: popularity(rec),
    mine: viewerAccountId != null && rec.accountId === viewerAccountId,
    liked: !!liked,
    ...(detail ? { days: rec.plan.days, base: rec.plan.base } : {}),
  };
}

export function normalizeQuery(raw) {
  const q = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (q.length === 0) return null;
  return q.length > SEARCH_MAX ? 'long' : q;
}

/** 제목·태그·지역 이름에 들어 있는지(대소문자 무시, # 앞은 뗀다) */
export function matches(rec, q) {
  const l = q.toLowerCase();
  if (rec.title.toLowerCase().includes(l) || rec.regionLabel.toLowerCase().includes(l)) return true;
  const t = q.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
  return t.length > 0 && rec.tags.some((x) => x.includes(t));
}

const cmp = {
  popular: (a, b) => popularity(b) - popularity(a) || b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
  new: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
  views: (a, b) => b.views - a.views || b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
};

/** 메모리 저장소. PostgreSQL 저장소(db/itinerary-store.mjs)와 같은 메서드·결과 */
export function createMemoryItineraryStore() {
  const items = new Map();
  const likes = new Set();
  const views = new Set();
  const lk = (id, acc) => `${id}\u0000${acc}`;
  return {
    kind: 'memory',
    async insert(rec) {
      items.set(rec.id, { ...rec, views: 0, likes: 0, imports: 0 });
    },
    async get(id) {
      const r = items.get(id);
      return r ? { ...r } : null;
    },
    async list({ sort, q, region, tag, offset, limit }) {
      let all = [...items.values()];
      if (region) all = all.filter((r) => r.regionId === region);
      if (tag) all = all.filter((r) => r.tags.includes(tag));
      if (q) all = all.filter((r) => matches(r, q));
      all.sort(cmp[sort] ?? cmp.popular);
      return all.slice(offset, offset + limit).map((r) => ({ ...r }));
    },
    async likedSet(accountId, ids) {
      return new Set(ids.filter((id) => likes.has(lk(id, accountId))));
    },
    async setLike(id, accountId, on) {
      const r = items.get(id);
      if (!r) return null;
      const k = lk(id, accountId);
      if (on && !likes.has(k)) {
        likes.add(k);
        r.likes += 1;
      } else if (!on && likes.has(k)) {
        likes.delete(k);
        r.likes -= 1;
      }
      return { ...r };
    },
    async countView(id, viewerKey, day) {
      const r = items.get(id);
      if (!r) return null;
      const k = `${id}\u0000${viewerKey}\u0000${day}`;
      if (!views.has(k)) {
        views.add(k);
        r.views += 1;
      }
      return { ...r };
    },
    async countImport(id) {
      const r = items.get(id);
      if (!r) return null;
      r.imports += 1;
      return { ...r };
    },
    async remove(id, accountId) {
      const r = items.get(id);
      if (!r || r.accountId !== accountId) return false;
      items.delete(id);
      for (const k of [...likes]) if (k.startsWith(`${id}\u0000`)) likes.delete(k);
      return true;
    },
    async removeByAccount(accountId) {
      let n = 0;
      for (const r of [...items.values()]) {
        if (r.accountId === accountId) {
          items.delete(r.id);
          n += 1;
        }
      }
      // 이 계정이 누른 좋아요도 지운다
      for (const k of [...likes]) {
        if (k.endsWith(`\u0000${accountId}`)) {
          const id = k.split('\u0000')[0];
          likes.delete(k);
          const r = items.get(id);
          if (r) r.likes -= 1;
        }
      }
      return n;
    },
    async countSince(accountId, since) {
      let n = 0;
      for (const r of items.values()) if (r.accountId === accountId && r.createdAt >= since) n += 1;
      return n;
    },
    async reset() {
      items.clear();
      likes.clear();
      views.clear();
    },
  };
}

const viewerKeyOf = (acc, ip) => (acc ? `a:${acc.accountId}` : `i:${createHash('sha256').update(String(ip ?? '')).digest('hex').slice(0, 16)}`);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createItineraryService({ store = createMemoryItineraryStore(), authenticate = async () => null, now = () => Date.now(), log = () => {} } = {}) {
  const fail = (status, error, detail) => ({ status, body: { error, ...(detail ? { detail } : {}) } });
  async function viewer(headers) {
    try {
      return (await authenticate(headers))?.account ?? null;
    } catch (e) {
      log(`일정 로그인 확인 실패: ${e?.message ?? e}`);
      return null;
    }
  }

  return {
    async handle({ method, path, url, headers, body, ip }) {
      const parts = String(path).split('/').filter(Boolean);
      try {
        if (parts.length === 0 && method === 'GET') {
          const sort = url.searchParams.get('sort') ?? 'popular';
          if (!SORTS.includes(sort)) return fail(400, 'badRequest', '정렬이 올바르지 않습니다');
          const rawQ = url.searchParams.get('q');
          const q = rawQ == null ? null : normalizeQuery(rawQ);
          if (q === 'long') return fail(400, 'badRequest', `검색어는 ${SEARCH_MAX}자까지입니다`);
          const rawTag = url.searchParams.get('tag');
          const tag = rawTag ? normalizeTag(rawTag) : null;
          if (rawTag && !tag) return fail(400, 'badRequest', '태그가 올바르지 않습니다');
          const region = url.searchParams.get('region') || null;
          const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('limit') ?? PAGE_DEFAULT) || PAGE_DEFAULT));
          const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get('offset') ?? 0) || 0));
          const acc = await viewer(headers);
          const rows = await store.list({ sort, q, region, tag, offset, limit: limit + 1 });
          const page = rows.slice(0, limit);
          const liked = acc ? await store.likedSet(acc.accountId, page.map((r) => r.id)) : new Set();
          return {
            status: 200,
            body: { items: page.map((r) => publicItinerary(r, acc?.accountId, liked.has(r.id), false)), next: rows.length > limit ? offset + limit : null },
          };
        }
        if (parts.length === 0 && method === 'POST') {
          const acc = await viewer(headers);
          if (!acc) return fail(401, 'loginRequired', '로그인하면 일정을 공유할 수 있어요');
          const input = parseItineraryInput(body);
          if ('error' in input) return fail(400, input.error, input.detail);
          const at = now();
          if ((await store.countSince(acc.accountId, at - RATE_WINDOW_MS)) >= RATE_LIMIT) {
            return fail(429, 'tooMany', '한 시간에 공유할 수 있는 일정을 넘었어요. 잠시 뒤 다시 시도해 주세요');
          }
          const rec = {
            id: newId(),
            accountId: acc.accountId,
            userId: acc.userId,
            nickname: acc.nickname || '여행자',
            title: input.title,
            regionId: input.regionId,
            regionLabel: input.regionLabel,
            note: input.note,
            tags: input.tags,
            dayCount: input.days.length,
            placeCount: input.placeCount,
            plan: { days: input.days, base: input.base },
            createdAt: at,
          };
          await store.insert(rec);
          const saved = await store.get(rec.id);
          return { status: 200, body: { item: publicItinerary(saved, acc.accountId, false, true) } };
        }
        const id = parts[0];
        if (parts.length === 1 && method === 'GET') {
          const acc = await viewer(headers);
          let rec = await store.get(id);
          if (!rec) return fail(404, 'notFound', '일정을 찾지 못했습니다');
          rec = (await store.countView(id, viewerKeyOf(acc, ip), dayOf(now()))) ?? rec;
          const liked = acc ? await store.likedSet(acc.accountId, [id]) : new Set();
          return { status: 200, body: { item: publicItinerary(rec, acc?.accountId, liked.has(id), true) } };
        }
        if (parts.length === 2 && method === 'POST') {
          if (parts[1] === 'import') {
            const rec = await store.countImport(id);
            return rec ? { status: 200, body: { ok: true, imports: rec.imports } } : fail(404, 'notFound', '일정을 찾지 못했습니다');
          }
          const acc = await viewer(headers);
          if (!acc) return fail(401, 'loginRequired', '로그인이 필요해요');
          if (parts[1] === 'like') {
            if (typeof body?.on !== 'boolean') return fail(400, 'badRequest', '요청이 올바르지 않습니다');
            const rec = await store.setLike(id, acc.accountId, body.on);
            if (!rec) return fail(404, 'notFound', '일정을 찾지 못했습니다');
            return { status: 200, body: { item: publicItinerary(rec, acc.accountId, body.on, false) } };
          }
          if (parts[1] === 'delete') {
            return (await store.remove(id, acc.accountId)) ? { status: 200, body: { ok: true } } : fail(404, 'notFound', '내 일정을 찾지 못했습니다');
          }
        }
        return fail(404, 'notFound');
      } catch (e) {
        log(`일정 처리 실패(${method} /itineraries/${path}): ${e?.message ?? e}`);
        return fail(500, 'serverError');
      }
    },
    async reset() {
      await store.reset();
    },
    async removeByAccount(accountId) {
      return store.removeByAccount(accountId);
    },
  };
}

export function isItineraryPath(pathname) {
  return pathname === '/itineraries' || pathname.startsWith('/itineraries/');
}
