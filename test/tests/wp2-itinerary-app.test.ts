import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { itineraryFailText, shareDays, shareDraft, toSampleTrip } from '../src/core/itinerary';
import { sampleOps } from '../src/core/trip/sample';
import { createLocalItineraries } from '../src/services/itineraries/local';
import { toItinerary } from '../src/services/itineraries/http';
import type { Plan, Spot, Trip } from '../src/types';
import { fixedClock } from './helpers/fakes';

/**
 * 일정 공유 앱 쪽(2026-10-17). 여행방 → 올릴 일정, 올라온 일정 → 예시 일정(가져오기), 이 기기 모의 제공자,
 * 서버 응답 읽기, 화면·진입점이 이어졌는지를 본다. 서버 규칙은 wp2-itineraries.test.ts가 맡는다.
 */

const read = (p: string) => readFileSync(p, 'utf8');
const spot = (id: string, name: string, extra: Partial<Spot> = {}): Spot =>
  ({ id, placeId: id, name, category: '관광지', coord: { latitude: 35.8, longitude: 129.2 }, proposals: [], pinned: false, stayMin: 60, createdAt: 0, edited: {}, ...extra }) as Spot;
const trip = (spots: Spot[]): Trip => ({ id: 't1', title: '경주', region: 'gyeongju', days: [], spots }) as unknown as Trip;
const plan = (days: string[][]): Plan => ({ tripId: 't1', days: days.map((ids, i) => ({ date: `2026-11-0${i + 1}`, base: null, items: ids.map((spotId) => ({ spotId })) })) }) as unknown as Plan;

test('올릴 일정: 시간표 순서대로 날짜별, 뺀 후보는 제외, 시간표가 없으면 후보 전체를 하루로', () => {
  const t = trip([spot('a', '불국사'), spot('b', '석굴암'), spot('c', '대릉원'), spot('d', '뺀곳', { removedByUser: true })]);
  const days = shareDays(t, plan([['b', 'a'], ['d'], ['c']]));
  assert.deepEqual(days.map((d) => d.places.map((p) => p.name)), [['석굴암', '불국사'], ['대릉원']], '장소 없는 날은 뺀다');
  assert.deepEqual(days.map((d) => d.title), ['1일차', '2일차']);
  assert.deepEqual(shareDays(t, undefined).map((d) => d.places.length), [3]);
  assert.deepEqual(shareDays(trip([]), undefined), []);
});

test('올릴 일정 검사: 장소·이름·길이', () => {
  const t = trip([spot('a', '불국사')]);
  assert.equal(shareDraft(t, plan([['a']]), { title: '  ', note: '', tags: [] }, '경주').problem, '일정 이름을 입력해 주세요');
  assert.match(shareDraft(t, plan([['a']]), { title: 'x'.repeat(61), note: '', tags: [] }, '경주').problem!, /60자/);
  assert.match(shareDraft(t, plan([['a']]), { title: '좋음', note: 'x'.repeat(301), tags: [] }, '경주').problem!, /300자/);
  assert.match(shareDraft(trip([]), undefined, { title: '좋음', note: '', tags: [] }, '경주').problem!, /장소를 한 곳/);
  const ok = shareDraft(t, plan([['a']]), { title: ' 좋음 ', note: '', tags: ['한옥'] }, '경주');
  assert.equal(ok.problem, undefined);
  assert.equal(ok.draft.title, '좋음');
  assert.equal(ok.draft.regionId, 'gyeongju');
});

test('가져오기: 올라온 일정이 예시 일정이 되어 후보·날짜·순서 op가 된다', () => {
  const item = toItinerary({
    id: 'itn-1', title: '내 경주', regionId: 'gyeongju', regionLabel: '경주', note: '소개', tags: ['한옥'], dayCount: 2, placeCount: 3,
    authorNickname: '민수', createdAt: 1, views: 5, likes: 1, imports: 0, score: 8, mine: false, liked: false,
    days: [
      { title: '1일차', places: [{ name: '불국사', category: '관광지', kind: '', address: '', coord: { latitude: 35.79, longitude: 129.33 }, note: '' }, { name: '석굴암', category: '관광지', kind: '', address: '', coord: { latitude: 35.79, longitude: 129.35 }, note: '' }] },
      { title: '2일차', places: [{ name: '대릉원', category: '관광지', kind: '', address: '', coord: { latitude: 35.83, longitude: 129.21 }, note: '' }] },
    ],
    base: null,
  })!;
  const sample = toSampleTrip(item)!;
  assert.equal(sample.days.length, 2);
  assert.equal(sample.base.name, '불국사', '기점이 없으면 첫 장소');
  let n = 0;
  const { drafts, spots } = sampleOps(sample, { dates: ['2026-11-06', '2026-11-07'], memberId: 'm1', at: 1, newSpotId: () => `s${(n += 1)}` });
  assert.equal(spots.length, 3);
  assert.deepEqual(drafts.map((d) => d.type), ['spot/add', 'spot/add', 'spot/add', 'schedule/setDate', 'schedule/setDate', 'schedule/setDate', 'schedule/reorder', 'schedule/reorder']);
  assert.equal(toSampleTrip({ ...item, days: [] }), undefined);
});

