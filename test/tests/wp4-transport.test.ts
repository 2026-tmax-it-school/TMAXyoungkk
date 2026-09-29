import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng, Op, OpDraft, Trip } from '../src/types';
import { liveLegs, reduce } from '../src/core/ops/schedule';
import { legDrafts, legIndexes } from '../src/features/schedule/edit';
import { buildPlan } from '../src/core/planner';
import { returnLegOf } from '../src/core/planner/day';
import { compareLeg, legEndpoints } from '../src/core/planner/legs';
import { scenarioPlace } from '../src/data/scenario';
import { SCENARIO_TRANSIT } from '../src/data/scenario-tuning';
import {
  createKakaoRoutes,
  createLocalRoutes,
  createRouteProvider,
  KAKAO_DIRECTIONS_URL,
  parseKakaoRoute,
  transitBreakdown,
  withTransitModel,
} from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * FR-504 이동수단: 하루 전체·구간별 수단, 대중교통 모의 모델(2차), 경로 없음 대체, 카카오 자동차 어댑터(fakeFetch).
 */

const routes = () => createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
let n = 0;
const op = (draft: OpDraft, at: number): Op => ({ ...draft, id: `t${(n += 1)}`, tripId: 'trip-scenario', actorId: 'm-minji', at });
const T = SCENARIO_T0 + 1000;
const coord = (id: string) => scenarioPlace(id).coord;

test('setDayTransport는 그날 수단을, null은 여행방 기본 수단으로 되돌린다', async () => {
  let t = reduce(scenarioTrip(), op({ type: 'schedule/setDayTransport', date: '2026-10-18', transport: 'walk' }, T));
  assert.equal(t.days.find((d) => d.date === '2026-10-18')?.transport, 'walk');
  const p = await buildPlan(t, { routes: routes(), now: 0 });
  const d18 = p.days.find((d) => d.date === '2026-10-18');
  assert.ok(d18?.items.every((i) => i.legTransport === 'walk' || i.notices.length > 0));
  assert.ok(p.days.find((d) => d.date === '2026-10-17')?.items.every((i) => i.legTransport === 'car'));
  t = reduce(t, op({ type: 'schedule/setDayTransport', date: '2026-10-18', transport: null }, T + 1));
  assert.equal(t.days.find((d) => d.date === '2026-10-18')?.transport, undefined);
});

const applyAll = (trip: Trip, drafts: readonly OpDraft[], at: number): Trip =>
  drafts.reduce((t, d, i) => reduce(t, op(d, at + i)), trip);

test('setLegTransport는 그 구간만 바꾸고, 같은 구간은 하나만 둔다, null이면 해제', async () => {
  const base = await buildPlan(scenarioTrip(), { routes: routes(), now: 0 });
  const day = base.days.find((d) => d.date === '2026-10-18');
  assert.ok(day);
  const leg = { date: '2026-10-18', fromId: 's-gj-bulguksa', toId: 's-gj-seokguram' };
  let t: Trip = applyAll(scenarioTrip(), legDrafts(scenarioTrip(), day, leg.fromId, leg.toId, 'walk'), T);
  t = applyAll(t, legDrafts(t, day, leg.fromId, leg.toId, 'transit'), T + 10);
  assert.equal(liveLegs(t.legs).length, 1);
  assert.equal(liveLegs(t.legs)[0].transport, 'transit');
  const p = await buildPlan(t, { routes: routes(), now: 0 });
  const d18 = p.days.find((d) => d.date === '2026-10-18');
  assert.ok(d18);
  // 순서를 함께 굳히므로 두 스팟은 계속 이웃이고, 그 구간은 고른 수단으로 계산된다
  const ids = d18.items.map((i) => i.spotId);
  assert.equal(ids.indexOf('s-gj-seokguram'), ids.indexOf('s-gj-bulguksa') + 1);
  assert.equal(d18.items.find((i) => i.spotId === 's-gj-seokguram')?.legTransport, 'transit');
  assert.ok(d18.items.filter((i) => i.spotId !== 's-gj-seokguram').every((i) => i.legTransport === 'car'));
  t = reduce(t, op({ type: 'schedule/setLegTransport', ...leg, transport: null }, T + 20));
  assert.equal(liveLegs(t.legs).length, 0);
});

