import React, { useMemo, useState } from 'react';
import { Platform, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect } from 'react-native-svg';

import type { LatLng } from '../../types';
import { focusOptions, layoutMap, unproject, type MapCluster } from '../../core/map/layout';
import { useUi } from '../../store/ui';
import { lineC, mapC, R, SvgLabel } from '../../ui';
import { MAP_ENGINE } from './engine';
import { GOOGLE_VIEW_READY, GoogleMapView } from './GoogleMapView';
import { ClusterListSheet, FitAllButton, MapChildren, mapHeight, type MapCanvasProps, type MapFailReason } from './parts';

const IS_WEB = Platform.OS === 'web';

/**
 * SVG 요소 누르기. 웹은 onClick, 앱은 onPress다. react-native-svg 웹 구현은 onPress를 받으면 RN 응답자 핸들러
 * (onStartShouldSetResponder 등)를 DOM 요소에 그대로 넘겨 React가 'Unknown event handler property' 경고를 낸다
 * (2026-10-09 웹 실행). onClick은 DOM 클릭으로 바로 붙어 경고가 없고 동작은 같다.
 * 웹에서는 onPress: null을 같이 준다. react-native-svg 15 웹 prepare()가 onPress !== null이면
 * clean.onClick = props.onPress로 덮어써서, onPress가 undefined면 우리 onClick이 지워져 누르기가 전부 죽는다.
 */
const WEB_CLICK = (fn: unknown) => ({ onClick: fn, onPress: null });

function tap(fn: (() => void) | undefined): Record<string, unknown> {
  if (!fn) return {};
  return IS_WEB ? WEB_CLICK(fn) : { onPress: fn };
}

export type { MapCanvasProps } from './parts';

/**
 * 공통 지도(WP5 소유). 07, 11, 13, 19, 22가 같은 컴포넌트를 쓴다. 화면은 어느 지도인지 모른다.
 * - 구글 키(EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)가 있으면 GoogleMapView(웹 Maps JavaScript API, 앱 react-native-maps)를 그린다.
 *   키가 거부되거나 스크립트를 못 받으면 이 세션은 기본 지도로 돌아온다. 타일이 시한 안에 안 오면 그 지도 하나만 돌아온다.
 *   앱은 구글 지도를 띄울 수 있는 빌드일 때만(GOOGLE_VIEW_READY) 쓴다.
 * - 없으면 기본 지도(SvgMapCanvas)다. react-native-svg 한 벌로 웹·iOS·안드로이드를 그리고 키가 필요 없다.
 * 투영·클러스터·선 계산은 core/map/layout.ts(순수)가 하고 여기서는 그리기만 한다.
 *
 * 모양(목업 11·13)
 * - 확정 스팟: 순번이 박힌 잉크 원형 핀. 순번이 없으면(루트 계산 전 후보) 작은 잉크 점.
 *   여러 날짜를 겹친 '전체' 보기에서는 핀 면이 그날 선 색이다(marker.color).
 *   핀의 흰 2px 테두리는 목업에 없지만 핀끼리 겹칠 때와 같은 색 선 위에서 윤곽을 지키려고 둔다.
 * - 기점: 속 빈 잉크 링. 제외 스팟: 흰 핀에 '제외'(muted 글자).
 * - 밀집 마커: 흰 면에 잉크 테두리 숫자 원 하나(잉크 스팟 핀과 구분). 누르면 그 무리로 확대하고(최소 범위 약 220m) '전체 보기'로 돌아온다.
 *   확대해도 겹쳐 묶여 있으면 한 번 더 누를 때 무리 목록을 띄워 스팟 상세로 간다.
 * - 현재 위치: 불투명한 파랑 점에 흰 3px 테두리(지도 앱 관례). 실제 이동 점도 같은 파랑이다. 정확도 50m 초과(또는 모름)일 때만 옅은 정확도 원을 두른다.
 * - 바탕은 mapC.bg에 옅은 격자다. 실제 도로가 아니므로 도로처럼 그리지 않는다.
 */

const GRID_PX = 56;

/** 키 거부·스크립트 실패면 이 세션 동안 다른 지도도 기본 지도로 그린다(화면마다 다시 실패하지 않게). */
let googleDown = false;
/** 안내는 세션에 한 번만 띄운다 */
let failToastShown = false;

