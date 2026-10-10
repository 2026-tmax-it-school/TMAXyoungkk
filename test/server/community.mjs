/**
 * 커뮤니티(사진·일기 글) 서비스(WP2 소유, 2026-10-10). 앱 사용자 전체가 같은 피드를 본다(서버 저장).
 * sync-server.mjs가 /community/… 요청을 여기로 넘긴다. 저장소는 둘이다(결과 모양이 같다).
 * - 메모리(createMemoryCommunityStore): DATABASE_URL이 없을 때. 서버를 끄면 사라진다
 * - PostgreSQL(server/db/community-store.mjs): community_posts·community_photos 표
 *
 *   GET  /community/posts?before=<커서>&limit=N&kind=photo|diary   → {posts, next}   누구나(Bearer면 mine 표시)
 *   POST /community/posts            Bearer {kind,title,body,photos:[{mime,data}]}    → {post}
 *   POST /community/posts/:id/delete Bearer(본인 글만)                                → {ok:true}
 *   GET  /community/media/:photoId   → 사진 원본(image/jpeg·png·webp, 오래 캐시)
 *
 * 규칙
 * - 글쓰기·지우기는 로그인한 계정만(게스트는 서버 계정이 없다). 읽기와 사진은 로그인 없이 열린다.
 * - 사진은 종류별 파일 머리글(JPEG·PNG·WebP)을 직접 본다. 앱이 보낸 mime 값은 믿지 않는다. 글당 4장, 장당 1.5MB.
 * - 글 종류 photo는 사진이 한 장 이상, diary는 본문이 있어야 한다. 제목 60자, 본문 4000자.
 * - 한 계정은 한 시간에 20개까지 올린다(RATE_LIMIT). 넘으면 429.
 * - 계정이 탈퇴하면 그 계정의 글과 사진을 지운다(removeByAccount, auth의 onAccountRemoved가 부른다).
 * - 닉네임은 글을 쓸 때의 값을 글에 둔다(나중에 바꿔도 예전 글은 그대로다).
 */
import { randomBytes } from 'node:crypto';

export const KINDS = Object.freeze(['photo', 'diary']);
export const TITLE_MAX = 60;
export const BODY_MAX = 4000;
export const PHOTOS_MAX = 4;
export const PHOTO_BYTES_MAX = 1_500_000;
export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 50;
export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
/** 글 하나를 올리는 요청 본문 상한(base64 사진 4장 + 글) */
export const POST_BODY_MAX = 10 * 1024 * 1024;

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

/** 요청 본문 → 검사한 글. 문제가 있으면 {error, detail} */
export function parsePostInput(body) {
  if (!body || typeof body !== 'object') return { error: 'badPost', detail: '글을 읽지 못했습니다' };
  const kind = body.kind;
  if (!KINDS.includes(kind)) return { error: 'badPost', detail: '글 종류는 사진 또는 일기입니다' };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (title.length > TITLE_MAX) return { error: 'badPost', detail: `제목은 ${TITLE_MAX}자까지입니다` };
  if (text.length > BODY_MAX) return { error: 'badPost', detail: `본문은 ${BODY_MAX}자까지입니다` };
  const list = Array.isArray(body.photos) ? body.photos : [];
  if (list.length > PHOTOS_MAX) return { error: 'badPost', detail: `사진은 ${PHOTOS_MAX}장까지입니다` };
  const photos = [];
  for (const p of list) {
    if (!p || typeof p.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) {
      return { error: 'badPost', detail: '사진 값이 올바르지 않습니다' };
    }
    const bytes = Buffer.from(p.data, 'base64');
    if (bytes.length === 0 || bytes.length > PHOTO_BYTES_MAX) {
      return { error: 'badPost', detail: `사진은 한 장에 ${Math.floor(PHOTO_BYTES_MAX / 1_000_000 * 10) / 10}MB까지입니다` };
    }
    const mime = sniffImage(bytes);
    if (!mime) return { error: 'badPost', detail: 'JPEG·PNG·WebP 사진만 올릴 수 있습니다' };
    photos.push({ id: newId('cph'), mime, bytes });
  }
  if (kind === 'photo' && photos.length === 0) return { error: 'badPost', detail: '사진을 한 장 이상 골라 주세요' };
  if (kind === 'diary' && text.length === 0) return { error: 'badPost', detail: '일기 내용을 입력해 주세요' };
  return { kind, title, body: text, photos };
}

