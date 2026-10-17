import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { LatLng, Plan, TrackPoint, Trip, Visit } from '../src/types';
import { buildDayTrack, plannedPath, TRACK_GAP_MS } from '../src/core/journal/track';
import { isTrackExpired } from '../src/core/tripStatus';
import { atKst } from '../src/core/util';
import { fixturePlan1018, memberId, scenarioTrip } from './helpers/fixtures';

/** WP6 FR-704 이동 경로 기록, FR-804 실제 경로 표시 데이터(기록 지도 화면은 2026-10-17에 없앴다) */

const D = '2026-10-18';

function plan(trip: Trip): Plan {
  return {
    tripId: trip.id,
    days: [fixturePlan1018()],
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

function arrive(trip: Trip, spot: string, hhmm: string): Visit {
  const t = atKst(D, hhmm);
  void trip;
  return { id: `v-${spot}`, spotId: spot, date: D, memberId: memberId('minji'), arrivedAt: t, status: 'arrived', source: 'sim', at: t };
}

/** a에서 b로 30초 간격 직선 이동 샘플 */
function samples(a: LatLng, b: LatLng, from: number, n: number, accuracyM: number | null = 10): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 0 : i / (n - 1);
    return {
      t: from + i * 30_000,
      coord: { latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f },
      accuracyM,
      source: 'sim' as const,
    };
  });
}

describe('FR-704 경로 데이터', () => {
  test('도착 기록과 위치 로그를 시간순으로 잇는다', () => {
    const trip = scenarioTrip();
    const bul = coordOf(trip, 's-gj-bulguksa');
    const seok = coordOf(trip, 's-gj-seokguram');
    trip.visits = [arrive(trip, 's-gj-seokguram', '11:07'), arrive(trip, 's-gj-bulguksa', '09:25')];
    const pts = samples(bul, seok, atKst(D, '10:55'), 24);
    const tr = buildDayTrack(trip, plan(trip), D, pts);
    assert.equal(tr.arrivalsOnly, false);
    assert.equal(tr.actual.length, 26);
    assert.deepEqual(tr.actual[0], bul);
    assert.deepEqual(tr.actual[tr.actual.length - 1], seok);
    const ts = tr.marks.map((m) => m.t);
    assert.deepEqual(ts, [...ts].sort((x, y) => x - y));
    // 위치 로그가 있는 날은 GPS 점끼리만 잇는다(도착 점은 점열에 섞지 않는다)
    assert.equal(tr.gaps.length, 0);
    assert.equal(tr.segments.length, 1);
    assert.equal(tr.segments[0].length, 24);
  });

  test('위치 권한이 거부돼 로그가 없으면 도착 지점만 순서대로 잇고 그 사이는 기록 없는 구간이다', () => {
    const trip = scenarioTrip();
    trip.visits = [
      arrive(trip, 's-gj-gyochon-hanjeongsik', '12:57'),
      arrive(trip, 's-gj-bulguksa', '09:25'),
      arrive(trip, 's-gj-seokguram', '11:07'),
    ];
    const tr = buildDayTrack(trip, plan(trip), D, []);
    assert.equal(tr.arrivalsOnly, true);
    assert.deepEqual(tr.actual, [
      coordOf(trip, 's-gj-bulguksa'),
      coordOf(trip, 's-gj-seokguram'),
      coordOf(trip, 's-gj-gyochon-hanjeongsik'),
    ]);
    assert.equal(tr.gaps.length, 2);
  });

  test('여러 멤버가 같은 스팟에 도착해도 점은 하나, 취소·지나침은 넣지 않는다', () => {
    const trip = scenarioTrip();
    const v = arrive(trip, 's-gj-bulguksa', '09:25');
    trip.visits = [
      v,
      { ...v, id: 'v2', memberId: memberId('junho'), arrivedAt: atKst(D, '09:30') },
      { ...arrive(trip, 's-gj-seokguram', '11:07'), status: 'cancelled' },
      { ...arrive(trip, 's-gj-museum', '12:00'), status: 'skipped' },
    ];
    const tr = buildDayTrack(trip, plan(trip), D, []);
    assert.equal(tr.marks.length, 1);
    assert.equal(tr.marks[0].t, atKst(D, '09:25'));
  });

  test('정확도가 나쁜 샘플과 다른 날 샘플은 쓰지 않고, EXIF 사진 위치는 점으로 더한다', () => {
    const trip = scenarioTrip();
    const bul = coordOf(trip, 's-gj-bulguksa');
    const pts = [
      ...samples(bul, bul, atKst(D, '10:00'), 2, 20),
      ...samples(bul, bul, atKst(D, '10:05'), 1, 500),
      ...samples(bul, bul, atKst('2026-10-17', '10:00'), 1, 5),
    ];
    trip.photos = [
      { id: 'p1', memberId: memberId('minji'), bytes: 1, originalBytes: 1, compressed: false, takenAt: atKst(D, '10:10'), coord: bul, source: 'exif', uploadedAt: 1 },
      { id: 'p2', memberId: memberId('minji'), bytes: 1, originalBytes: 1, compressed: false, takenAt: atKst(D, '10:20'), coord: bul, source: 'estimated', uploadedAt: 1 },
    ];
    const tr = buildDayTrack(trip, plan(trip), D, pts);
    assert.deepEqual(tr.marks.map((m) => m.kind), ['gps', 'gps', 'photo']);
  });
});

