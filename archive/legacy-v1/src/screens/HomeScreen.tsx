import React, { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useTrip } from '../store/useTrip';
import { Btn, C, Chip, S, Section } from '../ui';
import { dayLabel } from '../core/util';
import { providerStatus } from '../services';
import { TRANSPORT_LABEL } from '../core/constants';

/** FR-203 여행방 목록. 예정·진행중·완료 구분은 날짜로 계산한다. */
export default function HomeScreen({ navigation }: any) {
  const { trips, session, openTrip, touchSession } = useTrip();

  useEffect(() => {
    touchSession();
  }, [touchSession]);

  const today = new Date().toISOString().slice(0, 10);

  const statusOf = (start: string, end: string) => {
    if (today < start) return '예정';
    if (today > end) return '완료';
    return '진행중';
  };

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <View style={S.row}>
        <View style={S.grow}>
          <Text style={S.h1}>내 여행</Text>
          <Text style={S.muted}>
            게스트 · {session?.nickname} · 만료{' '}
            {session ? new Date(session.expiresAt).toISOString().slice(0, 10) : '-'}
          </Text>
        </View>
      </View>

      <Btn title="여행방 만들기" onPress={() => navigation.navigate('CreateTrip')} />

      {trips.length === 0 ? (
        <View style={S.card}>
          <Text style={S.body}>아직 여행방이 없습니다.</Text>
          <Text style={S.muted}>여행방을 만들면 채팅·후보·시간표가 열립니다.</Text>
        </View>
      ) : null}

      {trips.map((trip) => {
        const spots = trip.spots.filter((s) => !s.removedByUser).length;
        const excluded = trip.plan?.excluded.length ?? 0;
        return (
          <Pressable
            key={trip.id}
            style={S.card}
            onPress={() => {
              openTrip(trip.id);
              navigation.navigate('Trip');
            }}
          >
            <View style={S.row}>
              <Chip text={statusOf(trip.startDate, trip.endDate)} />
              <Chip text={TRANSPORT_LABEL[trip.transport]} tone="line" />
              <View style={S.grow} />
              <Chip text={`멤버 ${trip.members.length}`} tone="line" />
            </View>
            <Text style={S.h2}>{trip.title}</Text>
            <Text style={S.muted}>
              {dayLabel(trip.startDate)} – {dayLabel(trip.endDate)} · 기점 {trip.base.name}
            </Text>
            <Text style={S.muted}>
              후보 {spots}곳 · 확정 {spots - excluded < 0 ? 0 : spots - excluded} · 제외 {excluded}
            </Text>
          </Pressable>
        );
      })}

      <Section title="지도·경로 제공자" />
      <View style={[S.card, { backgroundColor: C.tint, borderColor: C.tint }]}>
        <Text style={S.body}>{providerStatus()}</Text>
      </View>
    </ScrollView>
  );
}
