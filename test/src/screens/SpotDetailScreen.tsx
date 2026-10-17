import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MapMarkerInput } from '../core/map/layout';
import { previewOps } from '../core/planner/preview';
import { dateRange, josa } from '../core/util';
import { MapCanvas } from '../components/map/MapCanvas';
import {
  baseTransport,
  deleteNotice,
  detailRows,
  footActions,
  spotDetail,
  stayPreviewText,
  type DetailRowKey,
  type FootAction,
} from '../features/candidates/detail';
import { memberIndex } from '../features/chat/view';
import { daySegLabel } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { appClock } from '../services/clock';
import { getServices } from '../services/registry';
import { myMemberId, usePlan, useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Avatar,
  Body,
  Btn,
  Card,
  Chip,
  Col,
  ConfirmSheet,
  Foot,
  H,
  Header,
  lineC,
  ListRow,
  NotFound,
  Notice,
  Row,
  Screen,
  Sheet,
  SP,
  Txt,
} from '../ui';

/**
 * 07 스팟 상세(FR-803, WP3 소유).
 * - 이름, 종류·주소, MapCanvas compact 미리보기, 정보 목록(ListRow 키-값), 제안자 아바타, 채팅 원문.
 * - 정보 목록(detail.ts detailRows, 순수): 체류와 날짜는 누르면 시트가 열린다. 기점에서 오는 이동과 배치 시각은 읽기 전용이고
 *   정보가 없으면 줄을 만들지 않는다. '여기까지 길찾기'는 정보 아래 작은 버튼이다.
 * - previewOps로 '체류를 N분으로 늘리면 X가 제외 스팟이 돼요'를 체류 시트 안 안내로 미리 알린다(문서를 바꾸지 않는다).
 * - 아래 버튼(detail.ts footActions, 순수): 확정·배치 전이면 '시간표에서 보기'(배치됐을 때만)와 '고정하기' 또는 '고정 풀기',
 *   제외 스팟이면 '고정해서 다시 넣기' 하나. 머리말에는 버튼을 두지 않는다.
 * - 맨 아래 '관리' 구역: '직접 빼기'(되돌릴 수 있어 바로 하고 토스트로 알린다), '후보에서 지우기'(되돌릴 수 없어 확인 1회,
 *   지운 뒤 토스트를 띄우고 뒤로 간다). 지우기는 채팅·수동·추천 후보 모두에 있다.
 * - 뒤로는 useBack('Schedule'), 없는 후보는 NotFound('홈으로').
 * - 제안자 아바타 색은 05와 같은 멤버 등록 순(memberIndex)이다. 목록 안 순서로 정하지 않는다.
 */

const STAY_OPTIONS = [30, 45, 60, 90, 120, 150, 180];
const PREVIEW_STEP_MIN = 30;

