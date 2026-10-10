import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import type { LatLng, Plan, TrackPoint, Trip, Visit } from '../src/types';
import { dayColor, MAX_TRIP_DAYS } from '../src/core/constants';
import { ACTUAL_DOT_TONE, dayLineColor, gapLineColor, recordMapModel } from '../src/core/journal/recordMap';
import { noteLivePermission, type DeniedStore } from '../src/core/live/track';
import { addDays, atKst, dateRange } from '../src/core/util';
import { mapPinSvg } from '../src/ui/mapPinSvg';
import { mapC } from '../src/ui/tokens';
import { fixturePlan1018, memberId, scenarioTrip } from './helpers/fixtures';

/**
 * WP6 기록 지도(22) 보완. 날짜 색과 실제 이동 점 색 구분(FR-804, D5), 날짜별 권한 거부 안내(FR-704 S9).
 * 색은 모델 색 이름이 아니라 렌더러가 실제로 칠하는 값(ui/mapPinSvg·tokens mapC)으로 비교한다.
 */

const D1 = '2026-10-17';
const D2 = '2026-10-18';

function planFor(trip: Trip, dates: string[]): Plan {
  return {
    tripId: trip.id,
    days: dates.map((date) => ({ ...fixturePlan1018(), date })),
    excluded: [],
    overCapacity: [],
    computedAt: 0,
    routeCalls: 0,
    cacheHits: 0,
    estimated: false,
    steps: [],
  };
}

function coordOf(trip: Trip, spotId: string): LatLng {
  return trip.spots.find((s) => s.id === spotId)!.coord;
}

function arrive(spot: string, date: string, hhmm: string): Visit {
  const t = atKst(date, hhmm);
  return { id: `v-${spot}-${date}`, spotId: spot, date, memberId: memberId('minji'), arrivedAt: t, status: 'arrived', source: 'gps', at: t };
}

function gps(c: LatLng, date: string, n: number): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    t: atKst(date, '10:00') + i * 30_000,
    coord: { latitude: c.latitude + i * 0.0003, longitude: c.longitude },
    accuracyM: 10,
    source: 'device' as const,
  }));
}

/** 렌더러가 실제 이동 점을 칠하는 색(MapCanvas·구글 지도와 같은 규칙인 mapPinSvg) */
function dotFill(): string {
  const m = /fill="(#[0-9A-Fa-f]{6})"/.exec(mapPinSvg({ kind: 'dot', tone: ACTUAL_DOT_TONE, size: 'md' }).xml);
  return m![1].toUpperCase();
}

/** CIE76 색차. 20이 넘으면 나란히 놓았을 때 다른 색으로 읽힌다 */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const lin = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const [r, g, bl] = lin;
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe('FR-804 계획 선과 실제 이동 점 색 구분', () => {
  test('계획 선은 지도와 같은 날짜 색이고, 실제 이동 점은 여행 15일 내내 어느 날짜 선 색과도 겹치지 않는다', () => {
    const trip = scenarioTrip();
    const dates = dateRange(D1, addDays(D1, MAX_TRIP_DAYS));
    trip.startDate = dates[0];
    trip.endDate = dates[dates.length - 1];
    assert.equal(dates.length, MAX_TRIP_DAYS + 1);
    const plan = planFor(trip, dates);
    const now = atKst(addDays(trip.endDate, 1), '12:00');
    const fill = dotFill();
    assert.equal(fill, mapC.user.toUpperCase(), '이동 점은 현재 위치와 같은 파랑');
    dates.forEach((date, i) => {
      const m = recordMapModel(trip, plan, date, gps(coordOf(trip, 's-gj-bulguksa'), date, 6), { now });
      assert.equal(m.plannedColor, dayColor(i), `${i + 1}일 계획 선은 지도(11)와 같은 날짜 색`);
      assert.equal(dayLineColor(trip, date), dayColor(i));
      assert.ok(m.dots.length > 0 && m.dots.every((d) => d.tone === ACTUAL_DOT_TONE));
      const line = mapC[m.plannedColor].toUpperCase();
      assert.notEqual(line, fill, `${i + 1}일 계획 선과 이동 점 색이 같다`);
      assert.ok(deltaE(line, fill) >= 20, `${i + 1}일 계획 선(${line})과 이동 점(${fill}) 색차 ${deltaE(line, fill).toFixed(1)}`);
      assert.notEqual(m.gapColor, m.plannedColor, `${i + 1}일 공백 점선이 계획 선과 같은 색`);
    });
  });

  test('넷째 날부터 계획 선은 앰버, 이동 점은 파랑이라 겹치지 않는다', () => {
    const trip = scenarioTrip();
    trip.endDate = addDays(trip.startDate, 5);
    const date = addDays(trip.startDate, 3);
    const m = recordMapModel(trip, planFor(trip, [date]), date, gps(coordOf(trip, 's-gj-bulguksa'), date, 4), {
      now: atKst(date, '18:00'),
    });
    assert.equal(m.plannedColor, 'warn');
    assert.equal(m.gapColor, 'ink');
    assert.notEqual(mapC.warn.toUpperCase(), dotFill());
  });

  test('1일은 계획 선이 잉크라 공백 점선을 청회색으로 그린다(도착 지점만 이으면 점선이 계획 선과 같은 자리)', () => {
    const trip = scenarioTrip();
    trip.visits = [arrive('s-gj-bulguksa', D1, '09:25'), arrive('s-gj-seokguram', D1, '11:07')];
    const m = recordMapModel(trip, planFor(trip, [D1]), D1, [], {
      now: atKst(D1, '18:00'),
      denied: { at: atKst(D1, '09:00'), source: 'device' },
    });
    assert.equal(m.plannedColor, 'ink');
    assert.equal(gapLineColor('ink'), 'slate');
    const gaps = m.polylines.filter((l) => l.dashed);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].color, 'slate');
    assert.deepEqual(gaps[0].coords, [coordOf(trip, 's-gj-bulguksa'), coordOf(trip, 's-gj-seokguram')]);
    for (const c of ['slate', 'ok', 'warn'] as const) assert.equal(gapLineColor(c), 'ink');
  });

  test('범례는 모델 색(계획 선·점선)과 렌더러 이동 점 색을 그대로 쓴다', () => {
    const src = readFileSync('src/screens/RecordMapScreen.tsx', 'utf8');
    assert.match(src, /<Legend planned=\{model\.plannedColor\} gap=\{model\.gapColor\} \/>/);
    assert.match(src, /stroke=\{mapC\[gap\]\} strokeWidth=\{3\.4\} strokeDasharray="6 5"/);
    assert.match(src, /r=\{3\.5\} fill=\{mapC\.user\} stroke=\{mapC\.white\}/);
  });
});

