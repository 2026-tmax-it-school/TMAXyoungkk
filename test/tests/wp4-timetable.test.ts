import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DayPlan, LatLng, Op, Spot, Trip } from '../src/types';
import { DEFAULT_STAY_MIN } from '../src/core/constants';
import { reduce } from '../src/core/ops/schedule';
import type { RouteProvider } from '../src/core/ports';
import { buildPlan, resolveBases } from '../src/core/planner';
import { returnLegOf } from '../src/core/planner/day';
import { legDrafts } from '../src/features/schedule/edit';
import { toMin } from '../src/core/util';
import { timelineRows } from '../src/features/schedule/timeline';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV, tableRoutes } from './helpers/fakes';
import { fixturePlan1018, scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * FR-502 시간표와 FR-205 기점 계산, 09 시간표 행(timelineRows).
 */

const scenarioRoutes = () => createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });

function assertEquations(day: DayPlan) {
  let prevDepart = day.startMin;
  for (const it of day.items) {
    assert.equal(toMin(it.arrive), prevDepart + it.travelMin, `${it.name} arrive = 직전 depart + travel`);
    assert.equal(toMin(it.depart), toMin(it.arrive) + it.stayMin, `${it.name} depart = arrive + stay`);
    prevDepart = toMin(it.depart);
  }
  if (day.items.length) assert.equal(day.usedMin, prevDepart + day.returnMin - day.startMin);
}

test('모든 항목에서 arrive = 직전 depart + travel, depart = arrive + stay', async () => {
  const p = await buildPlan(scenarioTrip(), { routes: scenarioRoutes(), now: 0 });
  for (const d of p.days) assertEquations(d);
});

test('카테고리 기본 체류가 명세 표와 같고, 사용자 값이 우선한다', async () => {
  assert.deepEqual(
    { 식당: DEFAULT_STAY_MIN.식당, 카페: DEFAULT_STAY_MIN.카페, 관광지: DEFAULT_STAY_MIN.관광지, 쇼핑: DEFAULT_STAY_MIN.쇼핑, 공원: DEFAULT_STAY_MIN.공원 },
    { 식당: 60, 카페: 40, 관광지: 90, 쇼핑: 60, 공원: 45 },
  );
  const trip = scenarioTrip();
  trip.spots = trip.spots.map((s) => (s.id === 's-gj-bulguksa' ? { ...s, stayMin: 50 } : s));
  const p = await buildPlan(trip, { routes: scenarioRoutes(), now: 0 });
  const it = p.days.flatMap((d) => d.items).find((i) => i.spotId === 's-gj-bulguksa');
  assert.equal(it?.stayMin, 50);
  assert.ok(it);
  assert.equal(toMin(it.depart) - toMin(it.arrive), 50);
});

function oneSpotTrip(spot: Partial<Spot>, day: Partial<Trip['days'][number]> = {}): Trip {
  const t = scenarioTrip();
  const base = t.spots[0];
  return {
    ...t,
    endDate: t.startDate,
    days: [{ date: t.startDate, base: { name: '숙소', coord: { latitude: 35.84, longitude: 129.22 } }, noReturn: false, dayStart: '09:00', dayEnd: '21:00', ...day }],
    spots: [{ ...base, id: 'x', pinned: false, fixedDate: undefined, ...spot }],
  };
}

test('영업시간 밖 도착이면 outsideHours notice를 단다', async () => {
  const late = oneSpotTrip({ hours: { open: '06:00', close: '08:00' } });
  const p = await buildPlan(late, { routes: tableRoutes(), now: 0 });
  assert.ok(p.days[0].items[0].notices.some((n) => n.kind === 'outsideHours'));
  const ok = oneSpotTrip({ hours: { open: '06:00', close: '20:00' } });
  const p2 = await buildPlan(ok, { routes: tableRoutes(), now: 0 });
  assert.equal(p2.days[0].items[0].notices.filter((n) => n.kind === 'outsideHours').length, 0);
});

test('도착 시각 지정: 늦게 지정하면 기다리고, 이미 지났으면 overrideLate', async () => {
  const wait = await buildPlan(oneSpotTrip({ arriveOverride: '11:00' }), { routes: tableRoutes(), now: 0 });
  assert.equal(wait.days[0].items[0].arrive, '11:00');
  assert.equal(wait.days[0].items[0].manual, true);
  const early = await buildPlan(oneSpotTrip({ arriveOverride: '09:00' }), { routes: tableRoutes(), now: 0 });
  assert.ok(early.days[0].items[0].notices.some((n) => n.kind === 'overrideLate'));
});

