import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MapCanvas } from '../components/map/MapCanvas';
import { TRANSPORT_LABEL } from '../core/constants';
import { etaView, pickLiveDate } from '../core/live/session';
import { dayOrdinal, daySummary } from '../core/map/model';
import { dayLabel, dayShort, humanMin, weekday } from '../core/util';
import '../features/live/photoBridge';
import { useHomeBack } from '../navigation/useBack';
import { useDayMap } from '../features/live/useDayMap';
import { TripBar } from '../features/trip/components/TripBar';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { useLive } from '../store/live';
import { usePlan, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import type { DayPlan, Plan, TimetableItem, Trip } from '../types';
import {
  Btn,
  Chip,
  dayColor,
  Empty,
  H,
  Header,
  Icon,
  IconBtn,
  lineC,
  mapC,
  MapPill,
  PeekSheet,
  R,
  Row,
  Screen,
  Seg,
  SP,
  surfaceC,
  Txt,
  type SheetSnap,
} from '../ui';

/**
 * 11 지도 · 루트(FR-801~803, WP5 소유). 지도는 MapCanvas 한 벌이라 키가 없어도 모든 플랫폼에서 그려진다.
 * - 방은 useActiveTrip이 정하고, 왼쪽 위 TripBar 칩에서 그 자리에서 바꾼다. 오른쪽 위 '길찾기' 알약은 27 자유 길찾기다.
 * - 핀에 방문 순번을 박아 지도와 시간표가 같은 순서로 읽힌다. 기점은 속 빈 링, 제외 스팟은 흰 핀('제외').
 * - 날짜별 선 색은 잉크, 청회색, 초록, 앰버. estimated 구간은 직선이다. 밀집 마커는 숫자 원으로 묶는다.
 * - 핀·목록 줄·묶음 목록을 누르면 상세로 가지 않고 그 스팟을 고른다. 시트에 선택 카드(순번, 이름, 도착·체류·앞 구간,
 *   [상세 보기] [구간 안내] [여기까지 길찾기])가 뜨고 지도는 그 스팟으로 당긴다. 같은 핀을 다시 누르거나 x로 푼다.
 * - 하단 시트는 공용 PeekSheet(peek·full, 지도 높이의 60%까지)다. 머리 줄 하나를 누르거나 손잡이를 끌어 접고 편다.
 *   접힌 시트에는 날짜 Seg, 머리 줄, 버튼 줄만 있고 스팟 목록과 제외 스팟은 펼쳤을 때 보인다. OSM 출처는 시트 맨 끝 한 줄이다.
 * - 이 방이 여행 진행 중이면 '여행 진행' 버튼 자리에 '진행 중 · 다음 {스팟} · 예상 {시각}' 한 줄을 두고 누르면 19로 간다.
 * - 오른쪽 아래 '내 위치' 버튼(MapCanvas locate)은 누를 때만 위치를 읽는다. 진행 중이면 그 위치를 쓴다. 위치는 기기 안에서만 쓴다.
 * - '구간 안내'는 13 계획 구간 내비, '길찾기'는 27 아무 두 지점이다. 여행방이 없어도 머리줄에서 길찾기를 연다.
 */

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SNAPS: readonly SheetSnap[] = ['peek', 'full'];
/** 펼친 시트는 지도 높이의 60%까지 */
const SHEET_MAX_RATIO = 0.6;
/** 고른 핀을 조금 크게 그린다 */
const PICKED_SCALE = 1.3;
const NUM_W = 20;
const NUM_DOT = 24;
const LEGEND_DOT = 10;

const isBase = (id: string) => id === 'base' || id.startsWith('base:');

/** Seg 칸 이름 '17 금' */
function segLabel(date: string): string {
  return `${Number(date.slice(8))} ${WEEK[weekday(date)]}`;
}

/** 계획에서 그 스팟이 들어 있는 날과 순번 */
function findPlanned(plan: Plan | undefined, spotId: string): { day: DayPlan; index: number; item: TimetableItem } | undefined {
  for (const day of plan?.days ?? []) {
    const index = day.items.findIndex((it) => it.spotId === spotId);
    if (index >= 0) return { day, index, item: day.items[index] };
  }
  return undefined;
}

/** 고른 스팟 이름. 계획, 제외, 루트 계산 전 후보 순으로 찾는다. 어디에도 없으면(동기화로 빠짐) undefined */
function spotNameOf(trip: Trip, plan: Plan | undefined, spotId: string): string | undefined {
  return (
    findPlanned(plan, spotId)?.item.name ??
    plan?.excluded.find((x) => x.spotId === spotId)?.name ??
    trip.spots.find((s) => s.id === spotId && !s.removedByUser)?.name
  );
}

export default function MapScreen({ navigation, route }: TabScreenProps<'Map'>) {
  const homeBack = useHomeBack();
  const { trip } = useActiveTrip();
  const plan = usePlan(trip?.id);
  const now = useNow();
  const paramDate = route.params?.date;
  const [picked, setPicked] = useState<string | undefined>(paramDate);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [mapH, setMapH] = useState(0);
  const [sheetH, setSheetH] = useState(0);
  const sheetScroll = useRef<ScrollView>(null);
  // 시간표·여행 진행에서 날짜를 넘겨 다시 열면 그 날짜를 따라간다(탭 화면은 내려가지 않아 첫 값만으로는 모자란다).
  // 같은 날짜를 다시 넘겨도('전체'로 바꾼 뒤 다시 '지도') 따라가도록 값이 아니라 params 객체에 건다.
  // navigate는 params를 새로 만들고, 탭 바 누름은 같은 객체를 그대로 두므로 고른 날짜를 덮지 않는다.
  const params = route.params;
  useEffect(() => {
    const d = params?.date;
    if (d) setPicked(d);
  }, [params]);

  // 다른 방으로 바꾸면 앞 방의 날짜는 버리고 그 방의 오늘(또는 첫날)을 고른다
  const pickedOk = picked !== undefined && (picked === 'all' || !plan || plan.days.some((d) => d.date === picked));
  const date: string | 'all' = pickedOk ? picked : trip ? pickLiveDate(trip, plan, now) : 'all';
  const map = useDayMap(trip, plan, date);
  const liveHere = useLive((s) => !!trip && s.mode !== 'off' && s.tripId === trip.id);
  const liveLast = useLive((s) => (trip && s.mode !== 'off' && s.tripId === trip.id ? s.last : undefined));
  const liveDate = useLive((s) => s.date);
  const timing = useLive((s) => s.timing);

  // 날짜나 방이 바뀌면 고른 스팟을 푼다
  useEffect(() => {
    setSelected(undefined);
  }, [date, trip?.id]);
  // 고른 스팟이 계획·제외·후보 어디에도 없으면(동기화로 빠짐) 빈 카드를 그리지 않고 선택을 푼다
  const selectedName = selected && trip ? spotNameOf(trip, plan, selected) : undefined;
  useEffect(() => {
    if (selected && selectedName === undefined) setSelected(undefined);
  }, [selected, selectedName]);
  // 펼친 목록을 내려 둔 채 핀을 골라도 카드가 보이게 시트 맨 위로 올린다
  useEffect(() => {
    if (selected) sheetScroll.current?.scrollTo({ y: 0, animated: false });
  }, [selected]);

  const dayIndex = plan ? plan.days.findIndex((d) => d.date === date) : -1;
  const day = dayIndex >= 0 ? plan?.days[dayIndex] : undefined;
  const summary = useMemo(() => (day ? daySummary(day) : undefined), [day]);
  const pickedMarker = selected ? map.markers.find((m) => m.id === selected) : undefined;
  const markers = useMemo(
    () => (pickedMarker ? map.markers.map((m) => (m.id === pickedMarker.id ? { ...m, scale: PICKED_SCALE } : m)) : map.markers),
    [map.markers, pickedMarker],
  );
  const fitTo = useMemo(() => (pickedMarker ? [pickedMarker.coord] : undefined), [pickedMarker]);

  if (!trip) {
    return (
      <Screen>
        <Header
          back={homeBack}
          title="지도"
          right={<IconBtn icon="nav" label="길찾기" onPress={() => navigation.navigate('Directions', undefined)} />}
        />
        <Empty
          icon="map"
          title="여행방이 없어요"
          text="여행방을 만들면 날짜별 루트가 지도에 그려져요"
          action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
        />
      </Screen>
    );
  }

  const tripId = trip.id;
  const expanded = snap === 'full';
  const transport = day ? (trip.days.find((d) => d.date === day.date)?.transport ?? trip.transport) : trip.transport;
  const excluded = plan?.excluded ?? [];
  const rows = day?.items ?? [];
  const unplanned = !!map.model?.unplanned;
  const segItems = [
    { key: 'all', label: '전체', a11yLabel: '전체 날짜' },
    ...(plan?.days ?? []).map((d) => ({ key: d.date, label: segLabel(d.date), a11yLabel: dayLabel(d.date) })),
  ];
  // 진행 중이면 진행 중인 구간, 아니면 첫 구간을 연다
  const liveLeg = liveHere && day && liveDate === day.date && timing ? map.legs.find((l) => l.toId === timing.spotId) : undefined;
  const firstLeg = day ? (liveLeg ?? map.legs[0]) : undefined;

  // 같은 핀을 다시 누르면 풀고, 새로 고르면 목록 줄처럼 시트를 접어 카드를 보인다.
  // 겹친 스팟 목록에서 고른 것은 다시 누르기가 아니므로 늘 고른다(onClusterPick → pickRow)
  const pressMarker = (id: string) => {
    if (isBase(id)) return;
    if (selected === id) {
      setSelected(undefined);
      return;
    }
    setSelected(id);
    setSnap('peek');
  };
  const pickRow = (id: string) => {
    setSelected(id);
    setSnap('peek');
  };
  const restore = (spotId: string, name: string) => {
    const r = useTrips.getState().dispatch(tripId, { type: 'spot/restore', spotId });
    if (r.ok) useUi.getState().showToast(`${name}을(를) 고정으로 되돌리고 루트를 다시 맞춰요`);
  };
  const openLive = () => navigation.navigate('LiveTrip', { tripId, date: liveDate });

  const title = day ? `${dayOrdinal(dayIndex)} 루트` : '전체 루트';
  const sub = summary
    ? `${TRANSPORT_LABEL[transport]} · 이동 ${humanMin(summary.travelMin)} · 체류 ${humanMin(summary.stayMin)}`
    : unplanned
      ? '루트 계산 전'
      : undefined;
  const liveText = timing
    ? `진행 중 · 다음 ${timing.name} · 예상 ${etaView(timing).eta}`
    : timing === null
      ? '진행 중 · 오늘 일정을 다 돌았어요'
      : '진행 중';

  const head = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}, ${sub}` : title}
      accessibilityHint={expanded ? '목록을 접어요' : '스팟 목록을 펼쳐요'}
      accessibilityState={{ expanded }}
      onPress={() => setSnap(expanded ? 'peek' : 'full')}
      style={styles.head}
    >
      <View style={styles.headText}>
        <Txt v="nm" numberOfLines={1}>
          {title}
        </Txt>
        {sub ? (
          <Txt v="mtTight" numberOfLines={1}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <Icon name={expanded ? 'down' : 'up'} size={18} color="muted" stroke={2.2} />
    </Pressable>
  );

  const liveLine = liveHere ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${liveText}, 여행 진행 열기`} onPress={openLive} style={styles.liveLine}>
      <Icon name="play" size={16} color="accent" stroke={2} />
      <Txt v="mt" c="ink" numberOfLines={1} style={styles.grow}>
        {liveText}
      </Txt>
      <Icon name="right" size={16} color="muted" />
    </Pressable>
  ) : null;

  const actions = unplanned ? (
    <Btn title="루트 계산" size="sm" onPress={() => navigation.navigate('Planning', { tripId })} />
  ) : day && rows.length > 0 ? (
    <Row gap={SP.m}>
      <View style={styles.grow}>
        <Btn
          title="구간 안내"
          icon="nav"
          size="sm"
          variant="quiet"
          onPress={() => navigation.navigate('Navigate', { tripId, date: day.date, legIndex: firstLeg?.index ?? 0 })}
        />
      </View>
      {liveHere ? null : (
        <View style={styles.grow}>
          <Btn title="여행 진행" icon="play" size="sm" onPress={() => navigation.navigate('LiveTrip', { tripId, date: day.date })} />
        </View>
      )}
    </Row>
  ) : null;

  return (
    <Screen>
      {/* 다른 화면이 위에 쌓여 이 화면이 숨으면(웹 display:none) 높이가 0으로 온다. 그때 지도를 내리지 않아야
          돌아왔을 때 지도를 새로 불러오지 않는다(구글 지도는 띄울 때마다 사용량이 든다) */}
      <View
        style={styles.area}
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
            polylines={map.polylines}
            fitTo={fitTo}
            user={liveLast ? { coord: liveLast.coord, accuracyM: liveLast.accuracyM } : undefined}
            onMarkerPress={pressMarker}
            onClusterPick={(id) => {
              if (!isBase(id)) pickRow(id);
            }}
            overlayBottom={sheetH}
            locate
          >
            <View style={styles.top}>
              <MapPill icon="back" label="홈" a11yLabel="뒤로, 홈으로" onPress={homeBack} />
              <View style={styles.tripChip}>
                <TripBar variant="chip" />
              </View>
              {/* 27 자유 길찾기(아무 두 지점 · 수단 비교). 시트의 '구간 안내'는 13 계획 구간 내비다 */}
              <MapPill icon="nav" label="길찾기" onPress={() => navigation.navigate('Directions', { tripId })} />
            </View>
          </MapCanvas>
        ) : null}

        <PeekSheet
          snap={snap}
          onSnap={setSnap}
          snaps={SNAPS}
          areaHeight={mapH}
          maxRatio={SHEET_MAX_RATIO}
          gripLabel="루트 목록"
          onSettle={setSheetH}
          head={head}
        >
          <ScrollView ref={sheetScroll} style={styles.grow} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* 스팟을 고른 동안은 날짜 Seg를 접어 360px 접힌 시트에서도 카드 버튼 줄이 보이게 한다(x로 풀면 돌아온다) */}
            {segItems.length > 2 && !selected ? <Seg items={segItems} value={date} onChange={(k) => setPicked(k)} /> : null}

            {selected && selectedName !== undefined ? (
              <PickedCard
                spotId={selected}
                name={selectedName}
                plan={plan}
                legToIndex={map.legs.find((l) => l.toId === selected)?.index}
                onClose={() => setSelected(undefined)}
                onDetail={() => navigation.navigate('SpotDetail', { tripId, spotId: selected })}
                onNavigate={(d, legIndex) => navigation.navigate('Navigate', { tripId, date: d, legIndex })}
                onDirections={() => navigation.navigate('Directions', { tripId, toSpotId: selected })}
                onRestore={restore}
              />
            ) : (
              <>
                {liveLine}
                {actions}
              </>
            )}

            {day ? (
              rows.length === 0 ? (
                <Txt v="mt">이 날은 확정 스팟이 없어요.</Txt>
              ) : null
            ) : unplanned ? (
              <Txt v="mt">지금은 후보 위치만 보여요.</Txt>
            ) : (
              <Row gap={SP.xl} wrap>
                {(plan?.days ?? []).map((d, i) =>
                  d.items.length > 0 ? (
                    <Row key={d.date} gap={SP.s}>
                      <View style={[styles.legendDot, { backgroundColor: mapC[dayColor(i)] }]} />
                      <Txt v="mtTight">{`${dayShort(d.date)} · ${d.items.length}곳`}</Txt>
                    </Row>
                  ) : null,
                )}
              </Row>
            )}

            {!expanded && excluded.length > 0 ? (
              <View style={styles.start}>
                <Btn title={`제외 스팟 ${excluded.length}곳`} size="sm" variant="quiet" onPress={() => setSnap('full')} />
              </View>
            ) : null}

            {expanded && day && rows.length > 0 ? (
              <View>
                {rows.map((it, i) => {
                  const on = it.spotId === selected;
                  return (
                    <Pressable
                      key={it.spotId}
                      accessibilityRole="button"
                      accessibilityLabel={`${i + 1}번째 ${it.name}, 도착 ${it.arrive}`}
                      accessibilityState={{ selected: on }}
                      onPress={() => pickRow(it.spotId)}
                      style={[styles.listRow, on ? styles.listRowOn : null]}
                    >
                      <View style={styles.num}>
                        <Txt v="time" c="accent">
                          {String(i + 1)}
                        </Txt>
                      </View>
                      <Txt v="nm" numberOfLines={1} style={styles.grow}>
                        {it.name}
                      </Txt>
                      {it.pinned ? <Chip text="고정" tone="soft" /> : null}
                      <Txt v="mtTight">{it.arrive}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {expanded && excluded.length > 0 ? (
              <View style={styles.excluded}>
                <Txt v="label">{`제외 스팟 ${excluded.length}`}</Txt>
                {excluded.map((x) => (
                  <Row key={x.spotId} gap={SP.l}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${x.name}, ${x.reason}`}
                      style={styles.excludedText}
                      onPress={() => pickRow(x.spotId)}
                    >
                      <Txt v="nm" numberOfLines={1}>
                        {x.name}
                      </Txt>
                      <Txt v="mtTight">{`${x.reason} · 제안자 ${x.proposerCount}명`}</Txt>
                    </Pressable>
                    <Btn title="되돌리기" icon="undo" size="sm" variant="quiet" onPress={() => restore(x.spotId, x.name)} />
                  </Row>
                ))}
              </View>
            ) : null}

            {map.osmRoads ? <Txt v="mtTight">선은 실제 길 모양 · 길 데이터 OpenStreetMap 기여자</Txt> : null}
          </ScrollView>
        </PeekSheet>
      </View>
    </Screen>
  );
}

/**
 * 고른 스팟 카드. 계획에 든 스팟이면 순번, 도착·체류·앞 구간과 [상세 보기] [구간 안내] [여기까지 길찾기],
 * 제외 스팟이면 사유와 [상세 보기] [되돌리기], 루트 계산 전 후보면 [상세 보기] [여기까지 길찾기]다.
 */
function PickedCard({
  spotId,
  name,
  plan,
  legToIndex,
  onClose,
  onDetail,
  onNavigate,
  onDirections,
  onRestore,
}: {
  spotId: string;
  /** spotNameOf로 찾은 이름(루트 계산 전 후보도 이름이 있다) */
  name: string;
  plan: Plan | undefined;
  legToIndex: number | undefined;
  onClose: () => void;
  onDetail: () => void;
  onNavigate: (date: string, legIndex: number) => void;
  onDirections: () => void;
  onRestore: (spotId: string, name: string) => void;
}) {
  const planned = findPlanned(plan, spotId);
  const ex = planned ? undefined : plan?.excluded.find((x) => x.spotId === spotId);
  const it = planned?.item;
  const facts = it
    ? [`도착 ${it.arrive}`, `체류 ${humanMin(it.stayMin)}`, it.travelMin > 0 ? `앞 구간 ${humanMin(it.travelMin)}` : undefined]
        .filter(Boolean)
        .join(' · ')
    : ex
      ? `제외 · ${ex.reason}`
      : '루트 계산 전 후보';
  const canNavigate = !!planned && legToIndex !== undefined;
  return (
    <View style={styles.card}>
      <Row gap={SP.l}>
        {/* 순번은 아래 묶음 이름이 'n번째 스팟'으로 읽으므로 스크린리더에서 숨긴다 */}
        {planned ? (
          <View style={styles.numDot} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Txt v="chip" c="onInk">
              {String(planned.index + 1)}
            </Txt>
          </View>
        ) : null}
        <View
          accessible
          accessibilityLabel={planned ? `${planned.index + 1}번째 스팟 ${name}, ${facts}` : `${name}, ${facts}`}
          style={styles.grow}
        >
          <Txt v="nm" numberOfLines={1}>
            {name}
          </Txt>
          <Txt v="mtTight" numberOfLines={1}>
            {facts}
          </Txt>
        </View>
        <IconBtn icon="x" label="선택 풀기" onPress={onClose} />
      </Row>
      <Row gap={SP.m} wrap>
        <Btn title="상세 보기" size="sm" variant="quiet" onPress={onDetail} />
        {ex ? (
          <Btn title="되돌리기" icon="undo" size="sm" onPress={() => onRestore(spotId, ex.name)} />
        ) : (
          <>
            {canNavigate && planned ? (
              <Btn title="구간 안내" size="sm" onPress={() => onNavigate(planned.day.date, legToIndex)} />
            ) : null}
            <Btn title="여기까지 길찾기" size="sm" variant={canNavigate ? 'quiet' : 'primary'} onPress={onDirections} />
          </>
        )}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, minHeight: 0 },
  grow: { flex: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  // 칩 사이 빈 곳은 지도가 누름을 받는다(인라인 pointerEvents는 RN Web 0.21이 버린다)
  top: {
    position: 'absolute',
    top: 14,
    left: SP.gutter,
    right: SP.gutter,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SP.m,
    pointerEvents: 'box-none',
  },
  tripChip: { flexShrink: 1, minWidth: 0 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
    minHeight: H.touch,
    paddingHorizontal: SP.gutter,
    paddingBottom: SP.s,
  },
  headText: { flex: 1, minWidth: 0 },
  body: { gap: SP.l, paddingHorizontal: SP.gutter, paddingTop: SP.xs, paddingBottom: SP.xxl },
  liveLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
    minHeight: H.touch,
    paddingHorizontal: SP.xl,
    borderRadius: R.btnSm,
    backgroundColor: surfaceC.soft,
  },
  card: {
    gap: SP.l,
    padding: SP.xl,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: lineC.line,
    backgroundColor: surfaceC.card,
  },
  numDot: {
    width: NUM_DOT,
    height: NUM_DOT,
    borderRadius: R.chip,
    backgroundColor: surfaceC.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.l,
    minHeight: H.touch,
    paddingHorizontal: SP.s,
    borderRadius: R.btnSm,
  },
  listRowOn: { backgroundColor: surfaceC.soft },
  num: { width: NUM_W },
  excluded: { gap: SP.m, paddingTop: SP.s },
  excludedText: { flex: 1, gap: 2, minHeight: H.touch, justifyContent: 'center' },
  legendDot: { width: LEGEND_DOT, height: LEGEND_DOT, borderRadius: LEGEND_DOT / 2 },
});