describe('FR-704 날짜별 권한 거부 안내', () => {
  const NOW = atKst('2026-10-20', '12:00');

  test('거부 기록이 있는 날만 지난 날짜에도 권한 거부로 안내하고, 다른 날은 위치 기록 없음이다', () => {
    const trip = scenarioTrip();
    trip.visits = [arrive('s-gj-bulguksa', D1, '09:25'), arrive('s-gj-bulguksa', D2, '09:25'), arrive('s-gj-seokguram', D2, '11:07')];
    const plan = planFor(trip, [D1, D2]);
    let denied: DeniedStore = {};
    denied = noteLivePermission(denied, trip.id, D1, { requested: 'device', permission: 'denied', at: atKst(D1, '09:00') });
    denied = noteLivePermission(denied, trip.id, D2, { requested: 'manual', permission: 'denied', at: atKst(D2, '09:00') });
    const day1 = recordMapModel(trip, plan, D1, [], { now: NOW, denied: denied[trip.id]?.[D1] });
    const day2 = recordMapModel(trip, plan, D2, [], { now: NOW, denied: denied[trip.id]?.[D2] });
    assert.deepEqual(day1.notices, ['denied']);
    assert.deepEqual(day2.notices, ['noLog'], '수동 진행을 고른 날은 권한 거부가 아니다');
    assert.equal(day1.track.arrivalsOnly, true);
  });

  test('출발 전에 앞날을 기기 위치로 미리 시작해 거부한 것은 그날 거부가 아니다(그날 수동 진행이면 위치 기록 없음)', () => {
    const trip = scenarioTrip();
    trip.visits = [arrive('s-gj-bulguksa', D2, '09:25'), arrive('s-gj-seokguram', D2, '11:07')];
    let denied: DeniedStore = {};
    denied = noteLivePermission(denied, trip.id, D2, { requested: 'device', permission: 'denied', at: atKst('2026-10-09', '21:00') });
    denied = noteLivePermission(denied, trip.id, D2, { requested: 'manual', permission: 'denied', at: atKst(D2, '09:00') });
    const m = recordMapModel(trip, planFor(trip, [D2]), D2, [], { now: NOW, denied: denied[trip.id]?.[D2] });
    assert.deepEqual(m.notices, ['noLog']);
  });

  test('거부한 날이라도 나중에 허용해 위치 로그가 있으면 로그를 쓰고 거부 안내를 띄우지 않는다', () => {
    const trip = scenarioTrip();
    const mark = { at: atKst(D2, '09:00'), source: 'device' as const };
    const m = recordMapModel(trip, planFor(trip, [D2]), D2, gps(coordOf(trip, 's-gj-bulguksa'), D2, 5), { now: NOW, denied: mark });
    assert.deepEqual(m.notices, []);
    assert.equal(m.gpsPoints, 5);
  });

  test('거부한 날에 도착 기록도 없으면 도착 지점을 이었다고 하지 않고 이동 기록이 없다고 안내한다', () => {
    const trip = scenarioTrip();
    trip.visits = [];
    const mark = { at: atKst(D2, '09:00'), source: 'device' as const };
    const m = recordMapModel(trip, planFor(trip, [D2]), D2, [], { now: NOW, denied: mark });
    assert.deepEqual(m.notices, ['deniedNone']);
    assert.equal(m.polylines.filter((l) => l.dashed).length, 0, '이은 점도 점선도 없다');
    // 그날 계획도 없으면 빈 화면 위에 같은 안내다
    const none = recordMapModel(trip, undefined, D2, [], { now: NOW, denied: mark });
    assert.equal(none.empty, true);
    assert.deepEqual(none.notices, ['deniedNone']);
    // 시뮬레이터 권한 거부 프리셋이면 시뮬레이터 안내도 함께
    assert.deepEqual(recordMapModel(trip, planFor(trip, [D2]), D2, [], { now: NOW, denied: { ...mark, source: 'sim' } }).notices, [
      'deniedNone',
      'sim',
    ]);
    const src = readFileSync('src/screens/RecordMapScreen.tsx', 'utf8');
    assert.match(src, /deniedNone: '이 날은 위치 권한이 없었고 도착 기록도 없어 이동 기록이 없습니다\.'/);
  });

  test('같은 날 앞서 돌린 시뮬레이터 점이 남아 있어도 그날 기기 거부면 시연 점을 쓰지 않고 거부로 안내한다', () => {
    const trip = scenarioTrip();
    trip.visits = [{ ...arrive('s-gj-bulguksa', D2, '10:00'), source: 'manual' }];
    const simPts = gps(coordOf(trip, 's-gj-bulguksa'), D2, 6).map((p) => ({ ...p, source: 'sim' as const }));
    let denied: DeniedStore = {};
    denied = noteLivePermission(denied, trip.id, D2, { requested: 'sim', permission: 'granted', at: atKst(D2, '08:00') });
    denied = noteLivePermission(denied, trip.id, D2, { requested: 'device', permission: 'denied', at: atKst(D2, '09:00') });
    const m = recordMapModel(trip, planFor(trip, [D2]), D2, simPts, { now: NOW, denied: denied[trip.id]?.[D2] });
    assert.deepEqual(m.notices, ['denied']);
    assert.equal(m.gpsPoints, 0);
    assert.equal(m.arrivals, 1);
    // 거부 기록이 없거나 시뮬레이터 거부면 시뮬레이터 점은 그대로 시뮬레이터 기록으로 보인다
    assert.deepEqual(recordMapModel(trip, planFor(trip, [D2]), D2, simPts, { now: NOW }).notices, ['sim']);
    assert.equal(recordMapModel(trip, planFor(trip, [D2]), D2, simPts, { now: NOW }).gpsPoints, 6);
  });

  test('시뮬레이터 권한 거부 프리셋으로 남은 날은 시뮬레이터 기록이라고 함께 알린다', () => {
    const trip = scenarioTrip();
    trip.visits = [arrive('s-gj-bulguksa', D2, '09:25')];
    const m = recordMapModel(trip, planFor(trip, [D2]), D2, [], { now: NOW, denied: { at: atKst(D2, '09:00'), source: 'sim' } });
    assert.deepEqual(m.notices, ['denied', 'sim']);
  });

  test('위치 이력 90일이 지나면 거부 안내 대신 만료 안내만 띄운다', () => {
    const trip = scenarioTrip();
    trip.visits = [arrive('s-gj-bulguksa', D2, '09:25'), arrive('s-gj-seokguram', D2, '11:07')];
    const boundary = atKst('2026-10-20', '00:00') + 90 * 24 * 60 * 60 * 1000;
    const m = recordMapModel(trip, planFor(trip, [D2]), D2, [], { now: boundary, denied: { at: 1, source: 'device' } });
    assert.deepEqual(m.notices, ['expired']);
  });

  test('기록 지도는 지금 권한 상태가 아니라 그날 거부 기록을 읽는다', () => {
    const src = readFileSync('src/screens/RecordMapScreen.tsx', 'utf8');
    assert.match(src, /useLive\(\(s\) => s\.denied\[tripId\]\)/);
    assert.doesNotMatch(src, /s\.permission/);
    assert.match(src, /이 날은 위치 권한이 없어 도착 지점만 순서대로 이었습니다/);
  });
});
