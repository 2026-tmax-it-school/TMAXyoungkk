/// <reference types="google.maps" />
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { GOOGLE_MAPS_API_KEY } from '../../config';
import { ARRIVAL_ACCURACY_M } from '../../core/constants';
import {
  DEFAULT_MAP_CENTER,
  FIT_MAX_ZOOM,
  fitCoords,
  fitKey,
  FOCUS_MAX_ZOOM,
  GROUP_LIST_ZOOM,
} from '../../core/map/engine';
import {
  clusterMarkers,
  DEFAULT_CLUSTER_PX,
  type MapCluster,
  type MapDotInput,
  type MapMarkerInput,
  type XY,
} from '../../core/map/layout';
import type { LatLng } from '../../types';
import { GOOGLE_MAP_STYLE, lineC, mapC, mapPinSvg, R, type PinSpec } from '../../ui';
import { ClusterListSheet, FitAllButton, MapChildren, mapHeight, type MapCanvasProps } from './parts';

/**
 * 구글 지도(웹, WP5 소유). Maps JavaScript API를 스크립트로 한 번 불러와 MapCanvas와 같은 props를 그린다.
 * - 바탕: mapId 없이 GOOGLE_MAP_STYLE(무채색). mapId를 쓰면 스타일이 무시된다.
 * - 핀·묶음·현재 위치·이동 점: OverlayView 한 장에 div로 얹는다. 그림은 ui/mapPinSvg(기본 지도와 같은 모양)다.
 *   묶음은 지금 배율의 화면 좌표로 core/map/layout.clusterMarkers를 돌려 만든다. 배율이 바뀌면 다시 묶는다.
 * - 선: google.maps.Polyline. 점선은 짧은 선 기호를 11px마다 찍어 '6 5' 점선과 맞춘다.
 * - 정확도 원: 50m를 넘거나 모를 때만 미터 반경 원(google.maps.Circle)을 두른다.
 * - 처음과 마커·선이 바뀔 때 화면을 맞춘다. 현재 위치가 움직일 때는 다시 맞추지 않는다(core/map/engine.fitCoords).
 *   끌거나 확대하면 '전체 보기'가 뜬다. 묶음을 누르면 그 자리로 당기고, 충분히 당겼는데도 묶여 있으면 목록을 띄운다.
 * - 키가 거부되거나(gm_authFailure) 스크립트를 못 받거나 바탕 타일이 TILE_TIMEOUT_MS 안에 안 오면 onFail로 기본 지도에 넘긴다.
 *   타일 시한은 인증 콜백이 오지 않는 오류(ApiProjectMapError 등)와 끊긴 망을 잡는다.
 * 구글 로고와 약관 표기는 가리지 않는다. 하단 시트가 덮는 높이(overlayBottom)만큼 지도 영역을 줄이고 '전체 보기'를 로고 위로 올린다.
 */

type MapsWindow = Window & { __ytGoogleMapsReady?: () => void; gm_authFailure?: () => void };

const CALLBACK = '__ytGoogleMapsReady';
/** 지도를 만든 뒤 첫 타일이 이 안에 안 오면 못 불러온 것으로 본다 */
const TILE_TIMEOUT_MS = 10_000;
let loader: Promise<void> | undefined;
let authFailed = false;
const authListeners = new Set<() => void>();

