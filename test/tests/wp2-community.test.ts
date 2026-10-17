import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import {
  BODY_MAX,
  EDIT_LIMIT,
  PHOTO_BYTES_MAX,
  PHOTOS_MAX,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  TITLE_MAX,
  TAGS_MAX,
  TAG_LEN_MAX,
  createMemoryCommunityStore,
  normalizeTag,
  parseCursor,
  parsePostInput,
  parsePostUpdate,
  parseTags,
  sniffImage,
  SEARCH_MAX,
  matchesSearch,
  normalizeSearch,
  searchTagPart,
} from '../server/community.mjs';
import { migrate } from '../server/db/migrate.mjs';
import { createPostgresStore, sqlDb } from '../server/db/postgres-store.mjs';
import { createSyncStore, startSyncServer, type SyncStore } from '../server/sync-server.mjs';

/**
 * WP2 커뮤니티 서버(server/community.mjs, 2026-10-10). 사진·일기 글을 서버에 둔다.
 * 같은 HTTP 시나리오를 메모리 저장소와 PGlite(같은 SQL)로 돌린다: 글쓰기(로그인 필요)·피드 쪽 나누기·종류 거르기·
 * 내 글 표시·지우기(본인만)·사진 파일 머리글 검사·크기·개수·한 시간 20개 제한·탈퇴하면 글도 사라짐.
 * 2026-10-17: 글 고치기(본인만, 남길 사진 {id}·새 사진 섞기, 검사는 올리기와 같음, kind 다시 정하기, 빠진 사진 지우기, editedAt, 한 시간 60번).
 */

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const MIN = 60 * 1000;
const PW = 'trip2026ok';
const COST = 1024;

type Json = Record<string, any>;

/** 가장 작은 JPEG 머리글(파일 머리글 검사만 통과하면 된다) */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-test-bytes')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-test-bytes')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const photo = (bytes: Buffer = JPEG) => ({ mime: 'image/jpeg', data: bytes.toString('base64') });

interface Opened {
  store: SyncStore;
  close(): Promise<void>;
}

const BACKENDS: { name: string; open: () => Promise<Opened> }[] = [
  { name: '메모리', open: async () => ({ store: createSyncStore(), close: async () => {} }) },
  {
    name: 'PGlite',
    open: async () => {
      const pg = new PGlite();
      await pg.waitReady;
      const db = sqlDb(pg);
      await migrate(db);
      return { store: createPostgresStore(db, { warn: () => {} }), close: () => pg.close() };
    },
  },
];

test('파일 머리글: JPEG·PNG·WebP만 알아보고 나머지는 거절', () => {
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(WEBP), 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a....')), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test('글 검사: 본문이나 사진 하나면 된다, 제목·본문·사진 한도, kind는 사진 유무로, 앱이 보낸 mime은 믿지 않는다', () => {
  const ok = parsePostInput({ kind: 'diary', title: '  불국사  ', body: '', photos: [{ mime: 'text/html', data: JPEG.toString('base64') }] });
  assert.ok(!('error' in ok));
  if (!('error' in ok)) {
    assert.equal(ok.title, '불국사');
    assert.equal(ok.photos[0].mime, 'image/jpeg');
    assert.equal(ok.kind, 'photo', '앱이 보낸 kind가 아니라 사진 유무로 정한다');
    assert.deepEqual(ok.tags, []);
  }
  const text = parsePostInput({ body: '글만' });
  assert.ok(!('error' in text) && text.kind === 'diary');
  const bad = (b: unknown) => ('error' in parsePostInput(b) ? (parsePostInput(b) as { detail: string }).detail : null);
  assert.ok(bad(null));
  assert.match(bad({ kind: 'video' })!, /사진을 고르거나 내용을/);
  assert.match(bad({ photos: [] })!, /사진을 고르거나 내용을/);
  assert.match(bad({ body: '   ' })!, /사진을 고르거나 내용을/);
  assert.match(bad({ kind: 'diary', body: 'x'.repeat(BODY_MAX + 1) })!, /본문/);
  assert.match(bad({ kind: 'diary', title: 'x'.repeat(TITLE_MAX + 1), body: '내용' })!, /제목/);
  assert.match(bad({ kind: 'photo', photos: Array.from({ length: PHOTOS_MAX + 1 }, () => photo()) })!, /사진은/);
  assert.match(bad({ kind: 'photo', photos: [{ data: 'not base64!!' }] })!, /사진 값/);
  assert.match(bad({ kind: 'photo', photos: [photo(Buffer.from('<script>alert(1)</script>'))] })!, /JPEG/);
  assert.match(bad({ kind: 'photo', photos: [photo(Buffer.concat([JPEG, Buffer.alloc(PHOTO_BYTES_MAX)]))] })!, /MB/);
  assert.match(bad({ body: '글', tags: '맛집' })!, /태그 값/);
  assert.match(bad({ body: '글', tags: ['맛 집!'] })!, /태그는/);
});

