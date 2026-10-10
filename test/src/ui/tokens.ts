/**
 * 디자인 토큰(2026-10-10: Young Trip 디자인 시스템 적용, 원본은 저장소의 design-system/).
 * 화면·feature·components 파일에는 hex·fontWeight·fontFamily·그림자·라운드 숫자를 적지 않고
 * 전부 여기와 src/ui 컴포넌트를 거친다.
 *
 * 원칙(design-system/README.md): 내용(사진·지도·시간표)이 먼저, 장식 면·무늬 없음.
 * - 색: 바탕 surface, 글자 ink(#222)·ink-muted(#6A6A6A). brand(연두)는 지금 누를 것과 켜진 상태에만.
 *   선택 표시(칩·탭 밑줄·선택 카드)는 ink. 좋은 상태는 brand-soft 위 brand-ink, 조정 필요는 warn.
 * - 모서리: 배지 4 · 입력/작은 버튼 8 · 버튼/카드 12 · 사진/시트 16 · 검색창/칩/원형 버튼 pill.
 * - 그림자: 지도 위에 뜬 것(E.float)만. 카드는 1px 선(line)으로 나눈다.
 * - 간격: 4 단위, 화면 좌우 24.
 *
 * 글자색(textC)과 면색(surfaceC)을 나눠 타입으로 섞이지 않게 한다.
 * faint #A1A1AA는 본문 대비 4.5 미만이라 글자에 쓰지 않는다. 아이콘과 비활성 테두리에만 쓴다.
 * 경고는 앰버다. 주색을 위험 신호로 쓰지 않는다.
 *
 * 이 파일은 순수 TS다(대비 테스트가 node로 불러온다). react-native를 import하지 않는다.
 */

/** 글자색 */
export const textC = {
  /** ink. 본문·제목, surface·soft·accentTint 위 */
  ink: '#222222',
  /** ink-muted. 보조 글자(날짜, 주소, 개수). surface 5.4:1, soft 5.0:1 */
  muted: '#6A6A6A',
  /** brand-ink. 글자로 쓰는 주색(링크형 버튼, 켜진 하단 탭). surface 6.1:1, accentTint 5.6:1 */
  accent: '#3A6E14',
  /** 연회색 면(soft) 위 강조 글자(배지, 달력 사이 날짜) */
  accentStrong: '#222222',
  warn: '#8A5A00',
  /** 좋은 상태(확정) 글자. brand-ink와 같은 값 */
  ok: '#3A6E14',
  /** 주색·앰버·초록 면 위 흰 글씨 */
  onAccent: '#FFFFFF',
  /** 잉크 면 위 흰 글씨(지도 클러스터 숫자 등) */
  onInk: '#FFFFFF',
  /** 연한 연두 면(accentTint) 위 글자·아이콘 */
  accentDeep: '#3A6E14',
  /** 카카오 로그인 버튼 글씨(카카오 디자인 가이드: 검정 85%를 흰 바탕에 합성한 값) */
  onKakao: '#191919',
} as const;
export type TextColorKey = keyof typeof textC;

/** 면색. accent·amber·moss는 버튼·아바타·핀 면이다. */
export const surfaceC = {
  /** surface */
  bg: '#FFFFFF',
  card: '#FFFFFF',
  /** surface-soft. 사진 자리, 고정 칩, 선택 칸, 상대 말풍선 */
  soft: '#F7F7F7',
  softLine: '#EBEBEB',
  warnBg: '#FFF4DC',
  warnLine: '#F2DFB5',
  /** 좋은 상태 바탕. brand-soft와 같은 값 */
  okBg: '#EFF6E6',
  off: '#F7F7F7',
  excludedBg: '#FAFAFA',
  excludedLine: '#DDDDDD',
  track: '#EBEBEB',
  grabber: '#DDDDDD',
  /** 05 내 말풍선(잉크 면) 안 장소 강조 면 */
  onAccentHl: '#3A3A3A',
  /** brand. 주 버튼 면, 화면당 하나 */
  accent: '#457F1A',
  amber: '#8A5A00',
  moss: '#2F6B4F',
  ink: '#222222',
  /** brand-soft. 빠른 메뉴 원, 빈 상태 원, 좋은 상태 배지 바탕 */
  accentTint: '#EFF6E6',
  /** 카카오 로그인 버튼 면(카카오 디자인 가이드 컨테이너 색) */
  kakao: '#FEE500',
} as const;
export type SurfaceColorKey = keyof typeof surfaceC;

