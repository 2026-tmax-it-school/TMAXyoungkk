import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import {
  BODY_MAX,
  PHOTO_BYTES_MAX,
  PHOTOS_MAX,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  TITLE_MAX,
  createMemoryCommunityStore,
  parseCursor,
  parsePostInput,
  sniffImage,
} from '../server/community.mjs';
import { migrate } from '../server/db/migrate.mjs';
import { createPostgresStore, sqlDb } from '../server/db/postgres-store.mjs';
import { createSyncStore, startSyncServer, type SyncStore } from '../server/sync-server.mjs';

/**
 * WP2 커뮤니티 서버(server/community.mjs, 2026-10-10). 사진·일기 글을 서버에 둔다.
 * 같은 HTTP 시나리오를 메모리 저장소와 PGlite(같은 SQL)로 돌린다: 글쓰기(로그인 필요)·피드 쪽 나누기·종류 거르기·
 * 내 글 표시·지우기(본인만)·사진 파일 머리글 검사·크기·개수·한 시간 20개 제한·탈퇴하면 글도 사라짐.
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

test('글 검사: 종류별 필수 값, 제목·본문·사진 한도, 앱이 보낸 mime은 믿지 않는다', () => {
  const ok = parsePostInput({ kind: 'photo', title: '  불국사  ', body: '', photos: [{ mime: 'text/html', data: JPEG.toString('base64') }] });
  assert.ok(!('error' in ok));
  if (!('error' in ok)) {
    assert.equal(ok.title, '불국사');
    assert.equal(ok.photos[0].mime, 'image/jpeg');
  }
  const bad = (b: unknown) => ('error' in parsePostInput(b) ? (parsePostInput(b) as { detail: string }).detail : null);
  assert.ok(bad(null));
  assert.ok(bad({ kind: 'video' }));
  assert.match(bad({ kind: 'photo', photos: [] })!, /한 장 이상/);
  assert.match(bad({ kind: 'diary', body: '   ' })!, /일기 내용/);
  assert.match(bad({ kind: 'diary', body: 'x'.repeat(BODY_MAX + 1) })!, /본문/);
  assert.match(bad({ kind: 'diary', title: 'x'.repeat(TITLE_MAX + 1), body: '내용' })!, /제목/);
  assert.match(bad({ kind: 'photo', photos: Array.from({ length: PHOTOS_MAX + 1 }, () => photo()) })!, /사진은/);
  assert.match(bad({ kind: 'photo', photos: [{ data: 'not base64!!' }] })!, /사진 값/);
  assert.match(bad({ kind: 'photo', photos: [photo(Buffer.from('<script>alert(1)</script>'))] })!, /JPEG/);
  assert.match(bad({ kind: 'photo', photos: [photo(Buffer.concat([JPEG, Buffer.alloc(PHOTO_BYTES_MAX)]))] })!, /MB/);
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
    await s.insertPost({ id, accountId: 'x', userId: 'u', nickname: 'n', kind: 'diary', title: '', body: id, createdAt: 1000, photos: [] });
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
      const [s1, r1] = await call('/community/posts', { kind: 'photo', photos: [] }, m.token);
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
