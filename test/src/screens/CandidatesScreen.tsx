import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { tripMode } from '../core/group';
import { humanMin, josa } from '../core/util';
import { useHomeBack } from '../navigation/useBack';
import { ManualAdd } from '../features/candidates/components/ManualAdd';
import {
  candidateSections,
  candidateView,
  CONFIRMED_FOLD,
  unfoldLabel,
  type CandidateSection,
  type ExcludedRow,
} from '../features/candidates/rows';
import { summaryLine } from '../features/candidates/summary';
import { PlanSwitch } from '../features/schedule/components/PlanSwitch';
import { TripActions } from '../features/trip/components/TripActions';
import { TripBar } from '../features/trip/components/TripBar';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { TabScreenProps } from '../navigation/routes';
import { usePlan, usePlanning, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Card,
  Chip,
  Col,
  Empty,
  H,
  Header,
  ListRow,
  Row,
  Screen,
  SP,
  Txt,
  WarnCard,
} from '../ui';

/**
 * 06 후보 · 자동 선별(FR-402·403·202, WP3 소유).
 * - 위쪽: 지금 보는 여행방(TripBar), '시간표 | 후보 N' 나누기(PlanSwitch), 요약 한 줄(summaryLine, 높이 고정).
 *   방은 useActiveTrip이 정한다. 방이 0개일 때만 '여행방 만들기'를 보이고, 방은 있는데 고른 방이 없으면 고르라고 안내한다.
 *   오프라인 안내는 앱 공통 OfflineBar가 맡는다(여기서 Notice를 쌓지 않는다).
 * - 확정 버튼이 없다(FR-403). 계산 중이면 '다시 계산하는 중' 칩과 '단계 보기', 문서가 바뀌어 계산을 기다리면 칩 하나.
 * - 담기: 목록 맨 위 돋보기 검색창(ManualAdd)이 바로 입력 칸이다. 누르면 아래에 새 칸이 펼쳐지던 방식은 2026-10-17에 없앴다.
 *   그 아래 '성향 태그로 추천 받기' 줄.
 * - 목록은 하나이고 구역 머리(eyebrow + 개수)로 나눈다(rows.ts candidateSections, 순수).
 *   확정 스팟은 앞 5곳만 보이고 '나머지 N곳 보기'로 편다. 배치 계산 전은 있을 때만. 제외 스팟은 절대 접지 않는다.
 * - 제외 카드: 사유·제안자, 아래 '고정해서 다시 넣기'(spot/restore → 고정). 누르면 어디로 갔는지 토스트로 알린다.
 * - 고정만으로 수용량을 넘기면 WarnCard에 날짜와 초과분(사용자가 직접 뺀다).
 */