export default function SpotDetailScreen({ navigation, route }: RootScreenProps<'SpotDetail'>) {
  const { tripId, spotId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const spot = trip?.spots.find((s) => s.id === spotId);
  const toast = useUi((s) => s.showToast);
  const back = useBack('Schedule');
  const [baseMin, setBaseMin] = useState<number | undefined>();
  const [preview, setPreview] = useState<string | undefined>();
  const [sheet, setSheet] = useState<'stay' | 'date' | 'delete' | undefined>();

  const detail = useMemo(() => (trip && spot ? spotDetail(trip, plan, spot, baseMin) : undefined), [trip, plan, spot, baseMin]);
  const day = plan?.days.find((d) => d.date === detail?.date);

  // 기점에서 오는 시간: 그날 첫 스팟이 아니면 경로 제공자로 한 번 구한다. 실패하면 줄을 생략한다.
  // 수단은 그날 수단(baseTransport) 하나로 정하고, detail.ts의 줄 값도 같은 값을 쓴다.
  const base = day?.base;
  const transport = trip ? baseTransport(trip, day?.date) : 'car';
  useEffect(() => {
    let alive = true;
    setBaseMin(undefined);
    if (!base || !spot) return;
    getServices()
      .routes.route(base.coord, spot.coord, transport)
      .then((leg) => {
        if (alive && leg) setBaseMin(leg.minutes);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [base?.coord.latitude, base?.coord.longitude, spot?.coord.latitude, spot?.coord.longitude, transport, day?.date]);

  // 체류를 30분 늘리면 무엇이 빠지는지 미리 계산한다(체류 시트 안에 보인다).
  useEffect(() => {
    let alive = true;
    setPreview(undefined);
    if (!trip || !spot || !plan || detail?.status !== 'confirmed') return;
    const next = spot.stayMin + PREVIEW_STEP_MIN;
    previewOps(trip, plan, [{ type: 'schedule/setStay', spotId: spot.id, stayMin: next }], {
      routes: getServices().routes,
      now: appClock().now(),
    })
      .then((diff) => {
        if (!alive) return;
        const names = diff.newlyExcluded.map((id) => trip.spots.find((s) => s.id === id)?.name ?? '').filter(Boolean);
        setPreview(stayPreviewText(next, names));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [trip, plan, spot?.stayMin, detail?.status]);

  if (!trip || !spot || !detail) {
    return (
      <Screen>
        <Header back={back} title="스팟 상세" />
        <Body>
          <NotFound title="후보를 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const dispatch = useTrips.getState().dispatch;
  const markers: MapMarkerInput[] = [
    {
      id: spot.id,
      coord: spot.coord,
      kind: detail.status === 'excluded' ? 'excluded' : 'spot',
      label: detail.status === 'excluded' ? '제외' : detail.item ? String((day?.items.indexOf(detail.item) ?? 0) + 1) : undefined,
      title: spot.name,
    },
  ];
  if (base) markers.push({ id: 'base', coord: base.coord, kind: 'base', title: base.name });
  const del = deleteNotice(spot, myMemberId(trip));
  const rows = detailRows(detail);
  const actions = footActions(detail, !!detail.item);
  const editSheet: Partial<Record<DetailRowKey, 'stay' | 'date'>> = { stay: 'stay', date: 'date' };

  const act = (a: FootAction) => {
    if (a.key === 'timetable') {
      // 시간표는 지금 보는 여행방을 그린다. 이 방으로 맞추고 배치된 날로 간다.
      useUi.getState().setCurrentTrip(tripId);
      navigation.navigate('Main', { screen: 'Schedule', params: { date: detail.date } });
      return;
    }
    if (a.key === 'restore') {
      const r = dispatch(tripId, { type: 'spot/restore', spotId });
      if (r.ok) toast(`${josa(spot.name, '을/를')} 고정해서 확정 스팟으로 옮겼어요`);
      return;
    }
    dispatch(tripId, { type: 'spot/pin', spotId, pinned: a.key === 'pin' });
  };

  const removeNow = () => {
    const r = dispatch(tripId, { type: 'spot/remove', spotId, reason: 'user' });
    if (r.ok) toast(`${josa(spot.name, '을/를')} 제외 스팟으로 옮겼어요`);
  };

  return (
    <Screen>
      <Header back={back} eyebrow={detail.eyebrow} title={spot.name} sub={detail.sub || undefined} />
      <Body scroll>
        <MapCanvas compact height={126} markers={markers} polylines={[]} fitTo={base ? [base.coord, spot.coord] : [spot.coord]} />
        {/* 27 자유 길찾기. 출발은 기점(없으면 직접 고른다), 도착은 이 스팟 */}
        <Btn
          title="여기까지 길찾기"
          size="sm"
          variant="quiet"
          icon="nav"
          onPress={() => navigation.navigate('Directions', { tripId, toSpotId: spotId })}
        />

        {spot.pinned || spot.outsideRegion ? (
          <Row wrap gap={SP.s}>
            {spot.pinned ? <Chip text="고정" icon="pinlock" /> : null}
            {spot.outsideRegion ? <Chip text="목적지 밖" tone="warn" /> : null}
          </Row>
        ) : null}

        {detail.status === 'excluded' ? (
          <Card variant="excluded">
            <Txt v="nm" c="muted">
              제외 스팟
            </Txt>
            <Txt v="mt">{detail.excluded?.reason ?? '사용자가 직접 뺌'}</Txt>
          </Card>
        ) : null}

        <Col>
          {rows.map((r, i) => {
            const opens = r.editable ? editSheet[r.key] : undefined;
            return (
              <ListRow
                key={r.key}
                first={i === 0}
                label={r.label}
                value={r.value}
                onPress={opens ? () => setSheet(opens) : undefined}
              />
            );
          })}
        </Col>
        {/* 27 자유 길찾기. 출발은 기점(없으면 직접 고른다), 도착은 이 스팟 */}
        <View style={styles.start}>
          <Btn
            title="여기까지 길찾기"
            size="sm"
            variant="quiet"
            icon="nav"
            onPress={() => navigation.navigate('Directions', { tripId, toSpotId: spotId })}
          />
        </View>

        {detail.proposers.length > 0 ? (
          <Card>
            <Txt v="eyebrow">{`제안자 ${detail.proposers.length}명`}</Txt>
            <Row gap={SP.m}>
              <View style={styles.avatars}>
                {detail.proposers.map((p, i) => (
                  <Avatar
                    key={p.id}
                    name={p.name}
                    index={memberIndex(trip.members, p.id)}
                    style={i > 0 ? { marginLeft: H.avatarOverlap } : undefined}
                  />
                ))}
              </View>
              <Txt v="mt" style={styles.grow}>
                {detail.proposerNames.join(' · ')}
              </Txt>
            </Row>
            {detail.quotes.length > 0 ? (
              <>
                <View style={styles.rule} />
                <Col gap={SP.s}>
                  <Txt v="mtTight">채팅에서 가져온 말</Txt>
                  {detail.quotes.map((q) => (
                    <Col key={q.text} gap={2}>
                      <Txt v="bubble">{`“${q.text}”`}</Txt>
                      {q.who ? <Txt v="mtTight">{`— ${q.who}`}</Txt> : null}
                    </Col>
                  ))}
                </Col>
              </>
            ) : null}
          </Card>
        ) : null}

        {/* 관리: 드물거나 되돌릴 수 없는 일은 맨 아래로 내린다 */}
        <Col>
          <Txt v="eyebrow">관리</Txt>
          {detail.status !== 'excluded' ? <ListRow first icon="minus" label="직접 빼기" onPress={removeNow} /> : null}
          <ListRow
            first={detail.status === 'excluded'}
            icon="trash"
            label={del.label}
            onPress={() => setSheet('delete')}
          />
        </Col>
      </Body>
      <Foot>
        <Row gap={SP.m}>
          {actions.map((a) => (
            <View key={a.key} style={styles.grow}>
              <Btn title={a.title} variant={a.variant} onPress={() => act(a)} />
            </View>
          ))}
        </Row>
      </Foot>

      <Sheet visible={sheet === 'stay'} onClose={() => setSheet(undefined)} title="체류 시간">
        <Txt v="mt">{`지금 ${spot.stayMin}분`}</Txt>
        <Row wrap gap={SP.s}>
          {STAY_OPTIONS.map((m) => (
            <Btn
              key={m}
              title={`${m}분`}
              size="sm"
              variant={m === spot.stayMin ? 'primary' : 'quiet'}
              onPress={() => {
                dispatch(tripId, { type: 'schedule/setStay', spotId, stayMin: m });
                setSheet(undefined);
              }}
            />
          ))}
        </Row>
        {preview ? <Notice icon="clock" text={preview} /> : null}
      </Sheet>

      <Sheet visible={sheet === 'date'} onClose={() => setSheet(undefined)} title="날짜 지정" scroll>
        <Col gap={SP.s}>
          {dateRange(trip.startDate, trip.endDate).map((d) => (
            <Btn
              key={d}
              title={daySegLabel(d)}
              size="sm"
              variant={spot.fixedDate === d ? 'primary' : 'quiet'}
              onPress={() => {
                dispatch(tripId, { type: 'schedule/setDate', spotId, date: d });
                setSheet(undefined);
              }}
            />
          ))}
          {spot.fixedDate ? (
            <Btn
              title="지정 풀기(자동 배분)"
              size="sm"
              variant="ghost"
              onPress={() => {
                dispatch(tripId, { type: 'schedule/setDate', spotId, date: null });
                setSheet(undefined);
              }}
            />
          ) : null}
        </Col>
      </Sheet>

      <ConfirmSheet
        visible={sheet === 'delete'}
        title="후보에서 지울까요?"
        text={del.text}
        confirmLabel="지우기"
        onConfirm={() => {
          setSheet(undefined);
          const r = dispatch(tripId, { type: 'spot/delete', spotId });
          if (!r.ok) return;
          toast(`${josa(spot.name, '을/를')} 후보에서 지웠어요`);
          back();
        }}
        onCancel={() => setSheet(undefined)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  grow: { flex: 1 },
  avatars: { flexDirection: 'row' },
  rule: { height: 1, backgroundColor: lineC.line, marginVertical: SP.xs },
});
