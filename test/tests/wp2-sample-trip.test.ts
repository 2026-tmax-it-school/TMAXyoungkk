import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { SAMPLE_PLACE_PREFIX, defaultSampleStart, sampleDates, sampleDayBase, sampleFitNote, sampleOps, samplePlace, sampleSpotCount } from '../src/core/trip/sample';
import { SAMPLE_TRIPS, sampleTripFor } from '../src/data/sampleTrips';
import { regionById } from '../src/data/regions';
import { HOME_PICKS } from '../src/features/account/home';
import { haversineKm, weekday } from '../src/core/util';
import { applyOp } from '../src/core/ops';
import type { Trip } from '../src/types';
import { buildPlan } from '../src/core/planner';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { buildDays } from '../src/core/trip/create';

/**
 * 추천 여행지 예시 2박 3일(2026-10-17). 홈 추천 여행지 여섯 곳 모두에 예시가 있고, 데이터가 앞뒤가 맞고, 방을 만든 직후
 * 보내는 op가 후보·날짜·순서를 정확히 만들고, 홈 타일과 만들기 화면이 예시 흐름으로 이어지는지 본다.
 */

const read = (p: string) => readFileSync(p, 'utf8');

test('홈 추천 여행지 여섯 곳 모두 예시 2박 3일이 있다', () => {
  assert.equal(HOME_PICKS.length, 6);
  for (const p of HOME_PICKS) {
    const s = sampleTripFor(p.id);
    assert.ok(s, p.id);
    assert.equal(s.regionId, p.id);
    assert.equal(s.days.length, 3, `${p.id} 3일`);
    assert.ok(regionById(p.id), `${p.id} 지역 목록`);
  }
  assert.deepEqual(Object.keys(SAMPLE_TRIPS).sort(), HOME_PICKS.map((p) => p.id).sort());
});

test('예시 데이터: 하루 4~5곳, 장소 id·이름 중복 없음, 좌표는 지역 안, 기점도 지역 안, 분류·소개·주소가 있다', () => {
  const CATEGORIES = new Set(['식당', '카페', '관광지', '쇼핑', '공원', '기타']);
  for (const s of Object.values(SAMPLE_TRIPS)) {
    const region = regionById(s.regionId)!;
    const ids = new Set<string>();
    const names = new Set<string>();
    assert.ok(haversineKm(region.center, s.base.coord) <= region.radiusKm, `${s.regionId} 기점`);
    for (const [i, d] of s.days.entries()) {
      assert.ok(d.places.length >= 4 && d.places.length <= 5, `${s.regionId} ${i + 1}일차 ${d.places.length}곳`);
      assert.ok(d.title && d.blurb);
      for (const p of d.places) {
        assert.ok(!ids.has(p.id), `중복 id ${p.id}`);
        assert.ok(!names.has(p.name), `중복 이름 ${p.name}`);
        ids.add(p.id);
        names.add(p.name);
        assert.ok(CATEGORIES.has(p.category), `${p.name} 분류`);
        assert.ok(p.note.length > 4 && p.address.length > 4, p.name);
        const km = haversineKm(region.center, p.coord);
        assert.ok(km <= region.radiusKm, `${s.regionId} ${p.name} 지역 밖 ${km.toFixed(1)}km`);
        // 한국 안 좌표
        assert.ok(p.coord.latitude > 33 && p.coord.latitude < 39 && p.coord.longitude > 124 && p.coord.longitude < 132, p.name);
      }
    }
    // 같은 날 이웃한 두 장소 사이는 40km를 넘지 않는다(하루에 현실적으로 도는 코스)
    for (const d of s.days) {
      for (let i = 1; i < d.places.length; i += 1) {
        assert.ok(haversineKm(d.places[i - 1].coord, d.places[i].coord) <= 45, `${s.regionId} ${d.places[i].name}`);
      }
    }
  }
});

test('예시 장소 → 후보 장소: placeId는 sample: 접두사, 기점도 같은 접두사', () => {
  const s = sampleTripFor('busan')!;
  const p = samplePlace(s.days[0].places[0]);
  assert.equal(p.placeId, `${SAMPLE_PLACE_PREFIX}busan-1-1`);
  assert.equal(p.name, '감천문화마을');
  assert.equal(sampleDayBase(s.base).placeId, `${SAMPLE_PLACE_PREFIX}base-busan`);
  assert.equal(sampleSpotCount(s), 12);
  assert.equal(sampleSpotCount(sampleTripFor('jeonju')!), 13);
});

