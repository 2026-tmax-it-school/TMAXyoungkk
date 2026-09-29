import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DayPlan, LatLng, Plan, TimetableItem } from '../src/types';
import type { RouteLeg } from '../src/core/ports';
import { MAP_LAYOUT_BUDGET_MS } from '../src/core/constants';
import {
  clusterMarkers,
  focusOptions,
  layoutMap,
  makeProjection,
  project,
  unproject,
  type MapDotInput,
  type MapMarkerInput,
} from '../src/core/map/layout';
import { dayLegs, dayOrdinal, dayPolyline, daySummary, coordLookup, legShape, legSteps, planMapModel, stepIndexAt } from '../src/core/map/model';
import { offsetCoord } from '../src/core/sim/track';
import { DAY_COLORS, dayColor } from '../src/ui/tokens';
import { fixturePlan1018, scenarioTrip } from './helpers/fixtures';

/**
 * FR-801·802 지도 순수 계산(WP5). 투영, 클러스터, 마커 분류(순번·제외·기점), 날짜 색, estimated 직선,
 * 14곳·3일·위치 점 300개 100ms 이내(지도 초기 로딩 예산의 순수 계산분).
 */

const SIZE = { width: 390, height: 560 };

function item(spotId: string, name: string, arrive: string, depart: string, estimated = false): TimetableItem {
  return {
    spotId,
    name,
    travelMin: 15,
    legTransport: 'car',
    legEstimated: estimated,
    arrive,
    depart,
    stayMin: 60,
    pinned: false,
    proposerCount: 1,
    manual: false,
    notices: [],
  };
}

/** 시나리오 14곳으로 만든 3일 계획(확정 11, 제외 3) */
function plan3(): Plan {
  const d18 = fixturePlan1018();
  const base = d18.base;
  const mk = (date: string, items: TimetableItem[], extra: Partial<DayPlan> = {}): DayPlan => ({ ...d18, date, base, items, ...extra });
  const days = [
    mk('2026-10-17', [
      item('s-gj-hwangnidan', '황리단길', '13:00', '14:00'),
      item('s-gj-daereungwon', '대릉원', '14:10', '15:40'),
      item('s-gj-cheomseongdae', '첨성대', '15:50', '17:20', true),
      item('s-gj-cheomseongdae-cafe', '첨성대 카페거리', '17:30', '18:10'),
    ]),
    mk('2026-10-18', [
      ...d18.items,
      item('s-gj-museum', '국립경주박물관', '14:10', '15:40'),
      item('s-gj-woljeonggyo', '월정교', '15:50', '17:20'),
    ]),
    mk('2026-10-19', [item('s-gj-bomunho', '보문호', '09:20', '10:05'), item('s-gj-gyeongjuworld', '경주월드', '10:15', '11:45')], {
      noReturn: true,
    }),
  ];
  return {
    tripId: 'trip-scenario',
    days,
    excluded: [
      { spotId: 's-gj-daereungwon-wall', name: '대릉원 돌담길', reasonCode: 'dayFull', reason: '10/17이 꽉 차서', proposerCount: 1 },
      { spotId: 's-gj-gameunsaji', name: '감은사지 삼층석탑', reasonCode: 'tooFar', reason: '왕복 1시간 10분', proposerCount: 1 },
      { spotId: 's-gj-donggung', name: '동궁과 월지', reasonCode: 'dayFull', reason: '10/18 저녁이 꽉 차서', proposerCount: 1 },
    ],
    overCapacity: [],
    computedAt: 0,
    routeCalls: 0,
    cacheHits: 0,
    estimated: false,
    steps: [],
  };
}

test('마커 분류: 확정은 그날 순번, 기점은 base, 제외는 흰 핀에 제외 글자', () => {
  const trip = scenarioTrip();
  const m = planMapModel(trip, plan3(), '2026-10-18');
  const spots = m.markers.filter((x) => x.kind === 'spot');
  assert.deepEqual(spots.map((x) => x.label), ['1', '2', '3', '4', '5']);
  assert.equal(spots[0].title, '불국사');
  const base = m.markers.filter((x) => x.kind === 'base');
  assert.equal(base.length, 1);
  assert.equal(base[0].label, undefined, '기점은 속 빈 링이라 글자가 없다');
  const ex = m.markers.filter((x) => x.kind === 'excluded');
  assert.equal(ex.length, 3);
  assert.ok(ex.every((x) => x.label === '제외'));
  assert.ok(ex.some((x) => x.title.includes('왕복 1시간 10분')), '제외 사유가 제목에 있다');
});

