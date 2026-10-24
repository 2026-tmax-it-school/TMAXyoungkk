import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Spot, Trip } from '../src/types';
import { buildPlan } from '../src/core/planner';
import { dayContexts, todayStartMin } from '../src/core/planner/day';
import { hintInText, spotTimeHint } from '../src/core/planner/hints';
import { atKst, toMin } from '../src/core/util';
import { createLocalRoutes } from '../src/services/routes';

/**
 * 2026-10-22 셀프 QA 높음 1·2, 중간 3.
 * 1. 오늘 시작하는 여행방은 지금보다 이른 시각에 일정을 잡지 않는다
 * 2. 가까운 곳끼리 한 날에 모은다(빈 날을 여는 비용)
 * 3. 채팅 속 시간 힌트(야경·점심)를 순서와 도착 시각에 쓴다
 */

const routes = () => createLocalRoutes({ table: { car: {}, walk: {}, transit: {} }, places: [] });
const C: LatLng = { latitude: 35.8347, longitude: 129.219 };
const near = (dLat: number, dLng: number): LatLng => ({ latitude: C.latitude + dLat, longitude: C.longitude + dLng });

function spot(id: string, name: string, coord: LatLng, extra: Partial<Spot> = {}): Spot {
  return {
    id,
    placeId: `p-${id}`,
    name,
    category: '관광지',
    coord,
    proposals: [{ memberId: 'm1', source: 'chat', at: 1 }],
    pinned: false,
    stayMin: 60,
    createdAt: 1,
    edited: {},
    ...extra,
  };
}

function trip(start: string, end: string, spots: Spot[], extra: Partial<Trip> = {}): Trip {
  return {
    id: 't',
    title: '테스트',
    region: 'gyeongju',
    startDate: start,
    endDate: end,
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: [{ date: start, base: { name: '숙소', coord: C }, noReturn: false }],
    legs: [],
    members: [],
    spots,
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 0,
    createdBy: 'u',
    lastSeq: 0,
    ...extra,
  };
}

test('높음 1: 오늘이면 지금(10분 올림)보다 이르게 시작하지 않는다', () => {
  const t = trip('2026-10-22', '2026-10-23', []);
  const now = atKst('2026-10-22', '14:03');
  assert.equal(todayStartMin(t, '2026-10-22', toMin('09:00'), now), toMin('14:10'));
  // 다른 날, 시각을 모르면 그대로
  assert.equal(todayStartMin(t, '2026-10-23', toMin('09:00'), now), toMin('09:00'));
  assert.equal(todayStartMin(t, '2026-10-22', toMin('09:00'), undefined), toMin('09:00'));
  // 이미 지금보다 늦게 시작하면 그대로
  assert.equal(todayStartMin(t, '2026-10-22', toMin('15:00'), now), toMin('15:00'));
  // 그날 도착 기록이 있으면(여행 중) 미루지 않는다
  const started = { ...t, visits: [{ id: 'v', spotId: 'a', date: '2026-10-22', memberId: 'm1', status: 'arrived' as const, source: 'gps' as const, at: now }] };
  assert.equal(todayStartMin(started, '2026-10-22', toMin('09:00'), now), toMin('09:00'));
});

test('높음 1: 밤늦게 만든 오늘 시작 여행방은 오늘을 비우고 다음 날에 둔다', async () => {
  const t = trip('2026-10-22', '2026-10-23', [spot('a', '불국사', near(0.01, 0.01))]);
  const plan = await buildPlan(t, { routes: routes(), now: atKst('2026-10-22', '23:56') });
  const today = plan.days.find((d) => d.date === '2026-10-22');
  assert.ok(today);
  assert.equal(today.items.length, 0, '오늘은 남은 시간이 없다');
  assert.equal(plan.days.find((d) => d.date === '2026-10-23')?.items.length, 1);
  assert.equal(dayContexts(t, atKst('2026-10-22', '23:56'))[0].capacityMin, 0);
});

