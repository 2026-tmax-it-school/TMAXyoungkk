import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { Trip } from '../types';
import { coverUri } from '../core/trip/cover';
import { tripStatus, type TripStatus } from '../core/tripStatus';
import { kstDate } from '../core/util';
import { regionById } from '../data/regions';
import {
  HOME_PICKS,
  homeSegments,
  NEW_TRIP_H,
  NEW_TRIP_PEEK,
  cardRowAtEnd,
  cardRowContentWidth,
  PULL_TRIGGER,
  pullOffset,
  SEGMENT_ORDER,
  showsSegmentBar,
  STATUS_LABEL,
  tripCardInfo,
  tripNextStep,
  visibleSegments,
} from '../features/account/home';
import { syncNicknameToTrips } from '../features/account/flows';
import { HomeSearchResults } from '../features/account/HomeSearchResults';
import { searchTrips } from '../features/account/homeSearch';
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
  CoverTile,
  Empty,
  Field,
  Icon,
  IconBtn,
  R,
  Row,
  Screen,
  SectionTitle,
  Seg,
  SP,
  surfaceC,
  Txt,
  type IconName,
} from '../ui';

/**
 * 03 홈(FR-203, WP1 소유).
 * - 머리줄: 검색칸, 그 아래 큰 제목 '내 여행'(2026-10-17, '게스트 · 민지' 줄은 뺐다). 새 여행방은 카드 줄 끝 '+ 새 여행' 칸(누르거나 왼쪽으로 끝까지 밀기,
 *   여행방이 없으면 만들기 Empty)으로 만든다(2026-10-17).
 * - 여행 표지 카드 가로 줄. 진행 중 → 예정 → 완료 순으로 한 줄에 둔다. 여행방이 4개 이상이고 보이는 칸이 2개 이상일 때만
 *   세그먼트(개수가 있는 칸만)를 그린다. 상태는 공유 tripStatus(KST, appClock)라 시뮬레이터 시각을 따른다.
 * - 카드를 누르면 그 방을 고르고 다음 할 일(tripNextStep: 기록 보기, 오늘 여행 진행, 후보 모으기,
 *   루트 계산하기, 시간표 보기)로 바로 간다. 카드 안에 따로 버튼을 두지 않는다(2026-10-17).
 * - 여행방 빠른 메뉴(멤버 초대·AI 추천·설정 등)는 카드를 누르면 가는 후보·시간표 화면 위(features/trip TripActions)로 옮겼다.
 *   홈에는 '초대 코드로 합류'만 남는다.
 * - 지금 보는 방은 useActiveTrip(pickCurrentTrip) 하나로 정한다. 홈이 따로 대체 규칙을 두지 않는다.
 * - 여행방이 없으면 만들기 Empty와 '초대 코드로 합류'.
 * - 추천 여행지 타일은 그 지역의 예시 2박 3일(30 예시 일정)로 간다. 거기서 '이 일정으로 여행방 만들기'나 '직접 만들기'로 이어진다.
 * - 쓰는 동안 세션을 유지한다(useSessionKeepAlive: 연장, 만료 폐기, 만료 3일 전 알림 한 번).
 * - 표지·이름·날짜 '수정'은 19 여행 진행의 '여행 진행 끝내기' 왼쪽으로 옮겼다(2026-10-17). 홈 카드에는 두지 않는다.
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
  // 홈 검색: 적으면 카드 줄은 방 이름·여행지에 맞는 방만, 아래에는 지역과 AI 추천 여행지(features/account/homeSearch)
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const allCards = segBar ? seg.groups[active] : SEGMENT_ORDER.flatMap((k) => seg.groups[k]);
  const list = searching ? searchTrips(trips, query) : allCards;

  // 쓰는 동안 세션을 연장하고, 시뮬레이터 시각이 만료를 넘으면 폐기한다(FR-105·FR-102).
  useSessionKeepAlive();

  // 예전에 닉네임을 바꿔 옛 이름이 남은 여행방이 있으면 지금 닉네임으로 맞춘다(같으면 아무것도 보내지 않는다)
  const myName = session?.nickname;
  useEffect(() => {
    if (myName) syncNicknameToTrips();
  }, [myName, trips]);

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
      case 'Journal':
        return navigation.navigate('Journal', { tripId: t.id });
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

  // 카드 줄 끝 '+ 새 여행' 당기기. 줄 끝에 닿은 뒤 왼쪽으로 더 끌면 PanResponder가 잡아 고무줄 저항(pullOffset)으로
  // 칸을 끌어내고(카드도 같이 밀린다), PULL_TRIGGER 넘게 끌어 놓으면 여행방 만들기로 간다. 덜 끌면 튕겨 돌아간다.
  // 끝의 '+' 손잡이를 눌러도 된다. 일반 스크롤은 그대로라 줄 중간에서는 당기기가 시작되지 않는다
  const rowRef = useRef<ScrollView>(null);
  const pullX = useRef(new Animated.Value(0)).current;
  const [pullReady, setPullReady] = useState(false);
  // 처음에는 끝이 아니다(크기를 알기 전에 옆으로 밀기를 가로채지 않게). 크기와 위치를 알면 cardRowAtEnd로 정한다
  const rowAtEnd = useRef(false);
  // 줄 끝 판단: 지금 스크롤 위치 + 화면 폭이 내용 폭에 닿았는지. 크기가 나중에 재져도 위치를 함께 본다
  const rowSize = useRef({ x: 0, viewW: 0, contentW: 0 });
  const updateAtEnd = () => {
    const { x, viewW, contentW } = rowSize.current;
    rowAtEnd.current = cardRowAtEnd(x, viewW, contentW);
  };
  const openCreate = () => {
    setPullReady(false);
    rowRef.current?.scrollTo({ x: 0, animated: false });
    navigation.navigate('CreateTrip');
  };
  const openCreateRef = useRef(openCreate);
  openCreateRef.current = openCreate;
  const onRowScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    rowSize.current = { x: contentOffset.x, viewW: layoutMeasurement.width, contentW: contentSize.width };
    updateAtEnd();
  };
  const measureRow = (next: Partial<{ viewW: number; contentW: number }>) => {
    rowSize.current = { ...rowSize.current, ...next };
    updateAtEnd();
  };
  // 카드가 늘거나 줄면 내용 폭을 다시 계산한다
  useEffect(() => {
    rowSize.current = { ...rowSize.current, contentW: cardRowContentWidth(list.length) };
    rowAtEnd.current = cardRowAtEnd(rowSize.current.x, rowSize.current.viewW, rowSize.current.contentW);
  }, [list.length]);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => rowAtEnd.current && g.dx < -6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const off = pullOffset(-g.dx);
        pullX.setValue(off);
        const ready = off >= PULL_TRIGGER;
        setPullReady((was) => (was === ready ? was : ready));
      },
      onPanResponderRelease: (_, g) => {
        const go = pullOffset(-g.dx) >= PULL_TRIGGER;
        Animated.spring(pullX, { toValue: 0, useNativeDriver: false, tension: 140, friction: 10 }).start();
        setPullReady(false);
        if (go) openCreateRef.current();
      },
      onPanResponderTerminate: () => {
        Animated.spring(pullX, { toValue: 0, useNativeDriver: false, tension: 140, friction: 10 }).start();
        setPullReady(false);
      },
    }),
  ).current;

  return (
    <Screen>
      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          {/* 맨 위는 검색칸, 그 아래 큰 제목 '내 여행'(2026-10-17). '계정 · 닉네임' 줄은 뺐다 */}
          <Row gap={SP.s}>
            <View style={styles.fill}>
              <Field label="검색" hideLabel size="sm" value={query} onChangeText={(v) => setQuery(v.slice(0, 40))} placeholder="검색" />
            </View>
            {query ? <IconBtn icon="x" label="검색어 지우기" onPress={() => setQuery('')} /> : null}
          </Row>
          {/* 검색칸과 붙어 보이지 않게 제목을 조금 아래로 */}
          <View accessibilityRole="header" style={styles.title}>
            <Txt v="hero">내 여행</Txt>
          </View>
          {segBar && !searching ? (
            <Seg
              items={visible.map((k) => ({ key: k, label: STATUS_LABEL[k], count: seg.counts[k], icon: SEG_ICON[k] }))}
              value={active}
              onChange={pickSegment}
            />
          ) : null}
        </View>

        {/* 내 여행 표지 카드 */}
        <View style={styles.cards}>
          {searching && list.length === 0 ? (
            <View style={styles.gutter}>
              <Txt v="mtTight">{`'${query.trim()}' 여행방이 없어요`}</Txt>
            </View>
          ) : trips.length === 0 ? (
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
            <View {...pan.panHandlers} style={styles.rowWrap}>
            <Animated.ScrollView
              ref={rowRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.cardRow, styles.cardRowEnd]}
              style={{ transform: [{ translateX: Animated.multiply(pullX, -1) }] }}
              onScroll={onRowScroll}
              scrollEventThrottle={32}
              onLayout={(e) => measureRow({ viewW: e.nativeEvent.layout.width, contentW: cardRowContentWidth(list.length) })}
              onContentSizeChange={(contentW) => measureRow({ contentW })}
            >
              {list.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  selected={t.id === current?.id}
                  info={tripCardInfo(t, plans[t.id], now)}
                  nextLabel={tripNextStep(t, plans[t.id], today).label}
                  onPress={() => goNext(t)}
                />
              ))}
              <NewTripPeek onPress={openCreate} />
            </Animated.ScrollView>
            <NewTripPull pull={pullX} ready={pullReady} />
            </View>
          )}
        </View>

        {/* 검색 중이면 지역·AI 추천 여행지를 보이고 아래 구역은 숨긴다 */}
        {searching ? (
          <View style={styles.section}>
            <HomeSearchResults
              query={query}
              onRegion={(h) =>
                h.hasSample
                  ? navigation.navigate('SampleTrip', { regionId: h.region.id })
                  : navigation.navigate('CreateTrip', { regionId: h.region.id })
              }
              onCreate={(regionId) => navigation.navigate('CreateTrip', { regionId })}
            />
          </View>
        ) : null}

        {/* 초대 코드로 합류. 여행방 빠른 메뉴는 후보·시간표 화면 위로 옮겼다(features/trip TripActions, 2026-10-17) */}
        {current && !searching ? (
          <View style={styles.section}>
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

        {searching ? null : (
          <>
        {/* 추천 여행 일정(지역별 예시 2박 3일) */}
        <View style={styles.picks}>
          <View style={styles.gutter}>
            <SectionTitle title="추천 여행 일정" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickRow}>
            {HOME_PICKS.map((p) => (
              <CoverTile
                key={p.id}
                place={p.name}
                title={p.name}
                lines={[p.blurb]}
                a11yLabel={`${p.name} 예시 일정 보기`}
                onPress={() => navigation.navigate('SampleTrip', { regionId: p.id })}
              />
            ))}
          </ScrollView>
        </View>

        {/* 다른 사람의 일정 둘러보기는 여행방 빠른 메뉴의 '공유된 일정' 칸과 커뮤니티 탭에 있다(2026-10-17) */}
          </>
        )}
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
}: {
  trip: Trip;
  info: ReturnType<typeof tripCardInfo>;
  selected: boolean;
  nextLabel: string;
  onPress: () => void;
}) {
  // 상자를 누르면 그 방을 고르고 다음 할 일(nextLabel: 오늘 여행 진행, 기록 보기 등)로 바로 간다. 따로 버튼을 두지 않는다.
  // 고른 상태는 CoverTile이 accessibilityState.selected로 알린다.
  return (
    <CoverTile
      size="lg"
      place={regionById(trip.region)?.name ?? trip.title}
      image={coverUri(trip.cover)}
      badge={info.badge}
      title={info.title}
      lines={[info.dateText, info.countsText]}
      selected={selected}
      a11yLabel={`${trip.title} ${nextLabel}`}
      onPress={onPress}
      footer={
        <View pointerEvents="none">
          <AvatarStack names={info.memberNames} max={4} />
        </View>
      }
    />
  );
}

