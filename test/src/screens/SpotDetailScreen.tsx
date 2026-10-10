import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { MapMarkerInput } from '../core/map/layout';
import { previewOps } from '../core/planner/preview';
import { dateRange, dayLabel, josa } from '../core/util';
import { MapCanvas } from '../components/map/MapCanvas';
import { baseTransport, deleteNotice, spotDetail, stayPreviewText } from '../features/candidates/detail';
import { memberIndex } from '../features/chat/view';
import type { RootScreenProps } from '../navigation/routes';
import { appClock } from '../services/clock';
import { getServices } from '../services/registry';
import { myMemberId, usePlan, useTripDoc, useTrips } from '../store/trips';
import {
  Avatar,
  Body,
  H,
  Btn,
  Card,
  Chip,
  Col,
  ConfirmSheet,
  Empty,
  Foot,
  Header,
  Icon,
  IconBtn,
  lineC,
  Row,
  Screen,
  Sheet,
  SP,
  Txt,
} from '../ui';

/**
 * 07 스팟 상세(FR-803, WP3 소유).
 * - 이름, 종류·주소, MapCanvas compact 미리보기, 정보 칸 3개(체류, 기점에서, 배치 시각), 제안자 아바타, 채팅 원문.
 * - 정보가 없는 항목은 생략한다(주소 없음, 계획 전 배치 시각 없음 등).
 * - previewOps로 '체류를 N분으로 늘리면 X가 제외 스팟이 됩니다'를 미리 알린다(문서를 바꾸지 않는다).
 * - 조작: 고정, 체류 바꾸기(schedule/setStay), 날짜 지정(schedule/setDate), 직접 빼기(quiet + 확인 1회),
 *   제외 스팟 되돌리기(→고정), 잘못 잡은 후보 지우기(spot/delete, 확인 1회). 지우기는 채팅·수동·추천 후보 모두에 있다.
 * - 제안자 아바타 색은 05와 같은 멤버 등록 순(memberIndex)이다. 목록 안 순서로 정하지 않는다.
 * 계산은 features/candidates/detail.ts(순수)에 있다.
 */

const STAY_OPTIONS = [30, 45, 60, 90, 120, 150, 180];
const PREVIEW_STEP_MIN = 30;

