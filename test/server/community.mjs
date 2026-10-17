/**
 * 커뮤니티(여행 글) 서비스(WP2 소유, 2026-10-10). 앱 사용자 전체가 같은 피드를 본다(서버 저장).
 * sync-server.mjs가 /community/… 요청을 여기로 넘긴다. 저장소는 둘이다(결과 모양이 같다).
 * - 메모리(createMemoryCommunityStore): DATABASE_URL이 없을 때. 서버를 끄면 사라진다
 * - PostgreSQL(server/db/community-store.mjs): community_posts·community_photos 표(태그는 006_community_tags.sql)
 *
 *   GET  /community/posts?before=<커서>&limit=N&tag=<태그>          → {posts, next}   누구나(Bearer면 mine 표시)
 *   POST /community/posts            Bearer {title,body,tags,photos:[{mime,data}]}     → {post}
 *   POST /community/posts/:id/update Bearer(본인 글만) {title,body,tags,photos:[{id}|{mime,data}]} → {post}
 *   POST /community/posts/:id/delete Bearer(본인 글만)                                → {ok:true}
 *   POST /community/posts/:id/like   Bearer {on:boolean}  → {post}   좋아요(계정당 한 번)·취소
 *   POST /community/posts/:id/view   누구나                → {views}   조회수(같은 사람은 하루 한 번, 본인 글은 안 센다)
 *   GET  /community/media/:photoId   → 사진 원본(image/jpeg·png·webp, 오래 캐시)
 *
 * 규칙
 * - 글쓰기·지우기는 로그인한 계정만(게스트는 서버 계정이 없다). 읽기와 사진은 로그인 없이 열린다.
 * - 사진은 종류별 파일 머리글(JPEG·PNG·WebP)을 직접 본다. 앱이 보낸 mime 값은 믿지 않는다. 글당 4장, 장당 1.5MB.
 * - 글은 한 가지다(2026-10-11, 사진 글·일기 글을 합침): 본문이 있거나 사진이 한 장 이상이면 된다. 제목(선택) 60자, 본문 4000자.
 *   저장하는 kind는 서버가 정한다(사진이 있으면 photo, 없으면 diary). 앱이 보낸 kind는 보지 않는다(예전 앱 호환).
 *   응답과 ?kind= 거르기는 예전 앱을 위해 남겨 둔다. 지금 앱은 쓰지 않는다.
 * - 태그는 글당 5개, 한 개 12자. 앞의 '#'과 띄어쓰기를 떼고 영문은 소문자로 바꾼 뒤 한글·영문·숫자·_만 받는다(normalizeTag,
 *   앱 src/core/community/tags.ts와 같은 규칙). 같은 태그는 하나로 합치고 순서는 둔다. ?tag=는 같은 규칙으로 맞춘 뒤 거르고, 틀리면 400.
 * - 한 계정은 한 시간에 20개까지 올린다(RATE_LIMIT). 넘으면 429.
 * - 글 고치기(2026-10-17): 본인 글만(남의 글·없는 글은 지우기처럼 404). 본문 모양은 올리기와 같고, photos에는 남길 예전 사진({id}, 그 글의
 *   사진만)과 새 사진({mime,data})을 섞어 보낸 순서대로 둔다. 검사·한도는 올리기와 같다(남긴 사진도 4장에 센다). kind는 다시 정하고,
 *   빠진 사진은 지우고, editedAt(고친 시각)을 둔다. 올린 시각(createdAt)과 피드 순서는 그대로다(마이그레이션 008_community_edited.sql).
 *   고치기는 한 계정이 한 시간에 60번까지다(EDIT_LIMIT, 올리기 20개와 따로 센다. 서버 메모리에서 세므로 서버를 다시 켜면 처음부터).
 * - 계정이 탈퇴하면 그 계정의 글과 사진을 지운다(removeByAccount, auth의 onAccountRemoved가 부른다).
 * - 닉네임은 글을 쓸 때의 값을 글에 둔다(나중에 바꿔도 예전 글은 그대로다).
 */
import { createHash, randomBytes } from 'node:crypto';

