import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { overflowAdjustments } from '../core/planner/adjust';
import { dateRange, humanMin } from '../core/util';
import { DayTimeline } from '../features/schedule/components/DayTimeline';
import { PlanSwitch } from '../features/schedule/components/PlanSwitch';
import { initialScheduleDate } from '../features/schedule/edit';
import { daySegLabel, dayTitle, scheduleOverflowText } from '../features/schedule/view';
import { TripBar } from '../features/trip/components/TripBar';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { TabScreenProps } from '../navigation/routes';
import { appClock } from '../services/clock';
import { getServices } from '../services/registry';
import { usePlan, usePlanning, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Chip,
  Empty,
  H,
  Header,
  IconBtn,
  ListRow,
  Row,
  Screen,
  Seg,
  SP,
  WarnCard,
} from '../ui';

/**
 * 09 날짜별 시간표(FR-505·502, WP4 소유). 목업 09.
 * 위쪽(스크롤되지 않음): TripBar(지금 보는 여행방, useActiveTrip) → PlanSwitch '시간표 | 후보 N' → 날짜 Seg.
 * 본문: 활동시간을 넘긴 날은 앰버 WarnCard('일정 편집에서 조정안 보기'로 10) → 타임라인(DayTimeline: 스팟은 07 상세,
 * 이동 줄은 12 이동수단 비교) → 버튼 줄('편집'(10)·'다시 계산'(그 자리에서 recompute)·지도 IconBtn·'계산 중'(누르면 08),
 * 오른쪽 '예시 데이터' 칩(로컬 경로 제공자일 때)) → '제외 스팟 N곳' 줄(06 후보).
 * 요약 줄('4곳 · 09:00–14:17'·수단 칩)과 채움 막대·활동시간 링크는 뺐다(2026-10-17). 활동시간은 25 여행방 설정에서 바꾼다.
 * 첫 '루트 계산'만 08로 보낸다. 오프라인 안내는 공통 OfflineBar가 맡는다.
 */
export default function ScheduleScreen({ navigation, route }: TabScreenProps<'Schedule'>) {
  const { trip, trips } = useActiveTrip();
  const plan = usePlan(trip?.id);
  const planning = usePlanning(trip?.id);
  const showToast = useUi((s) => s.showToast);
  const wanted = route.params?.date;
  const [date, setDate] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (trip) setDate(initialScheduleDate(trip, appClock().now(), wanted));
  }, [trip?.id, trip?.startDate, trip?.endDate, wanted]);

  const dates = trip ? dateRange(trip.startDate, trip.endDate) : [];
  const current = date && dates.includes(date) ? date : dates[0];
  const day = plan?.days.find((d) => d.date === current);
  const adjustments = useMemo(
    () => (trip && plan && current && day && day.overMin > 0 ? overflowAdjustments(trip, plan, current) : []),
    [trip, plan, current, day],
  );

  if (!trip || !current) {
    return (
      <Screen>
        {trips.length === 0 ? <Header title="시간표" /> : <TripBar />}
        <Body>
          {trips.length === 0 ? (
            <Empty
              title="아직 여행방이 없어요"
              text="여행방을 만들면 날짜별 시간표가 여기에 보여요"
              action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
            />
          ) : (
            <Empty title="여행방을 골라 주세요" text="위에서 볼 여행방을 고르면 시간표가 보여요" />
          )}
        </Body>
      </Screen>
    );
  }

  const sample = getServices().routes.id === 'local';
  const busy = planning?.busy ?? false;
  const openPlanning = () => navigation.navigate('Planning', { tripId: trip.id, date: current });
  const openEdit = () => navigation.navigate('ScheduleEdit', { tripId: trip.id, date: current });
  /** 그 자리에서 다시 계산한다(08로 가지 않는다). 오프라인이면 스토어가 표시해 두고 연결되면 계산한다 */
  const recalc = () => {
    if (!useTrips.getState().online) showToast('오프라인이에요. 연결되면 다시 계산해요');
    void useTrips.getState().recompute(trip.id);
  };

  return (
    <Screen>
      {/* 위쪽이 빽빽해 보이지 않게 TripBar 위, 줄 사이, 날짜 Seg와 본문 사이를 넉넉히 띄운다 */}
      <View style={{ paddingTop: SP.m }}>
        <TripBar />
      </View>
      <View style={{ paddingTop: SP.xxl, paddingBottom: SP.xxl, gap: SP.xxl }}>
        <PlanSwitch value="Schedule" candidates={trip.spots.length} />
        <View style={{ paddingHorizontal: SP.gutter }}>
          <Seg
            items={dates.map((d) => ({ key: d, label: daySegLabel(d), a11yLabel: dayTitle(d) }))}
            value={current}
            onChange={setDate}
          />
        </View>
      </View>
      <Body scroll>
        {!plan ? (
          <Empty
            title="아직 계산한 시간표가 없어요"
            text="후보를 날짜와 활동시간에 맞춰 배치해요"
            action={{ label: '루트 계산', onPress: openPlanning }}
          />
        ) : !day || day.items.length === 0 ? (
          <Empty
            title="이날은 확정 스팟이 없어요"
            action={{ label: '후보 보기', onPress: () => navigation.navigate('Candidates') }}
          />
        ) : (
          <>
            {day.overMin > 0 ? (
              <WarnCard
                title={`활동시간을 ${humanMin(day.overMin)} 넘어요`}
                text={scheduleOverflowText()}
                items={[
                  {
                    label: '일정 편집에서 조정안 보기',
                    value: adjustments.length > 0 ? `조정안 ${adjustments.length}개` : '편집',
                    onPress: openEdit,
                  },
                ]}
              />
            ) : null}
            <DayTimeline
              trip={trip}
              day={day}
              onPressItem={(spotId) => navigation.navigate('SpotDetail', { tripId: trip.id, spotId })}
              onPressLeg={(legIndex) => navigation.navigate('LegTransport', { tripId: trip.id, date: day.date, legIndex })}
            />
            <Row gap={SP.m}>
              <Btn title="편집" icon="pen" variant="quiet" size="sm" onPress={openEdit} />
              <Btn title="다시 계산" variant="quiet" size="sm" disabled={busy} onPress={recalc} />
              <IconBtn
                icon="map"
                label="이날 지도로 보기"
                onPress={() => navigation.navigate('Main', { screen: 'Map', params: { date: current } })}
              />
              {busy ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="계산 중, 계산 단계 보기"
                  onPress={openPlanning}
                  style={{ minHeight: H.touch, justifyContent: 'center' }}
                >
                  <Chip text="계산 중" icon="clock" tone="soft" />
                </Pressable>
              ) : null}
              {sample ? (
                <>
                  <View style={{ flex: 1 }} />
                  {/* Chip은 alignSelf flex-start라 감싸서 버튼 줄 가운데에 맞춘다 */}
                  <View>
                    <Chip text="예시 데이터" tone="line" />
                  </View>
                </>
              ) : null}
            </Row>
            {plan.excluded.length > 0 ? (
              <ListRow
                icon="list"
                label={`제외 스팟 ${plan.excluded.length}곳`}
                onPress={() => navigation.navigate('Candidates')}
              />
            ) : null}
          </>
        )}
      </Body>
    </Screen>
  );
}
