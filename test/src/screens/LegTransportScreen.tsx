import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { PlanDiff, Transport } from '../types';
import { TRANSPORT_LABEL } from '../core/constants';
import { buildPlan } from '../core/planner';
import { returnLegOf } from '../core/planner/day';
import { compareLeg, legEndpoints, type LegOption } from '../core/planner/legs';
import { previewOps } from '../core/planner/preview';
import { dayShort, humanMin } from '../core/util';
import { dayTransportDrafts, legDrafts, legPositionText } from '../features/schedule/edit';
import { transportIcon } from '../features/schedule/timeline';
import { deltaChip, previewSentence } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { appClock } from '../services/clock';
import { getServices } from '../services/registry';
import { usePlan, useTripDoc, useTrips } from '../store/trips';
import { Body, Btn, Card, Chip, Col, Empty, Foot, Header, Icon, IconBtn, lineC, Notice, Row, Screen, ScopeBadge, SP, Txt } from '../ui';

/**
 * 12 이동수단 · 경로 비교(FR-504, WP4 소유). 목업 12.
 * - route()로 자동차·도보·대중교통을 모두 조회해 결과를 먼저 보여주고 고르게 한다. 차이 칩은 느리면 +분(warn)
 * - 대중교통은 2차 기능(모의 모델: 도보 접근 + 배차 대기 + 승차 + 환승 벌점)이라 ScopeBadge '2차'를 단다
 * - 경로가 없는 수단은 제외 면 카드에 대체 수단 안내를 적는다
 * - 고른 수단으로 '바꾸면 이렇게 됩니다'(previewOps, 문서를 바꾸지 않는다)를 이 구간만·하루 전체 두 경우로 보여준다
 * - '이 구간만'은 그날 지금 순서를 수동 순서로 굳히고(schedule/reorder) schedule/setLegTransport를 보낸다(legDrafts).
 *   순서를 굳히지 않으면 느린 수단 비용 때문에 두 스팟이 떨어져 지정한 구간이 시간표에서 사라진다
 * - '하루 전체 적용'은 setDayTransport와 그날 구간 지정 해제
 * - 미리보기는 계산 입력(스팟·날짜 설정·구간·기간)이 바뀔 때만 다시 돌고, 비교 기준 계획도 같은 문서로 새로 계산한다
 * 수단 비교 route() 호출은 24시간 캐시를 거치고 08의 경로 조회 건수에 넣지 않는다(A11).
 */

interface Previews {
  leg?: PlanDiff;
  day?: PlanDiff;
}

