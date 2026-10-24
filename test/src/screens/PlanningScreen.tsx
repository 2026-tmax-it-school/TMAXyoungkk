import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { activeSpots } from '../core/spotUtil';
import { dateRange } from '../core/util';
import { monthDay, planMeta, planningProgress, planningStepRows, stepRowA11y, type StepRow } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { usePlan, usePlanning, useTripDoc, useTrips } from '../store/trips';
import { Body, Btn, Card, Col, Foot, Header, Icon, lineC, NotFound, Notice, ProgressBar, Row, Screen, SP, surfaceC, Txt } from '../ui';

/**
 * 08 루트 계산 중(FR-505·501, WP4 소유).
 * 들어오면 실제로 다시 계산한다(useTrips.recompute → buildPlan). 단계 행은 buildPlan이 보낸 onStep만으로 그린다
 * (위치 확인, 이동시간 조회, 배치 N/M, 제외 사유). 가짜 진행률은 없다. 막대는 끝난 단계 수 + 진행 중 단계의 실제 done/total이다.
 * 기다리는 동안 선별 규칙 전문과 경로 조회 건수(API 비용)를 보여준다. 계산이 끝나면 시간표로 간다.
 * 오프라인이면 재계산을 멈추고(스토어가 dirty로 표시) 저장된 계획으로 볼 수 있다고 알린다.
 * 끝남은 이 화면에 들어온 뒤 시작한 계산이 끝났는지로 판정한다(지난 계산 단계로 '맞췄습니다'가 한 프레임 보이지 않게).
 * 돌아가기는 계산을 멈추지 않는다(스토어가 끝까지 계산해 둔다). 버튼 문구도 그렇게 적는다('이전 화면으로(계산은 계속돼요)').
 * 뒤로는 useBack('Schedule'): 쌓인 화면이 없으면(웹 새로고침) 시간표 탭으로 간다. 없는 여행방은 NotFound('홈으로').
 * 단계 행은 스크린리더에 '{단계}, 완료|진행 중|대기'로 읽힌다(표시 모양이 아니라 상태). 계산 정보의 수단은 그날 수단이다.
 */

const ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];

/** 단계 표시(2026-10-23 피그마 최종안 19): 끝난 단계는 주색 원에 흰 체크, 진행 중은 주색 고리, 대기는 선색 고리 */
function StepMark({ state }: { state: StepRow['state'] }) {
  const d = 24;
  if (state === 'done') {
    return (
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: surfaceC.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={14} color="onAccent" stroke={2.6} />
      </View>
    );
  }
  const active = state === 'active';
  return <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: active ? 2.5 : 1.5, borderColor: active ? lineC.accent : lineC.line }} />;
}

/** 진행 고리(피그마 최종안 19). value 0~1만큼 주색 호를 그린다 */
function ProgressRing({ value }: { value: number }) {
  const size = 88;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={surfaceC.track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={surfaceC.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
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

  const back = useBack('Schedule');

  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="루트 계산" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const dates = dateRange(trip.startDate, trip.endDate);
  const di = date ? dates.indexOf(date) : -1;
  const eyebrow = date && di >= 0 ? `${monthDay(date)} · ${ORDINAL[di] ?? `${di + 1}번째`} 날` : trip.title;
  const title = !online ? '재계산을 멈췄어요' : finished ? '루트를 맞췄어요' : '루트를 맞추는 중';

  return (
    <Screen>
      <Header back={back} eyebrow={eyebrow} title={title} />
      <Body scroll>
        {!online ? (
          <Notice icon="alert" title="오프라인" text="연결되면 다시 계산해요." />
        ) : null}
        {planning?.error ? <Notice icon="alert" tone="warn" title="계산하지 못했어요" text={planning.error} /> : null}
        {candidates === 0 ? (
          <Notice icon="pin" text="후보가 없어 배치할 곳이 없어요." />
        ) : null}
        <Row gap={SP.xxl}>
          <ProgressRing value={progress} />
          <Col grow gap={SP.xs}>
            <Txt v="ttlSm">{finished ? `후보 ${candidates}곳으로 하루를 짰어요` : `후보 ${candidates}곳으로 하루를 짜고 있어요`}</Txt>
            <Txt v="mt">영업시간 · 이동 거리 · 친구들이 말한 시간을 함께 봐요.</Txt>
          </Col>
        </Row>
        <Card>
          <Col gap={SP.l}>
            {rows.map((r) => (
              <View
                key={r.key}
                accessible
                accessibilityLabel={stepRowA11y(r)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: SP.l }}
              >
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
              </View>
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
        <Btn title={busy ? '이전 화면으로(계산은 계속돼요)' : '이전 화면으로'} variant="quiet" size="sm" onPress={back} />
      </Foot>
    </Screen>
  );
}