test('고치기 검사: 남길 사진은 그 글의 사진 id만(겹치면 안 됨), 새 사진과 섞어 순서대로, 남긴 사진도 4장에 센다', () => {
  const existing = [
    { id: 'cph-a', mime: 'image/jpeg' },
    { id: 'cph-b', mime: 'image/png' },
  ];
  const ok = parsePostUpdate({ title: ' 새 제목 ', body: '', tags: ['#바다'], photos: [{ id: 'cph-b' }, photo(PNG)] }, existing);
  assert.ok(!('error' in ok));
  if (!('error' in ok)) {
    assert.equal(ok.title, '새 제목');
    assert.equal(ok.kind, 'photo');
    assert.deepEqual(ok.tags, ['바다']);
    assert.deepEqual(ok.photos[0], { id: 'cph-b', mime: 'image/png' });
    assert.equal(ok.photos[1].mime, 'image/png');
    assert.ok(ok.photos[1].bytes && ok.photos[1].id !== 'cph-a');
  }
  const textOnly = parsePostUpdate({ body: '사진은 다 뺐다', photos: [] }, existing);
  assert.ok(!('error' in textOnly) && textOnly.kind === 'diary' && textOnly.photos.length === 0);
  const bad = (b: unknown) => {
    const r = parsePostUpdate(b, existing);
    return 'error' in r ? r.detail : null;
  };
  assert.match(bad({ body: '글', photos: [{ id: 'cph-other' }] })!, /사진 값/, '남의 사진 id는 남길 수 없다');
  assert.match(bad({ body: '글', photos: [{ id: 'cph-a' }, { id: 'cph-a' }] })!, /사진 값/);
  assert.match(bad({ photos: [], body: ' ' })!, /사진을 고르거나 내용을/);
  assert.match(bad({ photos: [{ id: 'cph-a' }, { id: 'cph-b' }, photo(), photo(), photo()] })!, /사진은/);
  assert.match(bad({ body: '글', tags: ['a-b'] })!, /태그는/);
  assert.match(bad({ body: 'x'.repeat(BODY_MAX + 1) })!, /본문/);
  assert.match(bad({ title: 'x'.repeat(TITLE_MAX + 1), body: '글' })!, /제목/);
  const create = parsePostInput({ photos: [{ id: 'cph-a' }] });
  assert.ok('error' in create && /사진 값/.test(create.detail), '올리기는 id만 있는 사진을 받지 않는다');
});

test('태그 규칙: #·띄어쓰기를 떼고 소문자, 한글·영문·숫자·_ 12자, 글당 5개, 겹치면 하나', () => {
  assert.equal(normalizeTag('  #제주 맛집 '), '제주맛집');
  assert.equal(normalizeTag('##Cafe_2'), 'cafe_2');
  assert.equal(normalizeTag('가'.repeat(TAG_LEN_MAX)), '가'.repeat(TAG_LEN_MAX));
  assert.equal(normalizeTag('가'.repeat(TAG_LEN_MAX + 1)), null);
  assert.equal(normalizeTag('a-b'), null);
  assert.equal(normalizeTag('#'), null);
  assert.equal(normalizeTag(3 as unknown as string), null);
  assert.deepEqual(parseTags(['#맛집', '맛집', 'CAFE', 'cafe']), { tags: ['맛집', 'cafe'] });
  assert.deepEqual(parseTags(undefined), { tags: [] });
  const many = Array.from({ length: TAGS_MAX + 1 }, (_, i) => `t${i}`);
  assert.ok('error' in parseTags(many));
  assert.deepEqual(parseTags([...many.slice(0, TAGS_MAX), 't0']), { tags: many.slice(0, TAGS_MAX) });
});

