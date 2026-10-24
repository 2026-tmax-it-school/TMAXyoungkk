import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { ChatMessage, DayPlan, LatLng, Member, Spot, TimetableItem, Trip } from '../src/types';
import { homeGreeting } from '../src/features/account/home';
import { spotHintLabel, spotQuote, spotWho, splitMark, voterNames } from '../src/features/candidates/talk';
import { scheduleNow } from '../src/features/schedule/view';
import { atKst, toMin } from '../src/core/util';

/**
 * 2026-10-23 피그마 최종안을 실제 앱에 옮긴 부분의 순수 계산.
 * 후보 카드(누가 꺼냈는지·시간 힌트·좋아요), 스팟 상세 '채팅에서 나온 말', 홈 인사, 시간표 '지금' 카드.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const C: LatLng = { latitude: 35.8347, longitude: 129.219 };

function member(id: string, nickname: string): Member {
  return { id, userId: `u-${id}`, nickname, role: id === 'm1' ? 'host' : 'member', isGuest: true, canInvite: false, joinedAt: 0 } as Member;
}

function spot(id: string, name: string, extra: Partial<Spot> = {}): Spot {
  return {
    id,
    placeId: `p-${id}`,
    name,
    category: '관광지',
    coord: C,
    proposals: [{ memberId: 'm2', source: 'chat', messageId: 'msg1', at: 5 }],
    pinned: false,
    stayMin: 60,
    createdAt: 1,
    edited: {},
    ...extra,
  };
}

function msg(id: string, memberId: string, text: string): ChatMessage {
  return { id, memberId, text, sentAt: atKst('2026-11-07', '22:12'), status: 'sent' };
}

function trip(extra: Partial<Trip> = {}): Trip {
  return {
    id: 't',
    title: '경주 1박 2일',
    region: 'gyeongju',
    startDate: '2026-11-08',
    endDate: '2026-11-09',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: [],
    legs: [],
    members: [member('m1', '민지'), member('m2', '서연'), member('m3', '준호')],
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 0,
    createdBy: 'u',
    lastSeq: 0,
    ...extra,
  };
}

test('후보 카드: 처음 꺼낸 사람과 경로, 아바타 색 순서', () => {
  const s = spot('s1', '동궁과 월지');
  const t = trip({ spots: [s] });
  assert.deepEqual(spotWho(t, s), { name: '서연', index: 1, text: '서연이 채팅에서 꺼냄' });
  const manual = spot('s2', '황리단길', { proposals: [{ memberId: 'm1', source: 'manual', at: 1 }] });
  assert.equal(spotWho(t, manual)?.text, '민지가 직접 담음');
  assert.equal(spotWho(t, spot('s3', '첨성대', { proposals: [] })), undefined);
});

test('후보 카드: 채팅 속 시간 힌트 라벨은 계산과 같은 규칙', () => {
  const s = spot('s1', '동궁과 월지');
  const t = trip({ spots: [s, spot('s2', '불국사', { proposals: [] })], messages: [msg('msg1', 'm2', '동궁과 월지는 꼭 저녁에 가야 해')] });
  assert.equal(spotHintLabel(t, s), '저녁 추천');
  assert.equal(spotHintLabel(t, t.spots[1]), undefined);
});

test('후보 카드: 표를 준 활성 멤버 이름(멤버 순서, 제안자는 처음부터 한 표)', () => {
  const s = spot('s1', '불국사', { votes: { m3: { on: true, at: 2 }, m1: { on: true, at: 3 } } as Spot['votes'] });
  const names = voterNames(trip({ spots: [s] }), s);
  assert.deepEqual(names, ['민지', '서연', '준호']);
});

test('스팟 상세: 장소가 처음 나온 채팅 한 줄과 장소 강조 조각', () => {
  const s = spot('s1', '동궁과 월지');
  const t = trip({ spots: [s], messages: [msg('msg1', 'm2', '동궁과 월지는 꼭 저녁에 가야 해')] });
  const q = spotQuote(t, s);
  assert.equal(q?.name, '서연');
  assert.equal(q?.index, 1);
  assert.deepEqual(splitMark(q!.text, s.name), [
    { text: '동궁과 월지', mark: true },
    { text: '는 꼭 저녁에 가야 해', mark: false },
  ]);
  assert.deepEqual(splitMark('아무 말', '불국사'), [{ text: '아무 말', mark: false }]);
  assert.equal(spotQuote(t, spot('s2', '불국사', { proposals: [] })), undefined);
});

test('홈 인사: 예정은 D-n, 진행 중은 여행 중, 없거나 끝나면 내 여행', () => {
  const t = trip();
  assert.equal(homeGreeting('민지', t, '경주', atKst('2026-11-05', '10:00')), '민지님, 경주까지 D-3');
  assert.equal(homeGreeting('민지', t, '경주', atKst('2026-11-08', '10:00')), '민지님, 경주 여행 중이에요');
  assert.equal(homeGreeting('민지', t, '경주', atKst('2026-11-20', '10:00')), '내 여행');
  assert.equal(homeGreeting(undefined, t, '경주', atKst('2026-11-05', '10:00')), '내 여행');
  assert.equal(homeGreeting('민지', undefined, undefined, atKst('2026-11-05', '10:00')), '내 여행');
});

function item(spotId: string, name: string, arrive: string, depart: string): TimetableItem {
  return {
    spotId,
    name,
    travelMin: 15,
    legTransport: 'car',
    legEstimated: false,
    arrive,
    depart,
    stayMin: toMin(depart) - toMin(arrive),
    pinned: false,
    proposerCount: 1,
    manual: false,
    notices: [],
  };
}

test('시간표 지금 카드: 머무는 중 · 이동 중 · 첫 곳 전 · 끝난 뒤', () => {
  const day = { date: '2026-11-08', items: [item('a', '불국사', '10:00', '11:30'), item('b', '석굴암', '11:50', '12:30')] } as Pick<DayPlan, 'date' | 'items'>;
  assert.deepEqual(scheduleNow(day, '2026-11-08', toMin('10:20')), {
    eyebrow: '지금 · 10:20',
    title: '불국사에 있어요',
    sub: '11:30 출발 · 다음 석굴암',
    spotId: 'a',
  });
  assert.equal(scheduleNow(day, '2026-11-08', toMin('11:42'))?.title, '석굴암으로 이동해요');
  assert.match(scheduleNow(day, '2026-11-08', toMin('11:42'))!.sub, /11:50 도착 예정$/);
  assert.equal(scheduleNow(day, '2026-11-08', toMin('09:00'))?.title, '첫 곳은 불국사예요');
  assert.equal(scheduleNow(day, '2026-11-08', toMin('13:00')), undefined);
  assert.equal(scheduleNow(day, '2026-11-09', toMin('10:20')), undefined);
});

test('화면 연결: 후보 카드·채팅 원문·지금 카드·홈 인사를 실제 화면이 쓴다', () => {
  assert.match(read('src/screens/CandidatesScreen.tsx'), /<CandidateCard/);
  assert.match(read('src/features/candidates/components/CandidateCard.tsx'), /toggleVote\(trip\.id, spot\)/);
  assert.match(read('src/screens/SpotDetailScreen.tsx'), /<ChatQuote quote=\{quote\} place=\{spot\.name\} \/>/);
  assert.match(read('src/screens/ScheduleScreen.tsx'), /scheduleNow\(day, kstDate\(now\)/);
  assert.match(read('src/screens/HomeScreen.tsx'), /homeGreeting\(myName, current/);
});

test('나머지 화면 계산: 초대 코드 칸 글자, 프로필 숫자 줄, 일기 오늘 간 곳', async () => {
  const { codeCellChars } = await import('../src/ui/codeChars');
  const { profileStats } = await import('../src/features/account/home');
  const { arrivedNames } = await import('../src/features/journal/places');
  assert.deepEqual(codeCellChars('ab12-cd', 8), ['A', 'B', '1', '2', 'C', 'D']);
  assert.deepEqual(codeCellChars('https://youngtrip.app/j/WXYZ-1234', 8), ['W', 'X', 'Y', 'Z', '1', '2', '3', '4']);
  assert.deepEqual(codeCellChars('123456789', 8).length, 8);
  const t = trip({ diaries: { '2026-11-08': {} as never }, photos: [{} as never, {} as never] });
  assert.deepEqual(profileStats([t]), [
    { label: '여행', value: 1 },
    { label: '일기', value: 1 },
    { label: '사진', value: 2 },
  ]);
  const visits = [
    { id: 'v2', spotId: 'b', date: '2026-11-08', memberId: 'm1', status: 'arrived', source: 'manual', at: 20 },
    { id: 'v1', spotId: 'a', date: '2026-11-08', memberId: 'm2', status: 'arrived', source: 'manual', at: 10 },
    { id: 'v3', spotId: 'a', date: '2026-11-08', memberId: 'm1', status: 'arrived', source: 'manual', at: 30 },
    { id: 'v4', spotId: 'c', date: '2026-11-08', memberId: 'm1', status: 'skipped', source: 'manual', at: 40 },
  ] as Trip['visits'];
  const spots = [spot('a', '불국사'), spot('b', '석굴암'), spot('c', '첨성대')];
  assert.deepEqual(arrivedNames({ visits, spots }, '2026-11-08'), ['불국사', '석굴암']);
  assert.deepEqual(arrivedNames({ visits, spots }, '2026-11-09'), []);
});

test('컴퓨터 배치: 시간표 오른쪽 지도 단, 채팅 왼쪽 방 목록 단, 지도 왼쪽 패널', () => {
  assert.match(read('src/screens/ScheduleScreen.tsx'), /scheduleDayMap\(trip, plan, current\)/);
  assert.match(read('src/screens/ChatScreen.tsx'), /<View style=\{styles\.deskRooms\}>/);
  assert.match(read('src/screens/MapScreen.tsx'), /style=\{desk \? \[styles\.deskPanel, E\.float\] : undefined\}/);
});

test('이메일 도메인 오타를 알아챈다(gamil.com 가입으로 인증 메일이 안 갔던 일)', async () => {
  const { emailTypoSuggestion } = await import('../src/core/auth');
  assert.equal(emailTypoSuggestion('hanbg191919@gamil.com'), 'hanbg191919@gmail.com');
  assert.equal(emailTypoSuggestion('  User@Gmial.com '), 'user@gmail.com');
  assert.equal(emailTypoSuggestion('a@naver.con'), 'a@naver.com');
  assert.equal(emailTypoSuggestion('a@gmail.com'), null);
  assert.equal(emailTypoSuggestion('a@company.co.kr'), null);
  assert.equal(emailTypoSuggestion('abc'), null);
  assert.match(read('src/screens/SignupScreen.tsx'), /emailTypoSuggestion\(email\)/);
});

test('채팅 추출: 예시 일정의 같은 장소(placeId가 달라도 같은 이름·500m 안)는 새 후보를 또 만들지 않는다', async () => {
  const { findSameSpot } = await import('../src/core/extract/index');
  const t = trip({ spots: [spot('s1', '전주한옥마을', { placeId: 'sample-hanok', coord: C })] });
  const near = { placeId: 'kakao-123', name: '전주 한옥마을', coord: { latitude: C.latitude + 0.002, longitude: C.longitude } };
  assert.equal(findSameSpot(t, near)?.id, 's1');
  assert.equal(findSameSpot(t, { ...near, placeId: 'sample-hanok', name: '다른이름' })?.id, 's1', '같은 placeId');
  assert.equal(findSameSpot(t, { ...near, coord: { latitude: C.latitude + 0.2, longitude: C.longitude } }), undefined, '먼 동명 장소는 다른 곳');
  assert.equal(findSameSpot(t, { ...near, name: '경기전' }), undefined);
});

test('시간표: 같은 대체 안내(자동차 경로가 없어 도보로 계산 등)는 하루에 한 번만 보인다', () => {
  const src = read('src/features/schedule/components/DayTimeline.tsx');
  assert.match(src, /const seenNotice = new Set<string>\(\)/);
  assert.match(src, /n\.kind !== 'fallbackTransport' && n\.kind !== 'noRoute'/);
  assert.match(src, /noticesNow = r\.kind === 'spot' \? freshNotices\(r\.notices\) : \[\]/);
});
