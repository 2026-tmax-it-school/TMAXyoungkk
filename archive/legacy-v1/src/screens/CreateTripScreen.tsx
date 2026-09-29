import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';

import { MAX_TRIP_DAYS } from '../core/constants';
import { dateRange } from '../core/util';
import { provider } from '../services';
import { useTrip } from '../store/useTrip';
import type { Transport } from '../types';
import { Btn, C, S, Section, Tag } from '../ui';

/** FR-201 여행방 생성 + FR-205 기점 등록 + FR-504 이동수단 선택 */
export default function CreateTripScreen({ navigation }: any) {
  const createTrip = useTrip((s) => s.createTrip);

  const [title, setTitle] = useState('경주 2박 3일');
  const [region, setRegion] = useState('경주');
  const [startDate, setStartDate] = useState('2026-10-17');
  const [endDate, setEndDate] = useState('2026-10-19');
  const [baseName, setBaseName] = useState('라한셀렉트 경주');
  const [transport, setTransport] = useState<Transport>('car');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      setError('날짜는 YYYY-MM-DD 형식으로 넣어주세요.');
      return;
    }
    if (endDate < startDate) {
      setError('종료일이 시작일보다 빠릅니다.');
      return;
    }
    const days = dateRange(startDate, endDate).length;
    if (days > MAX_TRIP_DAYS) {
      setError(`기간이 ${days}일입니다. ${MAX_TRIP_DAYS}일을 넘길 수 없습니다.`);
      return;
    }

    setBusy(true);
    try {
      // 기점 좌표를 장소 검색으로 얻는다. 못 찾으면 만들지 않는다(FR-205).
      const hits = await provider.searchPlaces(baseName, region, {
        latitude: 35.8562,
        longitude: 129.2247,
      });
      if (hits.length === 0) {
        setError(`"${baseName}" 을(를) 찾지 못했습니다. 다른 이름으로 시도해 주세요.`);
        return;
      }
      await createTrip({
        title,
        region,
        startDate,
        endDate,
        baseName: hits[0].name,
        baseCoord: hits[0].coord,
        transport,
      });
      navigation.replace('Trip');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Section title="여행방 이름" />
      <TextInput style={S.input} value={title} onChangeText={setTitle} />

      <Section title="지역 (국내만)" />
      <TextInput style={S.input} value={region} onChangeText={setRegion} />

      <Section title="날짜" />
      <View style={S.row}>
        <TextInput style={[S.input, S.grow]} value={startDate} onChangeText={setStartDate} />
        <TextInput style={[S.input, S.grow]} value={endDate} onChangeText={setEndDate} />
      </View>

      <Section title="기점 (숙소 등)" />
      <TextInput style={S.input} value={baseName} onChangeText={setBaseName} />
      <Text style={S.muted}>모든 날의 출발과 복귀를 이 기점으로 계산합니다.</Text>

      <Section title="주 이동수단" />
      <View style={S.row}>
        <Tag label="자동차" on={transport === 'car'} onPress={() => setTransport('car')} />
        <Tag label="도보" on={transport === 'walk'} onPress={() => setTransport('walk')} />
        <Tag label="대중교통 (2차)" on={false} onPress={() => {}} />
      </View>
      <Text style={S.muted}>
        이동수단이 하루 수용량을 바꿉니다. 대중교통은 2차 범위라 계산하지 않습니다.
      </Text>

      <Section title="하루 활동시간" />
      <Text style={S.body}>09:00 – 21:00 (기본값)</Text>

      {error ? <Text style={{ color: C.rose, fontSize: 13 }}>{error}</Text> : null}
      {busy ? <ActivityIndicator color={C.rose} /> : null}
      <Btn title="만들기" onPress={submit} disabled={busy} />
    </ScrollView>
  );
}