export const KINDS = Object.freeze(['photo', 'diary']);
export const TITLE_MAX = 60;
export const BODY_MAX = 4000;
export const PHOTOS_MAX = 4;
export const PHOTO_BYTES_MAX = 1_500_000;
/** 검색어 최대 길이 */
export const SEARCH_MAX = 30;
export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 50;
export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
/** 한 계정이 한 시간(RATE_WINDOW_MS)에 글을 고칠 수 있는 횟수(올리기 RATE_LIMIT와 따로 센다) */
export const EDIT_LIMIT = 60;
/** 글 하나를 올리는 요청 본문 상한(base64 사진 4장 + 글) */
export const POST_BODY_MAX = 10 * 1024 * 1024;
/** 글당 태그 수와 태그 한 개 글자 수(앱 src/core/community/tags.ts와 같은 값) */
export const TAGS_MAX = 5;
export const TAG_LEN_MAX = 12;

const TAG_CHARS = /^[\p{L}\p{Nd}_]+$/u;

/**
 * 태그 하나를 맞춘다. 앞뒤 공백·앞의 '#'(여러 개)·가운데 띄어쓰기를 떼고, NFC로 맞추고, 영문은 소문자로 바꾼다.
 * 한글·영문(글자)·숫자·_만, 1~12자면 맞춘 값을, 아니면 null. 앱 normalizeTag와 같은 규칙이다.
 */
export function normalizeTag(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.normalize('NFC').trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
  if (t.length === 0 || [...t].length > TAG_LEN_MAX || !TAG_CHARS.test(t)) return null;
  return t;
}

/** 요청의 tags → 맞춘 태그 목록(겹치면 하나, 순서 유지). 없으면 []. 틀린 값이 있으면 {error, detail} */
export function parseTags(raw) {
  if (raw == null) return { tags: [] };
  if (!Array.isArray(raw)) return { error: 'badPost', detail: '태그 값이 올바르지 않습니다' };
  if (raw.length > TAGS_MAX * 4) return { error: 'badPost', detail: `태그는 ${TAGS_MAX}개까지입니다` };
  const tags = [];
  for (const r of raw) {
    const t = normalizeTag(r);
    if (!t) return { error: 'badPost', detail: `태그는 한글·영문·숫자·_로 ${TAG_LEN_MAX}자까지입니다` };
    if (!tags.includes(t)) tags.push(t);
  }
  if (tags.length > TAGS_MAX) return { error: 'badPost', detail: `태그는 ${TAGS_MAX}개까지입니다` };
  return { tags };
}

const newId = (prefix) => `${prefix}-${randomBytes(12).toString('base64url')}`;

/** 파일 머리글로 이미지 종류를 알아낸다. 모르면 null */
export function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** 새 사진 한 장(base64) → {id, mime, bytes}. 틀리면 {error, detail} */
function parseNewPhoto(p) {
  if (!p || typeof p.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) {
    return { error: 'badPost', detail: '사진 값이 올바르지 않습니다' };
  }
  const bytes = Buffer.from(p.data, 'base64');
  if (bytes.length === 0 || bytes.length > PHOTO_BYTES_MAX) {
    return { error: 'badPost', detail: `사진은 한 장에 ${Math.floor(PHOTO_BYTES_MAX / 1_000_000 * 10) / 10}MB까지입니다` };
  }
  const mime = sniffImage(bytes);
  if (!mime) return { error: 'badPost', detail: 'JPEG·PNG·WebP 사진만 올릴 수 있습니다' };
  return { id: newId('cph'), mime, bytes };
}

/**
 * 올리기·고치기 공통 검사. keepable은 남길 수 있는 예전 사진(고치기에서 그 글의 사진 {id, mime}), 올리기면 빈 목록이라
 * {id}만 있는 사진은 틀린 값이 된다. photos는 보낸 순서대로 {id, mime, bytes?}(bytes가 있으면 새 사진).
 */
