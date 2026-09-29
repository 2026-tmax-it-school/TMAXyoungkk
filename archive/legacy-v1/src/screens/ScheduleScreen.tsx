import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { TRANSPORT_LABEL } from '../core/constants';
import { adjustments } from '../core/planner';
import { dayLabel, humanMin } from '../core/util';
import { useTrip } from '../store/useTrip';
import { Btn, C, Chip, S, Section, Tag } from '../ui';

/** FR-502 시간표 + FR-503 편집 + FR-504 이동수단 전환 */
export default function ScheduleScreen({ navigation }: any) {
  const { current, reorderDay, setStay, setTransport, recompute, busy } = useTrip();
  const trip = current();
  const [dateIndex, setDateIndex] = useState(0);

  if (!trip) return null;
  const plan = trip.plan;
  if (!plan || plan.days.length === 0) {
    return (
      <ScrollView style={S.screen} contentContainerStyle={S.pad}>
        <Text style={S.body}>아직 계산된 일정이 없습니다.</Text>
        <Btn title="루트 계산하기" onPress={recompute} />
      </ScrollView>
    );
  }

  const day = plan.days[Math.min(dateIndex, plan.days.length - 1)];
  const over = day.usedMin - day.capacityMin;
  const fixes = adjustments(day, trip);

  const move = async (index: number, direction: -1 | 1) => {
    const ids = day.items.map((i) => i.spotId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorderDay(day.date, ids);
  };

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Text style={S.h1}>{dayLabel(day.date)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={S.row}>
          {plan.days.map((d, i) => (
            <View key={d.date} style={{ marginRight: 6 }}>
              <Tag label={dayLabel(d.date)} on={i === dateIndex} onPress={() => setDateIndex(i)} />
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={S.row}>
        <Tag label="자동차" on={trip.transport === 'car'} onPress={() => setTransport('car')} />
        <Tag label="도보" on={trip.transport === 'walk'} onPress={() => setTransport('walk')} />
        <View style={S.grow} />
        <Chip
          text={`${humanMin(day.usedMin)} / ${humanMin(day.capacityMin)}`}
          tone={over > 0 ? 'warn' : 'ok'}
        />
      </View>
      {busy ? <ActivityIndicator color={C.rose} /> : null}

      {over > 0 ? (
        <View style={[S.card, { backgroundColor: C.warnBg, borderColor: C.warnBg }]}>
          <Text style={{ color: C.warn, fontWeight: '700', fontSize: 13 }}>
            활동시간을 {humanMin(over)} 넘겼습니다
          </Text>
          {fixes.map((fix) => (
            <Text key={fix.label} style={{ color: C.warn, fontSize: 12 }}>
              조정안 · {fix.label} (-{humanMin(fix.savedMin)})
            </Text>
          ))}
        </View>
      ) : null}

      <View style={S.card}>
        <Text style={S.muted}>
          {trip.dayStart} · {trip.base.name} 출발 · {TRANSPORT_LABEL[trip.transport]}
        </Text>
      </View>

      {day.items.length === 0 ? (
        <Text style={S.muted}>이 날짜에 배치된 스팟이 없습니다.</Text>
      ) : null}

      {day.items.map((item, index) => {
        const spot = trip.spots.find((s) => s.id === item.spotId);
        return (
          <View key={item.spotId} style={{ gap: 4 }}>
            <Text style={S.muted}>
              ↓ {TRANSPORT_LABEL[trip.transport]} {humanMin(item.travelMin)}
            </Text>
            <Pressable
              style={S.card}
              onPress={() => navigation.navigate('SpotDetail', { spotId: item.spotId })}
            >
              <View style={S.row}>
                <Text style={[S.h2, S.grow]}>{item.name}</Text>
                {item.pinned ? <Chip text="고정" /> : null}
                <Chip text={`제안자 ${item.proposerCount}`} tone="line" />
              </View>
              <Text style={S.body}>
                {item.arrive} – {item.depart} · 체류 {humanMin(item.stayMin)}
              </Text>
              <View style={S.row}>
                <Pressable onPress={() => move(index, -1)}>
                  <Text style={{ color: C.rose, fontSize: 12, fontWeight: '700' }}>위로</Text>
                </Pressable>
                <Pressable onPress={() => move(index, 1)}>
                  <Text style={{ color: C.rose, fontSize: 12, fontWeight: '700' }}>아래로</Text>
                </Pressable>
                <View style={S.grow} />
                <Pressable onPress={() => spot && setStay(spot.id, spot.stayMin - 15)}>
                  <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>체류 -15분</Text>
                </Pressable>
                <Pressable onPress={() => spot && setStay(spot.id, spot.stayMin + 15)}>
                  <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>+15분</Text>
                </Pressable>
              </View>
            </Pressable>
          </View>
        );
      })}

      {day.items.length > 0 ? (
        <Text style={S.muted}>
          ↓ {TRANSPORT_LABEL[trip.transport]} {humanMin(day.returnMin)} · {trip.base.name} 복귀
        </Text>
      ) : null}

      <Section title="계산 정보" />
      <Text style={S.muted}>
        순서는 이동 시간이 짧은 순으로 정렬했습니다. 위·아래로 옮기면 그 순서를 그대로 두고 시각만
        다시 계산합니다.
      </Text>
      <Btn title="전체 다시 계산" tone="quiet" onPress={recompute} />
    </ScrollView>
  );
}
