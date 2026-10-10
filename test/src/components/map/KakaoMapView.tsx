import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { KAKAO_MAP_JS_KEY } from '../../config';
import { ARRIVAL_ACCURACY_M } from '../../core/constants';
import {
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
import { lineC, mapC, R } from '../../ui';
import {
  bridgeScript,
  buildKakaoHtml,
  isKakaoBridgeUrl,
  KAKAO_WEBVIEW_BASE_URL,
  KAKAO_WEBVIEW_ORIGINS,
  kakaoNavAction,
  parseKakaoOut,
  type KakaoInMsg,
  type LL,
} from './kakaoHtml';
import { KAKAO_CLICK_DELAY_MS, KAKAO_LOAD_TIMEOUT_MS, KAKAO_TILE_TIMEOUT_MS } from './kakaoScript';
import { buildOverlayItems, toWireItem, type OverlayItem } from './overlayItems';
import { ClusterListSheet, FitAllButton, MapChildren, mapHeight, type MapFailReason, type MapViewProps } from './parts';

/**
 * 카카오 지도(앱, WP5 소유). react-native-webview 안에서 웹과 같은 카카오맵 JavaScript SDK를 띄운다. 웹은 KakaoMapView.web.tsx다.
 * - 페이지는 kakaoHtml.buildKakaoHtml이 만들고 baseUrl을 https://localhost로 준다. 카카오가 SDK 요청 출처를 앱 키의
 *   플랫폼 Web 도메인과 맞춰 보므로 콘솔에 https://localhost를 등록해야 한다.
 * - 바깥 이동: 카카오 로고·저작권 링크 같은 맨 위 문서 이동은 지도 칸을 바꾸지 않고 바깥 브라우저로 연다(kakaoNavAction).
 *   다리 페이지가 아닌 문서에서 온 메시지는 버린다.
 * - 복구: 페이지가 다시 뜨면(ready가 또 오면) 선·핀·맞춤을 모두 다시 보낸다. iOS 웹 프로세스가 죽으면 다시 읽고,
 *   안드로이드 렌더러가 죽으면 WebView를 새로 만든다(앱이 같이 죽지 않게). 거듭 죽으면 그 지도만 기본 지도로 돌린다.
 * - 다리: 앱에서 페이지로는 injectJavaScript(bridgeScript), 페이지에서 앱으로은 postMessage(parseKakaoOut).
 *   핀은 페이지가 보내는 화면 좌표(view)로 여기서 묶고(overlayItems, core/map/layout) 그림 문자열(ui/mapPinSvg)을 보낸다.
 * - 화면 맞춤 여백·배율 한도는 웹·구글과 같은 core/map/engine 값이고 배율은 kakaoLevel로 바꾼다.
 * - 실패: SDK 스크립트 못 받음(script), 지도 코드가 시한 안에 안 옴(auth, 키 거부·도메인 미등록), 첫 타일 시한 초과(tiles),
 *   WebView 자체 오류(script). MapCanvas가 기본 지도로 돌린다.
 * - 손짓: 미리보기(compact)는 움직이지 않는다. 그 밖은 한 손가락 끌기·두 손가락 확대다.
 * - 내 위치(center): 다리 메시지 center로 페이지가 옮긴다(첫 요청은 LOCATE_ZOOM 레벨까지 당김, 따라가기는 panTo).
 *   페이지의 moved(손짓)와 '전체 보기'는 onUserMove로 알려 따라가기를 푼다. 따라가기 중(holdFit)에는 루트 전체로 다시 맞추지 않는다.
 */

export { KAKAO_WEBVIEW_BASE_URL };

/** 렌더러가 죽었을 때 WebView를 새로 만드는 최대 횟수. 넘으면 그 지도만 기본 지도로 돌린다 */
const MAX_REMOUNTS = 2;

/** 맨 위 문서 이동 요청: 다리 페이지만 띄우고 바깥 링크는 바깥 브라우저로 연다 */
function onNav(req: { url: string; isTopFrame?: boolean }): boolean {
  const a = kakaoNavAction(req.url, req.isTopFrame ?? true);
  if (a === 'open') Linking.openURL(req.url).catch(() => {});
  return a === 'allow';
}

const toLL = (c: LatLng): LL => [c.latitude, c.longitude];

export function KakaoMapView(props: MapViewProps & { onFail: (reason: MapFailReason) => void }) {
  const web = useRef<WebView>(null);
  const latest = useRef(props);
  latest.current = props;
  /** 페이지가 ready를 보낸 횟수. 0이면 아직 안 떴다. 다시 뜰 때마다 늘어 모든 내용을 다시 보낸다 */
  const [ready, setReady] = useState(0);
  /** WebView를 새로 만든 횟수(key) */
  const [gen, setGen] = useState(0);
  const [moved, setMoved] = useState(false);
  const [group, setGroup] = useState<string[] | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const height = mapHeight(props);
  const compact = !!props.compact;
  const bottomCover = props.overlayBottom ?? 0;
  /** 페이지가 마지막으로 알려 준 레벨과 마커 화면 좌표(markers 순서) */
  const view = useRef<{ level: number; points: (LL | null)[]; forKey: string }>({ level: 7, points: [], forKey: '' });
  const items = useRef<Map<string, OverlayItem>>(new Map());

  // 페이지는 처음 한 번만 만든다. 미리보기 여부는 지도마다 고정이다.
  const html = useMemo(
    () =>
      buildKakaoHtml({
        appKey: KAKAO_MAP_JS_KEY,
        bg: mapC.bg,
        compact,
        center: toLL(DEFAULT_MAP_CENTER),
        level: kakaoLevel(13),
        loadTimeoutMs: KAKAO_LOAD_TIMEOUT_MS,
        tileTimeoutMs: KAKAO_TILE_TIMEOUT_MS,
        clickDelayMs: KAKAO_CLICK_DELAY_MS,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const send = (m: KakaoInMsg) => web.current?.injectJavaScript(bridgeScript(m));

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
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const fit = () => {
    const p = latest.current;
    send({ t: 'fit', coords: fitRef.current.map(toLL), pad: mapPadding(sizeRef.current, { compact: p.compact, flat: p.flat }), maxLevel: kakaoLevel(FIT_MAX_ZOOM) });
    setMoved(false);
  };

  const markKey = useMemo(() => markersKey(props.markers), [props.markers]);
  const polyKey = useMemo(() => polylinesKey(props.polylines), [props.polylines]);
  const dotKey = useMemo(() => dotsKey(props.dots ?? []), [props.dots]);
  const userLat = props.user?.coord.latitude;
  const userLng = props.user?.coord.longitude;
  const userAcc = props.user?.accuracyM;
  const pressable = !!props.onMarkerPress;

  /** 마지막 화면 좌표로 핀을 다시 묶어 보낸다. 마커가 바뀌어 좌표가 낡았으면 마커 좌표부터 보내고 view를 기다린다 */
  const pushItems = () => {
    const p = latest.current;
    const mk = markersKey(p.markers);
    if (view.current.forKey !== mk) {
      view.current = { ...view.current, points: [], forKey: mk };
      send({ t: 'markers', coords: p.markers.map((m) => toLL(m.coord)) });
    }
    const u = p.user;
    const faint = !!u && (u.accuracyM == null || u.accuracyM > ARRIVAL_ACCURACY_M);
    const pts = view.current.points;
    const list = buildOverlayItems(
      {
        markers: p.markers,
        dots: p.dots ?? [],
        user: u ? { coord: u.coord, faint } : undefined,
        compact: !!p.compact,
        clusterPx: p.compact ? 18 : DEFAULT_CLUSTER_PX,
        pressable: !!p.onMarkerPress,
      },
      (_m, i) => {
        const pt = pts[i];
        return pt ? { x: pt[0], y: pt[1] } : null;
      },
    );
    items.current = new Map(list.map((it) => [it.key, it]));
    send({ t: 'items', items: list.map(toWireItem) });
    send({
      t: 'ring',
      ring: u && faint ? { at: toLL(u.coord), radius: u.accuracyM ?? ARRIVAL_ACCURACY_M * 2, color: mapC.user } : null,
    });
  };

  const focusCluster = (c: MapCluster) => {
    if (view.current.level <= kakaoLevel(GROUP_LIST_ZOOM) && latest.current.onMarkerPress) {
      setGroup(c.memberIds);
      return;
    }
    const pad = focusPadding(sizeRef.current);
    send({ t: 'fit', coords: c.coords.map(toLL), pad: { top: pad, right: pad, bottom: pad, left: pad }, maxLevel: kakaoLevel(FOCUS_MAX_ZOOM) });
    setMoved(true);
    latest.current.onUserMove?.();
  };

  const onMessage = (e: WebViewMessageEvent) => {
    if (!isKakaoBridgeUrl(e.nativeEvent.url)) return;
    const m = parseKakaoOut(e.nativeEvent.data);
    if (!m) return;
    switch (m.t) {
      case 'ready':
        // 처음이든 다시 뜬 것이든 페이지는 빈 상태다. 마커 좌표부터 다시 보내게 한다
        view.current = { ...view.current, points: [], forKey: '' };
        setReady((n) => n + 1);
        return;
      case 'view':
        // 마커 수가 다르면 바뀌기 전 마커의 좌표다. 레벨만 받고 다음 view를 기다린다
        if (m.points.length !== latest.current.markers.length) {
          view.current = { ...view.current, level: m.level };
          return;
        }
        view.current = { level: m.level, points: m.points, forKey: view.current.forKey };
        pushItems();
        return;
      case 'tap': {
        const a = items.current.get(m.key)?.action;
        if (a?.type === 'marker') latest.current.onMarkerPress?.(a.id);
        else if (a?.type === 'cluster') focusCluster(a.cluster);
        return;
      }
      case 'press':
        latest.current.onPressMap?.({ latitude: m.lat, longitude: m.lng });
        return;
      case 'moved':
        if (!latest.current.compact) {
          setMoved(true);
          latest.current.onUserMove?.();
        }
        return;
      case 'fail':
        latest.current.onFail(m.reason);
        return;
    }
  };

  // 선: 내용이 바뀔 때만 다시 보낸다
  useEffect(() => {
    if (ready === 0) return;
    send({
      t: 'lines',
      lines: latest.current.polylines.map((l) => ({ coords: l.coords.map(toLL), color: mapC[l.color], dashed: !!l.dashed, weight: compact ? 3 : 4 })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, polyKey, compact]);

  // 핀·이동 점·현재 위치
  useEffect(() => {
    if (ready > 0) pushItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markKey, dotKey, userLat, userLng, userAcc, compact, pressable]);

  // 처음, 마커·선이 바뀔 때, 크기가 바뀔 때(사용자가 움직이지 않았으면) 맞춘다
  const movedRef = useRef(moved);
  movedRef.current = moved;
  useEffect(() => {
    if (ready > 0 && size.width > 0 && !latest.current.holdFit) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  // 내 위치로 옮기기. 요청(seq)마다 한 번. 페이지가 다시 떴을 때(ready)도 마지막 요청을 다시 보낸다
  const centerSeq = props.center?.seq;
  useEffect(() => {
    const c = latest.current.center;
    if (ready === 0 || !c) return;
    send({ t: 'center', at: toLL(c.coord), level: c.zoom != null ? kakaoLevel(c.zoom) : undefined });
    setMoved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, centerSeq]);
  useEffect(() => {
    if (ready > 0 && size.width > 0 && !movedRef.current) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  // 앱이 뒤로 갔다 오면 WebView가 멈춰 있을 수 있어 화면만 다시 맞춘다(사용자가 움직였으면 그대로)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && ready > 0 && !movedRef.current) fit();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /** 안드로이드 렌더러가 죽었다. 이 처리기가 있어야 앱이 같이 죽지 않는다. WebView를 새로 만들고, 거듭되면 기본 지도로 */
  const onRenderGone = () => {
    setReady(0);
    if (gen >= MAX_REMOUNTS) {
      latest.current.onFail('tiles');
      return;
    }
    setGen((g) => g + 1);
  };

  const titleOf = useMemo(() => new Map(props.markers.map((m) => [m.id, m.title])), [props.markers]);
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ width: Math.round(e.nativeEvent.layout.width), height: Math.round(e.nativeEvent.layout.height) });

  return (
    <View
      accessibilityLabel={`지도 · 마커 ${props.markers.length}개`}
      style={[
        { height, overflow: 'hidden', backgroundColor: mapC.bg },
        props.flat ? null : { borderRadius: R.card, borderWidth: 1, borderColor: lineC.line },
      ]}
    >
      <View style={[styles.fill, { bottom: bottomCover }]} onLayout={onLayout}>
        <WebView
          key={gen}
          ref={web}
          source={{ html, baseUrl: KAKAO_WEBVIEW_BASE_URL }}
          originWhitelist={KAKAO_WEBVIEW_ORIGINS}
          onShouldStartLoadWithRequest={onNav}
          onOpenWindow={(e) => {
            if (kakaoNavAction(e.nativeEvent.targetUrl) === 'open') Linking.openURL(e.nativeEvent.targetUrl).catch(() => {});
          }}
          onMessage={onMessage}
          onError={() => latest.current.onFail('script')}
          onContentProcessDidTerminate={() => web.current?.reload()}
          onRenderProcessGone={onRenderGone}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={{ backgroundColor: mapC.bg }}
        />
        {compact && !props.onMarkerPress && !props.onPressMap ? <View style={styles.block} /> : null}
      </View>
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
  fill: { position: 'absolute', left: 0, right: 0, top: 0 },
  /** 누를 것이 없는 미리보기는 WebView가 손가락을 삼키지 않게 덮는다(화면 스크롤이 그대로 된다) */
  block: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
});

/** 앱은 WebView만 있으면 카카오 지도를 그릴 수 있다(react-native-webview는 Expo Go에 들어 있다) */
export const KAKAO_VIEW_READY = true;
