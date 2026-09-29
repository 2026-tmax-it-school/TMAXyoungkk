import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useTrip } from '../store/useTrip';
import { Btn, C, Chip, S, Section } from '../ui';
import { humanMin } from '../core/util';

/** FR-402 후보 목록 + FR-403 자동 선별 결과 + FR-202 수동 등록 */
export default function CandidatesScreen({ navigation }: any) {
  const { current, addSpotBySearch, togglePin, removeSpot, restoreSpot, recompute, busy, lastNotice } =
    useTrip();
  const trip = current();
  const [query, setQuery] = useState('');

  if (!trip) return null;

  const plan = trip.plan;
  const excludedIds = new Set(plan?.excluded.map((e) => e.spotId));
  const confirmed = trip.spots.filter((s) => !s.removedByUser && !excludedIds.has(s.id));

  const placedOn = (spotId: string) =>
    plan?.days.find((d) => d.items.some((i) => i.spotId === spotId))?.date;

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <View style={S.row}>
        <View style={S.grow}>
          <Text style={S.h1}>후보 {trip.spots.filter((s) => !s.removedByUser).length}곳</Text>
          <Text style={S.muted}>
            확정 버튼은 없습니다. 하루 수용량을 넘는 만큼만 자동으로 빠집니다.
          </Text>
        </View>
      </View>

      <View style={S.row}>
        <TextInput
          style={[S.input, S.grow]}
          value={query}
          onChangeText={setQuery}
          placeholder="장소 검색해서 직접 담기"
          placeholderTextColor={C.muted}
        />
        <Btn
          title="담기"
          onPress={async () => {
            if (!query.trim()) return;
            await addSpotBySearch(query.trim());
            setQuery('');
            await recompute();
          }}
        />
      </View>
      {lastNotice ? <Text style={S.muted}>{lastNotice}</Text> : null}
      {busy ? <ActivityIndicator color={C.rose} /> : null}

      {plan?.overCapacityDates.length ? (
        <View style={[S.card, { backgroundColor: C.warnBg, borderColor: C.warnBg }]}>
          <Text style={{ color: C.warn, fontWeight: '700', fontSize: 13 }}>
            고정한 스팟만으로 수용량을 넘긴 날: {plan.overCapacityDates.join(', ')}
          </Text>
          <Text style={{ color: C.warn, fontSize: 12 }}>
            고정은 자동으로 빠지지 않습니다. 직접 고정을 풀거나 빼야 합니다.
          </Text>
        </View>
      ) : null}

      <Section title={`확정 스팟 ${confirmed.length}`} />
      {confirmed.map((spot) => (
        <Pressable
          key={spot.id}
          style={S.card}
          onPress={() => navigation.navigate('SpotDetail', { spotId: spot.id })}
        >
          <View style={S.row}>
            <Text style={[S.h2, S.grow]}>{spot.name}</Text>
            {spot.pinned ? <Chip text="고정" /> : null}
            <Chip text={`제안자 ${spot.proposerIds.length}`} tone="line" />
          </View>
          <Text style={S.muted}>
            {spot.category} · 체류 {humanMin(spot.stayMin)}
            {placedOn(spot.id) ? ` · ${placedOn(spot.id)}` : ' · 아직 배치 안 됨'}
          </Text>
          <View style={S.row}>
            <Pressable onPress={() => togglePin(spot.id)}>
              <Text style={{ color: C.rose, fontSize: 12, fontWeight: '700' }}>
                {spot.pinned ? '고정 풀기' : '고정하기'}
              </Text>
            </Pressable>
            <Pressable onPress={() => removeSpot(spot.id)}>
              <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>직접 빼기</Text>
            </Pressable>
          </View>
        </Pressable>
      ))}

      <Section title={`제외 스팟 ${plan?.excluded.length ?? 0}`} />
      <Text style={S.muted}>제외된 스팟은 이유와 함께 전부 남습니다. 조용한 제외는 없습니다.</Text>
      {(plan?.excluded ?? []).map((ex) => (
        <View key={ex.spotId} style={[S.card, { backgroundColor: C.off, borderColor: C.line }]}>
          <View style={S.row}>
            <Text style={[S.h2, S.grow, { color: C.muted }]}>{ex.name}</Text>
            <Chip text={`제안자 ${ex.proposerCount}`} tone="line" />
          </View>
          <Text style={S.muted}>{ex.reason}</Text>
          <Pressable onPress={() => restoreSpot(ex.spotId)}>
            <Text style={{ color: C.rose, fontSize: 12, fontWeight: '700' }}>
              되돌리기 (고정으로 올림)
            </Text>
          </Pressable>
        </View>
      ))}

      {plan ? (
        <Text style={[S.muted, { marginTop: 8 }]}>
          경로 조회 {plan.routeCalls}회 · {plan.estimated ? '직선거리 추정 포함' : '경로 API 값'} ·
          계산 {new Date(plan.computedAt).toLocaleTimeString('ko-KR')}
        </Text>
      ) : null}
    </ScrollView>
  );
}
