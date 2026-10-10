import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { MapCanvas } from '../components/map/MapCanvas';
import { TRANSPORT_LABEL } from '../core/constants';
import { pickLiveDate } from '../core/live/session';
import { dayOrdinal, daySummary } from '../core/map/model';
import { dayShort, humanMin, weekday } from '../core/util';
import '../features/live/photoBridge';
import { useDayMap } from '../features/live/useDayMap';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { getServices } from '../services/registry';
import { useLive } from '../store/live';
import { useCurrentTrip, usePlan, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Btn,
  Chip,
  dayColor,
  Empty,
  H,
  Header,
  IconBtn,
  lineC,
  mapC,
  R,
  Row,
  Screen,
  Seg,
  SP,
  surfaceC,
  Txt,
} from '../ui';

/**
 * 11 지도 · 루트(FR-801~803, WP5 소유). 지도는 MapCanvas(react-native-svg) 한 벌이라 키 없이 모든 플랫폼에서 그려진다.
 * - 핀에 방문 순번을 박아 지도와 시간표가 같은 순서로 읽힌다. 기점은 속 빈 링, 제외 스팟은 흰 핀('제외').
 * - 날짜별 선 색은 로즈, 초록, 앰버, 잉크. estimated 구간은 직선이다. 밀집 마커는 숫자 원으로 묶는다.
 * - 마커를 누르면 스팟 상세(07). 하단 시트에 날짜 Seg, 순서 목록, 제외 스팟의 사유와 되돌리기.
 * - '전체' 보기는 핀 면도 그날 선 색이고, 시트에 날짜별 색 점(범례)을 둔다.
 * - 여행 진행 중인 방이면 현재 위치를 함께 그린다(FR-601).
 * - 상단 칩 줄은 목업처럼 그림자가 없다. 날짜 칩은 흰 면·경계선에 accentDeep 굵은 글자다.
 */

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const COLLAPSED_ROWS = 3;

