import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Plan, Spot, Trip } from '../src/types';
import { buildPlan } from '../src/core/planner';
import { applyDrafts, previewOps } from '../src/core/planner/preview';
import { priorityCompare, proposerCount } from '../src/core/spotUtil';
import { addDays, toHHMM } from '../src/core/util';
import { createLocalRoutes } from '../src/services/routes';
import { seededRng } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * QA(로직): FR-403 자동 선별의 확정 결정을 명세 문장 그대로 따져 본다.
 * - 제외는 제안자 수가 적은 순, 동점이면 등록이 늦은 순이다(확정 버튼 없음, 자동 선별).
 * - 고정·기간 안 날짜 지정은 자동 제외되지 않는다.
 * - 조용한 제외가 없다: 모든 후보는 확정이나 제외 중 정확히 한 곳에 보이고, 제외에는 사유가 있다.
 * 모든 스팟과 기점을 한 좌표에 두어 이동 시간이 0이 되게 한다. 그러면 수용량이 체류 합만으로 정해져
 * "몇 곳이 들어가는지"를 정확히 고를 수 있다.
 */

const P: LatLng = { latitude: 35.8562, longitude: 129.2247 };
const START = '2026-11-02';
const STAY = 60;
const emptyRoutes = () => createLocalRoutes({ table: { car: {}, walk: {}, transit: {} }, places: [] });

function spot(id: string, members: string[], createdAt: number, extra: Partial<Spot> = {}): Spot {
  return {
    id,
    placeId: `p-${id}`,
    name: `스팟 ${id}`,
    category: '관광지',
    coord: P,
    proposals: members.map((m, k) => ({ memberId: m, source: 'chat' as const, at: createdAt + k })),
    pinned: false,
    stayMin: STAY,
    createdAt,
    edited: {},
    ...extra,
  };
}

/** 하루 fits곳이 들어가는 여행(여유 30분). nDays일 */
function tripWith(spots: Spot[], fits: number, nDays = 1): Trip {
  const dates = Array.from({ length: nDays }, (_, i) => addDays(START, i));
  return {
    id: 'qa-trip',
    title: 'QA',
    region: 'gyeongju',
    startDate: START,
    endDate: dates[dates.length - 1],
    transport: 'car',
    dayStart: '09:00',
    dayEnd: toHHMM(9 * 60 + fits * STAY + 30),
    days: dates.map((date, i) => ({ date, base: i === 0 ? { name: '숙소', coord: P } : 'inherit', noReturn: false })),
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
  };
}

const confirmedIds = (plan: Plan) => plan.days.flatMap((d) => d.items.map((i) => i.spotId));
const excludedIds = (plan: Plan) => plan.excluded.map((e) => e.spotId);
const sorted = (xs: string[]) => [...xs].sort();

/**
 * 우선순위(높은 순): a(3명) > b(2명, 먼저) > c(2명, 나중) > d(1명, 가장 먼저) > e(1명) > f(1명, 가장 나중).
 * f는 같은 사람이 두 번 말했지만 제안자는 1명이다.
 */
function sixSpots(): Spot[] {
  return [
    spot('d', ['m1'], 1000),
    spot('b', ['m1', 'm2'], 2000),
    spot('f', ['m3', 'm3'], 6000),
    spot('a', ['m1', 'm2', 'm3'], 3000),
    spot('e', ['m2'], 5000),
    spot('c', ['m2', 'm3'], 4000),
  ];
}
const PRIORITY = ['a', 'b', 'c', 'd', 'e', 'f'];

test('우선순위 비교는 제안자 수가 많은 순, 동점이면 먼저 등록한 순이다(같은 사람 중복 제안은 1명)', () => {
  const list = sixSpots();
  assert.equal(proposerCount(list.find((s) => s.id === 'f') as Spot), 1);
  assert.deepEqual([...list].sort(priorityCompare).map((s) => s.id), PRIORITY);
});

