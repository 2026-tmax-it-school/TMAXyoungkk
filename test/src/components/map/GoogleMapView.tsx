import Constants, { ExecutionEnvironment } from 'expo-constants';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PixelRatio, Platform, View, type LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SvgXml } from 'react-native-svg';

import { ARRIVAL_ACCURACY_M } from '../../core/constants';
import { clusterName, DEFAULT_MAP_CENTER, fitCoords, fitKey, mapPadding, pinName, userName } from '../../core/map/engine';
import { clusterMarkers, DEFAULT_CLUSTER_PX, type MapCluster, type MapMarkerInput, type XY } from '../../core/map/layout';
import type { LatLng } from '../../types';
import { GOOGLE_MAP_STYLE, lineC, mapC, mapPinSvg, R, type PinSpec } from '../../ui';
import { ClusterListSheet, FitAllButton, MapChildren, mapHeight, type MapCanvasProps, type MapFailReason } from './parts';

/**
 * 구글 지도(앱, WP5 소유). react-native-maps로 MapCanvas와 같은 props를 그린다. 웹은 GoogleMapView.web.tsx다.
 * - 안드로이드는 구글 지도다. Expo Go는 자체 키가 있어 바로 뜨고, 개발 빌드는 GOOGLE_MAPS_ANDROID_API_KEY로
 *   빌드했을 때(extra.androidGoogleMaps)만 쓴다. 키 없이 빌드한 앱에서 구글 지도를 띄우면 'API key not found'로 꺼지므로
 *   그때는 GOOGLE_VIEW_READY가 false라 MapCanvas가 기본 지도(SVG)를 그린다.
 * - iOS는 Expo Go에 구글 지도 SDK가 없어 Apple 지도로 그린다. 개발 빌드에 iOS 키를 넣으면(extra.iosGoogleMaps) 구글이다.
 * - 핀은 ui/mapPinSvg를 SvgXml로 그린다(웹·기본 지도와 같은 모양). 묶음은 지금 보이는 범위의 화면 좌표로 다시 계산한다.
 * - 이동 점은 지금 배율에서 2.4px·3.5px가 되는 미터 반경 원이다.
 * - 화면 맞춤은 늘 fitToCoordinates에 dp 여백(core/map/engine.mapPadding)을 준다. 안드로이드도 라이브러리가 dp를 px로 바꾸므로
 *   여기서 PixelRatio를 곱하지 않는다. 좁게 모인 좌표는 약 1.1km 폭이 되도록 가상의 모서리 두 점을 더해 맞춘다.
 * - 구글 제공자는 onMapReady 뒤 10초 안에 onMapLoaded(타일 다 그림)가 안 오면 onFail('tiles')로 기본 지도에 넘긴다.
 *   Apple 지도는 onMapLoaded를 주지 않아 시한을 두지 않는다.
 * - '전체 보기': 구글은 isGesture로, Apple은 '코드가 맞춘 직후의 첫 변화'를 빼고 나머지 변화를 사용자 조작으로 본다.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as { androidGoogleMaps?: boolean; iosGoogleMaps?: boolean };
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const IOS_GOOGLE = !IN_EXPO_GO && extra.iosGoogleMaps === true;
const PROVIDER = Platform.OS === 'android' || (Platform.OS === 'ios' && IOS_GOOGLE) ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;
const IS_GOOGLE = PROVIDER === PROVIDER_GOOGLE;

/** 이 빌드에서 react-native-maps를 띄워도 되는가. 안드로이드 기본 제공자도 구글이라 키가 들어간 빌드여야 한다 */
export const GOOGLE_VIEW_READY = Platform.OS === 'android' ? IN_EXPO_GO || extra.androidGoogleMaps === true : true;

const M_PER_DEG_LAT = 111_320;
/** 이보다 좁게 모인 좌표는 이 폭(도, 약 1.1km)으로 보여 준다 */
const MIN_SPAN_DEG = 0.01;
const TILE_TIMEOUT_MS = 10_000;
/** 안드로이드 원 테두리·선 무늬는 px 단위라 dp로 맞춘다 */
const ANDROID_PX = Platform.OS === 'android' ? PixelRatio.get() : 1;

function centroid(cs: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const c of cs) {
    lat += c.latitude;
    lng += c.longitude;
  }
  return { latitude: lat / cs.length, longitude: lng / cs.length };
}

