import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { liveStopReason } from '../src/core/live/session';

/**
 * 진행 시작 중 기다린 뒤 다시 보기(WP5, 리뷰 5). 소스 규칙 테스트다(store/live.ts는 zustand·RN에 기대 node에서 돌리지 않는다).
 * startLive는 일정 계산·구간 모양(SHAPE_WAIT_MS)·위치 권한을 기다린다. 그사이 로그아웃·탈퇴하거나 여행방을 지우거나 나가면
 * 구독(onTripsChange·세션)은 아직 걸리기 전이라 놓친다. 그래서 옛 문서로 시뮬레이터 시계를 앱 시계로 바꾸고 옛 방문 기록을
 * 덮고 재생을 시작했다. 이제 구간 모양을 기다린 뒤와 마지막 기다림 뒤에 같은 규칙(liveStopReason)으로 다시 보고,
 * 끝내야 하면 아무것도 바꾸기 전에 끝낸다. 마지막 확인부터 구독을 걸 때까지는 기다림이 없다.
 */

const src = readFileSync('src/store/live.ts', 'utf8');
const startLive = /const startLive = async[\s\S]*?\n {6}\};\n/.exec(src)?.[0] ?? '';

test('구간 모양을 기다린 뒤 로그아웃·여행방 삭제·나가기면 시계·방문 기록·궤적을 건드리기 전에 끝낸다', () => {
  assert.ok(startLive.length > 0);
  const waited = startLive.indexOf('await waitShapes(shapes, SHAPE_WAIT_MS);');
  const check = startLive.indexOf('if (stopFor(tripId, requested) || !freshDoc) return;');
  assert.ok(waited > 0 && check > waited, '기다린 뒤에 본다');
  assert.match(startLive.slice(waited, check), /if \(seq !== startSeq\) return;\n[\s\S]*const freshDoc = fresh\.docs\[tripId\];\n\s+$/);
  for (const effect of ['generateTrack(', 'ensureSimClock(', 'overrideServices(', 'staleSimVisits(', 'dispatchMany(']) {
    const i = startLive.indexOf(effect);
    assert.ok(i > check, `${effect}보다 먼저 본다`);
  }
  // 그날 시간표가 같으면 옛 방문 기록 덮기·영업 종료는 지금 문서로 본다
  const fresh = startLive.indexOf('doc = freshDoc;');
  assert.ok(fresh > check && fresh < startLive.indexOf('staleSimVisits(doc'));
  assert.ok(fresh < startLive.indexOf('closingMinutes(doc, date)'));
});

test('마지막 기다림(위치 권한) 뒤에 다시 보고, 그 뒤로 구독을 걸 때까지 기다림이 없다', () => {
  const lastAwait = startLive.lastIndexOf('await ');
  const check = startLive.indexOf('if (stopFor(tripId, mode)) {');
  assert.ok(check > lastAwait, '마지막 기다림 뒤에 본다');
  // 끝내면 덮어 둔 시뮬레이터 위치 제공자를 되돌린다(rt를 만들기 전이라 teardown이 모른다)
  assert.match(startLive.slice(check), /^if \(stopFor\(tripId, mode\)\) \{\n\s+restoreServices\?\.\(\);\n\s+return;\n\s+\}/);
  for (const effect of ['noteLivePermission(', 'clearSimTrackDay(', 'rt = {', 'watchControlFor(rt)', 'AppState.addEventListener', 'useTrips.subscribe', 'useSession.subscribe']) {
    assert.ok(startLive.indexOf(effect) > check, `${effect}보다 먼저 본다`);
  }
  const rest = startLive.slice(check);
  assert.doesNotMatch(rest, /\bawait\b/, '확인부터 구독까지 기다림이 없다');
});

test('시작 중 확인과 진행 중 확인은 같은 규칙(liveStopReason)이다', () => {
  assert.match(src, /const invalidReason = \(tripId: string, mode: LiveMode\) => \{[\s\S]*?return liveStopReason\(\{/);
  assert.match(src, /const stopFor = \(tripId: string, mode: LiveMode\): boolean => \{\n\s+const reason = invalidReason\(tripId, mode\);\n\s+if \(!reason\) return false;\n\s+get\(\)\.stop\(\);\n\s+toast\(LIVE_STOP_TEXT\[reason\]\);/);
  assert.match(src, /const stopIfInvalid = \(\): boolean => \(rt \? stopFor\(rt\.tripId, get\(\)\.mode\) : false\);/);
  // 시뮬레이터 시작 중에는 로그아웃·여행방 없음·멤버 아님으로 끝내고, '기기 위치 사용'은 보지 않는다
  const base = { signedIn: true, useDevice: false, mode: 'sim' as const, tripExists: true, member: true };
  assert.equal(liveStopReason(base), undefined);
  assert.equal(liveStopReason({ ...base, signedIn: false }), 'signedOut');
  assert.equal(liveStopReason({ ...base, tripExists: false, member: false }), 'tripGone');
  assert.equal(liveStopReason({ ...base, member: false }), 'tripGone');
  assert.equal(liveStopReason({ ...base, mode: 'device' }), 'deviceOff');
});