export default function MapScreen({ navigation, route }: TabScreenProps<'Map'>) {
  const trip = useCurrentTrip();
  const plan = usePlan(trip?.id);
  const now = useNow();
  const [picked, setPicked] = useState<string | undefined>(route.params?.date);
  const [expanded, setExpanded] = useState(false);
  const [mapH, setMapH] = useState(0);
  const date: string | 'all' = picked ?? (trip ? pickLiveDate(trip, plan, now) : 'all');
  const map = useDayMap(trip, plan, date);
  const local = getServices().routes.id === 'local';
  const liveLast = useLive((s) => (trip && s.mode !== 'off' && s.tripId === trip.id ? s.last : undefined));

  const dayIndex = plan ? plan.days.findIndex((d) => d.date === date) : -1;
  const day = dayIndex >= 0 ? plan?.days[dayIndex] : undefined;
  const summary = useMemo(() => (day ? daySummary(day) : undefined), [day]);

  if (!trip) {
    return (
      <Screen>
        <Header title="지도" />
        <Empty
          title="여행방이 없습니다"
          action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
        />
      </Screen>
    );
  }

  const tripId = trip.id;
  const transport = day ? (trip.days.find((d) => d.date === day.date)?.transport ?? trip.transport) : trip.transport;
  const excluded = plan?.excluded ?? [];
  const firstLeg = day ? map.legs[0] : undefined;
  const rows = day?.items ?? [];
  const shownRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const segItems = [
    { key: 'all', label: '전체' },
    ...(plan?.days ?? []).map((d) => ({ key: d.date, label: dayShort(d.date) })),
  ];

  const openSpot = (id: string) => {
    if (id === 'base' || id.startsWith('base:')) return;
    navigation.navigate('SpotDetail', { tripId, spotId: id });
  };
  const restore = (spotId: string, name: string) => {
    const r = useTrips.getState().dispatch(tripId, { type: 'spot/restore', spotId });
    if (r.ok) useUi.getState().showToast(`${name}을(를) 고정으로 되돌렸어요. 루트를 다시 맞춥니다`);
  };

  const title = day ? `${dayOrdinal(dayIndex)} 루트` : '전체 루트';
  const sub = summary ? `이동 ${humanMin(summary.travelMin)} · 체류 ${humanMin(summary.stayMin)}` : undefined;

  return (
    <Screen>
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
            markers={map.markers}
            polylines={map.polylines}
            user={liveLast ? { coord: liveLast.coord, accuracyM: liveLast.accuracyM } : undefined}
            onMarkerPress={openSpot}
            overlayBottom={R.sheet}
          >
            <View style={{ position: 'absolute', top: 14, left: SP.gutter, right: SP.gutter }}>
              <Row gap={SP.m}>
                <Chip text={day ? `${dayShort(day.date)} ${WEEK[weekday(day.date)]}` : '전체 날짜'} tone="card" />
                <Chip text={TRANSPORT_LABEL[transport]} tone="line" />
                <View style={{ flex: 1 }} />
                <IconBtn icon="list" label={expanded ? '목록 접기' : '목록 펼치기'} onPress={() => setExpanded((v) => !v)} />
              </Row>
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
          paddingBottom: SP.l,
          gap: SP.l,
          maxHeight: expanded ? 460 : undefined,
        }}
      >
        <Pressable accessibilityLabel={expanded ? '목록 접기' : '목록 펼치기'} onPress={() => setExpanded((v) => !v)}>
          <View
            style={{
              width: H.grabberW,
              height: H.grabberH,
              borderRadius: H.grabberH / 2,
              backgroundColor: surfaceC.grabber,
              alignSelf: 'center',
            }}
          />
        </Pressable>
        {segItems.length > 2 ? <Seg items={segItems} value={date} onChange={(k) => setPicked(k)} /> : null}
        <Row>
          <Txt v="nm" style={{ flex: 1 }}>
            {title}
          </Txt>
          {sub ? <Txt v="mt">{sub}</Txt> : null}
        </Row>
        {map.osmRoads ? <Txt v="mtTight">선은 실제 길 모양 · 길 데이터 OpenStreetMap 기여자</Txt> : null}

        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: SP.m }} scrollEnabled={expanded}>
          {day ? (
            rows.length > 0 ? (
              shownRows.map((it, i) => (
                <Pressable key={it.spotId} onPress={() => openSpot(it.spotId)} accessibilityRole="button">
                  <Row gap={SP.l}>
                    <View style={{ width: 20 }}>
                      <Txt v="time" c="accent">
                        {String(i + 1)}
                      </Txt>
                    </View>
                    <Txt v="nm" numberOfLines={1} style={{ flex: 1 }}>
                      {it.name}
                    </Txt>
                    {it.pinned ? <Chip text="고정" tone="soft" /> : null}
                    <Txt v="mtTight">{it.arrive}</Txt>
                  </Row>
                </Pressable>
              ))
            ) : (
              <Txt v="mt">이 날은 확정 스팟이 없습니다.</Txt>
            )
          ) : map.model?.unplanned ? (
            <Txt v="mt">지금은 후보 위치만 보입니다.</Txt>
          ) : (
            <Row gap={SP.xl} wrap>
              {(plan?.days ?? []).map((d, i) =>
                d.items.length > 0 ? (
                  <Row key={d.date} gap={SP.s}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: mapC[dayColor(i)] }} />
                    <Txt v="mtTight">{`${dayShort(d.date)} · ${d.items.length}곳`}</Txt>
                  </Row>
                ) : null,
              )}
            </Row>
          )}
          {!expanded && rows.length > COLLAPSED_ROWS ? (
            <Txt v="mtTight">{`이후 ${rows.length - COLLAPSED_ROWS}곳`}</Txt>
          ) : null}

          {expanded && excluded.length > 0 ? (
            <View style={{ gap: SP.m, paddingTop: SP.s }}>
              <Txt v="label">{`제외 스팟 ${excluded.length}`}</Txt>
              {excluded.map((x) => (
                <Row key={x.spotId} gap={SP.l}>
                  <Pressable style={{ flex: 1, gap: 2 }} onPress={() => openSpot(x.spotId)}>
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
        </ScrollView>

        {map.model?.unplanned ? (
          <Btn title="루트 계산" size="sm" onPress={() => navigation.navigate('Planning', { tripId })} />
        ) : day && rows.length > 0 ? (
          <Row gap={SP.m}>
            <View style={{ flex: 1 }}>
              <Btn
                title="길찾기"
                icon="nav"
                size="sm"
                variant="quiet"
                onPress={() => navigation.navigate('Navigate', { tripId, date: day.date, legIndex: firstLeg?.index ?? 0 })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="여행 진행" icon="play" size="sm" onPress={() => navigation.navigate('LiveTrip', { tripId, date: day.date })} />
            </View>
          </Row>
        ) : null}
        {excluded.length > 0 && !expanded ? <Txt v="mtTight">{`제외 스팟 ${excluded.length}곳`}</Txt> : null}
      </View>
    </Screen>
  );
}
