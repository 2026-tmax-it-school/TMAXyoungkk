import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Plan, Trip } from '../src/types';
import { atKst } from '../src/core/util';
import {
  countsText,
  defaultSegment,
  homeMenu,
  homeSegments,
  tripBadge,
  tripCardInfo,
  tripCounts,
  tripDateText,
} from '../src/features/account/home';
import { NOTIFY_ROWS, retentionText, sessionSummary } from '../src/features/account/settings';
import { issueGuest } from '../src/core/session';
import { SESSION_EXPIRY_NOTICE_MS } from '../src/core/constants';
import { scenarioTrip } from './helpers/fixtures';
import { seededRng } from './helpers/fakes';

/**
 * WP1 03 홈(FR-203): 예정·진행중·완료 세그먼트 집계(공유 tripStatus, KST), 카드 문구, 메뉴 6칸 판정.
 * UTC 회귀 자체는 foundation-core가 본다. 여기서는 홈이 그 판정을 그대로 쓰는지만 본다.
 */

function trip(id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip {
  return { ...scenarioTrip(), id, title: `여행 ${id}`, startDate, endDate, ...extra };
}

function personal(t: Trip): Trip {
  return { ...t, members: t.members.filter((m) => m.role === 'host') };
}

const NOW = atKst('2026-10-18', '12:00');

describe('세그먼트 집계', () => {
  const trips = [
    trip('past', '2026-09-01', '2026-09-03'),
    trip('now', '2026-10-17', '2026-10-19'),
    trip('soon', '2026-11-01', '2026-11-02'),
    trip('later', '2026-12-24', '2026-12-26'),
    trip('gone', '2026-10-17', '2026-10-19', { deletedAt: NOW - 1 }),
  ];

  test('예정·진행중·완료 개수를 센다. 삭제된 방은 빠진다', () => {
    const s = homeSegments(trips, NOW);
    assert.deepEqual(s.counts, { upcoming: 2, ongoing: 1, done: 1 });
    assert.deepEqual(
      s.groups.upcoming.map((t) => t.id),
      ['soon', 'later'],
    );
  });

  test('앱 시각(시뮬레이터)이 바뀌면 같은 방의 세그먼트도 바뀐다', () => {
    const t = [trip('now', '2026-10-17', '2026-10-19')];
    assert.equal(homeSegments(t, atKst('2026-10-16', '23:59')).counts.upcoming, 1);
    // 시작일 00:30 KST는 진행중(UTC로 판정하면 전날이 된다)
    assert.equal(homeSegments(t, atKst('2026-10-17', '00:30')).counts.ongoing, 1);
    assert.equal(homeSegments(t, atKst('2026-10-19', '23:59')).counts.ongoing, 1);
    assert.equal(homeSegments(t, atKst('2026-10-20', '00:00')).counts.done, 1);
  });

  test('처음 여는 칸: 진행중 → 예정 → 완료 순으로 있는 칸', () => {
    assert.equal(defaultSegment({ upcoming: 1, ongoing: 1, done: 1 }), 'ongoing');
    assert.equal(defaultSegment({ upcoming: 1, ongoing: 0, done: 1 }), 'upcoming');
    assert.equal(defaultSegment({ upcoming: 0, ongoing: 0, done: 2 }), 'done');
    assert.equal(defaultSegment({ upcoming: 0, ongoing: 0, done: 0 }), 'ongoing');
  });

  test('여행방이 0개면 모든 칸이 비어 있다(화면은 생성 유도 Empty)', () => {
    assert.deepEqual(homeSegments([], NOW).counts, { upcoming: 0, ongoing: 0, done: 0 });
  });
});

describe('카드 문구', () => {
  const t = trip('now', '2026-10-17', '2026-10-19');

  test('D-일, N일째, 여행 끝', () => {
    assert.equal(tripBadge(t, atKst('2026-10-14', '09:00')), '여행 3일 전 · D-3');
    assert.equal(tripBadge(t, atKst('2026-10-16', '09:00')), '여행 하루 전 · D-1');
    assert.equal(tripBadge(t, atKst('2026-10-18', '09:00')), '여행 중 · 2일째');
    assert.equal(tripBadge(t, atKst('2026-10-20', '09:00')), '여행 끝');
  });

  test('날짜 문구: 같은 달이면 끝에 달을 생략한다', () => {
    assert.equal(tripDateText(t), '10월 17일 – 19일');
    assert.equal(tripDateText({ startDate: '2026-10-31', endDate: '2026-11-01' }), '10월 31일 – 11월 1일');
    assert.equal(tripDateText({ startDate: '2026-10-17', endDate: '2026-10-17' }), '10월 17일');
  });

  test('후보·확정·제외 수: 계획이 없으면 계산 전', () => {
    const c = tripCounts(t);
    assert.equal(c.candidates, 14);
    assert.equal(countsText(c), '후보 14곳 · 계산 전');
    const plan = {
      days: [{ items: new Array(4) }, { items: new Array(7) }],
      excluded: new Array(3),
    } as unknown as Plan;
    assert.equal(countsText(tripCounts(t, plan)), '후보 14곳 · 확정 11 · 제외 3');
    assert.match(countsText({ candidates: 0 }), /후보 없음/);
  });

  test('카드 정보에 활성 멤버 아바타 이름이 들어간다', () => {
    const info = tripCardInfo(t, undefined, NOW);
    assert.deepEqual(info.memberNames, ['민지', '준호', '수아', '지우']);
    assert.match(info.dateText, /자동차/);
  });
});

describe('메뉴 6칸', () => {
  test('목업 03 순서의 6칸이다', () => {
    assert.deepEqual(
      homeMenu(trip('a', '2026-10-17', '2026-10-19')).map((c) => c.key),
      ['create', 'chat', 'candidates', 'map', 'members', 'navigate'],
    );
  });

  test('개인 모드(활성 멤버 1명)면 채팅 칸이 비활성이고 이유를 적는다', () => {
    const chat = homeMenu(personal(trip('a', '2026-10-17', '2026-10-19'))).find((c) => c.key === 'chat');
    assert.ok(chat);
    assert.equal(chat.disabled, true);
    assert.match(chat.reason ?? '', /초대/);
  });

  test('그룹 모드면 채팅 칸이 열린다', () => {
    const chat = homeMenu(trip('a', '2026-10-17', '2026-10-19')).find((c) => c.key === 'chat');
    assert.equal(chat?.disabled, false);
  });

  test('방장 외 전원이 나가면 다시 개인 모드라 채팅이 닫힌다', () => {
    const t = trip('a', '2026-10-17', '2026-10-19');
    const alone = { ...t, members: t.members.map((m) => (m.role === 'host' ? m : { ...m, leftAt: NOW })) };
    assert.equal(homeMenu(alone).find((c) => c.key === 'chat')?.disabled, true);
  });

  test('길찾기 칸은 활성이고 ScopeBadge 2차다', () => {
    const nav = homeMenu(trip('a', '2026-10-17', '2026-10-19')).find((c) => c.key === 'navigate');
    assert.equal(nav?.disabled, false);
    assert.equal(nav?.scope, '2차');
  });

  test('여행방이 없으면 만들기만 열린다', () => {
    const cells = homeMenu(undefined);
    assert.deepEqual(
      cells.filter((c) => !c.disabled).map((c) => c.key),
      ['create'],
    );
    assert.ok(cells.filter((c) => c.disabled).every((c) => (c.reason ?? '').length > 0));
  });
});

describe('18 설정 문구', () => {
  test('알림 4종 전부 끌 수 있는 줄이 있다', () => {
    assert.deepEqual(NOTIFY_ROWS.map((r) => r.kind).sort(), ['arrival', 'delay', 'freeTime', 'sessionExpiry']);
  });

  test('게스트 세션 요약은 만료일과 토큰 끝 4자리만 보인다', () => {
    const s = issueGuest({ nickname: '민지', rng: seededRng(9), now: NOW });
    const sum = sessionSummary(s, NOW);
    const text = sum.lines.join(' ');
    assert.ok(text.includes(s.deviceToken.slice(-4)));
    assert.ok(!text.includes(s.deviceToken));
    assert.equal(sum.soon, false);
    assert.equal(sessionSummary(s, s.expiresAt - SESSION_EXPIRY_NOTICE_MS).soon, true);
    assert.equal(sessionSummary(undefined, NOW).title, '세션 없음');
  });

  test('보관 기한은 종료 다음 날부터 1년, 마지막 보관일을 적는다', () => {
    const t = trip('now', '2026-10-17', '2026-10-19');
    assert.match(retentionText(t), /2027-10-19까지 보관/);
    assert.match(retentionText(undefined), /1년/);
  });
});
