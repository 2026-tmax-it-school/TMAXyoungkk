import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Adjustment, OpDraft, Plan, TimetableItem, Transport } from '../types';
import { TRANSPORT_LABEL } from '../core/constants';
import { STAY_MAX_LIMIT, STAY_MIN_LIMIT } from '../core/ops/schedule';
import { overflowAdjustments } from '../core/planner/adjust';
import { dateRange, dayShort, humanMin, josa } from '../core/util';
import { OrderBadge } from '../features/schedule/components/DayTimeline';
import { Stepper } from '../features/schedule/components/Stepper';
import {
  ARRIVE_STEP,
  canPinArrive,
  dayTransportDrafts,
  editOrder,
  inverseDrafts,
  moveInOrder,
  STAY_STEP,
  stepArrive,
  stepStay,
} from '../features/schedule/edit';
import { transportIcon } from '../features/schedule/timeline';
import {
  adjustmentToast,
  arrivePinText,
  dayTransport,
  editHeaderSub,
  editOrderLabel,
  editOverflow,
  editToast,
  excludeTarget,
  newlyExcludedLines,
} from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { usePlan, usePlanning, useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Card,
  Chip,
  Choice,
  Col,
  ConfirmSheet,
  Empty,
  Foot,
  H,
  Header,
  Icon,
  IconBtn,
  ListRow,
  Notice,
  Row,
  Screen,
  SP,
  TextLink,
  Txt,
  WarnCard,
} from '../ui';

/**
 * 10 일정 편집(FR-503, WP4 소유). 목업 10.
 * - 머리말(Header row)에 날짜·곳 수·쓴 시간 한 줄(계산 중이면 시계). 상태 알림으로 목록이 밀리지 않게 위쪽에 Notice를 쌓지 않는다
 * - 맨 위: 초과면 앰버 WarnCard(조정안: 체류 줄이기, 다른 날로 옮기기, 빼기). '빼기'는 ConfirmSheet를 한 번 거친다.
 *   그 아래 '이날 이동수단' Choice(날짜 수단, 그날 구간 지정은 푼다)
 * - 목록 위 순서 줄('순서 · 이동 짧은 순' 또는 '순서 · 직접 정함')과 '자동 순서로' 링크
 * - 카드: 왼쪽 순서 번호, 오른쪽 앞으로·뒤로 아이콘 버튼(끌기 대신 늘 보이는 탭 경로, 처음과 끝은 끔).
 *   카드 본문을 누르면 도구가 펼쳐진다: 체류·도착 시각 Stepper(지정이 없으면 '14:17 그대로 지정' 한 번 누르기,
 *   있으면 '지정 풀기'), 날짜(가로 Choice), 고정 Switch 줄
 * - 바꾼 값은 누르는 즉시 op로 저장되고 스토어가 다시 계산한다. 다음 값은 계획이 아니라 문서 값에서 만든다
 *   (체류·도착은 스팟 값, 순서는 문서의 수동 순서 우선, editOrder). 빠르게 두 번 눌러도 두 번 적용된다
 * - 적용 실패는 warn 토스트. 카드가 이 날에서 사라지는 편집(다른 날로 옮기기, 빼기)과 조정안은 토스트 한 문장으로 알린다
 * - 편집 뒤 재계산에서 새로 자동 제외된 스팟은 Foot 버튼 바로 위에 이유와 함께 알린다(조용한 제외 없음)
 * - Foot: [되돌리기(이 화면에서 한 편집을 적용 전 값으로, 빼기는 후보 화면에서)] [시간표로]. 10은 즉시 저장이라
 *   '저장하고 시간표로'가 아니라 '시간표로'다(04 코드 리뷰 회의 결정). 오프라인 안내는 공통 OfflineBar가 맡는다
 */

interface UndoEntry {
  label: string;
  drafts: OpDraft[];
}

/** 편집 직전 계획의 제외 스팟. 다음 계획이 오면 새로 제외된 곳을 알린다 */
interface Watch {
  plan: Plan;
  excluded: string[];
}

const TRANSPORTS: Transport[] = ['car', 'walk', 'transit'];

