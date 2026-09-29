import assert from 'node:assert/strict';
import { test } from 'node:test';

import { globToRegExp } from './setup/ownership.mjs';
import {
  exists,
  formatViolations,
  importSpecifiers,
  lineOf,
  listFiles,
  read,
  scanLines,
  scoped,
  stripComments,
  type Violation,
} from './setup/scan';

/**
 * 디자인 규칙(HANDOFF 토큰, 01·02 디자이너 안). src/**와 App.tsx를 본다.
 * YT_SCOPE=WPn이면 그 패키지 파일의 위반만 본다.
 */

const FILES = [...listFiles('src', ['.ts', '.tsx']), ...(exists('App.tsx') ? ['App.tsx'] : [])];
const code = new Map(FILES.map((f) => [f, stripComments(read(f))]));
const raw = new Map(FILES.map((f) => [f, read(f)]));

const inUi = (f: string) => f.startsWith('src/ui/');
const matches = (f: string, globs: string[]) => globs.some((g) => globToRegExp(g).test(f));

function eachLine(files: string[], rule: string, re: RegExp, source: 'code' | 'raw' = 'code'): Violation[] {
  const out: Violation[] = [];
  for (const f of files) out.push(...scanLines(f, (source === 'code' ? code : raw).get(f) ?? '', rule, re));
  return out;
}

function check(vs: Violation[]) {
  const mine = scoped(vs);
  assert.deepEqual(mine, [], formatViolations(mine));
}

test('이모지 아이콘을 쓰지 않는다', () => {
  check(eachLine(FILES, 'emoji', /\p{Extended_Pictographic}/u, 'raw'));
});

