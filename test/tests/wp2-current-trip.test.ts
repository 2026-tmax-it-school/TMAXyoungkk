import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickCurrentTrip } from '../src/core/trip/current';
import type { Trip } from '../src/types';
import { scenarioTrip } from './helpers/fixtures';
import { read } from './setup/scan';

/**
 * 지금 보는 여행방 고르기(pickCurrentTrip). 홈·일정·후보·지도·프로필이 같은 규칙으로 방을 고른다.
 * 지정한 방 → 진행 중 첫 방 → 예정 첫 방 → 가장 최근에 끝난 방 → 없음.
 */

const ME = 'u-me';
const TODAY = '2026-10-18';

function trip(id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip {
  const base = scenarioTrip();
  return {
    ...base,
    id,
    title: id,
    startDate,
    endDate,
    createdAt: 1000,
    members: [{ ...base.members[0], userId: ME, leftAt: undefined }],
    ...extra,
  };
}

const ongoing = trip('ongoing', '2026-10-17', '2026-10-19');
const ongoingLater = trip('ongoing-later', '2026-10-18', '2026-10-20');
const upcomingFar = trip('upcoming-far', '2026-12-01', '2026-12-03');
const upcomingNear = trip('upcoming-near', '2026-11-01', '2026-11-02');
const doneOld = trip('done-old', '2026-08-01', '2026-08-02');
const doneRecent = trip('done-recent', '2026-10-01', '2026-10-03');

test('지정한 방이 먼저다(상태와 상관없이)', () => {
  const all = [ongoing, upcomingNear, doneRecent];
  assert.equal(pickCurrentTrip(all, 'done-recent', TODAY, ME)?.id, 'done-recent');
  assert.equal(pickCurrentTrip(all, 'upcoming-near', TODAY)?.id, 'upcoming-near');
});

test('지정한 방이 없거나 목록에 없으면 진행 중 → 예정 → 최근 완료 순으로 고른다', () => {
  assert.equal(pickCurrentTrip([doneRecent, upcomingNear, ongoingLater, ongoing], undefined, TODAY, ME)?.id, 'ongoing');
  assert.equal(pickCurrentTrip([doneRecent, upcomingFar, upcomingNear], 'gone', TODAY, ME)?.id, 'upcoming-near');
  assert.equal(pickCurrentTrip([doneOld, doneRecent], undefined, TODAY, ME)?.id, 'done-recent');
});

test('나간 방과 삭제된 방은 지정했어도 건너뛴다', () => {
  const left = trip('left', '2026-10-17', '2026-10-19', {
    members: [{ ...ongoing.members[0], userId: ME, leftAt: 5, leftReason: 'left' }],
  });
  const deleted = trip('deleted', '2026-10-17', '2026-10-19', { deletedAt: 9 });
  assert.equal(pickCurrentTrip([left, deleted, upcomingNear], 'left', TODAY, ME)?.id, 'upcoming-near');
  assert.equal(pickCurrentTrip([left, deleted, upcomingNear], 'deleted', TODAY, ME)?.id, 'upcoming-near');
  // userId 없이(이미 내 방만 거른 목록) 불러도 삭제된 방은 건너뛴다
  assert.equal(pickCurrentTrip([deleted, doneRecent], 'deleted', TODAY)?.id, 'done-recent');
});

test('오늘이 시작일·종료일이면 진행 중이다(KST 날짜 경계)', () => {
  assert.equal(pickCurrentTrip([upcomingNear, ongoingLater], undefined, '2026-10-18', ME)?.id, 'ongoing-later');
  assert.equal(pickCurrentTrip([upcomingNear, ongoingLater], undefined, '2026-10-20', ME)?.id, 'ongoing-later');
  assert.equal(pickCurrentTrip([upcomingNear, ongoingLater], undefined, '2026-10-21', ME)?.id, 'upcoming-near');
});

test('방이 없으면 undefined', () => {
  assert.equal(pickCurrentTrip([], undefined, TODAY, ME), undefined);
  assert.equal(pickCurrentTrip([], 'x', TODAY), undefined);
});

test('useActiveTrip은 pickCurrentTrip을 쓰고 고른 방을 저장값에 맞춘다', () => {
  const hook = read('src/features/trip/useActiveTrip.ts');
  assert.match(hook, /pickCurrentTrip\(trips, currentTripId, today\)/);
  assert.match(hook, /useMyTrips\(\)/);
  assert.match(hook, /if \(trip && trip\.id !== currentTripId\) setCurrentTrip\(trip\.id\)/);
  const bar = read('src/features/trip/components/TripBar.tsx');
  assert.match(bar, /if \(trips\.length === 0\) return null;/);
  assert.match(bar, /여행방을 골라 주세요/);
  // 오른쪽 채팅·멤버·설정 아이콘은 뺐다(같은 일은 아래 빠른 메뉴 TripActions가 한다)
  assert.doesNotMatch(bar, /IconBtn icon="(chat|users|gear)"/);
  assert.match(bar, /<MapPill/);
  // 360px에서도 이름이 줄 너비를 쓰도록 상태 칩은 이름 줄 아래 줄에 둔다(이름 옆에 두면 아이콘 셋과 겹쳐 이름이 한두 글자로 잘림)
  assert.match(bar, /<Icon name="down"[^>]*\/>\s*<\/View>\s*\{badge \? <Chip text=\{badge\}/);
  assert.ok(!/E\.float/.test(bar), 'TripBar는 그림자를 직접 쓰지 않는다(MapPill이 맡음)');
});
