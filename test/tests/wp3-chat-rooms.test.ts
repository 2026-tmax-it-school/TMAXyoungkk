import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chatRooms, deleteRoomPlan, filterRooms, roomTime } from '../src/features/chat/rooms';
import type { Trip } from '../src/types';
import { read, stripComments } from './setup/scan';
import { scenarioTrip } from './helpers/fixtures';

const T0 = Date.UTC(2026, 9, 17, 3, 0); // 2026-10-17 12:00 KST

function room(id: string, title: string, opts: { messages?: [string, string, number][]; createdAt?: number; solo?: boolean } = {}): Trip {
  const base = scenarioTrip();
  const members = opts.solo ? base.members.slice(0, 1) : base.members;
  return {
    ...base,
    id,
    title,
    members,
    createdAt: opts.createdAt ?? T0 - 86_400_000,
    messages: (opts.messages ?? []).map(([memberId, text, sentAt], i) => ({ id: `${id}-m${i}`, memberId, text, sentAt, status: 'sent' as const })),
  };
}

test('채팅방 목록: 고정한 방이 먼저, 그 안과 나머지는 마지막 말(없으면 방 만든 때) 최근 순', () => {
  const host = scenarioTrip().members[0];
  const a = room('a', '경주', { messages: [[host.id, '불국사 가자', T0 - 3_600_000]] });
  const b = room('b', '부산', { messages: [[host.id, '해운대', T0 - 60_000]] });
  const c = room('c', '서울', { createdAt: T0 - 10 * 86_400_000, solo: true });
  const rows = chatRooms([a, b, c], ['c']);
  assert.deepEqual(rows.map((r) => [r.tripId, r.pinned]), [
    ['c', true],
    ['b', false],
    ['a', false],
  ]);
  assert.equal(rows[1].preview, `${host.nickname}: 해운대`);
  assert.equal(rows[0].meta, '채팅 메모');
  assert.equal(rows[0].hasMessage, false);
  assert.equal(rows[0].preview, '', '말이 없는 방은 둘째 줄 안내를 두지 않는다');
  assert.match(rows[2].meta, /^멤버 \d+명$/);
  // 표지: 여행방 표지를 따라간다(없으면 지역 이름 칸)
  assert.equal(rows[0].cover, undefined);
  assert.ok(rows[0].place.length > 0);
  const covered = chatRooms([{ ...a, cover: { mime: 'image/jpeg', data: '/9j/AAAA' } } as Trip], []);
  assert.equal(covered[0].cover, 'data:image/jpeg;base64,/9j/AAAA');
});

test('목록 시각: 오늘이면 시:분, 아니면 월/일(KST)', () => {
  assert.equal(roomTime(T0 - 60_000, T0), '11:59');
  assert.equal(roomTime(T0 - 86_400_000, T0), '10/16');
});

test('채팅방 삭제: 멤버는 경고 뒤 여행방에서 나가고(member/leave), 방장은 나갈 수 없어 여행방 삭제(trip/delete)', () => {
  const t = room('a', '경주');
  const host = t.members.find((m) => m.role === 'host')!;
  const guest = t.members.find((m) => m.role !== 'host')!;
  const asGuest = deleteRoomPlan(t, guest.id);
  assert.deepEqual(asGuest.op, { type: 'member/leave', memberId: guest.id });
  assert.match(asGuest.text, /여행방에서 나가져요/);
  const asHost = deleteRoomPlan(t, host.id);
  assert.deepEqual(asHost.op, { type: 'trip/delete' });
  assert.match(asHost.text, /다른 멤버도/);
});

test('화면 연결: 탭 채팅 → ChatList, 줄은 누르면 열고 꾹 누르면 고정·삭제 메뉴, 삭제는 ConfirmSheet 뒤에만, 채팅 머리 방 이름으로 방 바꾸기', () => {
  const list = stripComments(read('src/features/chat/components/ChatRoomList.tsx'));
  assert.match(list, /onPress=\{\(\) => onOpen\(r\.tripId\)\}\s*onLongPress=\{\(\) => setMenuFor\(r\)\}/);
  assert.match(list, /<ConfirmSheet[\s\S]*?onConfirm=\{\(\) => \{[\s\S]*?dispatch\(target\.tripId, plan\.op\)/);
  assert.equal(list.split('dispatch(').length - 1, 1, '확인 없이 나가는 곳이 없다');
  const chat = stripComments(read('src/screens/ChatScreen.tsx'));
  assert.match(chat, /onTitlePress=\{\(\) => setRooms\(true\)\}/);
  assert.match(chat, /navigation\.replace\('Chat', \{ tripId: id \}\)/);
  assert.match(read('src/navigation/RootNavigator.tsx'), /<Tabs\.Screen name="ChatList" component=\{ChatListScreen\} \/>/);
});

test('채팅방 검색: 방 이름이나 마지막 말에 들어 있으면 남기고(공백·대소문자 무시) 순서는 그대로', () => {
  const host = scenarioTrip().members[0];
  const rows = chatRooms(
    [
      room('a', '경주 2박 3일', { messages: [[host.id, '불국사 가자', T0 - 3_600_000]] }),
      room('b', '부산 당일', { messages: [[host.id, '해운대 Beach', T0 - 60_000]] }),
      room('c', '서울 3박 4일', { solo: true }),
    ],
    ['c'],
  );
  assert.deepEqual(filterRooms(rows, '').map((r) => r.tripId), ['c', 'b', 'a']);
  assert.deepEqual(filterRooms(rows, '서울3박').map((r) => r.tripId), ['c']);
  assert.deepEqual(filterRooms(rows, '불국사').map((r) => r.tripId), ['a'], '마지막 말로도 찾는다');
  assert.deepEqual(filterRooms(rows, 'beach').map((r) => r.tripId), ['b']);
  assert.match(read('src/screens/ChatListScreen.tsx'), /<ChatRoomList\s*query=\{query\}/);
});