/**
 * 카드 줄 끝에 늘 보이는 '+' 손잡이(좁은 칸). 누르면 여행방 만들기, 줄 끝에서 왼쪽으로 끌면 NewTripPull이 펼쳐진다.
 * 모양은 화면 오른쪽 끝에서 잘린 카드다(2026-10-17): 연한 대표색(brand-soft, surfaceC.accentTint) 바탕에 진한 대표색 +만, 왼쪽만 둥글고 오른쪽 여백 없이
 * 화면 끝에 붙어 다음 카드가 이어지는 것처럼 보인다(줄 끝에 닿았을 때)
 */
function NewTripPeek({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="새 여행방 만들기" onPress={onPress} style={styles.peek}>
      <Icon name="plus" size={22} color="accentDeep" stroke={2.2} />
    </Pressable>
  );
}

/**
 * 당기는 동안 손잡이 자리에서 펼쳐지는 칸(손잡이와 같은 연한 대표색 잘린 카드 모양, + 만 진한 대표색). pull은 실제로 따라온 거리(px, 고무줄 저항이 걸린 값)다.
 * - 폭이 손잡이 + pull로 늘고, 연한 대표색 바탕이 조금씩 진해진다(대표색을 얇게 덮는다)
 * - + 는 끝까지(PULL_TRIGGER) 당기는 동안 반 바퀴 돌며 커지고, 넘으면 살짝 더 커져 '걸렸다'는 느낌을 준다
 * - '새 여행' 글자는 칸이 충분히 넓어지면 나타나고, 다 당기면 '놓으면 만들어요'
 * 당기지 않을 때(pull 0)는 보이지 않는다(줄 중간을 스크롤할 때 카드를 가리지 않게)
 */
