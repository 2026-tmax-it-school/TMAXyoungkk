import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { DaySetting } from '../src/types';
import { basesToClear, datesBrief, datesChangeNeedsConfirm, droppedDates } from '../src/core/trip/edit';

/**
 * 25 여행방 설정: 만든 뒤 방장이 지역·날짜·주 이동수단을 바꾼다(2026-10-10).
 * 순수 규칙(core/trip/edit)과 화면 소스 규칙(방장만 편집칸, 확인 뒤 적용)을 본다.
 */

const trip = { startDate: '2026-10-10', endDate: '2026-10-12' };

test('기간을 바꾸면 빠지는 날짜를 알려 준다', () => {
  assert.deepEqual(droppedDates(trip, '2026-10-11', '2026-10-13'), ['2026-10-10']);
  assert.deepEqual(droppedDates(trip, '2026-10-09', '2026-10-13'), []);
  assert.deepEqual(droppedDates(trip, '2026-10-20', '2026-10-21'), ['2026-10-10', '2026-10-11', '2026-10-12']);
  assert.equal(datesChangeNeedsConfirm(trip, '2026-10-10', '2026-10-11'), true);
  assert.equal(datesChangeNeedsConfirm(trip, '2026-10-10', '2026-10-14'), false);
});

test('지역을 바꾸면 장소로 정한 기점만 비운다', () => {
  const base = { placeId: 'p1', name: '숙소', coord: { latitude: 35.8, longitude: 129.2 } };
  const days = [
    { date: '2026-10-10', base, noReturn: false },
    { date: '2026-10-11', base: 'inherit', noReturn: false },
    { date: '2026-10-12', base: null, noReturn: false },
  ] as DaySetting[];
  assert.deepEqual(basesToClear(days), ['2026-10-10']);
});

test('확인 문구의 날짜 목록', () => {
  assert.equal(datesBrief(['2026-10-10', '2026-10-11']), '10/10, 10/11');
  assert.equal(datesBrief(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']), '10/10, 10/11, 10/12 외 2일');
});

test('화면 규칙: 방장만 지역·날짜·이동수단 편집칸, 빠지는 날짜·기점 비우기는 확인 뒤', () => {
  const src = readFileSync('src/screens/TripSettingsScreen.tsx', 'utf8');
  assert.match(src, /\{host && !locked \? \(\s*<Col gap=\{SP\.m\}>\s*<PickerBox label="지역"/);
  assert.match(src, /patch: \{ region: id \}/);
  assert.match(src, /patch: \{ startDate: start, endDate: end \}/);
  assert.match(src, /patch: \{ transport: t \}/);
  assert.match(src, /if \(droppedDates\(trip, start, end\)\.length > 0\) \{\s*setConfirm\('dates'\);\s*return;/);
  assert.match(src, /if \(basesToClear\(trip\.days\)\.length > 0\) \{\s*setNextRegion\(id\);\s*setConfirm\('region'\);/);
  assert.match(src, /josa\(datesBrief\(dropped\), '이\/가'\)/);
});
