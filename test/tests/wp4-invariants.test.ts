import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Category, DaySetting, LatLng, Spot, Trip } from '../src/types';
import { DEFAULT_STAY_MIN } from '../src/core/constants';
import { buildPlan } from '../src/core/planner';
import { planViolations } from '../src/core/planner/invariants';
import { estimateMinutes } from '../src/core/planner/estimate';
import { addDays } from '../src/core/util';
import { createLocalRoutes } from '../src/services/routes';
import { seededRng } from './helpers/fakes';

/**
 * FR-403·505 불변식 속성 테스트(무작위 좌표 100회). 판정은 core/planner/invariants.planViolations가 한다.
 * 제공자는 빈 구간표 로컬 제공자라 조회값과 직선거리 추정이 같다(계획이 조회하지 않은 구간도 같은 값).
 * 시나리오 전용 분기가 없음을 보이려고 시나리오 데이터는 쓰지 않는다.
 */

const CATS: Category[] = ['식당', '카페', '관광지', '쇼핑', '공원', '기타'];
const CENTER: LatLng = { latitude: 35.8562, longitude: 129.2247 };
const START = '2026-11-02';
const routes = () => createLocalRoutes({ table: { car: {}, walk: {}, transit: {} }, places: [] });

type Rand = () => number;

function spotAt(i: number, coord: LatLng, r: Rand, extra: Partial<Spot> = {}): Spot {
  const cat = CATS[Math.floor(r() * CATS.length)];
  const proposers = 1 + Math.floor(r() * 4);
  const createdAt = 1_000_000 + i * 60_000;
  return {
    id: `s${String(i).padStart(2, '0')}`,
    placeId: `p${i}`,
    name: `스팟${i}`,
    category: cat,
    coord,
    proposals: Array.from({ length: proposers }, (_, k) => ({ memberId: `m${k}`, source: 'chat' as const, at: createdAt })),
    pinned: false,
    stayMin: DEFAULT_STAY_MIN[cat],
    createdAt,
    edited: {},
    ...extra,
  };
}