export default function LegTransportScreen({ navigation, route }: RootScreenProps<'LegTransport'>) {
  const { tripId, date, legIndex } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const day = plan?.days.find((d) => d.date === date);
  const ends = useMemo(() => (trip && day ? legEndpoints(trip, day, legIndex) : undefined), [trip, day, legIndex]);
  const [options, setOptions] = useState<LegOption[] | undefined>(undefined);
  const [picked, setPicked] = useState<Transport | undefined>(undefined);
  const [preview, setPreview] = useState<Previews>({});
  const [previewBusy, setPreviewBusy] = useState(false);

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Schedule', params: { date } }));

  // 수단 세 가지 경로 조회
  useEffect(() => {
    if (!ends) return;
    let alive = true;
    setOptions(undefined);
    void compareLeg(getServices().routes, ends.from, ends.to, ends.transport).then((o) => {
      if (alive) setOptions(o);
    });
    return () => {
      alive = false;
    };
  }, [ends?.from.latitude, ends?.from.longitude, ends?.to.latitude, ends?.to.longitude, ends?.transport]);

  const choice = picked ?? ends?.transport;

  // 계산 입력 서명. 채팅처럼 계산과 무관한 op로는 미리보기를 다시 돌리지 않는다
  const inputKey = trip
    ? JSON.stringify([trip.spots, trip.days, trip.legs, trip.startDate, trip.endDate, trip.transport, trip.dayStart, trip.dayEnd])
    : '';

  // 고른 수단의 미리보기(지금 수단과 다를 때만)
  useEffect(() => {
    if (!trip || !day || !ends || !choice || choice === ends.transport) {
      setPreview({});
      return;
    }
    let alive = true;
    setPreviewBusy(true);
    const deps = { routes: getServices().routes, now: appClock().now() };
    const legOps = legDrafts(trip, day, ends.fromId, ends.toId, choice);
    void buildPlan(trip, deps)
      .then((base) =>
        Promise.all([previewOps(trip, base, legOps, deps), previewOps(trip, base, dayTransportDrafts(trip, date, choice), deps)]),
      )
      .then(([leg, dayDiff]) => {
        if (alive) setPreview({ leg, day: dayDiff });
      })
      .catch(() => {
        if (alive) setPreview({});
      })
      .finally(() => {
        if (alive) setPreviewBusy(false);
      });
    return () => {
      alive = false;
    };
    // trip·day·ends는 inputKey와 구간 번호가 같으면 같은 계산 입력이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, ends?.fromId, ends?.toId, ends?.transport, choice, date]);

  if (!trip || !day || !ends) {
    return (
      <Screen>
        <Header back={back} title="이동수단 비교" size="sm" />
        <Body>
          <Empty title="이 구간을 찾을 수 없습니다" />
        </Body>
      </Screen>
    );
  }

  const chosen = options?.find((o) => o.transport === choice);
  const canApply = !!chosen?.leg;
  // 이 구간의 대체 안내: 스팟으로 가는 구간은 도착 스팟 항목, 복귀 구간은 계획의 복귀 구간 값
  const legNotices =
    ends.toId === 'base' ? returnLegOf(day)?.notices ?? [] : day.items.find((it) => it.spotId === ends.toId)?.notices ?? [];
  const fallbackNotice = legNotices.find((n) => n.kind === 'fallbackTransport' || n.kind === 'noRoute' || n.kind === 'estimated');

  const applyLeg = () => {
    if (!choice) return;
    const r = useTrips.getState().dispatchMany(trip.id, legDrafts(trip, day, ends.fromId, ends.toId, choice));
    if (r.ok) back();
  };
  const applyDay = () => {
    if (!choice) return;
    const r = useTrips.getState().dispatchMany(trip.id, dayTransportDrafts(trip, date, choice));
    if (r.ok) back();
  };

  const renderOption = (o: LegOption) => {
    const isCurrent = o.transport === ends.transport;
    const on = o.transport === choice;
    const transit = o.transport === 'transit';
    if (!o.leg) {
      return (
        <Card key={o.transport} variant="excluded">
          <Row top gap={SP.l}>
            <Icon name={transportIcon(o.transport)} size={22} color="faint" />
            <Col grow gap={SP.xs}>
              <Row gap={SP.s}>
                <Txt v="nm" c="muted">
                  {TRANSPORT_LABEL[o.transport]}
                </Txt>
                {transit ? <ScopeBadge phase="2차" /> : null}
              </Row>
              <Txt v="mtTight">{o.fallbackText ?? '경로가 없습니다'}</Txt>
            </Col>
          </Row>
        </Card>
      );
    }
    const chip = isCurrent ? { text: '적용중', tone: 'soft' as const } : deltaChip(o.deltaMin);
    const km = `${(o.leg.meters / 1000).toFixed(1)}km`;
    // 시간이 추정일 때만 적는다. 선이 실제 길이면 거리는 실제라 '시간 추정', 직선이면 '직선거리 추정'(길찾기 칩과 같은 말)
    const sub = [km, o.leg.estimated ? (o.leg.road ? '시간 추정' : '직선거리 추정') : undefined].filter(Boolean).join(' · ');
    return (
      <Card key={o.transport} variant={on ? 'selected' : 'default'} onPress={() => setPicked(o.transport)}>
        <Row top gap={SP.l}>
          <Icon name={transportIcon(o.transport)} size={22} color={on ? 'accent' : 'muted'} />
          <Col grow gap={SP.xs}>
            <Row gap={SP.s}>
              <Txt v="nm">{TRANSPORT_LABEL[o.transport]}</Txt>
              {transit ? <ScopeBadge phase="2차" /> : null}
            </Row>
            <Txt v="mtTight">{sub}</Txt>
            {o.leg.note ? <Txt v="mtTight">{o.leg.note}</Txt> : null}
            {on && o.leg.steps.length ? (
              <Txt v="mtTight" numberOfLines={1}>
                {o.leg.steps.length > 1 ? `${o.leg.steps[0].text} 외 ${o.leg.steps.length - 1}단계` : o.leg.steps[0].text}
              </Txt>
            ) : null}
          </Col>
          <Col gap={SP.xs} style={{ alignItems: 'flex-end' }}>
            <Txt v="nm">{humanMin(o.leg.minutes)}</Txt>
            {chip ? <Chip text={chip.text} tone={chip.tone} /> : null}
          </Col>
        </Row>
      </Card>
    );
  };

  return (
    <Screen>
      <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: 14, gap: SP.xl }}>
        <Row gap={SP.l}>
          <IconBtn icon="back" label="뒤로" onPress={back} />
          <Col grow>
            <Txt v="mt">{legPositionText(day, legIndex)}</Txt>
          </Col>
        </Row>
        <Col gap={SP.xs}>
          <Txt v="eyebrow">{`${dayShort(date)} · 구간 이동수단${ends.overridden ? ' · 구간 지정됨' : ''}`}</Txt>
          <Txt v="ttlSm">{`${ends.fromName}에서 ${ends.toName}까지`}</Txt>
        </Col>
      </View>
      <Body scroll>
        {fallbackNotice ? <Notice icon="alert" tone={fallbackNotice.kind === 'estimated' ? 'line' : 'warn'} text={fallbackNotice.text} /> : null}
        {!options ? <Txt v="mtTight">세 가지 수단의 경로를 조회하고 있습니다.</Txt> : options.map(renderOption)}
        <View style={{ height: 1, backgroundColor: lineC.line }} />
        <Col gap={SP.m}>
          <Txt v="eyebrow">바꾸면 이렇게 됩니다</Txt>
          <Card variant="tinted">
            <Col gap={SP.s}>
              {!choice || choice === ends.transport ? (
                <Txt v="note" c="accentStrong">
                  {`지금 이 구간은 ${TRANSPORT_LABEL[ends.transport]}입니다.`}
                </Txt>
              ) : previewBusy || !preview.leg ? (
                <Txt v="note" c="accentStrong">
                  다시 계산해 보고 있습니다.
                </Txt>
              ) : (
                <>
                  <Txt v="note" c="accentStrong">
                    {`이 구간만: ${previewSentence(trip, date, choice, preview.leg)}`}
                  </Txt>
                  {preview.day ? (
                    <Txt v="note" c="accentStrong">
                      {`하루 전체: ${previewSentence(trip, date, choice, preview.day)}`}
                    </Txt>
                  ) : null}
                </>
              )}
            </Col>
          </Card>
        </Col>
      </Body>
      <Foot>
        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn title="이 구간만" variant="quiet" disabled={!canApply} onPress={applyLeg} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="하루 전체 적용" disabled={!canApply} onPress={applyDay} />
          </View>
        </Row>
      </Foot>
    </Screen>
  );
}