/** 선색. line은 1px 구분선, strong은 알아봐야 하는 테두리(입력칸, 칩), faint는 비활성 테두리 전용 */
export const lineC = {
  line: '#DDDDDD',
  /** line-strong. surface 위 3.45:1 */
  strong: '#8A8A8A',
  /** 선택 테두리·밑줄·포커스 */
  ink: '#222222',
  accent: '#457F1A',
  faint: '#A1A1AA',
} as const;
export type LineColorKey = keyof typeof lineC;

/** 아이콘 색. 글자색에 faint를 더한다(꺼진 탭 아이콘, 드래그 손잡이). */
export const iconC = { ...textC, faint: '#A1A1AA' } as const;

/**
 * 소셜 로그인 브랜드 색. 15 로그인의 카카오·구글 버튼과 로고(ui/BrandLogo)에서만 쓴다. 장식용으로 다른 곳에 쓰지 않는다.
 * 카카오: 말풍선 심볼은 검정. 구글: 'G' 네 색과 흰 버튼의 회색 테두리(구글 로그인 브랜드 가이드).
 */
export const brandC = {
  kakaoSymbol: '#000000',
  googleBlue: '#4285F4',
  googleRed: '#EA4335',
  googleYellow: '#FBBC05',
  googleGreen: '#34A853',
  googleLine: '#747775',
} as const;
export type BrandColorKey = keyof typeof brandC;
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
  /** DS title. 화면·구역 제목 */
  ttl: { fontFamily: F.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  /** DS title. 홈 구역 제목('내 여행', '추천 여행지') */
  section: { fontFamily: F.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  /** 프로필 원 안 머리글자 */
  monogram: { fontFamily: F.title, fontSize: 40, lineHeight: 48 },
  /** DS heading. 카드 묶음·시트 제목 */
  ttlSm: { fontFamily: F.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  /** DS body-strong. 카드·목록의 이름 줄 */
  nm: { fontFamily: F.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  nmLg: { fontFamily: F.bold, fontSize: 17, lineHeight: 24, letterSpacing: -0.17 },
  /** DS body */
  body: { fontFamily: F.regular, fontSize: 16, lineHeight: 24 },
  bubble: { fontFamily: F.regular, fontSize: 14, lineHeight: 21 },
  /** DS body-sm. 보조 줄(날짜, 주소) */
  mt: { fontFamily: F.regular, fontSize: 14, lineHeight: 20 },
  mtTight: { fontFamily: F.regular, fontSize: 12, lineHeight: 17 },
  eyebrow: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16 },
  /** DS caption. 배지 */
  chip: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16 },
  /** line 칩('예시 데이터')은 목업 .chip.line처럼 SemiBold */
  chipLine: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16 },
  /** 목업 .sub(헤더 보조 줄) */
  sub: { fontFamily: F.regular, fontSize: 14, lineHeight: 20 },
  /** 목업 .field 입력 글자 */
  field: { fontFamily: F.regular, fontSize: 16, lineHeight: 22 },
  /** DS 버튼 라벨 */
  btn: { fontFamily: F.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  /** DS label. 작은 버튼, 칩, 링크형 버튼 */
  btnSm: { fontFamily: F.semibold, fontSize: 14, lineHeight: 18 },
  label: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16 },
  seg: { fontFamily: F.semibold, fontSize: 14, lineHeight: 20 },
  /** DS 카테고리 탭 라벨(아이콘 아래) */
  cat: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16 },
  tab: { fontFamily: F.semibold, fontSize: 11, lineHeight: 14, letterSpacing: -0.1 },
  /** 빠른 메뉴 원 아래 라벨, 검색 알약 글자 */
  quick: { fontFamily: F.semibold, fontSize: 14, lineHeight: 18 },
  time: { fontFamily: F.bold, fontSize: 13, lineHeight: 18 },
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
  /** 15 로그인·16 회원가입 가운데 큰 제목 */
  authTitle: { fontFamily: F.title, fontSize: 28, lineHeight: 36, letterSpacing: -0.7 },
} as const satisfies Record<string, TypeStyle>;
export type TypeKey = keyof typeof T;

