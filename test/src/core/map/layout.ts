import type { LatLng } from '../../types';
import { ARRIVAL_ACCURACY_M } from '../constants';

/**
 * 지도 순수 계산(FR-801·802, WP5 소유). 투영·클러스터·마커 분류·선 계산.
 * 14곳·3일·위치 점 300개에서 100ms(MAP_LAYOUT_BUDGET_MS) 안에 끝나야 한다(wp5-map이 잰다).
 * 렌더(MapCanvas)는 이 결과를 그대로 그리기만 한다. 좌표는 WGS84다.
 *
 * 투영은 등장방형(위도 cos 보정)이다. 경주 규모(수십 km)에서는 왜곡이 눈에 띄지 않고 SDK 없이 계산이 끝난다.
 */

export interface MapMarkerInput {
  id: string;
  coord: LatLng;
  kind: 'spot' | 'excluded' | 'base';
  label?: string;
  title: string;
  /** 순번 핀 면 색. 여러 날짜를 겹쳐 그릴 때(11 '전체') 그날 선 색을 쓴다. 없으면 로즈 */
  color?: 'ink' | 'slate' | 'ok' | 'warn';
}

export interface MapPolylineInput {
  id: string;
  coords: LatLng[];
  color: 'ink' | 'slate' | 'ok' | 'warn';
  dashed?: boolean;
}

export interface MapDotInput {
  id: string;
  coord: LatLng;
  tone: 'ink' | 'faint';
  /** sm: 반경 2.4(기본), md: 반경 3.5에 흰 테두리 1.5(22 실제 이동 지점) */
  size?: 'sm' | 'md';
}

export interface MapLayoutInput {
  markers: MapMarkerInput[];
  polylines: MapPolylineInput[];
  dots?: MapDotInput[];
  user?: { coord: LatLng; accuracyM: number | null };
  size: { width: number; height: number };
  fitTo?: LatLng[];
  /** 이 거리(px) 안에 모인 스팟·제외 마커를 숫자 원 하나로 묶는다. 0이면 묶지 않는다. */
  clusterPx?: number;
  pad?: number;
  /** 가장 좁게 보여줄 범위(도). 기본 MIN_SPAN_DEG(약 1.1km). 클러스터를 눌러 확대할 때 줄인다 */
  minSpanDeg?: number;
}

export interface XY {
  x: number;
  y: number;
}

export interface MapCluster {
  id: string;
  x: number;
  y: number;
  count: number;
  memberIds: string[];
  coords: LatLng[];
}

export interface MapLayout {
  /** 클러스터에 들어가지 않은 마커. 기점은 묶지 않는다. */
  projected: (MapMarkerInput & XY)[];
  clusters: MapCluster[];
  lines: { id: string; color: MapPolylineInput['color']; dashed: boolean; points: XY[] }[];
  dots: (MapDotInput & XY)[];
  /** 현재 위치. faint면 정확도 50m 초과(또는 모름)라 흐린 원으로 그린다. */
  user?: XY & { radiusPx: number; faint: boolean };
  projection: Projection;
}

/** 투영 매개변수. unproject로 지도 누른 지점(FR-202 지도에서 선택)을 좌표로 되돌린다. */
export interface Projection {
  minLng: number;
  maxLat: number;
  /** 경도 1도당 px */
  sx: number;
  /** 위도 1도당 px */
  sy: number;
  offX: number;
  offY: number;
}

export const DEFAULT_CLUSTER_PX = 24;
export const DEFAULT_MAP_PAD = 30;
const M_PER_DEG_LAT = 111_320;
/** 한 점만 있을 때 보여줄 최소 범위(도). 약 1.1km */
const MIN_SPAN_DEG = 0.01;

/**
 * 클러스터를 눌러 확대할 때의 입력. 최소 범위를 약 220m로 줄이고 묶는 거리를 핀보다 작게 둔다.
 * 실제 장소에 29~77m 붙은 쌍이 있다(교촌마을 한정식·교리김밥 등). 이렇게 해도 겹치면 무리 목록에서 고른다.
 */
export const FOCUS_MIN_SPAN_DEG = 0.002;
export function focusOptions(compact: boolean): { clusterPx: number; minSpanDeg: number } {
  return { clusterPx: compact ? 10 : 12, minSpanDeg: FOCUS_MIN_SPAN_DEG };
}

