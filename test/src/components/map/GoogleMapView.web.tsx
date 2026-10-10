/// <reference types="google.maps" />
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { GOOGLE_MAPS_API_KEY } from '../../config';
import { ARRIVAL_ACCURACY_M } from '../../core/constants';
import {
  clusterMemberIds,
  clusterName,
  DEFAULT_MAP_CENTER,
  dotsKey,
  FIT_MAX_ZOOM,
  fitCoords,
  fitKey,
  FOCUS_MAX_ZOOM,
  focusPadding,
  GROUP_LIST_ZOOM,
  mapPadding,
  markersKey,
  pinName,
  polylinesKey,
  userName,
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
import { googleScriptUrl } from './googleScript';
import { ClusterListSheet, FitAllButton, MapChildren, mapHeight, type MapCanvasProps, type MapFailReason } from './parts';

/**
 * 구글 지도(웹, WP5 소유). Maps JavaScript API를 스크립트로 한 번 불러와 MapCanvas와 같은 props를 그린다.
 * - 바탕: mapId 없이 GOOGLE_MAP_STYLE(무채색). mapId를 쓰면 스타일이 무시된다.
 * - 핀·묶음·현재 위치·이동 점: OverlayView 한 장에 div로 얹는다. 그림은 ui/mapPinSvg(기본 지도와 같은 모양)다.
 *   노드는 id로 붙잡아 두고 위치만 옮긴다. 다시 만들지 않으므로 키보드 포커스와 누르는 중인 핀이 유지된다.
 *   묶음은 지금 배율의 화면 좌표로 core/map/layout.clusterMarkers를 돌려 만든다. 배율이 바뀌면 다시 묶는다.
 * - 선: google.maps.Polyline. 점선은 짧은 선 기호를 11px마다 찍어 '6 5' 점선과 맞춘다. 선 내용이 바뀔 때만 다시 만든다.
 * - 정확도 원: 50m를 넘거나 모를 때만 미터 반경 원(google.maps.Circle)을 두른다.
 * - 처음, 마커·선이 바뀔 때, 지도 크기가 바뀔 때(사용자가 움직이지 않았으면) 화면을 맞춘다.
 *   현재 위치가 움직일 때는 다시 맞추지 않는다(core/map/engine.fitCoords).
 *   끌거나 확대하면 '전체 보기'가 뜬다. 묶음을 누르면 그 자리로 당기고, 충분히 당겼는데도 묶여 있으면 목록을 띄운다.
 * - 손짓: 화면 가득한 지도(flat)는 한 손가락으로 움직이고, 스크롤 화면 안의 지도는 cooperative(두 손가락·Ctrl+휠)라
 *   페이지 스크롤을 가로채지 않는다. 미리보기(compact)는 움직이지 않고 묶음도 누를 수 없다.
 * - 지도를 눌러 고르기(onPressMap)는 300ms 기다렸다 보낸다. 더블클릭 확대가 장소 고르기가 되지 않게 한다.
 * - 실패: 키 거부(gm_authFailure)와 스크립트 실패는 세션 전체를, 타일 시한 초과는 이 지도 하나만 기본 지도로 바꾼다.
 *   타일 시한(TILE_TIMEOUT_MS)은 문서가 보이고 지도 칸에 크기가 있을 때만 흐른다. 숨은 탭·display:none 화면에서는 멈춘다.
 *   타일 요청이 네트워크에서 실패해도 구글은 tilesloaded를 보낸다(2026-10 확인). 그때는 회색 바탕 위에 핀·선이 그대로 보이고,
 *   시한은 tilesloaded가 아예 오지 않는 경우(인증 콜백 없는 거부, 그려지지 못하는 지도)만 잡는다.
 * 구글 로고와 약관 표기는 가리지 않는다. 하단 시트가 덮는 높이(overlayBottom)만큼 지도 영역을 줄이고 '전체 보기'를 로고 위로 올린다.
 */

type MapsWindow = Window & { __ytGoogleMapsReady?: () => void; gm_authFailure?: () => void };

const CALLBACK = '__ytGoogleMapsReady';
/** 지도가 보이기 시작한 뒤 첫 타일이 이 안에 안 오면 못 불러온 것으로 본다 */
const TILE_TIMEOUT_MS = 10_000;
/** 지도 클릭을 고르기로 보내기 전에 더블클릭인지 기다리는 시간 */
const CLICK_DELAY_MS = 300;
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
    const s = document.createElement('script');
    s.src = googleScriptUrl(GOOGLE_MAPS_API_KEY, CALLBACK);
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

type ItemKind = 'dot' | 'base' | 'pin' | 'cluster' | 'user';
/** 겹칠 때 위에 오는 순서. 이동 점은 아래 판(누르지 않음)에 따로 둔다 */
const Z: Record<ItemKind, number> = { dot: 0, base: 1, pin: 2, cluster: 3, user: 4 };

interface OverlayItem {
  key: string;
  kind: ItemKind;
  spec: PinSpec;
  xy: XY;
  /** 없으면 장식이다(이동 점). 화면 읽기에서 숨긴다 */
  name?: string;
  press?: () => void;
}

interface OverlayNode {
  el: HTMLElement;
  sig: string;
  size: number;
}

/** 핀 노드 하나. 누를 수 있으면 버튼(Enter·Space도 받음), 이름만 있으면 그림, 둘 다 없으면 화면 읽기에서 숨긴다 */
function createNode(libs: Libs, it: OverlayItem, sig: string, press: () => void): OverlayNode {
  const { html, size } = mapPinSvg(it.spec);
  const el = document.createElement('div');
  el.innerHTML = html;
  el.style.position = 'absolute';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.zIndex = String(Z[it.kind]);
  if (it.press) {
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', it.name ?? '');
    el.tabIndex = 0;
    el.title = it.name ?? '';
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      press();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        press();
      }
    });
    // 핀을 눌렀을 때 지도 클릭(지도에서 선택)이나 끌기가 같이 일어나지 않게 한다
    libs.maps.OverlayView.preventMapHitsAndGesturesFrom(el);
  } else {
    el.style.pointerEvents = 'none';
    if (it.name) {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', it.name);
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
  }
  return { el, sig, size };
}