export default function ScheduleEditScreen({ navigation, route }: RootScreenProps<'ScheduleEdit'>) {
  const { tripId, date } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const planning = usePlanning(tripId);
  const showToast = useUi((s) => s.showToast);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [watch, setWatch] = useState<Watch | undefined>(undefined);
  const [excludedLines, setExcludedLines] = useState<string[]>([]);
  /**
   * 확인을 기다리는 '빼기' 조정안과 그 스팟 이름(열 때 정한다). 시트를 닫을 때는 excludeOpen만 끄고 대상은 남겨 둔다.
   * 시트가 미끄러져 닫히는 동안에도 다시 그려지므로, 대상을 지우면 제목이 '를 빼요'로 깜박인다
   */
  const [confirmExclude, setConfirmExclude] = useState<{ adjustment: Adjustment; name: string } | undefined>(undefined);
  const [excludeOpen, setExcludeOpen] = useState(false);

  const day = plan?.days.find((d) => d.date === date);
  const adjustments = useMemo(() => (trip && plan ? overflowAdjustments(trip, plan, date) : []), [trip, plan, date]);
  const toSchedule = () => navigation.navigate('Main', { screen: 'Schedule', params: { date } });
  const back = () => (navigation.canGoBack() ? navigation.goBack() : toSchedule());

  // 편집 뒤 새 계획이 오면 새로 자동 제외된 스팟을 알린다
  useEffect(() => {
    if (!watch || !plan || plan === watch.plan) return;
    setExcludedLines(newlyExcludedLines(watch.excluded, plan));
    setWatch(undefined);
  }, [plan, watch]);

  if (!trip || !plan || !day) {
    return (
      <Screen>
        <Header back={back} title="일정 편집" size="row" />
        <Body>
          <Empty title="편집할 시간표가 없어요" action={{ label: '시간표로', onPress: toSchedule }} />
        </Body>
      </Screen>
    );
  }

  const beginWatch = () => {
    setExcludedLines([]);
    setWatch({ plan, excluded: plan.excluded.map((e) => e.spotId) });
  };

  /** 초안을 적용하고, 되돌릴 수 있으면 되돌리기 목록에 넣는다. 성공하면 true */
  const apply = (label: string, drafts: OpDraft[]): boolean => {
    const inverse = inverseDrafts(trip, drafts);
    const r = useTrips.getState().dispatchMany(trip.id, drafts);
    if (!r.ok) {
      showToast(`적용하지 못했어요. ${r.reason}`, 'warn');
      return false;
    }
    beginWatch();
    if (inverse) setUndo((u) => [...u, { label, drafts: inverse }]);
    return true;
  };

  /** 편집 한 번. 카드가 이 날에서 사라지면 어디로 갔는지 알린다 */
  const edit = (label: string, drafts: OpDraft[]) => {
    const toast = editToast(trip, date, drafts);
    if (apply(label, drafts) && toast) showToast(toast);
  };

  const applyAdjustment = (a: Adjustment) => {
    const toast = adjustmentToast(trip, date, a);
    if (apply(a.label, a.ops)) showToast(toast);
  };

  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    const r = useTrips.getState().dispatchMany(trip.id, last.drafts);
    if (!r.ok) {
      showToast(`되돌리지 못했어요. ${r.reason}`, 'warn');
      return;
    }
    beginWatch();
    setUndo((u) => u.slice(0, -1));
  };

  // 순서의 기준은 문서의 수동 순서(방금 보낸 reorder가 바로 반영된다), 그다음 계획 순서
  const ids = editOrder(trip, day);
  const items = ids.map((id) => day.items.find((it) => it.spotId === id)).filter((it): it is TimetableItem => !!it);
  const dates = dateRange(trip.startDate, trip.endDate);
  const busy = planning?.busy ?? false;
  const transport = dayTransport(trip, date);
  const canUndo = undo.length > 0;
  const overflow = day.overMin > 0 ? editOverflow(date, day) : undefined;
  const askExclude = (a: Adjustment) => {
    setConfirmExclude({ adjustment: a, name: excludeTarget(trip, a) ?? a.label });
    setExcludeOpen(true);
  };

  const move = (index: number, dir: -1 | 1) => {
    const it = items[index];
    if (!it) return;
    edit(`${it.name} 순서`, [{ type: 'schedule/reorder', date, spotIds: moveInOrder(ids, index, dir) }]);
  };

  const renderTools = (it: TimetableItem) => {
    const spot = trip.spots.find((s) => s.id === it.spotId);
    if (!spot) return null;
    const stay = (dir: -1 | 1) => {
      const next = stepStay(spot.stayMin, dir);
      if (next !== spot.stayMin) edit(`${it.name} 체류`, [{ type: 'schedule/setStay', spotId: it.spotId, stayMin: next }]);
    };
    // 도착 시각: 지정이 있으면 그 값에서, 없으면 계산된 도착 시각에서 15분씩(누르면 그 시각으로 지정된다)
    const arriveBase = spot.arriveOverride ?? it.arrive;
    const arrivePinnable = canPinArrive(arriveBase);
    const arrive = (dir: -1 | 1) => {
      const next = stepArrive(arriveBase, dir);
      if (next !== spot.arriveOverride) edit(`${it.name} 도착 시각`, [{ type: 'schedule/setArrive', spotId: it.spotId, arrive: next }]);
    };
    const dateKey = spot.fixedDate ?? 'auto';
    const dateOptions = [{ key: 'auto', label: '자동' }, ...dates.map((d) => ({ key: d, label: dayShort(d) }))];
    const pickDate = (k: string) => {
      if (k === dateKey) return;
      edit(`${it.name} 날짜`, [{ type: 'schedule/setDate', spotId: it.spotId, date: k === 'auto' ? null : k }]);
    };
    return (
      <Card variant="tinted">
        <Stepper
          label="체류"
          value={`${spot.stayMin}분`}
          minusLabel={`${it.name} 체류 ${STAY_STEP}분 줄이기`}
          plusLabel={`${it.name} 체류 ${STAY_STEP}분 늘리기`}
          minusDisabled={spot.stayMin <= STAY_MIN_LIMIT}
          plusDisabled={spot.stayMin >= STAY_MAX_LIMIT}
          onMinus={() => stay(-1)}
          onPlus={() => stay(1)}
        />
        <Stepper
          label="도착 시각 지정"
          value={spot.arriveOverride ? `${spot.arriveOverride} 지정` : `${it.arrive} 자동`}
          minusLabel={`${it.name} 도착 ${ARRIVE_STEP}분 앞당기기`}
          plusLabel={`${it.name} 도착 ${ARRIVE_STEP}분 늦추기`}
          minusDisabled={!arrivePinnable}
          plusDisabled={!arrivePinnable}
          onMinus={() => arrive(-1)}
          onPlus={() => arrive(1)}
          extra={
            spot.arriveOverride ? (
              <TextLink
                title="지정 풀기"
                onPress={() => edit(`${it.name} 도착 시각`, [{ type: 'schedule/setArrive', spotId: it.spotId, arrive: null }])}
              />
            ) : arrivePinnable ? (
              <TextLink
                title={arrivePinText(it.arrive)}
                onPress={() => edit(`${it.name} 도착 시각`, [{ type: 'schedule/setArrive', spotId: it.spotId, arrive: it.arrive }])}
              />
            ) : (
              <Txt v="mtTight">자정 뒤 도착이라 정할 수 없어요. 체류를 줄이거나 다른 날로 옮겨 주세요.</Txt>
            )
          }
        />
        <Col gap={SP.s}>
          <Txt v="mtTight">날짜</Txt>
          <Choice options={dateOptions} value={dateKey} onChange={pickDate} scroll />
        </Col>
        <ListRow
          icon="pinlock"
          label="고정 · 빠지지 않아요"
          switch={{
            value: spot.pinned,
            onChange: (next) => edit(`${it.name} 고정`, [{ type: 'spot/pin', spotId: it.spotId, pinned: next }]),
          }}
        />
      </Card>
    );
  };

  return (
    <Screen>
      <Header
        back={back}
        title="일정 편집"
        size="row"
        sub={editHeaderSub(date, day, busy)}
        right={busy ? <Icon name="clock" size={18} color="muted" /> : undefined}
      />
      <Body scroll>
        {overflow ? (
          <WarnCard
            title={overflow.title}
            text={overflow.text}
            items={adjustments.map((a, i) => ({
              label: `조정안 ${i + 1} · ${a.label}`,
              value: `-${humanMin(a.savedMin)}`,
              onPress: () => (a.kind === 'exclude' ? askExclude(a) : applyAdjustment(a)),
            }))}
          />
        ) : null}
        <Col gap={SP.s}>
          <Txt v="mtTight">이날 이동수단</Txt>
          <Choice
            options={TRANSPORTS.map((t) => ({ key: t, label: TRANSPORT_LABEL[t], icon: transportIcon(t) }))}
            value={transport}
            onChange={(t) => {
              if (t !== transport) edit('이날 이동수단', dayTransportDrafts(trip, date, t));
            }}
          />
        </Col>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.m, minHeight: H.touch }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt v="mtTight" numberOfLines={1}>
              {editOrderLabel(day)}
            </Txt>
          </View>
          {day.orderMethod === 'manual' ? (
            <TextLink title="자동 순서로" onPress={() => edit('자동 순서', [{ type: 'schedule/reorder', date, spotIds: [] }])} />
          ) : null}
        </View>
        <Col gap={SP.m}>
          {items.map((it, i) => {
            const on = it.spotId === expanded;
            const spot = trip.spots.find((s) => s.id === it.spotId);
            return (
              <Col key={it.spotId} gap={SP.m}>
                <Card variant={on ? 'selected' : 'default'}>
                  <Row gap={SP.s}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${i + 1}, ${it.name}, ${it.arrive}부터 ${it.depart}까지, 도구 ${on ? '접기' : '펼치기'}`}
                      accessibilityState={{ expanded: on }}
                      onPress={() => setExpanded(on ? undefined : it.spotId)}
                      style={{ flex: 1, minWidth: 0, minHeight: H.touch, flexDirection: 'row', alignItems: 'center', gap: SP.l }}
                    >
                      <OrderBadge n={i + 1} />
                      <Col grow gap={SP.xs}>
                        <Txt v="nm" numberOfLines={1}>
                          {it.name}
                        </Txt>
                        <Txt v="mtTight">{`${it.arrive} – ${it.depart} · 체류 ${it.stayMin}분 · 이동 ${humanMin(it.travelMin)}`}</Txt>
                      </Col>
                    </Pressable>
                    <IconBtn icon="up" label={`${it.name} 앞으로`} disabled={i === 0} onPress={() => move(i, -1)} />
                    <IconBtn icon="down" label={`${it.name} 뒤로`} disabled={i === items.length - 1} onPress={() => move(i, 1)} />
                  </Row>
                  {it.pinned || spot?.fixedDate || spot?.arriveOverride || it.notices.length ? (
                    <Row gap={SP.s} wrap>
                      {it.pinned ? <Chip text="고정" icon="pinlock" /> : null}
                      {spot?.fixedDate ? <Chip text={`${dayShort(spot.fixedDate)} 지정`} tone="line" /> : null}
                      {spot?.arriveOverride ? <Chip text={`도착 ${spot.arriveOverride} 지정`} tone="line" /> : null}
                      {it.notices.map((n) => (
                        <Chip key={n.kind + n.text} text={n.text} tone={n.kind === 'estimated' ? 'line' : 'warn'} />
                      ))}
                    </Row>
                  ) : null}
                </Card>
                {on ? renderTools(it) : null}
              </Col>
            );
          })}
        </Col>
      </Body>
      <Foot>
        {excludedLines.length ? (
          <Notice
            icon="alert"
            tone="warn"
            title="편집 뒤 제외 스팟이 생겼어요"
            text={`${excludedLines.join('\n')}${canUndo ? '\n되돌리려면 되돌리기를 눌러 주세요.' : ''}`}
          />
        ) : null}
        <Row gap={SP.m}>
          <View>
            <Btn title="되돌리기" icon="undo" variant="quiet" disabled={!canUndo} onPress={undoLast} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="시간표로" onPress={toSchedule} />
          </View>
        </Row>
      </Foot>
      <ConfirmSheet
        visible={excludeOpen && !!confirmExclude}
        title={confirmExclude ? `${josa(confirmExclude.name, '을/를')} 빼요` : ''}
        text="이날 시간표에서 빠져 후보의 제외 스팟으로 가요. 후보 화면에서 다시 넣을 수 있어요."
        confirmLabel="빼기"
        onConfirm={() => {
          setExcludeOpen(false);
          if (excludeOpen && confirmExclude) applyAdjustment(confirmExclude.adjustment);
        }}
        onCancel={() => setExcludeOpen(false)}
      />
    </Screen>
  );
}
