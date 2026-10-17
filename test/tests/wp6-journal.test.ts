import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { SCREEN_META } from '../src/navigation/routes';

/**
 * 여행일지(2026-10-17 사용자 요청): 일기와 사진을 한 화면(Journal)으로 합치고 기록 지도 기능은 없앴다.
 * 옛 화면(사진·일기·기록 지도)과 그 공통 탭이 남지 않았는지, 새 화면이 둘의 기능을 다 갖는지 소스로 본다.
 */

const read = (p: string) => readFileSync(p, 'utf8');

test('옛 화면과 기록 지도 코드가 없다', () => {
  for (const f of [
    'src/screens/PhotosScreen.tsx',
    'src/screens/DiaryScreen.tsx',
    'src/screens/RecordMapScreen.tsx',
    'src/features/journal/components/RecordTabs.tsx',
    'src/core/journal/recordMap.ts',
  ]) {
    assert.equal(existsSync(f), false, f);
  }
  const routes = read('src/navigation/routes.ts');
  assert.doesNotMatch(routes, /^\s+(Photos|Diary|RecordMap):/m);
  const nav = read('src/navigation/RootNavigator.tsx');
  assert.doesNotMatch(nav, /PhotosScreen|DiaryScreen|RecordMapScreen/);
  assert.match(nav, /<Stack\.Screen name="Journal" component=\{JournalScreen\} \/>/);
  assert.equal(SCREEN_META.Journal.wp, 'WP6');
  assert.ok(!('RecordMap' in SCREEN_META) && !('Photos' in SCREEN_META) && !('Diary' in SCREEN_META));
});

test('여행일지 화면: 날짜 탭(전체 포함) 아래 일기 블록과 사진, 사진 올리기·공유하기, 사진 정보·지우기', () => {
  const j = read('src/screens/JournalScreen.tsx');
  assert.match(j, /<DateSeg trip=\{trip\} value=\{date\} onChange=\{setDate\} all photoCounts=\{counts\} showCount \/>/);
  assert.match(j, /title="여행일지"/);
  assert.match(j, /const addPhotos = async \(source: 'device' \| 'sim'\)/);
  assert.match(j, /title=\{adding \? '올리는 중' : '사진 추가'\}/);
  // 직접 쓰기(일차별)와 공유(머리 메뉴)
  assert.match(j, /<Btn title="일기 쓰기" icon="pen"/);
  assert.match(j, /addDiaryNote\(tripId, date, text\)/);
  assert.match(j, /label="일기 공유하기"/);
  assert.match(j, /title="사진 정보"/);
  assert.match(j, /removePhoto\(tripId, confirmPhoto\.id\)/);
  assert.match(j, /navigation\.navigate\('CommunityCompose', \{ tripId, date \}\)/);
  assert.doesNotMatch(j, /RecordTabs|RecordMap/);
  // 일기가 없는 날에도 그날 사진 격자가 보인다
  assert.match(j, /dayPhotos\.length > 0 && size > 0/);
  // 일기 블록 안 사진도 누르면 정보
  assert.match(j, /onPhoto=\{setSelected\}/);
});

test('홈과 여행 진행에서는 모두 여행일지로 간다', () => {
  const home = read('src/screens/HomeScreen.tsx');
  assert.doesNotMatch(home, /navigate\('(Photos|Diary|RecordMap)'/);
  assert.match(home, /navigation\.navigate\('Journal', \{ tripId: current\.id \}\)/);
  const live = read('src/screens/LiveTripScreen.tsx');
  assert.match(live, /navigation\.navigate\('Journal', \{ tripId, date \}\)/);
});