function createPinLayer(libs: Libs, on: LayerHandlers) {
  const GLatLng = libs.core.LatLng;
  class PinLayer extends libs.maps.OverlayView {
    data: LayerData = { markers: [], dots: [], compact: false, clusterPx: DEFAULT_CLUSTER_PX, pressable: false };
    /** 이동 점(누르지 않음) */
    under = document.createElement('div');
    /** 핀·묶음·현재 위치 */
    over = document.createElement('div');
    nodes = new Map<string, OverlayNode>();
    /** 노드는 그대로 두고 누를 때 할 일만 매번 갈아 끼운다(묶음 좌표는 그릴 때마다 바뀐다) */
    presses = new Map<string, () => void>();

    onAdd() {
      const panes = this.getPanes();
      panes?.overlayLayer.appendChild(this.under);
      panes?.overlayMouseTarget.appendChild(this.over);
      // 사용자가 직접(Tab·클릭) 다른 핀으로 옮기면 따라가던 핀은 잊는다
      this.over.addEventListener('focusin', (e) => {
        if (e.target !== this.autoFocused) this.wanted = undefined;
      });
    }

    onRemove() {
      this.under.remove();
      this.over.remove();
      this.nodes.clear();
      this.presses.clear();
    }

    setData(d: LayerData) {
      this.data = d;
      this.draw();
    }

    items(proj: google.maps.MapCanvasProjection): OverlayItem[] {
      const at = (c: LatLng): XY | null => {
        const p = proj.fromLatLngToDivPixel(new GLatLng(c.latitude, c.longitude));
        return p ? { x: p.x, y: p.y } : null;
      };
      const d = this.data;
      const out: OverlayItem[] = [];
      for (const dot of d.dots) {
        const p = at(dot.coord);
        if (p) out.push({ key: `d:${dot.id}`, kind: 'dot', spec: { kind: 'dot', tone: dot.tone, size: dot.size }, xy: p });
      }
      const base: (MapMarkerInput & XY)[] = [];
      const rest: (MapMarkerInput & XY)[] = [];
      for (const m of d.markers) {
        const p = at(m.coord);
        if (p) (m.kind === 'base' ? base : rest).push({ ...m, ...p });
      }
      const { singles, clusters } = clusterMarkers(rest, d.clusterPx);
      for (const m of base) {
        out.push({ key: `m:${m.id}`, kind: 'base', spec: { kind: 'base', compact: d.compact }, xy: m, name: pinName(m) });
      }
      for (const m of singles) {
        const spec: PinSpec =
          m.kind === 'excluded'
            ? { kind: 'excluded', label: m.label, compact: d.compact }
            : { kind: 'spot', label: m.label, color: m.color, compact: d.compact };
        out.push({
          key: `m:${m.id}`,
          kind: 'pin',
          spec,
          xy: m,
          name: pinName(m),
          press: d.pressable ? () => on.marker(m.id) : undefined,
        });
      }
      // 미리보기(compact)는 움직일 수 없으므로 묶음도 누르지 않는다(당겨 놓고 돌아올 방법이 없다)
      const clusterPressable = !d.compact;
      for (const c of clusters) {
        out.push({
          key: `c:${c.id}`,
          kind: 'cluster',
          spec: { kind: 'cluster', count: c.count, compact: d.compact },
          xy: c,
          name: clusterName(c.count, clusterPressable),
          press: clusterPressable ? () => on.cluster(c) : undefined,
        });
      }
      if (d.user) {
        const p = at(d.user.coord);
        if (p) out.push({ key: 'user', kind: 'user', spec: { kind: 'user', compact: d.compact }, xy: p, name: userName(d.user.faint) });
      }
      return out;
    }

    draw() {
      const proj = this.getProjection();
      if (!proj) return;
      const items = this.items(proj);
      const seen = new Set<string>();
      this.presses.clear();
      for (const it of items) {
        seen.add(it.key);
        if (it.press) this.presses.set(it.key, it.press);
        const sig = `${JSON.stringify(it.spec)}|${it.name ?? ''}|${it.press ? 1 : 0}`;
        let node = this.nodes.get(it.key);
        if (!node || node.sig !== sig) {
          const hadFocus = !!node && node.el === document.activeElement;
          node?.el.remove();
          const key = it.key;
          node = createNode(libs, it, sig, () => this.presses.get(key)?.());
          this.nodes.set(key, node);
          (it.kind === 'dot' ? this.under : this.over).appendChild(node.el);
          if (hadFocus) node.el.focus();
        }
        node.el.style.left = `${it.xy.x - node.size / 2}px`;
        node.el.style.top = `${it.xy.y - node.size / 2}px`;
      }
      for (const [key, node] of this.nodes) {
        if (seen.has(key)) continue;
        // 사용자가 포커스를 둔 핀이 사라지면(묶음에 들어감, 묶음이 풀림) 그 핀을 기억해 두고 따라간다
        if (node.el === document.activeElement && !this.wanted) this.wanted = key;
        node.el.remove();
        this.nodes.delete(key);
      }
      if (this.wanted) this.follow();
    }

    /** 사용자가 포커스를 둔 핀의 키. 그 핀이 묶음에 들어가면 묶음에, 다시 나오면 그 핀에 포커스를 둔다 */
    wanted: string | undefined;
    /** 코드가 옮겨 준 포커스 노드. 이 노드 말고 다른 곳에 포커스가 가면 사용자가 옮긴 것이다 */
    autoFocused: HTMLElement | undefined;

    focusNode(el: HTMLElement) {
      this.autoFocused = el;
      el.focus();
    }

    follow() {
      const want = this.wanted;
      if (!want) return;
      const active = document.activeElement;
      // 사용자가 지도 밖으로 포커스를 옮겼으면 따라가지 않는다
      if (active && active !== document.body && !this.over.contains(active)) {
        this.wanted = undefined;
        return;
      }
      const exact = this.nodes.get(want);
      if (exact && this.presses.has(want)) {
        if (active !== exact.el) this.focusNode(exact.el);
        this.wanted = undefined;
        return;
      }
      if (want.startsWith('m:')) {
        // 핀이 묶음에 들어갔으면 그 묶음에 둔다. 묶음이 풀리면 위에서 원래 핀으로 돌아온다
        const id = want.slice(2);
        for (const [key, n] of this.nodes) {
          if (key.startsWith('c:') && this.presses.has(key) && clusterMemberIds(key.slice(2)).includes(id)) {
            if (active !== n.el) this.focusNode(n.el);
            return;
          }
        }
        return;
      }
      if (want.startsWith('c:')) {
        // 사용자가 둔 묶음이 풀리면 그 묶음의 첫 스팟으로
        for (const id of clusterMemberIds(want.slice(2))) {
          const n = this.nodes.get(`m:${id}`);
          if (n && this.presses.has(`m:${id}`)) {
            this.focusNode(n.el);
            this.wanted = undefined;
            return;
          }
        }
      }
      this.wanted = undefined;
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
  /** 지도를 만들 때 붙인 감시(타일 시한, 화면 크기, 손짓, 클릭 지연)를 떼는 함수들 */
  cleanups: (() => void)[];
}

/** 확대·이동 키. 지도 키보드 단축키와 같다 */
const MOVE_KEYS = new Set(['+', '-', '=', '_', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * 사용자가 지도를 직접 움직였는지는 손짓으로만 판단한다. 배율 변화(zoom_changed)는 코드가 맞출 때도 생기고,
 * 늦게 뜨는 지도(시트 안)에서는 fitBounds가 나중에 적용돼 사용자 조작과 구별할 수 없다.
 * 끌기는 지도의 dragstart로 따로 받는다.
 */
function bindGestures(el: HTMLElement, onMove: () => void, cooperative: boolean): () => void {
  // cooperative 지도는 Ctrl(맥은 Cmd)+휠만 확대하고, 그냥 휠은 페이지를 스크롤한다
  const onWheel = (e: WheelEvent) => {
    if (!cooperative || e.ctrlKey || e.metaKey) onMove();
  };
  const onDbl = () => onMove();
  const onTouch = (e: TouchEvent) => {
    if (e.touches.length > 1) onMove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (MOVE_KEYS.has(e.key)) onMove();
  };
  el.addEventListener('wheel', onWheel, { passive: true });
  el.addEventListener('dblclick', onDbl);
  el.addEventListener('touchstart', onTouch, { passive: true });
  el.addEventListener('keydown', onKey);
  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('dblclick', onDbl);
    el.removeEventListener('touchstart', onTouch);
    el.removeEventListener('keydown', onKey);
  };
}

/** 지금 이 지도 칸이 그려질 수 있는가(문서가 보이고 칸에 크기가 있다). display:none 조상이 있으면 크기가 0이다 */
function canRender(el: HTMLElement): boolean {
  return document.visibilityState === 'visible' && el.offsetWidth > 0 && el.offsetHeight > 0;
}

/**
 * 첫 타일 시한. 그려질 수 있을 때만 시간이 흐르고, 숨으면 멈췄다가 다시 보이면 남은 시간부터 잇는다.
 * resume은 화면 크기 감시에서도 부른다.
 */
function watchTiles(map: google.maps.Map, el: HTMLElement, onTimeout: () => void): { resume: () => void; stop: () => void } {
  let remaining = TILE_TIMEOUT_MS;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
    remaining -= performance.now() - startedAt;
  };
  const resume = () => {
    if (done) return;
    if (!canRender(el)) {
      pause();
      return;
    }
    if (timer) return;
    startedAt = performance.now();
    timer = setTimeout(() => {
      timer = undefined;
      done = true;
      onTimeout();
    }, Math.max(0, remaining));
  };
  const onVisibility = () => resume();
  document.addEventListener('visibilitychange', onVisibility);
  const loaded = google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
    done = true;
    pause();
  });
  resume();
  return {
    resume,
    stop: () => {
      done = true;
      pause();
      document.removeEventListener('visibilitychange', onVisibility);
      loaded.remove();
    },
  };
}

