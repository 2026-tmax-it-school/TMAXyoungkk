import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { KAKAO_MAP_JS_KEY } from '../../config';
import { ARRIVAL_ACCURACY_M } from '../../core/constants';
import {
  clusterMemberIds,
  DEFAULT_MAP_CENTER,
  dotsKey,
  FIT_MAX_ZOOM,
  fitCoords,
  fitKey,
  FOCUS_MAX_ZOOM,
  focusPadding,
  GROUP_LIST_ZOOM,
  kakaoLevel,
  mapPadding,
  markersKey,
  polylinesKey,
} from '../../core/map/engine';
import { DEFAULT_CLUSTER_PX, type MapCluster } from '../../core/map/layout';
import type { LatLng } from '../../types';
import { lineC, mapC, mapPinSvg, R } from '../../ui';
import { KAKAO_CLICK_DELAY_MS, KAKAO_LOAD_TIMEOUT_MS, KAKAO_TILE_TIMEOUT_MS, kakaoScriptUrl, wheelZoomStep } from './kakaoScript';
import { buildOverlayItems, itemSig, OVERLAY_Z, type LayerData, type OverlayItem } from './overlayItems';
import { ClusterListSheet, FitAllButton, MapChildren, mapHeight, type MapFailReason, type MapViewProps } from './parts';

/**
 * 카카오 지도(웹, WP5 소유). 카카오맵 JavaScript SDK를 autoload=false로 한 번 불러와(kakao.maps.load) MapCanvas와 같은 props를 그린다.
 * 앱은 KakaoMapView.tsx(WebView 안의 같은 SDK)다.
 * - 바탕: 카카오 기본 일반 지도. 카카오는 구글 JSON 스타일 같은 바탕 색 바꾸기가 없어 무채색 바탕이 아니다(README 한계).
 * - 핀·묶음·현재 위치·이동 점: 항목마다 CustomOverlay 하나에 div를 얹는다. 그림은 ui/mapPinSvg(기본 지도와 같은 모양)다.
 *   노드는 key로 붙잡아 두고 자리만 옮긴다. 다시 만들지 않으므로 키보드 포커스와 누르는 중인 핀이 유지된다.
 *   묶음은 지금 레벨의 화면 좌표로 core/map/layout.clusterMarkers를 돌려 만든다(카카오 클러스터러를 쓰지 않는다). 레벨이 바뀌면 다시 묶는다.
 * - 선: kakao.maps.Polyline. 점선은 strokeStyle 'shortdash'다. 선 내용이 바뀔 때만 다시 만든다.
 * - 정확도 원: 50m를 넘거나 모를 때만 미터 반경 원(kakao.maps.Circle)을 두른다.
 * - 화면 맞춤: LatLngBounds + setBounds(여백 위·오른쪽·아래·왼쪽, core/map/engine.mapPadding). 배율 한도는 kakaoLevel로 바꾼다.
 *   처음, 마커·선이 바뀔 때, 지도 크기가 바뀔 때(relayout 뒤, 사용자가 움직이지 않았으면) 맞춘다.
 * - 손짓: 화면 가득한 지도(flat)는 끌기·휠 확대. 스크롤 화면 안의 지도는 끌기와 두 손가락·더블클릭 확대만 되고 그냥 휠은 페이지를 스크롤한다.
 *   Ctrl(맥은 Cmd)+휠이면 직접 레벨을 바꾼다(구글 cooperative와 같은 약속). 미리보기(compact)는 움직이지 않고 묶음도 누를 수 없다.
 * - 지도를 눌러 고르기(onPressMap)는 300ms 기다렸다 보낸다. 더블클릭 확대가 장소 고르기가 되지 않게 한다.
 * - 실패: SDK 스크립트를 못 받으면 script, kakao.maps.load 콜백이 시한 안에 안 오면 auth(앱 키 거부·도메인 미등록이면
 *   SDK가 지도 코드를 주지 않는다)로 세션 전체를, 첫 타일 시한 초과(tiles)는 이 지도 하나만 기본 지도로 바꾼다.
 *   타일 시한은 문서가 보이고 지도 칸에 크기가 있을 때만 흐른다.
 * - 내 위치(center): 첫 요청은 거리 단위 레벨(LOCATE_ZOOM)까지 당기며 setCenter, 따라가기는 panTo로 옮긴다. 옮긴 뒤 '전체 보기'를 띄운다.
 *   손으로 끌기·확대·'전체 보기'는 onUserMove로 알려 따라가기를 푼다. 따라가기 중(holdFit)에는 루트 전체로 다시 맞추지 않는다.
 * 카카오 로고·축척은 가리지 않는다. 하단 시트가 덮는 높이(overlayBottom)만큼 지도 영역을 줄이고 '전체 보기'를 로고 위로 올린다.
 */

