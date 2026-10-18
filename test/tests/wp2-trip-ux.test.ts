import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import type { DaySetting, Member, Trip } from '../src/types';
import { INVITE_TTL_MS } from '../src/core/constants';
import { buildDays } from '../src/core/trip/create';
import { newInvite } from '../src/core/trip/invite';
import { atKst } from '../src/core/util';
import { dayRowSub } from '../src/features/trip/dayRows';
import { hasUsableInvite, issueAndShareWith, type ShareResult } from '../src/features/trip/inviteShare';
import { seededRng } from './helpers/fakes';

/**
 * WP2 여행방 UX(B2): 멤버 초대 주 버튼 흐름(issueAndShare), 날짜별 기점 줄의 보조 줄(dayRowSub),
 * 여행방 만들기 나가기 확인·주 버튼 문구, 멤버 초대 Foot, 여행방 설정 이름 저장 방식(소스 규칙).
 */

const T0 = atKst('2026-10-01', '10:00');
const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    title: '경주 2박 3일',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: buildDays('2026-10-17', '2026-10-19', null),
    legs: [],
    members: [host],
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: T0,
    createdBy: host.userId,
    lastSeq: 0,
    ...over,
  };
}

/** 가짜 스토어와 공유 시트. issue는 새 초대를 문서에 넣고, share는 받은 문서를 적어 둔다 */
function fakes(start: Trip, opts: { issueOk?: boolean; outcome?: ShareResult } = {}) {
  let doc: Trip | undefined = start;
  const shared: Trip[] = [];
  let issued = 0;
  return {
    get shared() {
      return shared;
    },
    get issued() {
      return issued;
    },
    deps: (now: number) => ({
      getTrip: () => doc,
      issue: () => {
        if (opts.issueOk === false || !doc) return false;
        issued += 1;
        doc = { ...doc, invite: newInvite(seededRng(issued + 7), now) };
        return true;
      },
      share: async (t: Trip) => {
        shared.push(t);
        return opts.outcome ?? 'shared';
      },
      now,
    }),
  };
}

describe('issueAndShare(멤버 초대 Foot 주 버튼)', () => {
  test('링크가 없으면 새로 만들고 그 링크를 공유한다', async () => {
    const f = fakes(trip());
    const r = await issueAndShareWith(f.deps(T0));
    assert.equal(r, 'shared');
    assert.equal(f.issued, 1);
    assert.equal(f.shared.length, 1);
    assert.ok(f.shared[0].invite?.code, '공유한 문서에 새 초대 코드가 있다');
  });

  test('쓸 수 있는 링크가 있으면 새로 만들지 않고 그대로 공유한다', async () => {
    const invite = newInvite(seededRng(3), T0);
    const f = fakes(trip({ invite }), { outcome: 'copied' });
    const r = await issueAndShareWith(f.deps(T0 + 1000));
    assert.equal(r, 'copied');
    assert.equal(f.issued, 0);
    assert.equal(f.shared[0].invite?.code, invite.code);
  });

  test('만료된 링크(7일)는 무효라 새로 만들고 공유한다', async () => {
    const old = newInvite(seededRng(3), T0);
    const f = fakes(trip({ invite: old }));
    const later = T0 + INVITE_TTL_MS + 1;
    assert.equal(hasUsableInvite(trip({ invite: old }), later), false);
    const r = await issueAndShareWith(f.deps(later));
    assert.equal(r, 'shared');
    assert.equal(f.issued, 1);
    assert.notEqual(f.shared[0].invite?.code, old.code);
  });

  test('링크를 만들 수 없으면(권한 없음·잠김) 공유하지 않고 denied', async () => {
    const f = fakes(trip(), { issueOk: false });
    const r = await issueAndShareWith(f.deps(T0));
    assert.equal(r, 'denied');
    assert.equal(f.shared.length, 0);
  });
});

