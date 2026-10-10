/**
 * 디자인 토큰(2026-10-10 리디자인: 숙박·여행 앱 레퍼런스). 화면·feature·components 파일에는 hex·fontWeight·
 * fontFamily·그림자·16 초과 라운드를 적지 않고 전부 여기와 src/ui 컴포넌트를 거친다.
 *
 * 방향: 흰 바탕에 잉크 글자, 주색(accent)은 진한 연두 하나다(주 버튼, 켜진 탭, 선택 표시).
 * 흰 글씨 대비 4.5:1을 지키려고 밝은 연두 대신 #457F1A(면)·#3F7A16(글자)을 쓴다.
 * 카드는 테두리 대신 큰 라운드와 옅은 그림자로 띄운다(E.card, src/ui 안에서만).
 * 빠른 메뉴 원형 아이콘은 연한 연두 면(accentTint), 여행지 표지는 cover 색 면 위 흰 글씨다.
 * 유채색 상태 표시(확정 초록, 경고 앰버, 지도 날짜 선과 현재 위치)는 그대로 둔다. 그라디언트는 두지 않는다.
 *
 * 글자색(textC)과 면색(surfaceC)을 나눠 타입으로 섞이지 않게 한다.
 * faint #A1A1AA는 본문 대비 4.5 미만이라 글자에 쓰지 않는다. 아이콘과 비활성 테두리에만 쓴다.
 * 경고는 앰버다. 주색(잉크)을 위험 신호로 쓰지 않는다.
 *
 * 이 파일은 순수 TS다(대비 테스트가 node로 불러온다). react-native를 import하지 않는다.
 */

/** 글자색 */
export const textC = {
  ink: '#111111',
  muted: '#666666',
  /** 주색 글자(링크형 버튼, 선택된 탭). 진한 연두 */
  accent: '#3F7A16',
  /** 연회색 면(soft) 위 강조 글자(칩, 달력 사이 날짜) */
  accentStrong: '#111111',
  warn: '#8A5A00',
  ok: '#2F6B4F',
  /** 주색·앰버·초록 면 위 흰 글씨 */
  onAccent: '#FFFFFF',
  /** 잉크 면 위 흰 글씨(지도 클러스터 숫자 등) */
  onInk: '#FFFFFF',
  /** 연한 연두 면(accentTint) 위 글자·아이콘 */
  accentDeep: '#3A7014',
  /** 프로필 원(lavender) 위 머리글자 */
  lavenderInk: '#4338CA',
} as const;
export type TextColorKey = keyof typeof textC;

/** 면색. accent·amber·moss는 버튼·아바타·핀 면이다. */
export const surfaceC = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  /** 연회색 면(고정 칩, 선택 칸, 상대 말풍선) */
  soft: '#F4F4F5',
  softLine: '#E4E4E7',
  warnBg: '#FFF6E5',
  warnLine: '#F2DFB5',
  okBg: '#ECF5EF',
  off: '#F4F4F5',
  excludedBg: '#FAFAFA',
  excludedLine: '#E4E4E7',
  track: '#EBEBEB',
  grabber: '#D9D9D9',
  /** 05 내 말풍선(잉크 면) 안 장소 강조 면(흰 글씨 11.4:1) */
  onAccentHl: '#3A3A3A',
  accent: '#457F1A',
  amber: '#8A5A00',
  moss: '#2F6B4F',
  ink: '#111111',
  /** 빠른 메뉴 원, 빈 상태 원(연한 연두) */
  accentTint: '#F0F7E6',
  /** 프로필 머리 원 */
  lavender: '#EEECFD',
  /** 여행지 표지 면(흰 글씨 5.7:1 이상). 지역마다 하나씩 돌려 쓴다 */
  coverSea: '#1F5F8B',
  coverTeal: '#2C6E7F',
  coverPlum: '#7A3E6E',
  coverForest: '#2F6B4F',
  coverClay: '#9A4A1E',
  coverNavy: '#3B4A8C',
} as const;
export type SurfaceColorKey = keyof typeof surfaceC;