test('활동시간을 넘으면 carryOver(다음 날 이월 제안)가 나온다', async () => {
  const t = oneSpotTrip({ pinned: true, stayMin: 300 }, { dayStart: '18:00', dayEnd: '21:00' });
  const p = await buildPlan(t, { routes: tableRoutes(), now: 0 });
  assert.ok(p.days[0].overMin > 0);
  // 고정은 이월 제안에서 뺀다. 고정 아닌 날짜 지정 스팟은 이월 제안에 들어간다
  assert.deepEqual(p.days[0].carryOver, []);
  const t2 = oneSpotTrip({ fixedDate: '2026-10-17', stayMin: 300 }, { dayStart: '18:00', dayEnd: '21:00' });
  const p2 = await buildPlan(t2, { routes: tableRoutes(), now: 0 });
  assert.deepEqual(p2.days[0].carryOver, ['x']);
});

test("FR-205: 'inherit'는 직전 기점, 첫날부터 null이면 첫 스팟 기점(firstSpot), noReturn이면 returnMin 0", async () => {
  const t = scenarioTrip();
  const bases = resolveBases(t);
  assert.equal(bases[0].source, 'set');
  assert.equal(bases[1].source, 'inherited');
  assert.equal(bases[1].base?.name, bases[0].base?.name);

  const p = await buildPlan(t, { routes: scenarioRoutes(), now: 0 });
  const last = p.days[p.days.length - 1];
  assert.equal(last.noReturn, true);
  assert.equal(last.returnMin, 0);
  assert.ok(p.days[1].returnMin > 0);

  const noBase: Trip = { ...t, days: t.days.map((d) => ({ ...d, base: d.date === t.startDate ? null : 'inherit' })) };
  const p2 = await buildPlan(noBase, { routes: scenarioRoutes(), now: 0 });
  for (const d of p2.days) {
    assert.equal(d.baseSource, 'firstSpot');
    if (d.items.length) {
      assert.equal(d.base?.name, d.items[0].name, '첫 스팟이 기점');
      assert.equal(d.items[0].travelMin, 0);
      assert.equal(d.items[0].arrive, `${String(Math.floor(d.startMin / 60)).padStart(2, '0')}:${String(d.startMin % 60).padStart(2, '0')}`);
      assert.equal(d.returnMin, 0);
    }
  }
});

test('timelineRows: 기점 출발 → 이동 줄 → 스팟 … → 이동 줄 → 복귀', () => {
  const day = { ...fixturePlan1018(), returnMin: 20 };
  const rows = timelineRows(day, { 's-gj-bulguksa': 'arrived' });
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['base', 'leg', 'spot', 'leg', 'spot', 'leg', 'spot', 'leg', 'return'],
  );
  assert.equal(rows[0].kind === 'base' && rows[0].time, '09:00');
  const first = rows[2];
  assert.ok(first.kind === 'spot' && first.status === 'arrived' && first.time === '09:25');
  const ret = rows[rows.length - 1];
  assert.ok(ret.kind === 'return' && ret.time === '14:17');
  const legs = rows.filter((r) => r.kind === 'leg');
  assert.deepEqual(
    legs.map((l) => (l.kind === 'leg' ? l.minutes : -1)),
    [25, 12, 20, 20],
  );
});

test('timelineRows: 복귀 없음은 끝 행, 기점 없음(firstSpot)은 첫 이동 줄이 없다', () => {
  const day = fixturePlan1018();
  const noReturn = timelineRows({ ...day, noReturn: true, returnMin: 0 });
  assert.equal(noReturn[noReturn.length - 1].kind, 'end');
  const first = timelineRows({ ...day, baseSource: 'firstSpot', noReturn: true });
  assert.equal(first[0].kind, 'spot');
  assert.equal(first.filter((r) => r.kind === 'leg').length, 2);
  const carry = timelineRows({ ...day, carryOver: ['s-gj-seokguram'] });
  const s = carry.find((r) => r.kind === 'spot' && r.spotId === 's-gj-seokguram');
  assert.ok(s && s.kind === 'spot' && s.carryOver);
});