function parseInput(body, keepable) {
  if (!body || typeof body !== 'object') return { error: 'badPost', detail: '글을 읽지 못했습니다' };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (title.length > TITLE_MAX) return { error: 'badPost', detail: `제목은 ${TITLE_MAX}자까지입니다` };
  if (text.length > BODY_MAX) return { error: 'badPost', detail: `본문은 ${BODY_MAX}자까지입니다` };
  const list = Array.isArray(body.photos) ? body.photos : [];
  if (list.length > PHOTOS_MAX) return { error: 'badPost', detail: `사진은 ${PHOTOS_MAX}장까지입니다` };
  const photos = [];
  for (const p of list) {
    if (p && typeof p === 'object' && p.data === undefined && typeof p.id === 'string') {
      const old = keepable.find((k) => k.id === p.id);
      if (!old || photos.some((x) => x.id === p.id)) return { error: 'badPost', detail: '사진 값이 올바르지 않습니다' };
      photos.push({ id: old.id, mime: old.mime });
      continue;
    }
    const fresh = parseNewPhoto(p);
    if ('error' in fresh) return fresh;
    photos.push(fresh);
  }
  const tagged = parseTags(body.tags);
  if ('error' in tagged) return tagged;
  if (text.length === 0 && photos.length === 0) return { error: 'badPost', detail: '사진을 고르거나 내용을 적어 주세요' };
  return { kind: photos.length > 0 ? 'photo' : 'diary', title, body: text, tags: tagged.tags, photos };
}

/**
 * 요청 본문 → 검사한 글. 문제가 있으면 {error, detail}.
 * kind는 받지 않고 사진 유무로 정한다(사진이 있으면 photo, 없으면 diary. 표의 CHECK와 예전 앱 응답 모양을 지킨다).
 */
export function parsePostInput(body) {
  return parseInput(body, []);
}

/**
 * 고치기 요청 본문 → 검사한 글. existing은 그 글의 지금 사진({id, mime}). photos의 {id}는 그중에서만 남길 수 있다.
 * 결과 photos는 보낸 순서대로이고, 새 사진만 bytes가 있다.
 */
export function parsePostUpdate(body, existing) {
  return parseInput(body, existing ?? []);
}

/** 저장소 글 → 응답 글. 사진 원본은 싣지 않고 주소만 */
export function publicPost(rec, viewerAccountId, liked = false) {
  return {
    id: rec.id,
    kind: rec.kind,
    title: rec.title,
    body: rec.body,
    tags: [...(rec.tags ?? [])],
    authorId: rec.userId,
    authorNickname: rec.nickname,
    createdAt: rec.createdAt,
    editedAt: rec.editedAt ?? null,
    photos: rec.photos.map((p) => ({ id: p.id, url: `/community/media/${p.id}` })),
    mine: viewerAccountId != null && rec.accountId === viewerAccountId,
    views: rec.views ?? 0,
    likes: rec.likes ?? 0,
    liked: liked === true,
  };
}

/** 커서 'ms:id' ↔ {createdAt, id} */
/**
 * 검색어(제목·태그만 본다) 맞추기: 앞뒤 공백을 떼고 안쪽 공백은 하나로 모은다. 비면 null, SEARCH_MAX를 넘으면 'long'.
 * 앱 core/community/search.ts와 같은 규칙이다(테스트가 같은 값을 확인한다).
 */
export function normalizeSearch(raw) {
  const q = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (q.length === 0) return null;
  return q.length > SEARCH_MAX ? 'long' : q;
}

/** 검색어 → 태그 쪽 비교 값: '#' 앞을 떼고 공백을 없애고 영문은 소문자. 비면 null(제목만 본다) */
export function searchTagPart(q) {
  const t = q.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
  return t.length > 0 ? t : null;
}

/** 글이 검색어에 맞는지: 제목에 들어 있거나(대소문자 무시) 태그 중 하나에 들어 있다 */
export function matchesSearch(post, q) {
  if (post.title.toLowerCase().includes(q.toLowerCase())) return true;
  const t = searchTagPart(q);
  return t != null && post.tags.some((x) => x.includes(t));
}

export function parseCursor(raw) {
  const m = /^(\d{1,15}):([\w-]{1,100})$/.exec(String(raw ?? ''));
  return m ? { createdAt: Number(m[1]), id: m[2] } : null;
}
export const cursorOf = (rec) => `${rec.createdAt}:${rec.id}`;