test('전체 날짜를 겹치면 날마다 순번이 1부터이고 기점은 한 번만 찍는다', () => {
  const m = planMapModel(scenarioTrip(), plan3(), 'all');
  assert.equal(m.markers.filter((x) => x.kind === 'spot').length, 11);
  assert.equal(m.markers.filter((x) => x.kind === 'spot' && x.label === '1').length, 3);
  assert.equal(m.markers.filter((x) => x.kind === 'base').length, 1);
});

test('계획이 없으면 후보를 순번 없이 찍어 지도가 빈칸이 아니다', () => {
  const trip = scenarioTrip();
  const m = planMapModel(trip, undefined, 'all');
  assert.equal(m.unplanned, true);
  assert.equal(m.markers.filter((x) => x.kind === 'spot').length, 14);
});

test('날짜별 선 색은 잉크, 청회색, 초록, 앰버 순서다', () => {
  assert.deepEqual([...DAY_COLORS], ['ink', 'slate', 'ok', 'warn']);
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(dayColor), ['ink', 'slate', 'ok', 'warn', 'warn', 'warn']);
  const m = planMapModel(scenarioTrip(), plan3(), 'all');
  assert.deepEqual(m.days.map((d) => d.color), ['ink', 'slate', 'ok']);
});

test('구간: 기점 출발·복귀가 붙고, 복귀 없음이면 복귀 구간이 없다', () => {
  const trip = scenarioTrip();
  const p = plan3();
  const coordOf = coordLookup(trip);
  const legs18 = dayLegs(p.days[1], coordOf);
  assert.equal(legs18.length, p.days[1].items.length + 1);
  assert.equal(legs18[0].fromId, 'base');
  assert.equal(legs18[legs18.length - 1].toId, 'base');
  const legs19 = dayLegs(p.days[2], coordOf);
  assert.equal(legs19.length, p.days[2].items.length, '복귀 없음');
  assert.notEqual(legs19[legs19.length - 1].toId, 'base');
});

test('estimated 구간과 모양이 없는 구간은 직선이고, 경로 모양이 있으면 그대로 쓴다', () => {
  const trip = scenarioTrip();
  const legs = dayLegs(plan3().days[0], coordLookup(trip));
  const est = legs.find((l) => l.estimated);
  assert.ok(est);
  const bent: LatLng[] = [est.from, offsetCoord(est.from, 300, 300), est.to];
  const geo: RouteLeg = { transport: 'car', minutes: 10, meters: 2000, polyline: bent, steps: [], estimated: false };
  assert.deepEqual(legShape(est, geo), [est.from, est.to], 'estimated면 직선');
  const real = legs.find((l) => !l.estimated);
  assert.ok(real);
  assert.deepEqual(legShape(real, { ...geo, polyline: [real.from, offsetCoord(real.from, 100, 0), real.to] }).length, 3);
  assert.deepEqual(legShape(real, null), [real.from, real.to], '경로가 없으면 직선');
  assert.deepEqual(legShape(real, { ...geo, estimated: true }), [real.from, real.to], '제공자가 추정이면 직선');
  const line = dayPolyline('d', legs, {}, 'ink');
  assert.equal(line.coords.length, legs.length + 1, '구간을 이어 붙이고 겹치는 점은 한 번만');
});

