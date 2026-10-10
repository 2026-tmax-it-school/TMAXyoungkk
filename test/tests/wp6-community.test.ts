import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import {
  BODY_MAX,
  PHOTO_BYTES_MAX,
  PHOTOS_MAX,
  TITLE_MAX,
  base64Bytes,
  checkDraft,
  diaryAsText,
  failText,
  resolvePhotoUrl,
  timeAgo,
} from '../src/core/community';
import type { CommunityDraft } from '../src/core/ports';
import { TAB_ITEMS, SCREEN_META, linking } from '../src/navigation/routes';
import { createCommunityProvider, createHttpCommunity, createLocalCommunity } from '../src/services/community';
import * as server from '../server/community.mjs';
import { createSyncStore, startSyncServer } from '../server/sync-server.mjs';

/**
 * WP6 커뮤니티(2026-10-10): 앱 사용자 전체가 보는 사진·일기 글. 서버는 wp2-community가 본다.
 * 여기서는 앱 규칙(core/community)이 서버와 같은 값인지, 이 기기 모의 제공자, 앱 HTTP 제공자가 실제 서버와 맞물리는지,
 * 탭·화면 연결과 화면 소스 규칙을 본다.
 */

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-test')]);
const photo = (bytes: Buffer = JPEG) => ({ mime: 'image/jpeg', data: bytes.toString('base64') });
const read = (p: string) => readFileSync(p, 'utf8');
const draft = (p: Partial<CommunityDraft> = {}): CommunityDraft => ({ kind: 'diary', title: '', body: '오늘', photos: [], ...p });

test('앱 규칙 값은 서버와 같다(제목·본문·사진 수·사진 크기)', () => {
  assert.equal(TITLE_MAX, server.TITLE_MAX);
  assert.equal(BODY_MAX, server.BODY_MAX);
  assert.equal(PHOTOS_MAX, server.PHOTOS_MAX);
  assert.equal(PHOTO_BYTES_MAX, server.PHOTO_BYTES_MAX);
});

test('글 검사: 서버가 거절할 글을 미리 막는다', () => {
  assert.equal(checkDraft(draft()).ok, true);
  assert.equal(checkDraft(draft({ kind: 'photo', body: '', photos: [photo()] })).ok, true);
  assert.match(checkDraft(draft({ kind: 'photo', body: '설명', photos: [] })).problem ?? '', /한 장 이상/);
  assert.match(checkDraft(draft({ body: '   ' })).problem ?? '', /일기 내용/);
  assert.match(checkDraft(draft({ title: 'x'.repeat(TITLE_MAX + 1) })).problem ?? '', /제목/);
  assert.match(checkDraft(draft({ body: 'x'.repeat(BODY_MAX + 1) })).problem ?? '', /본문/);
  assert.match(checkDraft(draft({ kind: 'photo', photos: Array.from({ length: PHOTOS_MAX + 1 }, () => photo()) })).problem ?? '', /사진은/);
  const big = Buffer.alloc(PHOTO_BYTES_MAX + 10).toString('base64');
  assert.match(checkDraft(draft({ kind: 'photo', photos: [{ mime: 'image/jpeg', data: big }] })).problem ?? '', /너무 큽니다/);
  assert.equal(base64Bytes(Buffer.from('abcd').toString('base64')), 4);
  assert.equal(base64Bytes(Buffer.from('abcde').toString('base64')), 5);
});

test('올린 시각 표시', () => {
  const now = Date.UTC(2026, 9, 10, 3, 0, 0);
  assert.equal(timeAgo(now - 20_000, now), '방금');
  assert.equal(timeAgo(now - 5 * 60_000, now), '5분 전');
  assert.equal(timeAgo(now - 3 * 3_600_000, now), '3시간 전');
  assert.equal(timeAgo(now - 2 * 86_400_000, now), '2일 전');
  assert.equal(timeAgo(Date.UTC(2026, 8, 20, 3, 0, 0), now), '9월 20일');
});