export function makeProjection(
  coords: LatLng[],
  size: { width: number; height: number },
  pad = DEFAULT_MAP_PAD,
  minSpan = MIN_SPAN_DEG,
): Projection {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const c of coords) {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
  }
  if (!Number.isFinite(minLat)) {
    // 좌표가 하나도 없으면 경주 중심을 보여준다(빈 지도도 빈칸이 아니다).
    minLat = 35.8562;
    maxLat = 35.8562;
    minLng = 129.2247;
    maxLng = 129.2247;
  }
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  // 너무 좁은 범위는 가운데를 두고 넓힌다.
  if (maxLat - minLat < minSpan) {
    const m = (minLat + maxLat) / 2;
    minLat = m - minSpan / 2;
    maxLat = m + minSpan / 2;
  }
  if ((maxLng - minLng) * cos < minSpan) {
    const m = (minLng + maxLng) / 2;
    minLng = m - minSpan / cos / 2;
    maxLng = m + minSpan / cos / 2;
  }
  const w = Math.max(1, size.width - pad * 2);
  const h = Math.max(1, size.height - pad * 2);
  // 화면 1px이 가로·세로 같은 거리가 되게 한다.
  const scale = Math.min(w / ((maxLng - minLng) * cos), h / (maxLat - minLat));
  const sx = scale * cos;
  const sy = scale;
  const offX = pad + (w - (maxLng - minLng) * sx) / 2;
  const offY = pad + (h - (maxLat - minLat) * sy) / 2;
  return { minLng, maxLat, sx, sy, offX, offY };
}

export function project(p: Projection, c: LatLng): XY {
  return { x: p.offX + (c.longitude - p.minLng) * p.sx, y: p.offY + (p.maxLat - c.latitude) * p.sy };
}

export function unproject(p: Projection, xy: XY): LatLng {
  return { latitude: p.maxLat - (xy.y - p.offY) / p.sy, longitude: p.minLng + (xy.x - p.offX) / p.sx };
}

/** 미터 → px(세로 기준) */
export function metersToPx(p: Projection, meters: number): number {
  return (meters / M_PER_DEG_LAT) * p.sy;
}

/**
 * 밀집 마커 묶기. 입력 순서대로 훑어 기존 무리 중심에서 threshold 안이면 합친다(탐욕, O(n·k)).
 * 결정적이다. 같은 입력이면 같은 무리가 나온다.
 */
export function clusterMarkers(
  items: (MapMarkerInput & XY)[],
  thresholdPx: number,
): { singles: (MapMarkerInput & XY)[]; clusters: MapCluster[] } {
  if (thresholdPx <= 0) return { singles: items, clusters: [] };
  const groups: { x: number; y: number; members: (MapMarkerInput & XY)[] }[] = [];
  const t2 = thresholdPx * thresholdPx;
  for (const m of items) {
    let hit: (typeof groups)[number] | undefined;
    for (const g of groups) {
      const dx = g.x - m.x;
      const dy = g.y - m.y;
      if (dx * dx + dy * dy <= t2) {
        hit = g;
        break;
      }
    }
    if (hit) {
      hit.members.push(m);
      const n = hit.members.length;
      hit.x += (m.x - hit.x) / n;
      hit.y += (m.y - hit.y) / n;
    } else {
      groups.push({ x: m.x, y: m.y, members: [m] });
    }
  }
  const singles: (MapMarkerInput & XY)[] = [];
  const clusters: MapCluster[] = [];
  for (const g of groups) {
    if (g.members.length === 1) singles.push(g.members[0]);
    else
      clusters.push({
        id: `cluster:${g.members.map((m) => m.id).join('+')}`,
        x: g.x,
        y: g.y,
        count: g.members.length,
        memberIds: g.members.map((m) => m.id),
        coords: g.members.map((m) => m.coord),
      });
  }
  return { singles, clusters };
}

export function layoutMap(input: MapLayoutInput): MapLayout {
  const fit: LatLng[] = [];
  if (input.fitTo && input.fitTo.length > 0) fit.push(...input.fitTo);
  else {
    for (const m of input.markers) fit.push(m.coord);
    for (const l of input.polylines) for (const c of l.coords) fit.push(c);
    if (input.user) fit.push(input.user.coord);
  }
  const proj = makeProjection(fit, input.size, input.pad ?? DEFAULT_MAP_PAD, input.minSpanDeg ?? MIN_SPAN_DEG);

  const base: (MapMarkerInput & XY)[] = [];
  const clusterable: (MapMarkerInput & XY)[] = [];
  for (const m of input.markers) {
    const xy = project(proj, m.coord);
    (m.kind === 'base' ? base : clusterable).push({ ...m, ...xy });
  }
  const { singles, clusters } = clusterMarkers(clusterable, input.clusterPx ?? DEFAULT_CLUSTER_PX);

  const user = input.user
    ? {
        ...project(proj, input.user.coord),
        radiusPx: metersToPx(proj, input.user.accuracyM ?? ARRIVAL_ACCURACY_M * 2),
        faint: input.user.accuracyM == null || input.user.accuracyM > ARRIVAL_ACCURACY_M,
      }
    : undefined;

  return {
    projected: [...base, ...singles],
    clusters,
    lines: input.polylines.map((l) => ({
      id: l.id,
      color: l.color,
      dashed: !!l.dashed,
      points: l.coords.map((c) => project(proj, c)),
    })),
    dots: (input.dots ?? []).map((d) => ({ ...d, ...project(proj, d.coord) })),
    user,
    projection: proj,
  };
}
