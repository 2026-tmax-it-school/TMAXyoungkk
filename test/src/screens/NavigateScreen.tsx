import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import type { MapMarkerInput, MapPolylineInput } from '../core/map/layout';
import { TRANSPORT_LABEL } from '../core/constants';
import { makePath, progressOnPath } from '../core/live/legPath';
import { etaView } from '../core/live/session';
import { coordLookup, dayLegs, distanceText, legProgress, legShape, legSteps, polylineProgress, stepIndexAt } from '../core/map/model';
import { dayLabel, toHHMM, toMin } from '../core/util';
import { MapCanvas } from '../components/map/MapCanvas';
import { useLegGeometry } from '../components/map/useLegGeometry';
import { SimBanner } from '../features/live/components/SimBanner';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useLive, useSimBanner } from '../store/live';
import { usePlan, useTripDoc } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Btn,
  Card,
  Chip,
  dayColor,
  E,
  Empty,
  Foot,
  H,
  Header,
  Icon,
  IconBtn,
  lineC,
  NotFound,
  R,
  Row,
  Screen,
  SP,
  surfaceC,
  Txt,
} from '../ui';

/**
 * 13 구간 안내 · 계획 구간 내비(FR-601~603, 2차, WP5 소유). '길찾기'라는 이름은 27 자유 길찾기에만 쓴다.
 * 구간 안내 줄은 경로 제공자의 steps를 쓰고, 없으면(로컬 추정) 방위와 거리로 만든다(core/map/model.legSteps).
 * 선은 실제 길 모양(OpenStreetMap·카카오)이면 그 길을 따르고, 그때 진행률도 길을 따라 잰다. OSM이면 출처 칩을 단다.
 * 추정 칩은 보여 주는 시간(계획 값)이 추정일 때만 단다. 선이 실제 길이면 '시간 추정', 직선이면 '직선거리 추정'이다.
 * 여행 진행 중이면 현재 위치로 진행률을 재서 지금 따라가는 줄을 고르고, 다음 스팟이 바뀌면 그 구간으로 따라간다.
 * 사용자가 이전·다음으로 직접 넘긴 뒤에는 따라가지 않는다(userPaged). 시뮬레이터면 line 톤 띠를 둔다(앰버 띠 없음).
 * 머리말은 한 줄(Header row, eyebrow '구간 안내 · 날짜')이고 뒤로는 useBack('Map')이다. 지도 오른쪽 아래에 '내 위치' 버튼이 있다.
 * 아래 시트 첫 줄은 [이전] '구간 2/5 · 석굴암까지' [다음], 그 아래 분(nmLg), 거리·도착·예상, 칩, 안내 줄 순이다.
 * 버튼(Foot): 진행 중이면 '카카오맵으로 열기' 하나, 아니면 [카카오맵으로 열기] [여행 진행 시작(19)]이다.
 * 루트 계산 전이라 구간이 없으면 Empty에 '루트 계산'을 둔다.
 */

/** 구간 안내 목록 높이(약 3줄). 나머지는 스크롤한다 */
const STEPS_MAX_H = 84;

const NO_LEGS: never[] = [];

