import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { MapMarkerInput, MapPolylineInput } from '../core/map/layout';
import { sampleSpotCount } from '../core/trip/sample';
import { regionById } from '../data/regions';
import { sampleTripFor } from '../data/sampleTrips';
import { MapCanvas } from '../components/map/MapCanvas';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { ArtHero, Body, Btn, Card, Chip, Col, Empty, Foot, Header, Row, Screen, Seg, SP, Txt } from '../ui';

/**
 * 30 추천 여행지 · 예시 일정(WP2 소유, 2026-10-17). 홈 '추천 여행지'를 누르면 그 지역의 예시 2박 3일을 보여 준다.
 * - 위쪽 지도에 고른 날의 장소가 순서대로 번호 핀으로 놓이고, 출발·복귀 기점(역·공항)까지 점선으로 잇는다(실제 길이 아니다).
 * - 일차 탭(1일차·2일차·3일차)으로 날을 바꾼다. 장소마다 분류, 한 줄 소개, 주소를 보여 준다.
 * - 아래 고정 버튼 '이 일정으로 여행방 만들기'는 만들기 화면(sample)으로 가서 기간·기점이 채워진 채 열리고, 만들면 장소가 후보로
 *   담겨 시간표가 짜인다. '직접 만들기'는 지역만 채워 연다. 예시는 참고용이라 영업시간·휴무는 방문 전에 확인하라고 적는다.
 * 일정 데이터는 data/sampleTrips.ts(카카오 장소 검색으로 확인한 장소), 담는 규칙은 core/trip/sample.ts다.
 */
export default function SampleTripScreen({ navigation, route }: RootScreenProps<'SampleTrip'>) {
  const { regionId } = route.params;
  const sample = sampleTripFor(regionId);
  const region = regionById(regionId);
  const back = useBack('Home');
  const [dayIndex, setDayIndex] = useState(0);

  const day = sample?.days[Math.min(dayIndex, (sample?.days.length ?? 1) - 1)];

  const map = useMemo(() => {
    if (!sample || !day) return undefined;
    const markers: MapMarkerInput[] = [
      { id: 'base', coord: sample.base.coord, kind: 'base', title: sample.base.name },
      ...day.places.map((p, i): MapMarkerInput => ({ id: p.id, coord: p.coord, kind: 'spot', label: String(i + 1), title: p.name })),
    ];
    const coords = [sample.base.coord, ...day.places.map((p) => p.coord), sample.base.coord];
    const polylines: MapPolylineInput[] = [{ id: 'day', coords, color: 'slate', dashed: true }];
    return { markers, polylines, fitTo: coords };
  }, [sample, day]);

  if (!sample || !day || !map) {
    return (
      <Screen>
        <Header back={back} title="예시 일정" />
        <Body>
          <Empty title="이 지역의 예시 일정이 없어요" action={{ label: '직접 여행방 만들기', onPress: () => navigation.replace('CreateTrip', { regionId }) }} />
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Body scroll flush>
        {/* 피그마 최종안 11·14: 위에 지역 그림 머리, 아래 제목과 소개 */}
        <ArtHero regionId={regionId} onBack={back} />
        <View style={{ gap: SP.xxl, paddingHorizontal: SP.gutter }}>
        <Col gap={SP.xs}>
          <Txt v="eyebrow">{`${region?.name ?? '추천 여행 일정'} · 예시 일정`}</Txt>
          <Txt v="ttl">{sample.title}</Txt>
          <Txt v="mt">{sample.blurb}</Txt>
        </Col>
        <Row gap={SP.s} wrap>
          <Chip text="예시 일정" tone="soft" icon="cal" />
          <Chip text={`장소 ${sampleSpotCount(sample)}곳`} tone="line" />
          <Chip text="자동차 기준" tone="line" />
        </Row>
        <Seg<string>
          items={sample.days.map((_, i) => ({ key: String(i), label: `${i + 1}일차` }))}
          value={String(dayIndex)}
          onChange={(k) => setDayIndex(Number(k))}
        />
        <MapCanvas height={220} markers={map.markers} polylines={map.polylines} fitTo={map.fitTo} />
        <Col gap={SP.xs}>
          <Txt v="nmLg">{day.title}</Txt>
          <Txt v="mt" c="muted">
            {day.blurb}
          </Txt>
        </Col>
        <Col gap={SP.m}>
          {day.places.map((p, i) => (
            <Card key={p.id}>
              <Row top gap={SP.l}>
                <View style={{ width: 24 }}>
                  <Txt v="time" c="accent">
                    {i + 1}
                  </Txt>
                </View>
                <Col grow gap={SP.xs}>
                  <Row gap={SP.s} wrap>
                    <Txt v="nm">{p.name}</Txt>
                    <Chip text={p.category} tone="line" />
                  </Row>
                  <Txt v="mt">{p.note}</Txt>
                  <Txt v="mtTight">{p.address}</Txt>
                </Col>
              </Row>
            </Card>
          ))}
        </Col>
        <Txt v="mtTight">
          예시 일정은 참고용이에요. 영업시간과 휴무일은 가기 전에 확인해 주세요. 출발·복귀 기점은 {sample.base.name}이에요.
        </Txt>
        </View>
      </Body>
      <Foot>
        <Btn title="이 일정으로 여행방 만들기" onPress={() => navigation.navigate('CreateTrip', { regionId, sample: true })} />
        <Btn title="직접 만들기" variant="quiet" onPress={() => navigation.navigate('CreateTrip', { regionId })} />
      </Foot>
    </Screen>
  );
}