/** 좁게 모인 좌표에 약 1.1km 폭을 만드는 가상 모서리 두 점을 더한다 */
function withMinSpan(coords: LatLng[]): LatLng[] {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const c of coords) {
    minLat = Math.min(minLat, c.latitude);
    maxLat = Math.max(maxLat, c.latitude);
    minLng = Math.min(minLng, c.longitude);
    maxLng = Math.max(maxLng, c.longitude);
  }
  if (maxLat - minLat >= MIN_SPAN_DEG || maxLng - minLng >= MIN_SPAN_DEG) return coords;
  const lat = (minLat + maxLat) / 2;
  const lng = (minLng + maxLng) / 2;
  const h = MIN_SPAN_DEG / 2;
  return [...coords, { latitude: lat - h, longitude: lng - h }, { latitude: lat + h, longitude: lng + h }];
}

/** 점선 무늬. 안드로이드는 px, iOS 구글은 미터, Apple은 pt다 */
function dashPattern(mPerPx: number): number[] {
  if (Platform.OS === 'android') return [6 * ANDROID_PX, 5 * ANDROID_PX];
  if (IS_GOOGLE) return [6 * mPerPx, 5 * mPerPx];
  return [6, 5];
}

function PinMarker({ coord, spec, name, onPress }: { coord: LatLng; spec: PinSpec; name: string; onPress?: () => void }) {
  const pin = mapPinSvg(spec);
  // 안드로이드는 마커 뷰를 그림으로 떠서 쓴다. 처음 그릴 때만 따라가고 곧 멈춰 CPU를 아낀다.
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 600);
    return () => clearTimeout(t);
  }, [pin.xml]);
  return (
    <Marker coordinate={coord} anchor={{ x: 0.5, y: 0.5 }} onPress={onPress} accessibilityLabel={name} tracksViewChanges={track}>
      <SvgXml xml={pin.xml} width={pin.size} height={pin.size} />
    </Marker>
  );
}