/** 저장소 글 → 응답 글. 사진 원본은 싣지 않고 주소만 */
export function publicPost(rec, viewerAccountId) {
  return {
    id: rec.id,
    kind: rec.kind,
    title: rec.title,
    body: rec.body,
    authorId: rec.userId,
    authorNickname: rec.nickname,
    createdAt: rec.createdAt,
    photos: rec.photos.map((p) => ({ id: p.id, url: `/community/media/${p.id}` })),
    mine: viewerAccountId != null && rec.accountId === viewerAccountId,
  };
}

/** 커서 'ms:id' ↔ {createdAt, id} */
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
  const order = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  return {
    kind: 'memory',
    async insertPost(rec) {
      posts.set(rec.id, { ...rec, photos: rec.photos.map((p) => ({ id: p.id, mime: p.mime })) });
      for (const p of rec.photos) photos.set(p.id, { mime: p.mime, bytes: p.bytes });
    },
    async list({ before, limit, kind }) {
      let all = [...posts.values()].sort(order);
      if (kind) all = all.filter((p) => p.kind === kind);
      if (before) all = all.filter((p) => p.createdAt < before.createdAt || (p.createdAt === before.createdAt && p.id < before.id));
      return all.slice(0, limit).map((p) => ({ ...p, photos: p.photos.map((x) => ({ ...x })) }));
    },
    async removePost(id, accountId) {
      const p = posts.get(id);
      if (!p || p.accountId !== accountId) return false;
      for (const x of p.photos) photos.delete(x.id);
      posts.delete(id);
      return true;
    },
    async removeByAccount(accountId) {
      let n = 0;
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
    },
  };
}

/**
 * 커뮤니티 서비스. authenticate(headers) → {account} | null (auth 서비스의 Bearer 판정).
 * handle은 {status, body} 또는 사진이면 {status, raw:{mime, bytes}}를 돌려준다.
 */
export function createCommunityService({ store = createMemoryCommunityStore(), authenticate = async () => null, now = () => Date.now(), log = () => {} } = {}) {
  const fail = (status, error, detail) => ({ status, body: { error, ...(detail ? { detail } : {}) } });

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
      const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('limit') ?? PAGE_DEFAULT) || PAGE_DEFAULT));
      const before = url.searchParams.get('before') ? parseCursor(url.searchParams.get('before')) : null;
      if (url.searchParams.get('before') && !before) return fail(400, 'badRequest', '다음 쪽 표시가 올바르지 않습니다');
      const acc = await viewer(headers);
      const rows = await store.list({ before, limit: limit + 1, kind: kind || null });
      const page = rows.slice(0, limit);
      return {
        status: 200,
        body: { posts: page.map((r) => publicPost(r, acc?.accountId)), next: rows.length > limit ? cursorOf(page[page.length - 1]) : null },
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
        createdAt: at,
        photos: input.photos,
      };
      await store.insertPost(rec);
      return { status: 200, body: { post: publicPost(rec, acc.accountId) } };
    },

    async 'POST posts/delete'({ id, headers }) {
      const acc = await viewer(headers);
      if (!acc) return fail(401, 'loginRequired', '로그인이 필요해요');
      return (await store.removePost(id, acc.accountId)) ? { status: 200, body: { ok: true } } : fail(404, 'notFound', '내 글을 찾지 못했습니다');
    },

    async 'GET media'({ id }) {
      const p = await store.photo(id);
      return p ? { status: 200, raw: p } : fail(404, 'notFound');
    },
  };

  return {
    /** path는 '/community/' 뒤(예: 'posts', 'posts/cmt-…/delete', 'media/cph-…') */
    async handle({ method, path, url, headers, body }) {
      const parts = String(path).split('/').filter(Boolean);
      try {
        if (parts[0] === 'posts' && parts.length === 1) {
          const r = routes[`${method} posts`];
          return r ? await r({ url, headers, body }) : fail(404, 'notFound');
        }
        if (parts[0] === 'posts' && parts.length === 3 && parts[2] === 'delete' && method === 'POST') {
          return await routes['POST posts/delete']({ id: parts[1], headers });
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