test('제외 순서: 수용량이 한 곳씩 줄면 제안자 적은 순, 동점이면 등록 늦은 순으로 하나씩 빠진다', async () => {
  for (let fits = 6; fits >= 1; fits -= 1) {
    const plan = await buildPlan(tripWith(sixSpots(), fits), { routes: emptyRoutes(), now: 0 });
    assert.deepEqual(sorted(confirmedIds(plan)), sorted(PRIORITY.slice(0, fits)), `하루 ${fits}곳`);
    assert.deepEqual(sorted(excludedIds(plan)), sorted(PRIORITY.slice(fits)), `하루 ${fits}곳`);
    assert.deepEqual(plan.overCapacity, []);
  }
});

test('제외 순서는 여러 날에서도 같다: 이틀 × 2곳이면 우선순위 아래 두 곳이 빠진다', async () => {
  const plan = await buildPlan(tripWith(sixSpots(), 2, 2), { routes: emptyRoutes(), now: 0 });
  assert.deepEqual(sorted(confirmedIds(plan)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(sorted(excludedIds(plan)), ['e', 'f']);
  for (const e of plan.excluded) assert.ok(e.reasonCode === 'dayFull' || e.reasonCode === 'tooFar');
});

test('제외 스팟의 제안자 수는 확정 스팟 어느 것보다 많지 않다(동점이면 더 늦게 등록했다)', async () => {
  const plan = await buildPlan(tripWith(sixSpots(), 3), { routes: emptyRoutes(), now: 0 });
  const byId = new Map(sixSpots().map((s) => [s.id, s]));
  for (const eid of excludedIds(plan)) {
    const e = byId.get(eid) as Spot;
    for (const cid of confirmedIds(plan)) {
      const c = byId.get(cid) as Spot;
      assert.ok(priorityCompare(c, e) < 0, `${cid}가 ${eid}보다 우선이어야 한다`);
    }
    assert.equal(plan.excluded.find((x) => x.spotId === eid)?.proposerCount, proposerCount(e));
  }
});

test('고정은 안 빠진다: 우선순위가 가장 낮은 스팟을 고정하면 그 대신 다음으로 낮은 스팟이 빠진다', async () => {
  const spots = sixSpots().map((s) => (s.id === 'f' ? { ...s, pinned: true } : s));
  const plan = await buildPlan(tripWith(spots, 3), { routes: emptyRoutes(), now: 0 });
  assert.ok(confirmedIds(plan).includes('f'), '고정 스팟 f는 확정');
  assert.deepEqual(sorted(confirmedIds(plan)), ['a', 'b', 'f']);
  assert.deepEqual(sorted(excludedIds(plan)), ['c', 'd', 'e']);
});

test('기간 안 날짜 지정도 고정 취급이라 안 빠지고, 지정한 그 날에 있다', async () => {
  const d2 = addDays(START, 1);
  const spots = sixSpots().map((s) => (s.id === 'e' || s.id === 'f' ? { ...s, fixedDate: d2 } : s));
  const plan = await buildPlan(tripWith(spots, 2, 2), { routes: emptyRoutes(), now: 0 });
  const day2 = plan.days.find((d) => d.date === d2);
  assert.deepEqual(sorted(day2?.items.map((i) => i.spotId) ?? []), ['e', 'f']);
  assert.deepEqual(sorted(excludedIds(plan)), ['c', 'd']);
});

test('고정만으로 수용량을 넘으면 아무것도 빼지 않고 초과를 알린다(조용히 빼지 않는다)', async () => {
  const spots = sixSpots().map((s) => ({ ...s, pinned: true }));
  const plan = await buildPlan(tripWith(spots, 3), { routes: emptyRoutes(), now: 0 });
  assert.deepEqual(plan.excluded, []);
  assert.equal(confirmedIds(plan).length, 6);
  assert.equal(plan.overCapacity.length, 1);
  assert.ok(plan.overCapacity[0].overMin >= 3 * STAY - 30);
});

/** 모든 후보가 확정·제외 중 정확히 한 곳에 있고, 제외에는 사유 문장과 코드가 있다 */
function assertNoSilentExclusion(trip: Trip, plan: Plan, label: string) {
  const seen = new Map<string, number>();
  for (const id of [...confirmedIds(plan), ...excludedIds(plan)]) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const s of trip.spots) assert.equal(seen.get(s.id), 1, `${label}: ${s.name}이 확정·제외에 ${seen.get(s.id) ?? 0}번`);
  assert.equal(seen.size, trip.spots.length, `${label}: 후보 밖 id가 섞였다`);
  for (const e of plan.excluded) {
    assert.ok(e.reason.trim().length > 0, `${label}: ${e.name} 사유가 비었다`);
    assert.ok(['dayFull', 'tooFar', 'userRemoved', 'outOfPeriod'].includes(e.reasonCode), `${label}: ${e.reasonCode}`);
    assert.ok(e.name.length > 0);
  }
}

test('조용한 제외 없음: 시나리오 14곳은 확정 11 + 제외 3으로 전부 보이고 제외마다 사유가 있다', async () => {
  const trip = scenarioTrip();
  const plan = await buildPlan(trip, { routes: createLocalRoutes(), now: 0 });
  assertNoSilentExclusion(trip, plan, '시나리오');
  assert.equal(confirmedIds(plan).length + plan.excluded.length, 14);
});

test('조용한 제외 없음: 무작위 여행 60회(사용자 제외·기간 밖 지정·고정 섞음)', async () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const rng = seededRng(1000 + seed);
    const r = () => rng.float();
    const nDays = 1 + Math.floor(r() * 3);
    const n = 4 + Math.floor(r() * 14);
    const spots: Spot[] = Array.from({ length: n }, (_, i) => {
      const x = r();
      const members = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => `m${k}`);
      const s = spot(`r${String(i).padStart(2, '0')}`, members, 10_000 + i * 60_000, {
        coord: { latitude: P.latitude + (r() - 0.5) * 0.2, longitude: P.longitude + (r() - 0.5) * 0.2 },
        stayMin: 30 + Math.floor(r() * 4) * 30,
      });
      if (x < 0.1) s.pinned = true;
      else if (x < 0.15) s.removedByUser = true;
      else if (x < 0.2) s.fixedDate = addDays(START, nDays + 2);
      return s;
    });
    const trip = { ...tripWith(spots, 4, nDays), dayEnd: '18:00' };
    const plan = await buildPlan(trip, { routes: emptyRoutes(), now: 0 });
    assertNoSilentExclusion(trip, plan, `seed ${seed}`);
    for (const s of spots) {
      const e = plan.excluded.find((x) => x.spotId === s.id);
      if (s.removedByUser) assert.equal(e?.reasonCode, 'userRemoved', `seed ${seed} ${s.id}`);
      else if (s.fixedDate) assert.equal(e?.reasonCode, 'outOfPeriod', `seed ${seed} ${s.id}`);
      else if (s.pinned) assert.equal(e, undefined, `seed ${seed}: 고정 ${s.id}가 빠졌다`);
    }
  }
});