test('투영: 모든 점이 화면 안에 들어오고 unproject로 되돌아온다', () => {
  const trip = scenarioTrip();
  const coords = trip.spots.map((s) => s.coord);
  const proj = makeProjection(coords, SIZE, 30);
  for (const c of coords) {
    const xy = project(proj, c);
    assert.ok(xy.x >= 29.9 && xy.x <= SIZE.width - 29.9, `x ${xy.x}`);
    assert.ok(xy.y >= 29.9 && xy.y <= SIZE.height - 29.9, `y ${xy.y}`);
    const back = unproject(proj, xy);
    assert.ok(Math.abs(back.latitude - c.latitude) < 1e-9);
    assert.ok(Math.abs(back.longitude - c.longitude) < 1e-9);
  }
  // 점이 하나뿐이거나 없어도 투영이 무너지지 않는다
  const one = makeProjection([coords[0]], SIZE);
  assert.ok(Number.isFinite(one.sx) && one.sx > 0);
  const none = makeProjection([], SIZE);
  assert.ok(Number.isFinite(none.sy));
});

test('밀집 마커는 숫자 원 하나로 묶고, 기점은 묶지 않는다', () => {
  const c0: LatLng = { latitude: 35.83, longitude: 129.21 };
  const markers: MapMarkerInput[] = [
    { id: 'a', coord: c0, kind: 'spot', label: '1', title: 'a' },
    { id: 'b', coord: offsetCoord(c0, 20, 20), kind: 'spot', label: '2', title: 'b' },
    { id: 'c', coord: offsetCoord(c0, -20, 10), kind: 'excluded', label: '제외', title: 'c' },
    { id: 'base', coord: offsetCoord(c0, 10, 0), kind: 'base', title: '기점' },
    { id: 'far', coord: offsetCoord(c0, 8000, 8000), kind: 'spot', label: '3', title: 'far' },
  ];
  const l = layoutMap({ markers, polylines: [], size: SIZE });
  assert.equal(l.clusters.length, 1);
  assert.equal(l.clusters[0].count, 3);
  assert.deepEqual(l.clusters[0].memberIds, ['a', 'b', 'c']);
  assert.deepEqual(l.projected.map((m) => m.id).sort(), ['base', 'far']);
  // clusterPx 0이면 묶지 않는다
  assert.equal(layoutMap({ markers, polylines: [], size: SIZE, clusterPx: 0 }).clusters.length, 0);
  // 결정적
  const xy = markers.map((m) => ({ ...m, x: 0, y: 0 }));
  assert.deepEqual(clusterMarkers(xy, 10), clusterMarkers(xy, 10));
});

test('현재 위치: 정확도 50m 초과(또는 모름)는 흐린 원이다', () => {
  const c0: LatLng = { latitude: 35.83, longitude: 129.21 };
  const base = { markers: [], polylines: [], size: SIZE, fitTo: [c0, offsetCoord(c0, 2000, 2000)] };
  assert.equal(layoutMap({ ...base, user: { coord: c0, accuracyM: 30 } }).user?.faint, false);
  assert.equal(layoutMap({ ...base, user: { coord: c0, accuracyM: 51 } }).user?.faint, true);
  assert.equal(layoutMap({ ...base, user: { coord: c0, accuracyM: null } }).user?.faint, true);
  const r = layoutMap({ ...base, user: { coord: c0, accuracyM: 200 } }).user?.radiusPx ?? 0;
  const r2 = layoutMap({ ...base, user: { coord: c0, accuracyM: 100 } }).user?.radiusPx ?? 0;
  assert.ok(Math.abs(r - 2 * r2) < 1e-9, '정확도 원은 미터에 비례');
});

test('구간 안내: 제공자 steps가 없으면 방위와 거리로 만들고, 진행률로 현재 줄을 고른다', () => {
  const a: LatLng = { latitude: 35.79, longitude: 129.332 };
  const b = offsetCoord(a, 0, 1500);
  const steps = legSteps({ from: a, to: b, toName: '석굴암' }, null);
  assert.equal(steps.length, 2);
  assert.match(steps[0].text, /^동쪽으로 1\.5km 이동$/);
  assert.equal(steps[1].text, '석굴암 도착');
  const given = [
    { text: '불국로 직진', meters: 800 },
    { text: '석굴암로 우회전', meters: 1200 },
    { text: '석굴암 도착', meters: 0 },
  ];
  assert.equal(stepIndexAt(given, 0), 0);
  assert.equal(stepIndexAt(given, 0.3), 0);
  assert.equal(stepIndexAt(given, 0.5), 1);
  assert.equal(stepIndexAt(given, 1), 2);
});