test('높음 2: 가까운 두 곳은 한 날에 모인다(기점이 없어도)', async () => {
  const spots = [spot('a', '불국사', near(0, 0)), spot('b', '첨성대', near(0.02, 0.02))];
  const withBase = trip('2026-11-02', '2026-11-04', spots);
  const noBase = trip('2026-11-02', '2026-11-04', spots, { days: [{ date: '2026-11-02', base: null, noReturn: false }] });
  for (const t of [withBase, noBase]) {
    const plan = await buildPlan(t, { routes: routes(), now: 0 });
    const used = plan.days.filter((d) => d.items.length > 0);
    assert.equal(used.length, 1, `한 날에 두 곳: ${plan.days.map((d) => d.items.length).join(',')}`);
    assert.equal(used[0].items.length, 2);
  }
});

test('중간 3: 원문에서 장소 둘레의 시간 낱말만 힌트로 본다', () => {
  assert.equal(hintInText('동궁과월지 야경 보자', '동궁과 월지'), 'evening');
  assert.equal(hintInText('점심은 황리단길 어때', '황리단길'), 'lunch');
  assert.equal(hintInText('불국사 일찍 아침에 가자', '불국사'), 'morning');
  assert.equal(hintInText('첫날은 불국사랑 석굴암 묶어서 가자', '불국사'), undefined);
  // 한 메시지에 여러 곳: 먼 쪽 장소의 힌트는 넘어오지 않는다
  assert.equal(hintInText('오전엔 불국사 보고 첨성대 들렀다가 저녁 늦게는 동궁과월지 야경까지 보자', '불국사'), 'morning');
  assert.equal(hintInText('불국사 보고 저녁엔 동궁과월지', '불국사', ['불국사', '동궁과월지']), undefined);
  assert.equal(hintInText('불국사 보고 저녁엔 동궁과월지', '동궁과월지', ['불국사', '동궁과월지']), 'evening');
  const s = spot('d', '동궁과 월지', C, { proposals: [{ memberId: 'm1', source: 'chat', messageId: 'msg', at: 1 }] });
  assert.equal(spotTimeHint(s, [{ id: 'msg', memberId: 'm1', text: '동궁과 월지 야경 유명하대', sentAt: 1, status: 'sent' }]), 'evening');
});

test('중간 3: 야경 장소는 저녁(18:00 이후)에, 점심 장소는 점심때 도착한다', async () => {
  const t = trip('2026-11-02', '2026-11-02', [
    spot('night', '동궁과 월지', near(0.001, 0.001), { sourceText: '동궁과월지 야경 보자' }),
    spot('lunch', '황리단길', near(0.004, 0.0), { sourceText: '점심은 황리단길' }),
    spot('a', '불국사', near(0.02, 0.03)),
    spot('b', '첨성대', near(0.003, 0.003)),
  ]);
  const plan = await buildPlan(t, { routes: routes(), now: 0 });
  const items = plan.days[0].items;
  const at = (id: string) => toMin(items.find((x) => x.spotId === id)?.arrive ?? '00:00');
  assert.equal(items.length, 4);
  assert.ok(at('night') >= toMin('18:00'), `야경 ${items.find((x) => x.spotId === 'night')?.arrive}`);
  assert.equal(items[items.length - 1].spotId, 'night', '야경이 마지막');
  assert.ok(at('lunch') >= toMin('11:30') && at('lunch') <= toMin('13:30'), `점심 ${items.find((x) => x.spotId === 'lunch')?.arrive}`);
});

test('중간 3: 그날 저녁이 없으면(17시에 끝남) 야경 힌트로 일정을 넘기지 않는다', async () => {
  const t = trip('2026-11-02', '2026-11-02', [spot('night', '동궁과 월지', near(0.001, 0.001), { sourceText: '야경 보자 동궁과월지' })], {
    dayEnd: '17:00',
  });
  const plan = await buildPlan(t, { routes: routes(), now: 0 });
  assert.equal(plan.days[0].items.length, 1);
  assert.equal(plan.days[0].overMin, 0);
});
