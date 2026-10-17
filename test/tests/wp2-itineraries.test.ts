import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { DAYS_MAX, PLACES_PER_DAY_MAX, RATE_LIMIT, TITLE_MAX, matches, parseItineraryInput, popularity } from '../server/itineraries.mjs';
import { migrate } from '../server/db/migrate.mjs';
import { createPostgresStore, sqlDb } from '../server/db/postgres-store.mjs';
import { createSyncStore, startSyncServer, type SyncStore } from '../server/sync-server.mjs';

/**
 * WP2 일정 공유 서버(server/itineraries.mjs, 2026-10-17). 메모리 저장소와 PGlite로 같은 HTTP 시나리오를 돈다:
 * 올리기(로그인)·둘러보기(인기·최신·조회순, 검색, 지역)·조회수(같은 사람은 하루 한 번)·좋아요(한 번만)·가져오기 수·지우기(본인만)·탈퇴.
 */

const T0 = Date.UTC(2026, 9, 17, 1, 0, 0);
const MIN = 60 * 1000;
const PW = 'trip2026ok';
type Json = Record<string, any>;

const place = (name: string, lat = 35.8, lng = 129.2) => ({ name, category: '관광지', coord: { latitude: lat, longitude: lng } });
const plan = (over: Json = {}) => ({
  title: '경주 2박 3일',
  regionId: 'gyeongju',
  regionLabel: '경주',
  note: '천천히 걷는 코스',
  tags: ['#한옥', '야경'],
  days: [{ title: '1일차', places: [place('불국사'), place('석굴암')] }, { title: '2일차', places: [place('대릉원')] }],
  base: { name: '경주역', coord: { latitude: 35.84, longitude: 129.21 } },
  ...over,
});

