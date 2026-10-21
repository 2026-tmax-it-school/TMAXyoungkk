import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spotFromPlace } from '../src/core/extract/spot';
import * as chat from '../src/core/ops/chat';
import * as spots from '../src/core/ops/spots';
import { PLACES } from '../src/data/places';
import {
  chatDayLabel,
  extractionCard,
  INLINE_PICK_MAX,
  messageA11yLabel,
  messageMeta,
  nearEnd,
  STICK_TO_END_PX,
} from '../src/features/chat/view';
import type { ChatMessage, Member, Op, OpBody, Trip } from '../src/types';
import { read, stripComments } from './setup/scan';

/**
 * 05 채팅 화면 정리(WP3): 메시지 묶음·날짜 구분, 메시지 한 줄 스크린리더 이름, 바닥 따라가기,
 * 추출 카드 제목, 입력줄·후보 줄·메뉴 소스 규칙.
 */

/** KST 시각(ms) */
const kst = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+09:00`);

function msg(id: string, memberId: string, at: number, status: ChatMessage['status'] = 'sent'): ChatMessage {
  return { id, memberId, text: `${id} 글`, sentAt: at, status };
}

test('messageMeta: KST 날짜가 바뀌면 구분 줄, 같은 사람·같은 분은 묶고 시각은 묶음 끝에만', () => {
  const list = [
    msg('a', 'm-a', kst('2026-10-17', '23:59') + 1000),
    msg('b', 'm-a', kst('2026-10-17', '23:59') + 30_000),
    msg('c', 'm-a', kst('2026-10-18', '00:00') + 5000),
    msg('d', 'm-b', kst('2026-10-18', '00:00') + 9000),
    msg('e', 'm-b', kst('2026-10-18', '00:01')),
    msg('f', 'm-b', kst('2026-10-18', '00:01') + 1000, 'pending'),
  ];
  const meta = messageMeta(list, 'm-a');
  assert.deepEqual(
    meta.map((m) => [m.id, m.dayLabel ?? '', m.groupStart, m.groupEnd, m.time, m.mine]),
    [
      ['a', '10/17 토', true, false, '23:59', true],
      ['b', '', false, true, '23:59', true],
      ['c', '10/18 일', true, true, '00:00', true],
      ['d', '', true, true, '00:00', false],
      ['e', '', true, true, '00:01', false],
      ['f', '', true, true, '00:01', false],
    ],
  );
  assert.deepEqual(messageMeta([], undefined), []);
  assert.equal(chatDayLabel('2026-10-18'), '10/18 일');
});

test('messageA11yLabel: 보낸 사람, 글, 시각을 한 번에 읽고 전송 대기를 붙인다', () => {
  assert.equal(messageA11yLabel({ text: '불국사 가자', status: 'sent' }, '민지', '10:02'), '민지, 불국사 가자, 10:02');
  assert.equal(messageA11yLabel({ text: '첨성대', status: 'pending' }, '나', '10:03'), '나, 첨성대, 10:03, 전송 대기');
});

test('nearEnd: 바닥에서 80px 안이면 따라간다', () => {
  assert.equal(STICK_TO_END_PX, 80);
  assert.equal(nearEnd(1000, 400, 520), true);
  assert.equal(nearEnd(1000, 399, 520), false);
  assert.equal(nearEnd(300, 0, 600), true);
});

function trip(): Trip {
  const members: Member[] = ['a', 'b'].map((k, i) => ({
    id: `m-${k}`,
    userId: `u-${k}`,
    nickname: k.toUpperCase(),
    role: i === 0 ? 'host' : 'member',
    isGuest: true,
    canInvite: false,
    joinedAt: 0,
  }));
  return {
    id: 't',
    title: '경주',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: [],
    legs: [],
    members,
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 0,
    createdBy: 'u-a',
    lastSeq: 0,
  } as unknown as Trip;
}

let n = 0;
function apply(doc: Trip, actorId: string, body: OpBody): Trip {
  n += 1;
  const op = { ...body, id: `op${n}`, tripId: doc.id, actorId, at: 1000 + n, seq: n } as Op;
  const r = op.type.startsWith('chat/') ? chat : spots;
  assert.equal(r.validate(doc, op), null);
  return r.reduce(doc, op);
}

const place = (id: string) => PLACES.find((p) => p.placeId === id)!;

test("extractionCard: 제목은 '후보 N곳에 담았어요', 고를 장소만 있으면 안내 한 줄", () => {
  let d = apply(trip(), 'm-a', { type: 'chat/send', message: { id: 'x1', text: '불국사랑 석굴암' } });
  const mk = (id: string, placeId: string) =>
    spotFromPlace(place(placeId), { id, proposal: { memberId: 'm-a', source: 'chat', messageId: 'x1', at: 1 }, createdAt: 1, sourceMessageId: 'x1' });
  d = apply(d, 'm-a', {
    type: 'spot/extracted',
    messageId: 'x1',
    created: [mk('s1', 'gj-bulguksa'), mk('s2', 'gj-seokguram')],
    mergedSpotIds: [],
    ambiguous: [],
    highlights: [],
  });
  const card = extractionCard(d, d.messages[0])!;
  assert.equal(card.title, '후보 2곳에 담았어요');
  assert.equal(card.pickHint, undefined);

  let p = apply(trip(), 'm-a', { type: 'chat/send', message: { id: 'y1', text: '황남빵 사자' } });
  p = apply(p, 'm-a', {
    type: 'spot/extracted',
    messageId: 'y1',
    created: [],
    mergedSpotIds: [],
    ambiguous: [{ phrase: '황남빵', options: [place('gj-hwangnam-bread-a'), place('gj-hwangnam-bread-b')] }],
    highlights: [],
  });
  const pickCard = extractionCard(p, p.messages[0])!;
  assert.equal(pickCard.title, '어느 곳인지 골라 주세요');
  assert.match(pickCard.pickHint ?? '', /골라 주세요$/);
  assert.equal(INLINE_PICK_MAX, 3, '3곳 이하는 카드 안에서 바로 고른다');
  for (const t of [card.title, pickCard.title, pickCard.pickHint ?? '']) assert.doesNotMatch(t, /습니다/);
});

test('ChatScreen: 키보드 대응, Enter로 보내기, 후보 줄, 채팅 설정 시트의 여행방 설정 값·멤버, 후보 보기 버튼 없음', () => {
  const chatSrc = stripComments(read('src/screens/ChatScreen.tsx'));
  assert.match(chatSrc, /<Screen keyboard>/);
  assert.match(chatSrc, /returnKeyType="send"/);
  assert.match(chatSrc, /keepFocusOnSubmit/);
  assert.match(chatSrc, /onSubmitEditing=\{send\}/);
  assert.match(chatSrc, /placeholder=\{group \? '메시지 쓰기' : '메모 쓰기'\}/);
  // 메신저형 입력줄(2026-10-17): 알약 칸 안 오른쪽에 둥근 보내기
  assert.match(chatSrc, /look="pill"/);
  assert.match(chatSrc, /right=\{<SendButton round onPress=\{send\}/);
  // 혼자 여행(개인 모드)도 입력이 열린다: 채팅 메모
  assert.match(chatSrc, /<IconBtn icon="plus" label="더하기" variant="soft"/);
  assert.match(chatSrc, /<Field\s+look="pill"/);
  // 머리 제목은 대화 상대(다른 멤버), 여행 정보는 여행방 카드
  // 2026-10-21: 제목은 방 이름(눌러서 방 바꾸기), 대화 상대는 보조 줄
  assert.match(chatSrc, /title=\{trip\.title\}/);
  assert.match(chatSrc, /sub=\{group \? `\$\{roomPeople\(active, me\)\}/);
  assert.match(chatSrc, /<TripContextCard/);
  assert.match(chatSrc, /'혼자 여행 · 채팅 메모'/);
  assert.match(chatSrc, /paddingBottom: SP\.l \+ bottom/);
  assert.match(chatSrc, /<CandidateBar trip=\{trip\} plan=\{plan\} onPress=\{openCandidates\} \/>/);
  assert.match(chatSrc, /setCurrentTrip\(trip\.id\);\s*navigation\.navigate\('Main', \{ screen: 'Candidates' \}\)/);
  // 여행방 설정 값(지역·날짜·이동수단·활동시간)을 시트에 바로 보이고 누르면 여행방 설정으로 간다. 시연(보내는 사람·시나리오)은 없앴다
  assert.match(chatSrc, /label="지역"[\s\S]{0,120}onPress=\{openTripSettings\}/);
  assert.match(chatSrc, /label="하루 활동시간"/);
  assert.match(chatSrc, /navigation\.navigate\('TripSettings', \{ tripId \}\)/);
  assert.ok(!chatSrc.includes('label="여행방 설정"'), "'여행방 설정' 메뉴 줄은 없다");
  assert.match(chatSrc, /label="멤버·초대"[\s\S]{0,200}navigation\.navigate\('Members', \{ tripId \}\)/);
  assert.ok(!chatSrc.includes('시연') && !chatSrc.includes('playScenarioChat'), '채팅 설정에 시연이 없다');
  assert.ok(!chatSrc.includes('title="후보 보기"'), "메뉴의 '후보 보기' 버튼은 없다(후보 줄이 맡는다)");
  assert.ok(!/<Notice[^>]*오프라인/.test(chatSrc), '일반 오프라인 안내는 OfflineBar가 맡는다');
  assert.match(chatSrc, /text="전송 대기"/);
  // 메시지 한 줄은 accessible View 하나, 시각은 묶음 끝에만
  assert.match(chatSrc, /accessible\s+accessibilityLabel=\{messageA11yLabel\(/);
  assert.match(chatSrc, /nearEnd\(contentSize\.height, contentOffset\.y, layoutMeasurement\.height\)/);
  assert.match(chatSrc, /<NotFound title="여행방을 찾을 수 없어요"/);
  assert.match(chatSrc, /useBack\('Home'\)/);
  const bubble = stripComments(read('src/features/chat/components/Bubble.tsx'));
  assert.doesNotMatch(bubble, /accessibilityLabel/, '장소 조각마다 붙던 라벨은 없다');
  const bar = stripComments(read('src/features/chat/components/CandidateBar.tsx'));
  assert.match(bar, /summaryLine\(candidateView\(trip, plan\)\)/);
  assert.match(bar, /if \(!line\) return null/);
  const card = stripComments(read('src/features/chat/components/ExtractionCardView.tsx'));
  assert.match(card, /name="undo"/);
  assert.match(card, /opts\.length <= INLINE_PICK_MAX/);
  assert.match(card, /<PickHint|card\.pickHint/);
});

