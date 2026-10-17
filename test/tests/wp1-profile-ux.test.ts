import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import type { NotifyPrefs, Session, Trip } from '../src/types';
import { SESSION_EXPIRY_NOTICE_MS } from '../src/core/constants';
import { issueGuest } from '../src/core/session';
import { atKst } from '../src/core/util';
import {
  heroDetail,
  heroLine,
  NOTIFY_ROWS,
  notifySummary,
  journalSub,
  recordCounts,
  retentionShort,
  retentionText,
} from '../src/features/account/settings';
import { scenarioTrip } from './helpers/fixtures';
import { seededRng } from './helpers/fakes';

/**
 * WP1 18 프로필 탭 · 17 내 프로필 UX(2026-10-12 정리).
 * - 순수 문구: 알림 요약, 보존 한 줄, 프로필 머리 한 줄, 기록 타일 숫자와 두 줄 라벨.
 * - 소스 규칙: 프로필 탭은 위치 공유 줄이 없고 켜고 끄는 줄이 ListRow switch이며, 시연 도구는 접힌 채 감싼다.
 *   방은 useActiveTrip 하나로 정한다. 내 프로필은 바뀐 채로 나가면 막고(usePreventRemove), 로그아웃 버튼이 없다.
 */

const NOW = atKst('2026-10-18', '12:00');
const read = (p: string) => readFileSync(p, 'utf8');
/** 주석을 뺀 소스(설명 문장에 같은 낱말이 있어도 규칙 검사가 흔들리지 않게) */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ALL_ON: NotifyPrefs = { delay: true, arrival: true, freeTime: true, sessionExpiry: true };

describe('18 프로필 탭 문구(순수)', () => {
  test('알림 요약: 모두 켜짐, 모두 꺼짐, 그 밖에는 N개 중 M개 켜짐', () => {
    assert.equal(notifySummary(ALL_ON), '모두 켜짐');
    assert.equal(notifySummary({ delay: false, arrival: false, freeTime: false, sessionExpiry: false }), '모두 꺼짐');
    assert.equal(notifySummary({ ...ALL_ON, freeTime: false }), '4개 중 3개 켜짐');
  });

  test('알림 줄 sub는 현재 값만 짧게(설명 문장이 아니다)', () => {
    assert.deepEqual(
      NOTIFY_ROWS.map((r) => r.sub),
      ['15분 이상 밀릴 때', '100m 안에 3분', '30분 이상 빌 때', '만료 3일 전'],
    );
  });

  test('보존 한 줄: 여행방이 있으면 마지막 보관일, 없으면 1년', () => {
    const t: Trip = { ...scenarioTrip(), startDate: '2026-10-17', endDate: '2026-10-19' };
    assert.equal(retentionShort(t), '2027-10-19까지 보관');
    assert.match(retentionShort(undefined), /1년/);
    // 시트 본문은 '~요' 톤이고 같은 날짜를 적는다
    assert.match(retentionText(t), /2027-10-19까지 보관해요/);
    assert.doesNotMatch(retentionText(t), /니다/);
  });

  test('프로필 머리 한 줄: 게스트는 유지 기한(곧 만료면 만료일), 계정은 이메일. 토큰은 적지 않는다', () => {
    const guest = issueGuest({ nickname: '민지', rng: seededRng(9), now: NOW });
    const line = heroLine(guest, NOW);
    assert.match(line, /^게스트 · \d{4}-\d{2}-\d{2}까지 유지돼요$/);
    assert.ok(!line.includes(guest.deviceToken.slice(-4)));
    assert.match(heroLine(guest, guest.expiresAt - SESSION_EXPIRY_NOTICE_MS), /만료돼요$/);
    const account: Session = { ...guest, kind: 'account', email: 'minji@example.com' };
    assert.equal(heroLine(account, NOW), '계정 · minji@example.com');
    assert.equal(heroDetail(account, NOW), 'minji@example.com');
    assert.equal(heroLine(undefined, NOW), '로그인하지 않았어요');
  });

  test('기록 타일 숫자: 사진 수와 내용이 있는 일기 날짜 수', () => {
    const t = scenarioTrip();
    const c = recordCounts({
      photos: t.photos,
      diaries: {
        '2026-10-17': { date: '2026-10-17', status: 'auto', blocks: [{}] },
        '2026-10-18': { date: '2026-10-18', status: 'empty', blocks: [] },
      } as unknown as Trip['diaries'],
    });
    assert.equal(c.photos, t.photos.length);
    assert.equal(c.diaryDays, 1);
  });

  test("홈 '여행일지' 줄의 보조 글은 일기 날짜 수와 사진 수 한 줄", () => {
    assert.equal(journalSub({ photos: 12, diaryDays: 3 }), '일기 3일 · 사진 12장');
    assert.equal(journalSub({ photos: 0, diaryDays: 0 }), '일기 0일 · 사진 0장');
  });
});

