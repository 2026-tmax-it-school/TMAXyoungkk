import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import {
  BODY_MAX,
  EMPTY_CONTENT,
  PHOTO_BYTES_MAX,
  PHOTOS_MAX,
  TAG_LEN_MAX,
  TAGS_MAX,
  TITLE_MAX,
  addTag,
  base64Bytes,
  checkDraft,
  diaryAsText,
  failText,
  isDirty,
  leaveDecision,
  normalizeTag,
  openPlan,
  parsePhotoRecord,
  parseTextRecord,
  photoRecord,
  photoSignature,
  popularTags,
  rememberTags,
  resolvePhotoUrl,
  splitTagInput,
  tagSuggestions,
  textRecord,
  timeAgo,
  withPendingTag,
  type ComposeContent,
  type SavedDraft,
} from '../src/core/community';
import { createDraftStore } from '../src/services/community/drafts';
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
const draft = (p: Partial<CommunityDraft> = {}): CommunityDraft => ({ title: '', body: '오늘', tags: [], photos: [], ...p });

test('앱 규칙 값은 서버와 같다(제목·본문·사진 수·사진 크기)', () => {
  assert.equal(TITLE_MAX, server.TITLE_MAX);
  assert.equal(BODY_MAX, server.BODY_MAX);
  assert.equal(PHOTOS_MAX, server.PHOTOS_MAX);
  assert.equal(PHOTO_BYTES_MAX, server.PHOTO_BYTES_MAX);
  assert.equal(TAGS_MAX, server.TAGS_MAX);
  assert.equal(TAG_LEN_MAX, server.TAG_LEN_MAX);
});

test('태그 맞추기는 앱과 서버가 같다', () => {
  const samples = ['#맛집', '  ##제주 바다 ', 'CAFE', 'Cafe_2', '가'.repeat(TAG_LEN_MAX), '가'.repeat(TAG_LEN_MAX + 1), 'a-b', '#', '', '한글 English 1', 'ｃａｆｅ', '\u1100\u1161'];
  for (const raw of samples) assert.equal(normalizeTag(raw), server.normalizeTag(raw), JSON.stringify(raw));
});

test('태그 입력: 띄어쓰기·쉼표·#로 나누고, 겹치면 하나, 5개·규칙을 넘으면 이유', () => {
  assert.deepEqual(splitTagInput('맛집 카페,풍'), { done: ['맛집', '카페'], rest: '풍' });
  assert.deepEqual(splitTagInput('#맛집#카페'), { done: ['#맛집'], rest: '카페' });
  assert.deepEqual(splitTagInput('조합중'), { done: [], rest: '조합중' });
  assert.deepEqual(addTag([], '#Sea'), { tags: ['sea'] });
  assert.deepEqual(addTag(['sea'], 'SEA'), { tags: ['sea'] });
  assert.match(addTag([], 'a-b').problem ?? '', /태그는/);
  assert.match(addTag(['a', 'b', 'c', 'd', 'e'], 'f').problem ?? '', /5개/);
  assert.deepEqual(addTag(['a'], '   '), { tags: ['a'] });
  assert.deepEqual(withPendingTag(['a'], '카페'), ['a', '카페']);
  assert.deepEqual(withPendingTag(['a'], 'a-b'), ['a']);
  assert.deepEqual(popularTags([{ tags: ['a', 'b'] }, { tags: ['b'] }, { tags: ['c', 'b', 'a'] }]), ['b', 'a', 'c']);
  const sug = tagSuggestions({ current: ['맛집'], region: '경주', recent: ['바다', '맛집'] });
  assert.equal(sug[0], '경주');
  assert.ok(sug.includes('바다') && !sug.includes('맛집') && sug.includes('카페'));
  assert.deepEqual(rememberTags(['a', 'b'], ['b', 'c']), ['b', 'c', 'a']);
});