test('일기 → 글 본문, 사진 주소 붙이기, 오류 문장', () => {
  const blocks = [
    { id: 'a', time: '09:00', placeName: '불국사', photoIds: [], text: '천천히 둘러봤다.' },
    { id: 'b', time: '11:00', placeName: '석굴암', photoIds: [], text: '  ' },
    { id: 'c', time: '13:00', placeName: '교촌마을', photoIds: [], text: '한정식을 먹었다.' },
  ];
  assert.equal(diaryAsText({ blocks }), '천천히 둘러봤다.\n한정식을 먹었다.');
  assert.equal(diaryAsText({ blocks: [] }), '');
  assert.equal(resolvePhotoUrl('http://x:8787/', '/community/media/a'), 'http://x:8787/community/media/a');
  assert.equal(resolvePhotoUrl('http://x:8787', 'community/media/a'), 'http://x:8787/community/media/a');
  assert.equal(resolvePhotoUrl('http://x', 'data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.match(failText('loginRequired'), /로그인/);
  assert.equal(failText('badPost', '사진을 한 장 이상 골라 주세요'), '사진을 한 장 이상 골라 주세요');
  assert.match(failText('unreachable'), /서버/);
});

describe('이 기기 모의 커뮤니티', () => {
  const clock = { now: () => Date.UTC(2026, 9, 10, 3, 0, 0) };
  let n = 0;
  const ids = { next: (p: string) => `${p}_${(n += 1)}` };
  const me = { userId: 'u1', nickname: '민지' };

  test('올리고 최신순으로 보고, 내 글만 지운다. 사진은 data: 주소로 보인다', async () => {
    const c = createLocalCommunity({ clock, ids });
    assert.equal(c.id, 'local');
    assert.deepEqual(await c.create(draft(), {}), { ok: false, code: 'loginRequired' });
    const bad = await c.create(draft({ kind: 'photo', photos: [] }), me);
    assert.ok(!bad.ok && bad.code === 'badPost');
    const a = await c.create(draft({ body: '첫 글' }), me);
    const b = await c.create(draft({ kind: 'photo', body: '', photos: [photo()] }), { userId: 'u2', nickname: '준호' });
    assert.ok(a.ok && b.ok);
    const list = await c.list({}, me);
    assert.ok(list.ok);
    if (list.ok) {
      assert.equal(list.value.posts.length, 2);
      assert.equal(list.value.posts.find((p) => p.authorId === 'u1')?.mine, true);
      assert.equal(list.value.posts.find((p) => p.authorId === 'u2')?.mine, false);
      const withPhoto = list.value.posts.find((p) => p.kind === 'photo');
      assert.match(c.photoUri(withPhoto!.photos[0]), /^data:image\/jpeg;base64,/);
    }
    const other = await c.remove(a.ok ? a.value.id : '', { userId: 'u2' });
    assert.ok(!other.ok && other.code === 'notFound');
    assert.deepEqual(await c.remove(a.ok ? a.value.id : '', me), { ok: true, value: true });
    const onlyPhoto = await c.list({ kind: 'photo' }, me);
    assert.ok(onlyPhoto.ok && onlyPhoto.value.posts.every((p) => p.kind === 'photo'));
  });

  test('서버 주소가 있으면 서버 제공자, 없으면 모의', () => {
    assert.equal(createCommunityProvider({ clock, ids }).id, 'local');
    assert.equal(createCommunityProvider({ serverUrl: 'http://x', fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }), clock, ids }).id, 'server');
  });
});