test('기본 시작일은 사흘 뒤부터 처음 오는 금요일', () => {
  for (const today of ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-21', '2026-10-22', '2026-10-23']) {
    const start = defaultSampleStart(today);
    assert.equal(weekday(start), 5, today);
    assert.ok(start > today);
  }
  assert.equal(defaultSampleStart('2026-10-17'), '2026-10-23');
  assert.equal(defaultSampleStart('2026-10-20'), '2026-10-23');
  assert.equal(defaultSampleStart('2026-10-21'), '2026-10-30');
});

test('방을 만든 직후 op: 후보 전부 → 날짜 지정 → 날짜별 순서(예시 순서 그대로)', () => {
  const s = sampleTripFor('gyeongju')!;
  const dates = sampleDates('2026-10-23', '2026-10-25');
  let n = 0;
  const { drafts, spots } = sampleOps(s, { dates, memberId: 'm1', at: 1000, newSpotId: () => `s${(n += 1)}` });
  assert.equal(spots.length, 12);
  const types = drafts.map((d) => d.type);
  assert.equal(types.filter((t) => t === 'spot/add').length, 12);
  assert.equal(types.filter((t) => t === 'schedule/setDate').length, 12);
  assert.equal(types.filter((t) => t === 'schedule/reorder').length, 3);
  assert.ok(types.lastIndexOf('spot/add') < types.indexOf('schedule/setDate'), '추가가 먼저');
  assert.ok(types.lastIndexOf('schedule/setDate') < types.indexOf('schedule/reorder'), '날짜가 순서보다 먼저');
  const r1 = drafts.find((d) => d.type === 'schedule/reorder' && d.date === '2026-10-23');
  assert.ok(r1 && r1.type === 'schedule/reorder');
  if (r1 && r1.type === 'schedule/reorder') assert.deepEqual(r1.spotIds, ['s1', 's2', 's3', 's4']);
  for (const sp of spots) {
    assert.equal(sp.placeId.startsWith(SAMPLE_PLACE_PREFIX), true);
    assert.equal(sp.proposals[0].memberId, 'm1');
    assert.equal(sp.proposals[0].source, 'manual');
  }
});

test('기간이 3일보다 짧으면 남는 날 장소는 날짜 없이 후보로만', () => {
  const s = sampleTripFor('busan')!;
  let n = 0;
  const { drafts } = sampleOps(s, { dates: sampleDates('2026-10-23', '2026-10-24'), memberId: 'm1', at: 1, newSpotId: () => `s${(n += 1)}` });
  const setDate = drafts.filter((d) => d.type === 'schedule/setDate');
  assert.equal(drafts.filter((d) => d.type === 'spot/add').length, 12);
  assert.equal(setDate.length, 8);
  assert.equal(drafts.filter((d) => d.type === 'schedule/reorder').length, 2);
  const none = sampleOps(s, { dates: [], memberId: 'm1', at: 1, newSpotId: () => `x${(n += 1)}` });
  assert.equal(none.drafts.filter((d) => d.type !== 'spot/add').length, 0);
  assert.equal(sampleFitNote(2, 3)?.includes('짧아서'), true);
  assert.equal(sampleFitNote(5, 3)?.includes('예시는 3일'), true);
  assert.equal(sampleFitNote(3, 3), undefined);
  assert.equal(sampleFitNote(0, 3), undefined);
});

test('op를 문서에 적용하면 후보 12곳이 날짜와 순서를 갖는다', () => {
  const s = sampleTripFor('yeosu')!;
  const base: Trip = {
    id: 't1',
    title: '여수 2박 3일',
    region: 'yeosu',
    startDate: '2026-10-23',
    endDate: '2026-10-25',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: sampleDates('2026-10-23', '2026-10-25').map((date) => ({ date, base: null, noReturn: false })),
    legs: [],
    members: [{ id: 'm1', userId: 'u1', nickname: '나', role: 'host', isGuest: false, canInvite: false, joinedAt: 1 }],
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 1,
    createdBy: 'u1',
    lastSeq: 0,
  };
  let n = 0;
  const { drafts } = sampleOps(s, { dates: sampleDates('2026-10-23', '2026-10-25'), memberId: 'm1', at: 1000, newSpotId: () => `s${(n += 1)}` });
  let doc = base;
  let seq = 0;
  for (const d of drafts) {
    seq += 1;
    doc = applyOp(doc, { ...d, id: `op${seq}`, tripId: 't1', actorId: 'm1', at: 1000 + seq, seq } as never) ?? doc;
  }
  assert.equal(doc.spots.length, 12);
  const byDate = (date: string) =>
    doc.spots
      .filter((sp) => sp.fixedDate === date)
      .sort((a, b) => (a.manualOrder?.index ?? 0) - (b.manualOrder?.index ?? 0))
      .map((sp) => sp.name);
  assert.deepEqual(byDate('2026-10-23'), s.days[0].places.map((p) => p.name));
  assert.deepEqual(byDate('2026-10-24'), s.days[1].places.map((p) => p.name));
  assert.deepEqual(byDate('2026-10-25'), s.days[2].places.map((p) => p.name));
});