test('메신저형 채팅(2026-10-17): 머리 제목은 다른 멤버 이름, 목록은 받은편지함형, 공유 시트', async () => {
  const { roomPeople } = await import('../src/features/chat/view');
  const m = (id: string, nickname: string) => ({ id, nickname });
  assert.equal(roomPeople([m('me', '나'), m('a', '준호')], 'me'), '준호');
  assert.equal(roomPeople([m('me', '나'), m('a', '준호'), m('b', '수아')], 'me'), '준호, 수아');
  assert.equal(roomPeople([m('me', '나'), m('a', '준호'), m('b', '수아'), m('c', '지우')], 'me'), '준호, 수아 외 1명');
  assert.equal(roomPeople([m('me', '나')], 'me'), '나만 있어요');
  const { shortPeriod } = await import('../src/features/chat/rooms');
  assert.equal(shortPeriod('2026-10-23', '2026-10-24'), '10/23 – 10/24');
  assert.equal(shortPeriod('2026-10-26', '2026-10-26'), '10/26');
  const list = read('src/features/chat/components/ChatRoomList.tsx');
  assert.match(list, /`\$\{r\.title\} · \$\{r\.place\}`/);
  assert.match(list, /`\$\{r\.dates\} · \$\{r\.meta\}`/);
  assert.doesNotMatch(list, /TILE_GAP|gridW/);
  const share = read('src/features/chat/components/ShareTripSheet.tsx');
  for (const label of ['초대 링크 복사', '메시지로 보내기', '멤버·초대 관리']) assert.ok(share.includes(`'${label}'`), label);
  assert.match(share, /if \(!trip\.invite\?\.code\) issueInvite\(trip\.id\)/);
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /<MessageText text=\{m\.text\}/);
  assert.doesNotMatch(chat, /<Bubble /);
});
