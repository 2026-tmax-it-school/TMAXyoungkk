import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  H,
  Header,
  Icon,
  IconBtn,
  lineC,
  R,
  Row,
  Screen,
  ScopeBadge,
  SP,
  surfaceC,
  Txt,
} from '../ui';

/**
 * 13 길찾기 · 구간 내비(FR-601~603, 2차, WP5 소유).
 * 구간 안내 줄은 경로 제공자의 steps를 쓰고, 없으면(로컬 추정) 방위와 거리로 만든다(core/map/model.legSteps).
 * 선은 실제 길 모양(OpenStreetMap·카카오)이면 그 길을 따르고, 그때 진행률도 길을 따라 잰다. OSM이면 출처 칩을 단다.
 * 추정 칩은 보여 주는 시간(계획 값)이 추정일 때만 단다. 선이 실제 길이면 '시간 추정', 직선이면 '직선거리 추정'이다.
 * 여행 진행 중이면 현재 위치로 진행률을 재서 지금 따라가는 줄을 고른다. 시뮬레이터면 line 톤 띠를 둔다(앰버 띠 없음).
 * '지도 앱으로 열기'는 국내 지도 앱 웹 링크로 연다(키 불필요). '안내 시작'은 19 여행 진행으로 간다.
 * 목업 13처럼 지도가 화면 대부분을 차지한다. 위는 뒤로·범위 표시 한 줄, 아래 시트는 목적지 줄·구간 안내 3줄·버튼 두 개다.
 * 구간 이동(이전·다음)은 버튼 줄 밖, 구간 안내 위 작은 줄에 둔다(좁은 폭에서 버튼 글자가 넘치지 않게).
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
  const insets = useSafeAreaInsets();
  const simBanner = useSimBanner(tripId, date);
  const liveHere = useLive((s) => s.tripId === tripId && s.date === date && s.mode !== 'off');
  const last = useLive((s) => s.last);
  const timing = useLive((s) => s.timing);

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

  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  if (!trip || !day || !leg) {
    return (
      <Screen>
        <Header back={back} title="길찾기" right={<ScopeBadge phase="2차" />} />
        <Empty title="안내할 구간이 없습니다" text="루트를 계산하면 구간마다 길 안내가 나옵니다." />
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
    Linking.openURL(url).catch(() => useUi.getState().showToast('지도 앱을 열지 못했습니다', 'warn'));
  };

  const hasPrev = pos > 0;
  const hasNext = pos < legs.length - 1;

  return (
    <Screen>
      <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: SP.m }}>
        <Row gap={SP.l}>
          {back ? <IconBtn icon="back" label="뒤로" onPress={back} /> : null}
          <Txt v="eyebrow" numberOfLines={1} style={{ flex: 1 }}>
            {`길찾기 · ${dayLabel(date)}`}
          </Txt>
          <ScopeBadge phase="2차" />
        </Row>
      </View>
      {simBanner ? (
        <View style={{ paddingHorizontal: SP.gutter, paddingBottom: SP.xl }}>
          <SimBanner />
        </View>
      ) : null}

      {/* 다른 화면이 위에 쌓여 이 화면이 숨으면(웹 display:none) 높이가 0으로 온다. 그때 지도를 내리지 않아야
          돌아왔을 때 지도를 새로 불러오지 않는다(구글 지도는 띄울 때마다 사용량이 든다) */}
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
            user={liveHere && last ? { coord: last.coord, accuracyM: last.accuracyM } : undefined}
            onMarkerPress={(id) => navigation.navigate('SpotDetail', { tripId, spotId: id })}
            overlayBottom={R.sheet}
          >
            <View style={[{ position: 'absolute', left: SP.gutter, right: SP.gutter, top: 14, borderRadius: R.card }, E.float]}>
              <Card>
                <Row gap={SP.l}>
                  <View
                    style={{
                      width: H.iconBtn,
                      height: H.iconBtn,
                      borderRadius: R.iconBtn,
                      backgroundColor: surfaceC.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="nav" size={19} color="onAccent" stroke={2} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
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
        <Row>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="nm">{leg.toName}</Txt>
            <Txt v="mtTight">{`${distanceText(meters)} · 도착 ${arrive}${eta ? ` · 예상 ${eta.eta}` : ''}`}</Txt>
            <Txt v="mtTight" numberOfLines={1}>{`${leg.fromName}에서 출발`}</Txt>
          </View>
          <Txt v="nm" c="accent">{`${leg.minutes}분`}</Txt>
        </Row>
        <Row gap={SP.s} wrap>
          <Chip text={TRANSPORT_LABEL[leg.transport]} tone="line" icon={leg.transport === 'walk' ? 'walk' : leg.transport === 'transit' ? 'bus' : 'car'} />
          {timeEstimated ? <Chip text={road ? '시간 추정' : '직선거리 추정'} tone="line" /> : null}
          {road === 'osm' ? <Chip text="길 데이터 OpenStreetMap" tone="line" /> : null}
          {eta ? <Chip text={eta.delta} tone={eta.tone === 'ok' ? 'ok' : 'line'} /> : null}
        </Row>
        {legs.length > 1 ? (
          <Row gap={SP.m}>
            <Txt v="label" style={{ flex: 1 }}>
              {`구간 ${pos + 1} / ${legs.length}`}
            </Txt>
            {/* 끝 구간에서는 버튼을 끈다(누를 수 없고 아이콘이 흐려진다) */}
            <IconBtn
              icon="back"
              label="이전 구간"
              disabled={!hasPrev}
              onPress={() => {
                if (hasPrev) setLegIndex(legs[pos - 1].index);
              }}
            />
            <IconBtn
              icon="right"
              label="다음 구간"
              disabled={!hasNext}
              onPress={() => {
                if (hasNext) setLegIndex(legs[pos + 1].index);
              }}
            />
          </Row>
        ) : null}
        <ScrollView style={{ flexGrow: 0, maxHeight: STEPS_MAX_H }} contentContainerStyle={{ gap: SP.s }}>
          {steps.map((s, i) => (
            <Row key={`${i}-${s.text}`} gap={SP.l}>
              <Icon name={i === steps.length - 1 ? 'pin' : 'right'} size={14} color={i === stepIdx ? 'accent' : 'faint'} />
              <Txt v="mt" c={i === stepIdx ? 'ink' : 'muted'} style={{ flex: 1 }}>
                {s.text}
              </Txt>
              {s.meters > 0 ? <Txt v="mtTight">{distanceText(s.meters)}</Txt> : null}
            </Row>
          ))}
        </ScrollView>
        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn title="지도 앱으로 열기" size="sm" variant="quiet" onPress={openMapApp} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="안내 시작" size="sm" onPress={() => navigation.navigate('LiveTrip', { tripId, date })} />
          </View>
        </Row>
      </View>
    </Screen>
  );
}
