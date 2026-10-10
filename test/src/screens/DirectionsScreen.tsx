import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { LatLng, Place, Transport } from '../types';
import type { RouteLeg } from '../core/ports';
import type { MapMarkerInput, MapPolylineInput } from '../core/map/layout';
import {
  createRequestGuard,
  directionsKey,
  directionsShape,
  directionsSteps,
  endpointLabel,
  endpointPlaceholder,
  kakaoDirectionsUrl,
  mapPickEndpoint,
  ME_NAME,
  ME_NOTICE,
  MODE_ORDER,
  modeRows,
  pickMode,
  routeReady,
  searchable,
  searchBiasFor,
  searchesAnywhere,
  searchRegionFor,
  swapEndpoints,
  tripBaseFor,
  type Endpoint,
  type EndpointPair,
  type EndpointSide,
  type ModeResult,
} from '../core/map/directions';
import { distanceText } from '../core/map/model';
import { pickLiveDate } from '../core/live/session';
import { MapCanvas } from '../components/map/MapCanvas';
import { regionById, REGIONS } from '../data/regions';
import type { RootScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { readLocationOnce } from '../services/location/once';
import { getServices } from '../services/registry';
import { useLive } from '../store/live';
import { usePlan, useTripDoc } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Btn,
  Card,
  Chip,
  Field,
  Icon,
  IconBtn,
  lineC,
  Notice,
  R,
  Row,
  Screen,
  Sheet,
  SP,
  surfaceC,
  Txt,
  H,
  type IconName,
} from '../ui';

/**
 * 27 길찾기 · 자유 길찾기(FR-601~603, 2차, WP5 소유). 지도 탭 '길찾기'와 스팟 상세 '여기까지 길찾기'에서 연다.
 * 13 구간 내비(계획 구간만)와 달리 아무 두 지점을 고르고 도보·자동차·대중교통을 견준다(카카오맵 앱 길찾기와 같은 흐름).
 * - 끝점: 내 위치 · 기점 · 여행방 스팟 · 장소 검색 · 지도에서 고르기. 출발 기본값은 기점이고, 여행방이 없으면 비어 있다.
 * - 위치: '내 위치'를 직접 골랐을 때만 읽는다(여행 진행 중이면 그 위치, 아니면 한 번 읽기). 그 좌표만 경로 서버로 간다(ME_NOTICE).
 * - 지도 오른쪽 아래 '내 위치' 버튼(MapCanvas locate)은 지도만 내 자리로 옮기고 따라간다. 출발·도착은 바꾸지 않고 좌표를 어디에도 보내지 않는다.
 * - 경로 요청은 두 끝이 다 정해진 뒤에만 세 수단을 한꺼번에 묻는다. 끝점이 바뀌면 앞 응답은 버린다(createRequestGuard).
 * - 검색은 두 글자 이상에서 잠깐 멈추면(400ms) 찾고, 엔터는 바로 찾는다. 같은 검색어는 다시 묻지 않는다.
 * - 구성은 13처럼 위에 끝점 두 줄, 가운데 지도, 아래 시트(수단 비교 · 칩 · 안내 줄 · 버튼)다.
 */

const SEARCH_DEBOUNCE_MS = 400;
/** 지도에서 누른 곳 근처 장소를 찾는 반경(m) */
const MAP_PICK_RADIUS_M = 150;
const STEPS_MAX_H = 84;
const LIST_MAX_H = 240;

type Results = Partial<Record<Transport, ModeResult>>;