test('서버 응답 읽기: 모양이 틀리면 null, 숫자·태그는 걸러서', () => {
  assert.equal(toItinerary(null), null);
  assert.equal(toItinerary({ id: 1 }), null);
  const i = toItinerary({ id: 'a', title: 't', tags: ['x', 3], views: 'z', mine: true })!;
  assert.deepEqual(i.tags, ['x']);
  assert.equal(i.views, 0);
  assert.equal(i.mine, true);
  assert.equal(i.days, undefined);
});

test('이 기기 모의: 올리기는 로그인, 인기순·좋아요 한 번·가져오기·내 것만 지우기', async () => {
  const c = createLocalItineraries({ clock: fixedClock(1000), ids: { next: (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}` } });
  const me = { userId: 'u1', nickname: '나' };
  const you = { userId: 'u2', nickname: '너' };
  const draft = (title: string) => ({ title, regionId: 'jeju', regionLabel: '제주', note: '', tags: ['바다'], days: [{ title: '1일차', places: [{ name: 'a', category: '관광지' as const, kind: '', address: '', coord: { latitude: 33.4, longitude: 126.5 }, note: '' }] }] });
  assert.equal((await c.share(draft('x'), {})).ok, false);
  const a = await c.share(draft('A'), me);
  const b = await c.share(draft('B'), me);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  await c.like(b.value.id, true, you);
  await c.like(b.value.id, true, you);
  const list = await c.list({ sort: 'popular' }, you);
  assert.ok(list.ok);
  if (list.ok) {
    assert.deepEqual(list.value.items.map((i) => i.title), ['B', 'A']);
    assert.equal(list.value.items[0].likes, 1);
    assert.equal(list.value.items[0].liked, true);
  }
  await c.countImport(a.value.id, you);
  await c.countImport(a.value.id, you);
  const second = await c.list({ sort: 'popular' }, you);
  if (second.ok) assert.equal(second.value.items[0].title, 'A', '가져오기 2번 = 10점');
  const found = await c.list({ sort: 'new', q: '#바' }, you);
  assert.ok(found.ok && found.value.items.length === 2);
  assert.equal((await c.remove(a.value.id, you)).ok, false, '남의 것은 못 지운다');
  assert.equal((await c.remove(a.value.id, me)).ok, true);
  const detail = await c.get(b.value.id, me);
  assert.ok(detail.ok && detail.value.views === 1 && detail.value.days?.length === 1);
  assert.equal((await c.get('nope', me)).ok, false);
});

test('오류 문장', () => {
  assert.match(itineraryFailText('loginRequired'), /로그인/);
  assert.equal(itineraryFailText('badItinerary', '직접 문장'), '직접 문장');
  assert.match(itineraryFailText('zzz'), /다시 시도/);
});

test('화면과 진입점이 이어졌다', () => {
  const nav = read('src/navigation/RootNavigator.tsx');
  for (const n of ['Itineraries', 'ItineraryDetail', 'ShareItinerary']) assert.match(nav, new RegExp(`name="${n}"`));
  const home = read('src/screens/HomeScreen.tsx');
  assert.doesNotMatch(home, /공유된 여행 일정/, '홈에는 공유된 일정 구역을 두지 않는다(커뮤니티 탭 안에 있다)');
  assert.match(read('src/screens/TripSettingsScreen.tsx'), /navigate\('ShareItinerary'/);
  assert.match(read('src/screens/ItineraryDetailScreen.tsx'), /navigate\('CreateTrip', \{ regionId: item\.regionId, shared: true \}\)/);
  const create = read('src/screens/CreateTripScreen.tsx');
  assert.match(create, /markImported/);
  assert.match(create, /applySampleTrip\(tripId, regionId, range\.start, range\.end, shared\)/);
});

test('커뮤니티 여행 일정 탭에서 바로 일정 공유: 버튼·빈 목록 버튼, 로그인 안내, 여행방 고르기', () => {
  const c = read('src/screens/CommunityScreen.tsx');
  assert.match(c, /<Btn title="일정 공유" icon="share"/);
  assert.match(c, /onShare=\{shareStart\}/);
  assert.match(c, /navigate\('ShareItinerary', \{ tripId: trips\[0\]\.id \}\)/);
  assert.match(c, /어느 여행방의 일정을 공유할까요/);
  assert.match(read('src/screens/ItinerariesScreen.tsx'), /label: '내 일정 공유하기'/);
});
