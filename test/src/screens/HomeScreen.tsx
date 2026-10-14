import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { Trip } from '../types';
import { tripStatus, type TripStatus } from '../core/tripStatus';
import { kstDate } from '../core/util';
import { regionById } from '../data/regions';
import {
  HOME_PICKS,
  homeActions,
  homeSegments,
  SEGMENT_ORDER,
  showsSegmentBar,
  STATUS_LABEL,
  tripCardInfo,
  tripNextStep,
  visibleSegments,
  type HomeMenuCell,
} from '../features/account/home';
import { useSessionKeepAlive } from '../features/account/useSessionKeepAlive';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { useSession } from '../store/session';
import { useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  AvatarStack,
  Btn,
  Card,
  Col,
  CoverTile,
  Empty,
  QuickAction,
  Row,
  Screen,
  SectionTitle,
  Seg,
  SP,
  TextLink,
  Txt,
  type IconName,
} from '../ui';

/**
 * 03 홈(FR-203, WP1 소유).
 * - 머리줄: 왼쪽 eyebrow(게스트 · 민지)와 큰 제목 '내 여행', 오른쪽 '새 여행' 버튼 하나.
 * - 여행 표지 카드 가로 줄. 진행 중 → 예정 → 완료 순으로 한 줄에 둔다. 여행방이 4개 이상이고 보이는 칸이 2개 이상일 때만
 *   세그먼트(개수가 있는 칸만)를 그린다. 상태는 공유 tripStatus(KST, appClock)라 시뮬레이터 시각을 따른다.
 * - 카드 표지를 누르면 그 방을 고른다. 카드 아래 버튼은 다음 할 일(tripNextStep: 기록 보기, 오늘 여행 진행, 후보 모으기,
 *   루트 계산하기, 시간표 보기)이다.
 * - 선택한 여행방 구역: 제목은 방 이름, 빠른 메뉴 4칸(homeActions, 단계별). 개인 모드면 채팅 칸 아래에 이유와 '멤버 초대' 링크.
 *   구역 끝에 '초대 코드로 합류'.
 * - 지금 보는 방은 useActiveTrip(pickCurrentTrip) 하나로 정한다. 홈이 따로 대체 규칙을 두지 않는다.
 * - 여행방이 없으면 만들기 Empty와 '초대 코드로 합류'.
 * - 추천 여행지 타일은 그 지역을 고른 채로 여행방 만들기로 간다.
 * - 쓰는 동안 세션을 유지한다(useSessionKeepAlive: 연장, 만료 폐기, 만료 3일 전 알림 한 번).
 * 판정은 features/account/home.ts(순수, wp1-home 테스트)에 있다.
 */
