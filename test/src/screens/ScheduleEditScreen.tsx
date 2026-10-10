import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { OpDraft, Plan, TimetableItem } from '../types';
import { overflowAdjustments, overflowText } from '../core/planner/adjust';
import { dateRange, dayShort, humanMin, toMin } from '../core/util';
import { canPinArrive, editOrder, inverseDrafts, moveInOrder, stepArrive, stepStay } from '../features/schedule/edit';
import { dayTitle, newlyExcludedLines } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { usePlan, usePlanning, useTripDoc, useTrips } from '../store/trips';
import {
  Body,
  Btn,
  Card,
  Chip,
  Choice,
  Col,
  Empty,
  Foot,
  H,
  Header,
  Icon,
  IconBtn,
  lineC,
  Notice,
  R,
  Row,
  Screen,
  SP,
  surfaceC,
  Txt,
  WarnCard,
} from '../ui';

/**
 * 10 일정 편집(FR-503, WP4 소유). 목업 10.
 * - 카드를 누르면 '옮기는 중'으로 고르고, 그 아래에서 앞으로·뒤로(schedule/reorder), 체류 ±15분(setStay),
 *   도착 시각 ±15분·고정·풀기(setArrive), 날짜 지정(setDate), 고정(spot/pin)을 바꾼다
 * - 바꾼 값은 누르는 즉시 op로 저장되고 스토어가 다시 계산한다. 스팟과 날짜 설정에 저장하므로 다른 op로 재계산해도 남는다
 * - 다음 값은 계획이 아니라 문서 값에서 만든다(체류·도착은 스팟 값, 순서는 문서의 수동 순서 우선, editOrder).
 *   계획은 디바운스와 오프라인 때문에 늦게 바뀌므로, 빠르게 두 번 눌러도 두 번 적용된다
 * - 수용량을 넘겨도 막지 않는다. 앰버 WarnCard에 초과분과 조정안(체류 줄이기, 다른 날로 옮기기, 빼기)을 숫자로 보여주고,
 *   누르면 dispatchMany로 한 번에 적용한다
 * - 편집 뒤 재계산에서 새로 자동 제외된 스팟은 이유와 함께 알리고 되돌리기를 둔다(조용한 제외 없음)
 * - 되돌리기는 이 화면에서 한 편집을 적용 전 값으로 되돌린다(빼기는 후보 화면의 되돌리기를 쓴다)
 * - 10은 즉시 저장이라 하단 버튼은 '저장하고 시간표로'가 아니라 '시간표로'다(04 코드 리뷰 회의 결정)
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

/** 날짜가 이보다 많으면 날짜 선택을 가로 스크롤 줄로 그린다(자동 + 날짜 수) */
const CHOICE_MAX_OPTIONS = 5;

