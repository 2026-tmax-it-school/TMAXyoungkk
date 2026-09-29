import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { dayLabel, humanMin } from '../core/util';
import { useTrip } from '../store/useTrip';
import { Btn, C, Chip, S, Section, Tag } from '../ui';

/** FR-803 스팟 상세. 이 스팟이 왜 들어왔는지(제안자·원문)를 되짚는다. */
export default function SpotDetailScreen({ route, navigation }: any) {
  const { spotId } = route.params as { spotId: string };
  const { current, togglePin, setStay, setFixedDate, removeSpot, restoreSpot } = useTrip();
  const trip = current();
  const spot = trip?.spots.find((s) => s.id === spotId);

  if (!trip || !spot) return null;

  const excluded = trip.plan?.excluded.find((e) => e.spotId === spot.id);
  const day = trip.plan?.days.find((d) => d.items.some((i) => i.spotId === spot.id));
  const item = day?.items.find((i) => i.spotId === spot.id);
  const proposers = spot.proposerIds
    .map((id) => trip.members.find((m) => m.id === id)?.nickname ?? '알 수 없음')
    .join(' · ');

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Text style={S.h1}>{spot.name}</Text>
      <View style={S.row}>
        <Chip text={spot.category} tone="line" />
        {spot.pinned ? <Chip text="고정" /> : null}
        {excluded ? <Chip text="제외 스팟" tone="warn" /> : <Chip text="확정 스팟" tone="ok" />}
      </View>
      {spot.address ? <Text style={S.muted}>{spot.address}</Text> : null}

      {excluded ? (
        <View style={[S.card, { backgroundColor: C.warnBg, borderColor: C.warnBg }]}>
          <Text style={{ color: C.warn, fontWeight: '700', fontSize: 13 }}>제외 이유</Text>
          <Text style={{ color: C.warn, fontSize: 13 }}>{excluded.reason}</Text>
        </View>
      ) : null}

      <Section title="배치" />
      <View style={S.card}>
        <Text style={S.body}>
          {day && item
            ? `${dayLabel(day.date)} ${item.arrive} – ${item.depart}`
            : '아직 배치되지 않았습니다.'}
        </Text>
        <Text style={S.muted}>
          체류 {humanMin(spot.stayMin)}
          {item ? ` · 직전 지점에서 ${humanMin(item.travelMin)}` : ''}
        </Text>
      </View>

      <Section title={`제안자 ${spot.proposerIds.length}명`} />
      <View style={S.card}>
        <Text style={S.body}>{proposers || '없음'}</Text>
        {spot.sourceText ? (
          <Text style={S.muted}>채팅 원문 · “{spot.sourceText}”</Text>
        ) : (
          <Text style={S.muted}>직접 등록한 스팟입니다.</Text>
        )}
      </View>

      <Section title="체류 시간" />
      <View style={S.row}>
        <Btn title="-15분" tone="quiet" onPress={() => setStay(spot.id, spot.stayMin - 15)} />
        <Text style={[S.h2, { minWidth: 70, textAlign: 'center' }]}>{humanMin(spot.stayMin)}</Text>
        <Btn title="+15분" tone="quiet" onPress={() => setStay(spot.id, spot.stayMin + 15)} />
      </View>

      <Section title="날짜 직접 지정 (지정하면 고정 취급)" />
      <View style={[S.row, { flexWrap: 'wrap' }]}>
        <Tag label="자동" on={!spot.fixedDate} onPress={() => setFixedDate(spot.id, undefined)} />
        {(trip.plan?.days ?? []).map((d) => (
          <Tag
            key={d.date}
            label={dayLabel(d.date)}
            on={spot.fixedDate === d.date}
            onPress={() => setFixedDate(spot.id, d.date)}
          />
        ))}
      </View>

      <Section title="상태" />
      <Btn
        title={spot.pinned ? '고정 풀기' : '고정하기 (자동 제외 대상에서 뺌)'}
        onPress={() => togglePin(spot.id)}
      />
      {spot.removedByUser ? (
        <Btn title="후보로 되돌리기" tone="quiet" onPress={() => restoreSpot(spot.id)} />
      ) : (
        <Btn
          title="후보에서 직접 빼기"
          tone="danger"
          onPress={async () => {
            await removeSpot(spot.id);
            navigation.goBack();
          }}
        />
      )}
    </ScrollView>
  );
}
