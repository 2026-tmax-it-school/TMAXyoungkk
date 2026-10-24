import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { canUseDemoTools, parseEmailList, parseFlag } from '../src/config';
import { wasRemoved } from '../src/core/group';
import { messageLengthHint } from '../src/core/ops/chat';
import { buildPrompt } from '../server/ai.mjs';
import { activeTabKey, TAB_ITEMS } from '../src/navigation/routes';

/**
 * 2026-10-22 셀프 QA 화면 항목(중간 5·8, 낮음 9~12)과 메뉴 노출(홈 빠른 메뉴, 탭 글자).
 * 화면 코드는 소스 규칙으로 본다(다른 화면 테스트와 같은 방식).
 */
const read = (p: string) => readFileSync(p, 'utf8');

test('중간 5: 시연용 기능은 EXPO_PUBLIC_DEMO_TOOLS가 켜졌을 때만 보인다', () => {
  assert.equal(parseFlag(undefined), false);
  assert.equal(parseFlag(''), false);
  assert.equal(parseFlag('0'), false);
  for (const on of ['1', 'true', 'ON', ' yes ']) assert.equal(parseFlag(on), true, on);
  assert.match(read('src/config.ts'), /export const DEMO_TOOLS = parseFlag\(process\.env\.EXPO_PUBLIC_DEMO_TOOLS\)/);
  assert.match(read('src/screens/MoreScreen.tsx'), /\{canUseDemoTools\(session\) \? \(\s*<Col>\s*<DisclosureRow label="시연 도구"/);
  assert.match(read('src/screens/LiveTripScreen.tsx'), /\.filter\(\(k\) => demoAllowed \|\| k !== 'sim'\)/);
  assert.match(read('.env.example'), /^EXPO_PUBLIC_DEMO_TOOLS=$/m);
});

test('시연 기능은 관리자 계정에만 보이고 일반 계정·게스트에는 안 보인다', () => {
  const admins = parseEmailList(' Admin@x.com, ,boss@x.com ');
  assert.deepEqual(admins, ['admin@x.com', 'boss@x.com']);
  const acct = (email: string) => ({ kind: 'account', email });
  assert.equal(canUseDemoTools(acct('ADMIN@x.com'), admins, true), true);
  assert.equal(canUseDemoTools(acct('user@x.com'), admins, true), false);
  assert.equal(canUseDemoTools({ kind: 'guest', email: 'admin@x.com' }, admins, true), false);
  assert.equal(canUseDemoTools(undefined, admins, true), false);
  assert.equal(canUseDemoTools(acct('admin@x.com'), [], true), false);
  assert.equal(canUseDemoTools(acct('admin@x.com'), admins, false), false);
  assert.match(read('src/screens/MembersScreen.tsx'), /\{demoAllowed && mayInvite && inv && status === 'ok' \? \(/);
  assert.match(read('src/screens/InviteAcceptScreen.tsx'), /\{session && demoAllowed \? \(/);
  assert.match(read('src/screens/JournalScreen.tsx'), /\{demoAllowed \? \(\s*<>\s*<Txt v="eyebrow">시연<\/Txt>/);
});

test('메뉴 노출: 하단 탭은 아이콘 아래 짧은 글자, 후보·시간표에서는 홈 칸이 켜진다', () => {
  assert.equal(TAB_ITEMS.find((t) => t.key === 'ChatList')?.short, '채팅');
  assert.match(read('src/ui/TabBar.tsx'), /<Txt v="tab" c=\{on \? 'accent' : 'muted'\} numberOfLines=\{1\}>\s*\{it\.short \?\? it\.label\}/);
  assert.equal(activeTabKey('Candidates'), 'Home');
  assert.equal(activeTabKey('Schedule'), 'Home');
  assert.equal(activeTabKey('Community'), 'Community');
});

test('메뉴 노출: 고른 방의 빠른 메뉴는 홈 지금 할 일 카드 안(끝난 방 포함)', () => {
  const home = read('src/screens/HomeScreen.tsx');
  assert.match(home, /<Btn title=\{task\.action\} onPress=\{onGo\} \/>[\s\S]{0,300}<TripActions trip=\{trip\} compact \/>/);
});

test('중간 8: 채팅방 고르기 창은 방이 4개 이상이면 검색칸을 둔다', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /const ROOM_SEARCH_MIN = 4;/);
  assert.match(chat, /myTrips\.length >= ROOM_SEARCH_MIN \? \([\s\S]{0,200}<Field label="채팅방 검색"/);
  assert.match(chat, /<ChatRoomList\s+inset=\{false\}\s+query=\{roomQuery\}/);
});

test('낮음 9: 토스트는 머리줄 아래에 뜬다', () => {
  assert.match(read('src/ui/Toast.tsx'), /top: insets\.top \+ H\.iconBtn \+ SP\.xxl,/);
});

test('낮음 11: 라디오 칸과 버튼은 스크린리더 이름이 있다', () => {
  assert.match(read('src/ui/Field.tsx'), /accessibilityRole="radio"\s+accessibilityLabel=\{o\.label\}/);
  assert.match(read('src/ui/Btn.tsx'), /accessibilityLabel=\{a11yLabel \?\? title\}/);
});

test('낮음 12: 웹 경고 나는 속성(accessibilityElementsHidden, importantForAccessibility, pointerEvents 속성)을 쓰지 않는다', () => {
  const files = [
    'src/ui/Auth.tsx',
    'src/ui/Seg.tsx',
    'src/ui/Switch.tsx',
    'src/ui/BrandLogo.tsx',
    'src/ui/Discover.tsx',
    'src/ui/Sheet.tsx',
    'src/features/live/components/BgRecordCard.tsx',
    'src/screens/ChatScreen.tsx',
    'src/screens/MapScreen.tsx',
    'src/screens/HomeScreen.tsx',
  ];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/accessibilityElementsHidden|importantForAccessibility|pointerEvents="/.test(src), f);
  }
  assert.match(read('src/ui/pointer.ts'), /none: \{ pointerEvents: 'none' \}/);
});

test('B7: 내보내진 사람만 wasRemoved가 참이다(나갔거나 활성이거나 다시 합류했으면 거짓)', () => {
  const m = (userId: string, leftAt?: number, leftReason?: 'left' | 'removed' | 'deleted') => ({ userId, leftAt, leftReason });
  const trip = (members: ReturnType<typeof m>[]) => ({ members } as unknown as Parameters<typeof wasRemoved>[0]);
  assert.equal(wasRemoved(trip([m('u1', 5, 'removed')]), 'u1'), true);
  assert.equal(wasRemoved(trip([m('u1', 5, 'left')]), 'u1'), false);
  assert.equal(wasRemoved(trip([m('u1', 5, 'removed'), m('u1')]), 'u1'), false);
  assert.equal(wasRemoved(trip([m('u2')]), 'u1'), false);
  assert.equal(wasRemoved(trip([m('u1', 5, 'removed')]), undefined), false);
  assert.match(read('src/screens/MembersScreen.tsx'), /wasRemoved\(trip, getUserId\(\)\)/);
  assert.match(read('src/screens/InviteAcceptScreen.tsx'), /disabled=\{joining \|\| !who \|\| removed\}/);
});

test('B10: 채팅 글자 수 안내는 450자부터 보이고 500자를 넘으면 한도를 알린다', () => {
  assert.equal(messageLengthHint(449), null);
  assert.deepEqual(messageLengthHint(450), { text: '450 / 500', over: false });
  assert.deepEqual(messageLengthHint(500), { text: '500 / 500', over: false });
  assert.equal(messageLengthHint(501)?.over, true);
  assert.match(messageLengthHint(501)?.text ?? '', /500자까지/);
  assert.match(read('src/screens/ChatScreen.tsx'), /messageLengthHint\(text\.length\)/);
});

test('B20: AI 추천 프롬프트는 성향 태그와 상관없는 카페·술집을 내지 말라고 한다', () => {
  const prompt = buildPrompt({ region: { name: '전주' }, dates: [], tags: ['역사'], candidates: [], freeSlots: [] } as unknown as Parameters<typeof buildPrompt>[0]);
  assert.match(prompt, /성향태그가 있으면 모든 장소가 그 태그 가운데 하나에 맞아야 한다/);
  assert.match(prompt, /카페·술집·맛집은 내지 않는다/);
});

test('B23: 일기 사진 추가는 실패해도 "고르는 중"을 항상 푼다', () => {
  assert.match(read('src/screens/JournalScreen.tsx'), /pickAndImport\(tripId, source, fallbackDate\)\s*\.catch\([\s\S]*?\.finally\(\(\) => setAdding\(false\)\)/);
});

test('B11: 지도로 찾은 한 곳은 확인 시트를 거쳐 담는다', () => {
  const src = read('src/features/candidates/components/ManualAdd.tsx');
  assert.match(src, /handle\(out, '누른 곳 300m 안에 담을 수 있는 장소가 없어요', true, true\)/);
  assert.match(src, /title="이 장소를 후보에 담을까요\?"/);
});