test('조용한 제외 없음: 체류를 늘리면 미리보기가 빠질 스팟을 먼저 알려주고, 적용한 계획의 제외 목록에도 사유와 함께 있다', async () => {
  const trip = tripWith(sixSpots(), 3);
  const deps = { routes: emptyRoutes(), now: 0 };
  const base = await buildPlan(trip, deps);
  assert.deepEqual(sorted(confirmedIds(base)), ['a', 'b', 'c']);
  // a의 체류를 2시간으로 늘리면 하루에 두 곳만 남는다. 우선순위가 가장 낮은 확정 스팟 c가 빠진다.
  const drafts = [{ type: 'schedule/setStay' as const, spotId: 'a', stayMin: 2 * STAY }];
  const diff = await previewOps(trip, base, drafts, deps);
  assert.deepEqual(diff.newlyExcluded, ['c']);
  const after = await buildPlan(applyDrafts(trip, drafts, 0), deps);
  const c = after.excluded.find((e) => e.spotId === 'c');
  assert.ok(c && c.reason.trim().length > 0);
  assert.deepEqual(sorted(confirmedIds(after)), ['a', 'b']);
  // 미리보기는 문서를 바꾸지 않는다
  assert.equal(trip.spots.find((s) => s.id === 'a')?.stayMin, STAY);
});