export function GoogleMapView(props: MapCanvasProps & { onFail: (reason: MapFailReason) => void }) {
  const ref = useRef<MapView>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [region, setRegion] = useState<Region | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [moved, setMoved] = useState(false);
  const [group, setGroup] = useState<string[] | undefined>(undefined);
  /** 코드가 화면을 옮긴 직후의 첫 영역 변화는 사용자 조작이 아니다(Apple 지도는 isGesture가 없다) */
  const fitting = useRef(false);
  const height = mapHeight(props);
  const compact = !!props.compact;
  const bottomCover = props.overlayBottom ?? 0;

  const hasUser = !!props.user;
  const fitList = useMemo(
    () => fitCoords({ markers: props.markers, polylines: props.polylines, fitTo: props.fitTo, user: props.user }),
    // 현재 위치가 움직여도 다시 맞추지 않는다. 있고 없고만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.markers, props.polylines, props.fitTo, hasUser],
  );
  const key = fitKey(fitList);

  const fit = (coords: LatLng[] = fitList, focus = false) => {
    const map = ref.current;
    if (!map) return;
    fitting.current = true;
    setTimeout(() => {
      fitting.current = false;
    }, 1500);
    if (coords.length === 0) {
      map.animateToRegion({ ...DEFAULT_MAP_CENTER, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 0);
    } else {
      map.fitToCoordinates(focus ? coords : withMinSpan(coords), {
        edgePadding: mapPadding(size, { compact, flat: props.flat }),
        animated: focus,
      });
    }
    setMoved(focus);
  };

  useEffect(() => {
    if (ready && size.width > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, height, bottomCover, size.width, size.height]);

  // 구글 제공자: 지도가 준비된 뒤 타일을 다 그렸다는 신호가 시한 안에 안 오면 기본 지도로 넘긴다(앱이 앞에 있을 때만 잰다)
  const [loaded, setLoaded] = useState(false);
  const onFail = useRef(props.onFail);
  onFail.current = props.onFail;
  useEffect(() => {
    if (!IS_GOOGLE || !ready || loaded) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (AppState.currentState === 'active') timer = setTimeout(() => onFail.current('tiles'), TILE_TIMEOUT_MS);
    };
    arm();
    const sub = AppState.addEventListener('change', arm);
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [ready, loaded]);

  // 지금 보이는 범위의 화면 좌표로 묶는다
  const placed = useMemo(() => {
    const base = props.markers.filter((m) => m.kind === 'base');
    const rest = props.markers.filter((m) => m.kind !== 'base');
    if (!region || size.width === 0 || size.height === 0) return { base, singles: rest, clusters: [] as MapCluster[] };
    const west = region.longitude - region.longitudeDelta / 2;
    const north = region.latitude + region.latitudeDelta / 2;
    const toXY = (c: LatLng): XY => ({
      x: ((c.longitude - west) / region.longitudeDelta) * size.width,
      y: ((north - c.latitude) / region.latitudeDelta) * size.height,
    });
    const pts: (MapMarkerInput & XY)[] = rest.map((m) => ({ ...m, ...toXY(m.coord) }));
    const { singles, clusters } = clusterMarkers(pts, compact ? 18 : DEFAULT_CLUSTER_PX);
    return { base, singles: singles as MapMarkerInput[], clusters };
  }, [props.markers, region, size.width, size.height, compact]);

  const pressCluster = (c: MapCluster) => {
    // 약 170m보다 좁게 당겼는데도 묶여 있으면 목록에서 고른다
    if (region && region.latitudeDelta < 0.0015 && props.onMarkerPress) setGroup(c.memberIds);
    else fit(c.coords, true);
  };

  const mPerPx = region && size.height > 0 ? (region.latitudeDelta * M_PER_DEG_LAT) / size.height : 5;
  const u = props.user;
  const faint = !!u && (u.accuracyM == null || u.accuracyM > ARRIVAL_ACCURACY_M);
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
      <MapView
        ref={ref}
        provider={PROVIDER}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: bottomCover }}
        onLayout={onLayout}
        initialRegion={{ ...DEFAULT_MAP_CENTER, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        customMapStyle={IS_GOOGLE ? GOOGLE_MAP_STYLE : undefined}
        onMapReady={() => setReady(true)}
        onMapLoaded={() => setLoaded(true)}
        onRegionChangeComplete={(r, d) => {
          setRegion(r);
          if (fitting.current) {
            fitting.current = false;
            return;
          }
          if (IS_GOOGLE ? d?.isGesture : true) setMoved(true);
        }}
        onPanDrag={() => {
          if (!moved) setMoved(true);
        }}
        onPress={(e) => props.onPressMap?.(e.nativeEvent.coordinate)}
        scrollEnabled={!compact}
        zoomEnabled={!compact}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        moveOnMarkerPress={false}
      >
        {props.polylines.map((l) => (
          <Polyline
            key={l.id}
            coordinates={l.coords}
            strokeColor={mapC[l.color]}
            strokeWidth={compact ? 3 : 4}
            lineDashPattern={l.dashed ? dashPattern(mPerPx) : undefined}
            // 둥근 끝은 점선 조각을 점으로 바꾸거나(안드로이드) 틈을 메운다(iOS)
            lineCap={l.dashed ? 'butt' : 'round'}
            lineJoin="round"
          />
        ))}
        {(props.dots ?? []).map((d) => (
          <Circle
            key={d.id}
            center={d.coord}
            radius={mPerPx * (d.size === 'md' ? 3.5 : 2.4)}
            fillColor={d.tone === 'ink' ? mapC.user : mapC.faint}
            strokeColor={mapC.white}
            strokeWidth={(d.size === 'md' ? 1.5 : 0) * ANDROID_PX}
          />
        ))}
        {u && faint ? (
          <Circle center={u.coord} radius={u.accuracyM ?? ARRIVAL_ACCURACY_M * 2} fillColor={mapC.accuracy} strokeWidth={0} />
        ) : null}
        {placed.base.map((m) => (
          <PinMarker key={m.id} coord={m.coord} spec={{ kind: 'base', compact }} name={pinName(m)} />
        ))}
        {placed.singles.map((m) => (
          <PinMarker
            key={m.id}
            coord={m.coord}
            spec={
              m.kind === 'excluded'
                ? { kind: 'excluded', label: m.label, compact }
                : { kind: 'spot', label: m.label, color: m.color, compact }
            }
            name={pinName(m)}
            onPress={props.onMarkerPress ? () => props.onMarkerPress?.(m.id) : undefined}
          />
        ))}
        {placed.clusters.map((c) => (
          <PinMarker
            key={c.id}
            coord={centroid(c.coords)}
            spec={{ kind: 'cluster', count: c.count, compact }}
            name={clusterName(c.count, !compact)}
            // 미리보기(compact)는 움직일 수 없어 묶음을 당겨 놓으면 돌아올 방법이 없다
            onPress={compact ? undefined : () => pressCluster(c)}
          />
        ))}
        {u ? <PinMarker coord={u.coord} spec={{ kind: 'user', compact }} name={userName(faint)} /> : null}
      </MapView>
      {moved && !compact ? <FitAllButton overlayBottom={bottomCover + 24} onPress={() => fit()} /> : null}
      <ClusterListSheet
        memberIds={group}
        titleOf={titleOf}
        onClose={() => setGroup(undefined)}
        onPick={(id) => props.onMarkerPress?.(id)}
      />
      <MapChildren>{props.children}</MapChildren>
    </View>
  );
}