/** 메모리 저장소. PostgreSQL 저장소(db/community-store.mjs)와 같은 메서드·같은 결과 모양 */
export function createMemoryCommunityStore() {
  /** @type {Map<string, any>} */
  const posts = new Map();
  /** @type {Map<string, {mime:string, bytes:Buffer}>} */
  const photos = new Map();
  /** 좋아요 '글\0계정', 조회 '글\0보는사람\0날짜' */
  const likeSet = new Set();
  const viewSet = new Set();
  const order = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  return {
    kind: 'memory',
    async insertPost(rec) {
      posts.set(rec.id, { ...rec, views: 0, likes: 0, tags: [...(rec.tags ?? [])], photos: rec.photos.map((p) => ({ id: p.id, mime: p.mime })) });
      for (const p of rec.photos) photos.set(p.id, { mime: p.mime, bytes: p.bytes });
    },
    async getPost(id) {
      const p = posts.get(id);
      return p ? { ...p, tags: [...p.tags], photos: p.photos.map((x) => ({ ...x })) } : null;
    },
    async updatePost(id, accountId, patch) {
      const p = posts.get(id);
      if (!p || p.accountId !== accountId) return null;
      const keep = new Set(patch.photos.map((x) => x.id));
      for (const x of p.photos) if (!keep.has(x.id)) photos.delete(x.id);
      for (const x of patch.photos) if (x.bytes) photos.set(x.id, { mime: x.mime, bytes: x.bytes });
      const next = {
        ...p,
        kind: patch.kind,
        title: patch.title,
        body: patch.body,
        tags: [...patch.tags],
        editedAt: patch.editedAt,
        photos: patch.photos.map((x) => ({ id: x.id, mime: x.mime })),
      };
      posts.set(id, next);
      return { ...next, tags: [...next.tags], photos: next.photos.map((x) => ({ ...x })) };
    },
    async list({ before, limit, kind, tag, q }) {
      let all = [...posts.values()].sort(order);
      if (kind) all = all.filter((p) => p.kind === kind);
      if (tag) all = all.filter((p) => p.tags.includes(tag));
      if (q) all = all.filter((p) => matchesSearch(p, q));
      if (before) all = all.filter((p) => p.createdAt < before.createdAt || (p.createdAt === before.createdAt && p.id < before.id));
      return all.slice(0, limit).map((p) => ({ ...p, tags: [...p.tags], photos: p.photos.map((x) => ({ ...x })) }));
    },
    async likedSet(accountId, ids) {
      return new Set(ids.filter((id) => likeSet.has(`${id}\u0000${accountId}`)));
    },
    async setLike(id, accountId, on) {
      const p = posts.get(id);
      if (!p) return null;
      const k = `${id}\u0000${accountId}`;
      if (on && !likeSet.has(k)) {
        likeSet.add(k);
        p.likes += 1;
      } else if (!on && likeSet.has(k)) {
        likeSet.delete(k);
        p.likes -= 1;
      }
      return { ...p, tags: [...p.tags], photos: p.photos.map((x) => ({ ...x })) };
    },
    async countView(id, viewerKey, day) {
      const p = posts.get(id);
      if (!p) return null;
      const k = `${id}\u0000${viewerKey}\u0000${day}`;
      if (!viewSet.has(k)) {
        viewSet.add(k);
        p.views += 1;
      }
      return p.views;
    },
    async removePost(id, accountId) {
      const p = posts.get(id);
      if (!p || p.accountId !== accountId) return false;
      for (const x of p.photos) photos.delete(x.id);
      posts.delete(id);
      for (const k of [...likeSet]) if (k.startsWith(`${id}\u0000`)) likeSet.delete(k);
      return true;
    },
    async removeByAccount(accountId) {
      let n = 0;
      // 이 계정이 남의 글에 누른 좋아요를 돌려놓는다
      for (const k of [...likeSet]) {
        if (k.endsWith(`\u0000${accountId}`)) {
          likeSet.delete(k);
          const p = posts.get(k.split('\u0000')[0]);
          if (p) p.likes -= 1;
        }
      }
      for (const p of [...posts.values()]) {
        if (p.accountId !== accountId) continue;
        for (const x of p.photos) photos.delete(x.id);
        posts.delete(p.id);
        n += 1;
      }
      return n;
    },
    async photo(id) {
      const p = photos.get(id);
      return p ? { mime: p.mime, bytes: Buffer.from(p.bytes) } : null;
    },
    async countSince(accountId, since) {
      let n = 0;
      for (const p of posts.values()) if (p.accountId === accountId && p.createdAt >= since) n += 1;
      return n;
    },
    async reset() {
      posts.clear();
      photos.clear();
      likeSet.clear();
      viewSet.clear();
    },
  };
}