/* ---------- 쓰는 만큼만 적은 카카오 SDK 타입 ---------- */

interface KLatLng {
  getLat(): number;
  getLng(): number;
}
interface KPoint {
  x: number;
  y: number;
}
interface KBounds {
  extend(p: KLatLng): void;
}
interface KProjection {
  containerPointFromCoords(p: KLatLng): KPoint;
  coordsFromContainerPoint(p: KPoint): KLatLng;
}
interface KMap {
  setCenter(p: KLatLng): void;
  panTo(p: KLatLng): void;
  setLevel(level: number, opts?: { anchor?: KLatLng; animate?: boolean }): void;
  getLevel(): number;
  panBy(dx: number, dy: number): void;
  setBounds(b: KBounds, top?: number, right?: number, bottom?: number, left?: number): void;
  getProjection(): KProjection;
  relayout(): void;
  setDraggable(v: boolean): void;
  setZoomable(v: boolean): void;
}
interface KOverlay {
  setMap(m: KMap | null): void;
  setPosition(p: KLatLng): void;
}
interface KCircle extends KOverlay {
  setRadius(r: number): void;
}
interface KMouseEvent {
  latLng: KLatLng;
}
interface KakaoMaps {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => KLatLng;
  LatLngBounds: new () => KBounds;
  Point: new (x: number, y: number) => KPoint;
  Map: new (el: HTMLElement, o: Record<string, unknown>) => KMap;
  CustomOverlay: new (o: Record<string, unknown>) => KOverlay;
  Polyline: new (o: Record<string, unknown>) => KOverlay;
  Circle: new (o: Record<string, unknown>) => KCircle;
  event: {
    addListener(target: unknown, type: string, fn: (e: KMouseEvent) => void): void;
    removeListener(target: unknown, type: string, fn: (e: KMouseEvent) => void): void;
  };
}
type KakaoWindow = Window & { kakao?: { maps?: KakaoMaps } };

let loader: Promise<KakaoMaps> | undefined;

class LoadError extends Error {
  readonly reason: 'auth' | 'script';
  constructor(reason: 'auth' | 'script') {
    super(reason === 'auth' ? '카카오 지도 키가 거부됐어요' : '카카오 지도 스크립트를 받지 못했어요');
    this.reason = reason;
  }
}

/** SDK를 한 번만 받는다. 실패하면 다음 지도가 다시 시도할 수 있게 비운다 */
function loadKakao(): Promise<KakaoMaps> {
  if (loader) return loader;
  loader = new Promise<KakaoMaps>((resolve, reject) => {
    const win = window as KakaoWindow;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    const afterScript = () => {
      const maps = win.kakao?.maps;
      if (!maps || typeof maps.load !== 'function') {
        done(() => reject(new LoadError('script')));
        return;
      }
      // 앱 키가 거부되거나 이 도메인이 등록되지 않았으면 load 콜백이 오지 않는다
      timer = setTimeout(() => reject(new LoadError('auth')), KAKAO_LOAD_TIMEOUT_MS);
      maps.load(() => done(() => resolve(maps)));
    };
    if (win.kakao?.maps) {
      afterScript();
      return;
    }
    const s = document.createElement('script');
    s.src = kakaoScriptUrl(KAKAO_MAP_JS_KEY);
    s.async = true;
    s.onload = afterScript;
    s.onerror = () => {
      s.remove();
      reject(new LoadError('script'));
    };
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    loader = undefined;
    throw e;
  });
  return loader;
}