test('회귀: 10/18 모든 구간에서 "이 구간만" 도보·대중교통을 고르면 계산 뒤에도 그 구간이 남고 그 수단으로 계산된다', async () => {
  const base = await buildPlan(scenarioTrip(), { routes: routes(), now: 0 });
  const day = base.days.find((d) => d.date === '2026-10-18');
  assert.ok(day);
  const trip0 = scenarioTrip();
  let kept = 0;
  for (const legIndex of legIndexes(day)) {
    const ends = legEndpoints(trip0, day, legIndex);
    assert.ok(ends);
    for (const mode of ['walk', 'transit'] as const) {
      const t = applyAll(trip0, legDrafts(trip0, day, ends.fromId, ends.toId, mode), T);
      const p = await buildPlan(t, { routes: routes(), now: 0 });
      const d = p.days.find((x) => x.date === '2026-10-18');
      assert.ok(d);
      const ids = d.items.map((i) => i.spotId);
      const where: string = `구간 ${legIndex} ${ends.fromId}>${ends.toId} ${mode}`;
      // 느린 수단으로 그날이 넘쳐 스팟이 빠지면 다른 날로 가거나 이유와 함께 제외된다(사라지지 않는다)
      const accounted = (id: string) =>
        p.excluded.some((e) => e.spotId === id && e.reason.trim() !== '') ||
        p.days.some((x) => x.date !== d.date && x.items.some((i) => i.spotId === id));
      if (ends.toId === 'base') {
        // 복귀 구간: 마지막 스팟이 그대로이고, 복귀 구간 값이 그 수단(또는 경로 없음 대체)이다
        if (ids[ids.length - 1] !== ends.fromId) {
          assert.ok(accounted(ends.fromId), `${where}: 빠졌으면 다른 날이나 제외 스팟에 있다`);
          continue;
        }
        const ret = returnLegOf(d);
        assert.ok(ret, where);
        assert.ok(ret.transport === mode || ret.notices.length > 0, where);
        kept += 1;
        continue;
      }
      const to = ids.indexOf(ends.toId);
      if (to < 0) {
        assert.ok(accounted(ends.toId), `${where}: 빠졌으면 다른 날이나 제외 스팟에 있다`);
        continue;
      }
      if (ends.fromId === 'base') assert.equal(to, 0, where);
      else if (!ids.includes(ends.fromId)) {
        assert.ok(accounted(ends.fromId), `${where}: 빠졌으면 다른 날이나 제외 스팟에 있다`);
        continue;
      } else assert.equal(ids[to - 1], ends.fromId, `${where}: 두 스팟이 이웃이다`);
      const it = d.items[to];
      assert.ok(it.legTransport === mode || it.notices.some((n) => n.kind === 'noRoute'), where);
      kept += 1;
    }
  }
  // 시나리오에서는 16가지 중 14가지가 그 구간을 그대로 지킨다(나머지는 넘쳐서 다른 날로 간 경우)
  assert.ok(kept >= 12, `구간이 남은 경우 ${kept}`);
});

test('대중교통 모의 = 도보 접근 + 배차 간격 절반 대기 + 승차 + 환승 벌점', () => {
  const a: LatLng = { latitude: 35.8, longitude: 129.2 };
  const near: LatLng = { latitude: 35.81, longitude: 129.2 };
  const far: LatLng = { latitude: 35.9, longitude: 129.3 };
  const p = { accessWalkMin: 6, defaultHeadwayMin: 30, transferPenaltyMin: 10, legs: {} };
  const b1 = transitBreakdown(a, near, p);
  assert.equal(b1.transfers, 0);
  assert.equal(b1.waitMin, 15);
  assert.equal(b1.total, 6 + 15 + b1.rideMin);
  const b2 = transitBreakdown(a, far, p);
  assert.equal(b2.transfers, 1);
  assert.equal(b2.total, 6 + 15 + b2.rideMin + 10);
  // 구간 덮어쓰기(불국사 → 석굴암: 승차 15, 배차 40)
  const o = transitBreakdown(coord('gj-bulguksa'), coord('gj-seokguram'), SCENARIO_TRANSIT, 'gj-bulguksa>gj-seokguram');
  assert.deepEqual([o.rideMin, o.waitMin, o.total], [15, 20, 6 + 20 + 15]);
});

test('대중교통 route는 단계와 estimated를 주고, 구간표 null이면 경로 없음(null)', async () => {
  const r = routes();
  const leg = await r.route(coord('gj-bulguksa'), coord('gj-seokguram'), 'transit');
  assert.ok(leg);
  assert.equal(leg.estimated, true);
  assert.equal(leg.minutes, 41);
  assert.ok(leg.steps.some((s) => s.text.includes('기다리기')));
  assert.equal(await r.route(coord('gj-lahan-select'), coord('gj-gameunsaji'), 'transit'), null);
  const m = await r.matrix([coord('gj-lahan-select')], [coord('gj-gameunsaji')], 'transit');
  assert.equal(m.minutes[0][0], null);
});

test('compareLeg: 자동차·도보·대중교통 비교, 경로 없는 수단은 대체 안내', async () => {
  const r = routes();
  const cmp = await compareLeg(r, coord('gj-lahan-select'), coord('gj-gameunsaji'), 'car');
  assert.deepEqual(
    cmp.map((c) => c.transport),
    ['car', 'walk', 'transit'],
  );
  const transit = cmp.find((c) => c.transport === 'transit');
  assert.equal(transit?.leg, null);
  assert.match(transit?.fallbackText ?? '', /경로가 없습니다/);
  const car = cmp.find((c) => c.transport === 'car');
  assert.equal(car?.deltaMin, 0);
  const walk = cmp.find((c) => c.transport === 'walk');
  assert.ok(walk && walk.deltaMin !== null && walk.deltaMin > 0);
});