describe('dayRowSub(25 날짜별 기점 줄)', () => {
  const stay = { name: '황리단 스테이', coord: { latitude: 35.83, longitude: 129.21 } };
  const days: DaySetting[] = [
    { date: '2026-10-17', base: stay, noReturn: false },
    { date: '2026-10-18', base: 'inherit', noReturn: false },
    { date: '2026-10-19', base: null, noReturn: true },
  ];
  const t = trip({ days });

  test('지정이면 기점 이름', () => {
    assert.equal(dayRowSub(t, '2026-10-17'), '황리단 스테이');
  });
  test('직전과 같음이면 거슬러 올라간 기점 이름을 붙인다', () => {
    assert.equal(dayRowSub(t, '2026-10-18'), '직전 날짜와 같음 · 황리단 스테이');
    const none = trip({ days: [{ date: '2026-10-17', base: null, noReturn: false }, { date: '2026-10-18', base: 'inherit', noReturn: false }] });
    assert.equal(dayRowSub(none, '2026-10-18'), '직전 날짜와 같음 · 첫 스팟 사용');
  });
  test('기점 없음이면 첫 스팟 사용, 복귀 없음은 뒤에 붙인다', () => {
    assert.equal(dayRowSub(t, '2026-10-19'), '기점 없음 · 첫 스팟 사용 · 복귀 없음');
    assert.equal(dayRowSub(trip({ days: [{ date: '2026-10-17', base: stay, noReturn: true }] }), '2026-10-17'), '황리단 스테이 · 복귀 없음');
  });
  test("첫날의 'inherit'와 설정이 없는 첫날은 기점 없음이다", () => {
    assert.equal(dayRowSub(trip({ days: [{ date: '2026-10-17', base: 'inherit', noReturn: false }] }), '2026-10-17'), '기점 없음 · 첫 스팟 사용');
    assert.equal(dayRowSub(trip({ days: [] }), '2026-10-17'), '기점 없음 · 첫 스팟 사용');
  });
});