const BACKENDS: { name: string; open: () => Promise<{ store: SyncStore; close(): Promise<void> }> }[] = [
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

test('일정 검사: 이름·지역·장소·좌표·한도, 태그는 맞춰서', () => {
  const ok = parseItineraryInput(plan());
  assert.ok(!('error' in ok));
  if (!('error' in ok)) {
    assert.deepEqual(ok.tags, ['한옥', '야경']);
    assert.equal(ok.placeCount, 3);
    assert.equal(ok.base?.name, '경주역');
  }
  const bad = (b: unknown) => {
    const r = parseItineraryInput(b);
    return 'error' in r ? r.detail : null;
  };
  assert.ok(bad(null));
  assert.match(bad(plan({ title: ' ' }))!, /이름/);
  assert.match(bad(plan({ title: 'x'.repeat(TITLE_MAX + 1) }))!, /이름/);
  assert.match(bad(plan({ regionId: '' }))!, /지역/);
  assert.match(bad(plan({ tags: '맛집' }))!, /태그/);
  assert.match(bad(plan({ days: [] }))!, /날짜별/);
  assert.match(bad(plan({ days: Array.from({ length: DAYS_MAX + 1 }, () => ({ places: [place('a')] })) }))!, /일까지/);
  assert.match(bad(plan({ days: [{ places: Array.from({ length: PLACES_PER_DAY_MAX + 1 }, () => place('a')) }] }))!, /곳까지/);
  assert.match(bad(plan({ days: [{ places: [place('a', 10, 10)] }] }))!, /좌표/);
  assert.match(bad(plan({ days: [{ places: [] }] }))!, /한 곳 이상/);
});

test('인기 점수와 검색 맞춤', () => {
  assert.equal(popularity({ imports: 2, likes: 3, views: 10 }), 29);
  const r = { title: '경주 여행', regionLabel: '경주', tags: ['한옥'] };
  assert.equal(matches(r, '경주'), true);
  assert.equal(matches(r, '#한옥'), true);
  assert.equal(matches(r, '제주'), false);
});

for (const backend of BACKENDS) {
  describe(`일정 공유 서버(${backend.name})`, () => {
    let opened: Awaited<ReturnType<(typeof BACKENDS)[number]['open']>>;
    let server: { url: string; close: () => Promise<void> };
    let now = T0;
    let seq = 0;

    before(async () => {
      opened = await backend.open();
      server = await startSyncServer({ store: opened.store, now: () => now, purgeEveryMs: 0, proxy: false, auth: { devOutbox: true, passwordCost: 1024 } });
    });
    after(async () => {
      await server?.close();
      await opened?.close();
    });
    beforeEach(() => {
      now += 61 * MIN;
    });

    async function call(path: string, body?: unknown, token?: string): Promise<[number, Json]> {
      const res = await fetch(`${server.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return [res.status, text ? JSON.parse(text) : {}];
    }
    async function member(prefix = 'it') {
      seq += 1;
      const email = `${prefix}${seq}@example.com`;
      assert.equal((await call('/auth/signup', { email, password: PW, nickname: `${prefix}${seq}` }))[0], 200);
      const [, outbox] = await call('/auth/outbox');
      const mail = (outbox.mails as Json[]).find((m) => m.to === email && m.kind === 'verify' && !m.invalidated);
      const [vs, v] = await call('/auth/verify', { token: mail!.token });
      assert.equal(vs, 200);
      return { token: v.token as string };
    }
    const share = async (token: string, over: Json = {}) => {
      const [s, r] = await call('/itineraries', plan(over), token);
      assert.equal(s, 200);
      return r.item as Json;
    };

    test('올리기는 로그인 계정만, 둘러보기는 누구나', async () => {
      assert.equal((await call('/itineraries', plan()))[0], 401);
      const a = await member();
      const item = await share(a.token);
      assert.equal(item.dayCount, 2);
      assert.equal(item.placeCount, 3);
      assert.equal(item.mine, true);
      assert.equal(item.days.length, 2);
      const [s, list] = await call('/itineraries');
      assert.equal(s, 200);
      assert.ok(list.items.some((i: Json) => i.id === item.id));
      assert.equal(list.items[0].days, undefined, '목록에는 날짜별 장소를 싣지 않는다');
      assert.equal(list.items.find((i: Json) => i.id === item.id).mine, false, '로그인 없이 보면 내 것이 아니다');
    });

    test('조회수는 같은 사람이 하루 한 번만, 다음 날은 다시 센다', async () => {
      const a = await member();
      const item = await share(a.token);
      const first = (await call(`/itineraries/${item.id}`))[1].item;
      assert.equal(first.views, 1);
      assert.equal((await call(`/itineraries/${item.id}`))[1].item.views, 1);
      assert.equal((await call(`/itineraries/${item.id}`, undefined, a.token))[1].item.views, 2, '로그인한 사람은 따로 센다');
      now += 24 * 60 * MIN;
      assert.equal((await call(`/itineraries/${item.id}`))[1].item.views, 3);
      assert.equal((await call('/itineraries/itn-nope'))[0], 404);
    });

    test('좋아요는 한 번만, 취소하면 내려간다, 로그인 필요', async () => {
      const a = await member();
      const b = await member();
      const item = await share(a.token);
      assert.equal((await call(`/itineraries/${item.id}/like`, { on: true }))[0], 401);
      assert.equal((await call(`/itineraries/${item.id}/like`, { on: true }, b.token))[1].item.likes, 1);
      const again = (await call(`/itineraries/${item.id}/like`, { on: true }, b.token))[1].item;
      assert.equal(again.likes, 1);
      assert.equal(again.liked, true);
      assert.equal((await call(`/itineraries/${item.id}`, undefined, b.token))[1].item.liked, true);
      assert.equal((await call(`/itineraries/${item.id}/like`, { on: false }, b.token))[1].item.likes, 0);
      assert.equal((await call(`/itineraries/${item.id}/like`, { on: 'x' }, b.token))[0], 400);
    });

    test('가져오기 수와 정렬: 인기순은 가져오기·좋아요·조회 점수, 최신순, 조회순', async () => {
      const a = await member();
      const b = await member();
      const old = await share(a.token, { title: '오래된 일정', regionId: 'jeju', regionLabel: '제주', tags: [] });
      now += MIN;
      const mid = await share(a.token, { title: '가운데 일정', regionId: 'jeju', regionLabel: '제주', tags: [] });
      now += MIN;
      const fresh = await share(a.token, { title: '새 일정', regionId: 'jeju', regionLabel: '제주', tags: [] });
      assert.equal((await call(`/itineraries/${old.id}/import`, {}))[1].imports, 1, '가져오기는 로그인 없이도 센다');
      await call(`/itineraries/${old.id}/import`, {});
      await call(`/itineraries/${mid.id}/like`, { on: true }, b.token);
      for (let i = 0; i < 4; i += 1) await call(`/itineraries/${fresh.id}`, undefined, i === 0 ? b.token : undefined);
      const ids = async (q: string) => ((await call(`/itineraries?region=jeju&${q}`))[1].items as Json[]).map((i) => i.id);
      assert.deepEqual(await ids('sort=popular'), [old.id, mid.id, fresh.id], '10점 > 3점 > 2점');
      assert.deepEqual(await ids('sort=new'), [fresh.id, mid.id, old.id]);
      assert.deepEqual(await ids('sort=views'), [fresh.id, mid.id, old.id], '조회 2(로그인 1 + 비로그인 1), 나머지는 최신순');
      assert.equal((await call('/itineraries?sort=zzz'))[0], 400);
      assert.equal((await call('/itineraries/itn-nope/import', {}))[0], 404);
    });

    test('검색: 제목·지역 이름·태그, 지역·태그 거르기, 쪽 나누기', async () => {
      const a = await member();
      await share(a.token, { title: '바다 산책', regionId: 'busan', regionLabel: '부산', tags: ['오션뷰'] });
      await share(a.token, { title: '한옥 마을', regionId: 'jeonju', regionLabel: '전주', tags: ['한옥'] });
      const titles = async (q: string) => ((await call(`/itineraries?${q}`))[1].items as Json[]).map((i) => i.title);
      assert.deepEqual(await titles(`q=${encodeURIComponent('바다')}&region=busan`), ['바다 산책']);
      assert.deepEqual(await titles(`q=${encodeURIComponent('전주')}&region=jeonju`), ['한옥 마을']);
      assert.deepEqual(await titles(`q=${encodeURIComponent('#오션')}&region=busan`), ['바다 산책']);
      assert.deepEqual(await titles(`tag=${encodeURIComponent('#한옥')}&region=jeonju`), ['한옥 마을']);
      const page = (await call('/itineraries?limit=1&sort=new'))[1];
      assert.equal(page.items.length, 1);
      assert.equal(page.next, 1);
      assert.equal((await call(`/itineraries?q=${'가'.repeat(40)}`))[0], 400);
    });

    test('지우기는 본인만, 탈퇴하면 일정과 누른 좋아요도 사라진다', async () => {
      const a = await member();
      const b = await member();
      const mine = await share(a.token, { title: '삭제 시험' });
      assert.equal((await call(`/itineraries/${mine.id}/delete`, {}, b.token))[0], 404);
      assert.equal((await call(`/itineraries/${mine.id}/delete`, {}, a.token))[0], 200);
      assert.equal((await call(`/itineraries/${mine.id}`))[0], 404);
      const theirs = await share(b.token, { title: '남의 일정' });
      await call(`/itineraries/${theirs.id}/like`, { on: true }, a.token);
      assert.equal((await call(`/itineraries/${theirs.id}`))[1].item.likes, 1);
      assert.equal((await call('/auth/delete', {}, a.token))[0], 200);
      assert.equal((await call(`/itineraries/${theirs.id}`))[1].item.likes, 0, '탈퇴한 사람의 좋아요는 빠진다');
      assert.equal((await call('/auth/delete', {}, b.token))[0], 200);
      assert.equal((await call(`/itineraries/${theirs.id}`))[0], 404);
    });

    test(`한 시간에 ${RATE_LIMIT}개까지만 올린다`, async () => {
      const a = await member();
      for (let i = 0; i < RATE_LIMIT; i += 1) await share(a.token, { title: `일정 ${i}` });
      assert.equal((await call('/itineraries', plan(), a.token))[0], 429);
      now += 61 * MIN;
      assert.equal((await call('/itineraries', plan(), a.token))[0], 200);
    });
  });
}
