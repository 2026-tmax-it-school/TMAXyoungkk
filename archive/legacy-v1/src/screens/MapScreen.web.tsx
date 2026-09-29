import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { GOOGLE_MAPS_API_KEY, HAS_GOOGLE_KEY } from '../config';
import { dayLabel, humanMin } from '../core/util';
import { useTrip } from '../store/useTrip';
import { C, Chip, S, Section, Tag } from '../ui';

/**
 * 웹용 지도 화면.
 *
 * react-native-maps는 네이티브 전용이라 웹에서 못 쓴다. Metro가 플랫폼별 파일을 골라주므로
 * 웹에서는 이 파일이, iOS·안드로이드에서는 MapScreen.tsx가 쓰인다.
 *
 * 키가 있으면 Google Maps Embed API로 실제 경로를 그리고, 없으면 순서와 좌표만 보여준다.
 * Embed API는 무료다.
 */
export default function MapScreenWeb({ navigation }: any) {
  const { current } = useTrip();
  const trip = current();
  const [dateIndex, setDateIndex] = useState(0);

  if (!trip) return null;

  const days = trip.plan?.days ?? [];
  const day = days[Math.min(dateIndex, Math.max(0, days.length - 1))];
  const excludedIds = new Set(trip.plan?.excluded.map((e) => e.spotId));
  const excludedSpots = trip.spots.filter((s) => excludedIds.has(s.id) && !s.removedByUser);

  const spotsOfDay = (day?.items ?? [])
    .map((item) => trip.spots.find((s) => s.id === item.spotId))
    .filter((s): s is NonNullable<typeof s> => !!s);

  const asPoint = (c: { latitude: number; longitude: number }) => `${c.latitude},${c.longitude}`;

  let embedUrl = '';
  if (HAS_GOOGLE_KEY && spotsOfDay.length > 0) {
    const waypoints = spotsOfDay.slice(0, -1).map((s) => asPoint(s.coord)).join('|');
    const last = spotsOfDay[spotsOfDay.length - 1];
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_API_KEY,
      origin: asPoint(trip.base.coord),
      destination: asPoint(last.coord),
      mode: trip.transport === 'car' ? 'driving' : 'walking',
      language: 'ko',
      region: 'KR',
    });
    if (waypoints) params.set('waypoints', waypoints);
    embedUrl = `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={S.row}>
          {days.map((d, i) => (
            <View key={d.date} style={{ marginRight: 6 }}>
              <Tag label={dayLabel(d.date)} on={i === dateIndex} onPress={() => setDateIndex(i)} />
            </View>
          ))}
          <Chip text={`제외 ${excludedSpots.length}`} tone="line" />
        </View>
      </ScrollView>

      {embedUrl ? (
        <View style={{ height: 420, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
          {React.createElement('iframe', {
            src: embedUrl,
            width: '100%',
            height: '100%',
            style: { border: 0 },
            loading: 'lazy',
            referrerPolicy: 'no-referrer-when-downgrade',
            title: '루트 지도',
          })}
        </View>
      ) : (
        <View style={[S.card, { backgroundColor: C.tint, borderColor: C.tint }]}>
          <Text style={S.body}>웹에서는 지도 타일을 띄우지 않습니다.</Text>
          <Text style={S.muted}>
            EXPO_PUBLIC_GOOGLE_MAPS_API_KEY 를 넣으면 이 자리에 실제 경로가 그려집니다. 네이티브
            지도(react-native-maps)는 iOS·안드로이드에서만 동작합니다.
          </Text>
        </View>
      )}

      <Section title={`${day ? dayLabel(day.date) : ''} 방문 순서`} />
      <View style={S.card}>
        <Text style={S.body}>기점 · {trip.base.name}</Text>
        <Text style={S.muted}>{asPoint(trip.base.coord)}</Text>
      </View>
      {(day?.items ?? []).map((item, index) => {
        const spot = spotsOfDay.find((s) => s.id === item.spotId);
        return (
          <View key={item.spotId} style={S.card}>
            <View style={S.row}>
              <Text style={[S.h2, S.grow]}>
                {index + 1}. {item.name}
              </Text>
              <Chip text={`제안자 ${item.proposerCount}`} tone="line" />
            </View>
            <Text style={S.body}>
              {item.arrive} 도착 · 이동 {humanMin(item.travelMin)} · 체류 {humanMin(item.stayMin)}
            </Text>
            {spot ? <Text style={S.muted}>{asPoint(spot.coord)}</Text> : null}
          </View>
        );
      })}
      {day && day.items.length > 0 ? (
        <Text style={S.muted}>복귀 {humanMin(day.returnMin)} · {trip.base.name}</Text>
      ) : null}

      <Section title={`제외 스팟 ${excludedSpots.length}`} />
      {excludedSpots.map((spot) => (
        <View key={spot.id} style={[S.card, { backgroundColor: C.off }]}>
          <Text style={[S.h2, { color: C.muted }]}>{spot.name}</Text>
          <Text style={S.muted}>
            {trip.plan?.excluded.find((e) => e.spotId === spot.id)?.reason}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
