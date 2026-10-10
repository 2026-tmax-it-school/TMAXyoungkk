import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { activeSpots } from '../core/spotUtil';
import { dateRange } from '../core/util';
import { monthDay, planMeta, planningProgress, planningStepRows, type StepRow } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { usePlan, usePlanning, useTripDoc, useTrips } from '../store/trips';
import { Body, Btn, Card, Col, Empty, Foot, Header, Icon, lineC, Notice, ProgressBar, Row, Screen, SP, Txt } from '../ui';

/**
 * 08 루트 계산 중(FR-505·501, WP4 소유).
 * 들어오면 실제로 다시 계산한다(useTrips.recompute → buildPlan). 단계 행은 buildPlan이 보낸 onStep만으로 그린다
 * (위치 확인, 이동시간 조회, 배치 N/M, 제외 사유). 가짜 진행률은 없다. 막대는 끝난 단계 수 + 진행 중 단계의 실제 done/total이다.
 * 기다리는 동안 선별 규칙 전문과 경로 조회 건수(API 비용)를 보여준다. 계산이 끝나면 시간표로 간다.
 * 오프라인이면 재계산을 멈추고(스토어가 dirty로 표시) 저장된 계획으로 볼 수 있다고 알린다.
 * 끝남은 이 화면에 들어온 뒤 시작한 계산이 끝났는지로 판정한다(지난 계산 단계로 '맞췄습니다'가 한 프레임 보이지 않게).
 * 돌아가기는 계산을 멈추지 않는다(스토어가 끝까지 계산해 둔다). 버튼 문구도 그렇게 적는다.
 */

const ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];

function StepMark({ state }: { state: StepRow['state'] }) {
  if (state === 'done') return <Icon name="check" size={18} color="ok" stroke={2.2} />;
  // 진행 중은 오른쪽 한 변을 비운 로즈 호(목업 스피너 모양), 대기는 선색 링(글자 아님)
  const active = state === 'active';
  return (
    <View
      style={{
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: active ? lineC.accent : lineC.line,
        borderRightColor: active ? 'transparent' : lineC.line,
      }}
    />
  );
}

export default function PlanningScreen({ navigation, route }: RootScreenProps<'Planning'>) {
  const { tripId, date } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const planning = usePlanning(tripId);
  const online = useTrips((s) => s.online);
  const started = useRef(false);
  /** 이 화면에서 시작한 계산이 한 번이라도 진행 중이었는지 */
  const [sawBusy, setSawBusy] = useState(false);
  /** 계산을 시작했는데 진행 중으로 바뀌지 않고 끝난 경우(오프라인·계산할 것 없음) */
  const [kicked, setKicked] = useState(false);

  useEffect(() => {
    if (started.current || !trip) return;
    started.current = true;
    void useTrips
      .getState()
      .recompute(tripId)
      .finally(() => setKicked(true));
  }, [trip, tripId]);

  const candidates = trip ? activeSpots(trip).length : 0;
  const busy = planning?.busy ?? false;
  useEffect(() => {
    if (busy) setSawBusy(true);
  }, [busy]);
  const steps = planning?.steps ?? plan?.steps ?? [];
  const hasBase = !!plan?.days.some((d) => d.baseSource !== 'firstSpot') || !!trip?.days.some((d) => d.base && d.base !== 'inherit');
  const rows = useMemo(() => planningStepRows(steps, busy, candidates, hasBase), [steps, busy, candidates, hasBase]);
  const progress = planningProgress(rows, steps);
  const finished = (sawBusy || kicked) && !busy && !!plan && steps.length > 0;

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Candidates' }));

  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="루트 계산" />
        <Body>
          <Empty title="여행방을 찾을 수 없습니다" />
        </Body>
      </Screen>
    );
  }

  const dates = dateRange(trip.startDate, trip.endDate);
  const di = date ? dates.indexOf(date) : -1;
  const eyebrow = date && di >= 0 ? `${monthDay(date)} · ${ORDINAL[di] ?? `${di + 1}번째`} 날` : trip.title;
  const title = !online ? '재계산을 멈췄습니다' : finished ? '루트를 맞췄습니다' : '루트를 맞추는 중';

  return (
    <Screen>
      <Header eyebrow={eyebrow} title={title} />
      <Body scroll>
        {!online ? (
          <Notice icon="alert" title="오프라인" text="연결되면 다시 계산합니다." />
        ) : null}
        {planning?.error ? <Notice icon="alert" tone="warn" title="계산하지 못했습니다" text={planning.error} /> : null}
        {candidates === 0 ? (
          <Notice icon="pin" text="후보가 없어 배치할 곳이 없습니다." />
        ) : null}
        <Card>
          <Col gap={SP.l}>
            {rows.map((r) => (
              <Row key={r.key} gap={SP.l}>
                <StepMark state={r.state} />
                <Col grow>
                  <Txt v={r.state === 'active' ? 'stepOn' : 'step'} c={r.state === 'active' ? 'accent' : r.state === 'wait' ? 'muted' : 'ink'}>
                    {r.label}
                  </Txt>
                </Col>
                {r.count ? (
                  <Txt v="mtTight" c={r.state === 'active' ? 'accent' : 'muted'}>
                    {r.count}
                  </Txt>
                ) : null}
                {r.time ? <Txt v="mtTight">{r.time}</Txt> : null}
              </Row>
            ))}
          </Col>
        </Card>
        <ProgressBar value={progress} />
        <Col gap={SP.s}>
          {planMeta(trip, plan, date).map((line) => (
            <Txt key={line} v="mtTight">
              {line}
            </Txt>
          ))}
          {plan ? (
            <Txt v="mtTight">{`확정 스팟 ${plan.days.reduce((n, d) => n + d.items.length, 0)}곳 · 제외 스팟 ${plan.excluded.length}곳`}</Txt>
          ) : null}
        </Col>
      </Body>
      <Foot>
        {finished || (!online && plan) ? (
          <Btn
            title="시간표 보기"
            icon="cal"
            onPress={() => navigation.navigate('Main', { screen: 'Schedule', params: date ? { date } : undefined })}
          />
        ) : null}
        <Btn title={busy ? '후보로 돌아가기(계산은 계속됩니다)' : '후보로 돌아가기'} variant="quiet" size="sm" onPress={back} />
      </Foot>
    </Screen>
  );
}
