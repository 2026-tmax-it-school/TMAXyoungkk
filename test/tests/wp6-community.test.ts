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
  matchesSearch,
  normalizeSearch,
  SEARCH_MAX,
  searchTagPart,
  checkDraft,
  diaryAsText,
  EDIT_SAVED_TEXT,
  editContentOf,
  editDraftOf,
  editLeaveDecision,
  failText,
  isDirty,
  isEditDirty,
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
import type { CommunityDraft, CommunityPost } from '../src/core/ports';
import { TAB_ITEMS, SCREEN_META, linking } from '../src/navigation/routes';
import { createCommunityProvider, createHttpCommunity, createLocalCommunity } from '../src/services/community';
import * as server from '../server/community.mjs';
import { createSyncStore, startSyncServer } from '../server/sync-server.mjs';

/**
 * WP6 커뮤니티(2026-10-10): 앱 사용자 전체가 보는 사진·일기 글. 서버는 wp2-community가 본다.
 * 여기서는 앱 규칙(core/community)이 서버와 같은 값인지, 이 기기 모의 제공자, 앱 HTTP 제공자가 실제 서버와 맞물리는지,
 * 탭·화면 연결과 화면 소스 규칙을 본다.
 * 2026-10-17: 글 고치기(규칙·모의·HTTP ↔ 실제 서버·카드 '수정'·고치기는 임시 저장을 건드리지 않는다).
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

test('검색어 규칙은 앱과 서버가 같다(공백 정리·태그 쪽·맞춤)', async () => {
  assert.equal(SEARCH_MAX, server.SEARCH_MAX);
  for (const q of ['  바다   산책 ', '#Sea Side', 'JEJU', '맛', '###', '%']) {
    const srv = server.normalizeSearch(q);
    assert.equal(normalizeSearch(q) || null, srv === 'long' ? null : srv, q);
    if (typeof srv === 'string' && srv !== 'long') assert.equal(searchTagPart(srv), server.searchTagPart(srv), q);
  }
  const posts = [
    { title: 'Jeju 여행', tags: ['sea'] },
    { title: '부산 맛집', tags: ['맛집', '부산'] },
    { title: '글', tags: ['seaside'] },
    { title: '100% 후기', tags: ['후기_1'] },
  ];
  for (const q of ['jeju', '#SEA', '맛', '부산', '%', '_', 'seaside', '없는말', '#']) {
    for (const post of posts) assert.equal(matchesSearch(post, q), server.matchesSearch(post, q), `${q} / ${post.title}`);
  }
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

test('고치기 규칙: 처음 연 글과 비교해 묻고, 남긴 사진도 4장·사진 한 장으로 센다, 보낼 글은 남긴 사진 id를 따로', () => {
  const post: CommunityPost = {
    id: 'cmt-1',
    title: '제목',
    body: '본문',
    tags: ['바다'],
    authorId: 'u1',
    authorNickname: '민지',
    createdAt: 1,
    photos: [
      { id: 'cph-a', url: '/community/media/cph-a' },
      { id: 'cph-b', url: '/community/media/cph-b' },
    ],
    mine: true,
  };
  const o = editContentOf(post);
  assert.deepEqual(o, { title: '제목', body: '본문', tags: ['바다'], photos: [], kept: post.photos });
  assert.equal(isEditDirty({ ...o, body: '본문  ' }, o), false, '앞뒤 공백만 다르면 그대로');
  assert.equal(isEditDirty({ ...o, body: '고친 본문' }, o), true);
  assert.equal(isEditDirty({ ...o, kept: [post.photos[1], post.photos[0]] }, o), true, '사진 순서도 바뀐 것');
  assert.equal(isEditDirty({ ...o, kept: [post.photos[0]] }, o), true);
  assert.equal(isEditDirty({ ...o, photos: [photo()] }, o), true);
  assert.equal(isEditDirty({ ...o, tags: [] }, o), true);
  assert.equal(editLeaveDecision({ current: o, original: o, published: false }), 'leave');
  assert.equal(editLeaveDecision({ current: { ...o, title: '' }, original: o, published: false }), 'ask');
  assert.equal(editLeaveDecision({ current: { ...o, title: '' }, original: o, published: true }), 'leave');
  assert.equal(
    editLeaveDecision({ current: { title: '', body: '', tags: [], photos: [], kept: [] }, original: o, published: false }),
    'ask',
    '다 지워도 빈 글로 보고 넘기지 않는다(임시 저장의 clear가 없다)',
  );
  assert.deepEqual(editDraftOf({ ...o, title: ' 새 제목 ', photos: [photo()] }), {
    title: '새 제목',
    body: '본문',
    tags: ['바다'],
    photos: [photo()],
    keepPhotoIds: ['cph-a', 'cph-b'],
  });
  assert.ok(checkDraft(draft({ body: '' }), 1).ok, '남긴 사진 한 장이면 본문 없이 된다');
  assert.ok(!checkDraft(draft({ body: '' }), 0).ok);
  assert.match(checkDraft(draft({ photos: [photo(), photo(), photo()] }), 2).problem ?? '', /사진은 4장/);
  assert.ok(checkDraft(draft({ photos: [photo(), photo()] }), 2).ok);
  assert.equal(EDIT_SAVED_TEXT, '글을 고쳤어요');
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

  test('조회수·좋아요(2026-10-17): 좋아요는 로그인·한 번·취소, 조회는 한 번(본인 글 제외), 피드에 liked 표시', async () => {
    const c = createLocalCommunity({ clock, ids });
    const you = { userId: 'u2', nickname: '준호' };
    const made = await c.create(draft({ body: '반응 시험' }), me);
    assert.ok(made.ok);
    if (!made.ok) return;
    const id = made.value.id;
    assert.deepEqual(await c.like(id, true, {}), { ok: false, code: 'loginRequired' });
    assert.ok((await c.like(id, true, you)).ok);
    const again = await c.like(id, true, you);
    assert.ok(again.ok && again.value.likes === 1 && again.value.liked === true, '두 번 눌러도 한 번');
    const feed = await c.list({}, you);
    assert.ok(feed.ok && feed.value.posts[0].liked === true && feed.value.posts[0].likes === 1);
    const cancel = await c.like(id, false, you);
    assert.ok(cancel.ok && cancel.value.likes === 0 && cancel.value.liked === false);
    assert.deepEqual(await c.view(id, you), { ok: true, value: 1 });
    assert.deepEqual(await c.view(id, you), { ok: true, value: 1 }, '같은 사람은 한 번');
    assert.deepEqual(await c.view(id, me), { ok: true, value: 1 }, '본인 글은 안 센다');
    assert.deepEqual(await c.view('nope', you), { ok: false, code: 'notFound' });
  });

  test('글 카드와 피드: 좋아요·조회 표시, 게스트 안내, 화면에 보이면 조회', () => {
    const card = read('src/features/community/components/PostCard.tsx');
    assert.match(card, /`좋아요 \$\{post\.likes \?\? 0\}`/);
    assert.match(card, /`조회 \$\{post\.views \?\? 0\}`/);
    const feed = read('src/screens/CommunityScreen.tsx');
    assert.match(feed, /onViewableItemsChanged/);
    assert.match(feed, /로그인하면 좋아요를 누를 수 있어요/);
  });

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

  test('고치기: 내 글만, 남길 사진은 그 글의 것만, 남긴 사진 → 새 사진 순서, editedAt, 검사는 올리기와 같다', async () => {
    const c = createLocalCommunity({ clock, ids });
    const made = await c.create(draft({ body: '처음', tags: ['바다'], photos: [photo(), photo()] }), me);
    assert.ok(made.ok);
    if (!made.ok) return;
    assert.equal(made.value.editedAt, undefined);
    const [a, b] = made.value.photos;
    const keep = (keepPhotoIds: string[], p: Partial<CommunityDraft> = {}) => ({ ...draft(p), keepPhotoIds });
    assert.deepEqual(await c.update(made.value.id, keep([]), {}), { ok: false, code: 'loginRequired' });
    const other = await c.update(made.value.id, keep([]), { userId: 'u2' });
    assert.ok(!other.ok && other.code === 'notFound');
    const missing = await c.update('cmt-nope', keep([]), me);
    assert.ok(!missing.ok && missing.code === 'notFound');
    const foreign = await c.update(made.value.id, keep(['cph-x']), me);
    assert.ok(!foreign.ok && foreign.code === 'badPost');
    const empty = await c.update(made.value.id, keep([], { body: ' ' }), me);
    assert.ok(!empty.ok && empty.code === 'badPost');
    const tooMany = await c.update(made.value.id, keep([a.id, b.id], { photos: [photo(), photo(), photo()] }), me);
    assert.ok(!tooMany.ok && tooMany.code === 'badPost');
    const ok = await c.update(made.value.id, keep([b.id], { title: ' 새 제목 ', body: ' 고침 ', tags: ['카페'], photos: [photo()] }), me);
    assert.ok(ok.ok, JSON.stringify(ok));
    if (!ok.ok) return;
    assert.equal(ok.value.id, made.value.id);
    assert.equal(ok.value.title, '새 제목');
    assert.equal(ok.value.body, '고침');
    assert.deepEqual(ok.value.tags, ['카페']);
    assert.equal(ok.value.photos.length, 2);
    assert.equal(ok.value.photos[0].id, b.id);
    assert.match(c.photoUri(ok.value.photos[1]), /^data:image\/jpeg;base64,/);
    assert.equal(ok.value.editedAt, clock.now());
    assert.equal(ok.value.createdAt, made.value.createdAt);
    const list = await c.list({}, me);
    assert.ok(list.ok && list.value.posts.find((p) => p.id === made.value.id)?.body === '고침');
    const byOld = await c.list({ tag: '바다' }, me);
    assert.ok(byOld.ok && !byOld.value.posts.some((p) => p.id === made.value.id));
  });

  test('서버 주소가 있으면 서버 제공자, 없으면 모의', () => {
    assert.equal(createCommunityProvider({ clock, ids }).id, 'local');
    assert.equal(createCommunityProvider({ serverUrl: 'http://x', fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }), clock, ids }).id, 'server');
  });
});

describe('이 기기 모의 커뮤니티: 검색', () => {
  const clock = { now: () => Date.UTC(2026, 9, 17, 3, 0, 0) };
  let n = 0;
  const ids = { next: (p: string) => `${p}_${(n += 1)}` };
  const me = { userId: 'u1', nickname: '민지' };

  test('q는 제목·태그만 본다(본문은 안 본다), 태그·쪽 나누기와 같이 쓴다', async () => {
    const c = createLocalCommunity({ clock, ids });
    await c.create(draft({ title: 'Jeju 바다', body: '본문 우도땅콩', tags: ['여행', 'sea'] }), me);
    await c.create(draft({ title: '부산 맛집', body: '국밥', tags: ['맛집'] }), me);
    const titles = async (q: { q?: string; tag?: string }) => {
      const r = await c.list(q, me);
      assert.ok(r.ok);
      return r.ok ? r.value.posts.map((p) => p.title).sort() : [];
    };
    assert.deepEqual(await titles({ q: 'jeju' }), ['Jeju 바다']);
    assert.deepEqual(await titles({ q: '#SEA' }), ['Jeju 바다']);
    assert.deepEqual(await titles({ q: '맛' }), ['부산 맛집']);
    assert.deepEqual(await titles({ q: '우도땅콩' }), []);
    assert.deepEqual(await titles({ q: '여행', tag: '맛집' }), []);
    assert.deepEqual(await titles({ q: '' }), ['Jeju 바다', '부산 맛집']);
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

  test('글 고치기가 서버와 맞물린다: 남긴 사진은 id로, 새 사진은 base64로, editedAt을 받는다, 남의 글은 notFound', async () => {
    const c = createHttpCommunity({ url: srv.url, fetch: (url, init) => fetch(url, init) });
    const made = await c.create(draft({ body: '처음', tags: ['바다'], photos: [photo(), photo()] }), { token });
    assert.ok(made.ok, JSON.stringify(made));
    if (!made.ok) return;
    assert.equal(made.value.editedAt, undefined, '고친 적 없는 글에는 editedAt이 없다');
    const [a, b] = made.value.photos;
    assert.deepEqual(await c.update(made.value.id, { ...draft(), keepPhotoIds: [] }, {}), { ok: false, code: 'loginRequired' });
    const r = await c.update(made.value.id, { title: '고친 제목', body: '고친 글', tags: ['카페'], photos: [photo()], keepPhotoIds: [b.id] }, { token });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.value.id, made.value.id);
    assert.equal(r.value.title, '고친 제목');
    assert.deepEqual(r.value.tags, ['카페']);
    assert.equal(typeof r.value.editedAt, 'number');
    assert.equal(r.value.photos.length, 2);
    assert.equal(r.value.photos[0].id, b.id);
    assert.equal((await fetch(c.photoUri(a))).status, 404, '뺀 사진은 서버에서 지운다');
    assert.equal((await fetch(c.photoUri(r.value.photos[1]))).status, 200);
    const listed = await c.list({}, { token });
    assert.ok(listed.ok && listed.value.posts.find((p) => p.id === made.value.id)?.editedAt === r.value.editedAt);
    const bad = await c.update(made.value.id, { ...draft({ body: '' }), keepPhotoIds: [] }, { token });
    assert.ok(!bad.ok && bad.code === 'badPost' && !!bad.detail);
    const gone = await c.update('cmt-nope', { ...draft(), keepPhotoIds: [] }, { token });
    assert.ok(!gone.ok && gone.code === 'notFound');
  });

  test('서버에 닿지 못하면 unreachable', async () => {
    const dead = createHttpCommunity({ url: 'http://127.0.0.1:1', fetch: (url, init) => fetch(url, init), timeoutMs: 2000 });
    const r = await dead.list({}, {});
    assert.ok(!r.ok && r.code === 'unreachable');
  });
});

test('탭·화면 연결: 커뮤니티는 지도와 프로필 사이 탭, 글쓰기는 스택 화면', () => {
  // 하단 탭 다섯 칸. 셋째 칸은 그룹 채팅, 일정·후보는 칸 없이 탭 라우트로 남는다
  assert.deepEqual(TAB_ITEMS.map((t) => t.key), ['Home', 'Map', 'ChatList', 'Community', 'More']);
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
  assert.match(compose, /disabled=\{photos\.length \+ kept\.length >= PHOTOS_MAX \|\| busy\}/, '고치기의 남긴 사진도 4장에 센다');
  const feed = read('src/screens/CommunityScreen.tsx');
  assert.match(feed, /const canPost = session\?\.kind === 'account'/);
  assert.match(feed, /useFocusEffect/);
  assert.match(feed, /<FlatList/);
  assert.match(feed, /RefreshControl/);
  assert.match(feed, /onEndReached=/);
  assert.match(feed, /setLoginAsk\(true\)/, '게스트가 글쓰기를 누르면 로그인 안내');
  assert.ok(!/key: 'photo'|key: 'diary'/.test(feed), '사진·일기 나누기 대신 태그로 거른다(Seg는 이야기·여행 일정 탭뿐)');
  assert.match(feed, /key: 'plans', label: '여행 일정'/);
  assert.match(feed, /<ItineraryFeed/);
  const card = read('src/features/community/components/PostCard.tsx');
  assert.equal((card.match(/accessibilityIgnoresInvertColors/g) ?? []).length, 1);
  assert.match(card, /<PhotoViewer/);
  assert.match(card, /onTagPress/);
  const store = read('src/store/community.ts');
  assert.match(store, /if \(mine !== ticket\) return;/);
  const picker = read('src/services/community/picker.ts');
  assert.match(picker, /exif: false/);
  assert.match(picker, /base64: true/);
  // 웹은 quality를 무시하므로 캔버스로 줄여 한 장 한도 아래로 맞춘다
  assert.match(picker, /shrinkImageOnWeb/);
  assert.match(picker, /PHOTO_BYTES_MAX/);
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

test('고치기 화면 규칙: 내 글 카드에 수정·삭제, 수정됨 표시, 고치기는 새 글 임시 저장을 읽지도 덮지도 지우지도 않는다', () => {
  const card = read('src/features/community/components/PostCard.tsx');
  assert.match(card, /accessibilityLabel="내 글 수정" onPress=\{\(\) => onEdit\(post\)\}/);
  assert.match(card, /<Txt v="mtTight">수정<\/Txt>/);
  assert.ok(card.indexOf('내 글 수정') < card.indexOf('내 글 삭제'), '수정이 삭제 앞(옆)');
  assert.ok(card.indexOf('{post.mine ? (') < card.indexOf('내 글 수정'), '내 글에만 보인다');
  assert.match(card, /post\.editedAt != null \? `\$\{timeAgo\(post\.createdAt, now\)\} · 수정됨`/);
  const feed = read('src/screens/CommunityScreen.tsx');
  assert.match(feed, /navigation\.navigate\('CommunityCompose', \{ editPostId: p\.id \}\)/);
  const store = read('src/store/community.ts');
  assert.match(store, /community\.update\(postId, draft, await ctxNow\(\)\)/);
  assert.match(store, /get\(\)\.posts\.map\(\(p\) => \(p\.id === postId \? r\.value : p\)\)/, '피드는 제자리에서 바뀐다');

  const compose = read('src/screens/CommunityComposeScreen.tsx');
  assert.match(compose, /const draftUser = editing \? undefined : userId;/);
  // 임시 저장소를 쓰는 곳은 모두 draftUser로만 부른다(고치기에서는 없다). 최근 태그 읽기만 고치기에서도 쓴다
  const calls = [...compose.matchAll(/communityDrafts\(\)\s*\.(\w+)\(([^,)]*)/g)].map((m) => [m[1], m[2].trim()]);
  assert.ok(calls.length >= 4);
  for (const [fn, arg] of calls) {
    if (fn === 'recentTags' && arg === 'userId') continue;
    if (fn === 'rememberTags' || (fn === 'clear' && arg === 'session.userId')) continue;
    assert.equal(arg, 'draftUser', `communityDrafts().${fn}(${arg})`);
  }
  assert.match(compose, /if \(!draftUser\) return;\n    let live = true;/, '여는 때 임시 저장 읽기는 새 글만');
  assert.match(compose, /if \(!draftUser\) return true;/, '자동 저장은 새 글만');
  // 고치기 저장 갈래는 새 글 올리기 갈래보다 앞에서 끝나고, 그 안에서 임시 저장을 부르지 않는다
  const branch = compose.slice(compose.indexOf('if (editPostId) {'), compose.indexOf('const r = await publish(draft);'));
  assert.ok(branch.length > 0 && !branch.includes('communityDrafts'));
  assert.match(branch, /showToast\(EDIT_SAVED_TEXT\)/);
  // 새 글 임시 저장을 지우는 store.clear(session.userId)와 startFresh는 고치기에서 닿지 않는다(올리기 갈래·새로 쓰기 시트 뒤)
  assert.ok(compose.indexOf('await store.clear(session.userId)') > compose.indexOf('const r = await publish(draft);'));
  assert.match(compose, /title=\{editing \? '글 수정' : '글쓰기'\}/);
  assert.match(compose, /title=\{busy \? '저장하는 중' : '저장하기'\}/);
  assert.match(compose, /editLeaveDecision\(/);
  assert.match(compose, /visible=\{leaving && editing\}/);
  assert.match(compose, /visible=\{leaving && !editing\}/);
  assert.match(compose, /getServices\(\)\.community\.photoUri\(p\)/, '남긴 사진은 서버 주소로 보인다');
  assert.match(compose, /pickCommunityPhotos\(photos\.length \+ kept\.length\)/);
});

test('연결: 여행일지 화면 → 커뮤니티 글쓰기, 채팅 메뉴 → 여행방 설정(프로필 탭에서는 뺐다)', () => {
  const diary = read('src/screens/JournalScreen.tsx');
  assert.match(diary, /navigation\.navigate\('CommunityCompose', \{ tripId, date \}\)/);
  assert.match(diary, /entry && entry\.blocks\.length > 0/);
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /label="지역"[\s\S]{0,120}onPress=\{openTripSettings\}/);
  assert.match(chat, /navigation\.navigate\('TripSettings', \{ tripId \}\)/);
  const more = read('src/screens/MoreScreen.tsx');
  assert.ok(!more.includes("label: '여행방 설정"), '프로필 탭 여행방 목록에는 여행방 설정이 없다');
});

test('검색 화면 규칙: 글자를 멈추면 검색, 엔터·검색 버튼은 바로, 지우면 전체, 결과 없음 안내, 스토어는 늦은 응답을 버린다', () => {
  const feed = read('src/screens/CommunityScreen.tsx');
  assert.match(feed, /const SEARCH_DEBOUNCE_MS = 400;/);
  assert.match(feed, /setTimeout\(\(\) => setQuery\(text\), text\.trim\(\) \? SEARCH_DEBOUNCE_MS : 0\)/);
  assert.match(feed, /onSubmitEditing=\{\(\) => setQuery\(text\)\}/);
  assert.match(feed, /label="검색어 지우기"/);
  assert.match(feed, /검색 결과가 없어요/);
  const store = read('src/store/community.ts');
  assert.match(store, /community\.list\(\{ tag, q: query \|\| null \}/);
  assert.match(store, /community\.list\(\{ before: next, tag, q: query \|\| null \}/);
  assert.match(store, /if \(mine !== ticket\) return;/);
  const http = read('src/services/community/http.ts');
  assert.match(http, /params\.set\('q', q\.q\)/);
});

test('채팅 멤버 시트: 메뉴에서 열고, 방장만 방장 아닌 멤버를 내보낸다(확인 1회, member/remove)', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /label=\{`멤버 \$\{active\.length\}명 보기`\}[\s\S]{0,160}setMembersOpen\(true\)/);
  assert.match(chat, /me && isHost\(trip, me\) && m\.role !== 'host'/);
  assert.match(chat, /<Btn title="내보내기" size="sm" variant="quiet" onPress=\{\(\) => setRemoving/);
  assert.match(chat, /type: 'member\/remove', memberId: removing\.id/);
  assert.match(chat, /title=\{`\$\{removing\?\.nickname \?\? ''\}님을 내보낼까요`\}/);
});

test('멤버 초대 화면: 링크 아래에 초대 코드와 코드 복사가 있다(링크를 못 여는 사람에게 말로 알려 주는 용)', () => {
  const members = read('src/screens/MembersScreen.tsx');
  assert.match(members, /<Txt v="label">초대 코드<\/Txt>/);
  assert.match(members, /\{inv\.code\}/);
  assert.match(members, /accessibilityLabel="초대 코드 복사"[\s\S]{0,120}copyInviteCode\(trip\)/);
  const actions = read('src/features/trip/actions.ts');
  assert.match(actions, /export async function copyInviteCode\(trip: Trip\)/);
  assert.match(actions, /copyText\(code\)/);
});

test('커뮤니티 새로 고침은 전용 아이콘(refresh), 프로필 탭 시연 도구에는 화면 목록이 없다', () => {
  assert.match(read('src/screens/CommunityScreen.tsx'), /<IconBtn icon="refresh" label="새로 고침"/);
  assert.match(read('src/ui/Icon.tsx'), /^  refresh: \[/m);
  const more = read('src/screens/MoreScreen.tsx');
  assert.ok(!more.includes("label={showScreens ? '화면 목록 닫기' : '화면 목록 열기'}"));
  assert.ok(!more.includes('ALL_TRIP_ROUTES'));
  assert.ok(!more.includes('SCREEN_META'));
});