/** 선색. line은 1px 구분선, faint는 비활성 테두리 전용 */
export const lineC = {
  line: '#EBEBEB',
  accent: '#457F1A',
  faint: '#A1A1AA',
} as const;
export type LineColorKey = keyof typeof lineC;

/** 아이콘 색. 글자색에 faint를 더한다(꺼진 탭 아이콘, 드래그 손잡이). */
export const iconC = { ...textC, faint: '#A1A1AA' } as const;
export type IconColorKey = keyof typeof iconC;

/**
 * 지도 색. 바탕 #F4F4F5 위에서 날짜 선 색 대비: 잉크 17.2, 청회색 5.94, 초록 5.73, 앰버 5.39.
 * 현재 위치는 지도 앱 관례대로 파랑 점 하나만 쓴다(다른 곳에는 파랑을 쓰지 않는다).
 */
export const mapC = {
  bg: '#F4F4F5',
  grid: '#E6E6E8',
  ink: '#111111',
  slate: '#3F5F8A',
  ok: '#2F6B4F',
  warn: '#8A5A00',
  white: '#FFFFFF',
  faint: '#A1A1AA',
  user: '#1A73E8',
  accuracy: 'rgba(26,115,232,0.14)',
  excludedPin: '#FFFFFF',
} as const;

/**
 * 날짜별 선 색. 1일 잉크, 2일 청회색, 3일 초록, 4일부터 앰버.
 * 순서는 core/constants 한 곳에 두고(순수 영역 core/map도 쓴다) 여기서 다시 내보낸다.
 */
export { DAY_COLORS, dayColor, type RouteColor } from '../core/constants';

/** 폰트 family. 굵기는 family로만 바꾼다(fontWeight 금지). 자산은 fonts.ts가 서브패스로 불러온다. */
export const F = {
  title: 'GothicA1_800ExtraBold',
  regular: 'GothicA1_400Regular',
  semibold: 'GothicA1_600SemiBold',
  bold: 'GothicA1_700Bold',
} as const;
export type FontFamily = (typeof F)[keyof typeof F];