/**
 * 커뮤니티 서비스. authenticate(headers) → {account} | null (auth 서비스의 Bearer 판정).
 * handle은 {status, body} 또는 사진이면 {status, raw:{mime, bytes}}를 돌려준다.
 */
export function createCommunityService({ store = createMemoryCommunityStore(), authenticate = async () => null, now = () => Date.now(), log = () => {} } = {}) {
  const fail = (status, error, detail) => ({ status, body: { error, ...(detail ? { detail } : {}) } });
  /** 계정별 고친 시각들(한 시간 창). 올리기 제한과 따로 센다 */
  const edits = new Map();
  const editsSince = (accountId, since) => {
    const list = (edits.get(accountId) ?? []).filter((t) => t >= since);
    if (list.length > 0) edits.set(accountId, list);
    else edits.delete(accountId);
    return list.length;
  };

  async function viewer(headers) {
    try {
      return (await authenticate(headers))?.account ?? null;
    } catch (e) {
      log(`커뮤니티 로그인 확인 실패: ${e?.message ?? e}`);
      return null;
    }
  }

  const routes = {
    async 'GET posts'({ url, headers }) {
      const kind = url.searchParams.get('kind');
      if (kind && !KINDS.includes(kind)) return fail(400, 'badRequest', '글 종류가 올바르지 않습니다');
      const rawTag = url.searchParams.get('tag');
      const tag = rawTag ? normalizeTag(rawTag) : null;
      if (rawTag && !tag) return fail(400, 'badRequest', '태그가 올바르지 않습니다');
      const rawQ = url.searchParams.get('q');
      const q = rawQ == null ? null : normalizeSearch(rawQ);
      if (q === 'long') return fail(400, 'badRequest', `검색어는 ${SEARCH_MAX}자까지입니다`);
      const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('limit') ?? PAGE_DEFAULT) || PAGE_DEFAULT));
      const before = url.searchParams.get('before') ? parseCursor(url.searchParams.get('before')) : null;
      if (url.searchParams.get('before') && !before) return fail(400, 'badRequest', '다음 쪽 표시가 올바르지 않습니다');
      const acc = await viewer(headers);
      const rows = await store.list({ before, limit: limit + 1, kind: kind || null, tag, q });
      const page = rows.slice(0, limit);
      const liked = acc ? await store.likedSet(acc.accountId, page.map((r) => r.id)) : new Set();
      return {
        status: 200,
        body: { posts: page.map((r) => publicPost(r, acc?.accountId, liked.has(r.id))), next: rows.length > limit ? cursorOf(page[page.length - 1]) : null },
      };
    },

    async 'POST posts'({ body, headers }) {
      const acc = await viewer(headers);
      if (!acc) return fail(401, 'loginRequired', '로그인하면 글을 올릴 수 있어요');
      const input = parsePostInput(body);
      if ('error' in input) return fail(400, input.error, input.detail);
      const at = now();
      if ((await store.countSince(acc.accountId, at - RATE_WINDOW_MS)) >= RATE_LIMIT) {
        return fail(429, 'tooMany', '한 시간에 올릴 수 있는 글을 넘었어요. 잠시 뒤 다시 시도해 주세요');
      }
      const rec = {
        id: newId('cmt'),
        accountId: acc.accountId,
        userId: acc.userId,
        nickname: acc.nickname || '여행자',
        kind: input.kind,
        title: input.title,
        body: input.body,
        tags: input.tags,
        createdAt: at,
        photos: input.photos,
      };
      await store.insertPost(rec);
      return { status: 200, body: { post: publicPost(rec, acc.accountId) } };
    },

    async 'POST posts/update'({ id, body, headers }) {
      const acc = await viewer(headers);
      if (!acc) return fail(401, 'loginRequired', '로그인하면 글을 고칠 수 있어요');
      const cur = await store.getPost(id);
      if (!cur || cur.accountId !== acc.accountId) return fail(404, 'notFound', '내 글을 찾지 못했습니다');
      const input = parsePostUpdate(body, cur.photos);
      if ('error' in input) return fail(400, input.error, input.detail);
      const at = now();
      if (editsSince(acc.accountId, at - RATE_WINDOW_MS) >= EDIT_LIMIT) {
        return fail(429, 'tooMany', '한 시간에 고칠 수 있는 횟수를 넘었어요. 잠시 뒤 다시 시도해 주세요');
      }
      const rec = await store.updatePost(id, acc.accountId, {
        kind: input.kind,
        title: input.title,
        body: input.body,
        tags: input.tags,
        editedAt: at,
        photos: input.photos,
      });
      if (!rec) return fail(404, 'notFound', '내 글을 찾지 못했습니다');
      edits.set(acc.accountId, [...(edits.get(acc.accountId) ?? []), at]);
      return { status: 200, body: { post: publicPost(rec, acc.accountId) } };
    },

    async 'POST posts/delete'({ id, headers }) {
      const acc = await viewer(headers);
      if (!acc) return fail(401, 'loginRequired', '로그인이 필요해요');
      return (await store.removePost(id, acc.accountId)) ? { status: 200, body: { ok: true } } : fail(404, 'notFound', '내 글을 찾지 못했습니다');
    },

    async 'POST posts/like'({ id, body, headers }) {
      const acc = await viewer(headers);
      if (!acc) return fail(401, 'loginRequired', '로그인하면 좋아요를 누를 수 있어요');
      if (typeof body?.on !== 'boolean') return fail(400, 'badRequest', '요청이 올바르지 않습니다');
      const rec = await store.setLike(id, acc.accountId, body.on);
      if (!rec) return fail(404, 'notFound', '글을 찾지 못했습니다');
      return { status: 200, body: { post: publicPost(rec, acc.accountId, body.on) } };
    },

    async 'POST posts/view'({ id, headers, ip }) {
      const acc = await viewer(headers);
      const rec = await store.getPost(id);
      if (!rec) return fail(404, 'notFound', '글을 찾지 못했습니다');
      // 본인 글 조회는 세지 않는다
      if (acc && rec.accountId === acc.accountId) return { status: 200, body: { views: rec.views ?? 0 } };
      const key = acc ? `a:${acc.accountId}` : `i:${createHash('sha256').update(String(ip ?? '')).digest('hex').slice(0, 16)}`;
      const views = await store.countView(id, key, new Date(now()).toISOString().slice(0, 10));
      return { status: 200, body: { views: views ?? rec.views ?? 0 } };
    },

    async 'GET media'({ id }) {
      const p = await store.photo(id);
      return p ? { status: 200, raw: p } : fail(404, 'notFound');
    },
  };

  return {
    /** path는 '/community/' 뒤(예: 'posts', 'posts/cmt-…/update', 'posts/cmt-…/delete', 'media/cph-…') */
    async handle({ method, path, url, headers, body, ip }) {
      const parts = String(path).split('/').filter(Boolean);
      try {
        if (parts[0] === 'posts' && parts.length === 1) {
          const r = routes[`${method} posts`];
          return r ? await r({ url, headers, body }) : fail(404, 'notFound');
        }
        if (parts[0] === 'posts' && parts.length === 3 && parts[2] === 'delete' && method === 'POST') {
          return await routes['POST posts/delete']({ id: parts[1], headers });
        }
        if (parts[0] === 'posts' && parts.length === 3 && parts[2] === 'update' && method === 'POST') {
          return await routes['POST posts/update']({ id: parts[1], body, headers });
        }
        if (parts[0] === 'posts' && parts.length === 3 && parts[2] === 'like' && method === 'POST') {
          return await routes['POST posts/like']({ id: parts[1], body, headers });
        }
        if (parts[0] === 'posts' && parts.length === 3 && parts[2] === 'view' && method === 'POST') {
          return await routes['POST posts/view']({ id: parts[1], headers, ip });
        }
        if (parts[0] === 'media' && parts.length === 2 && method === 'GET') return await routes['GET media']({ id: parts[1] });
        return fail(404, 'notFound');
      } catch (e) {
        log(`커뮤니티 처리 실패(${method} /community/${path}): ${e?.message ?? e}`);
        return fail(500, 'serverError');
      }
    },
    /** 시연 리셋: 모든 글과 사진을 지운다 */
    async reset() {
      edits.clear();
      await store.reset();
    },
    /** 계정 탈퇴: 그 계정의 글과 사진을 지운다 */
    async removeByAccount(accountId) {
      return store.removeByAccount(accountId);
    },
  };
}

export function isCommunityPath(pathname) {
  return pathname === '/community' || pathname.startsWith('/community/');
}
