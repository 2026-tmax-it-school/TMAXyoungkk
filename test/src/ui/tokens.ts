/**
 * 디자인 토큰(2026-09-29 개편: 화이트·모노톤). 화면·feature·components 파일에는 hex·fontWeight·
 * fontFamily·그림자·16 초과 라운드를 적지 않고 전부 여기와 src/ui 컴포넌트를 거친다.
 *
 * 방향: 흰 바탕, 거의 검정인 잉크 하나를 주색(accent)으로 쓴다. 유채색은 상태에만 쓴다(확정 초록, 경고 앰버,
 * 지도 날짜 선과 현재 위치). 그라디언트·유채 틴트 면·장식용 색은 두지 않는다.
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
  /** 주색 글자(링크형 버튼, 선택된 탭). 잉크와 같은 값이지만 역할이 달라 키를 나눈다 */
  accent: '#111111',
  /** 연회색 면(soft) 위 강조 글자(칩, 달력 사이 날짜) */
  accentStrong: '#111111',
  warn: '#8A5A00',
  ok: '#2F6B4F',
  /** 주색·앰버·초록 면 위 흰 글씨 */
  onAccent: '#FFFFFF',
  /** 잉크 면 위 흰 글씨(지도 클러스터 숫자 등) */
  onInk: '#FFFFFF',
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
  accent: '#111111',
  amber: '#8A5A00',
  moss: '#2F6B4F',
  ink: '#111111',
} as const;
export type SurfaceColorKey = keyof typeof surfaceC;

/** 선색. line은 1px 구분선, faint는 비활성 테두리 전용 */
export const lineC = {
  line: '#EBEBEB',
  accent: '#111111',
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
  ttl: { fontFamily: F.title, fontSize: 24, lineHeight: 31, letterSpacing: -0.6 },
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
  tab: { fontFamily: F.semibold, fontSize: 10.5, lineHeight: 14, letterSpacing: -0.1 },
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
  cardPad: 14,
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

/** 라운드. 16 이하, 칩만 999 */
export const R = {
  card: 12,
  btn: 11,
  btnSm: 9,
  field: 10,
  iconBtn: 9,
  sheet: 16,
  bubble: 12,
  photo: 12,
  /** 말풍선 장소 강조(목업 .hl 3) */
  hl: 3,
  chip: 999,
} as const;

/** 크기 */
export const H = {
  btn: 50,
  btnSm: 38,
  field: 46,
  iconBtn: 34,
  tabBar: 74,
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
 * 그림자는 이것 하나. 지도 위에 뜬 요소에만 쓴다. 카드·시트·토스트에는 없다.
 * 디자인 규칙 테스트가 참조 위치를 FLOAT_ALLOWED(지도 컴포넌트와 지도 화면)로 제한한다.
 */
export const E = {
  float: { boxShadow: '0 4px 14px rgba(17,17,17,0.08)' },
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
];

/**
 * 비텍스트 대비(WCAG 1.4.11) 검사 대상. 진행 막대 채움과 트랙처럼 상태를 알리는 요소는 3:1 이상이다.
 * foundation-contrast가 검사한다.
 */
export const NON_TEXT_PAIRS: { name: string; fg: SurfaceColorKey; bg: SurfaceColorKey }[] = [
  { name: '진행 막대: 잉크 채움 / 트랙', fg: 'accent', bg: 'track' },
];