test('검색어 규칙: 공백 정리, 너무 길면 long, 태그 쪽 비교 값, 제목·태그 맞춤', () => {
  assert.equal(normalizeSearch('  바다   산책 '), '바다 산책');
  assert.equal(normalizeSearch('   '), null);
  assert.equal(normalizeSearch('가'.repeat(SEARCH_MAX + 1)), 'long');
  assert.equal(normalizeSearch('가'.repeat(SEARCH_MAX)), '가'.repeat(SEARCH_MAX));
  assert.equal(searchTagPart('#Sea Side'), 'seaside');
  assert.equal(searchTagPart('###'), null);
  assert.equal(matchesSearch({ title: 'Jeju 여행', tags: [] }, 'JEJU'), true);
  assert.equal(matchesSearch({ title: '글', tags: ['seaside'] }, '#sea side'), true);
  assert.equal(matchesSearch({ title: '글', tags: ['맛집'] }, '카페'), false);
  assert.equal(matchesSearch({ title: '#', tags: [] }, '#'), true, '제목에 # 글자가 있으면 제목으로 맞는다');
});

test('커서 값 읽기', () => {
  assert.deepEqual(parseCursor('1760000000000:cmt-abc_1'), { createdAt: 1760000000000, id: 'cmt-abc_1' });
  assert.equal(parseCursor('nope'), null);
  assert.equal(parseCursor(null), null);
  assert.equal(parseCursor('12:a b'), null);
});

test('메모리 저장소: 같은 시각이면 id 순으로 쪽 나누기가 겹치지 않는다', async () => {
  const s = createMemoryCommunityStore();
  for (const id of ['cmt-a', 'cmt-b', 'cmt-c']) {
    await s.insertPost({ id, accountId: 'x', userId: 'u', nickname: 'n', kind: 'diary', title: '', body: id, tags: [], createdAt: 1000, photos: [] });
  }
  const first = await s.list({ before: null, limit: 2, kind: null });
  assert.deepEqual(first.map((p) => p.id), ['cmt-c', 'cmt-b']);
  const second = await s.list({ before: { createdAt: 1000, id: 'cmt-b' }, limit: 2, kind: null });
  assert.deepEqual(second.map((p) => p.id), ['cmt-a']);
});

