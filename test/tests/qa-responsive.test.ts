import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * 넓은 화면 대응(2026-10-22). 판정 함수는 RN을 끌어오지 않게 소스에서 숫자만 읽어 같은 규칙을 확인하고,
 * 화면 틀·시트·탭·내비게이터가 그 판정을 쓰는지 소스 규칙으로 본다.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const src = read('src/ui/responsive.ts');
const num = (name: string) => Number(new RegExp(`export const ${name} = (\\d+);`).exec(src)?.[1]);

test('기준 너비와 칸 폭: 태블릿 768 이상 640, 컴퓨터 1100 이상 왼쪽 메뉴 220 + 720', () => {
  assert.equal(num('BP_TABLET'), 768);
  assert.equal(num('BP_DESKTOP'), 1100);
  assert.equal(num('CONTENT_MAX_TABLET'), 640);
  assert.equal(num('CONTENT_MAX_DESKTOP'), 720);
  assert.equal(num('RAIL_W'), 220);
  assert.equal(num('SHEET_MAX_W'), 560);
  // 컴퓨터 폭에서 왼쪽 메뉴 + 본문 칸이 들어간다
  assert.ok(num('RAIL_W') + num('CONTENT_MAX_DESKTOP') < num('BP_DESKTOP'));
  assert.match(src, /if \(width >= BP_DESKTOP\) return \{ mode: 'desktop', contentMax: CONTENT_MAX_DESKTOP, rail: true \};/);
  assert.match(src, /if \(width >= BP_TABLET\) return \{ mode: 'tablet', contentMax: CONTENT_MAX_TABLET, rail: false \};/);
  assert.match(src, /return \{ mode: 'phone', rail: false \};/);
});

test('화면 틀·시트·탭이 넓이 판정을 쓴다', () => {
  assert.match(read('src/ui/layout.tsx'), /layout\.contentMax \? \{ maxWidth: wide \?\? layout\.contentMax, alignSelf: 'center'/);
  assert.match(read('src/ui/Sheet.tsx'), /maxWidth: layout\.mode === 'phone' \? undefined : SHEET_MAX_W/);
  const tab = read('src/ui/TabBar.tsx');
  assert.match(tab, /if \(layout\.rail\) \{/);
  assert.match(tab, /width: RAIL_W/);
  assert.match(tab, /paddingHorizontal: layout\.contentMax \? Math\.max\(12, \(width - layout\.contentMax\) \/ 2\) : 12/);
  assert.match(read('src/navigation/RootNavigator.tsx'), /tabBarPosition: rail \? 'left' : 'bottom'/);
});
