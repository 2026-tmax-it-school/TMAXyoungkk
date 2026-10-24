import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { DayPlan, Plan, Spot, Trip } from '../src/types';
import { homeNowTask, nextStop, NEW_TRIP_H, tripCardInfo, tripCardLines } from '../src/features/account/home';
import { artTheme, artVariant } from '../src/ui/regionArtTheme';
import { atKst } from '../src/core/util';

/** 2026-10-22 디자인 검토 3가지: 지역 그림, 홈 '지금 할 일', 낮춘 카드 + 다음 일정 줄 */

function trip(extra: Partial<Trip> = {}): Trip {
  return {
    id: 't', title: '경주 1박 2일', region: 'gyeongju', startDate: '2026-10-23', endDate: '2026-10-24', transport: 'car',
    dayStart: '09:00', dayEnd: '21:00', days: [], legs: [], members: [], spots: [], messages: [], photos: [], visits: [],
    diaries: {}, createdAt: 0, createdBy: 'u', lastSeq: 0, ...extra,
  };
}
const spot = { id: 'a', placeId: 'p', name: '불국사', category: '관광지', coord: { latitude: 0, longitude: 0 }, proposals: [], pinned: false, stayMin: 90, createdAt: 0, edited: {} } as Spot;
function day(date: string, items: [string, string][]): DayPlan {
  return {
    date, base: null, baseSource: 'firstSpot', noReturn: true, startMin: 540, endLimitMin: 1260, returnMin: 0, usedMin: 0, capacityMin: 720,
    overMin: 0, carryOver: [], orderMethod: 'exact',
    items: items.map(([arrive, name], i) => ({ spotId: `s${i}`, name, travelMin: 0, legTransport: 'car', legEstimated: false, arrive, depart: arrive, stayMin: 60, pinned: false, proposerCount: 1, manual: false, notices: [] })),
  } as DayPlan;
}
const plan = { tripId: 't', days: [day('2026-10-23', [['09:35', '불국사'], ['13:36', '황리단길']]), day('2026-10-24', [['10:00', '첨성대']])], excluded: [], overCapacity: [], computedAt: 0, routeCalls: 0, cacheHits: 0, estimated: false, steps: [] } as Plan;

test('다음 일정: 다른 날이면 날짜까지, 오늘이면 지금 뒤 첫 장소의 시각만', () => {
  assert.equal(nextStop(trip(), plan, atKst('2026-10-22', '20:00'))?.when, '10/23 09:35');
  assert.equal(nextStop(trip(), plan, atKst('2026-10-23', '11:00'))?.when, '13:36');
  assert.equal(nextStop(trip(), plan, atKst('2026-10-23', '15:00'))?.name, '첨성대');
  assert.equal(nextStop(trip(), plan, atKst('2026-10-25', '09:00')), undefined, '끝난 여행');
  assert.equal(nextStop(trip(), undefined, 0), undefined);
});

test('카드 줄: 다음 일정이 있으면 그것, 없으면 후보 개수', () => {
  const info = tripCardInfo(trip({ spots: [spot] }), plan, atKst('2026-10-22', '20:00'));
  assert.deepEqual(tripCardLines(info), [info.dateText, '다음 · 10/23 09:35 불국사']);
  const none = tripCardInfo(trip(), undefined, atKst('2026-10-22', '20:00'));
  assert.deepEqual(tripCardLines(none), [none.dateText, none.countsText]);
  assert.equal(NEW_TRIP_H, 252);
});

test('지금 할 일: 단계마다 제목·설명·버튼 하나', () => {
  const before = atKst('2026-10-22', '20:00');
  assert.equal(homeNowTask(trip(), undefined, before).action, '후보 모으기');
  assert.match(homeNowTask(trip({ spots: [spot] }), undefined, before).title, /후보 1곳으로 루트/);
  const ready = homeNowTask(trip({ spots: [spot] }), plan, before);
  assert.equal(ready.title, 'D-1 시간표가 준비됐어요');
  assert.equal(ready.sub, '첫 일정 10/23 09:35 불국사');
  const live = homeNowTask(trip({ spots: [spot] }), plan, atKst('2026-10-23', '11:00'));
  assert.equal(live.sub, '다음은 13:36 황리단길');
  assert.equal(homeNowTask(trip(), plan, atKst('2026-10-26', '09:00')).action, '여행일지 보기');
  assert.match(ready.eyebrow, /^지금 할 일 · 경주 1박 2일$/);
});

test('지역 그림: 지역 성격별, 모르는 지역은 도시', () => {
  assert.equal(artTheme('gyeongju'), 'hanok');
  assert.equal(artTheme('busan'), 'harbor');
  assert.equal(artTheme('jeju'), 'island');
  assert.equal(artTheme('yeosu'), 'nightSea');
  assert.equal(artTheme('nowhere'), 'city');
  assert.equal(artTheme('seoul'), 'capital');
  assert.equal(artTheme('suwon'), 'fortress');
  assert.equal(artTheme('gunsan'), 'oldtown');
  assert.equal(artTheme('namhae'), 'terraces');
  assert.equal(artTheme('danyang'), 'rocks');
  // 같은 그림 지역끼리 하늘 변형이 갈린다(같은 지역은 늘 같은 값)
  assert.equal(artVariant('busan'), artVariant('busan'));
  assert.notEqual(artVariant('busan'), artVariant('incheon'));
  assert.notEqual(artVariant('daejeon'), artVariant('daegu'));
  const read = (f: string) => readFileSync(f, 'utf8');
  const home = read('src/screens/HomeScreen.tsx');
  assert.match(home, /art=\{<RegionArt regionId=\{trip\.region\} \/>\}/);
  assert.match(home, /art=\{<RegionArt regionId=\{p\.id\} \/>\}/);
  assert.match(home, /<NowTaskCard trip=\{current\}/);
  // 버튼 중복 정리: 빠른 메뉴는 지금 할 일 카드 안 compact(강조 없음) 하나뿐
  assert.match(home, /<TripActions trip=\{trip\} compact \/>/);
  assert.ok(!/<TripActions trip=\{current\} \/>/.test(home), '카드 아래 따로 둔 빠른 메뉴가 없다');
  assert.match(read('src/features/trip/components/TripActions.tsx'), /primary=\{!compact && i === 0\}/);
  // 컴퓨터 폭: 두 단(격자 + 오른쪽 지금 할 일), 새 여행·초대 칸
  assert.match(home, /\{desk && !searching \? \(/);
  assert.match(home, /<AddTile icon="plus" title="새 여행방 만들기"/);
  assert.match(home, /<Screen wide=\{desk \? HOME_DESK_W : undefined\}>/);
});