describe('소스 규칙(B2 여행방 만들기 · 멤버 초대 · 여행방 설정)', () => {
  test('여행방 만들기: 나가기 확인(beforeRemove), 만든 뒤 통과(made.current), 주 버튼 문구, 칸 순서', () => {
    const src = readFileSync('src/screens/CreateTripScreen.tsx', 'utf8');
    assert.match(src, /addListener\('beforeRemove'/);
    assert.match(src, /if \(made\.current \|\|/);
    assert.match(src, /title="만들고 멤버 초대하기"/);
    assert.match(src, /title="여행방 만들기를 그만할까요"[\s\S]{0,200}confirmLabel="그만 만들기"[\s\S]{0,40}cancelLabel="계속 만들기"/);
    assert.match(src, /navigation\.dispatch\(action\)/);
    assert.match(src, /<Screen keyboard>/);
    assert.match(src, /useBack\('Home'\)/);
    assert.match(src, /route\.params\?\.regionId/);
    // 지역 → 날짜 → 이름 → 주 이동수단 → '선택'(기점, 하루 활동시간)
    const order = ['<PickerBox\n          label="지역"', 'label="날짜"', 'label="여행방 이름"', '<Txt v="label">주 이동수단</Txt>','<Txt v="eyebrow">선택</Txt>', 'label="기점"', 'label="하루 활동시간"'].map((k) => src.indexOf(k));
    assert.ok(order.every((i) => i >= 0), `모든 칸이 있다 ${order.join(',')}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(src, /help=\{region \? undefined : '지역을 고르면 찾을 수 있어요'\}/);
    assert.doesNotMatch(src, /<Txt v="mtTight">대중교통<\/Txt>/);
  });

  test('멤버 초대: Foot 안에 issueAndShare 주 버튼 하나, 나중에 초대하기, 후보 칩 없음', () => {
    const src = readFileSync('src/screens/MembersScreen.tsx', 'utf8');
    const foot = src.match(/<Foot>([\s\S]*?)<\/Foot>/);
    assert.ok(foot, 'Foot이 있다');
    assert.match(foot[1], /issueAndShare\(trip\.id\)/);
    assert.match(foot[1], /'링크 공유하기' : '링크 만들고 공유하기'/);
    assert.match(foot[1], /title="나중에 초대하기" variant="quiet"/);
    assert.match(src, /setCurrentTrip\(trip\.id\);\s*navigation\.reset\(\{ index: 0, routes: \[\{ name: 'Main', params: \{ screen: 'Candidates' \} \}\] \}\)/);
    assert.doesNotMatch(src, /<Chip text=\{`후보 /);
    assert.match(src, /\$\{row\.sub\} · 후보 \$\{row\.candidates\}곳/);
    assert.match(src, /icon="gear" label="여행방 설정"/);
    // 멤버 → 설정 → 멤버로 오가도 화면이 쌓이지 않게 스택에 있는 설정 화면으로 돌아간다
    assert.match(src, /navigation\.navigate\('TripSettings', \{ tripId: trip\.id \}, \{ pop: true \}\)/);
    assert.match(src, /<NotFound /);
    assert.match(src, /<Txt v="eyebrow">시연<\/Txt>/);
    assert.match(src, /label=\{`\$\{menuFor\.nickname\}님 내보내기`\}/);
  });

  test("여행방 설정: '이름 저장' 버튼 없이 Enter·칸 벗어나기·뒤로에서 저장, 날짜별 기점은 ListRow와 DaySheet", () => {
    const src = readFileSync('src/screens/TripSettingsScreen.tsx', 'utf8');
    assert.doesNotMatch(src, /이름 저장/);
    assert.match(src, /onSubmitEditing=\{saveTitle\}/);
    assert.match(src, /onBlur=\{saveTitle\}/);
    assert.match(src, /const back = \(\) => \{\s*saveTitle\(\);/);
    assert.match(src, /title="여행방 설정" sub=/);
    assert.match(src, /sub=\{dayRowSub\(trip, date\)\}/);
    assert.match(src, /<Chip text="이날만"/);
    assert.match(src, /<DaySheet/);
    // 기점 검색은 DaySheet 안에서 연다. 화면에 형제 Modal로 두면 iOS에서 DaySheet 위에 열리지 않는다
    assert.doesNotMatch(src, /<BaseSearchSheet/);
    assert.doesNotMatch(src, /baseFor/);
    // 설정 → 멤버도 쌓지 않고 돌아가며, 만들기에서 온 멤버 화면의 fromCreate는 merge로 남긴다
    assert.match(src, /navigation\.navigate\('Members', \{ tripId: trip\.id \}, \{ pop: true, merge: true \}\)/);
    assert.doesNotMatch(src, /title="오프라인"/);
    assert.doesNotMatch(src, /function DayCard/);
  });

  test('TimeRange는 초안을 들고 있다가 완료에서 onChange를 한 번만 부른다', () => {
    const src = readFileSync('src/features/trip/components/TimeRange.tsx', 'utf8');
    assert.equal(src.match(/onChange\(/g)?.length, 1);
    assert.match(src, /const done = \(\) => \{\s*if \(startProblem \|\| endProblem\) return;\s*if \(draft && !disabled && \(draft\.start !== start \|\| draft\.end !== end\)\) onChange\(draft\);/);
    // 시작·끝은 목록(30분 칩)과 직접 입력 두 가지로 정한다
    assert.match(src, /TIME_OPTIONS\.filter\(\(t\) => t < cur\.end\)/);
    assert.match(src, /TIME_OPTIONS\.filter\(\(t\) => t > cur\.start\)/);
    assert.match(src, /parseTimeInput\(text\)/);
    assert.match(src, /<Btn title="완료" disabled=\{!!startProblem \|\| !!endProblem\} onPress=\{done\} \/>/);
    assert.match(src, /<PickerBox\s+label=\{label\}/);
  });

  test('DaySheet는 Sheet scroll을 켜고, 복귀 없음은 스위치 줄이다', () => {
    const src = readFileSync('src/features/trip/components/DaySheet.tsx', 'utf8');
    assert.match(src, /<Sheet [^>]*\bscroll>/);
    assert.match(src, /label="복귀 없음"[\s\S]{0,160}switch=\{\{/);
    assert.match(src, /<TimeRange\s+label="이날 활동시간"/);
  });

  test('DaySheet는 기점 검색 시트를 자기 Sheet 안(자식)에 그린다', () => {
    const src = readFileSync('src/features/trip/components/DaySheet.tsx', 'utf8');
    const sheet = src.match(/<Sheet [^>]*\bscroll>([\s\S]*?)<\/Sheet>/);
    assert.ok(sheet, 'DaySheet의 Sheet가 있다');
    assert.match(sheet[1], /<BaseSearchSheet\s+visible=\{searching && visible && date != null\}/);
    assert.match(sheet[1], /onPick=\{\(base\) => onSet\(\{ base \}\)\}/);
    assert.doesNotMatch(src, /onPickBase/);
    // '지정'과 기점 칸 모두 같은 검색 시트를 연다
    assert.equal(src.match(/setSearching\(true\)/g)?.length, 2);
  });

  test('달력 날짜 칸은 dateLong으로 읽힌다', () => {
    const src = readFileSync('src/features/trip/components/CalendarRange.tsx', 'utf8');
    assert.match(src, /accessibilityLabel=\{dateLong\(date\)\}/);
  });
});
