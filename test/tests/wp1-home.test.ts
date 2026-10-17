import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import type { Plan, Trip } from '../src/types';
import { atKst } from '../src/core/util';
import {
  countsText,
  defaultSegment,
  homeActions,
  homeSegments,
  showsSegmentBar,
  tripBadge,
  tripCardInfo,
  tripCounts,
  tripDateText,
  tripNextStep,
  visibleSegments,
} from '../src/features/account/home';
import { NOTIFY_ROWS, retentionText, sessionSummary } from '../src/features/account/settings';
import { issueGuest } from '../src/core/session';
import { SESSION_EXPIRY_NOTICE_MS } from '../src/core/constants';
import { scenarioTrip } from './helpers/fixtures';
import { seededRng } from './helpers/fakes';

/**
 * WP1 03 홈(FR-203): 예정·진행 중·완료 세그먼트 집계(공유 tripStatus, KST), 카드 문구와 다음 할 일 버튼,
 * 선택한 여행방의 단계별 빠른 메뉴 4칸 판정.
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

describe('세그먼트는 칸이 있을 때만', () => {
  test('개수가 0보다 큰 칸만 진행 중 → 예정 → 완료 순으로 보인다', () => {
    assert.deepEqual(visibleSegments({ upcoming: 2, ongoing: 1, done: 1 }), ['ongoing', 'upcoming', 'done']);
    assert.deepEqual(visibleSegments({ upcoming: 2, ongoing: 0, done: 3 }), ['upcoming', 'done']);
    assert.deepEqual(visibleSegments({ upcoming: 0, ongoing: 0, done: 0 }), []);
  });

  test('세그먼트 줄은 여행방 4개 이상이고 보이는 칸이 2개 이상일 때만 그린다', () => {
    assert.equal(showsSegmentBar(4, ['ongoing', 'upcoming']), true);
    assert.equal(showsSegmentBar(3, ['ongoing', 'upcoming', 'done']), false);
    assert.equal(showsSegmentBar(5, ['upcoming']), false);
  });
});

describe('여행 표지 카드의 다음 할 일', () => {
  const today = '2026-10-18';
  const plan = { days: [{ date: '2026-11-01', items: [] }], excluded: [] } as unknown as Plan;

  test('완료면 기록 보기(기록 지도)', () => {
    const s = tripNextStep(trip('past', '2026-09-01', '2026-09-03'), plan, today);
    assert.equal(s.label, '기록 보기');
    assert.equal(s.route, 'RecordMap');
  });

  test('진행 중이면 오늘 여행 진행(오늘 날짜로)', () => {
    const s = tripNextStep(trip('now', '2026-10-17', '2026-10-19'), undefined, today);
    assert.equal(s.label, '오늘 여행 진행');
    assert.deepEqual(s.route === 'LiveTrip' ? s.date : undefined, today);
  });

  test('예정인데 후보가 0곳이면 후보 모으기', () => {
    const s = tripNextStep(trip('soon', '2026-11-01', '2026-11-02', { spots: [] }), plan, today);
    assert.equal(s.label, '후보 모으기');
    assert.equal(s.route, 'Candidates');
  });

  test('예정이고 후보는 있는데 계획이 없으면 루트 계산하기', () => {
    const s = tripNextStep(trip('soon', '2026-11-01', '2026-11-02'), undefined, today);
    assert.equal(s.label, '루트 계산하기');
    assert.equal(s.route, 'Planning');
  });

  test('그 밖에는 시간표 보기', () => {
    const s = tripNextStep(trip('soon', '2026-11-01', '2026-11-02'), plan, today);
    assert.equal(s.label, '시간표 보기');
    assert.equal(s.route, 'Schedule');
  });
});

describe('선택한 여행방의 빠른 메뉴 4칸', () => {
  const today = '2026-10-18';
  const keys = (t: Trip | undefined, plan?: Plan) => homeActions(t, plan, today).map((c) => c.key);

  test('예정: 그룹 채팅, 멤버 초대, 여행지 추천, 여행방 설정', () => {
    assert.deepEqual(keys(trip('a', '2026-11-01', '2026-11-02')), ['chat', 'members', 'recommend', 'settings']);
  });

  test('진행 중: 구간 안내, 그룹 채팅, 사진 올리기(오늘), 여행방 설정', () => {
    const cells = homeActions(trip('a', '2026-10-17', '2026-10-19'), undefined, today);
    assert.deepEqual(
      cells.map((c) => c.key),
      ['navigate', 'chat', 'photos', 'settings'],
    );
    assert.equal(cells.find((c) => c.key === 'photos')?.date, today);
  });

  test('완료: 사진, 일기, 그룹 채팅, 여행방 설정', () => {
    assert.deepEqual(keys(trip('a', '2026-09-01', '2026-09-03')), ['photos', 'diary', 'chat', 'settings']);
  });

  test("구간 안내 칸 이름은 '구간 안내'이고 늘 켜져 있다(시간표가 없으면 구간 안내 화면이 '루트 계산'을 안내)", () => {
    const plan = { days: [{ date: today, items: [{}] }], excluded: [] } as unknown as Plan;
    const nav = homeActions(trip('a', '2026-10-17', '2026-10-19'), plan, today).find((c) => c.key === 'navigate');
    assert.equal(nav?.label, '구간 안내');
    assert.equal(nav?.disabled, false);
    assert.equal(nav?.date, today);
    const none = homeActions(trip('a', '2026-10-17', '2026-10-19'), undefined, today).find((c) => c.key === 'navigate');
    assert.equal(none?.disabled, false);
    assert.equal(none?.date, today);
    const empty = { days: [{ date: today, items: [] }], excluded: [] } as unknown as Plan;
    assert.equal(homeActions(trip('a', '2026-10-17', '2026-10-19'), empty, today).find((c) => c.key === 'navigate')?.disabled, false);
  });

  test('꺼지는 칸은 채팅 칸뿐이다(홈은 채팅 칸의 이유 줄만 그리므로, 이유 없이 회색인 칸이 생기지 않는다)', () => {
    for (const [s, e] of [
      ['2026-11-01', '2026-11-02'],
      ['2026-10-17', '2026-10-19'],
      ['2026-09-01', '2026-09-03'],
    ]) {
      for (const p of [undefined, { days: [], excluded: [] } as unknown as Plan]) {
        for (const t of [trip('a', s, e), personal(trip('a', s, e))]) {
          const off = homeActions(t, p, today).filter((c) => c.disabled);
          assert.ok(off.every((c) => c.key === 'chat' && (c.reason ?? '').length > 0), `${s}: ${off.map((c) => c.key).join(',')}`);
        }
      }
    }
  });

  test('빠른 메뉴 4칸 간격은 SP.xs: 360px에서 칸 너비 75px로 가장 긴 라벨(여행방 설정 72.3px)이 잘리지 않는다', () => {
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    assert.match(home, /<Row gap=\{SP\.xs\} top>\s*\{actions\.map\(\(c\) => \(\s*<QuickAction/);
  });

  test('개인 모드(활성 멤버 1명)면 채팅 칸이 꺼지고 이유에 초대를 적는다', () => {
    for (const [s, e] of [
      ['2026-11-01', '2026-11-02'],
      ['2026-10-17', '2026-10-19'],
      ['2026-09-01', '2026-09-03'],
    ]) {
      const chat = homeActions(personal(trip('a', s, e)), undefined, today).find((c) => c.key === 'chat');
      assert.ok(chat);
      assert.equal(chat.disabled, true);
      assert.match(chat.reason ?? '', /초대/);
    }
  });

  test('그룹 모드면 채팅 칸이 열린다', () => {
    const chat = homeActions(trip('a', '2026-10-17', '2026-10-19'), undefined, today).find((c) => c.key === 'chat');
    assert.equal(chat?.disabled, false);
  });

  test('방장 외 전원이 나가면 다시 개인 모드라 채팅이 닫힌다', () => {
    const t = trip('a', '2026-10-17', '2026-10-19');
    const alone = { ...t, members: t.members.map((m) => (m.role === 'host' ? m : { ...m, leftAt: NOW })) };
    assert.equal(homeActions(alone, undefined, today).find((c) => c.key === 'chat')?.disabled, true);
  });

  test('여행방 설정 칸은 개인 모드에서도 늘 열려 있다', () => {
    for (const t of [trip('a', '2026-11-01', '2026-11-02'), personal(trip('b', '2026-09-01', '2026-09-03'))]) {
      assert.equal(homeActions(t, undefined, today).find((c) => c.key === 'settings')?.disabled, false);
    }
  });

  test('여행방이 없으면 빈 목록이다(화면은 만들기 Empty)', () => {
    assert.deepEqual(homeActions(undefined, undefined, today), []);
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
