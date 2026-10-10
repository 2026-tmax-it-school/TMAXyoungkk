import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Plan, Trip } from '../src/types';
import type { RouteProvider } from '../src/core/ports';
import { buildPlan, resolveBases, type PlanDeps } from '../src/core/planner';
import { sameCoord } from '../src/core/planner/estimate';
import { replanForDelay } from '../src/core/planner/replan';
import { scenarioPlace } from '../src/data/scenario';
import { toHHMM, toMin } from '../src/core/util';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * FR-603 지연 조정안(replanForDelay). 받은 delayMin으로 조정안만 만든다(ETA와 15분 경계는 WP5).
 * 순서: 순서만으로 흡수되면 reorder → 영업 종료 스팟 빼기 → FR-403 순서 빼기 → 체류 줄이기. 고정은 빼지 않는다.
 */

const DATE = '2026-10-18';
const deps = (): PlanDeps => ({
  routes: createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() }),
  now: SCENARIO_T0,
});

/**
 * 계획을 먼저 만든 뒤, 박물관 영업 종료를 계획 도착 + 10분으로 당긴다(지연하면 도착이 종료 뒤가 된다).
 * dayEnd를 주면 10/18 활동 종료를 늘려 초과 없이 순서만 보게 한다.
 */
async function setup(opts: { closeAfterArriveMin?: number; dayEnd?: string } = {}): Promise<{ trip: Trip; plan: Plan }> {
  const base = scenarioTrip();
  const plan = await buildPlan(base, deps());
  let trip = base;
  if (opts.closeAfterArriveMin !== undefined) {
    const it = plan.days.find((d) => d.date === DATE)?.items.find((i) => i.spotId === 's-gj-museum');
    assert.ok(it);
    const close = toHHMM(toMin(it.arrive) + opts.closeAfterArriveMin);
    trip = { ...trip, spots: trip.spots.map((s) => (s.id === 's-gj-museum' ? { ...s, hours: { open: '09:00', close } } : s)) };
  }
  if (opts.dayEnd) trip = { ...trip, days: trip.days.map((d) => (d.date === DATE ? { ...d, dayEnd: opts.dayEnd } : d)) };
  return { trip, plan };
}

const input = (trip: Trip, plan: Plan, delayMin: number) => ({
  trip,
  plan,
  date: DATE,
  now: SCENARIO_T0,
  position: scenarioPlace('gj-seokguram').coord,
  visitedSpotIds: ['s-gj-bulguksa', 's-gj-seokguram'],
  skippedSpotIds: [],
  delayMin,
});

test('순서만 바꿔 지연을 흡수할 수 있으면 reorder 조정안을 먼저 낸다', async () => {
  const { trip, plan } = await setup({ closeAfterArriveMin: 10, dayEnd: '22:30' });
  const d = plan.days.find((x) => x.date === DATE);
  const { adjustments } = await replanForDelay(input(trip, plan, 20), deps());
  assert.equal(adjustments[0]?.kind, 'reorder');
  const ro = adjustments[0].ops[0];
  assert.ok(ro.type === 'schedule/reorder');
  // 방문한 곳은 앞에 그대로 두고, 박물관이 더 앞으로 온다
  assert.deepEqual(ro.spotIds.slice(0, 2), ['s-gj-bulguksa', 's-gj-seokguram']);
  const before = d?.items.map((i) => i.spotId).indexOf('s-gj-museum') ?? 0;
  assert.ok(ro.spotIds.indexOf('s-gj-museum') < before);
});

test('빼기 조정안은 영업 종료로 못 가는 스팟이 1순위, 그다음 FR-403 순서, 고정은 빼지 않는다', async () => {
  const { trip, plan } = await setup({ closeAfterArriveMin: 10 });
  const { adjustments } = await replanForDelay(input(trip, plan, 60), deps());
  assert.ok(!adjustments.some((a) => a.kind === 'reorder'), '60분은 순서만으로 흡수되지 않는다');
  const ex = adjustments.filter((a) => a.kind === 'exclude');
  const ids = ex.map((a) => {
    const o = a.ops[0];
    return o.type === 'spot/remove' ? o.spotId : '';
  });
  assert.equal(ids[0], 's-gj-museum');
  assert.equal(ids[1], 's-gj-woljeonggyo', '제안자 1명인 월정교가 다음');
  assert.ok(!ids.includes('s-gj-gyochon-hanjeongsik'));
  for (const a of ex) {
    const o = a.ops[0];
    assert.ok(o.type === 'spot/remove' && o.reason === 'delay');
  }
  assert.match(ex[0].label, /영업 종료/);
});

test('지연이 남은 여유 안이면 순서·빼기 조정안 없이 체류 줄이기만 낸다', async () => {
  const { trip, plan } = await setup();
  const { adjustments } = await replanForDelay(input(trip, plan, 15), deps());
  assert.deepEqual(
    adjustments.map((a) => a.kind),
    ['shortenStay'],
  );
  const o = adjustments[0].ops[0];
  assert.ok(o.type === 'schedule/setStay' && o.spotId !== 's-gj-gyochon-hanjeongsik');
});

