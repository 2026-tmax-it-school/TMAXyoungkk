import { clusterName, pinName, userName } from '../../core/map/engine';
import { clusterMarkers, type MapCluster, type MapDotInput, type MapMarkerInput, type XY } from '../../core/map/layout';
import type { LatLng } from '../../types';
import { mapPinSvg, type PinSpec } from '../../ui/mapPinSvg';

/**
 * 지도 SDK 위에 얹는 핀 목록(카카오 웹·앱 어댑터가 같이 쓴다, 그리기 없음).
 * 묶음은 지금 배율의 화면 좌표(pointOf)로 core/map/layout.clusterMarkers를 돌려 만든다. 우리 묶음 규칙이다(SDK 클러스터러 아님).
 * 묶음 자리는 구성 스팟 좌표의 평균이다. 화면 좌표를 다시 위경도로 되돌리지 않아도 된다.
 */

export type ItemKind = 'dot' | 'base' | 'pin' | 'cluster' | 'user';
/** 겹칠 때 위에 오는 순서 */
export const OVERLAY_Z: Record<ItemKind, number> = { dot: 1, base: 2, pin: 3, cluster: 4, user: 5 };

export interface LayerData {
  markers: MapMarkerInput[];
  dots: MapDotInput[];
  user?: { coord: LatLng; faint: boolean };
  compact: boolean;
  clusterPx: number;
  pressable: boolean;
}

export type OverlayAction = { type: 'marker'; id: string } | { type: 'cluster'; cluster: MapCluster };

export interface OverlayItem {
  key: string;
  kind: ItemKind;
  spec: PinSpec;
  coord: LatLng;
  /** 없으면 장식이다(이동 점). 화면 읽기에서 숨긴다 */
  name?: string;
  /** 없으면 누를 수 없다 */
  action?: OverlayAction;
}

export function centroid(cs: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const c of cs) {
    lat += c.latitude;
    lng += c.longitude;
  }
  return { latitude: lat / cs.length, longitude: lng / cs.length };
}

/** pointOf가 null을 주는 마커(아직 투영 전)는 그리지 않는다. 이동 점과 현재 위치는 화면 좌표가 필요 없다 */
export function buildOverlayItems(d: LayerData, pointOf: (m: MapMarkerInput, index: number) => XY | null): OverlayItem[] {
  const out: OverlayItem[] = [];
  for (const dot of d.dots) {
    out.push({ key: `d:${dot.id}`, kind: 'dot', spec: { kind: 'dot', tone: dot.tone, size: dot.size }, coord: dot.coord });
  }
  const rest: (MapMarkerInput & XY)[] = [];
  d.markers.forEach((m, i) => {
    if (m.kind === 'base') {
      out.push({ key: `m:${m.id}`, kind: 'base', spec: { kind: 'base', compact: d.compact }, coord: m.coord, name: pinName(m) });
      return;
    }
    const p = pointOf(m, i);
    if (p) rest.push({ ...m, ...p });
  });
  const { singles, clusters } = clusterMarkers(rest, d.clusterPx);
  for (const m of singles) {
    const spec: PinSpec =
      m.kind === 'excluded'
        ? { kind: 'excluded', label: m.label, compact: d.compact }
        : { kind: 'spot', label: m.label, color: m.color, compact: d.compact };
    out.push({
      key: `m:${m.id}`,
      kind: 'pin',
      spec,
      coord: m.coord,
      name: pinName(m),
      action: d.pressable ? { type: 'marker', id: m.id } : undefined,
    });
  }
  // 미리보기(compact)는 움직일 수 없으므로 묶음도 누르지 않는다(당겨 놓고 돌아올 방법이 없다)
  const clusterPressable = !d.compact;
  for (const c of clusters) {
    out.push({
      key: `c:${c.id}`,
      kind: 'cluster',
      spec: { kind: 'cluster', count: c.count, compact: d.compact },
      coord: centroid(c.coords),
      name: clusterName(c.count, clusterPressable),
      action: clusterPressable ? { type: 'cluster', cluster: c } : undefined,
    });
  }
  if (d.user) {
    out.push({ key: 'user', kind: 'user', spec: { kind: 'user', compact: d.compact }, coord: d.user.coord, name: userName(d.user.faint) });
  }
  return out;
}

/** 모양·이름·누를 수 있음이 같으면 같은 값. 같으면 노드를 다시 만들지 않고 자리만 옮긴다 */
export function itemSig(it: OverlayItem): string {
  return `${JSON.stringify(it.spec)}|${it.name ?? ''}|${it.action ? 1 : 0}`;
}

/** 앱 WebView로 보내는 핀 하나. 그림은 ui/mapPinSvg 문자열이다 */
export interface WireItem {
  key: string;
  sig: string;
  z: number;
  html: string;
  size: number;
  name?: string;
  press: boolean;
  at: [number, number];
}

export function toWireItem(it: OverlayItem): WireItem {
  const { html, size } = mapPinSvg(it.spec);
  return {
    key: it.key,
    sig: itemSig(it),
    z: OVERLAY_Z[it.kind],
    html,
    size,
    name: it.name,
    press: !!it.action,
    at: [it.coord.latitude, it.coord.longitude],
  };
}