/**
 * 고정 폭 숫자(목업 .t, .num의 tabular-nums)로 그리는 변형. 시각 열이 행마다 폭이 달라지지 않게 한다.
 * Txt가 fontVariant ['tabular-nums']를 더한다.
 */
export const TABULAR_NUMS: readonly TypeKey[] = ['time'];

/** 간격(DS space-1~7: 4·8·12·16·24·32·48) */
export const SP = {
  gutter: 24,
  cardPad: 16,
  xs: 4,
  s: 6,
  m: 8,
  l: 10,
  xl: 12,
  xxl: 16,
  section: 32,
  /** 말풍선 위아래 여백 */
  bubbleV: 9,
  /** 말풍선 장소 강조 좌우 여백 */
  hl: 3,
} as const;

/** 라운드(DS radius). 화면 코드에는 숫자를 적지 않고 이 토큰만 쓴다 */
export const R = {
  /** radius-xs. 상태 배지 */
  tag: 4,
  /** radius-md. 버튼, 카드 */
  card: 12,
  btn: 12,
  /** radius-sm. 입력칸, 작은 버튼, 목록 썸네일 */
  btnSm: 8,
  field: 8,
  /** radius-pill. 원형 아이콘 버튼 */
  iconBtn: 999,
  /** radius-lg. 사진, 시트 */
  sheet: 16,
  photo: 16,
  bubble: 16,
  /** 말풍선 장소 강조 */
  hl: 3,
  /** 15 로그인·16 회원가입 입력 칸과 버튼(작은 라운드의 직사각형) */
  auth: 6,
  /** radius-pill. 검색창, 필터 칩, 사진 위 배지 */
  chip: 999,
} as const;

/** 크기 */
export const H = {
  btn: 48,
  btnSm: 36,
  /** DS TextField: 라벨이 칸 안 위쪽에 붙어 56 */
  field: 56,
  iconBtn: 40,
  tabBar: 64,
  /** 빠른 메뉴 원 */
  quick: 56,
  /** 프로필 머리 원 */
  monogram: 96,
  avatar: 27,
  avatarBorder: 2,
  avatarOverlap: -8,
  grabberW: 38,
  grabberH: 4,
  progress: 4,
  timeCol: 52,
  /** 라벨 없는 한 줄 입력 칸(05 입력줄). 옆의 아이콘 버튼도 같은 높이다 */
  fieldSm: 44,
  /** 시트 안 목록의 최대 높이(24 동명 장소 선택) */
  sheetList: 360,
  /** 15 로그인·16 회원가입 입력 칸과 버튼 높이 */
  auth: 48,
  /** 소셜 로그인 버튼 로고 크기 */
  brandLogo: 20,
} as const;

/**
 * 그림자는 이것 하나(DS shadow-float). 지도 위에 뜬 요소에만 쓴다. 카드·시트·토스트에는 없다.
 * 디자인 규칙 테스트가 참조 위치를 FLOAT_ALLOWED(지도 컴포넌트와 지도 화면)로 제한한다.
 */
export const E = {
  float: { boxShadow: '0 6px 16px rgba(0,0,0,0.12)' },
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
  { text: 'ink', surface: 'accentTint' },
  { text: 'onKakao', surface: 'kakao' },
];

/**
 * 비텍스트 대비(WCAG 1.4.11) 검사 대상. 진행 막대 채움과 트랙처럼 상태를 알리는 요소는 3:1 이상이다.
 * foundation-contrast가 검사한다.
 */
export const NON_TEXT_PAIRS: { name: string; fg: SurfaceColorKey; bg: SurfaceColorKey }[] = [
  { name: '진행 막대: 연두 채움 / 트랙', fg: 'accent', bg: 'track' },
];
