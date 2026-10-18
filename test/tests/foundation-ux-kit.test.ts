import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { activeTabKey, backTarget, SCREEN_META, TAB_ITEMS } from '../src/navigation/routes';
import { TOAST_MAX_MS, toastDuration } from '../src/navigation/toastTime';
import { fieldKindProps } from '../src/ui/fieldKind';
import { mapPinSvg, pinScale } from '../src/ui/mapPinSvg';
import { nextOnTap, sheetHeights, snapAfterDrag, stepA11y, type SheetSnap } from '../src/ui/sheetSnap';
import { H, OPACITY, T } from '../src/ui/tokens';
import { read } from './setup/scan';

/**
 * 공용 UX 키트(2026-10-12 UX 계획 B0). 순수 계산은 직접 부르고, 컴포넌트(.tsx)는 소스 규칙으로 고정한다.
 */

/** 함수 이름부터 다음 최상위 함수 전까지 */
function block(src: string, start: string): string {
  const i = src.indexOf(start);
  assert.ok(i >= 0, start);
  const rest = src.slice(i + start.length);
  const end = rest.search(/\n(?:export )?(?:function|const) /);
  return start + (end < 0 ? rest : rest.slice(0, end));
}

describe('토스트', () => {
  test('위치와 pointerEvents는 StyleSheet로 준다(RNW 0.21이 인라인 pointerEvents를 버림)', () => {
    const src = read('src/ui/Toast.tsx');
    assert.match(src, /StyleSheet\.create\(\{[\s\S]*pointerEvents: 'none'[\s\S]*position: 'absolute'/);
    const inline = src.slice(0, src.indexOf('StyleSheet.create'));
    assert.ok(!/pointerEvents/.test(inline.replace(/\/\*[\s\S]*?\*\//g, '')), '인라인 style에 pointerEvents가 없다');
    assert.match(src, /토스트는 한 문장/);
  });

  test('떠 있는 시간: 짧은 글은 2.5초대, 글자마다 늘고 6초에서 멈춘다', () => {
    const short = toastDuration('저장했어요');
    assert.ok(short >= 2500 && short < 3000, String(short));
    assert.ok(toastDuration('여행방 설정을 저장했어요') > short);
    assert.equal(toastDuration('가'.repeat(200)), TOAST_MAX_MS);
    assert.equal(TOAST_MAX_MS, 6000);
    const host = read('src/navigation/ToastHost.tsx');
    assert.match(host, /toastDuration\(toast\.text\)/);
    assert.ok(!/TOAST_MS = /.test(host), '고정 3.2초를 쓰지 않는다');
  });

  test('오프라인 줄은 앱에 하나, 누를 수 없고 pointerEvents는 StyleSheet다', () => {
    const bar = read('src/navigation/OfflineBar.tsx');
    assert.match(bar, /오프라인 · 연결되면 보내요/);
    assert.match(bar, /accessibilityLiveRegion="polite"/);
    assert.match(bar, /StyleSheet\.create\(\{[\s\S]*pointerEvents: 'none'/);
    assert.ok(!/Pressable|onPress/.test(bar));
    assert.match(read('App.tsx'), /<OfflineBar \/>/);
  });
});

describe('내비게이션', () => {
  test('하단 탭은 다섯 칸이고 셋째 칸은 일정 대신 채팅(채팅방 목록 ChatList 탭, 목록에서도 탭 줄이 보인다)이다', () => {
    assert.deepEqual(
      TAB_ITEMS.map((t) => [t.key, t.label]),
      [
        ['Home', '홈'],
        ['Map', '지도'],
        ['ChatList', '그룹 채팅'],
        ['Community', '커뮤니티'],
        ['More', '프로필'],
      ],
    );
    assert.equal(activeTabKey('Candidates'), 'Candidates');
    assert.equal(TAB_ITEMS[2].icon, 'chat');
    assert.match(read('src/navigation/RootNavigator.tsx'), /<Tabs\.Screen name="ChatList" component=\{ChatListScreen\} \/>/);
    assert.equal(activeTabKey('Map'), 'Map');
    assert.match(read('src/navigation/RootNavigator.tsx'), /active=\{activeTabKey\(route\)\}/);
    assert.equal(SCREEN_META.Navigate.title, '구간 안내');
  });

  test('뒤로: 쌓인 화면이 있으면 그리로, 없으면 대체 탭으로 간다', () => {
    assert.deepEqual(backTarget(true, 'Map'), { kind: 'back' });
    assert.deepEqual(backTarget(false, 'Map'), { kind: 'tab', screen: 'Map' });
    assert.deepEqual(backTarget(false, 'Home'), { kind: 'tab', screen: 'Home' });
    const src = read('src/navigation/useBack.ts');
    assert.match(src, /export function useBack\(fallback: TabRouteName = 'Home'\)/);
    assert.match(src, /export \{ backTarget/);
    assert.match(src, /navigation\.navigate\('Main', \{ screen: t\.screen \}\)/);
  });
});

describe('입력과 시트', () => {
  test('칸 종류 표: 이메일은 대문자·자동 고침 없이 email, 코드는 대문자', () => {
    const email = fieldKindProps('email');
    assert.equal(email.autoCapitalize, 'none');
    assert.equal(email.autoCorrect, false);
    assert.equal(email.autoComplete, 'email');
    assert.equal(email.keyboardType, 'email-address');
    assert.equal(fieldKindProps('code').autoCapitalize, 'characters');
    assert.equal(fieldKindProps('newPassword').autoComplete, 'new-password');
    assert.equal(fieldKindProps('password').textContentType, 'password');
    const field = read('src/ui/Field.tsx');
    assert.match(field, /kind\?: FieldKind/);
    assert.match(field, /inputRef\?: React\.Ref<TextInput>/);
    assert.match(field, /'숨기기' : '보기'/);
    // 보기/숨기기 글자 버튼도 누르는 높이 44: 행간 + 위아래 hitSlop
    assert.match(field, /const REVEAL_SLOP_V = \(H\.touch - T\.btnSm\.lineHeight\) \/ 2;/);
    assert.match(field, /hitSlop=\{\{ top: REVEAL_SLOP_V, bottom: REVEAL_SLOP_V,/);
    assert.ok(T.btnSm.lineHeight + 2 * ((H.touch - T.btnSm.lineHeight) / 2) >= 44);
    assert.match(field, /<View accessibilityLiveRegion="polite">\s*<Txt v="mtTight" c="warn">/);
    assert.match(field, /scroll\?: boolean/);
  });

  test('Body는 키보드가 열린 채로 처음 누를 때 바로 눌리고, Screen keyboard는 KeyboardAvoid로 감싼다', () => {
    const layout = read('src/ui/layout.tsx');
    assert.match(layout, /keyboardShouldPersistTaps="handled"/);
    assert.match(layout, /keyboardDismissMode="on-drag"/);
    assert.match(layout, /keyboard\?: boolean/);
    assert.match(layout, /<KeyboardAvoid>/);
    // 안드로이드 edge-to-edge(SDK 57)는 창이 줄지 않아 안드로이드도 padding으로 띄운다
    const avoid = read('src/ui/KeyboardAvoid.tsx');
    assert.match(avoid, /behavior=\{Platform\.OS === 'web' \? undefined : 'padding'\}/);
    // Foot도 탭 바도 없는 스크롤 화면은 끝에 아래 안전 영역을 더한다
    assert.match(layout, /const safeEnd = foot\?\.hasFoot \|\| inTabs \? 0 : bottom;/);
    assert.match(layout, /accessibilityRole="header"/);
    assert.match(layout, /size\?: 'lg' \| 'sm' \| 'row'/);
  });

  test('시트: 늘 KeyboardAvoid, scroll은 기본 꺼짐, 제목 옆 닫기 버튼', () => {
    const sheet = read('src/ui/Sheet.tsx');
    assert.match(sheet, /<KeyboardAvoid>/);
    assert.match(sheet, /scroll = false/);
    // 85% 상한은 스크롤 시트에만: 줄일 수 없는 내용(달력 시트)이 화면 아래로 잘리지 않게
    assert.match(sheet, /maxHeight: scroll \? Math\.round\(height \* SHEET_MAX_RATIO\) : undefined/);
    assert.match(sheet, /<IconBtn icon="x" label="닫기"/);
    assert.match(sheet, /confirmDisabled\?: boolean/);
    const leave = read('src/ui/LeaveConfirmSheet.tsx');
    assert.match(leave, /saveLabel = '저장하고 나가기'/);
    assert.match(leave, /discardLabel = '저장하지 않고 나가기'/);
    assert.match(leave, /disabled=\{!!saveDisabledReason\}/);
  });

  test('Seg: 기본은 스스로 가로 스크롤하고 고른 칸으로 민다, compact는 스크롤 없이 44 누름', () => {
    const seg = read('src/ui/Seg.tsx');
    assert.match(seg, /<ScrollView[\s\S]{0,80}horizontal/);
    assert.match(seg, /showsHorizontalScrollIndicator=\{false\}/);
    assert.match(seg, /scrollTo\(/);
    assert.match(seg, /if \(compact\) return <CompactSeg/);
    assert.match(seg, /a11yLabel\?: string/);
    const compact = block(seg, 'function CompactSeg');
    assert.ok(!/ScrollView/.test(compact), 'compact에는 ScrollView가 없다');
    assert.match(compact, /hitSlop=/);
  });
});

describe('스냅 계산(sheetSnap)', () => {
  test('높이: 660이면 peek 277·full 644, 400이면 peek 180·full 384, maxRatio로 full이 줄어든다', () => {
    assert.deepEqual(sheetHeights(660), { mini: 64, peek: 277, full: 644 });
    assert.deepEqual(sheetHeights(400), { mini: 64, peek: 180, full: 384 });
    const capped = sheetHeights(660, 0.6);
    assert.equal(capped.full, 396);
    assert.ok(capped.full < sheetHeights(660).full);
    assert.ok(capped.full >= capped.peek);
    assert.equal(sheetHeights(1200).peek, 320, 'peek는 320을 넘지 않는다');
    const tiny = sheetHeights(0);
    assert.ok(tiny.peek >= 0 && tiny.full >= tiny.peek);
  });

  test('놓기: 느리면 가까운 스냅, 빠르면 끈 방향의 다음 스냅, 늘 snaps 안', () => {
    const hs = sheetHeights(660);
    const all: SheetSnap[] = ['mini', 'peek', 'full'];
    assert.equal(snapAfterDrag(300, 0, hs, all), 'peek');
    assert.equal(snapAfterDrag(600, 0.1, hs, all), 'full');
    assert.equal(snapAfterDrag(100, -0.2, hs, all), 'mini');
    // 빠르게 위로(vy < 0): peek 바로 위에서 놓아도 full
    assert.equal(snapAfterDrag(290, -1.2, hs, all), 'full');
    // 빠르게 아래로(vy > 0): peek 바로 아래에서 놓으면 mini
    assert.equal(snapAfterDrag(270, 1.2, hs, all), 'mini');
    // snaps에 mini가 없으면 아래로 빠르게 놓아도 peek에 멈춘다
    assert.equal(snapAfterDrag(270, 1.2, hs, ['peek', 'full']), 'peek');
    assert.equal(snapAfterDrag(100, 0, hs, ['peek', 'full']), 'peek');
    assert.equal(snapAfterDrag(700, -2, hs, all), 'full');
  });

  test('손잡이 탭은 mini → peek → full → peek, snaps에 없는 단계는 건너뛴다', () => {
    const all: SheetSnap[] = ['mini', 'peek', 'full'];
    assert.equal(nextOnTap('mini', all), 'peek');
    assert.equal(nextOnTap('peek', all), 'full');
    assert.equal(nextOnTap('full', all), 'peek');
    assert.equal(nextOnTap('peek', ['peek', 'full']), 'full');
    assert.equal(nextOnTap('full', ['peek', 'full']), 'peek');
    assert.equal(nextOnTap('mini', ['mini', 'full']), 'full');
    assert.equal(nextOnTap('full', ['mini', 'full']), 'mini');
    assert.equal(nextOnTap('mini', ['peek', 'full']), 'peek');
  });

  test('스크린리더 펼치기·접기는 양 끝에서 멈춘다', () => {
    const all: SheetSnap[] = ['mini', 'peek', 'full'];
    assert.equal(stepA11y('mini', 'increment', all), 'peek');
    assert.equal(stepA11y('peek', 'increment', all), 'full');
    assert.equal(stepA11y('full', 'increment', all), 'full');
    assert.equal(stepA11y('full', 'decrement', all), 'peek');
    assert.equal(stepA11y('mini', 'decrement', all), 'mini');
    assert.equal(stepA11y('peek', 'decrement', ['peek', 'full']), 'peek');
  });
});

describe('PeekSheet 끌기 규칙', () => {
  const src = read('src/ui/PeekSheet.tsx');

  test('시작할 때는 잡지 않고 세로로 움직일 때만 잡는다(머리의 버튼은 계속 눌린다)', () => {
    assert.match(src, /onMoveShouldSetPanResponder: \(_e, g\) => Math\.abs\(g\.dy\) > DRAG_START_PX && Math\.abs\(g\.dy\) > Math\.abs\(g\.dx\)/);
    assert.match(src, /onStartShouldSetPanResponder: \(\) => false/);
    assert.ok(!/onStartShouldSetPanResponder[^,\n]*true/.test(src), 'onStartShouldSetPanResponder가 true를 돌려주지 않는다');
  });

  test('놓을 때 탭을 처리하지 않는다(한 번 눌러 두 번 바뀌지 않게), 탭은 손잡이 onPress의 nextOnTap', () => {
    const release = src.slice(src.indexOf('onPanResponderRelease'), src.indexOf('onPanResponderTerminate:'));
    assert.ok(release.length > 0);
    assert.match(release, /snapAfterDrag\(/);
    assert.ok(!/nextOnTap/.test(release));
    assert.match(src, /onPress=\{\(\) => \{\s*const next = nextOnTap\(snap, snaps\)/);
  });

  test('손잡이는 스크린리더로 조절할 수 있고 웹에서 grab 커서와 touchAction none을 준다', () => {
    assert.match(src, /accessibilityRole="adjustable"/);
    assert.match(src, /accessibilityActions=\{\[\s*\{ name: 'increment', label: '펼치기' \},\s*\{ name: 'decrement', label: '접기' \},?\s*\]\}/);
    assert.match(src, /stepA11y\(snap, name, snaps\)/);
    assert.match(src, /cursor: 'grab', touchAction: 'none'/);
    assert.match(src, /useNativeDriver: false/);
    assert.match(src, /\{\.\.\.pan\.panHandlers\}/);
  });
});

describe('지도 핀(mapPinSvg)', () => {
  test('scale은 크기를 키우고 1~1.4로 묶인다', () => {
    const base = mapPinSvg({ kind: 'spot', label: '3' });
    const big = mapPinSvg({ kind: 'spot', label: '3', scale: 1.3 });
    assert.ok(big.size > base.size);
    assert.equal(big.size, Math.ceil(base.size * 1.3));
    assert.match(big.xml, new RegExp(`viewBox="0 0 ${base.size} ${base.size}"`));
    assert.equal(mapPinSvg({ kind: 'spot', label: '3', scale: 3 }).size, Math.ceil(base.size * 1.4));
    assert.equal(pinScale(0.5), 1);
    assert.equal(pinScale(undefined), 1);
  });

  test('dim이면 흐림 opacity가 들어가고, 아니면 전과 같다', () => {
    const dim = mapPinSvg({ kind: 'spot', label: '3', dim: true });
    assert.match(dim.xml, new RegExp(`opacity="${OPACITY.dim}"`));
    const plain = mapPinSvg({ kind: 'spot', label: '3' });
    assert.ok(!/opacity/.test(plain.xml));
    assert.equal(OPACITY.dim, 0.4);
  });

  test("'12표' 세 글자 라벨이 핀 원 안에 들어간다(글자를 줄임), 두 글자 이하는 그대로", () => {
    const pin = mapPinSvg({ kind: 'spot', label: '12표' });
    assert.match(pin.xml, />12표</);
    const fs = Number(/font-size="([\d.]+)"/.exec(pin.xml)?.[1]);
    assert.ok(fs <= 11, String(fs));
    // 지름 30 안에 글자 폭(숫자 0.6em ×2 + 한글 1em)이 들어간다
    assert.ok(fs * 2.2 <= 30 - 4);
    const small = mapPinSvg({ kind: 'spot', label: '12표', compact: true });
    const sfs = Number(/font-size="([\d.]+)"/.exec(small.xml)?.[1]);
    assert.ok(sfs * 2.2 <= 22 - 3, String(sfs));
    assert.match(mapPinSvg({ kind: 'spot', label: '12' }).xml, /font-size="13"/);
  });
});

describe('키트 조각', () => {
  test('스위치·목록 줄·아바타·알림·버튼·아이콘', () => {
    const sw = read('src/ui/Switch.tsx');
    assert.match(sw, /accessibilityRole="switch"/);
    assert.match(sw, /checked: value/);
    assert.match(sw, /surfaceC\.accent : lineC\.strong/);
    const disc = read('src/ui/Discover.tsx');
    assert.match(disc, /onPress\?: \(\) => void;\s*value\?: string;\s*switch\?: \{ value: boolean; onChange: \(next: boolean\) => void \}/);
    assert.match(disc, /export function ProfileEditHero/);
    assert.match(disc, /variant\?: 'card' \| 'row'/);
    assert.match(disc, /a11yLabel \?\? (?:pressLabel \?\? )?`\$\{title\} 열기`/);
    // 누르는 목록 줄은 보조 줄(sub)과 값(value)까지 읽고, 타일은 배지까지 읽는다(P6)
    assert.match(disc, /accessibilityLabel=\{\[label, sub, value\]\.filter\(Boolean\)\.join\(', '\)\}/);
    assert.match(disc, /accessibilityLabel=\{badge \? `\$\{label\}, \$\{badge\}` : label\}/);
    const avatar = read('src/ui/Avatar.tsx');
    assert.match(avatar, /export function AvatarStack\(\{ names, max \}: \{ names: string\[\]; max\?: number \}\)/);
    assert.match(avatar, /`\+\$\{rest\}`/);
    assert.match(avatar, /H\.avatarLg/);
    const notice = read('src/ui/Notice.tsx');
    assert.match(notice, /action\?: \{ label: string; onPress: \(\) => void \}/);
    assert.match(notice, /export function NotFound/);
    assert.match(notice, /'홈으로'/);
    assert.match(notice, /고정 초과\(06·09·10\)/);
    assert.match(read('src/ui/Btn.tsx'), /hitSlop=\{ICON_HIT_SLOP\}/);
    const auth = read('src/ui/Auth.tsx');
    assert.match(auth, /minHeight: H\.touch/);
    assert.match(auth, /<View accessibilityRole="header"/);
    const icon = read('src/ui/Icon.tsx');
    for (const n of ['up', 'down', 'minus']) assert.match(icon, new RegExp(`\\n  ${n}: \\[`), n);
    const index = read('src/ui/index.ts');
    for (const n of ['PeekSheet', 'MapPill', 'Switch', 'LeaveConfirmSheet', 'NotFound', 'ProfileEditHero', 'sheetHeights', 'snapAfterDrag', 'nextOnTap', 'stepA11y']) {
      assert.match(index, new RegExp(`\\b${n}\\b`), n);
    }
  });

  test('지도 위 알약: 누르면 44 이상, 아니면 작은 정적 알약', () => {
    const pill = read('src/ui/MapPill.tsx');
    assert.match(pill, /minHeight: pressable \? H\.touch : STATIC_MIN_H/);
    assert.match(pill, /E\.float/);
  });
});

test('시트 열기: 패널이 먼저 올라온 뒤 뒤 배경이 제자리에서 어두워진다(Modal slide 금지), 닫는 동안 Modal 유지(2026-10-17)', () => {
  const sheet = read('src/ui/Sheet.tsx');
  assert.match(sheet, /animationType="none"/);
  assert.doesNotMatch(sheet, /animationType="slide"/);
  assert.match(sheet, /Animated\.sequence\(\[\s*Animated\.timing\(slide,[\s\S]*?Animated\.timing\(dim,/);
  assert.match(sheet, /<Animated\.View pointerEvents="none" style=\{\[StyleSheet\.absoluteFill, \{ backgroundColor: DIM, opacity: dim \}\]\} \/>/);
  assert.match(sheet, /if \(finished\) setMounted\(false\)/);
  assert.match(sheet, /transform: \[\{ translateY \}\]/);
});

test("빠른 메뉴 칸 이름은 6자를 넘으면 마지막 띄어쓰기에서 두 줄('AI 여행지\\n추천')", async () => {
  const { quickLabelLines } = await import('../src/ui/quickLabel');
  assert.equal(quickLabelLines('AI 여행지 추천'), 'AI 여행지\n추천');
  assert.equal(quickLabelLines('공유된 일정'), '공유된 일정');
  assert.equal(quickLabelLines('일정 공유하기'), '일정\n공유하기');
  assert.equal(quickLabelLines('가나다라마바사'), '가나다라마바사');
});