function randomTrip(seed: number): Trip {
  const rng = seededRng(seed);
  const r: Rand = () => rng.float();
  const nDays = 2 + Math.floor(r() * 2);
  const endDate = addDays(START, nDays - 1);
  const dates = Array.from({ length: nDays }, (_, i) => addDays(START, i));
  const base = { name: '숙소', coord: CENTER };
  const days: DaySetting[] = dates.map((date, i) => ({
    date,
    base: i === 0 ? base : 'inherit',
    noReturn: i === nDays - 1 && r() < 0.4,
    dayStart: r() < 0.5 ? '09:00' : '10:00',
    dayEnd: r() < 0.5 ? '18:00' : '20:00',
  }));
  const n = 6 + Math.floor(r() * 11);
  const spots: Spot[] = [];
  for (let i = 0; i < n; i += 1) {
    const coord = { latitude: CENTER.latitude + (r() - 0.5) * 0.3, longitude: CENTER.longitude + (r() - 0.5) * 0.3 };
    const x = r();
    const extra: Partial<Spot> =
      x < 0.08
        ? { pinned: true }
        : x < 0.16
          ? { fixedDate: dates[Math.floor(r() * nDays)] }
          : x < 0.19
            ? { fixedDate: addDays(endDate, 3) }
            : x < 0.22
              ? { removedByUser: true, removedReason: 'user' }
              : x < 0.3
                ? { manualOrder: { date: dates[Math.floor(r() * nDays)], index: Math.floor(r() * 5) } }
                : {};
    spots.push(spotAt(i, coord, r, extra));
  }
  return {
    id: `t${seed}`,
    title: '무작위',
    region: 'gyeongju',
    startDate: START,
    endDate,
    transport: r() < 0.7 ? 'car' : 'walk',
    dayStart: '09:00',
    dayEnd: '21:00',
    days,
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

test('무작위 100회: 분할·사유·고정 불가침·삽입·교환·초과 불변식', async () => {
  let excludedTotal = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const trip = randomTrip(seed);
    const rp = routes();
    const plan = await buildPlan(trip, { routes: rp, now: 0 });
    const v = await planViolations(trip, plan, rp);
    assert.deepEqual(v, [], `seed ${seed}: ${v.join(' / ')}`);
    // 사용자가 뺀 후보와 기간 밖 지정은 사유 코드가 정해져 있다
    for (const s of trip.spots) {
      const e = plan.excluded.find((x) => x.spotId === s.id);
      if (s.removedByUser) assert.equal(e?.reasonCode, 'userRemoved');
      else if (s.fixedDate && s.fixedDate > trip.endDate) assert.equal(e?.reasonCode, 'outOfPeriod');
    }
    excludedTotal += plan.excluded.filter((e) => e.reasonCode === 'dayFull' || e.reasonCode === 'tooFar').length;
  }
  assert.ok(excludedTotal > 50, `자동 제외가 충분히 나와야 검사가 의미 있다(${excludedTotal})`);
});

test('수동 순서는 고정 취급이 아니다: 순서만 바꾼 날이 넘치면 FR-403 순서로 제외하고 overCapacity를 내지 않는다', async () => {
  const rng = seededRng(21);
  const r: Rand = () => rng.float();
  const trip = randomTrip(5);
  // 한 날에 몰린 스팟 8곳 전부에 수동 순서를 걸고 체류를 길게 한다
  const spots = Array.from({ length: 8 }, (_, i) =>
    spotAt(i, { latitude: CENTER.latitude + i * 0.004, longitude: CENTER.longitude }, r, {
      manualOrder: { date: START, index: 7 - i },
      stayMin: 150,
      category: '관광지',
    }),
  );
  // 하루짜리 여행이라 다른 날로 넘길 곳이 없다
  const t: Trip = { ...trip, endDate: START, days: trip.days.slice(0, 1), spots };
  const rp = routes();
  const plan = await buildPlan(t, { routes: rp, now: 0 });
  assert.deepEqual(plan.overCapacity, []);
  assert.ok(plan.excluded.some((e) => e.reasonCode === 'dayFull' || e.reasonCode === 'tooFar'), '넘치는 만큼 자동 제외');
  assert.deepEqual(await planViolations(t, plan, rp), []);
  // 남은 스팟은 그 날에서 수동 순서대로다
  const d0 = plan.days[0];
  const idx = d0.items.map((it) => t.spots.find((s) => s.id === it.spotId)?.manualOrder?.index ?? -1);
  assert.ok(idx.length > 0);
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  assert.equal(d0.orderMethod, 'manual');
});

test('고정만으로 넘치면 제외하지 않고 overCapacity에 날짜와 초과분을 낸다', async () => {
  const rng = seededRng(7);
  const r: Rand = () => rng.float();
  const trip = randomTrip(3);
  const spots = Array.from({ length: 8 }, (_, i) =>
    spotAt(i, { latitude: CENTER.latitude + i * 0.004, longitude: CENTER.longitude }, r, {
      pinned: true,
      fixedDate: START,
      stayMin: 90,
      category: '관광지',
    }),
  );
  const t: Trip = { ...trip, spots };
  const plan = await buildPlan(t, { routes: routes(), now: 0 });
  assert.equal(plan.excluded.length, 0);
  const over = plan.overCapacity.find((o) => o.date === START);
  assert.ok(over && over.overMin > 0);
  assert.equal(plan.days[0].items.length, 8);
  assert.equal(plan.days[0].overMin, over.overMin);
});

test('삽입 불변식: 기점 왕복이 60분 이상이어도 자리가 남으면 확정한다, tooFar는 문장만 바꾼다', async () => {
  const rng = seededRng(11);
  const r: Rand = () => rng.float();
  const far = { latitude: CENTER.latitude + 0.25, longitude: CENTER.longitude + 0.2 };
  const base = randomTrip(5);
  const oneDay: Trip = {
    ...base,
    endDate: START,
    transport: 'car',
    days: [{ date: START, base: { name: '숙소', coord: CENTER }, noReturn: false, dayStart: '09:00', dayEnd: '21:00' }],
    spots: [
      spotAt(1, far, r, { stayMin: 60, category: '관광지', proposals: [{ memberId: 'a', source: 'chat', at: 0 }] }),
    ],
  };
  const rt = estimateMinutes(CENTER, far, 'car') + estimateMinutes(far, CENTER, 'car');
  assert.ok(rt >= 60, `왕복 ${rt}분`);
  const plan = await buildPlan(oneDay, { routes: routes(), now: 0 });
  assert.equal(plan.excluded.length, 0, '자리가 있으면 먼 곳도 확정');

  // 같은 먼 곳을 하루가 꽉 찬 상태로 넣으면 제외되고, 그때 문장만 tooFar다
  const fillers = Array.from({ length: 7 }, (_, i) =>
    spotAt(10 + i, { latitude: CENTER.latitude + 0.002 * i, longitude: CENTER.longitude + 0.002 }, r, {
      stayMin: 90,
      category: '관광지',
      proposals: [
        { memberId: 'a', source: 'chat', at: 0 },
        { memberId: 'b', source: 'chat', at: 0 },
      ],
    }),
  );
  const full: Trip = { ...oneDay, spots: [...oneDay.spots, ...fillers] };
  const p2 = await buildPlan(full, { routes: routes(), now: 0 });
  const e = p2.excluded.find((x) => x.spotId === 's01');
  assert.ok(e, '제안자 1명인 먼 곳이 먼저 빠진다');
  assert.equal(e.reasonCode, 'tooFar');
  assert.match(e.reason, /^왕복 /);
});

test('FR-505 근접도: 떨어진 세 군집이면 같은 날 스팟 사이 평균 이동이 다른 날 사이보다 짧다', async () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const rng = seededRng(100 + seed);
    const r: Rand = () => rng.float();
    const centers: LatLng[] = [
      { latitude: CENTER.latitude + 0.07, longitude: CENTER.longitude - 0.07 },
      { latitude: CENTER.latitude - 0.07, longitude: CENTER.longitude - 0.05 },
      { latitude: CENTER.latitude, longitude: CENTER.longitude + 0.09 },
    ];
    const spots: Spot[] = [];
    let i = 0;
    for (const c of centers) {
      for (let k = 0; k < 3; k += 1) {
        spots.push(
          spotAt(i, { latitude: c.latitude + (r() - 0.5) * 0.01, longitude: c.longitude + (r() - 0.5) * 0.01 }, r, {
            stayMin: 60,
            category: '식당',
          }),
        );
        i += 1;
      }
    }
    const trip: Trip = {
      ...randomTrip(1),
      endDate: addDays(START, 2),
      transport: 'car',
      days: [0, 1, 2].map((d) => ({
        date: addDays(START, d),
        base: d === 0 ? { name: '숙소', coord: CENTER } : 'inherit',
        noReturn: false,
        dayStart: '09:00',
        dayEnd: '14:00',
      })),
      spots,
    };
    const plan = await buildPlan(trip, { routes: routes(), now: 0 });
    const dayOf = new Map<string, number>();
    plan.days.forEach((d, di) => d.items.forEach((it) => dayOf.set(it.spotId, di)));
    const placed = spots.filter((s) => dayOf.has(s.id));
    let same = 0;
    let sameN = 0;
    let diff = 0;
    let diffN = 0;
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue;
        const m = estimateMinutes(a.coord, b.coord, 'car');
        if (dayOf.get(a.id) === dayOf.get(b.id)) {
          same += m;
          sameN += 1;
        } else {
          diff += m;
          diffN += 1;
        }
      }
    }
    assert.ok(sameN > 0 && diffN > 0);
    assert.ok(same / sameN < diff / diffN, `seed ${seed}: 같은 날 ${same / sameN} < 다른 날 ${diff / diffN}`);
  }
});