/** react-native-svg의 accessible은 웹에서 그대로 DOM 속성이 되어 경고가 난다. 웹은 accessibilityLabel만 쓴다 */
const SVG_ACCESSIBLE = Platform.OS === 'web' ? undefined : true;

export function MapCanvas(props: MapCanvasProps) {
  const [down, setDown] = useState(googleDown);
  if (MAP_ENGINE === 'google' && GOOGLE_VIEW_READY && !down) {
    return (
      <GoogleMapView
        {...props}
        onFail={(reason: MapFailReason) => {
          if (!failToastShown) {
            failToastShown = true;
            useUi.getState().showToast('구글 지도를 불러오지 못해 기본 지도로 보여 드려요', 'warn');
          }
          if (reason !== 'tiles') googleDown = true;
          setDown(true);
        }}
      />
    );
  }
  return <SvgMapCanvas {...props} />;
}

function SvgMapCanvas(props: MapCanvasProps) {
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<LatLng[] | undefined>(undefined);
  const [group, setGroup] = useState<MapCluster | undefined>(undefined);
  const height = mapHeight(props);
  const compact = !!props.compact;
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const layout = useMemo(
    () =>
      width > 0
        ? layoutMap({
            markers: props.markers,
            polylines: props.polylines,
            dots: props.dots,
            user: props.user,
            size: { width, height },
            fitTo: focus ?? props.fitTo,
            clusterPx: compact ? 18 : undefined,
            pad: compact ? 20 : undefined,
            ...(focus ? focusOptions(compact) : null),
          })
        : undefined,
    [width, height, props.markers, props.polylines, props.dots, props.user, props.fitTo, focus, compact],
  );

  const pressMap = props.onPressMap
    ? (e: GestureResponderEvent) => {
        if (!layout) return;
        const { locationX, locationY } = e.nativeEvent;
        props.onPressMap?.(unproject(layout.projection, { x: locationX, y: locationY }));
      }
    : undefined;
  // 웹은 DOM 클릭 위치를 svg 기준으로 바꿔 같은 투영으로 되돌린다
  const clickMap = props.onPressMap
    ? (e: { clientX: number; clientY: number; currentTarget: unknown }) => {
        if (!layout) return;
        const el = e.currentTarget as { ownerSVGElement?: { getBoundingClientRect(): { left: number; top: number } } | null };
        const box = el.ownerSVGElement?.getBoundingClientRect();
        if (!box) return;
        props.onPressMap?.(unproject(layout.projection, { x: e.clientX - box.left, y: e.clientY - box.top }));
      }
    : undefined;

  const grid: React.ReactNode[] = [];
  if (layout) {
    for (let x = GRID_PX; x < width; x += GRID_PX) {
      grid.push(<Line key={`gx${x}`} x1={x} y1={0} x2={x} y2={height} stroke={mapC.grid} strokeWidth={1} />);
    }
    for (let y = GRID_PX; y < height; y += GRID_PX) {
      grid.push(<Line key={`gy${y}`} x1={0} y1={y} x2={width} y2={y} stroke={mapC.grid} strokeWidth={1} />);
    }
  }

  const pinR = compact ? 11 : 15;
  const userR = compact ? 8 : 11;
  const titleOf = new Map(props.markers.map((m) => [m.id, m.title]));
  const pressCluster = (c: MapCluster) => {
    // 확대한 뒤에도 묶여 있으면 무리 목록에서 고른다(마커를 누르면 스팟 상세라는 규칙을 지킨다).
    if (focus && props.onMarkerPress) setGroup(c);
    else setFocus(c.coords);
  };
  // 순번 글자는 목업 11의 13px(pinLg), 작은 지도는 9.5px(pinSm)
  const label = compact ? ('pinSm' as const) : ('pinLg' as const);
  const labelDy = compact ? 3.5 : 4.5;

  return (
    <View
      onLayout={onLayout}
      accessibilityLabel={`지도 · 마커 ${props.markers.length}개`}
      style={[
        { height, overflow: 'hidden', backgroundColor: mapC.bg },
        props.flat ? null : { borderRadius: R.card, borderWidth: 1, borderColor: lineC.line },
      ]}
    >
      {layout ? (
        <Svg width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} fill={mapC.bg} {...((IS_WEB ? (clickMap ? WEB_CLICK(clickMap) : {}) : { onPress: pressMap }) as Record<string, unknown>)} />
          {grid}
          {layout.lines.map((l) => (
            <Polyline
              key={l.id}
              points={l.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              fill="none"
              stroke={mapC[l.color]}
              strokeWidth={compact ? 3 : 3.4}
              strokeDasharray={l.dashed ? '6 5' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {layout.dots.map((d) => (
            <Circle
              key={d.id}
              cx={d.x}
              cy={d.y}
              r={d.size === 'md' ? 3.5 : 2.4}
              fill={d.tone === 'ink' ? mapC.user : mapC.faint}
              stroke={d.size === 'md' ? mapC.white : undefined}
              strokeWidth={d.size === 'md' ? 1.5 : undefined}
            />
          ))}
          {layout.projected.map((m) => {
            const press = props.onMarkerPress && m.kind !== 'base' ? () => props.onMarkerPress?.(m.id) : undefined;
            if (m.kind === 'base') {
              return (
                <G key={m.id} accessible={SVG_ACCESSIBLE} accessibilityLabel={`기점 ${m.title}`}>
                  <Circle cx={m.x} cy={m.y} r={compact ? 9 : 12} fill={mapC.white} stroke={mapC.ink} strokeWidth={3} />
                </G>
              );
            }
            if (m.kind === 'excluded') {
              return (
                <G key={m.id} {...tap(press)} accessible={SVG_ACCESSIBLE} accessibilityLabel={`제외 스팟 ${m.title}`}>
                  <Circle cx={m.x} cy={m.y} r={compact ? 11 : 14} fill={mapC.excludedPin} stroke={mapC.faint} strokeWidth={2} />
                  <SvgLabel x={m.x} y={m.y + 3.5} text={m.label ?? '제외'} v="pinSm" c="muted" />
                </G>
              );
            }
            if (!m.label) {
              return (
                <G key={m.id} {...tap(press)} accessible={SVG_ACCESSIBLE} accessibilityLabel={m.title}>
                  <Circle cx={m.x} cy={m.y} r={compact ? 6 : 7.5} fill={mapC[m.color ?? 'ink']} stroke={mapC.white} strokeWidth={2} />
                </G>
              );
            }
            return (
              <G key={m.id} {...tap(press)} accessible={SVG_ACCESSIBLE} accessibilityLabel={`${m.label}번 ${m.title}`}>
                <Circle cx={m.x} cy={m.y} r={pinR} fill={mapC[m.color ?? 'ink']} stroke={mapC.white} strokeWidth={2} />
                <SvgLabel x={m.x} y={m.y + labelDy} text={m.label} v={label} c="onAccent" />
              </G>
            );
          })}
          {layout.clusters.map((c) => (
            <G key={c.id} {...tap(() => pressCluster(c))} accessible={SVG_ACCESSIBLE} accessibilityLabel={`${c.count}곳 묶음 · 눌러서 확대`}>
              <Circle cx={c.x} cy={c.y} r={compact ? 13 : 17} fill={mapC.white} stroke={mapC.ink} strokeWidth={2} />
              <SvgLabel x={c.x} y={c.y + 4} text={String(c.count)} v="cluster" c="ink" />
            </G>
          ))}
          {layout.user ? (
            <G accessible={SVG_ACCESSIBLE} accessibilityLabel={layout.user.faint ? '현재 위치(정확도 낮음)' : '현재 위치'}>
              {layout.user.faint ? (
                <Circle
                  cx={layout.user.x}
                  cy={layout.user.y}
                  r={Math.max(userR + 6, Math.min(layout.user.radiusPx, width))}
                  fill={mapC.accuracy}
                />
              ) : null}
              <Circle cx={layout.user.x} cy={layout.user.y} r={userR} fill={mapC.user} stroke={mapC.white} strokeWidth={3} />
            </G>
          ) : null}
        </Svg>
      ) : null}
      {focus ? <FitAllButton overlayBottom={props.overlayBottom} onPress={() => setFocus(undefined)} /> : null}
      <ClusterListSheet
        memberIds={group?.memberIds}
        titleOf={titleOf}
        onClose={() => setGroup(undefined)}
        onPick={(id) => props.onMarkerPress?.(id)}
      />
      <MapChildren>{props.children}</MapChildren>
    </View>
  );
}
