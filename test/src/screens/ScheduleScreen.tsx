import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { dateRange, humanMin } from '../core/util';
import { initialScheduleDate } from '../features/schedule/edit';
import { DayTimeline } from '../features/schedule/components/DayTimeline';
import { daySegLabel, daySummary, dayTitle, overflowCause, planMeta } from '../features/schedule/view';
import type { TabScreenProps } from '../navigation/routes';
import { appClock } from '../services/clock';
import { getServices } from '../services/registry';
import { useCurrentTrip, usePlan, usePlanning, useTrips } from '../store/trips';
import { Body, Chip, Col, Empty, Header, IconBtn, Notice, Row, Screen, Seg, SP, Txt } from '../ui';

/**
 * 09 날짜별 시간표(FR-505·502, WP4 소유). 목업 09.
 * - 날짜 Seg, 52px 고정 폭 시각 열 타임라인(DayTimeline), 이동 구간은 카드가 아닌 Leg 줄(아이콘+분)
 * - 기점 출발·복귀 행(기점 없는 날은 첫 스팟에서 시작, 복귀 없음 날은 '여기서 일정 끝')
 * - 스팟을 누르면 07 상세, 이동 줄을 누르면 12 이동수단 비교, 오른쪽 위 버튼은 10 일정 편집
 * - 로컬 경로 제공자면 '예시 데이터' 칩. 활동시간을 넘긴 날은 10으로 가는 경고 안내를 둔다(앰버 WarnCard는 10 전용)
 * - 헤더는 목업 .hd처럼 한 행(eyebrow·제목 | 칩·편집 버튼) 아래 날짜 Seg를 둔다. 날짜가 많으면 Seg를 가로로 밀어 본다
 */
export default function ScheduleScreen({ navigation, route }: TabScreenProps<'Schedule'>) {
  const trip = useCurrentTrip();
  const plan = usePlan(trip?.id);
  const planning = usePlanning(trip?.id);
  const online = useTrips((s) => s.online);
  const dirty = useTrips((s) => (trip ? !!s.dirty[trip.id] : false));
  const wanted = route.params?.date;
  const [date, setDate] = useState<string | undefined>(undefined);
  const segScroll = useRef<ScrollView>(null);
  const segWidth = useRef(0);

  useEffect(() => {
    if (trip) setDate(initialScheduleDate(trip, appClock().now(), wanted));
  }, [trip?.id, trip?.startDate, trip?.endDate, wanted]);

  if (!trip) {
    return (
      <Screen>
        <Header title="시간표" />
        <Body>
          <Empty
            title="여행방이 없습니다"
            action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
          />
        </Body>
      </Screen>
    );
  }

  const dates = dateRange(trip.startDate, trip.endDate);
  const current = date && dates.includes(date) ? date : dates[0];
  const day = plan?.days.find((d) => d.date === current);
  const sample = getServices().routes.id === 'local';
  const busy = planning?.busy ?? false;
  const openPlanning = () => navigation.navigate('Planning', { tripId: trip.id, date: current });
  const openEdit = () => navigation.navigate('ScheduleEdit', { tripId: trip.id, date: current });
  /** 고른 날짜가 보이게 민다(항목 폭은 거의 같으므로 평균 폭으로 잡는다) */
  const pickDate = (d: string) => {
    setDate(d);
    const i = dates.indexOf(d);
    const w = dates.length ? segWidth.current / dates.length : 0;
    segScroll.current?.scrollTo({ x: Math.max(0, (i - 1) * w), animated: true });
  };

  return (
    <Screen>
      <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: 14, gap: SP.xl }}>
        <Row gap={SP.l}>
          <Col grow gap={SP.xs}>
            <Txt v="eyebrow">{trip.title}</Txt>
            <Txt v="ttlSm">{dayTitle(current)}</Txt>
          </Col>
          <Row gap={SP.s}>
            {day && day.items.length > 0 ? <IconBtn icon="drag" label="일정 편집" onPress={openEdit} /> : null}
          </Row>
        </Row>
        <ScrollView
          ref={segScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={(w) => {
            segWidth.current = w;
          }}
        >
          <Seg items={dates.map((d) => ({ key: d, label: daySegLabel(d) }))} value={current} onChange={pickDate} />
        </ScrollView>
      </View>
      <Body scroll>
        {!online || dirty ? (
          <Notice
            icon="alert"
            text={online ? '오프라인 중에 바뀐 편집이 있어 다시 계산합니다.' : '오프라인입니다. 연결되면 다시 계산합니다.'}
          />
        ) : null}
        {busy ? (
          <Pressable accessibilityRole="button" accessibilityLabel="계산 단계 보기" onPress={openPlanning}>
            <Row gap={SP.s}>
              <Chip text="다시 계산하는 중" tone="soft" icon="clock" />
              <Txt v="mtTight">단계 보기</Txt>
            </Row>
          </Pressable>
        ) : null}
        {!plan ? (
          <Empty
            title="아직 계산한 시간표가 없습니다"
            action={{ label: '루트 계산', onPress: openPlanning }}
          />
        ) : !day || day.items.length === 0 ? (
          <Empty
            title="이날은 확정 스팟이 없습니다"
            action={{ label: '후보 보기', onPress: () => navigation.navigate('Candidates') }}
          />
        ) : (
          <>
            {day.overMin > 0 ? (
              <Notice
                icon="alert"
                tone="warn"
                title={`활동시간을 ${humanMin(day.overMin)} 넘습니다`}
                text={`${overflowCause(day.overMin)}. 일정 편집에서 조정안을 골라 주세요.`}
              />
            ) : null}
            <DayTimeline
              trip={trip}
              day={day}
              onPressItem={(spotId) => navigation.navigate('SpotDetail', { tripId: trip.id, spotId })}
              onPressLeg={(legIndex) => navigation.navigate('LegTransport', { tripId: trip.id, date: day.date, legIndex })}
            />
            <Col gap={SP.xs}>
              <Row gap={SP.m}>
                <Col grow>
                  <Txt v="mtTight">{daySummary(day)}</Txt>
                </Col>
                <Pressable accessibilityRole="button" accessibilityLabel="다시 계산" onPress={openPlanning} hitSlop={8}>
                  <Txt v="mtTight" c="accent">
                    다시 계산
                  </Txt>
                </Pressable>
              </Row>
              {planMeta(trip, plan, day.date).map((line) => (
                <Txt key={line} v="mtTight">
                  {line}
                </Txt>
              ))}
              {plan.excluded.length > 0 ? (
                <Txt v="mtTight">{`제외 스팟 ${plan.excluded.length}곳`}</Txt>
              ) : null}
            </Col>
          </>
        )}
      </Body>
    </Screen>
  );
}
