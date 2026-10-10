import type { LatLng } from '../../types';
import type { MapDotInput, MapMarkerInput, MapPolylineInput } from './layout';

/**
 * 지도 엔진 고르기와 화면 맞춤 좌표(WP5 소유, 순수).
 * - 'kakao': 카카오맵(2026-10-10 결정, 기본). 웹은 Maps JavaScript SDK, 앱은 WebView 안에서 같은 SDK를 띄운다.
 * - 'google': 구글 지도(선택 대체). 웹은 Maps JavaScript API, 앱은 react-native-maps(안드로이드 구글, iOS Expo Go는 Apple 지도).
 * - 'svg': MapCanvas 기본 지도(react-native-svg 격자). 키가 필요 없다.
 * 어느 바탕 지도든 선 모양은 기존 경로 제공자(OpenStreetMap OSRM·카카오모빌리티)가 준다.
 */

export type MapEngine = 'kakao' | 'google' | 'svg';

/**
 * 고르는 순서
 * 1. override가 svg면 키가 있어도 기본 지도
 * 2. override가 google이고 구글 키가 있으면 구글
 * 3. 카카오 키(JavaScript 키)가 있으면 카카오
 * 4. 구글 키가 있으면 구글
 * 5. 그 밖은 기본 지도
 * 키 없는 지도는 고르지 않는다. 구글은 키 없는 요청을 ApiProjectMapError로, 카카오는 appkey 없는 SDK 요청을 막아 빈 화면이 된다.
 * key는 구글 키다(예전 호출 모양을 지킨다). override 'kakao'는 비운 것과 같다(카카오 키가 있으면 카카오가 기본이다).
 */
export function pickMapEngine(o: { key: string; override: string; kakaoKey?: string }): MapEngine {
  const override = o.override.trim().toLowerCase();
  const google = o.key.trim().length > 0;
  const kakao = (o.kakaoKey ?? '').trim().length > 0;
  if (override === 'svg') return 'svg';
  if (override === 'google' && google) return 'google';
  if (kakao) return 'kakao';
  return google ? 'google' : 'svg';
}

export interface FitInput {
  markers: MapMarkerInput[];
  polylines: MapPolylineInput[];
  user?: { coord: LatLng };
  fitTo?: LatLng[];
}

/**
 * 화면에 맞출 좌표. fitTo가 있으면 그것만, 없으면 마커와 선 전체다.
 * 제외 스팟은 다른 마커가 하나라도 있으면 맞춤에서 뺀다. 멀리 떨어진 제외 스팟(감은사지 등) 하나 때문에
 * 그날 루트가 작게 보이지 않게 한다. 제외 핀은 그대로 그려지고, 지도를 움직이면 보인다.
 * 현재 위치는 마커·선이 하나도 없을 때만 넣는다. 걷는 동안 점이 움직일 때마다 지도가 다시 맞춰지지 않게 한다.
 */
export function fitCoords(i: FitInput): LatLng[] {
  if (i.fitTo && i.fitTo.length > 0) return i.fitTo;
  const out: LatLng[] = [];
  const kept = i.markers.filter((m) => m.kind !== 'excluded');
  for (const m of kept.length > 0 ? kept : i.markers) out.push(m.coord);
  for (const l of i.polylines) for (const c of l.coords) out.push(c);
  if (out.length === 0 && i.user) out.push(i.user.coord);
  return out;
}

/** 맞춤 좌표가 같으면 같은 키. 소수 5자리(약 1m)로 자른다. */
export function fitKey(coords: LatLng[]): string {
  return coords.map((c) => `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`).join('|');
}

/** 좌표가 하나도 없을 때 보여 줄 곳(경주 중심). layout.makeProjection과 같다. */
export const DEFAULT_MAP_CENTER: LatLng = { latitude: 35.8562, longitude: 129.2247 };

/* 배율은 구글 zoom(클수록 가까움) 기준이다. 카카오는 kakaoLevel로 바꿔 쓴다. */

/** 맞춘 뒤 이보다 더 당기지 않는다. 약 1.1km 폭(layout MIN_SPAN_DEG)에 가깝다. */
export const FIT_MAX_ZOOM = 16;
/** 묶음을 눌러 당길 때 한도. 29~77m 붙은 쌍도 이 배율에서 떨어진다. */
export const FOCUS_MAX_ZOOM = 19;
/** 이 배율 이상인데도 묶여 있으면 더 당기지 않고 목록을 띄운다 */
export const GROUP_LIST_ZOOM = 18;

