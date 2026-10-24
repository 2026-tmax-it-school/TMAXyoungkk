import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseFlag } from '../src/config';
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
  assert.match(read('src/screens/MoreScreen.tsx'), /\{DEMO_TOOLS \? \(\s*<Col>\s*<DisclosureRow label="시연 도구"/);
  assert.match(read('src/screens/LiveTripScreen.tsx'), /\.filter\(\(k\) => DEMO_TOOLS \|\| k !== 'sim'\)/);
  assert.match(read('.env.example'), /^EXPO_PUBLIC_DEMO_TOOLS=$/m);
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