export default function CandidatesScreen({ navigation, route }: TabScreenProps<'Candidates'>) {
  const { trip, trips } = useActiveTrip();
  const plan = usePlan(trip?.id);
  const planning = usePlanning(trip?.id);
  const dirty = useTrips((s) => (trip ? !!s.dirty[trip.id] : false));
  const toast = useUi((s) => s.showToast);
  const homeBack = useHomeBack();
  const [expanded, setExpanded] = useState(false);
  const view = useMemo(() => (trip ? candidateView(trip, plan) : undefined), [trip, plan]);

  if (trips.length === 0) {
    return (
      <Screen>
        <Header back={homeBack} title="후보" size="sm" />
        <Body>
          <Empty
            icon="compass"
            title="아직 여행방이 없어요"
            text="여행방을 만들면 가고 싶은 곳을 후보로 모을 수 있어요."
            action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
          />
        </Body>
      </Screen>
    );
  }

  if (!trip || !view) {
    return (
      <Screen>
        <TripBar back={homeBack} />
        <Body>
          <Empty title="여행방을 골라 주세요" text="위의 여행방 이름을 누르면 볼 방을 고를 수 있어요." />
        </Body>
      </Screen>
    );
  }

  const tripId = trip.id;
  const line = summaryLine(view);
  const sections = candidateSections(view, expanded);
  const busy = !!planning?.busy;
  const open = (spotId: string) => navigation.navigate('SpotDetail', { tripId, spotId });
  const restore = (row: ExcludedRow) => {
    const r = useTrips.getState().dispatch(tripId, { type: 'spot/restore', spotId: row.spotId });
    if (r.ok) toast(`${josa(row.name, '을/를')} 고정해서 확정 스팟으로 옮겼어요`);
  };

  return (
    <Screen>
      <TripBar back={homeBack} />
      {/* 여행방 빠른 메뉴(멤버 초대·AI 추천·설정 등, 단계별). 홈에서 옮겨 왔다 */}
      <View style={styles.actions}>
        <TripActions trip={trip} />
      </View>
      <PlanSwitch value="Candidates" candidates={view.total} />
      <View style={styles.summary}>
        <Txt v="mtTight" numberOfLines={1}>
          {line ?? '아직 담은 후보가 없어요'}
        </Txt>
      </View>
      <Body scroll>
        {busy ? (
          <Row gap={SP.m}>
            <Chip text="다시 계산하는 중" icon="clock" />
            <Btn title="단계 보기" size="sm" variant="quiet" onPress={() => navigation.navigate('Planning', { tripId })} />
          </Row>
        ) : dirty ? (
          <Row>
            <Chip text="다시 계산을 기다리는 중" icon="clock" tone="line" />
          </Row>
        ) : null}

        {/* 담기: 맨 위 돋보기 검색창이 바로 입력 칸이다(아래에 새 칸을 만들지 않는다, 2026-10-17) */}
        <ManualAdd key={route.params?.add ? 'add' : 'idle'} trip={trip} focus={route.params?.add === true} />
        <ListRow first icon="compass" label="성향 태그로 추천 받기" onPress={() => navigation.navigate('Recommend', { tripId })} />

        {view.total === 0 ? (
          tripMode(trip) === 'group' ? (
            <Empty
              title="아직 후보가 없어요"
              text="채팅에서 장소를 말하거나 위에서 검색해서 담으면 여기에 쌓여요."
              action={{ label: '채팅 열기', onPress: () => navigation.navigate('Chat', { tripId }) }}
            />
          ) : (
            <Empty title="아직 후보가 없어요" text="위에서 장소를 검색해서 담으면 여기에 쌓여요." />
          )
        ) : null}

        {view.overCapacity.map((o) => (
          <WarnCard
            key={o.date}
            title={o.title}
            text={`고정 스팟만으로 ${humanMin(o.overMin)} 넘어요. 고정을 풀거나 직접 빼 주세요.`}
            items={[
              {
                label: '그날 일정 편집으로 가기',
                value: '편집',
                onPress: () => navigation.navigate('ScheduleEdit', { tripId, date: o.date }),
              },
            ]}
          />
        ))}

        {sections.confirmed ? (
          <Col gap={SP.m}>
            <SectionHead section={sections.confirmed} />
            {sections.confirmed.rows.map((r) => (
              <Card key={r.spotId} onPress={() => open(r.spotId)}>
                <Row top>
                  <Col grow gap={SP.xs}>
                    <Txt v="nm">{r.name}</Txt>
                    <Txt v="mtTight">{r.sub}</Txt>
                  </Col>
                  <Col gap={SP.xs}>
                    {r.pinLabel ? <Chip text={r.pinLabel} icon="pinlock" /> : <Chip text={`표 ${r.votes}`} />}
                    {r.outsideRegion ? <Chip text="목적지 밖" tone="warn" /> : null}
                  </Col>
                </Row>
              </Card>
            ))}
            {sections.confirmed.hidden > 0 ? (
              <Btn
                title={unfoldLabel(sections.confirmed.hidden)}
                size="sm"
                variant="quiet"
                icon="down"
                onPress={() => setExpanded(true)}
              />
            ) : expanded && view.confirmed.length > CONFIRMED_FOLD ? (
              <Btn
                title={`앞 ${CONFIRMED_FOLD}곳만 보기`}
                size="sm"
                variant="quiet"
                icon="up"
                onPress={() => setExpanded(false)}
              />
            ) : null}
          </Col>
        ) : null}

        {sections.pending ? (
          <Col gap={SP.m}>
            <SectionHead section={sections.pending} />
            {sections.pending.rows.map((r) => (
              <Card key={r.spotId} onPress={() => open(r.spotId)}>
                <Row top>
                  <Col grow gap={SP.xs}>
                    <Txt v="nm">{r.name}</Txt>
                    <Txt v="mtTight">{r.sub}</Txt>
                  </Col>
                  {r.pinLabel ? <Chip text={r.pinLabel} icon="pinlock" /> : <Chip text={`표 ${r.votes}`} tone="line" />}
                </Row>
              </Card>
            ))}
          </Col>
        ) : null}

        {sections.excluded ? (
          <Col gap={SP.m}>
            <SectionHead section={sections.excluded} />
            {sections.excluded.rows.map((r) => (
              // 카드 전체를 버튼으로 두면 되돌리기가 버튼 속 버튼이 된다. 상세 열기와 되돌리기를 위아래 두 버튼으로 둔다.
              <Card key={r.spotId} variant="excluded">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name} 상세 보기`}
                  onPress={() => open(r.spotId)}
                  style={styles.excludedOpen}
                >
                  <Col gap={SP.xs}>
                    <Txt v="nm" c="muted">
                      {r.name}
                    </Txt>
                    <Txt v="mtTight">{r.sub}</Txt>
                  </Col>
                </Pressable>
                {/* 방장이 뺀 곳은 방장 결정으로만 돌아온다(스팟 상세의 투표 카드) */}
                {r.reasonCode !== 'hostDropped' ? (
                  <View style={styles.start}>
                    <Btn
                      title="고정해서 다시 넣기"
                      size="sm"
                      variant="ghost"
                      icon="undo"
                      a11yLabel={`${r.name} 고정해서 다시 넣기`}
                      onPress={() => restore(r)}
                    />
                  </View>
                ) : null}
              </Card>
            ))}
          </Col>
        ) : null}
      </Body>
    </Screen>
  );
}

/** 구역 머리. 숫자는 '곳'을 붙여 읽힌다(순번으로 읽히지 않게) */
function SectionHead<T>({ section }: { section: CandidateSection<T> }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={section.a11y} style={styles.sectionHead}>
      <Txt v="eyebrow">{section.title}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { paddingTop: SP.l, paddingBottom: SP.xl },
  summary: { paddingHorizontal: SP.gutter, paddingTop: SP.s, paddingBottom: SP.xs },
  excludedOpen: { minHeight: H.touch, justifyContent: 'center' },
  start: { alignSelf: 'flex-start' },
  sectionHead: { paddingTop: SP.s },
});