function loadScript(): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    if (typeof google !== 'undefined' && typeof google.maps?.importLibrary === 'function') {
      resolve();
      return;
    }
    const win = window as MapsWindow;
    win[CALLBACK] = () => resolve();
    // 키가 거부되면 구글이 이 전역 함수를 부른다. 지도가 회색 오류 화면이 되므로 기본 지도로 넘긴다.
    win.gm_authFailure = () => {
      authFailed = true;
      for (const f of authListeners) f();
    };
    const q = new URLSearchParams({ v: 'weekly', language: 'ko', region: 'KR', loading: 'async', callback: CALLBACK });
    if (GOOGLE_MAPS_API_KEY) q.set('key', GOOGLE_MAPS_API_KEY);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${q.toString()}`;
    s.async = true;
    s.onerror = () => {
      loader = undefined;
      s.remove();
      reject(new Error('구글 지도 스크립트를 받지 못했어요'));
    };
    document.head.appendChild(s);
  });
  return loader;
}

interface Libs {
  maps: google.maps.MapsLibrary;
  core: google.maps.CoreLibrary;
}

async function loadLibs(): Promise<Libs> {
  await loadScript();
  const [maps, core] = await Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('core')]);
  return { maps: maps as google.maps.MapsLibrary, core: core as google.maps.CoreLibrary };
}

const toG = (c: LatLng): google.maps.LatLngLiteral => ({ lat: c.latitude, lng: c.longitude });

interface LayerData {
  markers: MapMarkerInput[];
  dots: MapDotInput[];
  user?: { coord: LatLng; faint: boolean };
  compact: boolean;
  clusterPx: number;
  pressable: boolean;
}

interface LayerHandlers {
  marker: (id: string) => void;
  cluster: (c: MapCluster) => void;
}

/** 핀 하나. 누를 수 있으면 버튼(Enter·Space도 받음), 아니면 그림이다. */
function pinEl(libs: Libs, spec: PinSpec, p: XY, name: string, onPress?: () => void): HTMLElement {
  const { html, size } = mapPinSvg(spec);
  const el = document.createElement('div');
  el.innerHTML = html;
  el.style.position = 'absolute';
  el.style.left = `${p.x - size / 2}px`;
  el.style.top = `${p.y - size / 2}px`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.setAttribute('aria-label', name);
  if (onPress) {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = name;
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onPress();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPress();
      }
    });
    // 핀을 눌렀을 때 지도 클릭(지도에서 선택)이나 끌기가 같이 일어나지 않게 한다
    libs.maps.OverlayView.preventMapHitsAndGesturesFrom(el);
  } else {
    el.setAttribute('role', 'img');
    el.style.pointerEvents = 'none';
  }
  return el;
}

function createPinLayer(libs: Libs, on: LayerHandlers) {
  const GLatLng = libs.core.LatLng;
  class PinLayer extends libs.maps.OverlayView {
    data: LayerData = { markers: [], dots: [], compact: false, clusterPx: DEFAULT_CLUSTER_PX, pressable: false };
    /** 이동 점(누르지 않음) */
    under = document.createElement('div');
    /** 핀·묶음·현재 위치 */
    over = document.createElement('div');

    onAdd() {
      const panes = this.getPanes();
      panes?.overlayLayer.appendChild(this.under);
      panes?.overlayMouseTarget.appendChild(this.over);
    }

    onRemove() {
      this.under.remove();
      this.over.remove();
    }

    setData(d: LayerData) {
      this.data = d;
      this.draw();
    }

    draw() {
      const proj = this.getProjection();
      if (!proj) return;
      const at = (c: LatLng): XY | null => {
        const p = proj.fromLatLngToDivPixel(new GLatLng(c.latitude, c.longitude));
        return p ? { x: p.x, y: p.y } : null;
      };
      const d = this.data;
      const under: HTMLElement[] = [];
      const over: HTMLElement[] = [];
      for (const dot of d.dots) {
        const p = at(dot.coord);
        if (p) under.push(pinEl(libs, { kind: 'dot', tone: dot.tone, size: dot.size }, p, '이동 지점'));
      }
      const base: (MapMarkerInput & XY)[] = [];
      const rest: (MapMarkerInput & XY)[] = [];
      for (const m of d.markers) {
        const p = at(m.coord);
        if (p) (m.kind === 'base' ? base : rest).push({ ...m, ...p });
      }
      const { singles, clusters } = clusterMarkers(rest, d.clusterPx);
      for (const m of base) over.push(pinEl(libs, { kind: 'base', compact: d.compact }, m, `기점 ${m.title}`));
      for (const m of singles) {
        const spec: PinSpec =
          m.kind === 'excluded'
            ? { kind: 'excluded', label: m.label, compact: d.compact }
            : { kind: 'spot', label: m.label, color: m.color, compact: d.compact };
        const name = m.kind === 'excluded' ? `제외 스팟 ${m.title}` : m.label ? `${m.label}번 ${m.title}` : m.title;
        over.push(pinEl(libs, spec, m, name, d.pressable ? () => on.marker(m.id) : undefined));
      }
      for (const c of clusters) {
        over.push(
          pinEl(libs, { kind: 'cluster', count: c.count, compact: d.compact }, c, `${c.count}곳 묶음 · 눌러서 확대`, () => on.cluster(c)),
        );
      }
      if (d.user) {
        const p = at(d.user.coord);
        if (p) over.push(pinEl(libs, { kind: 'user', compact: d.compact }, p, d.user.faint ? '현재 위치(정확도 낮음)' : '현재 위치'));
      }
      this.under.replaceChildren(...under);
      this.over.replaceChildren(...over);
    }
  }
  return new PinLayer();
}

interface MapState {
  libs?: Libs;
  map?: google.maps.Map;
  layer?: ReturnType<typeof createPinLayer>;
  lines: google.maps.Polyline[];
  ring?: google.maps.Circle;
  /** 코드가 화면을 옮기는 중이면 배율 변화를 '사용자가 움직임'으로 치지 않는다 */
  programmatic: boolean;
  tileTimer?: ReturnType<typeof setTimeout>;
}

export function GoogleMapView(props: MapCanvasProps & { onFail: () => void }) {
  const host = useRef<View>(null);
  const st = useRef<MapState>({ lines: [], programmatic: false });
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [moved, setMoved] = useState(false);
  const [group, setGroup] = useState<string[] | undefined>(undefined);
  const height = mapHeight(props);
  const compact = !!props.compact;
  const bottomCover = props.overlayBottom ?? 0;

  const hasUser = !!props.user;
  const fitList = useMemo(
    () => fitCoords({ markers: props.markers, polylines: props.polylines, fitTo: props.fitTo, user: latest.current.user }),
    // 현재 위치가 움직여도 다시 맞추지 않는다. 있고 없고만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.markers, props.polylines, props.fitTo, hasUser],
  );
  const key = fitKey(fitList);
  const fitRef = useRef(fitList);
  fitRef.current = fitList;

  /** 끝날 때까지 기다렸다가 배율 한도를 넘었으면 되돌린다. idle이 안 오면 1.5초 뒤에 풀어 준다 */
  const settle = (maxZoom: number) => {
    const s = st.current;
    const map = s.map;
    if (!map) return;
    const done = setTimeout(() => {
      s.programmatic = false;
    }, 1500);
    google.maps.event.addListenerOnce(map, 'idle', () => {
      clearTimeout(done);
      if ((map.getZoom() ?? 0) > maxZoom) {
        map.setZoom(maxZoom);
        settle(maxZoom);
        return;
      }
      s.programmatic = false;
    });
  };

  const fit = () => {
    const s = st.current;
    const map = s.map;
    if (!map || !s.libs) return;
    const coords = fitRef.current;
    const p = latest.current;
    const pad = p.compact ? 16 : 40;
    s.programmatic = true;
    if (coords.length === 0) {
      map.setCenter(toG(DEFAULT_MAP_CENTER));
      map.setZoom(13);
    } else if (coords.length === 1) {
      map.setCenter(toG(coords[0]));
      map.setZoom(FIT_MAX_ZOOM);
    } else {
      const b = new s.libs.core.LatLngBounds();
      for (const c of coords) b.extend(toG(c));
      // 11·13은 위에 칩·안내 카드가 떠 있어 위쪽을 더 비운다
      map.fitBounds(b, { top: p.flat ? 96 : pad, right: pad, bottom: pad, left: pad });
    }
    settle(FIT_MAX_ZOOM);
    setMoved(false);
  };

  const focusCluster = (c: MapCluster) => {
    const s = st.current;
    const map = s.map;
    if (!map || !s.libs) return;
    if ((map.getZoom() ?? 0) >= GROUP_LIST_ZOOM && latest.current.onMarkerPress) {
      setGroup(c.memberIds);
      return;
    }
    const b = new s.libs.core.LatLngBounds();
    for (const x of c.coords) b.extend(toG(x));
    s.programmatic = true;
    map.fitBounds(b, 80);
    settle(FOCUS_MAX_ZOOM);
    setMoved(true);
  };

  // 지도는 한 번만 만든다. 바뀌는 값은 latest로 읽는다.
  useEffect(() => {
    let alive = true;
    const s = st.current;
    const fail = () => {
      if (alive) latest.current.onFail();
    };
    if (authFailed) {
      fail();
      return;
    }
    authListeners.add(fail);
    loadLibs()
      .then((libs) => {
        const el = host.current as unknown as HTMLElement | null;
        if (!alive || !el) return;
        const map = new libs.maps.Map(el, {
          center: toG(DEFAULT_MAP_CENTER),
          zoom: 13,
          disableDefaultUI: true,
          clickableIcons: false,
          keyboardShortcuts: !compact,
          gestureHandling: compact ? 'none' : 'greedy',
          styles: GOOGLE_MAP_STYLE,
          backgroundColor: mapC.bg,
        });
        s.libs = libs;
        s.map = map;
        const layer = createPinLayer(libs, {
          marker: (id) => latest.current.onMarkerPress?.(id),
          cluster: (c) => focusCluster(c),
        });
        layer.setMap(map);
        s.layer = layer;
        map.addListener('dragstart', () => setMoved(true));
        map.addListener('zoom_changed', () => {
          if (!s.programmatic) setMoved(true);
        });
        const tileTimer = setTimeout(() => {
          console.warn('구글 지도 타일을 받지 못해 기본 지도로 바꿔요(키·결제·API 사용 설정 확인)');
          fail();
        }, TILE_TIMEOUT_MS);
        google.maps.event.addListenerOnce(map, 'tilesloaded', () => clearTimeout(tileTimer));
        s.tileTimer = tileTimer;
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          const at = e.latLng;
          if (at) latest.current.onPressMap?.({ latitude: at.lat(), longitude: at.lng() });
        });
        setReady(true);
      })
      .catch(fail);
    return () => {
      alive = false;
      authListeners.delete(fail);
      clearTimeout(s.tileTimer);
      s.layer?.setMap(null);
      for (const l of s.lines) l.setMap(null);
      s.ring?.setMap(null);
      if (s.map) google.maps.event.clearInstanceListeners(s.map);
      s.map = undefined;
      s.layer = undefined;
      s.lines = [];
      s.ring = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선·핀·정확도 원
  const pressable = !!props.onMarkerPress;
  useEffect(() => {
    const s = st.current;
    const { map, libs, layer } = s;
    if (!ready || !map || !libs || !layer) return;
    for (const l of s.lines) l.setMap(null);
    s.lines = props.polylines.map(
      (l) =>
        new libs.maps.Polyline({
          map,
          path: l.coords.map(toG),
          clickable: false,
          strokeColor: mapC[l.color],
          strokeOpacity: l.dashed ? 0 : 1,
          strokeWeight: compact ? 3 : 4,
          icons: l.dashed
            ? [
                {
                  icon: { path: 'M 0,-1 0,1', strokeColor: mapC[l.color], strokeOpacity: 1, strokeWeight: compact ? 3 : 3.4, scale: 3 },
                  offset: '0',
                  repeat: '11px',
                },
              ]
            : undefined,
        }),
    );
    const u = props.user;
    const faint = !!u && (u.accuracyM == null || u.accuracyM > ARRIVAL_ACCURACY_M);
    layer.setData({
      markers: props.markers,
      dots: props.dots ?? [],
      user: u ? { coord: u.coord, faint } : undefined,
      compact,
      clusterPx: compact ? 18 : DEFAULT_CLUSTER_PX,
      pressable,
    });
    if (u && faint) {
      if (!s.ring) {
        s.ring = new libs.maps.Circle({ map, clickable: false, fillColor: mapC.user, fillOpacity: 0.14, strokeOpacity: 0 });
      }
      s.ring.setCenter(toG(u.coord));
      s.ring.setRadius(u.accuracyM ?? ARRIVAL_ACCURACY_M * 2);
    } else if (s.ring) {
      s.ring.setMap(null);
      s.ring = undefined;
    }
  }, [ready, props.markers, props.polylines, props.dots, props.user, compact, pressable]);

  // 처음, 마커·선이 바뀔 때, 높이가 바뀔 때 화면을 맞춘다
  useEffect(() => {
    if (ready) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, height, bottomCover]);

  const titleOf = useMemo(() => new Map(props.markers.map((m) => [m.id, m.title])), [props.markers]);

  return (
    <View
      accessibilityLabel={`지도 · 마커 ${props.markers.length}개`}
      style={[
        { height, overflow: 'hidden', backgroundColor: mapC.bg },
        props.flat ? null : { borderRadius: R.card, borderWidth: 1, borderColor: lineC.line },
      ]}
    >
      <View ref={host} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: bottomCover }} />
      {moved && !compact ? <FitAllButton overlayBottom={bottomCover + 24} onPress={fit} /> : null}
      <ClusterListSheet
        memberIds={group}
        titleOf={titleOf}
        onClose={() => setGroup(undefined)}
        onPick={(id) => latest.current.onMarkerPress?.(id)}
      />
      <MapChildren>{props.children}</MapChildren>
    </View>
  );
}