describe('FR-804 실제 경로 표시 데이터', () => {
  test('계획 루트는 기점 → 스팟 순서 → 기점이다', () => {
    const trip = scenarioTrip();
    const p = plan(trip);
    const path = plannedPath(trip, p, D);
    const base = p.days[0].base!.coord;
    assert.deepEqual(path, [
      base,
      coordOf(trip, 's-gj-bulguksa'),
      coordOf(trip, 's-gj-seokguram'),
      coordOf(trip, 's-gj-gyochon-hanjeongsik'),
      base,
    ]);
    p.days[0].noReturn = true;
    assert.equal(plannedPath(trip, p, D).length, 4);
    assert.deepEqual(plannedPath(trip, undefined, D), []);
    assert.deepEqual(buildDayTrack(trip, p, D, []).planned.length, 4);
  });

  test('기록이 끊긴 구간(백그라운드 공백)은 dashed 대상이고 채워 넣지 않는다', () => {
    const trip = scenarioTrip();
    const bul = coordOf(trip, 's-gj-bulguksa');
    const seok = coordOf(trip, 's-gj-seokguram');
    const gyo = coordOf(trip, 's-gj-gyochon-hanjeongsik');
    const leg1 = samples(bul, seok, atKst(D, '10:55'), 20);
    // 앱이 백그라운드로 가 12:40까지 기록 없음. 그사이 교촌마을 쪽으로 이동
    const leg2 = samples(gyo, gyo, atKst(D, '12:40'), 3);
    const tr = buildDayTrack(trip, plan(trip), D, [...leg1, ...leg2]);
    assert.equal(tr.gaps.length, 1);
    assert.deepEqual(tr.gaps[0], [seok, gyo]);
    assert.equal(tr.actual.length, 23, '공백 구간에 점을 만들어 넣지 않는다');
  });

  test('간격이 5분 이하면 멀리 움직여도 공백이 아니다(자동차 30초 샘플)', () => {
    const trip = scenarioTrip();
    const bul = coordOf(trip, 's-gj-bulguksa');
    const seok = coordOf(trip, 's-gj-seokguram');
    const pts: TrackPoint[] = [
      { t: atKst(D, '10:55'), coord: bul, accuracyM: 10, source: 'sim' },
      { t: atKst(D, '10:55') + TRACK_GAP_MS, coord: seok, accuracyM: 10, source: 'sim' },
    ];
    assert.equal(buildDayTrack(trip, plan(trip), D, pts).gaps.length, 0);
    pts[1] = { ...pts[1], t: pts[1].t + 1 };
    assert.equal(buildDayTrack(trip, plan(trip), D, pts).gaps.length, 1);
  });

  test('위치 이력 90일 판정은 공유 isTrackExpired를 쓴다', () => {
    const trip = scenarioTrip();
    const boundary = atKst('2026-10-20', '00:00') + 90 * 24 * 60 * 60 * 1000;
    assert.equal(isTrackExpired(trip, boundary - 1), false);
    assert.equal(isTrackExpired(trip, boundary), true);
  });
});
