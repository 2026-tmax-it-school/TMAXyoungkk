import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { PlanDiff, Transport } from '../types';
import { TRANSPORT_LABEL } from '../core/constants';
import { buildPlan } from '../core/planner';
import { returnLegOf } from '../core/planner/day';
import { compareLeg, legEndpoints, type LegOption } from '../core/planner/legs';
import { liveLegs } from '../core/ops/schedule';
import { previewOps } from '../core/planner/preview';
import { dayShort, humanMin, josa } from '../core/util';
import { dayTransportDrafts, legDrafts, legIndexes, legPositionText } from '../features/schedule/edit';
import { transportIcon } from '../features/schedule/timeline';
import {
  dayTransport,
  deltaChip,
  legAppliedToast,
  legApplyLabels,
  legPreviewChips,
  previewSentence,
} from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { appClock } from '../services/clock';
import { getServices } from '../services/registry';
import { usePlan, useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Chip, Col, Empty, Foot, Header, Icon, IconBtn, lineC, Notice, Row, Screen, SP, Txt } from '../ui';

/**
 * 12 이동수단 · 경로 비교(FR-504, WP4 소유). 목업 12.
 * - route()로 자동차·도보·대중교통을 모두 조회해 결과를 먼저 보여주고 고르게 한다. 차이 칩은 느리면 +분(warn)
 * - 대중교통은 모의 모델(도보 접근 + 배차 대기 + 승차 + 환승 벌점)이다
 * - 경로가 없는 수단은 제외 면 카드에 대체 수단 안내를 적는다
 * - 머리말(Header row): '이동수단 비교'와 날짜 한 줄, 오른쪽에 이전·다음 구간 버튼과 '구간 2 / 6'(같은 화면에서 구간만 바꾼다).
 *   출발·도착 이름은 360px에서도 잘리지 않게 본문 맨 위에 줄바꿈 제목으로 두고, 구간 지정이면 '구간 지정됨' 칩을 단다
 * - 고른 수단으로 '바꾸면 이렇게 돼요'(previewOps, 문서를 바꾸지 않는다)를 이 구간만·이날 전체 두 줄 표로 보여준다.
 *   칩은 순수 legPreviewChips(시간 차이, 활동시간 초과, 빠지는 곳, 돌아오는 곳)이고 줄의 스크린리더 이름은 previewSentence다
 * - Foot: 주 버튼 '이 구간만 {수단}으로 바꾸기', 보조 '이날 전체를 {수단}으로'. 지금 수단과 같으면 끈다
 * - '이 구간만'은 그날 지금 순서를 수동 순서로 굳히고(schedule/reorder) schedule/setLegTransport를 보낸다(legDrafts).
 *   순서를 굳히지 않으면 느린 수단 비용 때문에 두 스팟이 떨어져 지정한 구간이 시간표에서 사라진다
 * - '이날 전체'는 setDayTransport와 그날 구간 지정 해제. 성공하면 토스트를 띄우고 돌아가고, 실패하면 warn 토스트로 알리고 머문다
 * - 미리보기는 계산 입력(스팟·날짜 설정·구간·기간)이 바뀔 때만 다시 돌고, 비교 기준 계획도 같은 문서로 새로 계산한다
 * 수단 비교 route() 호출은 24시간 캐시를 거치고 08의 경로 조회 건수에 넣지 않는다(A11).
 */