test('화면 연결: 홈 타일 → 예시 일정 → 만들기(sample), 만든 직후 담기', () => {
  const home = read('src/screens/HomeScreen.tsx');
  assert.match(home, /navigation\.navigate\('SampleTrip', \{ regionId: p\.id \}\)/);
  const sampleScreen = read('src/screens/SampleTripScreen.tsx');
  assert.match(sampleScreen, /navigation\.navigate\('CreateTrip', \{ regionId, sample: true \}\)/);
  assert.match(sampleScreen, /navigation\.navigate\('CreateTrip', \{ regionId \}\)/);
  assert.match(sampleScreen, /text="예시 일정"/);
  const create = read('src/screens/CreateTripScreen.tsx');
  assert.match(create, /if \(useSample\) \{\s+applySampleTrip\(tripId, regionId, range\.start, range\.end, shared\);/);
  assert.match(create, /const useSample = sample && regionId === startRegion \? sample : undefined;/);
  const nav = read('src/navigation/RootNavigator.tsx');
  assert.match(nav, /<Stack\.Screen name="SampleTrip" component=\{SampleTripScreen\} \/>/);
  const apply = read('src/features/trip/sample.ts');
  assert.match(apply, /dispatchMany\(tripId, drafts, \{ actorId: me, quiet: true \}\)/);
});

test('여섯 지역 모두: 예시를 담고 계산하면 전부 확정, 제외·수용량 초과 0, 일차마다 예시 순서대로다(직선 추정 이동시간)', async () => {
  const NOW = Date.UTC(2026, 9, 17, 3, 0, 0);
  for (const s of Object.values(SAMPLE_TRIPS)) {
    const dates = sampleDates('2026-10-23', '2026-10-25');
    const trip: Trip = {
      id: `t-${s.regionId}`,
      title: s.title,
      region: s.regionId,
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      transport: 'car',
      dayStart: '09:00',
      dayEnd: '21:00',
      days: buildDays('2026-10-23', '2026-10-25', sampleDayBase(s.base)),
      legs: [],
      members: [{ id: 'm1', userId: 'u1', nickname: '나', role: 'host', isGuest: false, canInvite: false, joinedAt: 1 }],
      spots: [],
      messages: [],
      photos: [],
      visits: [],
      diaries: {},
      createdAt: 1,
      createdBy: 'u1',
      lastSeq: 0,
    };
    let n = 0;
    const { drafts } = sampleOps(s, { dates, memberId: 'm1', at: NOW, newSpotId: () => `sp${(n += 1)}` });
    let doc = trip;
    let seq = 0;
    for (const d of drafts) {
      seq += 1;
      doc = applyOp(doc, { ...d, id: `op${seq}`, tripId: trip.id, actorId: 'm1', at: NOW + seq, seq } as never) ?? doc;
    }
    const routes = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(NOW), kv: memoryKV() });
    const plan = await buildPlan(doc, { routes, now: NOW });
    const total = sampleSpotCount(s);
    assert.equal(plan.days.flatMap((d) => d.items).length, total, `${s.regionId} 확정`);
    assert.equal(plan.excluded.length, 0, `${s.regionId} 제외`);
    assert.equal(plan.overCapacity.length, 0, `${s.regionId} 초과`);
    for (const [i, d] of s.days.entries()) {
      const day = plan.days.find((x) => x.date === dates[i])!;
      assert.deepEqual(day.items.map((it) => it.name), d.places.map((p) => p.name), `${s.regionId} ${i + 1}일차 순서`);
    }
  }
});
