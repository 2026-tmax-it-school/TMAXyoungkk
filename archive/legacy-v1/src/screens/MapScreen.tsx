import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { dayLabel } from '../core/util';
import { useTrip } from '../store/useTrip';
import { C, Chip, S, Tag } from '../ui';

/**
 * FR-801 마커 · FR-802 루트 라인 · FR-803 상세.
 * 구글 지도를 쓴다. 안드로이드는 항상 구글, iOS는 PROVIDER_GOOGLE로 지정해야 구글이 뜬다.
 * iOS에서 구글 지도를 쓰려면 개발 빌드와 API 키가 필요하고, 키가 없으면 애플 지도로 떨어진다.
 */
export default function MapScreen({ navigation }: any) {
  const { current } = useTrip();
  const trip = current();
  const [dateIndex, setDateIndex] = useState(0);

  const day = trip?.plan?.days[Math.min(dateIndex, (trip?.plan?.days.length ?? 1) - 1)];

  const coords = useMemo(() => {
    if (!trip || !day) return [];
    const points = [trip.base.coord];
    for (const item of day.items) {
      const spot = trip.spots.find((s) => s.id === item.spotId);
      if (spot) points.push(spot.coord);
    }
    points.push(trip.base.coord);
    return points;
  }, [trip, day]);

  if (!trip) return null;

  const excludedIds = new Set(trip.plan?.excluded.map((e) => e.spotId));
  const excludedSpots = trip.spots.filter((s) => excludedIds.has(s.id) && !s.removedByUser);

  return (
    <View style={S.screen}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        initialRegion={{
          latitude: trip.base.coord.latitude,
          longitude: trip.base.coord.longitude,
          latitudeDelta: 0.25,
          longitudeDelta: 0.25,
        }}
      >
        <Marker
          coordinate={trip.base.coord}
          title={trip.base.name}
          description="기점"
          pinColor="#2F6B4F"
        />

        {day?.items.map((item, index) => {
          const spot = trip.spots.find((s) => s.id === item.spotId);
          if (!spot) return null;
          return (
            <Marker
              key={spot.id}
              coordinate={spot.coord}
              title={`${index + 1}. ${spot.name}`}
              description={`${item.arrive} 도착 · 제안자 ${item.proposerCount}명`}
              pinColor="#B3123F"
              onCalloutPress={() => navigation.navigate('SpotDetail', { spotId: spot.id })}
            />
          );
        })}

        {excludedSpots.map((spot) => (
          <Marker
            key={spot.id}
            coordinate={spot.coord}
            title={`${spot.name} (제외)`}
            description={trip.plan?.excluded.find((e) => e.spotId === spot.id)?.reason}
            pinColor="#9C8B92"
            opacity={0.7}
          />
        ))}

        {coords.length > 2 ? (
          <Polyline coordinates={coords} strokeColor="#B3123F" strokeWidth={3} />
        ) : null}
      </MapView>

      <View
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          backgroundColor: C.card,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: C.line,
          padding: 8,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={S.row}>
            {(trip.plan?.days ?? []).map((d, i) => (
              <View key={d.date} style={{ marginRight: 6 }}>
                <Tag label={dayLabel(d.date)} on={i === dateIndex} onPress={() => setDateIndex(i)} />
              </View>
            ))}
            <Chip text={`제외 ${excludedSpots.length}`} tone="line" />
          </View>
        </ScrollView>
      </View>

      {Platform.OS === 'ios' ? (
        <Text style={[S.muted, { position: 'absolute', bottom: 8, left: 12 }]}>
          iOS에서 구글 지도를 띄우려면 API 키와 개발 빌드가 필요합니다.
        </Text>
      ) : null}
    </View>
  );
}