/** 미리보기 표의 왼쪽 범위 이름 칸 폭('이 구간만', '이날 전체') */
const PREVIEW_LABEL_W = 64;

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
  const showToast = useUi((s) => s.showToast);

  // 이전·다음 구간으로 넘기면 고른 수단을 비운다(새 구간의 지금 수단에서 시작)
  useEffect(() => {
    setPicked(undefined);
  }, [legIndex]);

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
        <Header back={back} title="이동수단 비교" size="row" />
        <Body>
          <Empty title="이 구간을 찾을 수 없어요" action={{ label: '시간표로', onPress: back }} />
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

  // 지금 수단과 같으면 끈다. 이날 전체는 날짜 수단이 같아도 그날 구간 지정이 있으면 풀 수 있다
  const sameLeg = choice === ends.transport;
  const sameDay = choice === dayTransport(trip, date) && !liveLegs(trip.legs).some((l) => l.date === date);
  const labels = legApplyLabels(choice ?? ends.transport);
  const all = legIndexes(day);
  const at = all.indexOf(legIndex);
  const goLeg = (i: number | undefined) => {
    if (i != null) navigation.setParams({ legIndex: i });
  };

  const run = (scope: 'leg' | 'day') => {
    if (!choice) return;
    const drafts = scope === 'leg' ? legDrafts(trip, day, ends.fromId, ends.toId, choice) : dayTransportDrafts(trip, date, choice);
    const r = useTrips.getState().dispatchMany(trip.id, drafts);
    if (!r.ok) {
      showToast(`바꾸지 못했어요. ${r.reason}`, 'warn');
      return;
    }
    showToast(legAppliedToast(scope, choice));
    back();
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
              </Row>
              <Txt v="mtTight">{o.fallbackText ?? '경로가 없어요'}</Txt>
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

  /** 미리보기 표 한 줄: 왼쪽 범위 이름, 오른쪽 칩. 스크린리더는 같은 내용을 문장으로 읽는다 */
  const previewRow = (scope: string, diff: PlanDiff) => (
    <View
      key={scope}
      accessible
      accessibilityLabel={`${scope}: ${choice ? previewSentence(trip, date, choice, diff) : ''}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP.m }}
    >
      <View style={{ width: PREVIEW_LABEL_W, paddingTop: SP.xs }}>
        <Txt v="mtSemi" c="accentStrong">
          {scope}
        </Txt>
      </View>
      <Row gap={SP.s} wrap style={{ flex: 1 }}>
        {legPreviewChips(trip, date, diff).map((c) => (
          <Chip key={c.text} text={c.text} tone={c.tone} />
        ))}
      </Row>
    </View>
  );

  return (
    <Screen>
      <Header
        back={back}
        size="row"
        title="이동수단 비교"
        sub={dayShort(date)}
        right={
          <>
            <IconBtn icon="back" label="이전 구간" disabled={at <= 0} onPress={() => goLeg(all[at - 1])} />
            <Txt v="mtTight">{legPositionText(day, legIndex)}</Txt>
            <IconBtn icon="right" label="다음 구간" disabled={at < 0 || at >= all.length - 1} onPress={() => goLeg(all[at + 1])} />
          </>
        }
      />
      <Body scroll>
        {/* 구간 끝점은 머리말(한 줄로 잘림) 대신 여기서 줄바꿈으로 다 보여 준다. 이전·다음 구간으로 넘겨도 지금 구간을 알 수 있다 */}
        <Col gap={SP.xs}>
          <Txt v="ttlSm">{`${ends.fromName}에서 ${ends.toName}까지`}</Txt>
          {ends.overridden ? <Chip text="구간 지정됨" tone="line" /> : null}
        </Col>
        {fallbackNotice ? <Notice icon="alert" tone={fallbackNotice.kind === 'estimated' ? 'line' : 'warn'} text={fallbackNotice.text} /> : null}
        {!options ? <Txt v="mtTight">세 가지 수단의 경로를 조회하고 있어요.</Txt> : options.map(renderOption)}
        <View style={{ height: 1, backgroundColor: lineC.line }} />
        <Col gap={SP.m}>
          <Txt v="eyebrow">바꾸면 이렇게 돼요</Txt>
          <Card variant="tinted">
            {!choice || sameLeg ? (
              <Txt v="note" c="accentStrong">
                {`지금 이 구간은 ${josa(TRANSPORT_LABEL[ends.transport], '으로/로')} 가요. 다른 수단을 고르면 달라지는 점을 보여 드려요.`}
              </Txt>
            ) : previewBusy || !preview.leg ? (
              <Txt v="note" c="accentStrong">
                다시 계산해 보고 있어요.
              </Txt>
            ) : (
              <Col gap={SP.m}>
                {previewRow('이 구간만', preview.leg)}
                {preview.day ? previewRow('이날 전체', preview.day) : null}
              </Col>
            )}
          </Card>
        </Col>
      </Body>
      <Foot>
        <Btn title={labels.leg} disabled={!canApply || sameLeg} onPress={() => run('leg')} />
        <Btn title={labels.day} variant="quiet" size="sm" disabled={!canApply || sameDay} onPress={() => run('day')} />
      </Foot>
    </Screen>
  );
}