describe('앱 HTTP 제공자 ↔ 실제 서버', () => {
  let srv: { url: string; close: () => Promise<void> };
  let token = '';
  before(async () => {
    srv = await startSyncServer({
      store: createSyncStore(),
      purgeEveryMs: 0,
      proxy: false,
      auth: { devOutbox: true, passwordCost: 1024 },
    });
    const post = async (path: string, body?: unknown) => {
      const r = await fetch(`${srv.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return (await r.json()) as Record<string, any>;
    };
    await post('/auth/signup', { email: 'app@example.com', password: 'trip2026ok', nickname: '앱사용자' });
    const outbox = await post('/auth/outbox');
    const mail = (outbox.mails as any[]).find((m) => m.to === 'app@example.com' && m.kind === 'verify');
    token = (await post('/auth/verify', { token: mail.token })).token;
  });
  after(async () => {
    await srv?.close();
  });

  test('글 올리기·목록·사진 주소·지우기가 서버와 맞물린다', async () => {
    const c = createHttpCommunity({ url: srv.url, fetch: (url, init) => fetch(url, init) });
    assert.equal(c.id, 'server');
    assert.deepEqual(await c.create(draft(), {}), { ok: false, code: 'loginRequired' });
    const made = await c.create(draft({ kind: 'photo', title: '불국사', body: '설명', photos: [photo()] }), { token });
    assert.ok(made.ok, JSON.stringify(made));
    if (!made.ok) return;
    assert.equal(made.value.authorNickname, '앱사용자');
    assert.equal(made.value.mine, true);
    const url = c.photoUri(made.value.photos[0]);
    assert.ok(url.startsWith(srv.url));
    assert.equal((await fetch(url)).status, 200);
    const listed = await c.list({}, { token });
    assert.ok(listed.ok && listed.value.posts.some((p) => p.id === made.value.id && p.mine));
    const anon = await c.list({ kind: 'photo' }, {});
    assert.ok(anon.ok && anon.value.posts.every((p) => !p.mine && p.kind === 'photo'));
    const bad = await c.create(draft({ kind: 'photo', photos: [] }), { token });
    assert.ok(!bad.ok && bad.code === 'badPost');
    assert.deepEqual(await c.remove(made.value.id, { token }), { ok: true, value: true });
    const again = await c.remove(made.value.id, { token });
    assert.ok(!again.ok && again.code === 'notFound');
  });

  test('서버에 닿지 못하면 unreachable', async () => {
    const dead = createHttpCommunity({ url: 'http://127.0.0.1:1', fetch: (url, init) => fetch(url, init), timeoutMs: 2000 });
    const r = await dead.list({}, {});
    assert.ok(!r.ok && r.code === 'unreachable');
  });
});

test('탭·화면 연결: 커뮤니티는 지도와 프로필 사이 탭, 글쓰기는 스택 화면', () => {
  assert.deepEqual(TAB_ITEMS.map((t) => t.key), ['Home', 'Candidates', 'Schedule', 'Map', 'Community', 'More']);
  assert.equal(TAB_ITEMS.find((t) => t.key === 'Community')?.label, '커뮤니티');
  assert.equal(SCREEN_META.Community.wp, 'WP6');
  assert.equal(SCREEN_META.CommunityCompose.wp, 'WP6');
  assert.equal(((linking.config as any).screens.Main.screens as Record<string, string>).Community, 'community');
  const nav = read('src/navigation/RootNavigator.tsx');
  assert.match(nav, /<Tabs\.Screen name="Community" component=\{CommunityScreen\} \/>/);
  assert.match(nav, /<Stack\.Screen name="CommunityCompose" component=\{CommunityComposeScreen\} \/>/);
});

test('화면 규칙: 로그인한 계정만 글쓰기, 사진은 버튼을 누를 때만 고르고, 두 번 보내지 않는다', () => {
  const compose = read('src/screens/CommunityComposeScreen.tsx');
  assert.match(compose, /session\?\.kind !== 'account'/);
  assert.equal((compose.match(/pickCommunityPhotos\(/g) ?? []).length, 1);
  assert.match(compose, /const addPhotos = async \(\) =>/);
  assert.match(compose, /if \(sending\.current\) return;/);
  assert.match(compose, /disabled=\{photos\.length >= PHOTOS_MAX \|\| busy\}/);
  const feed = read('src/screens/CommunityScreen.tsx');
  assert.match(feed, /const canPost = session\?\.kind === 'account'/);
  assert.match(feed, /useFocusEffect/);
  const card = read('src/features/community/components/PostCard.tsx');
  assert.equal((card.match(/accessibilityIgnoresInvertColors/g) ?? []).length, 1);
  const store = read('src/store/community.ts');
  assert.match(store, /if \(mine !== ticket\) return;/);
  const picker = read('src/services/community/picker.ts');
  assert.match(picker, /exif: false/);
  assert.match(picker, /base64: true/);
  // 웹은 quality를 무시하므로 캔버스로 줄여 한 장 한도 아래로 맞춘다
  assert.match(picker, /shrinkImageOnWeb/);
  assert.match(picker, /PHOTO_BYTES_MAX/);
});

test('연결: 일기 화면 → 커뮤니티 글쓰기, 채팅 메뉴 → 여행방 설정(프로필 탭에서는 뺐다)', () => {
  const diary = read('src/screens/DiaryScreen.tsx');
  assert.match(diary, /navigation\.navigate\('CommunityCompose', \{ tripId, date \}\)/);
  assert.match(diary, /entry && entry\.blocks\.length > 0/);
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /title="여행방 설정"[\s\S]{0,200}navigation\.navigate\('TripSettings', \{ tripId \}\)/);
  const more = read('src/screens/MoreScreen.tsx');
  assert.ok(!more.includes("label: '여행방 설정"), '프로필 탭 여행방 목록에는 여행방 설정이 없다');
});