function DateScroll({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.m }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={{
              minHeight: H.btnSm,
              paddingHorizontal: SP.xl,
              borderRadius: R.btnSm,
              borderWidth: 1,
              borderColor: on ? lineC.accent : lineC.line,
              backgroundColor: on ? surfaceC.accent : surfaceC.card,
              justifyContent: 'center',
            }}
          >
            <Txt v="btnSm" c={on ? 'onAccent' : 'muted'}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function ScheduleEditScreen({ navigation, route }: RootScreenProps<'ScheduleEdit'>) {
  const { tripId, date } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const planning = usePlanning(tripId);
  const online = useTrips((s) => s.online);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [watch, setWatch] = useState<Watch | undefined>(undefined);
  const [excludedLines, setExcludedLines] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  const day = plan?.days.find((d) => d.date === date);
  const adjustments = useMemo(() => (trip && plan ? overflowAdjustments(trip, plan, date) : []), [trip, plan, date]);
  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Schedule', params: { date } }));

  // 편집 뒤 새 계획이 오면 새로 자동 제외된 스팟을 알린다
  useEffect(() => {
    if (!watch || !plan || plan === watch.plan) return;
    setExcludedLines(newlyExcludedLines(watch.excluded, plan));
    setWatch(undefined);
  }, [plan, watch]);

  if (!trip || !plan || !day) {
    return (
      <Screen>
        <Header back={back} title="일정 편집" size="sm" />
        <Body>
          <Empty title="편집할 시간표가 없습니다" />
        </Body>
      </Screen>
    );
  }

  const beginWatch = () => {
    setExcludedLines([]);
    setWatch({ plan, excluded: plan.excluded.map((e) => e.spotId) });
  };

  /** 초안을 적용하고, 되돌릴 수 있으면 되돌리기 목록에 넣는다 */
  const apply = (label: string, drafts: OpDraft[]) => {
    const inverse = inverseDrafts(trip, drafts);
    const r = useTrips.getState().dispatchMany(trip.id, drafts);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setError(undefined);
    beginWatch();
    if (inverse) setUndo((u) => [...u, { label, drafts: inverse }]);
  };

  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    const r = useTrips.getState().dispatchMany(trip.id, last.drafts);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setError(undefined);
    beginWatch();
    setUndo((u) => u.slice(0, -1));
  };

  // 순서의 기준은 문서의 수동 순서(방금 보낸 reorder가 바로 반영된다), 그다음 계획 순서
  const ids = editOrder(trip, day);
  const items = ids.map((id) => day.items.find((it) => it.spotId === id)).filter((it): it is TimetableItem => !!it);
  const dates = dateRange(trip.startDate, trip.endDate);
  const busy = planning?.busy ?? false;

  const renderTools = (it: TimetableItem, index: number) => {
    const spot = trip.spots.find((s) => s.id === it.spotId);
    if (!spot) return null;
    const move = (dir: -1 | 1) =>
      apply(`${it.name} 순서`, [{ type: 'schedule/reorder', date, spotIds: moveInOrder(ids, index, dir) }]);
    const stay = (dir: -1 | 1) => {
      const next = stepStay(spot.stayMin, dir);
      if (next !== spot.stayMin) apply(`${it.name} 체류`, [{ type: 'schedule/setStay', spotId: it.spotId, stayMin: next }]);
    };
    // 도착 시각: 지정이 있으면 그 값에서, 없으면 계산된 도착 시각에서 15분씩
    const arriveBase = spot.arriveOverride ?? it.arrive;
    const arrivePinnable = canPinArrive(arriveBase);
    const arrive = (dir: -1 | 1) => {
      const next = stepArrive(arriveBase, dir);
      if (next !== spot.arriveOverride) apply(`${it.name} 도착 시각`, [{ type: 'schedule/setArrive', spotId: it.spotId, arrive: next }]);
    };
    const dateKey = spot.fixedDate ?? 'auto';
    const dateOptions = [{ key: 'auto', label: '자동' }, ...dates.map((d) => ({ key: d, label: dayShort(d) }))];
    const pickDate = (k: string) =>
      apply(`${it.name} 날짜`, [{ type: 'schedule/setDate', spotId: it.spotId, date: k === 'auto' ? null : k }]);
    return (
      <Card variant="tinted">
        <Col gap={SP.l}>
          <Txt v="label" c="accentStrong">
            순서
          </Txt>
          <Row gap={SP.m}>
            <View style={{ flex: 1 }}>
              <Btn title="앞으로" variant="ghost" size="sm" disabled={index === 0} onPress={() => move(-1)} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="뒤로" variant="ghost" size="sm" disabled={index === ids.length - 1} onPress={() => move(1)} />
            </View>
          </Row>
          <Txt v="label" c="accentStrong">
            {`체류 ${spot.stayMin}분`}
          </Txt>
          <Row gap={SP.m}>
            <View style={{ flex: 1 }}>
              <Btn title="15분 줄이기" variant="quiet" size="sm" onPress={() => stay(-1)} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="15분 늘리기" variant="quiet" size="sm" onPress={() => stay(1)} />
            </View>
          </Row>
          <Txt v="label" c="accentStrong">
            {spot.arriveOverride ? `도착 ${spot.arriveOverride} 지정` : `도착 ${it.arrive}(자동)`}
          </Txt>
          {arrivePinnable ? (
            <Row gap={SP.m}>
              <View style={{ flex: 1 }}>
                <Btn title="15분 앞당기기" variant="quiet" size="sm" onPress={() => arrive(-1)} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn title="15분 늦추기" variant="quiet" size="sm" onPress={() => arrive(1)} />
              </View>
            </Row>
          ) : (
            <Txt v="mtTight">활동시간을 넘겨 자정 뒤 도착이라 도착 시각을 정할 수 없습니다. 체류를 줄이거나 다른 날로 옮겨 주세요.</Txt>
          )}
          <Txt v="label" c="accentStrong">
            날짜
          </Txt>
          {dateOptions.length <= CHOICE_MAX_OPTIONS ? (
            <Choice options={dateOptions} value={dateKey} onChange={pickDate} />
          ) : (
            <DateScroll options={dateOptions} value={dateKey} onChange={pickDate} />
          )}
          <Row gap={SP.m}>
            <View style={{ flex: 1 }}>
              {spot.arriveOverride ? (
                <Btn
                  title="도착 지정 풀기"
                  variant="quiet"
                  size="sm"
                  onPress={() => apply(`${it.name} 도착 시각`, [{ type: 'schedule/setArrive', spotId: it.spotId, arrive: null }])}
                />
              ) : (
                <Btn
                  title={`${it.arrive} 도착 고정`}
                  variant="quiet"
                  size="sm"
                  disabled={!arrivePinnable}
                  onPress={() => apply(`${it.name} 도착 시각`, [{ type: 'schedule/setArrive', spotId: it.spotId, arrive: it.arrive }])}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Btn
                title={spot.pinned ? '고정 풀기' : '고정'}
                variant={spot.pinned ? 'quiet' : 'ghost'}
                size="sm"
                icon="pinlock"
                onPress={() => apply(`${it.name} 고정`, [{ type: 'spot/pin', spotId: it.spotId, pinned: !spot.pinned }])}
              />
            </View>
          </Row>
        </Col>
      </Card>
    );
  };

  const end = day.items.length ? toMin(day.items[day.items.length - 1].depart) + day.returnMin : day.startMin;
  const canUndo = undo.length > 0;

  return (
    <Screen>
      <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: 14 }}>
        <Row gap={SP.l}>
          <IconBtn icon="x" label="닫기" onPress={back} />
          <Col grow gap={2}>
            <Txt v="nm">일정 편집</Txt>
            <Txt v="mtTight">{`${dayTitle(date)} · ${day.items.length}곳`}</Txt>
          </Col>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="되돌리기"
            accessibilityState={{ disabled: !canUndo }}
            disabled={!canUndo}
            onPress={undoLast}
            hitSlop={8}
          >
            <Txt v="btnSm" c={canUndo ? 'accent' : 'muted'}>
              되돌리기
            </Txt>
          </Pressable>
        </Row>
      </View>
      <Body scroll>
        {!online ? <Notice icon="alert" text="오프라인입니다. 편집은 저장해 두고 연결되면 다시 계산합니다." /> : null}
        {busy ? <Chip text="다시 계산하는 중" icon="clock" /> : null}
        {error ? <Notice icon="alert" tone="warn" title="적용하지 못했습니다" text={error} /> : null}
        {excludedLines.length ? (
          <Notice
            icon="alert"
            tone="warn"
            title="편집 뒤 제외 스팟이 생겼습니다"
            text={`${excludedLines.join('\n')}${canUndo ? '\n되돌리려면 오른쪽 위 되돌리기를 누르세요.' : ''}`}
          />
        ) : null}
        <Col gap={SP.m}>
          {items.map((it, i) => {
            const on = it.spotId === selected;
            const spot = trip.spots.find((s) => s.id === it.spotId);
            return (
              <Col key={it.spotId} gap={SP.m}>
                <Card variant={on ? 'selected' : 'default'} onPress={() => setSelected(on ? undefined : it.spotId)}>
                  <Row gap={SP.l}>
                    <Icon name="drag" size={18} color={on ? 'accent' : 'faint'} />
                    <Col grow gap={SP.xs}>
                      <Txt v="nm">{it.name}</Txt>
                      <Txt v="mtTight">{`${it.arrive} – ${it.depart} · 이동 ${humanMin(it.travelMin)}`}</Txt>
                    </Col>
                    {on ? (
                      <Chip text="옮기는 중" />
                    ) : it.pinned ? (
                      <Chip text="고정" icon="pinlock" />
                    ) : (
                      <Chip text={`${it.stayMin}분`} tone="line" />
                    )}
                  </Row>
                  {spot?.fixedDate || spot?.arriveOverride || it.notices.length ? (
                    <Row gap={SP.s} wrap>
                      {spot?.fixedDate ? <Chip text={`${dayShort(spot.fixedDate)} 지정`} tone="line" /> : null}
                      {spot?.arriveOverride ? <Chip text={`${spot.arriveOverride} 도착 고정`} tone="line" /> : null}
                      {it.notices.map((n) => (
                        <Chip key={n.kind + n.text} text={n.text} tone={n.kind === 'estimated' ? 'line' : 'warn'} />
                      ))}
                    </Row>
                  ) : null}
                </Card>
                {on ? renderTools(it, i) : null}
              </Col>
            );
          })}
        </Col>
        {day.overMin > 0 ? (
          <WarnCard
            title={`${dayShort(date)} 수용량을 ${humanMin(day.overMin)} 넘겼습니다`}
            text={`이대로 두면 ${overflowText(day)}.`}
            items={adjustments.map((a, i) => ({
              label: `조정안 ${i + 1} · ${a.label}`,
              value: `-${humanMin(a.savedMin)}`,
              onPress: () => apply(a.label, a.ops),
            }))}
          />
        ) : null}
        {day.orderMethod === 'manual' ? (
          <Btn
            title="자동 순서로 되돌리기"
            variant="quiet"
            size="sm"
            onPress={() => apply('자동 순서', [{ type: 'schedule/reorder', date, spotIds: [] }])}
          />
        ) : null}
        <Txt v="mtTight">{`${day.items.length}곳 · ${humanMin(end - day.startMin)}`}</Txt>
      </Body>
      <Foot>
        <Btn title="시간표로" onPress={() => navigation.navigate('Main', { screen: 'Schedule', params: { date } })} />
      </Foot>
    </Screen>
  );
}