test('임시 저장 규칙: 나갈 때 묻기·지우기·그냥 나가기, 열 때 이어 쓰기·일기·고르기', () => {
  const c = (p: Partial<ComposeContent> = {}): ComposeContent => ({ ...EMPTY_CONTENT, ...p });
  assert.equal(leaveDecision({ current: c({ body: '쓰는 중' }), saved: null, published: false }), 'ask');
  assert.equal(leaveDecision({ current: c({ body: '쓰는 중' }), saved: c({ body: '쓰는 중' }), published: false }), 'leave');
  assert.equal(leaveDecision({ current: c({ body: '쓰는 중' }), saved: null, published: true }), 'leave');
  assert.equal(leaveDecision({ current: c({ body: '  ' }), saved: null, published: false }), 'leave');
  assert.equal(leaveDecision({ current: c(), saved: c({ body: '예전 글' }), published: false }), 'clear');
  assert.equal(isDirty(c({ tags: ['a'] }), null), true);
  assert.equal(isDirty(c({ photos: [photo()] }), c({ photos: [photo()] })), false);
  const saved: SavedDraft = { ...c({ body: '예전' }), origin: { tripId: 't1', date: '2026-10-03' }, updatedAt: 1 };
  assert.equal(openPlan({ saved: null, origin: null }), 'fresh');
  assert.equal(openPlan({ saved: null, origin: { tripId: 't1', date: '2026-10-03' } }), 'diary');
  assert.equal(openPlan({ saved, origin: null }), 'restore');
  assert.equal(openPlan({ saved, origin: { tripId: 't1', date: '2026-10-03' } }), 'restore');
  assert.equal(openPlan({ saved, origin: { tripId: 't1', date: '2026-10-04' } }), 'ask');
  assert.equal(openPlan({ saved: { ...saved, body: '' }, origin: null }), 'fresh');
});

test('임시 저장 기록: 글과 사진을 따로 두고, 사진 서명이 맞을 때만 되살린다. 깨진 기록은 없는 것으로', () => {
  const d: SavedDraft = { title: '제목', body: '본문', tags: ['맛집'], photos: [photo()], origin: null, updatedAt: 5 };
  const t = parseTextRecord(textRecord(d));
  assert.ok(t);
  assert.equal(t!.body, '본문');
  assert.equal(t!.photoSig, photoSignature(d.photos));
  assert.deepEqual(parsePhotoRecord(photoRecord(d.photos), t!.photoSig), d.photos);
  assert.equal(parsePhotoRecord(photoRecord([photo(Buffer.from([0xff, 0xd8, 0xff, 1]))]), t!.photoSig), null);
  assert.equal(parseTextRecord('{oops'), null);
  assert.equal(parseTextRecord(JSON.stringify({ v: 999, body: 'x' })), null);
  assert.equal(parseTextRecord(null), null);
});

describe('임시 저장소(KV)', () => {
  const memKv = (failPhotos = false) => {
    const m = new Map<string, string>();
    return {
      m,
      kv: {
        get: async (k: string) => m.get(k) ?? null,
        set: async (k: string, v: string) => {
          if (failPhotos && k.includes('draft-photos')) throw new Error('quota');
          m.set(k, v);
        },
        remove: async (k: string) => {
          m.delete(k);
        },
      },
    };
  };
  const d = (p: Partial<SavedDraft> = {}): SavedDraft => ({ title: '', body: '쓰는 중', tags: ['카페'], photos: [photo()], origin: null, updatedAt: 9, ...p });

  test('저장하고 다시 읽으면(앱을 다시 연 것처럼 새 저장소) 글·태그·사진이 그대로, 사람마다 따로', async () => {
    const { kv } = memKv();
    await createDraftStore(kv as never).save('u1', d());
    const again = createDraftStore(kv as never);
    const got = await again.load('u1');
    assert.equal(got?.body, '쓰는 중');
    assert.deepEqual(got?.tags, ['카페']);
    assert.deepEqual(got?.photos, d().photos);
    assert.equal(await again.load('u2'), null);
    await again.clear('u1');
    assert.equal(await again.load('u1'), null);
  });

  test('사진 저장이 실패해도 글은 남고 failed를 알린다. 예전 사진은 섞이지 않는다', async () => {
    const { kv } = memKv(true);
    const store = createDraftStore(kv as never);
    const r = await store.save('u1', d());
    assert.deepEqual(r, { ok: true, photos: 'failed' });
    const got = await createDraftStore(kv as never).load('u1');
    assert.equal(got?.body, '쓰는 중');
    assert.deepEqual(got?.photos, []);
  });

  test('사진이 같으면 다시 쓰지 않는다, 빈 글을 저장하면 지운다, 최근 태그를 기억한다', async () => {
    const { kv, m } = memKv();
    const store = createDraftStore(kv as never);
    assert.equal((await store.save('u1', d())).photos, 'saved');
    assert.equal((await store.save('u1', d({ body: '더 씀' }))).photos, 'unchanged');
    await store.save('u1', d({ body: '', tags: [], photos: [] }));
    assert.equal([...m.keys()].filter((k) => k.includes('draft')).length, 0);
    await store.rememberTags('u1', ['바다', '맛집']);
    await store.rememberTags('u1', ['카페']);
    assert.deepEqual(await store.recentTags('u1'), ['카페', '바다', '맛집']);
  });
});