export default function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const { trip: current, trips } = useActiveTrip();
  const plans = useTrips((s) => s.plans);
  const now = useNow();
  const today = kstDate(now);
  const session = useSession((s) => s.session);
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);

  const seg = useMemo(() => homeSegments(trips, now), [trips, now]);
  const visible = visibleSegments(seg.counts);
  const segBar = showsSegmentBar(trips.length, visible);
  const currentSeg = current ? tripStatus(current, now) : undefined;
  // 세그먼트는 고른 방이 있는 칸을 따른다(칸을 바꾸면 그 칸의 첫 방을 고르므로 늘 같은 칸이 된다)
  const active: TripStatus = currentSeg && visible.includes(currentSeg) ? currentSeg : (visible[0] ?? 'ongoing');
  const list = segBar ? seg.groups[active] : SEGMENT_ORDER.flatMap((k) => seg.groups[k]);

  // 쓰는 동안 세션을 연장하고, 시뮬레이터 시각이 만료를 넘으면 폐기한다(FR-105·FR-102).
  useSessionKeepAlive();

  /** 칸을 바꾸면 그 칸의 첫 방을 고른다. 이미 고른 방이 그 칸에 있으면 그대로 둔다 */
  const pickSegment = (k: TripStatus) => {
    const group = seg.groups[k];
    if (group.length === 0 || group.some((t) => t.id === current?.id)) return;
    setCurrentTrip(group[0].id);
  };

  const goNext = (t: Trip) => {
    setCurrentTrip(t.id);
    const step = tripNextStep(t, plans[t.id], today);
    switch (step.route) {
      case 'RecordMap':
        return navigation.navigate('RecordMap', { tripId: t.id });
      case 'LiveTrip':
        return navigation.navigate('LiveTrip', { tripId: t.id, date: step.date });
      case 'Candidates':
        return navigation.navigate('Candidates');
      case 'Planning':
        return navigation.navigate('Planning', { tripId: t.id });
      case 'Schedule':
        return navigation.navigate('Schedule', {});
    }
  };

  const openAction = (cell: HomeMenuCell) => {
    if (!current) return;
    const tripId = current.id;
    setCurrentTrip(tripId);
    switch (cell.key) {
      case 'chat':
        return navigation.navigate('Chat', { tripId });
      case 'members':
        return navigation.navigate('Members', { tripId });
      case 'recommend':
        return navigation.navigate('Recommend', { tripId });
      case 'settings':
        return navigation.navigate('TripSettings', { tripId });
      case 'navigate':
        return navigation.navigate('Navigate', { tripId, date: cell.date ?? today, legIndex: 0 });
      case 'photos':
        return navigation.navigate('Photos', cell.date ? { tripId, date: cell.date } : { tripId });
      case 'diary':
        return navigation.navigate('Diary', { tripId });
      default:
        return undefined;
    }
  };

  const actions = homeActions(current, current ? plans[current.id] : undefined, today);
  const blocked = actions.find((c) => c.key === 'chat' && c.disabled && c.reason);
  const who = session ? `${session.kind === 'guest' ? '게스트' : '계정'} · ${session.nickname}` : '';

  return (
    <Screen>
      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          <Row gap={SP.xl}>
            <Col gap={SP.xs} grow>
              {who ? <Txt v="eyebrow">{who}</Txt> : null}
              <View accessibilityRole="header">
                <Txt v="hero">내 여행</Txt>
              </View>
            </Col>
            <Btn title="새 여행" size="sm" variant="ghost" icon="plus" onPress={() => navigation.navigate('CreateTrip')} />
          </Row>
          {segBar ? (
            <Seg
              items={visible.map((k) => ({ key: k, label: STATUS_LABEL[k], count: seg.counts[k], icon: SEG_ICON[k] }))}
              value={active}
              onChange={pickSegment}
            />
          ) : null}
        </View>

        {/* 내 여행 표지 카드 */}
        <View style={styles.cards}>
          {trips.length === 0 ? (
            <View style={styles.gutter}>
              <Card>
                <Empty
                  icon="compass"
                  title="다음 여행을 계획해 보세요"
                  action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
                />
                <Btn title="초대 코드로 합류" variant="quiet" onPress={() => navigation.navigate('InviteAccept')} />
              </Card>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRow}>
              {list.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  selected={t.id === current?.id}
                  info={tripCardInfo(t, plans[t.id], now)}
                  nextLabel={tripNextStep(t, plans[t.id], today).label}
                  onPress={() => setCurrentTrip(t.id)}
                  onNext={() => goNext(t)}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* 선택한 여행방 */}
        {current ? (
          <View style={styles.section}>
            <SectionTitle title={current.title} />
            {/* 칸 사이는 SP.xs: 360px에서 칸이 75px라 '여행방 설정'(72.3px)이 잘리지 않는다 */}
            <Row gap={SP.xs} top>
              {actions.map((c) => (
                <QuickAction key={c.key} icon={c.icon} label={c.label} disabled={c.disabled} onPress={() => openAction(c)} />
              ))}
            </Row>
            {blocked ? (
              <Col gap={SP.xs}>
                <Txt v="mtTight">{blocked.reason}</Txt>
                <TextLink
                  title="멤버 초대"
                  onPress={() => {
                    setCurrentTrip(current.id);
                    navigation.navigate('Members', { tripId: current.id });
                  }}
                />
              </Col>
            ) : null}
            <View style={styles.start}>
              <Btn
                title="초대 코드로 합류"
                size="sm"
                variant="quiet"
                icon="link"
                onPress={() => navigation.navigate('InviteAccept')}
              />
            </View>
          </View>
        ) : null}

        {/* 추천 여행지 */}
        <View style={styles.picks}>
          <View style={styles.gutter}>
            <SectionTitle title="추천 여행지" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickRow}>
            {HOME_PICKS.map((p) => (
              <CoverTile
                key={p.id}
                place={p.name}
                title={p.name}
                lines={[p.blurb]}
                a11yLabel={`${p.name} 여행방 만들기`}
                onPress={() => navigation.navigate('CreateTrip', { regionId: p.id })}
              />
            ))}
          </ScrollView>
        </View>
      </ScrollView>
    </Screen>
  );
}

const SEG_ICON: Record<TripStatus, IconName> = { ongoing: 'play', upcoming: 'cal', done: 'check' };

function TripCard({
  trip,
  info,
  selected,
  nextLabel,
  onPress,
  onNext,
}: {
  trip: Trip;
  info: ReturnType<typeof tripCardInfo>;
  selected: boolean;
  nextLabel: string;
  onPress: () => void;
  onNext: () => void;
}) {
  // 표지(여행방 고르기)와 다음 할 일 버튼을 나란한 두 버튼으로 둔다(웹에서 button 중첩을 피한다).
  // 고른 상태는 CoverTile이 accessibilityState.selected로 알린다.
  return (
    <CoverTile
      size="lg"
      place={regionById(trip.region)?.name ?? trip.title}
      badge={info.badge}
      title={info.title}
      lines={[info.dateText, info.countsText]}
      selected={selected}
      a11yLabel={`${trip.title} 고르기`}
      onPress={onPress}
      footer={
        <Row style={styles.between}>
          <AvatarStack names={info.memberNames} max={4} />
          <Btn title={nextLabel} size="sm" variant="ghost" a11yLabel={`${trip.title} ${nextLabel}`} onPress={onNext} />
        </Row>
      }
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingBottom: SP.section * 2 },
  head: { paddingTop: SP.l, paddingHorizontal: SP.gutter, gap: SP.xxl },
  gutter: { paddingHorizontal: SP.gutter },
  cards: { marginTop: SP.section, gap: SP.xl },
  cardRow: { paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xxl },
  section: { marginTop: SP.section, paddingHorizontal: SP.gutter, gap: SP.xxl },
  start: { alignSelf: 'flex-start' },
  picks: { marginTop: SP.section + SP.m, gap: SP.xl },
  pickRow: { paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xl },
  between: { justifyContent: 'space-between' },
});