test('그라디언트·글래스·블러를 쓰지 않는다', () => {
  check(eachLine(FILES, 'gradient-blur', /(linear|radial)-gradient|LinearGradient|BlurView|backdropFilter|blurRadius|filter\s*:\s*['"`]?blur/));
});

test('카드 왼쪽 컬러 보더를 쓰지 않는다', () => {
  check(eachLine(FILES, 'border-left', /\bborder(Left|Start)(Width|Color)?\b/));
});

test('src/ui 밖에서는 hex·rgba·fontWeight·fontFamily·그림자를 쓰지 않는다', () => {
  const outside = FILES.filter((f) => !inUi(f));
  check([
    ...eachLine(outside, 'hex', /['"`]#[0-9a-fA-F]{3,8}['"`]/),
    ...eachLine(outside, 'rgba', /\brgba?\s*\(/),
    ...eachLine(outside, 'fontWeight', /\bfontWeight\b/),
    ...eachLine(outside, 'fontFamily', /\bfontFamily\b/),
    ...eachLine(outside, 'shadow', /\b(shadowColor|shadowOffset|shadowOpacity|shadowRadius|boxShadow|elevation)\s*:/),
  ]);
});

test('src/ui 밖에서는 글자 크기·행간·자간을 직접 쓰지 않는다(<Txt v=...> 타입 스케일만)', () => {
  const outside = FILES.filter((f) => !inUi(f));
  check(eachLine(outside, 'type-scale', /\b(fontSize|lineHeight|letterSpacing)\s*[:=]/));
});

test('src/ui 밖에서는 react-native의 Text·TextInput을 직접 쓰지 않는다', () => {
  const vs: Violation[] = [];
  for (const f of FILES.filter((x) => !inUi(x))) {
    const text = code.get(f) ?? '';
    const re = /import\s+(?:type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const names = m[1].split(',').map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]);
      const bad = names.filter((n) => n === 'Text' || n === 'TextInput');
      if (bad.length) vs.push({ file: f, line: lineOf(text, m.index), rule: 'rn-text', text: bad.join(', ') });
    }
  }
  check(vs);
});

test('주색·유채색 전체면을 쓰지 않는다(Screen bg는 bg·card만)', () => {
  const outside = FILES.filter((f) => !inUi(f));
  check(eachLine(outside, 'color-fullscreen', /<Screen\b[^>]*\bbg\s*=\s*\{?\s*['"](accent|rose|amber|moss|ink)['"]/));
});

/** E.float(그림자)를 참조해도 되는 곳: 토큰 정의, 지도 컴포넌트, 지도 위에 요소를 띄우는 화면 */
const FLOAT_ALLOWED = [
  'src/ui/tokens.ts',
  'src/components/map/**',
  'src/features/live/**',
  'src/screens/MapScreen.tsx',
  'src/screens/NavigateScreen.tsx',
  'src/screens/LiveTripScreen.tsx',
  'src/screens/RecordMapScreen.tsx',
];

test('그림자(E.float)는 지도 위에 뜬 요소에만 쓴다', () => {
  check(eachLine(FILES.filter((f) => !matches(f, FLOAT_ALLOWED)), 'float-shadow', /\bE\s*\.\s*float\b|\bE\s*\[\s*['"]float['"]/));
});

test("'↓'·'→' 같은 텍스트 화살표를 쓰지 않는다(아이콘은 Icon만)", () => {
  check(eachLine(FILES, 'text-arrow', /[\u2190-\u21FF\u27F0-\u27FF\u2B00-\u2BFF]/));
});

const CSS_NAMED_COLOR =
  /\b(color|backgroundColor|borderColor|borderTopColor|borderBottomColor|tintColor|fill|stroke|placeholderTextColor)\s*[:=]\s*\{?\s*['"](white|black|red|green|blue|pink|gray|grey|yellow|orange|purple|brown|navy|silver|maroon)['"]/i;

test('src/ui 밖에서는 이름 색(white, red 등)을 쓰지 않는다', () => {
  check(eachLine(FILES.filter((f) => !inUi(f)), 'named-color', CSS_NAMED_COLOR));
});

test('Inter·Roboto·Arial을 쓰지 않는다', () => {
  check(eachLine(FILES, 'font-name', /['"`](Inter|Roboto|Arial)['"`]/));
});

test('라운드는 16 이하이고 칩만 999다(999는 토큰 R.chip으로만)', () => {
  const vs: Violation[] = [];
  for (const f of FILES) {
    const text = code.get(f) ?? '';
    const re = /\b(border\w*Radius)\s*:\s*(\d+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const v = Number(m[2]);
      if (v > 16) vs.push({ file: f, line: lineOf(text, m.index), rule: 'radius', text: m[0] });
    }
    // SVG 사각형 라운드(rx·ry)도 16 이하
    const svg = /\b(rx|ry)\s*=\s*\{?\s*['"]?(\d+(?:\.\d+)?)/g;
    while ((m = svg.exec(text))) {
      if (Number(m[2]) > 16) vs.push({ file: f, line: lineOf(text, m.index), rule: 'svg-radius', text: m[0] });
    }
  }
  check(vs);
});

test('가운데 정렬은 허용 목록(01 스플래시, ui, 지도 textAnchor)에서만 쓴다', () => {
  const textAlignAllowed = ['src/screens/SplashScreen.tsx', 'src/ui/**'];
  const anchorAllowed = ['src/components/map/**', 'src/ui/**'];
  const vs: Violation[] = [
    ...eachLine(
      FILES.filter((f) => !matches(f, textAlignAllowed)),
      'text-align-center',
      /textAlign\s*:\s*['"]center['"]/,
    ),
    ...eachLine(
      FILES.filter((f) => !matches(f, anchorAllowed)),
      'text-anchor',
      /\btextAnchor\b/,
    ),
  ];
  for (const f of FILES.filter((x) => !matches(x, textAlignAllowed))) {
    const text = code.get(f) ?? '';
    const re = /<Txt\b[^>]*?\bcenter\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) vs.push({ file: f, line: lineOf(text, m.index), rule: 'txt-center', text: '<Txt center>' });
  }
  check(vs);
});

test('SVG 글자는 src/ui/SvgLabel만 쓴다', () => {
  const vs: Violation[] = [];
  for (const f of FILES.filter((x) => x !== 'src/ui/SvgLabel.tsx')) {
    const text = code.get(f) ?? '';
    const re = /import\s+(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react-native-svg['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (/\b(Text|TSpan|TextPath)\b/.test(m[1])) {
        vs.push({ file: f, line: lineOf(text, m.index), rule: 'svg-text', text: m[1].trim() });
      }
    }
  }
  check(vs);
});

test('폰트 패키지는 src/ui/fonts.ts에서 서브패스로만 불러온다', () => {
  const vs: Violation[] = [];
  for (const f of FILES) {
    for (const { spec, line } of importSpecifiers(code.get(f) ?? '')) {
      if (!spec.startsWith('@expo-google-fonts/')) continue;
      if (/^@expo-google-fonts\/[\w-]+$/.test(spec)) vs.push({ file: f, line, rule: 'font-root-import', text: spec });
      else if (f !== 'src/ui/fonts.ts') vs.push({ file: f, line, rule: 'font-outside-fonts-ts', text: spec });
    }
  }
  check(vs);
});

test('react-native-maps는 앱 구글 지도 어댑터에서만 쓴다(화면은 MapCanvas 한 벌)', () => {
  const allowed = ['src/components/map/GoogleMapView.tsx'];
  check(eachLine(FILES.filter((f) => !allowed.includes(f)), 'react-native-maps', /['"]react-native-maps['"]/));
});

test('구글 지도 SDK는 components/map 안에서만 부른다', () => {
  const inMap = (f: string) => f.startsWith('src/components/map/');
  check(eachLine(FILES.filter((f) => !inMap(f)), 'google-maps-sdk', /maps\.googleapis\.com|google\.maps\./));
});

test("앱 이름은 Young Trip이다. '여정'·'yeojeong'이 없다", () => {
  const extra = ['app.config.js', 'README.md'].filter(exists);
  const vs = [...eachLine(FILES, 'brand', /여정|yeojeong/i, 'raw')];
  for (const f of extra) vs.push(...scanLines(f, read(f), 'brand', /여정|yeojeong/i));
  check(vs);
});

test('지연은 경고가 아니라 조정안이다(금지 문구 없음)', () => {
  check(eachLine(FILES, 'delay-wording', /늦었습니다|지연되었습니다|서두르세요/, 'raw'));
});

test('용어를 바꾸지 않는다(확정 장소·제외 장소·투표·출발지 금지)', () => {
  check(eachLine(FILES, 'terms', /확정 장소|제외 장소|투표|출발지/));
});

test('검사 대상에 화면과 ui가 들어 있다', () => {
  assert.ok(FILES.includes('src/ui/tokens.ts'));
  assert.ok(FILES.some((f) => f.startsWith('src/screens/')));
});