/** 키 거부는 세션 동안 기억한다(다른 화면이 다시 시한을 기다리지 않게) */
let authFailed = false;

interface OverlayNode {
  ov: KOverlay;
  el: HTMLElement;
  sig: string;
}

/** 핀 노드 하나. 누를 수 있으면 버튼(Enter·Space도 받음), 이름만 있으면 그림, 둘 다 없으면 화면 읽기에서 숨긴다 */
function createNode(it: OverlayItem, press: () => void): HTMLElement {
  const { html, size } = mapPinSvg(it.spec);
  const el = document.createElement('div');
  el.innerHTML = html;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  if (it.action) {
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
  } else {
    el.style.pointerEvents = 'none';
    if (it.name) {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', it.name);
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
  }
  return el;
}

/**
 * 핀 판. 항목마다 CustomOverlay를 두고 key로 다시 쓴다. 사용자가 포커스를 둔 핀이 묶음에 들어가면 묶음에,
 * 묶음이 풀리면 첫 스팟에 포커스를 옮긴다(구글 웹 어댑터와 같은 규칙).
 */
function createPinLayer(K: KakaoMaps, map: KMap, on: { marker: (id: string) => void; cluster: (c: MapCluster) => void }) {
  const nodes = new Map<string, OverlayNode>();
  const actions = new Map<string, () => void>();
  let data: LayerData = { markers: [], dots: [], compact: false, clusterPx: DEFAULT_CLUSTER_PX, pressable: false };
  let wanted: string | undefined;
  let autoFocused: HTMLElement | undefined;
  const ll = (c: LatLng) => new K.LatLng(c.latitude, c.longitude);
  const mine = (el: Element | null) => !!el && [...nodes.values()].some((n) => n.el === el);

  const focusNode = (el: HTMLElement) => {
    autoFocused = el;
    el.focus();
  };

  const follow = () => {
    const want = wanted;
    if (!want) return;
    const active = document.activeElement;
    if (active && active !== document.body && !mine(active)) {
      wanted = undefined;
      return;
    }
    const exact = nodes.get(want);
    if (exact && actions.has(want)) {
      if (active !== exact.el) focusNode(exact.el);
      wanted = undefined;
      return;
    }
    if (want.startsWith('m:')) {
      const id = want.slice(2);
      for (const [key, n] of nodes) {
        if (key.startsWith('c:') && actions.has(key) && clusterMemberIds(key.slice(2)).includes(id)) {
          if (active !== n.el) focusNode(n.el);
          return;
        }
      }
      return;
    }
    if (want.startsWith('c:')) {
      for (const id of clusterMemberIds(want.slice(2))) {
        const n = nodes.get(`m:${id}`);
        if (n && actions.has(`m:${id}`)) {
          focusNode(n.el);
          wanted = undefined;
          return;
        }
      }
    }
    wanted = undefined;
  };

  const draw = () => {
    const proj = map.getProjection();
    const list = buildOverlayItems(data, (m) => {
      const p = proj.containerPointFromCoords(ll(m.coord));
      return p ? { x: p.x, y: p.y } : null;
    });
    const seen = new Set<string>();
    actions.clear();
    for (const it of list) {
      seen.add(it.key);
      const a = it.action;
      if (a) actions.set(it.key, a.type === 'marker' ? () => on.marker(a.id) : () => on.cluster(a.cluster));
      const sig = itemSig(it);
      let node = nodes.get(it.key);
      if (node && node.sig !== sig) {
        const hadFocus = node.el === document.activeElement;
        node.ov.setMap(null);
        nodes.delete(it.key);
        node = undefined;
        if (hadFocus && !wanted) wanted = it.key;
      }
      if (!node) {
        const key = it.key;
        const el = createNode(it, () => actions.get(key)?.());
        el.addEventListener('focusin', () => {
          if (el !== autoFocused) wanted = undefined;
        });
        const ov = new K.CustomOverlay({ position: ll(it.coord), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: OVERLAY_Z[it.kind], clickable: !!a });
        ov.setMap(map);
        nodes.set(key, { ov, el, sig });
      } else {
        node.ov.setPosition(ll(it.coord));
      }
    }
    for (const [key, node] of nodes) {
      if (seen.has(key)) continue;
      if (node.el === document.activeElement && !wanted) wanted = key;
      node.ov.setMap(null);
      nodes.delete(key);
    }
    if (wanted) follow();
  };

  return {
    setData(d: LayerData) {
      data = d;
      draw();
    },
    draw,
    clear() {
      for (const n of nodes.values()) n.ov.setMap(null);
      nodes.clear();
      actions.clear();
    },
  };
}

interface MapState {
  K?: KakaoMaps;
  map?: KMap;
  layer?: ReturnType<typeof createPinLayer>;
  lines: KOverlay[];
  ring?: KCircle;
  cleanups: (() => void)[];
}

/** 지금 이 지도 칸이 그려질 수 있는가(문서가 보이고 칸에 크기가 있다) */
function canRender(el: HTMLElement): boolean {
  return document.visibilityState === 'visible' && el.offsetWidth > 0 && el.offsetHeight > 0;
}

/** 첫 타일 시한. 그려질 수 있을 때만 시간이 흐른다(0.5초 단위로 센다) */
function watchTiles(K: KakaoMaps, map: KMap, el: HTMLElement, onTimeout: () => void): () => void {
  let waited = 0;
  let done = false;
  const onLoaded = () => {
    done = true;
  };
  K.event.addListener(map, 'tilesloaded', onLoaded);
  const tick = setInterval(() => {
    if (done) {
      clearInterval(tick);
      return;
    }
    if (canRender(el)) waited += 500;
    if (waited >= KAKAO_TILE_TIMEOUT_MS) {
      done = true;
      clearInterval(tick);
      onTimeout();
    }
  }, 500);
  return () => {
    done = true;
    clearInterval(tick);
    K.event.removeListener(map, 'tilesloaded', onLoaded);
  };
}

/** 키보드 이동 한 번의 거리(픽셀) */
const KEY_PAN_PX = 80;
/** 확대·이동 키. 이동은 [dx, dy], 확대·축소는 레벨 변화 */
const MOVE_KEYS: Record<string, { pan?: [number, number]; level?: number }> = {
  ArrowUp: { pan: [0, -KEY_PAN_PX] },
  ArrowDown: { pan: [0, KEY_PAN_PX] },
  ArrowLeft: { pan: [-KEY_PAN_PX, 0] },
  ArrowRight: { pan: [KEY_PAN_PX, 0] },
  '+': { level: -1 },
  '=': { level: -1 },
  '-': { level: 1 },
  _: { level: 1 },
};
const clampLevel = (l: number) => Math.min(14, Math.max(1, l));

/**
 * 사용자가 지도를 직접 움직였는지는 손짓으로만 판단한다(레벨 변화는 코드가 맞출 때도 생긴다). 끌기는 dragstart로 따로 받는다.
 * 스크롤 화면 안의 지도(cooperative)는 SDK 휠 확대를 끄고, Ctrl·Cmd+휠일 때만 여기서 커서 자리를 기준으로 바꾼다.
 * 트랙패드 핀치는 작은 휠 이벤트가 잇달아 오므로 양을 쌓아 일정량마다 한 단계씩 움직인다(wheelZoomStep).
 * 키보드: SDK 단축키는 끄고 여기서 지도(또는 안의 핀)에 포커스가 있을 때만 방향키로 옮기고 +·- 키로 확대·축소한다(구글 keyboardShortcuts와 같은 몫).
 */
function bindGestures(K: KakaoMaps, map: KMap, el: HTMLElement, onMove: () => void, cooperative: boolean): () => void {
  let wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    if (!cooperative) {
      onMove();
      return;
    }
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = wheelZoomStep(wheelAcc, e.deltaY, e.deltaMode);
    wheelAcc = r.acc;
    if (r.step === 0) return;
    const box = el.getBoundingClientRect();
    const anchor = map.getProjection().coordsFromContainerPoint(new K.Point(e.clientX - box.left, e.clientY - box.top));
    const next = clampLevel(map.getLevel() + r.step);
    if (next === map.getLevel()) return;
    map.setLevel(next, { anchor });
    onMove();
  };
  const onDbl = () => onMove();
  const onTouch = (e: TouchEvent) => {
    if (e.touches.length > 1) onMove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = MOVE_KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    if (k.pan) map.panBy(k.pan[0], k.pan[1]);
    else if (k.level) {
      const next = clampLevel(map.getLevel() + k.level);
      if (next === map.getLevel()) return;
      map.setLevel(next);
    }
    onMove();
  };
  // 핀이 없는 지도도 키보드로 닿게 지도 칸 자체를 포커스할 수 있게 한다
  el.tabIndex = 0;
  el.setAttribute('aria-label', '지도. 방향키로 옮기고 +, - 키로 확대하거나 축소해요');
  el.addEventListener('wheel', onWheel, { passive: !cooperative });
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

export function KakaoMapView(props: MapViewProps & { onFail: (reason: MapFailReason) => void }) {
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
  /** 사용자가 손으로 움직였다. 코드가 옮길 때(fit·center)는 부르지 않는다 */
  const userMoved = () => {
    setMoved(true);
    latest.current.onUserMove?.();
  };
  const [group, setGroup] = useState<string[] | undefined>(undefined);
  const height = mapHeight(props);
  const compact = !!props.compact;
  const bottomCover = props.overlayBottom ?? 0;

  // 내 위치 버튼의 점(locateUser)은 맞춤에 넣지 않는다
  const hasUser = !!props.user && !props.locateUser;
  const fitList = useMemo(
    () => fitCoords({ markers: props.markers, polylines: props.polylines, fitTo: props.fitTo, user: latest.current.locateUser ? undefined : latest.current.user }),
    // 현재 위치가 움직여도 다시 맞추지 않는다. 있고 없고만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.markers, props.polylines, props.fitTo, hasUser],
  );
  const key = fitKey(fitList);
  const fitRef = useRef(fitList);
  fitRef.current = fitList;

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

  /** 좌표 목록에 맞춘다. 카카오 레벨은 작을수록 가깝다. maxLevel보다 더 당기지 않는다 */
  const fitTo = (coords: LatLng[], pad: { top: number; right: number; bottom: number; left: number }, maxZoom: number) => {
    const { K, map } = st.current;
    if (!K || !map) return;
    const ll = (c: LatLng) => new K.LatLng(c.latitude, c.longitude);
    const maxLevel = kakaoLevel(maxZoom);
    map.relayout();
    if (coords.length === 0) {
      map.setCenter(ll(DEFAULT_MAP_CENTER));
      map.setLevel(kakaoLevel(13));
    } else if (coords.length === 1) {
      map.setCenter(ll(coords[0]));
      map.setLevel(maxLevel);
    } else {
      const b = new K.LatLngBounds();
      for (const c of coords) b.extend(ll(c));
      map.setBounds(b, pad.top, pad.right, pad.bottom, pad.left);
      if (map.getLevel() < maxLevel) map.setLevel(maxLevel);
    }
    st.current.layer?.draw();
  };

  const fit = () => {
    const p = latest.current;
    fitTo(fitRef.current, mapPadding(hostSize(), { compact: p.compact, flat: p.flat }), FIT_MAX_ZOOM);
    setMoved(false);
  };

  const focusCluster = (c: MapCluster) => {
    const map = st.current.map;
    if (!map) return;
    if (map.getLevel() <= kakaoLevel(GROUP_LIST_ZOOM) && latest.current.onMarkerPress) {
      setGroup(c.memberIds);
      return;
    }
    const pad = focusPadding(hostSize());
    fitTo(c.coords, { top: pad, right: pad, bottom: pad, left: pad }, FOCUS_MAX_ZOOM);
    userMoved();
  };

  // 지도는 한 번만 만든다. 바뀌는 값은 latest로 읽는다.
  useEffect(() => {
    let alive = true;
    const s = st.current;
    const fail = (reason: MapFailReason) => {
      if (alive) latest.current.onFail(reason);
    };
    if (authFailed) {
      fail('auth');
      return;
    }
    loadKakao()
      .then((K) => {
        const host = hostEl();
        if (!alive || !host) return;
        // SDK가 컨테이너에 position 등 인라인 스타일을 넣어도 RN 칸(절대 배치)이 흔들리지 않게 안쪽 div에 지도를 띄운다
        const el = document.createElement('div');
        el.style.width = '100%';
        el.style.height = '100%';
        host.appendChild(el);
        s.cleanups.push(() => el.remove());
        const p = latest.current;
        const flat = !!p.flat;
        const map = new K.Map(el, {
          center: new K.LatLng(DEFAULT_MAP_CENTER.latitude, DEFAULT_MAP_CENTER.longitude),
          level: kakaoLevel(13),
          draggable: !p.compact,
          // 스크롤 화면 안에서는 그냥 휠이 페이지를 스크롤한다. Ctrl·Cmd+휠은 bindGestures가 맡는다
          scrollwheel: !p.compact && flat,
          disableDoubleClickZoom: !!p.compact,
          keyboardShortcuts: false,
        });
        if (p.compact) map.setZoomable(false);
        s.K = K;
        s.map = map;
        const layer = createPinLayer(K, map, {
          marker: (id) => latest.current.onMarkerPress?.(id),
          cluster: (c) => focusCluster(c),
        });
        s.layer = layer;

        // 레벨이 바뀌면 화면 좌표가 바뀌므로 다시 묶는다
        const redraw = () => layer.draw();
        K.event.addListener(map, 'zoom_changed', redraw);
        K.event.addListener(map, 'idle', redraw);
        const onDrag = () => userMoved();
        K.event.addListener(map, 'dragstart', onDrag);
        if (!p.compact) s.cleanups.push(bindGestures(K, map, el, () => userMoved(), !flat));
        s.cleanups.push(() => {
          K.event.removeListener(map, 'zoom_changed', redraw);
          K.event.removeListener(map, 'idle', redraw);
          K.event.removeListener(map, 'dragstart', onDrag);
        });

        s.cleanups.push(
          watchTiles(K, map, el, () => {
            console.warn('카카오 지도 타일을 받지 못해 이 지도를 기본 지도로 바꿔요(JavaScript 키·Web 도메인 등록 확인)');
            fail('tiles');
          }),
        );

        // 크기가 바뀌면(창 폭, 시트 높이, 숨었다 다시 보임) relayout하고, 사용자가 움직이지 않았으면 다시 맞춘다
        let lastW = el.clientWidth;
        let lastH = el.clientHeight;
        let refit: ReturnType<typeof setTimeout> | undefined;
        const ro = new ResizeObserver(() => {
          const w = el.clientWidth;
          const h = el.clientHeight;
          if (w === lastW && h === lastH) return;
          lastW = w;
          lastH = h;
          if (w === 0 || h === 0) return;
          map.relayout();
          if (movedRef.current) return;
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
        const onClick = (e: KMouseEvent) => {
          if (!latest.current.onPressMap) return;
          const coord = { latitude: e.latLng.getLat(), longitude: e.latLng.getLng() };
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => latest.current.onPressMap?.(coord), KAKAO_CLICK_DELAY_MS);
        };
        const onDbl = () => clearTimeout(clickTimer);
        K.event.addListener(map, 'click', onClick);
        K.event.addListener(map, 'dblclick', onDbl);
        s.cleanups.push(() => {
          clearTimeout(clickTimer);
          K.event.removeListener(map, 'click', onClick);
          K.event.removeListener(map, 'dblclick', onDbl);
        });

        setReady(true);
      })
      .catch((e: unknown) => {
        const reason = e instanceof LoadError ? e.reason : 'script';
        if (reason === 'auth') {
          authFailed = true;
          console.warn('카카오 지도를 불러오지 못했어요(JavaScript 키, 플랫폼 Web 도메인 등록 확인)');
        }
        fail(reason);
      });
    return () => {
      alive = false;
      for (const f of s.cleanups) f();
      s.cleanups = [];
      s.layer?.clear();
      for (const l of s.lines) l.setMap(null);
      s.ring?.setMap(null);
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
    const { map, K } = s;
    if (!ready || !map || !K) return;
    for (const l of s.lines) l.setMap(null);
    s.lines = latest.current.polylines.map(
      (l) =>
        new K.Polyline({
          map,
          path: l.coords.map((c) => new K.LatLng(c.latitude, c.longitude)),
          strokeWeight: compact ? 3 : 4,
          strokeColor: mapC[l.color],
          strokeOpacity: 1,
          strokeStyle: l.dashed ? 'shortdash' : 'solid',
        }),
    );
  }, [ready, polyKey, compact]);

  // 핀·이동 점·현재 위치·정확도 원: 내용이나 현재 위치 값이 바뀔 때만 다시 그린다
  const pressable = !!props.onMarkerPress;
  useEffect(() => {
    const s = st.current;
    const { map, K, layer } = s;
    if (!ready || !map || !K || !layer) return;
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
      const center = new K.LatLng(u.coord.latitude, u.coord.longitude);
      const radius = u.accuracyM ?? ARRIVAL_ACCURACY_M * 2;
      if (!s.ring) {
        s.ring = new K.Circle({ map, center, radius, strokeWeight: 0, strokeOpacity: 0, fillColor: mapC.user, fillOpacity: 0.14 });
      } else {
        s.ring.setPosition(center);
        s.ring.setRadius(radius);
      }
    } else if (s.ring) {
      s.ring.setMap(null);
      s.ring = undefined;
    }
  }, [ready, markKey, dotKey, userLat, userLng, userAcc, compact, pressable]);

  // 처음과 마커·선이 바뀔 때 화면을 맞춘다. 크기 변화는 ResizeObserver가 맡는다. 따라가기 중에는 맞추지 않는다
  useEffect(() => {
    if (ready && !latest.current.holdFit) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  // 내 위치로 옮기기. 요청(seq)마다 한 번. 첫 요청만 당기고(이미 더 가까우면 그대로) 따라가기는 부드럽게 옮긴다
  const centerSeq = props.center?.seq;
  useEffect(() => {
    const { K, map, layer } = st.current;
    const c = latest.current.center;
    if (!ready || !K || !map || !c) return;
    const at = new K.LatLng(c.coord.latitude, c.coord.longitude);
    map.relayout();
    if (c.zoom != null) {
      const level = kakaoLevel(c.zoom);
      if (map.getLevel() > level) map.setLevel(level);
      map.setCenter(at);
    } else {
      map.panTo(at);
    }
    layer?.draw();
    setMoved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, centerSeq]);

  const titleOf = useMemo(() => new Map(props.markers.map((m) => [m.id, m.title])), [props.markers]);

  return (
    <View
      accessibilityLabel={`지도 · 마커 ${props.markers.length}개`}
      style={[
        { height, overflow: 'hidden', backgroundColor: mapC.bg },
        props.flat ? null : { borderRadius: R.card, borderWidth: 1, borderColor: lineC.line },
      ]}
    >
      <View ref={host} style={[styles.host, { bottom: bottomCover }]} />
      {moved && !compact ? (
        <FitAllButton
          overlayBottom={bottomCover + 24}
          onPress={() => {
            fit();
            latest.current.onUserMove?.();
          }}
        />
      ) : null}
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

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, top: 0 },
});

/** 웹은 키만 있으면 카카오 지도를 그릴 수 있다 */
export const KAKAO_VIEW_READY = true;