export default function NavigateScreen({ navigation, route }: RootScreenProps<'Navigate'>) {
  const { tripId, date } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const [legIndex, setLegIndex] = useState(route.params.legIndex);
  const [mapH, setMapH] = useState(0);
  const simBanner = useSimBanner(tripId, date);
  const liveHere = useLive((s) => s.tripId === tripId && s.date === date && s.mode !== 'off');
  const last = useLive((s) => s.last);
  const timing = useLive((s) => s.timing);
  const back = useBack('Map');

  const dayIndex = plan ? plan.days.findIndex((d) => d.date === date) : -1;
  const day = dayIndex >= 0 ? plan?.days[dayIndex] : undefined;
  const legs = useMemo(() => (trip && day ? dayLegs(day, coordLookup(trip), trip.transport) : NO_LEGS), [trip, day]);
  const pos = Math.max(0, legs.findIndex((l) => l.index === legIndex));
  const leg = legs[pos];
  const geoMap = useLegGeometry(useMemo(() => (leg ? [leg] : NO_LEGS), [leg]));
  const geo = leg ? geoMap[leg.key] : undefined;
  const steps = useMemo(() => (leg ? legSteps(leg, geo) : []), [leg, geo]);
  // 길을 따라 잰 진행 위치. U턴처럼 길이 겹치는 구간에서 반대 차선으로 튀지 않게 지난 위치(같은 구간)를 넘긴다
  // (core/live/legPath.projectOnPath 규칙, 여행 진행 엔진과 같다)
  const alongRef = useRef<{ key: string; alongM: number } | undefined>(undefined);
  const roadPath = useMemo(() => (leg && geo?.road ? makePath(legShape(leg, geo)) : undefined), [leg, geo]);
  const onRoad = useMemo(() => {
    if (!roadPath || !leg || !liveHere || !last) return undefined;
    const prev = alongRef.current?.key === leg.key ? alongRef.current.alongM : undefined;
    return progressOnPath(roadPath, last.coord, prev);
  }, [roadPath, leg, liveHere, last]);
  useEffect(() => {
    if (onRoad && leg) alongRef.current = { key: leg.key, alongM: onRoad.alongM };
  }, [onRoad, leg]);

  // 진행 중이면 다음 스팟으로 가는 구간을 따라간다. 사용자가 이전·다음을 누른 뒤에는 따라가지 않는다(userPaged).
  // 처음에는 기본으로 연 경우(그날 첫 구간이거나 없는 구간)에만 바로 진행 중인 구간으로 옮기고,
  // 지도 카드처럼 특정 구간을 골라 열었으면 다음 스팟이 바뀔 때부터 따라간다
  const userPaged = useRef(false);
  const seenSpot = useRef<string | undefined>(undefined);
  const openedAt = route.params.legIndex;
  const nextSpotId = liveHere && timing ? timing.spotId : undefined;
  useEffect(() => {
    if (!nextSpotId || userPaged.current) return;
    if (legs.length === 0 || nextSpotId === seenSpot.current) return;
    const first = seenSpot.current === undefined;
    seenSpot.current = nextSpotId;
    if (first && legs.findIndex((l) => l.index === openedAt) > 0) return;
    const follow = legs.find((l) => l.toId === nextSpotId);
    if (follow) setLegIndex(follow.index);
  }, [nextSpotId, legs, openedAt]);
  const page = (index: number) => {
    userPaged.current = true;
    setLegIndex(index);
  };

  if (!trip) {
    return (
      <Screen>
        <Header size="row" back={back} title="구간 안내" />
        <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
      </Screen>
    );
  }
  if (!day || !leg) {
    return (
      <Screen>
        <Header size="row" back={back} eyebrow={`구간 안내 · ${dayLabel(date)}`} title={trip.title} />
        <Empty
          icon="nav"
          title="안내할 구간이 없어요"
          text="루트를 계산하면 구간마다 길 안내가 생겨요"
          action={{ label: '루트 계산', onPress: () => navigation.navigate('Planning', { tripId, date }) }}
        />
      </Screen>
    );
  }

  const shape = legShape(leg, geo);
  // 길 모양이 있으면 그 길을 따라 진행률을 잰다(안내 줄 거리도 길 기준이다). 길에서 150m 넘게 벗어나면 가장 가까운 지점으로 잰다
  const progress =
    liveHere && last
      ? onRoad
        ? onRoad.fraction
        : geo?.road
          ? polylineProgress(shape, last.coord)
          : legProgress(leg.from, leg.to, last.coord)
      : 0;
  const stepIdx = Math.max(0, stepIndexAt(steps, progress));
  const current = steps[stepIdx];
  const nextStep = steps[stepIdx + 1];
  const meters = geo?.meters ?? steps.reduce((s, x) => s + x.meters, 0);
  const road = geo?.road;
  // 보여 주는 분은 계획 값이다. 실제 길 시간이면 길 모양을 받기 전이나 못 받았을 때도 추정 칩을 달지 않는다
  const timeEstimated = leg.estimated;
  const toItemIdx = day.items.findIndex((i) => i.spotId === leg.toId);
  const arrive =
    toItemIdx >= 0
      ? day.items[toItemIdx].arrive
      : toHHMM(toMin(day.items[day.items.length - 1]?.depart ?? '00:00') + day.returnMin);
  const eta = liveHere && timing && timing.spotId === leg.toId ? etaView(timing) : undefined;
  const color = dayColor(Math.max(0, dayIndex));

  const markers: MapMarkerInput[] = [
    leg.fromId === 'base'
      ? { id: 'base', coord: leg.from, kind: 'base', title: leg.fromName }
      : { id: leg.fromId, coord: leg.from, kind: 'spot', label: String(day.items.findIndex((i) => i.spotId === leg.fromId) + 1), title: leg.fromName },
    leg.toId === 'base'
      ? { id: 'base-to', coord: leg.to, kind: 'base', title: leg.toName }
      : { id: leg.toId, coord: leg.to, kind: 'spot', label: String(toItemIdx + 1), title: leg.toName },
  ];
  const polylines: MapPolylineInput[] = [{ id: 'leg', coords: shape, color }];

  const openMapApp = () => {
    const url = `https://map.kakao.com/link/to/${encodeURIComponent(leg.toName)},${leg.to.latitude},${leg.to.longitude}`;
    Linking.openURL(url).catch(() => useUi.getState().showToast('카카오맵을 열지 못했어요', 'warn'));
  };

  const hasPrev = pos > 0;
  const hasNext = pos < legs.length - 1;
  const legTitle = `구간 ${pos + 1}/${legs.length} · ${leg.toName}까지`;

  return (
    <Screen>
      <Header size="row" back={back} eyebrow={`구간 안내 · ${dayLabel(date)}`} title={trip.title} />
      {simBanner ? (
        <View style={styles.banner}>
          <SimBanner />
        </View>
      ) : null}

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
            polylines={polylines}
            user={liveHere && last ? { coord: last.coord, accuracyM: last.accuracyM } : undefined}
            onMarkerPress={(id) => {
              if (!id.startsWith('base')) navigation.navigate('SpotDetail', { tripId, spotId: id });
            }}
            overlayBottom={R.sheet}
            locate
          >
            <View style={[styles.stepCard, E.float]}>
              <Card>
                <Row gap={SP.l}>
                  <View style={styles.stepIcon}>
                    <Icon name="nav" size={19} color="onAccent" stroke={2} />
                  </View>
                  <View style={styles.stepText}>
                    <Txt v="nm">{current?.text ?? `${leg.toName} 방향`}</Txt>
                    <Txt v="mtTight" numberOfLines={1}>
                      {nextStep ? `다음 · ${nextStep.text}` : `${leg.toName} 도착`}
                    </Txt>
                  </View>
                </Row>
              </Card>
            </View>
          </MapCanvas>
        ) : null}
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetBody}>
          <View style={styles.grabber} />
          {/* 구간 머리: 이전 · 몇째 구간과 목적지 · 다음. 끝 구간에서는 버튼을 끈다(누를 수 없고 아이콘이 흐려진다) */}
          <Row gap={SP.s}>
            {legs.length > 1 ? (
              <IconBtn icon="back" label="이전 구간" disabled={!hasPrev} onPress={() => hasPrev && page(legs[pos - 1].index)} />
            ) : null}
            {/* 어디서 출발하는 구간인지는 눈에도 보이게 둔다(스크린리더는 두 줄을 한 번에 읽는다) */}
            <View accessible accessibilityLabel={`${legTitle}, ${leg.fromName}에서 출발`} style={styles.grow}>
              <Txt v="nm" numberOfLines={1}>
                {legTitle}
              </Txt>
              <Txt v="mtTight" numberOfLines={1}>
                {`${leg.fromName}에서 출발`}
              </Txt>
            </View>
            {legs.length > 1 ? (
              <IconBtn icon="right" label="다음 구간" disabled={!hasNext} onPress={() => hasNext && page(legs[pos + 1].index)} />
            ) : null}
          </Row>
          <Row gap={SP.l}>
            <Txt v="nmLg" c="accent">{`${leg.minutes}분`}</Txt>
            <Txt v="mtTight" numberOfLines={2} style={styles.grow}>
              {`${distanceText(meters)} · 도착 ${arrive}${eta ? ` · 예상 ${eta.eta}` : ''}`}
            </Txt>
          </Row>
          <Row gap={SP.s} wrap>
            <Chip text={TRANSPORT_LABEL[leg.transport]} tone="line" icon={leg.transport === 'walk' ? 'walk' : leg.transport === 'transit' ? 'bus' : 'car'} />
            {timeEstimated ? <Chip text={road ? '시간 추정' : '직선거리 추정'} tone="line" /> : null}
            {road === 'osm' ? <Chip text="길 데이터 OpenStreetMap" tone="line" /> : null}
            {eta ? <Chip text={eta.delta} tone={eta.tone === 'ok' ? 'ok' : 'line'} /> : null}
          </Row>
          <ScrollView style={styles.steps} contentContainerStyle={styles.stepsBody}>
            {steps.map((s, i) => (
              <Row key={`${i}-${s.text}`} gap={SP.l}>
                <Icon name={i === steps.length - 1 ? 'pin' : 'right'} size={14} color={i === stepIdx ? 'accent' : 'faint'} />
                <Txt v="mt" c={i === stepIdx ? 'ink' : 'muted'} style={styles.grow}>
                  {s.text}
                </Txt>
                {s.meters > 0 ? <Txt v="mtTight">{distanceText(s.meters)}</Txt> : null}
              </Row>
            ))}
          </ScrollView>
        </View>
        <Foot>
          {liveHere ? (
            <Btn title="카카오맵으로 열기" icon="map" size="sm" onPress={openMapApp} />
          ) : (
            <Row gap={SP.m}>
              <View style={styles.grow}>
                <Btn title="카카오맵으로 열기" size="sm" variant="quiet" onPress={openMapApp} />
              </View>
              <View style={styles.grow}>
                <Btn title="여행 진행 시작" icon="play" size="sm" onPress={() => navigation.navigate('LiveTrip', { tripId, date })} />
              </View>
            </Row>
          )}
        </Foot>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, minHeight: 0 },
  grow: { flex: 1, minWidth: 0 },
  banner: { paddingHorizontal: SP.gutter, paddingBottom: SP.xl },
  stepCard: { position: 'absolute', left: SP.gutter, right: SP.gutter, top: 14, borderRadius: R.card },
  stepIcon: {
    width: H.iconBtn,
    height: H.iconBtn,
    borderRadius: R.iconBtn,
    backgroundColor: surfaceC.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { flex: 1, gap: 2 },
  sheet: {
    backgroundColor: surfaceC.card,
    borderTopWidth: 1,
    borderTopColor: lineC.line,
    borderTopLeftRadius: R.sheet,
    borderTopRightRadius: R.sheet,
    marginTop: -R.sheet,
  },
  sheetBody: { paddingTop: SP.l, paddingHorizontal: SP.gutter, gap: SP.l },
  grabber: { width: H.grabberW, height: H.grabberH, borderRadius: H.grabberH / 2, backgroundColor: surfaceC.grabber, alignSelf: 'center' },
  steps: { flexGrow: 0, maxHeight: STEPS_MAX_H },
  stepsBody: { gap: SP.s },
});