/**
 * 구글 zoom을 카카오 레벨로 바꾼다. 카카오는 1(가장 가까움)~14이고 한 단계가 2배라 약 20 - zoom이다.
 * FIT_MAX_ZOOM 16은 4, GROUP_LIST_ZOOM 18은 2, FOCUS_MAX_ZOOM 19는 1, 처음 13은 7이다.
 */
export function kakaoLevel(zoom: number): number {
  return Math.min(14, Math.max(1, Math.round(20 - zoom)));
}

/* ---------- 지도 SDK 어댑터가 같이 쓰는 순수 계산 ---------- */

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 위아래(또는 좌우) 여백 합이 지도 크기의 이 비율을 넘지 않게 줄인다 */
const MAX_PAD_RATIO = 0.6;

function shrink(a: number, b: number, total: number): [number, number] {
  const limit = Math.max(0, total) * MAX_PAD_RATIO;
  const sum = a + b;
  if (sum <= limit || sum === 0) return [a, b];
  const k = limit / sum;
  return [Math.floor(a * k), Math.floor(b * k)];
}

/**
 * 화면 맞춤 여백(px, dp). 구글·카카오 로고와 저작권 표기가 아래쪽에 있어 아래를 더 비운다.
 * - compact(미리보기): 16, 아래 30
 * - flat(11·13 화면 가득): 위에 칩·안내 카드가 떠 있어 위 96
 * - 그 밖: 40, 아래 48
 * 짧은 지도에서 여백이 지도를 다 먹지 않게 위아래·좌우 합을 지도 크기의 60%로 줄인다.
 */
export function mapPadding(size: { width: number; height: number }, o: { compact?: boolean; flat?: boolean }): Padding {
  const side = o.compact ? 16 : 40;
  const top = o.compact ? 16 : o.flat ? 96 : 40;
  const bottom = o.compact ? 30 : 48;
  const [t, b] = shrink(top, bottom, size.height);
  const [l, r] = shrink(side, side, size.width);
  return { top: t, right: r, bottom: b, left: l };
}

/** 묶음을 눌러 당길 때 여백. 80을 넘지 않고 짧은 지도에서는 크기의 1/5로 줄인다 */
export function focusPadding(size: { width: number; height: number }): number {
  return Math.max(8, Math.floor(Math.min(80, size.width / 5, size.height / 5)));
}

/** 핀의 읽기 이름. 기본 지도(SVG)와 같다 */
export function pinName(m: Pick<MapMarkerInput, 'kind' | 'label' | 'title'>): string {
  if (m.kind === 'base') return `기점 ${m.title}`;
  if (m.kind === 'excluded') return `제외 스팟 ${m.title}`;
  if (!m.label) return m.title;
  // 순번이면 'N번', 글자 라벨(길찾기의 '출발'·'도착')이면 그대로 앞에 붙인다
  return /^\d+$/.test(m.label) ? `${m.label}번 ${m.title}` : `${m.label} ${m.title}`;
}

export function clusterName(count: number, pressable = true): string {
  return pressable ? `${count}곳 묶음 · 눌러서 확대` : `${count}곳 묶음`;
}

export function userName(faint: boolean): string {
  return faint ? '현재 위치(정확도 낮음)' : '현재 위치';
}

const r5 = (n: number) => n.toFixed(5);

/** 내용이 같으면 같은 키. 화면이 다시 그려질 때마다 새 배열이 와도 지도를 다시 그리지 않게 한다 */
export function markersKey(markers: MapMarkerInput[]): string {
  return markers
    .map((m) => `${m.id}~${m.kind}~${m.label ?? ''}~${m.color ?? ''}~${m.title}~${r5(m.coord.latitude)},${r5(m.coord.longitude)}`)
    .join('|');
}

export function polylinesKey(lines: MapPolylineInput[]): string {
  return lines
    .map((l) => `${l.id}~${l.color}~${l.dashed ? 1 : 0}~${l.coords.map((c) => `${r5(c.latitude)},${r5(c.longitude)}`).join(';')}`)
    .join('|');
}

export function dotsKey(dots: MapDotInput[]): string {
  return dots.map((d) => `${d.id}~${d.tone}~${d.size ?? ''}~${r5(d.coord.latitude)},${r5(d.coord.longitude)}`).join('|');
}

/** 묶음 id('cluster:a+b')에서 구성 스팟 id를 꺼낸다. layout.clusterMarkers가 만드는 형식이다 */
export function clusterMemberIds(clusterId: string): string[] {
  return clusterId.startsWith('cluster:') ? clusterId.slice('cluster:'.length).split('+').filter(Boolean) : [];
}
