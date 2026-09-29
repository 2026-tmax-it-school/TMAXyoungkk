import type { LatLng } from '../../types';
import type { MapMarkerInput, MapPolylineInput } from './layout';

/**
 * 지도 엔진 고르기와 화면 맞춤 좌표(WP5 소유, 순수).
 * - 'google': 구글 지도. 웹은 Maps JavaScript API, 앱은 react-native-maps(안드로이드 구글, iOS Expo Go는 Apple 지도).
 * - 'svg': MapCanvas 기본 지도(react-native-svg 격자). 키가 필요 없다.
 * 구글 길찾기는 국내 도보·자동차 경로를 주지 않는다. 그래서 구글은 바탕 지도로만 쓰고 선 모양은 기존 경로 제공자가 준다.
 */

export type MapEngine = 'google' | 'svg';

/**
 * 키가 있을 때만 구글이다. override가 svg면 키가 있어도 기본 지도다.
 * 키 없는 구글 지도는 고르지 않는다. 구글이 키 없는 요청을 ApiProjectMapError로 막아 빈 화면이 된다.
 */
export function pickMapEngine(o: { key: string; override: string }): MapEngine {
  if (o.override.trim().toLowerCase() === 'svg') return 'svg';
  return o.key.trim().length > 0 ? 'google' : 'svg';
}

export interface FitInput {
  markers: MapMarkerInput[];
  polylines: MapPolylineInput[];
  user?: { coord: LatLng };
  fitTo?: LatLng[];
}

/**
 * 화면에 맞출 좌표. fitTo가 있으면 그것만, 없으면 마커와 선 전체다.
 * 현재 위치는 마커·선이 하나도 없을 때만 넣는다. 걷는 동안 점이 움직일 때마다 지도가 다시 맞춰지지 않게 한다.
 */
export function fitCoords(i: FitInput): LatLng[] {
  if (i.fitTo && i.fitTo.length > 0) return i.fitTo;
  const out: LatLng[] = [];
  for (const m of i.markers) out.push(m.coord);
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

/** 맞춘 뒤 이보다 더 당기지 않는다. 약 1.1km 폭(layout MIN_SPAN_DEG)에 가깝다. */
export const FIT_MAX_ZOOM = 16;
/** 묶음을 눌러 당길 때 한도. 29~77m 붙은 쌍도 이 배율에서 떨어진다. */
export const FOCUS_MAX_ZOOM = 19;
/** 이 배율 이상인데도 묶여 있으면 더 당기지 않고 목록을 띄운다 */
export const GROUP_LIST_ZOOM = 18;
