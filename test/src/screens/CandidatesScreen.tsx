import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { humanMin } from '../core/util';
import { ManualAdd } from '../features/candidates/components/ManualAdd';
import { candidateView, headline, type ExcludedRow } from '../features/candidates/rows';
import type { TabScreenProps } from '../navigation/routes';
import { getServices } from '../services/registry';
import { useCurrentTrip, usePlan, usePlanning, useTrips } from '../store/trips';
import {
  Body,
  Btn,
  Card,
  Chip,
  Col,
  Empty,
  Header,
  Icon,
  Notice,
  Row,
  Screen,
  ScopeBadge,
  Seg,
  SP,
  Txt,
  WarnCard,
} from '../ui';

/**
 * 06 후보 · 자동 선별(FR-402·403·202, WP3 소유).
 * - 확정 버튼이 없다(FR-403). 머리말에 그 사실을 칩으로 적는다.
 * - 확정 스팟 행: 제안자 수, 배치 날짜·시간대(고정은 배치 시각). 제외 카드: 사유·제안자·되돌리기(spot/restore → 고정).
 * - 제외 스팟은 확정 탭에서도 목록 아래 구역에 늘 보인다(조용한 제외 없음).
 * - 고정만으로 수용량을 넘기면 WarnCard에 날짜와 초과분(사용자가 직접 뺀다).
 * - 로컬 장소 사전이면 '예시 데이터' 칩.
 * - 목록은 Seg 바로 아래에서 시작한다(목업 06). 수동 등록(검색·지도 선택)과 추천 진입은 목록 끝의 quiet 버튼으로 내린다.
 *   수동 등록은 시트가 아니라 목록 끝에서 펼친다(안에 선택·확인 시트가 있어 시트를 겹치지 않는다).
 * - 오프라인 안내는 오프라인일 때만. 온라인인데 계산 뒤 문서가 바뀌어 dirty면 '다시 계산 대기'로 따로 적는다.
 * 행 계산은 features/candidates/rows.ts(순수, wp3-candidates 테스트)에 있다.
 */
