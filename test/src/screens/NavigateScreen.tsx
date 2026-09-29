import React, { useMemo, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MapMarkerInput, MapPolylineInput } from '../core/map/layout';
import { TRANSPORT_LABEL } from '../core/constants';
import { etaView } from '../core/live/session';
import { coordLookup, dayLegs, distanceText, legProgress, legShape, legSteps, stepIndexAt } from '../core/map/model';
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

  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  if (!trip || !day || !leg) {
    return (
      <Screen>
        <Header back={back} title="길찾기" right={<ScopeBadge phase="2차" />} />
        <Empty title="안내할 구간이 없습니다" text="루트를 계산하면 구간마다 길 안내가 나옵니다." />
      </Screen>
    );
  }

  const progress = liveHere && last ? legProgress(leg.from, leg.to, last.coord) : 0;
  const stepIdx = Math.max(0, stepIndexAt(steps, progress));
  const current = steps[stepIdx];
  const nextStep = steps[stepIdx + 1];
  const meters = geo?.meters ?? steps.reduce((s, x) => s + x.meters, 0);
  const estimated = leg.estimated || !geo || geo.estimated;
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
  const polylines: MapPolylineInput[] = [{ id: 'leg', coords: legShape(leg, geo), color }];

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

      <View style={{ flex: 1, minHeight: 0 }} onLayout={(e) => setMapH(Math.round(e.nativeEvent.layout.height))}>
        {mapH > 0 ? (
          <MapCanvas
            flat
            height={mapH}
            markers={markers}
            polylines={polylines}
            user={liveHere && last ? { coord: last.coord, accuracyM: last.accuracyM } : undefined}
            onMarkerPress={(id) => navigation.navigate('SpotDetail', { tripId, spotId: id })}
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
          {estimated ? <Chip text="직선거리 추정" tone="line" /> : null}
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