export default function SpotDetailScreen({ navigation, route }: RootScreenProps<'SpotDetail'>) {
  const { tripId, spotId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const spot = trip?.spots.find((s) => s.id === spotId);
  const [baseMin, setBaseMin] = useState<number | undefined>();
  const [preview, setPreview] = useState<string | undefined>();
  const [sheet, setSheet] = useState<'stay' | 'date' | 'remove' | 'delete' | undefined>();
  const back = navigation.canGoBack() ? navigation.goBack : undefined;

  const detail = useMemo(() => (trip && spot ? spotDetail(trip, plan, spot, baseMin) : undefined), [trip, plan, spot, baseMin]);
  const day = plan?.days.find((d) => d.date === detail?.date);

  // 기점에서 오는 시간: 그날 첫 스팟이 아니면 경로 제공자로 한 번 구한다. 실패하면 칸을 생략한다.
  // 수단은 그날 수단(baseTransport) 하나로 정하고, detail.ts의 칸 라벨도 같은 값을 쓴다.
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

  // 체류를 30분 늘리면 무엇이 빠지는지 미리 계산한다.
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
          <Empty title="후보를 찾을 수 없습니다" />
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
  const sample = getServices().places.id === 'local';

  return (
    <Screen>
      <Header
        back={back}
        eyebrow={detail.eyebrow}
        title={spot.name}
        sub={detail.sub || undefined}
        right={
          detail.status !== 'excluded' ? (
            <IconBtn
              icon="pinlock"
              label={spot.pinned ? '고정 풀기' : '고정하기'}
              color={spot.pinned ? 'accent' : 'muted'}
              onPress={() => dispatch(tripId, { type: 'spot/pin', spotId, pinned: !spot.pinned })}
            />
          ) : undefined
        }
      />
      <Body scroll>
        <MapCanvas compact height={126} markers={markers} polylines={[]} fitTo={base ? [base.coord, spot.coord] : [spot.coord]} />

        <Row gap={SP.m}>
          {detail.cells.map((c) => (
            <Card key={c.label} style={{ flex: 1, paddingVertical: SP.l, paddingHorizontal: SP.xl }}>
              <Col gap={SP.xs}>
                <Txt v="mtTight">{c.label}</Txt>
                <Txt v="nm">{c.value}</Txt>
              </Col>
            </Card>
          ))}
        </Row>

        <Row wrap gap={SP.s}>
          {spot.pinned ? <Chip text="고정" icon="pinlock" /> : null}
          {spot.fixedDate ? <Chip text={`${dayLabel(spot.fixedDate)} 지정`} icon="cal" /> : null}
          {spot.outsideRegion ? <Chip text="목적지 밖" tone="warn" /> : null}
        </Row>

        {detail.status === 'excluded' ? (
          <Card variant="excluded">
            <Txt v="nm" c="muted">
              제외 스팟
            </Txt>
            <Txt v="mt">{detail.excluded?.reason ?? '사용자가 직접 뺌'}</Txt>
            <Btn
              title="되돌리기"
              size="sm"
              variant="ghost"
              icon="undo"
              onPress={() => dispatch(tripId, { type: 'spot/restore', spotId })}
            />
          </Card>
        ) : null}

        {detail.proposers.length > 0 ? (
          <Card>
            <Txt v="eyebrow">{`제안자 ${detail.proposers.length}명`}</Txt>
            <Row gap={SP.m}>
              <View style={{ flexDirection: 'row' }}>
                {detail.proposers.map((p, i) => (
                  <Avatar
                    key={p.id}
                    name={p.name}
                    index={memberIndex(trip.members, p.id)}
                    style={i > 0 ? { marginLeft: H.avatarOverlap } : undefined}
                  />
                ))}
              </View>
              <Txt v="mt" style={{ flex: 1 }}>
                {detail.proposerNames.join(' · ')}
              </Txt>
            </Row>
            {detail.quotes.length > 0 ? (
              <>
                <View style={{ height: 1, backgroundColor: lineC.line, marginVertical: SP.xs }} />
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

        {preview ? (
          <Card variant="tinted">
            <Row gap={SP.m}>
              <Icon name="clock" size={16} color="accentStrong" stroke={1.8} />
              <Txt v="mtTight" c="accentStrong" style={{ flex: 1 }}>
                {preview}
              </Txt>
            </Row>
          </Card>
        ) : null}

        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn title={spot.fixedDate ? '날짜 바꾸기' : '날짜 지정'} size="sm" variant="quiet" icon="cal" onPress={() => setSheet('date')} />
          </View>
          {detail.status !== 'excluded' ? (
            <View style={{ flex: 1 }}>
              <Btn title="직접 빼기" size="sm" variant="quiet" onPress={() => setSheet('remove')} />
            </View>
          ) : null}
        </Row>
        <Btn title={del.label} size="sm" variant="quiet" icon="trash" onPress={() => setSheet('delete')} />
      </Body>
      <Foot>
        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn
              title={spot.pinned ? '고정 풀기' : '고정하기'}
              variant="quiet"
              onPress={() => dispatch(tripId, { type: 'spot/pin', spotId, pinned: !spot.pinned })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="체류 시간 바꾸기" onPress={() => setSheet('stay')} />
          </View>
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
      </Sheet>

      <Sheet visible={sheet === 'date'} onClose={() => setSheet(undefined)} title="날짜 지정">
        <Col gap={SP.s}>
          {dateRange(trip.startDate, trip.endDate).map((d) => (
            <Btn
              key={d}
              title={dayLabel(d)}
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
        visible={sheet === 'remove'}
        title="이 후보를 뺄까요?"
        text={`${josa(spot.name, '은/는')} 제외 스팟 구역으로 옮겨지고 '사용자가 직접 뺌'으로 표시됩니다. 언제든 되돌릴 수 있습니다.`}
        confirmLabel="빼기"
        onConfirm={() => {
          dispatch(tripId, { type: 'spot/remove', spotId, reason: 'user' });
          setSheet(undefined);
        }}
        onCancel={() => setSheet(undefined)}
      />
      <ConfirmSheet
        visible={sheet === 'delete'}
        title="후보에서 지울까요?"
        text={del.text}
        confirmLabel="지우기"
        onConfirm={() => {
          setSheet(undefined);
          dispatch(tripId, { type: 'spot/delete', spotId });
          if (navigation.canGoBack()) navigation.goBack();
        }}
        onCancel={() => setSheet(undefined)}
      />
    </Screen>
  );
}