export default function CandidatesScreen({ navigation }: TabScreenProps<'Candidates'>) {
  const trip = useCurrentTrip();
  const plan = usePlan(trip?.id);
  const planning = usePlanning(trip?.id);
  const online = useTrips((s) => s.online);
  const dirty = useTrips((s) => (trip ? !!s.dirty[trip.id] : false));
  const [tab, setTab] = useState<'confirmed' | 'excluded'>('confirmed');
  const [adding, setAdding] = useState(false);
  const view = useMemo(() => (trip ? candidateView(trip, plan) : undefined), [trip, plan]);

  if (!trip || !view) {
    return (
      <Screen>
        <Header title="후보" />
        <Body>
          <Empty
            title="여행방이 없습니다"
            action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
          />
        </Body>
      </Screen>
    );
  }

  const sample = getServices().places.id === 'local';
  const restore = (row: ExcludedRow) => {
    useTrips.getState().dispatch(trip.id, { type: 'spot/restore', spotId: row.spotId });
  };
  const open = (spotId: string) => navigation.navigate('SpotDetail', { tripId: trip.id, spotId });

  const excludedList = (
    <Col gap={SP.m}>
      {view.excluded.map((r) => (
        // 카드 전체를 버튼으로 두면 되돌리기가 버튼 속 버튼이 된다. 상세 열기와 되돌리기를 나란한 두 버튼으로 둔다.
        <Card key={r.spotId} variant="excluded">
          <Row top>
            <Pressable
              style={{ flex: 1 }}
              accessibilityRole="button"
              accessibilityLabel={`${r.name} 상세 보기`}
              onPress={() => open(r.spotId)}
            >
              <Col gap={SP.xs}>
                <Txt v="nm" c="muted">
                  {r.name}
                </Txt>
                <Txt v="mtTight">{r.sub}</Txt>
              </Col>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${r.name} 되돌리기`}
              onPress={() => restore(r)}
              hitSlop={8}
            >
              <Row gap={SP.xs}>
                <Icon name="undo" size={14} color="accent" stroke={1.9} />
                <Txt v="time" c="accent">
                  되돌리기
                </Txt>
              </Row>
            </Pressable>
          </Row>
        </Card>
      ))}
    </Col>
  );

  return (
    <Screen>
      <Header
        title={`후보 ${view.total}곳`}
        size="sm"
        sub={headline(view)}
        right={
          <Row gap={SP.s}>
          </Row>
        }
      />
      <View style={{ paddingHorizontal: SP.gutter }}>
        <Seg
          items={[
            { key: 'confirmed', label: '확정 스팟', count: view.confirmed.length },
            { key: 'excluded', label: '제외 스팟', count: view.excluded.length },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <Body scroll>
        <View style={{ height: SP.xs }} />
        {view.overCapacity.map((o) => (
          <WarnCard
            key={o.date}
            title={o.title}
            text={`고정 스팟만으로 ${humanMin(o.overMin)} 넘습니다. 고정을 풀거나 직접 빼 주세요.`}
            items={[
              {
                label: '그날 일정 편집으로 가기',
                value: '편집',
                onPress: () => navigation.navigate('ScheduleEdit', { tripId: trip.id, date: o.date }),
              },
            ]}
          />
        ))}
        {planning?.busy ? <Notice icon="clock" text="루트를 다시 계산하는 중입니다." /> : null}
        {!online ? (
          <Notice icon="alert" text="오프라인이라 재계산을 멈췄습니다. 연결되면 다시 계산합니다." />
        ) : dirty && !planning?.busy ? (
          <Notice icon="clock" text="후보가 바뀌어 다시 계산을 기다리는 중입니다." />
        ) : null}

        {tab === 'confirmed' ? (
          <>
            {view.total === 0 ? (
              <Empty
                title="아직 후보가 없습니다"
                action={{ label: '채팅 열기', onPress: () => navigation.navigate('Chat', { tripId: trip.id }) }}
              />
            ) : null}
            {view.confirmed.map((r) => (
              <Card key={r.spotId} onPress={() => open(r.spotId)}>
                <Row top>
                  <Col grow gap={SP.xs}>
                    <Txt v="nm">{r.name}</Txt>
                    <Txt v="mtTight">{r.sub}</Txt>
                  </Col>
                  <Col gap={SP.xs}>
                    {r.pinned ? <Chip text="고정" icon="pinlock" /> : <Chip text={`제안자 ${r.proposerCount}`} />}
                    {r.outsideRegion ? <Chip text="목적지 밖" tone="warn" /> : null}
                  </Col>
                </Row>
              </Card>
            ))}
            {view.pending.map((r) => (
              <Card key={r.spotId} onPress={() => open(r.spotId)}>
                <Row top>
                  <Col grow gap={SP.xs}>
                    <Txt v="nm">{r.name}</Txt>
                    <Txt v="mtTight">{r.sub}</Txt>
                  </Col>
                  {r.pinned ? <Chip text="고정" icon="pinlock" /> : <Chip text={`제안자 ${r.proposerCount}`} tone="line" />}
                </Row>
              </Card>
            ))}
            {view.excluded.length > 0 ? (
              <Txt v="eyebrow" style={{ marginTop: SP.xs }}>
                {`제외 스팟 ${view.excluded.length} · 되돌릴 수 있음`}
              </Txt>
            ) : null}
            {excludedList}

            <Col gap={SP.m} style={{ marginTop: SP.xs }}>
              <Btn
                title={adding ? '직접 담기 닫기' : '장소 직접 담기'}
                size="sm"
                variant="quiet"
                icon={adding ? 'x' : 'search'}
                onPress={() => setAdding((v) => !v)}
              />
              {adding ? <ManualAdd trip={trip} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="성향 태그로 추천 받기"
                onPress={() => navigation.navigate('Recommend', { tripId: trip.id })}
              >
                <Row gap={SP.m} style={{ paddingVertical: SP.s }}>
                  <Col grow>
                    <Txt v="btnSm">성향 태그로 추천 받기</Txt>
                  </Col>
                  <ScopeBadge phase="2차" />
                  <Icon name="right" size={16} color="muted" stroke={2.2} />
                </Row>
              </Pressable>
            </Col>
          </>
        ) : view.excluded.length === 0 ? (
          <Empty title="제외 스팟이 없습니다" />
        ) : (
          excludedList
        )}
      </Body>
    </Screen>
  );
}