for (const backend of BACKENDS) {
  describe(`커뮤니티 서버(${backend.name})`, () => {
    let opened: Opened;
    let server: { url: string; close: () => Promise<void> };
    let now = T0;
    let seq = 0;

    before(async () => {
      opened = await backend.open();
      server = await startSyncServer({
        store: opened.store,
        now: () => now,
        purgeEveryMs: 0,
        proxy: false,
        auth: { devOutbox: true, passwordCost: COST },
      });
    });
    after(async () => {
      await server?.close();
      await opened?.close();
    });
    beforeEach(() => {
      now += 11 * MIN;
    });

    async function call(path: string, body?: unknown, token?: string): Promise<[number, Json]> {
      const res = await fetch(`${server.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      let json: Json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      return [res.status, json];
    }

    async function member(prefix = 'cm') {
      seq += 1;
      const email = `${prefix}${seq}@example.com`;
      const nickname = `${prefix}${seq}`;
      const [s] = await call('/auth/signup', { email, password: PW, nickname });
      assert.equal(s, 200);
      const [, outbox] = await call('/auth/outbox');
      const mail = (outbox.mails as Json[]).find((m) => m.to === email && m.kind === 'verify' && !m.invalidated);
      assert.ok(mail);
      const [vs, v] = await call('/auth/verify', { token: mail.token });
      assert.equal(vs, 200);
      return { token: v.token as string, nickname, userId: v.account.userId as string };
    }

    test('글쓰기는 로그인한 계정만, 읽기는 누구나', async () => {
      const [s0, r0] = await call('/community/posts', { kind: 'diary', body: '안녕' });
      assert.equal(s0, 401);
      assert.equal(r0.error, 'loginRequired');
      const [s1, r1] = await call('/community/posts');
      assert.equal(s1, 200);
      assert.ok(Array.isArray(r1.posts));
    });

    test('일기 글과 사진 글을 올리고 피드에서 최신순으로 본다(내 글 표시, 종류 거르기)', async () => {
      const a = await member('ann');
      const b = await member('bob');
      const [ds, d] = await call('/community/posts', { kind: 'diary', title: '불국사', body: '천천히 걸었다' }, a.token);
      assert.equal(ds, 200, JSON.stringify(d));
      assert.equal(d.post.kind, 'diary');
      assert.equal(d.post.authorNickname, a.nickname);
      assert.equal(d.post.mine, true);
      now += MIN;
      const [ps, p] = await call('/community/posts', { kind: 'photo', body: '석굴암', photos: [photo(JPEG), photo(PNG)] }, b.token);
      assert.equal(ps, 200, JSON.stringify(p));
      assert.equal(p.post.photos.length, 2);
      assert.match(p.post.photos[0].url, /^\/community\/media\/cph-/);

      const [, feed] = await call('/community/posts?limit=50', undefined, a.token);
      const ids = (feed.posts as Json[]).map((x) => x.id);
      assert.ok(ids.indexOf(p.post.id) < ids.indexOf(d.post.id), '최신 글이 위');
      assert.equal((feed.posts as Json[]).find((x) => x.id === d.post.id)!.mine, true);
      assert.equal((feed.posts as Json[]).find((x) => x.id === p.post.id)!.mine, false);
      const [, anon] = await call('/community/posts?limit=50');
      assert.ok((anon.posts as Json[]).every((x) => x.mine === false));
      const [, onlyPhoto] = await call('/community/posts?kind=photo&limit=50');
      assert.ok((onlyPhoto.posts as Json[]).length > 0 && (onlyPhoto.posts as Json[]).every((x) => x.kind === 'photo'));
      const [bs] = await call('/community/posts?kind=video');
      assert.equal(bs, 400);
    });

    test('태그: 올릴 때 맞춰 저장하고 ?tag=로 거른다(같은 규칙으로 맞춘 뒤), 틀린 태그는 400', async () => {
      const m = await member('tagger');
      now += MIN;
      const [s1, a] = await call('/community/posts', { body: '바다', tags: ['#제주 바다', 'Sea', 'sea'] }, m.token);
      assert.equal(s1, 200, JSON.stringify(a));
      assert.deepEqual(a.post.tags, ['제주바다', 'sea']);
      now += MIN;
      const [, b] = await call('/community/posts', { body: '카페', tags: ['카페'] }, m.token);
      assert.deepEqual(b.post.tags, ['카페']);
      const [, bySea] = await call(`/community/posts?limit=50&tag=${encodeURIComponent('#SEA')}`);
      const ids = (bySea.posts as Json[]).map((x) => x.id);
      assert.ok(ids.includes(a.post.id) && !ids.includes(b.post.id));
      assert.ok((bySea.posts as Json[]).every((x) => (x.tags as string[]).includes('sea')));
      const [, none] = await call(`/community/posts?tag=${encodeURIComponent('없는태그')}`);
      assert.deepEqual(none.posts, []);
      const [bad] = await call(`/community/posts?tag=${encodeURIComponent('a-b')}`);
      assert.equal(bad, 400);
      const [tooMany] = await call('/community/posts', { body: '많다', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, m.token);
      assert.equal(tooMany, 400);
    });

    test('검색: ?q=는 제목과 태그만 본다(본문은 안 본다, 대소문자 무시, # 앞은 뗀다), 태그·쪽 나누기와 같이 쓰고 LIKE 문자는 글자 그대로다', async () => {
      const m = await member('finder');
      const put = async (body: Json) => {
        now += MIN;
        const [s, r] = await call('/community/posts', body, m.token);
        assert.equal(s, 200, JSON.stringify(r));
        return r.post.id as string;
      };
      const a = await put({ title: 'Jeju 바다 산책', body: '본문에만 있는 단어 우도땅콩', tags: ['여행', 'Sea'] });
      const b = await put({ title: '부산 맛집', body: '국밥', tags: ['맛집', '부산'] });
      const c = await put({ title: '100% 후기', body: '퍼센트', tags: ['후기_1'] });
      const d = await put({ title: '평범한 글', body: '그냥', tags: ['풍경'] });
      const find = async (q: string, extra = ''): Promise<string[]> => {
        const [s, r] = await call(`/community/posts?limit=50&q=${encodeURIComponent(q)}${extra}`);
        assert.equal(s, 200, q);
        return (r.posts as Json[]).map((x) => x.id as string);
      };
      assert.deepEqual((await find('jeju')).filter((id) => [a, b, c, d].includes(id)), [a], '제목 소문자·대소문자 무시');
      assert.deepEqual((await find('바다')).filter((id) => [a, b, c, d].includes(id)), [a], '제목 일부');
      assert.deepEqual((await find('맛')).filter((id) => [a, b, c, d].includes(id)), [b], '제목 일부(맛집)');
      assert.deepEqual((await find('#sea')).filter((id) => [a, b, c, d].includes(id)), [a], '# 태그, 영문 소문자');
      assert.deepEqual((await find('부산')).filter((id) => [a, b, c, d].includes(id)), [b], '제목과 태그에 모두 있어도 한 번');
      assert.deepEqual((await find('우도땅콩')).filter((id) => [a, b, c, d].includes(id)), [], '본문은 검색하지 않는다');
      assert.deepEqual((await find('%')).filter((id) => [a, b, c, d].includes(id)), [c], '% 는 와일드카드가 아니다');
      assert.deepEqual((await find('_')).filter((id) => [a, b, c, d].includes(id)), [c], '_ 도 마찬가지(태그 후기_1)');
      assert.deepEqual((await find('  바다   산책 ')).filter((id) => [a, b, c, d].includes(id)), [a], '공백을 모은다');
      assert.deepEqual((await find('여행', '&tag=sea')).filter((id) => [a, b, c, d].includes(id)), [a], '태그 거르기와 같이');
      assert.deepEqual((await find('여행', '&tag=맛집')).filter((id) => [a, b, c, d].includes(id)), [], '다른 태그와 함께면 겹치지 않는다');
      // 빈 검색어는 전체
      const [, all] = await call('/community/posts?limit=50&q=%20%20');
      assert.ok((all.posts as Json[]).length >= 4);
      // 너무 긴 검색어는 400
      const [long] = await call(`/community/posts?q=${encodeURIComponent('가'.repeat(SEARCH_MAX + 1))}`);
      assert.equal(long, 400);
      // 쪽 나누기: 같은 검색어로 limit 1씩 이어 받으면 겹치지 않고 모두 나온다
      const e1 = await put({ title: '제주 둘째', body: 'x', tags: ['t'] });
      const e2 = await put({ title: '제주 셋째', body: 'y', tags: ['t'] });
      const seen: string[] = [];
      let next: string | null = null;
      for (let g = 0; g < 10; g += 1) {
        const [, page] = await call(`/community/posts?limit=1&q=${encodeURIComponent('제주')}${next ? `&before=${encodeURIComponent(next)}` : ''}`);
        seen.push(...(page.posts as Json[]).map((x) => x.id as string));
        next = page.next;
        if (!next) break;
      }
      assert.deepEqual(seen.filter((id) => [e1, e2].includes(id)), [e2, e1], '최신순으로 이어 받는다');
      assert.equal(new Set(seen).size, seen.length);
    });

    test('피드는 limit만큼 쪽을 나누고 next로 이어 받으면 겹치거나 빠지지 않는다', async () => {
      const m = await member('pager');
      const made: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        now += 1000;
        const [s, r] = await call('/community/posts', { kind: 'diary', body: `쪽 ${i}` }, m.token);
        assert.equal(s, 200);
        made.push(r.post.id);
      }
      const seen: string[] = [];
      let next: string | null = null;
      for (let guard = 0; guard < 40; guard += 1) {
        const [s, page] = await call(`/community/posts?limit=2${next ? `&before=${encodeURIComponent(next)}` : ''}`);
        assert.equal(s, 200);
        seen.push(...(page.posts as Json[]).map((x) => x.id));
        next = page.next;
        if (!next) break;
      }
      assert.equal(new Set(seen).size, seen.length, '중복 없음');
      for (const id of made) assert.ok(seen.includes(id), id);
      const [bs] = await call('/community/posts?before=garbage');
      assert.equal(bs, 400);
    });

    test('사진은 주소로 받는다: 올린 바이트 그대로, 종류는 파일 머리글, nosniff·오래 캐시', async () => {
      const m = await member('pic');
      const [, r] = await call('/community/posts', { kind: 'photo', photos: [{ mime: 'text/html', data: PNG.toString('base64') }] }, m.token);
      const res = await fetch(`${server.url}${r.post.photos[0].url}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('cache-control') ?? '', /immutable/);
      assert.ok(Buffer.from(await res.arrayBuffer()).equals(PNG));
      assert.equal((await fetch(`${server.url}/community/media/cph-nope`)).status, 404);
    });

    test('잘못된 글은 400, 너무 큰 본문은 413', async () => {
      const m = await member('bad');
      const [s1, r1] = await call('/community/posts', { photos: [], body: '  ' }, m.token);
      assert.equal(s1, 400);
      assert.equal(r1.error, 'badPost');
      const [s2] = await call('/community/posts', { kind: 'photo', photos: [{ data: 'A'.repeat(11 * 1024 * 1024) }] }, m.token);
      assert.equal(s2, 413);
    });

    test('지우기는 내 글만(남의 글은 404), 지우면 사진도 사라진다', async () => {
      const a = await member('own');
      const b = await member('oth');
      const [, r] = await call('/community/posts', { kind: 'photo', photos: [photo()] }, a.token);
      const id = r.post.id as string;
      const url = r.post.photos[0].url as string;
      assert.equal((await call(`/community/posts/${id}/delete`, {}, b.token))[0], 404);
      assert.equal((await call(`/community/posts/${id}/delete`, {}))[0], 401);
      assert.equal((await call(`/community/posts/${id}/delete`, {}, a.token))[0], 200);
      const [, feed] = await call('/community/posts?limit=50');
      assert.ok(!(feed.posts as Json[]).some((x) => x.id === id));
      assert.equal((await fetch(`${server.url}${url}`)).status, 404);
      assert.equal((await call(`/community/posts/${id}/delete`, {}, a.token))[0], 404);
    });

    test('고치기는 내 글만(남의 글·없는 글은 404, 로그인 없으면 401): 제목·본문·태그를 바꾸고 editedAt을 두고 순서는 그대로', async () => {
      const a = await member('edit');
      const b = await member('peek');
      const [, r] = await call('/community/posts', { title: '처음', body: '처음 글', tags: ['바다'] }, a.token);
      const id = r.post.id as string;
      assert.equal(r.post.editedAt, null);
      now += MIN;
      const [, later] = await call('/community/posts', { body: '나중 글' }, a.token);
      const at = (now += MIN);
      assert.equal((await call(`/community/posts/${id}/update`, { body: '남이 고침' }, b.token))[0], 404);
      assert.equal((await call(`/community/posts/${id}/update`, { body: '로그인 없이' }))[0], 401);
      assert.equal((await call('/community/posts/cmt-nope/update', { body: '없는 글' }, a.token))[0], 404);
      const [s1, e1] = await call(`/community/posts/${id}/update`, { title: ' 고친 제목 ', body: '고친 글', tags: ['#Sea', '카페'] }, a.token);
      assert.equal(s1, 200, JSON.stringify(e1));
      assert.equal(e1.post.id, id);
      assert.equal(e1.post.title, '고친 제목');
      assert.equal(e1.post.body, '고친 글');
      assert.deepEqual(e1.post.tags, ['sea', '카페']);
      assert.equal(e1.post.editedAt, at);
      assert.equal(e1.post.createdAt, r.post.createdAt);
      assert.equal(e1.post.mine, true);
      const [, feed] = await call('/community/posts?limit=50', undefined, b.token);
      const ids = (feed.posts as Json[]).map((x) => x.id);
      assert.ok(ids.indexOf(later.post.id) < ids.indexOf(id), '고쳐도 피드 순서(올린 시각)는 그대로');
      const seen = (feed.posts as Json[]).find((x) => x.id === id)!;
      assert.equal(seen.body, '고친 글');
      assert.equal(seen.editedAt, at);
      assert.equal(seen.mine, false);
      const [, bySea] = await call('/community/posts?limit=50&tag=sea');
      assert.ok((bySea.posts as Json[]).some((x) => x.id === id));
      const [, byOld] = await call(`/community/posts?limit=50&tag=${encodeURIComponent('바다')}`);
      assert.ok(!(byOld.posts as Json[]).some((x) => x.id === id), '뺀 태그로는 거르지 않는다');
    });

    test('고치기 사진: 남기기·빼기·새로 더하기를 섞고 순서를 따른다, 뺀 사진은 사라지고 kind는 사진 유무로 다시 정한다', async () => {
      const a = await member('pics');
      const [, r] = await call('/community/posts', { body: '사진 셋', photos: [photo(JPEG), photo(PNG), photo(WEBP)] }, a.token);
      const id = r.post.id as string;
      const [p1, p2, p3] = r.post.photos as Json[];
      assert.equal(r.post.kind, 'photo');
      now += MIN;
      const [s1, e1] = await call(`/community/posts/${id}/update`, { body: '사진 바꿈', photos: [{ id: p3.id }, photo(PNG), { id: p1.id }] }, a.token);
      assert.equal(s1, 200, JSON.stringify(e1));
      const got = e1.post.photos as Json[];
      assert.equal(got.length, 3);
      assert.equal(got[0].id, p3.id);
      assert.equal(got[2].id, p1.id);
      assert.ok(![p1.id, p2.id, p3.id].includes(got[1].id));
      assert.equal((await fetch(`${server.url}${p2.url}`)).status, 404, '뺀 사진은 지운다');
      const kept = await fetch(`${server.url}${p3.url}`);
      assert.equal(kept.status, 200);
      assert.ok(Buffer.from(await kept.arrayBuffer()).equals(WEBP));
      const added = await fetch(`${server.url}${got[1].url}`);
      assert.ok(Buffer.from(await added.arrayBuffer()).equals(PNG));
      const [, feed] = await call('/community/posts?limit=50');
      assert.deepEqual(((feed.posts as Json[]).find((x) => x.id === id)!.photos as Json[]).map((x) => x.id), got.map((x) => x.id));

      now += MIN;
      const [s2, e2] = await call(`/community/posts/${id}/update`, { body: '사진 없이', photos: [] }, a.token);
      assert.equal(s2, 200);
      assert.equal(e2.post.kind, 'diary');
      assert.deepEqual(e2.post.photos, []);
      for (const g of got) assert.equal((await fetch(`${server.url}${g.url}`)).status, 404);
      const [, onlyDiary] = await call('/community/posts?kind=diary&limit=50');
      assert.ok((onlyDiary.posts as Json[]).some((x) => x.id === id));

      now += MIN;
      const [s3, e3] = await call(`/community/posts/${id}/update`, { photos: [photo(JPEG)] }, a.token);
      assert.equal(s3, 200);
      assert.equal(e3.post.kind, 'photo');
      assert.equal(e3.post.body, '');
    });

    test('고치기 검사는 올리기와 같다: 빈 글·남의 사진 id·5장·틀린 태그는 400, 실패하면 글은 그대로', async () => {
      const a = await member('editbad');
      const b = await member('other');
      const [, mineR] = await call('/community/posts', { body: '내 글', photos: [photo()] }, a.token);
      const [, theirs] = await call('/community/posts', { body: '남 글', photos: [photo()] }, b.token);
      const id = mineR.post.id as string;
      const keep = { id: mineR.post.photos[0].id };
      const up = (body: unknown) => call(`/community/posts/${id}/update`, body, a.token);
      assert.equal((await up({ body: '  ', photos: [] }))[0], 400);
      assert.equal((await up({ body: '글', photos: [{ id: theirs.post.photos[0].id }] }))[0], 400);
      assert.equal((await up({ body: '글', photos: [keep, photo(), photo(), photo(), photo()] }))[0], 400);
      assert.equal((await up({ body: '글', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }))[0], 400);
      assert.equal((await up({ body: '글', photos: [photo(Buffer.from('<svg/>'))] }))[0], 400);
      const [, feed] = await call('/community/posts?limit=50');
      const still = (feed.posts as Json[]).find((x) => x.id === id)!;
      assert.equal(still.body, '내 글');
      assert.equal(still.editedAt, null);
      assert.equal((still.photos as Json[]).length, 1);
      assert.equal((await fetch(`${server.url}${theirs.post.photos[0].url}`)).status, 200, '남의 사진은 그대로');
    });

    test(`고치기는 한 시간에 ${EDIT_LIMIT}번까지(올리기 ${RATE_LIMIT}개와 따로), 시간이 지나면 다시 고친다`, async () => {
      const m = await member('editrate');
      const [, r] = await call('/community/posts', { body: '글' }, m.token);
      const id = r.post.id as string;
      for (let i = 0; i < EDIT_LIMIT; i += 1) {
        now += 1000;
        assert.equal((await call(`/community/posts/${id}/update`, { body: `고침 ${i}` }, m.token))[0], 200);
      }
      const [s, e] = await call(`/community/posts/${id}/update`, { body: '하나 더' }, m.token);
      assert.equal(s, 429);
      assert.equal(e.error, 'tooMany');
      assert.equal((await call('/community/posts', { body: '새 글은 된다' }, m.token))[0], 200, '고치기 제한은 올리기와 따로');
      now += RATE_WINDOW_MS;
      assert.equal((await call(`/community/posts/${id}/update`, { body: '이제 됨' }, m.token))[0], 200);
    });

    test(`한 계정은 한 시간에 ${RATE_LIMIT}개까지, 시간이 지나면 다시 올린다`, async () => {
      const m = await member('rate');
      for (let i = 0; i < RATE_LIMIT; i += 1) {
        now += 1000;
        assert.equal((await call('/community/posts', { kind: 'diary', body: `글 ${i}` }, m.token))[0], 200);
      }
      const [s, r] = await call('/community/posts', { kind: 'diary', body: '하나 더' }, m.token);
      assert.equal(s, 429);
      assert.equal(r.error, 'tooMany');
      now += RATE_WINDOW_MS;
      assert.equal((await call('/community/posts', { kind: 'diary', body: '이제 됨' }, m.token))[0], 200);
    });

    test('계정을 탈퇴하면 그 계정의 글과 사진도 지워진다', async () => {
      const a = await member('gone');
      const [, r] = await call('/community/posts', { kind: 'photo', body: '안녕', photos: [photo()] }, a.token);
      const url = r.post.photos[0].url as string;
      assert.equal((await call('/auth/delete', {}, a.token))[0], 200);
      const [, feed] = await call('/community/posts?limit=50');
      assert.ok(!(feed.posts as Json[]).some((x) => x.id === r.post.id));
      assert.equal((await fetch(`${server.url}${url}`)).status, 404);
    });
  });
}