test('조정안은 초안일 뿐이다: 거절하면 문서와 계획이 그대로다', async () => {
  const { trip, plan } = await setup({ closeAfterArriveMin: 10 });
  const t = JSON.stringify(trip);
  const p = JSON.stringify(plan);
  const r = await replanForDelay(input(trip, plan, 60), deps());
  assert.ok(r.adjustments.length > 0);
  assert.equal(JSON.stringify(trip), t);
  assert.equal(JSON.stringify(plan), p);
});

test('남은 일정이 없거나 지연이 0이면 조정안이 없다', async () => {
  const { trip, plan } = await setup();
  const all = plan.days.find((d) => d.date === DATE)?.items.map((i) => i.spotId) ?? [];
  const none = await replanForDelay({ ...input(trip, plan, 30), visitedSpotIds: all }, deps());
  assert.deepEqual(none.adjustments, []);
  const zero = await replanForDelay(input(trip, plan, 0), deps());
  assert.deepEqual(zero.adjustments, []);
});

test('지금 위치(GPS)는 경로 제공자에 넘기지 않는다. 지금 위치에서 출발하는 구간은 직선거리 추정이고, 스팟 좌표 그대로면 묻는다', async () => {
  const { trip, plan } = await setup({ closeAfterArriveMin: 10, dayEnd: '22:30' });
  /** 경로 제공자에 넘어간 좌표를 모두 적는다(서버 경유 카카오·OSRM이면 이 좌표가 기기 밖으로 나간다) */
  const recording = () => {
    const inner = deps().routes;
    const seen: LatLng[] = [];
    const routes: RouteProvider = {
      id: inner.id,
      matrix: (o, d, t) => {
        seen.push(...o, ...d);
        return inner.matrix(o, d, t);
      },
      route: (a, b, t) => {
        seen.push(a, b);
        return inner.route(a, b, t);
      },
      clearCache: () => inner.clearCache(),
    };
    return { routes, seen };
  };
  // 석굴암에서 동쪽으로 약 300m 떨어진 길 위(정확한 GPS)
  const seok = scenarioPlace('gj-seokguram').coord;
  const gps: LatLng = { latitude: seok.latitude + 0.0011, longitude: seok.longitude + 0.0031 };
  const r = recording();
  const { adjustments } = await replanForDelay({ ...input(trip, plan, 20), position: gps }, { routes: r.routes, now: SCENARIO_T0 });
  assert.ok(adjustments.length > 0, '조정안은 그대로 낸다');
  assert.ok(r.seen.length > 0, '스팟 사이 구간은 묻는다');
  assert.ok(
    r.seen.every((c) => !sameCoord(c, gps)),
    '지금 위치 좌표는 한 번도 넘기지 않는다',
  );
  const bases = resolveBases(trip).flatMap((b) => (b.base ? [b.base.coord] : []));
  assert.ok(r.seen.every((c) => trip.spots.some((s) => sameCoord(s.coord, c)) || bases.some((b) => sameCoord(b, c))), '스팟·기점 좌표만');

  // GPS가 없어 replanPosition이 스팟 좌표를 골랐으면 그 좌표로 묻는다(계획에도 쓰는 값이다)
  const r2 = recording();
  await replanForDelay(input(trip, plan, 20), { routes: r2.routes, now: SCENARIO_T0 });
  assert.ok(r2.seen.some((c) => sameCoord(c, seok)));
});

test('지금 위치가 스팟 좌표와 소수 5자리까지 같으면(맞은 스팟) 받은 위치의 나머지 자리 대신 그 스팟 좌표 그대로 묻는다', async () => {
  const { trip, plan } = await setup({ closeAfterArriveMin: 10, dayEnd: '22:30' });
  const inner = deps().routes;
  const seen: LatLng[] = [];
  const routes: RouteProvider = {
    id: inner.id,
    matrix: (o, d, t) => {
      seen.push(...o, ...d);
      return inner.matrix(o, d, t);
    },
    route: (a, b, t) => {
      seen.push(a, b);
      return inner.route(a, b, t);
    },
    clearCache: () => inner.clearCache(),
  };
  const seok = scenarioPlace('gj-seokguram').coord;
  // 석굴암 좌표에서 1m 안쪽(소수 5자리는 같다)으로 떨어진 위치
  const near: LatLng = { latitude: seok.latitude + 0.0000031, longitude: seok.longitude - 0.0000027 };
  assert.ok(sameCoord(near, seok));
  const exact = await replanForDelay({ ...input(trip, plan, 20), position: seok }, deps());
  const { adjustments } = await replanForDelay({ ...input(trip, plan, 20), position: near }, { routes, now: SCENARIO_T0 });
  assert.ok(seen.some((c) => c.latitude === seok.latitude && c.longitude === seok.longitude), '맞은 스팟 좌표에서 출발하는 구간을 묻는다');
  const stops = [...trip.spots.map((s) => s.coord), ...resolveBases(trip).flatMap((b) => (b.base ? [b.base.coord] : []))];
  for (const c of seen) {
    assert.ok(
      stops.some((s) => s.latitude === c.latitude && s.longitude === c.longitude),
      `스팟·기점 좌표 그대로만 넘긴다(${c.latitude},${c.longitude})`,
    );
  }
  assert.deepEqual(adjustments, exact.adjustments, '스팟 좌표 그대로일 때와 같은 조정안');
});