test('영업시간 보정: 초과를 늘리지 않는 한 영업시간 밖에 걸리는 스팟을 앞뒤로 옮긴다(시나리오 10/18·10/19)', async () => {
  const p = await buildPlan(scenarioTrip(), { routes: scenarioRoutes(), now: 0 });
  for (const d of p.days) {
    for (const it of d.items) assert.equal(it.notices.filter((n) => n.kind === 'outsideHours').length, 0, `${d.date} ${it.name}`);
  }
  const d19 = p.days.find((d) => d.date === '2026-10-19');
  assert.deepEqual(
    d19?.items.map((i) => i.spotId),
    ['s-gj-bomunho', 's-gj-gyeongjuworld'],
  );
});

test('FR-205: 직전 날짜가 첫 스팟 기점(null)이면 다음 날의 inherit도 첫 스팟 기점이다(그 전 날짜 기점을 건너 물려받지 않는다)', () => {
  const trip = scenarioTrip();
  const base = { name: '숙소', coord: { latitude: 35.84, longitude: 129.21 } };
  trip.days = [
    { date: '2026-10-17', base, noReturn: false },
    { date: '2026-10-18', base: null, noReturn: false },
    { date: '2026-10-19', base: 'inherit', noReturn: false },
  ];
  assert.deepEqual(
    resolveBases(trip).map((b) => b.source),
    ['set', 'firstSpot', 'firstSpot'],
  );
  assert.equal(resolveBases(trip)[2].base, null);
});

test('복귀 구간 수단 지정: 복귀 줄 아이콘·분이 그 수단이다(마지막 도착 구간 수단이 아니다)', async () => {
  const routes = scenarioRoutes();
  // 도보 복귀가 들어가도록 10/18 활동시간을 늘린 여행
  const roomy = (): Trip => {
    const tr = scenarioTrip();
    tr.days = tr.days.map((d) => (d.date === '2026-10-18' ? { ...d, dayEnd: '23:30' } : d));
    return tr;
  };
  const plan = await buildPlan(roomy(), { routes, now: 0 });
  const day = plan.days.find((d) => d.date === '2026-10-18');
  assert.ok(day);
  const last = day.items[day.items.length - 1].spotId;
  const at = SCENARIO_T0 + 10_000;
  let t = roomy();
  let n = 0;
  for (const d of legDrafts(t, day, last, 'base', 'walk')) {
    t = reduce(t, { ...d, id: `rt${(n += 1)}`, tripId: t.id, actorId: 'm-minji', at: at + n } as Op);
  }
  const p = await buildPlan(t, { routes, now: 0 });
  const d18 = p.days.find((d) => d.date === '2026-10-18');
  assert.ok(d18);
  assert.equal(d18.items[d18.items.length - 1].spotId, last);
  assert.equal(returnLegOf(d18)?.transport, 'walk');
  assert.equal(d18.items[d18.items.length - 1].legTransport, 'car', '들어오는 구간은 그대로 자동차');
  const rows = timelineRows(d18);
  const retLeg = rows.find((r) => r.kind === 'leg' && r.key === 'leg-return');
  assert.ok(retLeg && retLeg.kind === 'leg' && retLeg.transport === 'walk' && retLeg.minutes === d18.returnMin);
  const ret = rows[rows.length - 1];
  assert.ok(ret.kind === 'return' && ret.sub === '기점 · 복귀');
});

test('복귀 구간 자동차 경로가 없으면 도보로 대체하고 복귀 행에 fallbackTransport 안내를 단다', async () => {
  const inner = scenarioRoutes();
  const trip = scenarioTrip();
  const baseOf = (date: string) => {
    const b = resolveBases(trip).find((x) => x.date === date)?.base;
    return b?.coord;
  };
  const b18 = baseOf('2026-10-18');
  assert.ok(b18);
  const same = (a: LatLng, b: LatLng) => a.latitude === b.latitude && a.longitude === b.longitude;
  const routes: RouteProvider = {
    ...inner,
    async matrix(o, d, t) {
      const m = await inner.matrix(o, d, t);
      if (t !== 'car') return m;
      return { ...m, minutes: m.minutes.map((row, i) => row.map((v, j) => (same(d[j], b18) && !same(o[i], b18) ? null : v))) };
    },
  };
  const p = await buildPlan(trip, { routes, now: 0 });
  const d18 = p.days.find((d) => d.date === '2026-10-18');
  assert.ok(d18);
  const ret = returnLegOf(d18);
  assert.equal(ret?.transport, 'walk');
  assert.ok(ret?.notices.some((n) => n.kind === 'fallbackTransport'));
  const rows = timelineRows(d18);
  const row = rows[rows.length - 1];
  assert.ok(row.kind === 'return' && row.notices.some((n) => n.kind === 'fallbackTransport'));
});