describe('18 프로필 탭 화면 규칙(MoreScreen)', () => {
  const src = read('src/screens/MoreScreen.tsx');
  const body = code('src/screens/MoreScreen.tsx');

  test("위치 공유 줄이 없다(HANDOFF: 위치 공유는 하지 않는다)", () => {
    assert.ok(!src.includes('위치 공유'));
  });

  test('켜고 끄는 줄은 ListRow switch로 그린다(Chip 토글 없음)', () => {
    assert.match(body, /<ListRow[\s\S]{0,200}switch=\{\{ value:/);
    assert.ok(!/function ToggleRow/.test(body));
  });

  test("'시연 도구'는 처음에 접힌 상태로 감싼다", () => {
    assert.match(body, /const \[demoOpen, setDemoOpen\] = useState\(false\)/);
    assert.match(body, /label="시연 도구"[\s\S]{0,120}\{demoOpen \? \(/);
    // 시나리오 채우기·리셋은 접힌 구역 안에만 있다
    const at = body.indexOf('{demoOpen ? (');
    assert.ok(body.indexOf('시나리오 채우기') > at);
    assert.ok(body.indexOf("'시연 리셋'") > at);
  });

  test('방은 useActiveTrip 하나로 정한다(useCurrentTrip 없음)', () => {
    assert.match(body, /useActiveTrip\(\)/);
    assert.ok(!src.includes('useCurrentTrip'));
  });

  test("여행방 바로가기와 여행방 설정 줄을 두지 않는다", () => {
    assert.ok(!src.includes("label: '여행방 설정"));
    assert.ok(!/TRIP_ENTRIES/.test(src));
  });

  test("'내 여행 기록' 타일은 프로필 탭에 없고 홈 '여행일지' 한 줄에 있다(일기와 사진을 한 화면으로, 기록 지도는 없앴다)", () => {
    assert.ok(!body.includes('내 여행 기록'), '프로필 탭에서 뺐다');
    assert.ok(!/<FeatureTile/.test(body));
    const home = code('src/screens/HomeScreen.tsx');
    assert.match(home, /<SectionTitle title="여행일지" \/>/);
    assert.match(home, /journalSub\(recordCounts\(current\)\)/);
    assert.match(home, /<ListRow first icon="book" label="여행일지 열기" sub=\{journalLine\} onPress=\{openJournal\} \/>/);
    assert.match(home, /navigation\.navigate\('Journal', \{ tripId: current\.id \}\)/);
  });
});

describe('17 내 프로필 화면 규칙(ProfileScreen)', () => {
  const src = read('src/screens/ProfileScreen.tsx');
  const body = code('src/screens/ProfileScreen.tsx');

  test('바뀐 채로 나가면 막고 저장할지 묻는다', () => {
    assert.match(body, /usePreventRemove\(dirty/);
    assert.match(body, /<LeaveConfirmSheet[\s\S]{0,80}title="바뀐 내용을 저장할까요"/);
    assert.match(body, /navigation\.dispatch\(a\)/);
  });

  test('로그아웃 버튼·기기 토큰·로그인 유지 줄이 없다', () => {
    assert.ok(!src.includes('signOutFlow'));
    assert.ok(!body.includes('기기 토큰'));
    assert.ok(!body.includes('로그인 유지'));
  });

  test('저장 Foot은 바뀐 내용이 있을 때만, 닉네임 Enter로 저장, 뒤로는 프로필 탭으로', () => {
    assert.match(body, /\{dirty \? \(\s*<Foot>/);
    assert.match(body, /<Screen keyboard>/);
    assert.match(body, /kind="nickname"/);
    assert.match(body, /onSubmitEditing=/);
    assert.match(body, /useBack\('More'\)/);
    assert.match(body, /<NotFound /);
  });

  test("예시 사진 시연은 글자 링크, 계정 탈퇴는 '계정 관리' 줄", () => {
    assert.match(body, /<TextLink title="예시 사진으로 시연"/);
    assert.match(body, /계정 관리[\s\S]{0,200}<ListRow[^>]*label="계정 탈퇴"/);
  });
});
