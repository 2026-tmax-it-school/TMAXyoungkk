import Constants, { ExecutionEnvironment } from 'expo-constants';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, Platform, View, type LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SvgXml } from 'react-native-svg';

import { ARRIVAL_ACCURACY_M } from '../../core/constants';
import { DEFAULT_MAP_CENTER, fitCoords, fitKey } from '../../core/map/engine';
import { clusterMarkers, DEFAULT_CLUSTER_PX, type MapCluster, type MapMarkerInput, type XY } from '../../core/map/layout';
import type { LatLng } from '../../types';
import { GOOGLE_MAP_STYLE, lineC, mapC, mapPinSvg, R, type PinSpec } from '../../ui';
import { ClusterListSheet, FitAllButton, MapChildren, mapHeight, type MapCanvasProps } from './parts';

/**
 * 구글 지도(앱, WP5 소유). react-native-maps로 MapCanvas와 같은 props를 그린다. 웹은 GoogleMapView.web.tsx다.
 * - 안드로이드는 구글 지도다. Expo Go에서는 키 없이 뜨고, 개발 빌드는 app.config.js가 넣는 안드로이드 키가 있어야 한다.
 * - iOS는 Expo Go에 구글 지도 SDK가 없어 Apple 지도로 그린다. 개발 빌드에 iOS 키를 넣으면(extra.iosGoogleMaps) 구글이다.
 * - 핀은 ui/mapPinSvg를 SvgXml로 그린다(웹·기본 지도와 같은 모양). 묶음은 지금 보이는 범위의 화면 좌표로 다시 계산한다.
 * - 이동 점은 지금 배율에서 2.4px·3.5px가 되는 미터 반경 원이다.
 */

const IOS_GOOGLE =
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && Constants.expoConfig?.extra?.iosGoogleMaps === true;
const PROVIDER = Platform.OS === 'android' || (Platform.OS === 'ios' && IOS_GOOGLE) ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;

const M_PER_DEG_LAT = 111_320;
/** 이보다 좁게 모인 좌표는 이 폭(도, 약 1.1km)으로 보여 준다 */
const MIN_SPAN_DEG = 0.01;

function centroid(cs: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const c of cs) {
    lat += c.latitude;
    lng += c.longitude;
  }
  return { latitude: lat / cs.length, longitude: lng / cs.length };
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
    <Marker
      coordinate={coord}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
      accessibilityLabel={name}
      tracksViewChanges={track}
    >
      <SvgXml xml={pin.xml} width={pin.size} height={pin.size} />
    </Marker>
  );
}

export function GoogleMapView(props: MapCanvasProps & { onFail: () => void }) {
  const ref = useRef<MapView>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [region, setRegion] = useState<Region | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [moved, setMoved] = useState(false);
  const [group, setGroup] = useState<string[] | undefined>(undefined);
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

  const regionFor = (coords: LatLng[]): Region | undefined => {
    if (coords.length === 0) {
      return { ...DEFAULT_MAP_CENTER, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    }
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
    if (maxLat - minLat >= MIN_SPAN_DEG || maxLng - minLng >= MIN_SPAN_DEG) return undefined;
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: MIN_SPAN_DEG,
      longitudeDelta: MIN_SPAN_DEG,
    };
  };

  const fit = (coords: LatLng[] = fitList, focus = false) => {
    const map = ref.current;
    if (!map) return;
    const small = focus ? undefined : regionFor(coords);
    if (small) map.animateToRegion(small, 0);
    else {
      // 안드로이드 edgePadding은 물리 픽셀이다
      const k = Platform.OS === 'android' ? PixelRatio.get() : 1;
      const pad = (compact ? 16 : 40) * k;
      map.fitToCoordinates(coords, {
        edgePadding: { top: props.flat ? 96 * k : pad, right: pad, bottom: pad, left: pad },
        animated: focus,
      });
    }
    setMoved(focus);
  };

  useEffect(() => {
    if (ready && size.width > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, height, bottomCover, size.width > 0]);

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
        customMapStyle={PROVIDER === PROVIDER_GOOGLE ? GOOGLE_MAP_STYLE : undefined}
        onMapReady={() => setReady(true)}
        onRegionChangeComplete={(r, d) => {
          setRegion(r);
          if (d?.isGesture) setMoved(true);
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
            lineDashPattern={l.dashed ? [6, 5] : undefined}
            lineCap="round"
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
            strokeWidth={d.size === 'md' ? 1.5 : 0}
          />
        ))}
        {u && faint ? (
          <Circle center={u.coord} radius={u.accuracyM ?? ARRIVAL_ACCURACY_M * 2} fillColor={mapC.accuracy} strokeWidth={0} />
        ) : null}
        {placed.base.map((m) => (
          <PinMarker key={m.id} coord={m.coord} spec={{ kind: 'base', compact }} name={`기점 ${m.title}`} />
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
            name={m.kind === 'excluded' ? `제외 스팟 ${m.title}` : m.label ? `${m.label}번 ${m.title}` : m.title}
            onPress={props.onMarkerPress ? () => props.onMarkerPress?.(m.id) : undefined}
          />
        ))}
        {placed.clusters.map((c) => (
          <PinMarker
            key={c.id}
            coord={centroid(c.coords)}
            spec={{ kind: 'cluster', count: c.count, compact }}
            name={`${c.count}곳 묶음 · 눌러서 확대`}
            onPress={() => pressCluster(c)}
          />
        ))}
        {u ? <PinMarker coord={u.coord} spec={{ kind: 'user', compact }} name={faint ? '현재 위치(정확도 낮음)' : '현재 위치'} /> : null}
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