export interface TypeStyle {
  fontFamily: FontFamily;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

/** 타입 스케일. 화면은 <Txt v=...>만 쓴다. */
export const T = {
  // 01 워드마크. 고딕 ExtraBold, 자간 -.03em
  display: { fontFamily: F.title, fontSize: 44, lineHeight: 48, letterSpacing: -1.3 },
  /** 탭 첫 화면 큰 제목(프로필·메시지처럼) */
  hero: { fontFamily: F.title, fontSize: 32, lineHeight: 40, letterSpacing: -0.9 },
  ttl: { fontFamily: F.title, fontSize: 26, lineHeight: 33, letterSpacing: -0.7 },
  /** 홈 구역 제목('추천 여행지') */
  section: { fontFamily: F.title, fontSize: 20, lineHeight: 27, letterSpacing: -0.5 },
  /** 표지 위 큰 지역 이름 */
  cover: { fontFamily: F.title, fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  /** 프로필 원 안 머리글자 */
  monogram: { fontFamily: F.title, fontSize: 40, lineHeight: 48 },
  ttlSm: { fontFamily: F.title, fontSize: 19, lineHeight: 26, letterSpacing: -0.4 },
  nm: { fontFamily: F.bold, fontSize: 15, lineHeight: 21, letterSpacing: -0.15 },
  nmLg: { fontFamily: F.bold, fontSize: 17, lineHeight: 24, letterSpacing: -0.17 },
  body: { fontFamily: F.regular, fontSize: 14, lineHeight: 21 },
  bubble: { fontFamily: F.regular, fontSize: 13.5, lineHeight: 21 },
  mt: { fontFamily: F.regular, fontSize: 12.5, lineHeight: 18 },
  mtTight: { fontFamily: F.regular, fontSize: 11.5, lineHeight: 16 },
  eyebrow: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16 },
  chip: { fontFamily: F.bold, fontSize: 11.5, lineHeight: 16 },
  /** line 칩(ScopeBadge, '예시 데이터')은 목업 .chip.line처럼 SemiBold */
  chipLine: { fontFamily: F.semibold, fontSize: 11.5, lineHeight: 16 },
  /** 목업 .sub(헤더 보조 줄) */
  sub: { fontFamily: F.regular, fontSize: 13, lineHeight: 19 },
  /** 목업 .field 입력 글자 */
  field: { fontFamily: F.regular, fontSize: 14.5, lineHeight: 21 },
  btn: { fontFamily: F.bold, fontSize: 15, lineHeight: 20, letterSpacing: -0.15 },
  btnSm: { fontFamily: F.bold, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16 },
  seg: { fontFamily: F.semibold, fontSize: 14, lineHeight: 20 },
  tab: { fontFamily: F.semibold, fontSize: 11, lineHeight: 14, letterSpacing: -0.1 },
  /** 빠른 메뉴 원 아래 라벨, 검색 알약 글자 */
  quick: { fontFamily: F.semibold, fontSize: 13, lineHeight: 18 },
  time: { fontFamily: F.bold, fontSize: 12, lineHeight: 17 },
  /** 목업 01 태그라인(SemiBold 15, 행간 1.7) */
  tagline: { fontFamily: F.semibold, fontSize: 15, lineHeight: 25.5 },
  /** 12px Regular 보조 글씨(목업 01 단계 이름) */
  mtSm: { fontFamily: F.regular, fontSize: 12, lineHeight: 17 },
  /** 목업 .msg .hl 장소 강조(Bold 13.5). 말풍선 본문 bubble과 행간이 같다 */
  bubbleBold: { fontFamily: F.bold, fontSize: 13.5, lineHeight: 21 },
  /** 목업 08 단계 라벨. 진행 중인 단계는 stepOn */
  step: { fontFamily: F.semibold, fontSize: 13.5, lineHeight: 19 },
  stepOn: { fontFamily: F.bold, fontSize: 13.5, lineHeight: 19 },
  /** 틴트 카드 안 설명 문단(목업 08 규칙, 12 미리보기. 11.5 / 행간 1.7). 강조는 noteStrong */
  note: { fontFamily: F.regular, fontSize: 11.5, lineHeight: 19.5 },
  noteStrong: { fontFamily: F.bold, fontSize: 11.5, lineHeight: 19.5 },
  /** nm보다 한 단계 작은 이름(목업 09 기점·복귀 행 14px) */
  nmSm: { fontFamily: F.bold, fontSize: 14, lineHeight: 20 },
  /** 목업 10 경고 카드 조정안 행 라벨(SemiBold 12.5) */
  mtSemi: { fontFamily: F.semibold, fontSize: 12.5, lineHeight: 18 },
  /** 경고 카드 설명 문장(목업 10, 행간 1.6) */
  mtLoose: { fontFamily: F.regular, fontSize: 12.5, lineHeight: 20 },
} as const satisfies Record<string, TypeStyle>;
export type TypeKey = keyof typeof T;

/**
 * 고정 폭 숫자(목업 .t, .num의 tabular-nums)로 그리는 변형. 시각 열이 행마다 폭이 달라지지 않게 한다.
 * Txt가 fontVariant ['tabular-nums']를 더한다.
 */
export const TABULAR_NUMS: readonly TypeKey[] = ['time'];

/** 간격 */
export const SP = {
  gutter: 22,
  cardPad: 16,
  xs: 4,
  s: 6,
  m: 8,
  l: 10,
  xl: 12,
  xxl: 16,
  section: 22,
  /** 말풍선 위아래 여백(목업 .bub 9) */
  bubbleV: 9,
  /** 말풍선 장소 강조 좌우 여백(목업 .hl 0 3px) */
  hl: 3,
} as const;

/** 라운드. 화면 코드에는 숫자를 적지 않고 이 토큰만 쓴다. 칩·알약·원형 버튼은 999 */
export const R = {
  card: 20,
  btn: 12,
  btnSm: 10,
  field: 12,
  iconBtn: 999,
  sheet: 24,
  bubble: 16,
  photo: 16,
  /** 여행지 표지 타일 */
  cover: 18,
  /** 말풍선 장소 강조(목업 .hl 3) */
  hl: 3,
  chip: 999,
} as const;

/** 크기 */
export const H = {
  btn: 52,
  btnSm: 40,
  field: 48,
  iconBtn: 40,
  tabBar: 66,
  /** 빠른 메뉴 원 */
  quick: 60,
  /** 프로필 머리 원 */
  monogram: 104,
  avatar: 27,
  avatarBorder: 2,
  avatarOverlap: -8,
  grabberW: 38,
  grabberH: 4,
  progress: 6,
  timeCol: 52,
  /** 라벨 없는 한 줄 입력 칸(05 입력줄, 목업 44). 옆의 아이콘 버튼도 같은 높이다 */
  fieldSm: 44,
  /** 시트 안 목록의 최대 높이(24 동명 장소 선택) */
  sheetList: 360,
} as const;

/**
 * 그림자. float는 지도 위에 뜬 요소 전용이고, 디자인 규칙 테스트가 참조 위치를 FLOAT_ALLOWED로 제한한다.
 * card·pill은 src/ui 컴포넌트(Card, 카테고리 칩, 표지)만 쓴다. 화면 코드는 그림자를 직접 쓰지 않는다.
 */
export const E = {
  float: { boxShadow: '0 4px 14px rgba(17,17,17,0.08)' },
  card: { boxShadow: '0 6px 20px rgba(0,0,0,0.08)' },
  pill: { boxShadow: '0 3px 12px rgba(0,0,0,0.10)' },
} as const;

/**
 * 대비 검사 대상 글자·면 조합. foundation-contrast가 본문 4.5:1(large는 3:1)을 확인한다.
 * 새 조합을 쓰려면 여기에 먼저 넣는다.
 */
export const TEXT_ON_SURFACE_PAIRS: { text: TextColorKey; surface: SurfaceColorKey; large?: boolean }[] = [
  { text: 'ink', surface: 'bg' },
  { text: 'ink', surface: 'card' },
  { text: 'ink', surface: 'soft' },
  { text: 'ink', surface: 'warnBg' },
  { text: 'ink', surface: 'okBg' },
  { text: 'ink', surface: 'off' },
  { text: 'ink', surface: 'excludedBg' },
  { text: 'muted', surface: 'bg' },
  { text: 'muted', surface: 'card' },
  { text: 'muted', surface: 'soft' },
  { text: 'muted', surface: 'off' },
  { text: 'muted', surface: 'excludedBg' },
  { text: 'muted', surface: 'warnBg' },
  { text: 'accent', surface: 'card' },
  { text: 'accent', surface: 'bg' },
  { text: 'accent', surface: 'soft' },
  { text: 'accentStrong', surface: 'soft' },
  { text: 'accentStrong', surface: 'card' },
  { text: 'warn', surface: 'warnBg' },
  { text: 'warn', surface: 'card' },
  { text: 'warn', surface: 'bg' },
  { text: 'ok', surface: 'okBg' },
  { text: 'ok', surface: 'card' },
  { text: 'onAccent', surface: 'accent' },
  { text: 'onAccent', surface: 'amber' },
  { text: 'onAccent', surface: 'moss' },
  { text: 'onAccent', surface: 'onAccentHl' },
  { text: 'onInk', surface: 'ink' },
  { text: 'accentDeep', surface: 'accentTint' },
  { text: 'accent', surface: 'accentTint' },
  { text: 'lavenderInk', surface: 'lavender' },
  { text: 'onAccent', surface: 'coverSea' },
  { text: 'onAccent', surface: 'coverTeal' },
  { text: 'onAccent', surface: 'coverPlum' },
  { text: 'onAccent', surface: 'coverForest' },
  { text: 'onAccent', surface: 'coverClay' },
  { text: 'onAccent', surface: 'coverNavy' },
];

/**
 * 비텍스트 대비(WCAG 1.4.11) 검사 대상. 진행 막대 채움과 트랙처럼 상태를 알리는 요소는 3:1 이상이다.
 * foundation-contrast가 검사한다.
 */
export const NON_TEXT_PAIRS: { name: string; fg: SurfaceColorKey; bg: SurfaceColorKey }[] = [
  { name: '진행 막대: 연두 채움 / 트랙', fg: 'accent', bg: 'track' },
];