test('FR-505: 하루 수용량을 넘으면 다음 날로 이월하고, 날짜 지정 스팟은 그 날에만 둔다', async () => {
  const rng = seededRng(21);
  const r: Rand = () => rng.float();
  const spots = Array.from({ length: 6 }, (_, i) =>
    spotAt(i, { latitude: CENTER.latitude + 0.003 * i, longitude: CENTER.longitude + 0.003 }, r, {
      stayMin: 90,
      category: '관광지',
    }),
  );
  spots[5] = { ...spots[5], fixedDate: addDays(START, 1) };
  const trip: Trip = {
    ...randomTrip(1),
    endDate: addDays(START, 1),
    transport: 'car',
    days: [0, 1].map((d) => ({
      date: addDays(START, d),
      base: d === 0 ? { name: '숙소', coord: CENTER } : 'inherit',
      noReturn: false,
      dayStart: '09:00',
      dayEnd: '15:00',
    })),
    spots,
  };
  const plan = await buildPlan(trip, { routes: routes(), now: 0 });
  assert.ok(plan.days[0].items.length > 0 && plan.days[1].items.length > 0, '두 날에 나뉜다');
  assert.ok(plan.days[1].items.some((i) => i.spotId === spots[5].id), '지정 날짜에 있다');
  assert.equal(plan.excluded.length, 0);
});