test('글 검사: 서버가 거절할 글을 미리 막는다', () => {
  assert.equal(checkDraft(draft()).ok, true);
  assert.equal(checkDraft(draft({ body: '', photos: [photo()] })).ok, true);
  assert.equal(checkDraft(draft({ body: '설명', photos: [] })).ok, true);
  assert.match(checkDraft(draft({ body: '   ' })).problem ?? '', /사진을 고르거나 내용을/);
  assert.match(checkDraft(draft({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).problem ?? '', /5개/);
  assert.match(checkDraft(draft({ tags: ['Cafe'] })).problem ?? '', /태그는/);
  assert.match(checkDraft(draft({ title: 'x'.repeat(TITLE_MAX + 1) })).problem ?? '', /제목/);
  assert.match(checkDraft(draft({ body: 'x'.repeat(BODY_MAX + 1) })).problem ?? '', /본문/);
  assert.match(checkDraft(draft({ photos: Array.from({ length: PHOTOS_MAX + 1 }, () => photo()) })).problem ?? '', /사진은/);
  const big = Buffer.alloc(PHOTO_BYTES_MAX + 10).toString('base64');
  assert.match(checkDraft(draft({ photos: [{ mime: 'image/jpeg', data: big }] })).problem ?? '', /너무 큽니다/);
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
    const bad = await c.create(draft({ body: ' ', photos: [] }), me);
    assert.ok(!bad.ok && bad.code === 'badPost');
    const a = await c.create(draft({ body: '첫 글', tags: ['맛집'] }), me);
    const b = await c.create(draft({ body: '', photos: [photo()], tags: ['풍경'] }), { userId: 'u2', nickname: '준호' });
    assert.ok(a.ok && b.ok);
    const list = await c.list({}, me);
    assert.ok(list.ok);
    if (list.ok) {
      assert.equal(list.value.posts.length, 2);
      assert.equal(list.value.posts.find((p) => p.authorId === 'u1')?.mine, true);
      assert.equal(list.value.posts.find((p) => p.authorId === 'u2')?.mine, false);
      const withPhoto = list.value.posts.find((p) => p.photos.length > 0);
      assert.match(c.photoUri(withPhoto!.photos[0]), /^data:image\/jpeg;base64,/);
    }
    const other = await c.remove(a.ok ? a.value.id : '', { userId: 'u2' });
    assert.ok(!other.ok && other.code === 'notFound');
    assert.deepEqual(await c.remove(a.ok ? a.value.id : '', me), { ok: true, value: true });
    const byTag = await c.list({ tag: '풍경' }, me);
    assert.ok(byTag.ok && byTag.value.posts.length === 1 && byTag.value.posts.every((p) => p.tags.includes('풍경')));
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
    const made = await c.create(draft({ title: '불국사', body: '설명', tags: ['#경주 여행'], photos: [photo()] }), { token });
    assert.ok(made.ok, JSON.stringify(made));
    if (!made.ok) return;
    assert.equal(made.value.authorNickname, '앱사용자');
    assert.equal(made.value.mine, true);
    assert.deepEqual(made.value.tags, ['경주여행']);
    const url = c.photoUri(made.value.photos[0]);
    assert.ok(url.startsWith(srv.url));
    assert.equal((await fetch(url)).status, 200);
    const listed = await c.list({}, { token });
    assert.ok(listed.ok && listed.value.posts.some((p) => p.id === made.value.id && p.mine));
    const anon = await c.list({ tag: '경주여행' }, {});
    assert.ok(anon.ok && anon.value.posts.length > 0 && anon.value.posts.every((p) => !p.mine && p.tags.includes('경주여행')));
    const bad = await c.create(draft({ body: '', photos: [] }), { token });
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
  // 하단 탭 다섯 칸. 후보는 칸 없이 탭 라우트로 남는다(일정 탭의 '시간표 | 후보'로 오간다)
  assert.deepEqual(TAB_ITEMS.map((t) => t.key), ['Home', 'Schedule', 'Map', 'Community', 'More']);
  assert.equal(TAB_ITEMS.find((t) => t.key === 'Community')?.label, '커뮤니티');
  assert.equal(SCREEN_META.Community.wp, 'WP6');
  assert.equal(SCREEN_META.CommunityCompose.wp, 'WP6');
  assert.equal(((linking.config as any).screens.Main.screens as Record<string, string>).Community, 'community');
  const nav = read('src/navigation/RootNavigator.tsx');
  assert.match(nav, /<Tabs\.Screen name="Community" component=\{CommunityScreen\} \/>/);
  assert.match(nav, /<Tabs\.Screen name="Candidates" component=\{CandidatesScreen\} \/>/);
  assert.equal(((linking.config as any).screens.Main.screens as Record<string, string>).Candidates, 'candidates');
  assert.match(nav, /<Stack\.Screen name="CommunityCompose" component=\{CommunityComposeScreen\} \/>/);
});

test('화면 규칙: 로그인한 계정만 글쓰기, 사진은 버튼을 누를 때만 고르고, 두 번 보내지 않는다', () => {
  const compose = read('src/screens/CommunityComposeScreen.tsx');
  assert.match(compose, /session\?\.kind !== 'account'/);
  assert.ok(!/CommunityKind|KIND_LABEL|<Choice/.test(compose), '사진·일기 고르기가 없다');
  assert.equal((compose.match(/pickCommunityPhotos\(/g) ?? []).length, 1);
  assert.match(compose, /const addPhotos = async \(\) =>/);
  assert.match(compose, /if \(sending\.current\) return;/);
  assert.match(compose, /disabled=\{photos\.length >= PHOTOS_MAX \|\| busy\}/);
  const feed = read('src/screens/CommunityScreen.tsx');
  assert.match(feed, /const canPost = session\?\.kind === 'account'/);
  assert.match(feed, /useFocusEffect/);
  assert.match(feed, /<FlatList/);
  assert.match(feed, /RefreshControl/);
  assert.match(feed, /onEndReached=/);
  assert.match(feed, /setLoginAsk\(true\)/, '게스트가 글쓰기를 누르면 로그인 안내');
  assert.ok(!/<Seg/.test(feed), '사진·일기 나누기 대신 태그로 거른다');
  const card = read('src/features/community/components/PostCard.tsx');
  assert.equal((card.match(/accessibilityIgnoresInvertColors/g) ?? []).length, 1);
  assert.match(card, /<PhotoViewer/);
  assert.match(card, /onTagPress/);
  const store = read('src/store/community.ts');
  assert.match(store, /if \(mine !== ticket\) return;/);
  const picker = read('src/services/community/picker.ts');
  assert.match(picker, /exif: false/);
  assert.match(picker, /base64: true/);
});

test('나가기 확인: beforeRemove로 막고, 시트 버튼은 저장하고 나가기·취소 둘뿐, 앱이 뒤로 가면 저장', () => {
  const compose = read('src/screens/CommunityComposeScreen.tsx');
  assert.match(compose, /addListener\('beforeRemove'/);
  assert.match(compose, /e\.preventDefault\(\);/);
  assert.match(compose, /leaveDecision\(/);
  assert.match(compose, /title="나가시겠습니까\?"/);
  assert.match(compose, /confirmLabel="저장하고 나가기"/);
  const sheet = read('src/ui/Sheet.tsx');
  const confirm = sheet.slice(sheet.indexOf('export function ConfirmSheet'));
  assert.equal((confirm.match(/<Btn /g) ?? []).length, 2, 'ConfirmSheet 버튼은 확인·취소 둘');
  assert.match(confirm, /title=\{cancelLabel\}/);
  assert.match(confirm, /cancelLabel = '취소'/);
  assert.match(compose, /AppState\.addEventListener\('change'/);
  assert.match(compose, /사진은 임시 저장하지 못했어요/);
  assert.match(compose, /published\.current = true/);
});

test('연결: 일기 화면 → 커뮤니티 글쓰기, 채팅 메뉴 → 여행방 설정(프로필 탭에서는 뺐다)', () => {
  const diary = read('src/screens/DiaryScreen.tsx');
  assert.match(diary, /navigation\.navigate\('CommunityCompose', \{ tripId, date \}\)/);
  assert.match(diary, /entry && entry\.blocks\.length > 0/);
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /(?:title|label)="여행방 설정"[\s\S]{0,300}navigation\.navigate\('TripSettings', \{ tripId \}\)/);
  const more = read('src/screens/MoreScreen.tsx');
  assert.ok(!more.includes("label: '여행방 설정"), '프로필 탭 여행방 목록에는 여행방 설정이 없다');
});
