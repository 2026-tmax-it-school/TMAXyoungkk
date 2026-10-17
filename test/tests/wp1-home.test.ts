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
  cardRowAtEnd,
  cardRowContentWidth,
  pullOffset,
  pullProgress,
  PULL_TRIGGER,
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

  test('완료면 여행일지 보기', () => {
    const s = tripNextStep(trip('past', '2026-09-01', '2026-09-03'), plan, today);
    assert.equal(s.label, '여행일지 보기');
    assert.equal(s.route, 'Journal');
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

describe('여행방 빠른 메뉴(후보·시간표 화면 위)', () => {
  const today = '2026-10-18';
  const keys = (t: Trip | undefined, plan?: Plan) => homeActions(t, plan, today).map((c) => c.key);

  test('예정: 멤버 초대, 채팅(멤버 초대 오른쪽), 여행일지(채팅 오른쪽), 여행지 추천, 여행방 설정', () => {
    assert.deepEqual(keys(trip('a', '2026-11-01', '2026-11-02')), ['members', 'chat', 'diary', 'recommend', 'itineraries', 'settings']);
  });

  test('진행 중: 구간 안내, 채팅, 일기 쓰기(오늘), 여행방 설정', () => {
    const cells = homeActions(trip('a', '2026-10-17', '2026-10-19'), undefined, today);
    assert.deepEqual(
      cells.map((c) => c.key),
      ['navigate', 'chat', 'diary', 'itineraries', 'settings'],
    );
    assert.equal(cells.find((c) => c.key === 'diary')?.date, today);
  });

  test('완료: 채팅, 여행일지, 일정 공유하기, 여행방 설정', () => {
    assert.deepEqual(keys(trip('a', '2026-09-01', '2026-09-03')), ['chat', 'diary', 'share', 'itineraries', 'settings']);
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

  test('꺼지는 칸이 없다(이유 없이 회색인 칸이 생기지 않는다)', () => {
    for (const [s, e] of [
      ['2026-11-01', '2026-11-02'],
      ['2026-10-17', '2026-10-19'],
      ['2026-09-01', '2026-09-03'],
    ]) {
      for (const p of [undefined, { days: [], excluded: [] } as unknown as Plan]) {
        for (const t of [trip('a', s, e), personal(trip('a', s, e))]) {
          const off = homeActions(t, p, today).filter((c) => c.disabled);
          assert.deepEqual(off.map((c) => c.key), [], s);
        }
      }
    }
  });

  test('빠른 메뉴는 홈이 아니라 후보·시간표 화면 위(TripActions)에 있고 5칸이면 오륜기처럼 두 줄이다', () => {
    const actions = readFileSync('src/features/trip/components/TripActions.tsx', 'utf8');
    // 5칸이면 오륜기처럼 위 3칸·아래 2칸(가운데), 칸 폭은 한 줄의 1/3
    assert.match(actions, /const rows = cells\.length >= 5 \? \[cells\.slice\(0, 3\), cells\.slice\(3\)\] : \[cells\];/);
    assert.match(actions, /width: '33\.33%'/);
    assert.match(readFileSync('src/screens/CandidatesScreen.tsx', 'utf8'), /<TripActions trip=\{trip\} \/>/);
    assert.match(readFileSync('src/screens/ScheduleScreen.tsx', 'utf8'), /<TripActions trip=\{trip\} \/>/);
    assert.doesNotMatch(readFileSync('src/screens/HomeScreen.tsx', 'utf8'), /<QuickAction|homeActions/);
  });

  test("새 여행은 홈 카드 줄 끝 '+' 손잡이(여행 카드와 같은 연회색 모양)다. 누르거나, 줄 끝에서 왼쪽으로 뻑뻑하게(고무줄 저항) 끌어 놓으면 여행방 만들기로 간다", () => {
    for (const t of [trip('a', '2026-11-01', '2026-11-02'), trip('b', '2026-10-17', '2026-10-19'), personal(trip('c', '2026-09-01', '2026-09-03'))]) {
      const cells = homeActions(t, undefined, today);
      assert.ok(!cells.some((c) => c.key === 'create'));
      const chat = cells.find((c) => c.key === 'chat');
      assert.equal(chat?.label, t.members.filter((m) => m.leftAt == null).length > 1 ? '그룹 채팅' : '채팅 메모');
    }
    // 끌수록 덜 따라온다(손가락 100 → 64, 200 → 95, 400 → 124). 오른쪽으로 끌면 0
    assert.equal(pullOffset(0), 0);
    assert.equal(pullOffset(-50), 0);
    assert.equal(Math.round(pullOffset(100)), 64);
    assert.equal(Math.round(pullOffset(200)), 95);
    assert.equal(Math.round(pullOffset(400)), 124);
    assert.ok(pullOffset(10_000) < 180, '아무리 끌어도 저항 상한(180)을 넘지 않는다');
    // 조금 끌어서는 만들지 않고, 손가락 약 285px 넘게 끌어야 PULL_TRIGGER에 닿는다
    assert.ok(pullOffset(200) < PULL_TRIGGER);
    assert.ok(pullOffset(300) >= PULL_TRIGGER);
    assert.equal(pullProgress(PULL_TRIGGER / 2), 0.5);
    assert.equal(pullProgress(500), 1);
    // 줄 끝 판단: 크기를 모르면 끝이 아니다(옆으로 밀기를 가로채지 않는다). 카드 2장 내용 폭 = 왼쪽 24 + 2×288 + 잘린 카드 52 = 652
    assert.equal(cardRowContentWidth(2), 652);
    assert.equal(cardRowAtEnd(0, 0, 0), false);
    assert.equal(cardRowAtEnd(0, 420, 652), false, '처음 위치에서는 끝이 아니라 옆으로 밀린다');
    assert.equal(cardRowAtEnd(232, 420, 652), true);
    assert.equal(cardRowAtEnd(0, 800, 652), true, '화면이 넓어 다 보이면 처음부터 끝');
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    assert.match(home, /<NewTripPeek onPress=\{openCreate\} \/>\s*<\/Animated\.ScrollView>\s*<NewTripPull pull=\{pullX\} ready=\{pullReady\} \/>/);
    assert.match(home, /onMoveShouldSetPanResponderCapture: \(_, g\) => rowAtEnd\.current && g\.dx < -6/);
    assert.match(home, /navigation\.navigate\('CreateTrip'\)/);
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

describe('홈 검색(내 여행방·지역·AI 추천 여행지)', () => {
  test("'서울'을 적으면 여행지가 서울인 방, 방 이름이 맞는 방이 남고 지역은 서울이 먼저다", async () => {
    const { searchTrips, searchRegions, mergeRegionHits } = await import('../src/features/account/homeSearch');
    const seoul = { ...trip('a', '2026-11-01', '2026-11-02'), title: '친구들과 주말', region: 'seoul' };
    const busan = { ...trip('b', '2026-11-01', '2026-11-02'), title: '부산 당일', region: 'busan' };
    const named = { ...trip('c', '2026-11-01', '2026-11-02'), title: '서울 맛집 투어', region: 'incheon' };
    assert.deepEqual(searchTrips([seoul, busan, named], '서울').map((t) => t.id), ['a', 'c']);
    assert.deepEqual(searchTrips([seoul, busan, named], '').map((t) => t.id), ['a', 'b', 'c'], '빈 검색어면 그대로');
    assert.deepEqual(searchTrips([seoul, busan, named], '부 산').map((t) => t.id), ['b'], '공백 무시');
    const regions = searchRegions('서울');
    assert.equal(regions[0]?.region.id, 'seoul');
    assert.deepEqual(searchRegions(''), []);
    // 목록 밖 지역 검색 결과를 합친다(같은 이름은 한 번)
    const merged = mergeRegionHits(regions, [regions[0].region, { id: 'x-iksan', name: '익산', label: '전북 익산시', center: { latitude: 35.9, longitude: 126.9 }, radiusKm: 15 }]);
    assert.deepEqual(merged.map((h) => h.region.name), [...regions.map((h) => h.region.name), '익산'].slice(0, 3));
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    assert.match(home, /const list = searching \? searchTrips\(trips, query\) : allCards;/);
    assert.match(home, /<HomeSearchResults/);
    const results = readFileSync('src/features/account/HomeSearchResults.tsx', 'utf8');
    assert.match(results, /recommend\.recommend\(\{ region: first/, 'AI 추천은 첫 지역으로 묻는다');
  });
});