export default function DirectionsScreen({ navigation, route }: RootScreenProps<'Directions'>) {
  const params = route.params ?? {};
  const trip = useTripDoc(params.tripId);
  const plan = usePlan(params.tripId);
  const now = useNow();
  const insets = useSafeAreaInsets();
  const liveTripId = useLive((s) => (s.mode !== 'off' ? s.tripId : undefined));
  const liveDate = useLive((s) => (s.mode !== 'off' ? s.date : undefined));
  const last = useLive((s) => (s.mode !== 'off' ? s.last : undefined));

  const date = trip ? (liveTripId === trip.id && liveDate ? liveDate : pickLiveDate(trip, plan, now)) : undefined;
  const base = trip ? tripBaseFor(trip.days, date) : null;
  const spots = useMemo(() => (trip ? trip.spots.filter((s) => !s.removedByUser) : []), [trip]);

  const [ends, setEnds] = useState<EndpointPair>(() => {
    const spotEnd = (id?: string): Endpoint | undefined => {
      const s = id ? trip?.spots.find((x) => x.id === id) : undefined;
      return s ? { kind: 'spot', name: s.name, coord: s.coord, id: s.id } : undefined;
    };
    const from = spotEnd(params.fromSpotId) ?? (base ? { kind: 'base' as const, name: base.name, coord: base.coord, id: base.placeId } : undefined);
    return { from, to: spotEnd(params.toSpotId) };
  });
  const [mode, setMode] = useState<Transport>(trip?.transport ?? 'car');
  const [results, setResults] = useState<Results>({});
  const [picker, setPicker] = useState<EndpointSide | undefined>(undefined);
  const [mapPick, setMapPick] = useState<EndpointSide | undefined>(undefined);
  const [mapH, setMapH] = useState(0);

  // 경로 요청: 두 끝이 정해진 뒤에만, 세 수단을 한꺼번에. 끝점이 바뀌면 앞 응답을 버린다
  const ready = routeReady(ends);
  const key = ready.ready ? directionsKey(ends) : undefined;
  const routeGuard = useRef(createRequestGuard()).current;
  useEffect(() => {
    const token = routeGuard.begin();
    setResults({});
    if (!key || !ends.from || !ends.to) return;
    const { from, to } = ends;
    for (const t of MODE_ORDER) {
      void getServices()
        .routes.route(from.coord, to.coord, t)
        .catch(() => null)
        .then((r) => {
          if (routeGuard.isCurrent(token)) setResults((prev) => ({ ...prev, [t]: r }));
        });
    }
    // key가 같으면(좌표가 같으면) 이름만 바뀐 것이라 다시 묻지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => routeGuard.cancel(), [routeGuard]);

  const rows = useMemo(() => modeRows(results), [results]);
  const shown = pickMode(rows, mode);
  const row = rows.find((r) => r.transport === shown);
  const leg: RouteLeg | null | undefined = results[shown];

  const usesMe = ends.from?.kind === 'me' || ends.to?.kind === 'me';
  const { from, to } = ends;

  const markers = useMemo<MapMarkerInput[]>(() => {
    const out: MapMarkerInput[] = [];
    if (from) out.push({ id: 'from', coord: from.coord, kind: 'spot', label: '출발', color: 'ink', title: endpointLabel(from) });
    if (to) out.push({ id: 'to', coord: to.coord, kind: 'spot', label: '도착', title: endpointLabel(to) });
    return out;
  }, [from, to]);
  const polylines = useMemo<MapPolylineInput[]>(
    () =>
      from && to && ready.ready && leg
        ? [{ id: 'directions', coords: directionsShape(from, to, leg), color: 'ink', dashed: !leg.road }]
        : [],
    [from, to, ready.ready, leg],
  );
  const region = searchRegionFor(REGIONS, trip ? regionById(trip.region) : undefined, (from ?? to)?.coord);
  const fitTo = useMemo<LatLng[] | undefined>(() => {
    const pts = [from?.coord, to?.coord].filter((c): c is LatLng => !!c);
    if (pts.length > 0) return pts;
    return region ? [region.center] : undefined;
  }, [from, to, region]);
  const steps = useMemo(() => (from && to && leg ? directionsSteps(from, to, leg) : []), [from, to, leg]);

  const touched = useRef(false);
  // 지도에서 고른 곳의 이름 찾기는 늦게 올 수 있다. 그 사이 같은 쪽을 다시 고르거나 바꾸기·화면 닫기를 하면 늦은 응답은 버린다
  const mapGuard = useRef(createRequestGuard()).current;
  const mapPending = useRef<EndpointSide | undefined>(undefined);
  useEffect(() => () => mapGuard.cancel(), [mapGuard]);
  const setEnd = (side: EndpointSide, e: Endpoint) => {
    touched.current = true;
    if (mapPending.current === side) {
      mapGuard.cancel();
      mapPending.current = undefined;
    }
    setEnds((p) => ({ ...p, [side]: e }));
  };
  // 여행방 문서가 늦게 오면(첫 렌더에 기점이 없으면) 사용자가 고르기 전까지만 출발을 기점으로 채운다
  const baseKey = base ? `${base.coord.latitude},${base.coord.longitude}` : '';
  useEffect(() => {
    if (touched.current || !base) return;
    setEnds((p) => (p.from ? p : { ...p, from: { kind: 'base', name: base.name, coord: base.coord, id: base.placeId } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  const onPressMap = async (coord: LatLng) => {
    const side = mapPick;
    if (!side) return;
    setMapPick(undefined);
    const token = mapGuard.begin();
    mapPending.current = side;
    const place = await getServices()
      .places.at(coord, MAP_PICK_RADIUS_M)
      .catch(() => null);
    if (!mapGuard.isCurrent(token)) return;
    mapPending.current = undefined;
    setEnd(side, mapPickEndpoint(coord, place));
  };

  const openKakao = () => {
    if (!from || !to) return;
    Linking.openURL(kakaoDirectionsUrl(from, to)).catch(() => useUi.getState().showToast('카카오맵을 열지 못했습니다', 'warn'));
  };

  const back = navigation.canGoBack() ? navigation.goBack : undefined;

  return (
    <Screen>
      <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: SP.m, gap: SP.m }}>
        <Row gap={SP.l}>
          {back ? <IconBtn icon="back" label="뒤로" onPress={back} /> : null}
          <Txt v="eyebrow" numberOfLines={1} style={{ flex: 1 }}>
            {trip ? `길찾기 · ${trip.title}` : '길찾기'}
          </Txt>
        </Row>
        <Card>
          <Row gap={SP.m}>
            <View style={{ flex: 1, gap: SP.s }}>
              <EndRow side="from" end={from} onPress={() => setPicker('from')} />
              <View style={{ height: 1, backgroundColor: lineC.line }} />
              <EndRow side="to" end={to} onPress={() => setPicker('to')} />
            </View>
            <IconBtn icon="swap" label="출발과 도착 바꾸기" disabled={!from && !to} onPress={() => {
                touched.current = true;
                mapGuard.cancel();
                mapPending.current = undefined;
                setEnds((p) => swapEndpoints(p));
              }} />
          </Row>
        </Card>
        {usesMe ? <Txt v="mtTight">{ME_NOTICE}</Txt> : null}
      </View>

      {/* 13처럼 숨은 화면(높이 0)에서는 지도를 내리지 않는다 */}
      <View
        style={{ flex: 1, minHeight: 0 }}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0) setMapH(h);
        }}
      >
        {mapH > 0 ? (
          <MapCanvas
            flat
            height={mapH}
            markers={markers}
            polylines={polylines}
            fitTo={fitTo}
            user={liveTripId && last ? { coord: last.coord, accuracyM: last.accuracyM } : undefined}
            onPressMap={mapPick ? (c) => void onPressMap(c) : undefined}
            overlayBottom={R.sheet}
            locate
          >
            {mapPick ? (
              <View style={styles.pickBanner}>
                <Card>
                  <Row gap={SP.l}>
                    <Icon name="pin" size={18} color="accent" />
                    <Txt v="nm" style={{ flex: 1 }}>
                      {mapPick === 'from' ? '지도를 눌러 출발 위치를 고르세요' : '지도를 눌러 도착 위치를 고르세요'}
                    </Txt>
                    <Btn title="취소" size="sm" variant="quiet" onPress={() => setMapPick(undefined)} />
                  </Row>
                </Card>
              </View>
            ) : null}
          </MapCanvas>
        ) : null}
      </View>

      <View
        style={{
          backgroundColor: surfaceC.card,
          borderTopWidth: 1,
          borderTopColor: lineC.line,
          borderTopLeftRadius: R.sheet,
          borderTopRightRadius: R.sheet,
          marginTop: -R.sheet,
          paddingTop: SP.l,
          paddingHorizontal: SP.gutter,
          paddingBottom: SP.xxl + insets.bottom,
          gap: SP.l,
        }}
      >
        <View
          style={{ width: H.grabberW, height: H.grabberH, borderRadius: H.grabberH / 2, backgroundColor: surfaceC.grabber, alignSelf: 'center' }}
        />
        {!ready.ready ? (
          <Txt v="mt">
            {ready.reason === 'same'
              ? '출발과 도착이 같은 곳입니다. 한쪽을 다른 곳으로 골라 주세요.'
              : '출발과 도착을 고르면 자동차 · 대중교통 · 도보를 견줘 보여 드립니다.'}
          </Txt>
        ) : (
          <>
            <Row gap={SP.s}>
              {rows.map((r) => {
                const on = r.transport === shown;
                return (
                  <Pressable
                    key={r.transport}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.label} ${r.timeText}${r.distText ? ` ${r.distText}` : ''}`}
                    accessibilityState={{ selected: on, disabled: r.state === 'none' }}
                    disabled={r.state === 'none'}
                    onPress={() => setMode(r.transport)}
                    style={[styles.modeCell, on ? styles.modeOn : null]}
                  >
                    <Row gap={SP.xs}>
                      <Icon name={r.icon as IconName} size={14} color={on ? 'accent' : 'muted'} stroke={2} />
                      <Txt v="mtTight" numberOfLines={1}>
                        {r.label}
                      </Txt>
                    </Row>
                    <Txt v="nm" c={r.state === 'ok' ? 'ink' : 'muted'} numberOfLines={1}>
                      {r.timeText}
                    </Txt>
                    <Txt v="mtTight" numberOfLines={1}>
                      {r.distText || ' '}
                    </Txt>
                  </Pressable>
                );
              })}
            </Row>
            {row && row.state === 'ok' ? (
              <Row gap={SP.s} wrap>
                {row.fastest ? <Chip text="가장 빠름" tone="soft" /> : null}
                {row.estimateText ? <Chip text={row.estimateText} tone="line" /> : null}
                {leg?.road === 'osm' ? <Chip text="길 데이터 OpenStreetMap" tone="line" /> : null}
              </Row>
            ) : null}
            {leg?.note ? <Txt v="mtTight">{leg.note}</Txt> : null}
            {row?.state === 'none' ? <Txt v="mt">{`${row.label} 경로가 없습니다. 다른 수단을 골라 주세요.`}</Txt> : null}
            {steps.length > 0 ? (
              <ScrollView style={{ flexGrow: 0, maxHeight: STEPS_MAX_H }} contentContainerStyle={{ gap: SP.s }}>
                {steps.map((s, i) => (
                  <Row key={`${i}-${s.text}`} gap={SP.l}>
                    <Icon name={i === steps.length - 1 ? 'pin' : 'right'} size={14} color={i === 0 ? 'accent' : 'faint'} />
                    <Txt v="mt" c={i === 0 ? 'ink' : 'muted'} style={{ flex: 1 }}>
                      {s.text}
                    </Txt>
                    {s.meters > 0 ? <Txt v="mtTight">{distanceText(s.meters)}</Txt> : null}
                  </Row>
                ))}
              </ScrollView>
            ) : null}
          </>
        )}
        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn title="카카오맵으로 열기" size="sm" variant="quiet" disabled={!ready.ready} onPress={openKakao} />
          </View>
          {liveTripId ? (
            <View style={{ flex: 1 }}>
              <Btn title="안내 시작" size="sm" onPress={() => navigation.navigate('LiveTrip', { tripId: liveTripId, date: liveDate })} />
            </View>
          ) : null}
        </Row>
      </View>

      <EndpointPicker
        side={picker}
        other={picker ? ends[picker === 'from' ? 'to' : 'from'] : undefined}
        regionFor={(near) => searchRegionFor(REGIONS, trip ? regionById(trip.region) : undefined, near)}
        anywhereFor={(near) => searchesAnywhere(REGIONS, trip ? regionById(trip.region) : undefined, near)}
        base={base ? { kind: 'base', name: base.name, coord: base.coord, id: base.placeId } : undefined}
        spots={spots.map((s) => ({ kind: 'spot' as const, name: s.name, coord: s.coord, id: s.id }))}
        liveCoord={liveTripId && last ? last.coord : undefined}
        onClose={() => setPicker(undefined)}
        onMapPick={() => {
          setMapPick(picker);
          setPicker(undefined);
        }}
        onPick={(pickedSide, e) => {
          setEnd(pickedSide, e);
          setPicker(undefined);
        }}
      />
    </Screen>
  );
}

function EndRow({ side, end, onPress }: { side: EndpointSide; end: Endpoint | undefined; onPress: () => void }) {
  const word = side === 'from' ? '출발' : '도착';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${word} 바꾸기${end ? `, 지금 ${endpointLabel(end)}` : ''}`} onPress={onPress}>
      <Row gap={SP.l}>
        <Txt v="label" style={{ width: 30 }}>
          {word}
        </Txt>
        <Txt v="nm" c={end ? 'ink' : 'muted'} numberOfLines={1} style={{ flex: 1 }}>
          {end ? endpointLabel(end) : endpointPlaceholder(side)}
        </Txt>
      </Row>
    </Pressable>
  );
}

function PickLine({ icon, title, sub, onPress }: { icon: IconName; title: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} onPress={onPress} style={styles.pickLine}>
      <Icon name={icon} size={18} color="muted" />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="nm" numberOfLines={1}>
          {title}
        </Txt>
        {sub ? (
          <Txt v="mtTight" numberOfLines={1}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * 끝점 고르기 시트. 검색 · 내 위치 · 지도에서 고르기 · 기점 · 여행방 스팟.
 * 검색은 두 글자 이상에서 400ms 멈추면 찾고 엔터는 바로 찾는다. 앞선 검색 응답이 늦게 와도 덮어쓰지 않는다.
 */
function EndpointPicker({
  side,
  other,
  regionFor,
  anywhereFor,
  base,
  spots,
  liveCoord,
  onClose,
  onMapPick,
  onPick,
}: {
  side: EndpointSide | undefined;
  other: Endpoint | undefined;
  regionFor: (near: LatLng | undefined) => ReturnType<typeof searchRegionFor>;
  anywhereFor: (near: LatLng | undefined) => boolean;
  base: Endpoint | undefined;
  spots: Endpoint[];
  liveCoord: LatLng | undefined;
  onClose: () => void;
  onMapPick: () => void;
  onPick: (side: EndpointSide, e: Endpoint) => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Place[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [locBusy, setLocBusy] = useState(false);
  const guard = useRef(createRequestGuard()).current;
  // 내 위치 한 번 읽기(최대 12초)도 번호를 매겨, 시트를 닫거나 다른 쪽으로 다시 열면 늦은 결과를 버린다
  const locGuard = useRef(createRequestGuard()).current;
  const lastAsked = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = side !== undefined;

  const reset = () => {
    guard.cancel();
    locGuard.cancel();
    if (timer.current) clearTimeout(timer.current);
    lastAsked.current = undefined;
    setQuery('');
    setFound(undefined);
    setBusy(false);
    setError(undefined);
    setLocBusy(false);
  };

  const run = async (q: string) => {
    const region = regionFor(other?.coord);
    const term = q.trim();
    if (!searchable(term) || !region) return;
    const anywhere = anywhereFor(other?.coord);
    const ask = `${anywhere ? '*' : region.id}:${term}`;
    if (ask === lastAsked.current) return;
    lastAsked.current = ask;
    const token = guard.begin();
    setBusy(true);
    setError(undefined);
    try {
      const res = await getServices().places.search(term, region, searchBiasFor(other, region), { anywhere });
      if (guard.isCurrent(token)) setFound(res);
    } catch {
      if (guard.isCurrent(token)) {
        lastAsked.current = undefined;
        setFound(undefined);
        setError('장소 검색에 실패했습니다. 잠시 뒤 다시 시도해 주세요.');
      }
    } finally {
      if (guard.isCurrent(token)) setBusy(false);
    }
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!visible) return;
    if (!searchable(query)) {
      guard.cancel();
      lastAsked.current = undefined;
      setFound(undefined);
      setBusy(false);
      return;
    }
    timer.current = setTimeout(() => void run(query), SEARCH_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // run은 매 렌더 새로 만들어지지만 검색어·표시 여부가 바뀔 때만 예약한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, visible]);

  // 시트가 어떤 길로든 닫히면(고르기 · 지도에서 고르기 · 닫기) 검색어 · 결과 · 진행 중인 요청을 모두 비운다
  useEffect(() => {
    if (!visible) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(
    () => () => {
      guard.cancel();
      locGuard.cancel();
      if (timer.current) clearTimeout(timer.current);
    },
    [guard, locGuard],
  );

  const close = () => {
    reset();
    onClose();
  };
  const pick = (e: Endpoint) => {
    if (!side) return;
    reset();
    onPick(side, e);
  };

  // 내 위치: 사용자가 이 줄을 눌렀을 때만 읽는다. 여행 진행 중이면 그 위치를 쓴다
  const pickMe = async () => {
    if (liveCoord) {
      pick({ kind: 'me', name: ME_NAME, coord: liveCoord });
      return;
    }
    if (locBusy) return;
    const token = locGuard.begin();
    setLocBusy(true);
    setError(undefined);
    const r = await readLocationOnce(getServices().location);
    // 그 사이 시트를 닫았거나 다시 열었으면 끝점을 바꾸지 않는다(위치도 경로 서버로 보내지 않는다)
    if (!locGuard.isCurrent(token)) return;
    setLocBusy(false);
    if (r.ok) pick({ kind: 'me', name: ME_NAME, coord: r.sample.coord });
    else
      setError(
        r.reason === 'denied'
          ? '위치 권한이 없어 내 위치를 쓸 수 없습니다. 검색이나 지도에서 골라 주세요.'
          : '지금 위치를 받지 못했습니다. 잠시 뒤 다시 시도하거나 검색으로 골라 주세요.',
      );
  };

  const title = side === 'to' ? '도착 고르기' : '출발 고르기';
  return (
    <Sheet visible={visible} onClose={close} title={title}>
      <Field
        label="장소 검색"
        value={query}
        onChangeText={setQuery}
        placeholder="예: 경주역, 첨성대"
        help="두 글자 이상 입력하면 찾습니다"
        onSubmitEditing={() => {
          if (timer.current) clearTimeout(timer.current);
          void run(query);
        }}
      />
      {error ? <Notice tone="warn" icon="alert" text={error} /> : null}
      <ScrollView style={{ flexGrow: 0, maxHeight: LIST_MAX_H }} contentContainerStyle={{ gap: SP.xs }}>
        {busy ? <Txt v="mtTight">찾는 중</Txt> : null}
        {found && found.length === 0 && !busy ? <Txt v="mt">{`'${query.trim()}'에 맞는 장소가 없습니다.`}</Txt> : null}
        {found && found.length > 0
          ? found.map((p) => (
              <PickLine
                key={p.placeId}
                icon="search"
                title={p.name}
                sub={[p.kind ?? p.category, p.address].filter(Boolean).join(' · ')}
                onPress={() => pick({ kind: 'place', name: p.name, coord: p.coord, id: p.placeId })}
              />
            ))
          : null}
        {!found ? (
          <>
            <PickLine icon="locate" title={locBusy ? '내 위치 찾는 중' : ME_NAME} sub="고를 때만 위치를 읽습니다" onPress={() => void pickMe()} />
            <PickLine
              icon="map"
              title="지도에서 고르기"
              onPress={() => {
                reset();
                onMapPick();
              }}
            />
            {base ? <PickLine icon="home" title={endpointLabel(base)} onPress={() => pick(base)} /> : null}
            {spots.map((s) => (
              <PickLine key={s.id} icon="pin" title={s.name} sub="여행방 스팟" onPress={() => pick(s)} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pickBanner: { position: 'absolute', left: SP.gutter, right: SP.gutter, top: 14 },
  modeCell: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: SP.m,
    paddingHorizontal: SP.m,
    borderRadius: R.field,
    borderWidth: 1,
    borderColor: lineC.line,
    backgroundColor: surfaceC.card,
  },
  modeOn: { borderWidth: 2, borderColor: lineC.accent, paddingVertical: SP.m - 1, paddingHorizontal: SP.m - 1 },
  pickLine: { flexDirection: 'row', alignItems: 'center', gap: SP.l, paddingVertical: SP.m },
});