test('성능: 14곳·3일 선·위치 점 300개 layoutMap이 100ms 안에 끝난다', () => {
  const trip = scenarioTrip();
  const p = plan3();
  const model = planMapModel(trip, p, 'all');
  assert.equal(model.markers.length, 1 + 11 + 3, '기점 1 + 확정 11 + 제외 3 = 14곳과 기점');
  const polylines = model.days.map((d) => dayPolyline(d.date, d.legs, {}, d.color));
  const c0 = trip.spots[0].coord;
  const dots: MapDotInput[] = Array.from({ length: 300 }, (_, i) => ({
    id: `d${i}`,
    coord: offsetCoord(c0, Math.sin(i / 7) * 3000, i * 20),
    tone: i % 5 === 0 ? 'faint' : 'ink',
  }));
  const t0 = performance.now();
  let out;
  for (let k = 0; k < 5; k += 1) {
    out = layoutMap({ markers: model.markers, polylines, dots, user: { coord: c0, accuracyM: 20 }, size: SIZE });
  }
  const ms = (performance.now() - t0) / 5;
  assert.ok(ms < MAP_LAYOUT_BUDGET_MS, `${ms.toFixed(2)}ms`);
  assert.equal(MAP_LAYOUT_BUDGET_MS, 100);
  assert.equal(out?.dots.length, 300);
  assert.equal(out?.lines.length, 3);
});

test('11 시트: 날짜 순서 이름과 이동·체류 합(복귀 포함)', () => {
  assert.equal(dayOrdinal(0), '첫째 날');
  assert.equal(dayOrdinal(1), '둘째 날');
  assert.equal(dayOrdinal(10), '11일째');
  const s = daySummary({
    returnMin: 20,
    items: [
      { travelMin: 25, stayMin: 90 },
      { travelMin: 12, stayMin: 90 },
    ] as never,
  });
  assert.deepEqual(s, { travelMin: 57, stayMin: 180 });
});

/* ---------- 리뷰 반영(04 코드리뷰) ---------- */

test('클러스터를 눌러 확대하면(focusOptions) 29~77m 붙은 스팟도 풀린다', () => {
  const A: LatLng = { latitude: 35.8296, longitude: 129.2148 };
  for (const [h, meters, compact] of [
    [500, 29, false],
    [500, 60, false],
    [500, 77, false],
    [140, 29, true],
    [140, 60, true],
  ] as const) {
    const B = offsetCoord(A, meters, 0);
    const markers: MapMarkerInput[] = [
      { id: 'x', coord: A, kind: 'spot', label: '1', title: '교촌마을 한정식' },
      { id: 'y', coord: B, kind: 'spot', label: '2', title: '교리김밥' },
    ];
    const base = { markers, polylines: [], size: { width: 390, height: h }, fitTo: [A, B], pad: compact ? 20 : undefined };
    const before = layoutMap({ ...base, clusterPx: compact ? 18 : undefined });
    assert.equal(before.clusters.length, 1, `${h}px·${meters}m: 확대 전에는 묶인다`);
    const after = layoutMap({ ...base, ...focusOptions(compact) });
    assert.equal(after.clusters.length, 0, `${h}px·${meters}m: 확대하면 풀린다`);
    assert.equal(after.projected.length, 2);
  }
});

test('전체 보기에서는 핀 면이 그날 선 색이고, 하루 보기에서는 기본 잉크(색 없음)다', () => {
  const all = planMapModel(scenarioTrip(), plan3(), 'all');
  const colors = new Set(all.markers.filter((x) => x.kind === 'spot').map((x) => x.color));
  assert.deepEqual([...colors].sort(), ['ink', 'ok', 'slate']);
  for (const d of all.days) {
    const ids = new Set(d.legs.map((l) => l.toId));
    for (const m of all.markers) if (ids.has(m.id) && m.kind === 'spot') assert.equal(m.color, d.color);
  }
  const one = planMapModel(scenarioTrip(), plan3(), '2026-10-18');
  assert.ok(one.markers.every((x) => x.color == null));
});