export function GoogleMapView(props: MapCanvasProps & { onFail: (reason: MapFailReason) => void }) {
  const host = useRef<View>(null);
  const st = useRef<MapState>({ lines: [], cleanups: [] });
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [moved, setMovedState] = useState(false);
  const movedRef = useRef(false);
  const setMoved = (v: boolean) => {
    movedRef.current = v;
    setMovedState(v);
  };
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

  // 화면이 다시 그려질 때마다 새 배열이 와도 내용이 같으면 지도는 그대로 둔다
  const polyKey = useMemo(() => polylinesKey(props.polylines), [props.polylines]);
  const markKey = useMemo(() => markersKey(props.markers), [props.markers]);
  const dotKey = useMemo(() => dotsKey(props.dots ?? []), [props.dots]);
  const userLat = props.user?.coord.latitude;
  const userLng = props.user?.coord.longitude;
  const userAcc = props.user?.accuracyM;

  const hostEl = () => host.current as unknown as HTMLElement | null;
  const hostSize = () => {
    const el = hostEl();
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
  };

  /** 맞춘 화면이 자리 잡으면(idle) 배율 한도를 넘었는지 보고 되돌린다 */
  const settle = (maxZoom: number) => {
    const map = st.current.map;
    if (!map) return;
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom);
    });
  };

  const fit = () => {
    const s = st.current;
    const map = s.map;
    if (!map || !s.libs) return;
    const coords = fitRef.current;
    const p = latest.current;
    if (coords.length === 0) {
      map.setCenter(toG(DEFAULT_MAP_CENTER));
      map.setZoom(13);
    } else if (coords.length === 1) {
      map.setCenter(toG(coords[0]));
      map.setZoom(FIT_MAX_ZOOM);
    } else {
      const b = new s.libs.core.LatLngBounds();
      for (const c of coords) b.extend(toG(c));
      map.fitBounds(b, mapPadding(hostSize(), { compact: p.compact, flat: p.flat }));
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
    map.fitBounds(b, focusPadding(hostSize()));
    settle(FOCUS_MAX_ZOOM);
    setMoved(true);
  };

  // 지도는 한 번만 만든다. 바뀌는 값은 latest로 읽는다.
  useEffect(() => {
    let alive = true;
    const s = st.current;
    const fail = (reason: MapFailReason) => {
      if (alive) latest.current.onFail(reason);
    };
    const onAuthFail = () => fail('auth');
    if (authFailed) {
      fail('auth');
      return;
    }
    authListeners.add(onAuthFail);
    loadLibs()
      .then((libs) => {
        const el = hostEl();
        if (!alive || !el) return;
        const p = latest.current;
        const map = new libs.maps.Map(el, {
          center: toG(DEFAULT_MAP_CENTER),
          zoom: 13,
          disableDefaultUI: true,
          clickableIcons: false,
          keyboardShortcuts: !p.compact,
          gestureHandling: p.compact ? 'none' : p.flat ? 'greedy' : 'cooperative',
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
        s.cleanups.push(bindGestures(el, () => setMoved(true), !p.compact && !p.flat));

        const tiles = watchTiles(map, el, () => {
          console.warn('구글 지도 타일을 받지 못해 이 지도를 기본 지도로 바꿔요(키·결제·API 사용 설정·하루 한도 확인)');
          fail('tiles');
        });
        s.cleanups.push(tiles.stop);

        // 크기가 바뀌면(창 폭, 시트 높이, 숨었다 다시 보임) 타일 시한을 다시 판단하고, 사용자가 움직이지 않았으면 다시 맞춘다
        let lastW = el.clientWidth;
        let lastH = el.clientHeight;
        let refit: ReturnType<typeof setTimeout> | undefined;
        const ro = new ResizeObserver(() => {
          tiles.resume();
          const w = el.clientWidth;
          const h = el.clientHeight;
          if (w === lastW && h === lastH) return;
          lastW = w;
          lastH = h;
          if (w === 0 || h === 0 || movedRef.current) return;
          clearTimeout(refit);
          refit = setTimeout(fit, 120);
        });
        ro.observe(el);
        s.cleanups.push(() => {
          ro.disconnect();
          clearTimeout(refit);
        });

        // 지도 고르기는 더블클릭(확대)이 아닐 때만 보낸다
        let clickTimer: ReturnType<typeof setTimeout> | undefined;
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          const at = e.latLng;
          if (!at || !latest.current.onPressMap) return;
          const coord = { latitude: at.lat(), longitude: at.lng() };
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => latest.current.onPressMap?.(coord), CLICK_DELAY_MS);
        });
        map.addListener('dblclick', () => clearTimeout(clickTimer));
        s.cleanups.push(() => clearTimeout(clickTimer));

        setReady(true);
      })
      .catch(() => fail('script'));
    return () => {
      alive = false;
      authListeners.delete(onAuthFail);
      for (const f of s.cleanups) f();
      s.cleanups = [];
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

  // 선: 내용이 바뀔 때만 다시 만든다
  useEffect(() => {
    const s = st.current;
    const { map, libs } = s;
    if (!ready || !map || !libs) return;
    for (const l of s.lines) l.setMap(null);
    s.lines = latest.current.polylines.map(
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
  }, [ready, polyKey, compact]);

  // 핀·이동 점·현재 위치·정확도 원: 내용이나 현재 위치 값이 바뀔 때만 다시 그린다
  const pressable = !!props.onMarkerPress;
  useEffect(() => {
    const s = st.current;
    const { map, libs, layer } = s;
    if (!ready || !map || !libs || !layer) return;
    const p = latest.current;
    const u = p.user;
    const faint = !!u && (u.accuracyM == null || u.accuracyM > ARRIVAL_ACCURACY_M);
    layer.setData({
      markers: p.markers,
      dots: p.dots ?? [],
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
  }, [ready, markKey, dotKey, userLat, userLng, userAcc, compact, pressable]);

  // 처음과 마커·선이 바뀔 때 화면을 맞춘다. 크기 변화는 ResizeObserver가 맡는다
  useEffect(() => {
    if (ready) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

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

/** 웹은 키만 있으면 구글 지도를 그릴 수 있다(앱은 빌드에 키가 들어갔는지 따로 본다) */
export const GOOGLE_VIEW_READY = true;