test('legEndpoints: legIndex 0은 기점 → 첫 스팟, 마지막 다음은 복귀', async () => {
  const t = scenarioTrip();
  const p = await buildPlan(t, { routes: routes(), now: 0 });
  const d = p.days.find((x) => x.date === '2026-10-18');
  assert.ok(d);
  const first = legEndpoints(t, d, 0);
  assert.equal(first?.fromId, 'base');
  assert.equal(first?.toId, d.items[0].spotId);
  const second = legEndpoints(t, d, 1);
  assert.equal(second?.fromId, d.items[0].spotId);
  const ret = legEndpoints(t, d, d.items.length);
  assert.equal(ret?.toId, 'base');
  assert.equal(legEndpoints(t, d, d.items.length + 1), undefined);
});

test('카카오 자동차: 요청 형식(경도,위도 · KakaoAK 헤더)과 응답의 분·미터·polyline 변환', async () => {
  const a: LatLng = { latitude: 35.79, longitude: 129.33 };
  const b: LatLng = { latitude: 35.795, longitude: 129.349 };
  const body = {
    routes: [
      {
        result_code: 0,
        result_msg: '길찾기 성공',
        summary: { distance: 4210, duration: 725 },
        sections: [
          {
            roads: [{ vertexes: [129.33, 35.79, 129.34, 35.792] }, { vertexes: [129.349, 35.795] }],
            guides: [{ name: '토함산로', guidance: '우회전', distance: 300, duration: 40, x: 129.34, y: 35.792 }],
          },
        ],
      },
    ],
  };
  const f = fakeFetch(() => ({ body }));
  const k = createKakaoRoutes({ key: 'TESTKEY', fetch: f, fallback: createLocalRoutes() });
  const leg = await k.route(a, b, 'car');
  assert.equal(f.calls.length, 1);
  const url = new URL(f.calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, KAKAO_DIRECTIONS_URL);
  assert.equal(url.searchParams.get('origin'), '129.33,35.79');
  assert.equal(url.searchParams.get('destination'), '129.349,35.795');
  assert.equal(url.searchParams.get('priority'), 'RECOMMEND');
  assert.equal(f.calls[0].init?.headers?.Authorization, 'KakaoAK TESTKEY');
  assert.ok(leg);
  assert.equal(leg.minutes, 12);
  assert.equal(leg.meters, 4210);
  assert.deepEqual(leg.polyline[2], { longitude: 129.349, latitude: 35.795 });
  assert.equal(leg.polyline.length, 3);
  assert.equal(leg.steps[0].text, '우회전 · 토함산로');
  assert.equal(leg.estimated, false);
  assert.equal(parseKakaoRoute({ routes: [{ result_code: 104 }] }, a, b), null);
});

test('카카오 행렬: 구간마다 요청 한 번(구간 단위 호출 수), 도보·대중교통은 로컬 모델로 넘긴다', async () => {
  const f = fakeFetch(() => ({ body: { routes: [{ result_code: 0, summary: { distance: 1000, duration: 300 } }] } }));
  const k = createKakaoRoutes({ key: 'K', fetch: f, fallback: createLocalRoutes() });
  const pts: LatLng[] = [
    { latitude: 35.8, longitude: 129.2 },
    { latitude: 35.81, longitude: 129.21 },
    { latitude: 35.82, longitude: 129.22 },
  ];
  const m = await k.matrix(pts, pts, 'car');
  assert.equal(m.calls, 6, '같은 지점 3칸은 세지 않는다');
  assert.equal(f.calls.length, 6);
  assert.equal(m.minutes[0][1], 5);
  assert.equal(m.minutes[1][1], 0);
  const w = await k.matrix(pts, pts, 'walk');
  assert.equal(f.calls.length, 6, '도보는 카카오를 부르지 않는다');
  assert.equal(w.estimated, true);
  // 실패 응답이면 던지고, 계획은 직선거리로 대체한다
  const bad = createKakaoRoutes({ key: 'K', fetch: fakeFetch(() => ({ status: 401, body: {} })), fallback: createLocalRoutes() });
  await assert.rejects(() => bad.matrix([pts[0]], [pts[1]], 'car'));
  const t = scenarioTrip();
  const p = await buildPlan(t, { routes: withTransitModel(bad), now: 0 });
  assert.equal(p.estimated, true);
  assert.equal(p.days.flatMap((d) => d.items).length > 0, true);
});

test('createRouteProvider: 키가 있으면 자동차는 카카오, 없으면 로컬', async () => {
  const f = fakeFetch(() => ({ body: { routes: [{ result_code: 0, summary: { distance: 1000, duration: 600 } }] } }));
  const withKey = createRouteProvider({ kakaoKey: 'K', fetch: f, clock: fixedClock(0), kv: memoryKV() });
  assert.equal(withKey.id, 'kakao');
  const m = await withKey.matrix([coord('gj-bulguksa')], [coord('gj-seokguram')], 'car');
  assert.equal(m.minutes[0][0], 10);
  assert.equal(f.calls.length, 1);
  assert.equal(routes().id, 'local');
});