function NewTripPull({ pull, ready }: { pull: Animated.Value; ready: boolean }) {
  const width = Animated.add(pull, NEW_TRIP_PEEK);
  const shown = pull.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const tint = pull.interpolate({ inputRange: [0, PULL_TRIGGER], outputRange: [0, 0.16], extrapolate: 'clamp' });
  const spin = pull.interpolate({ inputRange: [0, PULL_TRIGGER], outputRange: ['0deg', '180deg'], extrapolate: 'clamp' });
  const grow = pull.interpolate({ inputRange: [0, PULL_TRIGGER, PULL_TRIGGER + 30], outputRange: [1, 1.3, 1.45], extrapolate: 'clamp' });
  const label = pull.interpolate({ inputRange: [50, 90], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <Animated.View pointerEvents="none" style={[styles.pull, { width, opacity: shown }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.pullTint, { opacity: tint }]} />
      <Animated.View style={{ transform: [{ rotate: spin }, { scale: grow }] }}>
        <Icon name="plus" size={26} color="accentDeep" stroke={2.2} />
      </Animated.View>
      <Animated.View style={[styles.pullText, { opacity: label }]}>
        <Txt v="btnSm" numberOfLines={1}>
          새 여행
        </Txt>
        <Txt v="mtTight" numberOfLines={1}>
          {ready ? '놓으면 만들어요' : '더 당기면 만들어요'}
        </Txt>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingBottom: SP.section * 2 },
  head: { paddingTop: SP.l, paddingHorizontal: SP.gutter, gap: SP.xxl },
  gutter: { paddingHorizontal: SP.gutter },
  title: { marginTop: SP.xl },
  cards: { marginTop: SP.section, gap: SP.xl },
  cardRow: { paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xxl },
  section: { marginTop: SP.section, paddingHorizontal: SP.gutter, gap: SP.xxl },
  stretch: { alignItems: 'stretch' },
  start: { alignSelf: 'flex-start' },
  picks: { marginTop: SP.section + SP.m, gap: SP.xl },
  pickRow: { paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xl },
  rowWrap: { overflow: 'hidden' },
  // '+' 손잡이와 당기기 칸: 연한 대표색 바탕의 잘린 카드(+ 만 진한 대표색)
  // 줄 끝: 오른쪽 여백을 없애 '+' 칸이 화면 끝에서 잘린 카드처럼 붙는다
  cardRowEnd: { paddingRight: 0 },
  peek: {
    width: NEW_TRIP_PEEK,
    height: NEW_TRIP_H,
    borderTopLeftRadius: R.photo,
    borderBottomLeftRadius: R.photo,
    backgroundColor: surfaceC.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 손잡이와 같은 자리(화면 오른쪽 끝, 세로 여백 SP.s)에서 왼쪽으로 펼쳐진다. 오른쪽은 잘린 카드처럼 모서리 없이
  pull: {
    position: 'absolute',
    right: 0,
    top: SP.s,
    height: NEW_TRIP_H,
    borderTopLeftRadius: R.photo,
    borderBottomLeftRadius: R.photo,
    backgroundColor: surfaceC.accentTint,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.m,
  },
  pullTint: { backgroundColor: surfaceC.accent },
  pullText: { alignItems: 'center', gap: 2 },
});
