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

import type { Plan, Trip } from '../types';
import { coverUri } from '../core/trip/cover';
import { tripStatus, type TripStatus } from '../core/tripStatus';
import { kstDate } from '../core/util';
import { regionById } from '../data/regions';
import {
  HOME_PICKS,
  pickTitle,
  homeSegments,
  NEW_TRIP_H,
  NEW_TRIP_PEEK,
  cardRowAtEnd,
  cardRowArrows,
  cardRowStep,
  cardRowAtStart,
  cardRowContentWidth,
  PULL_TRIGGER,
  pullOffset,
  SEGMENT_ORDER,
  showsSegmentBar,
  STATUS_LABEL,
  homeGreeting,
  homeNowTask,
  tripCardInfo,
  tripCardLines,
  tripNextStep,
  visibleSegments,
} from '../features/account/home';
import { syncNicknameToTrips } from '../features/account/flows';
import { HomeSearchResults } from '../features/account/HomeSearchResults';
import { searchTrips } from '../features/account/homeSearch';
import { useSessionKeepAlive } from '../features/account/useSessionKeepAlive';
import { TripActions } from '../features/trip/components/TripActions';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { useSession } from '../store/session';
import { useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  PE,
  RegionArt,
  useLayout,
  AvatarStack,
  Btn,
  Col,
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
  TourTarget,
  Txt,
  useTour,
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
 * - 여행방 빠른 메뉴(멤버 초대·AI 추천·설정 등)는 카드를 누르면 가는 후보·시간표 화면 위(features/trip TripActions)에 있고,
 *   2026-10-22부터 홈 카드 줄 아래에도 고른 방(테두리 카드) 것을 같은 칸으로 둔다(들어가야만 보여 기능이 없는 줄 알았다).
 *   '초대 코드로 합류'는 카드 줄 왼쪽 끝 잘린 카드(누르거나 오른쪽으로 당기기)다.
 * - 지금 보는 방은 useActiveTrip(pickCurrentTrip) 하나로 정한다. 홈이 따로 대체 규칙을 두지 않는다.
 * - 여행방이 없으면 만들기 Empty와 '초대 코드로 합류'.
 * - 추천 여행지 타일은 그 지역의 예시 2박 3일(30 예시 일정)로 간다. 거기서 '이 일정으로 여행방 만들기'나 '직접 만들기'로 이어진다.
 * - 쓰는 동안 세션을 유지한다(useSessionKeepAlive: 연장, 만료 폐기, 만료 3일 전 알림 한 번).
 * - 표지·이름·날짜 '수정'은 19 여행 진행의 '여행 진행 끝내기' 왼쪽으로 옮겼다(2026-10-17). 홈 카드에는 두지 않는다.
 * 판정은 features/account/home.ts(순수, wp1-home 테스트)에 있다.
 */
export default function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const { trip: current, trips } = useActiveTrip();
  const desk = useLayout().mode === 'desktop';
  const plans = useTrips((s) => s.plans);
  const now = useNow();
  const today = kstDate(now);
  const session = useSession((s) => s.session);
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  const guideDismissed = useUi((s) => s.guideDismissed);
  const dismissGuide = useUi((s) => s.dismissGuide);

  const seg = useMemo(() => homeSegments(trips, now), [trips, now]);
  const visible = visibleSegments(seg.counts);
  const segBar = showsSegmentBar(trips.length, visible);
  const currentSeg = current ? tripStatus(current, now) : undefined;
  // 세그먼트는 고른 방이 있는 칸을 따른다(칸을 바꾸면 그 칸의 첫 방을 고르므로 늘 같은 칸이 된다)
  const active: TripStatus = currentSeg && visible.includes(currentSeg) ? currentSeg : (visible[0] ?? 'ongoing');
  // 홈 검색: 적으면 카드 줄은 방 이름·여행지에 맞는 방만, 아래에는 지역과 AI 추천 여행지(features/account/homeSearch)
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = query.trim().length > 0;
  const allCards = segBar ? seg.groups[active] : SEGMENT_ORDER.flatMap((k) => seg.groups[k]);
  const list = searching ? searchTrips(trips, query) : allCards;

  // 쓰는 동안 세션을 연장하고, 시뮬레이터 시각이 만료를 넘으면 폐기한다(FR-105·FR-102).
  useSessionKeepAlive();

  // 예전에 닉네임을 바꿔 옛 이름이 남은 여행방이 있으면 지금 닉네임으로 맞춘다(같으면 아무것도 보내지 않는다)
  const myName = session?.nickname;
  const greeting = homeGreeting(myName, current, current ? regionById(current.region)?.name : undefined, now);
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

  // 카드 줄 양 끝 당기기(2026-10-17). 오른쪽 끝 '+'는 새 여행, 왼쪽 끝 링크는 초대 코드로 합류다.
  // 줄 끝(처음)에 닿은 뒤 바깥쪽으로 더 끌면 PanResponder가 잡아 고무줄 저항(pullOffset)으로 칸을 끌어내고(카드도 같이 밀린다),
  // PULL_TRIGGER 넘게 끌어 놓으면 그 화면으로 간다. 덜 끌면 튕겨 돌아간다. 잘린 카드를 눌러도 된다.
  // 일반 스크롤은 그대로라 줄 중간에서는 당기기가 시작되지 않는다
  const rowRef = useRef<ScrollView>(null);
  const pullX = useRef(new Animated.Value(0)).current;
  const [pullReady, setPullReady] = useState(false);
  const pullL = useRef(new Animated.Value(0)).current;
  const [pullLReady, setPullLReady] = useState(false);
  const rowAtStart = useRef(false);
  const pullSide = useRef<'left' | 'right'>('right');
  // 처음에는 끝이 아니다(크기를 알기 전에 옆으로 밀기를 가로채지 않게). 크기와 위치를 알면 cardRowAtEnd로 정한다
  const rowAtEnd = useRef(false);
  // 줄 끝 판단: 지금 스크롤 위치 + 화면 폭이 내용 폭에 닿았는지. 크기가 나중에 재져도 위치를 함께 본다
  const rowSize = useRef({ x: 0, viewW: 0, contentW: 0 });
  // 양옆 화살표: 화면 밖에 여행 카드가 남은 쪽만 보인다(2026-10-17)
  const [arrows, setArrows] = useState({ left: false, right: false });
  const cardCount = useRef(0);
  const updateAtEnd = () => {
    const { x, viewW, contentW } = rowSize.current;
    rowAtEnd.current = cardRowAtEnd(x, viewW, contentW);
    rowAtStart.current = cardRowAtStart(x, viewW);
    const next = cardRowArrows(x, viewW, cardCount.current);
    setArrows((was) => (was.left === next.left && was.right === next.right ? was : next));
  };
  const stepRow = (dir: 1 | -1) => {
    const { x, viewW } = rowSize.current;
    rowRef.current?.scrollTo({ x: cardRowStep(x, cardCount.current, dir, viewW), animated: true });
  };
  const openCreate = () => {
    setPullReady(false);
    rowRef.current?.scrollTo({ x: 0, animated: false });
    navigation.navigate('CreateTrip');
  };
  const openCreateRef = useRef(openCreate);
  openCreateRef.current = openCreate;
  const openInvite = () => {
    setPullLReady(false);
    navigation.navigate('InviteAccept');
  };
  const openInviteRef = useRef(openInvite);
  openInviteRef.current = openInvite;
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
  cardCount.current = list.length;
  useEffect(() => {
    rowSize.current = { ...rowSize.current, contentW: cardRowContentWidth(list.length) };
    updateAtEnd();
  }, [list.length]);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => {
        if (Math.abs(g.dx) <= Math.abs(g.dy) * 1.5) return false;
        if (rowAtEnd.current && g.dx < -6) {
          pullSide.current = 'right';
          return true;
        }
        if (rowAtStart.current && g.dx > 6) {
          pullSide.current = 'left';
          return true;
        }
        return false;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const right = pullSide.current === 'right';
        const off = pullOffset(right ? -g.dx : g.dx);
        (right ? pullX : pullL).setValue(off);
        const ready = off >= PULL_TRIGGER;
        (right ? setPullReady : setPullLReady)((was) => (was === ready ? was : ready));
      },
      onPanResponderRelease: (_, g) => {
        const right = pullSide.current === 'right';
        const go = pullOffset(right ? -g.dx : g.dx) >= PULL_TRIGGER;
        Animated.spring(right ? pullX : pullL, { toValue: 0, useNativeDriver: false, tension: 140, friction: 10 }).start();
        (right ? setPullReady : setPullLReady)(false);
        if (go) (right ? openCreateRef : openInviteRef).current();
      },
      onPanResponderTerminate: () => {
        for (const v of [pullX, pullL]) Animated.spring(v, { toValue: 0, useNativeDriver: false, tension: 140, friction: 10 }).start();
        setPullReady(false);
        setPullLReady(false);
      },
    }),
  ).current;

  return (
    <Screen wide={desk ? HOME_DESK_W : undefined}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          {/* 피그마 최종안 09(2026-10-23): 맨 위 줄은 이름과 검색 단추, 그 아래 인사('민지님, 경주까지 D-3').
              검색칸은 검색 단추를 누르거나 검색어가 있을 때만 펼친다 */}
          <Row>
            <View style={styles.fill}>
              <Txt v="ttlSm">Young Trip</Txt>
            </View>
            <IconBtn
              icon={searchOpen ? 'x' : 'search'}
              label={searchOpen ? '검색 닫기' : '여행 검색'}
              onPress={() => {
                if (searchOpen) setQuery('');
                setSearchOpen(!searchOpen);
              }}
            />
          </Row>
          {searchOpen ? (
            <Field label="검색" hideLabel size="sm" value={query} onChangeText={(v) => setQuery(v.slice(0, 40))} placeholder="여행방·지역 검색" />
          ) : null}
          <View accessibilityRole="header" style={styles.title}>
            <Txt v={greeting === '내 여행' ? 'hero' : 'ttl'}>{greeting}</Txt>
          </View>
          {segBar && !searching ? (
            <Seg
              items={visible.map((k) => ({ key: k, label: STATUS_LABEL[k], count: seg.counts[k], icon: SEG_ICON[k] }))}
              value={active}
              onChange={pickSegment}
            />
          ) : null}
        </View>

        {desk && !searching ? (
          // 컴퓨터 폭(2026-10-22): 왼쪽 단은 여행 카드 격자와 추천 일정, 오른쪽 단은 지금 할 일. 가로로 넘기는 줄·잘린 칸을 쓰지 않는다
          <View style={styles.deskRow}>
            <View style={styles.deskMain}>
              <View style={styles.grid}>
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
                <AddTile icon="plus" title="새 여행방 만들기" sub="날짜와 기점부터" onPress={openCreate} />
                <AddTile icon="link" title="초대 코드로 합류" sub="받은 코드나 링크로" onPress={openInvite} />
              </View>
              <View style={styles.deskPicks}>
                <SectionTitle title="추천 여행 일정" />
                <View style={styles.grid}>
                  {HOME_PICKS.map((p) => (
                    <CoverTile
                      key={p.id}
                      place={p.name}
                      art={<RegionArt regionId={p.id} />}
                      title={pickTitle(p.id, p.name)}
                      lines={[p.blurb]}
                      a11yLabel={`${p.name} 예시 일정 보기`}
                      onPress={() => navigation.navigate('SampleTrip', { regionId: p.id })}
                    />
                  ))}
                </View>
              </View>
            </View>
            {current ? (
              <View style={styles.deskAside}>
                <NowTaskCard trip={current} plan={plans[current.id]} now={now} onGo={() => goNext(current)} inset />
              </View>
            ) : null}
          </View>
        ) : (
          <>
        {/* 처음이세요?(2026-10-24): 앱 둘러보기로 안내한다. 한 번 열거나 닫으면 다시 안 보인다 */}
        {!searching && !guideDismissed ? <GuideInvite onOpen={() => { dismissGuide(); useTour.getState().start(0); }} onClose={dismissGuide} /> : null}

        {/* 지금 할 일(2026-10-22 디자인 검토: 오늘 무엇을 할지가 첫 화면에 없었다). 고른 방의 다음 할 일 한 가지와 버튼 하나 */}
        {!searching && current ? <NowTaskCard trip={current} plan={plans[current.id]} now={now} onGo={() => goNext(current)} /> : null}

        {/* 내 여행 표지 카드 */}
        <View style={styles.cards}>
          {searching && list.length === 0 ? (
            <View style={styles.gutter}>
              <Txt v="mtTight">{`'${query.trim()}' 여행방이 없어요`}</Txt>
            </View>
          ) : trips.length === 0 ? (
            <View style={styles.gutter}>
              <TourTarget id="home-empty">
              <Card>
                <Empty icon="compass" title="다음 여행을 계획해 보세요" />
                {/* 두 버튼은 같은 크기·같은 비율(전체 폭, 같은 높이)로 위아래에 둔다(2026-10-17) */}
                <Col gap={SP.m}>
                  <Btn title="여행방 만들기" onPress={() => navigation.navigate('CreateTrip')} />
                  <Btn title="초대 코드로 합류" variant="quiet" onPress={() => navigation.navigate('InviteAccept')} />
                </Col>
              </Card>
              </TourTarget>
            </View>
          ) : (
            <TourTarget id="home-cards">
            <View {...pan.panHandlers} style={styles.rowWrap}>
            <Animated.ScrollView
              ref={rowRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.cardRow, styles.cardRowEnd]}
              style={{ transform: [{ translateX: Animated.subtract(pullL, pullX) }] }}
              onScroll={onRowScroll}
              scrollEventThrottle={32}
              onLayout={(e) => measureRow({ viewW: e.nativeEvent.layout.width, contentW: cardRowContentWidth(list.length) })}
              onContentSizeChange={(contentW) => measureRow({ contentW })}
            >
              <EdgePeek side="left" icon="link" label="초대 코드로 합류" onPress={openInvite} />
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
              <EdgePeek side="right" icon="plus" label="새 여행방 만들기" onPress={openCreate} />
            </Animated.ScrollView>
            <EdgePull side="left" icon="link" pull={pullL} ready={pullLReady} title="초대 코드" idle="더 당기면 합류해요" done="놓으면 합류해요" />
            <EdgePull side="right" icon="plus" pull={pullX} ready={pullReady} title="새 여행" idle="더 당기면 만들어요" done="놓으면 만들어요" />
            {arrows.left ? (
              <View style={[styles.arrow, styles.arrowLeft]}>
                <IconBtn icon="back" label="이전 여행방" variant="soft" onPress={() => stepRow(-1)} />
              </View>
            ) : null}
            {arrows.right ? (
              <View style={[styles.arrow, styles.arrowRight]}>
                <IconBtn icon="right" label="다음 여행방" variant="soft" onPress={() => stepRow(1)} />
              </View>
            ) : null}
            </View>
            </TourTarget>
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

        {/* 초대 코드로 합류는 카드 줄 왼쪽 끝 잘린 카드로 옮겼다(2026-10-17) */}
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
                art={<RegionArt regionId={p.id} />}
                title={pickTitle(p.id, p.name)}
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
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** 컴퓨터 폭 홈 본문 칸(두 단). 오른쪽 단 폭 */
const HOME_DESK_W = 1040;
const HOME_ASIDE_W = 340;
/** 여행 카드(CoverTile lg) 폭과 같다 */
const COVER_LG_W = 272;

const SEG_ICON: Record<TripStatus, IconName> = { ongoing: 'play', upcoming: 'cal', done: 'check' };

/** 컴퓨터 폭 카드 격자의 '새 여행방'·'초대 코드' 칸(여행 카드와 같은 크기, 점선 테두리) */
function AddTile({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.addTile}>
      <Icon name={icon} size={26} color="accentDeep" stroke={2.2} />
      <Txt v="nm">{title}</Txt>
      <Txt v="mtTight">{sub}</Txt>
    </Pressable>
  );
}

/** 홈 맨 위 '지금 할 일' 카드. 글은 features/account/home.homeNowTask(순수)가 고른다 */
/** 처음 쓰는 사람에게 앱 둘러보기를 권하는 카드(피그마 톤: 연한 카드 + 버튼 한 개 + 닫기) */
function GuideInvite({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  return (
    <View style={styles.now}>
      <Card variant="tinted">
        <Row gap={SP.xl}>
          <Icon name="compass" size={22} color="accent" />
          <Col grow gap={2}>
            <Txt v="nm">처음이세요?</Txt>
            <Txt v="mtTight">앱의 모든 기능을 순서대로 안내해 드려요.</Txt>
          </Col>
          <IconBtn icon="x" label="안내 닫기" onPress={onClose} />
        </Row>
        <Btn title="앱 둘러보기" variant="ghost" size="sm" onPress={onOpen} />
      </Card>
    </View>
  );
}

function NowTaskCard({
  trip,
  plan,
  now,
  onGo,
  inset,
}: {
  trip: Trip;
  plan: Plan | undefined;
  now: number;
  onGo: () => void;
  /** 바깥 여백 없이(컴퓨터 오른쪽 단) */
  inset?: boolean;
}) {
  const task = homeNowTask(trip, plan, now);
  return (
    <View style={inset ? null : styles.now}>
      <TourTarget id="home-now">
      <Card variant="brand">
        <Col gap={SP.xs}>
          <Txt v="eyebrow" c="accent" numberOfLines={1}>
            {task.eyebrow}
          </Txt>
          <Txt v="ttl">{task.title}</Txt>
          <Txt v="mt" c="ink">
            {task.sub}
          </Txt>
        </Col>
        <Btn title={task.action} onPress={onGo} />
        {/* 그 방의 다른 기능은 같은 카드 안 작은 칸으로(2026-10-22: 카드 아래 따로 두면 초록 버튼이 둘로 겹쳤다). 강조는 위 주 버튼 하나 */}
        <View style={styles.nowDivider} />
        <TripActions trip={trip} compact />
      </Card>
      </TourTarget>
    </View>
  );
}

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
      art={<RegionArt regionId={trip.region} />}
      badge={info.badge}
      title={info.title}
      lines={tripCardLines(info)}
      selected={selected}
      a11yLabel={`${trip.title} ${nextLabel}`}
      onPress={onPress}
      footer={
        <View style={PE.none}>
          <AvatarStack names={info.memberNames} max={4} />
        </View>
      }
    />
  );
}

/**
 * 카드 줄 양 끝에 늘 보이는 잘린 카드(좁은 칸, 2026-10-17). 오른쪽은 '+'(새 여행), 왼쪽은 링크(초대 코드로 합류).
 * 연한 대표색(brand-soft) 바탕에 진한 대표색 아이콘만, 바깥쪽 여백·모서리 없이 화면 끝에 붙어 카드가 이어지다 잘린 것처럼 보인다.
 * 누르면 그 화면, 줄 끝(처음)에서 바깥쪽으로 끌면 EdgePull이 펼쳐진다
 */
function EdgePeek({ side, icon, label, onPress }: { side: 'left' | 'right'; icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.peek, side === 'left' ? styles.peekLeft : styles.peekRight]}>
      <Icon name={icon} size={22} color="accentDeep" stroke={2.2} />
    </Pressable>
  );
}

/**
 * 당기는 동안 잘린 카드 자리에서 펼쳐지는 칸(같은 모양). pull은 실제로 따라온 거리(px, 고무줄 저항이 걸린 값)다.
 * - 폭이 손잡이 + pull로 늘고, 연한 대표색 바탕이 조금씩 진해진다(대표색을 얇게 덮는다)
 * - 아이콘은 끝까지(PULL_TRIGGER) 당기는 동안 반 바퀴 돌며 커지고, 넘으면 살짝 더 커져 '걸렸다'는 느낌을 준다
 * - 제목은 칸이 충분히 넓어지면 나타나고, 다 당기면 done 문구
 * 당기지 않을 때(pull 0)는 보이지 않는다(줄 중간을 스크롤할 때 카드를 가리지 않게)
 */
function EdgePull({
  side,
  icon,
  pull,
  ready,
  title,
  idle,
  done,
}: {
  side: 'left' | 'right';
  icon: IconName;
  pull: Animated.Value;
  ready: boolean;
  title: string;
  idle: string;
  done: string;
}) {
  const width = Animated.add(pull, NEW_TRIP_PEEK);
  const shown = pull.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const tint = pull.interpolate({ inputRange: [0, PULL_TRIGGER], outputRange: [0, 0.16], extrapolate: 'clamp' });
  const spin = pull.interpolate({ inputRange: [0, PULL_TRIGGER], outputRange: ['0deg', side === 'left' ? '-180deg' : '180deg'], extrapolate: 'clamp' });
  const grow = pull.interpolate({ inputRange: [0, PULL_TRIGGER, PULL_TRIGGER + 30], outputRange: [1, 1.3, 1.45], extrapolate: 'clamp' });
  const label = pull.interpolate({ inputRange: [50, 90], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <Animated.View style={[PE.none, styles.pull, side === 'left' ? styles.pullLeft : styles.pullRight, { width, opacity: shown }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.pullTint, { opacity: tint }]} />
      <Animated.View style={{ transform: [{ rotate: spin }, { scale: grow }] }}>
        <Icon name={icon} size={26} color="accentDeep" stroke={2.2} />
      </Animated.View>
      <Animated.View style={[styles.pullText, { opacity: label }]}>
        <Txt v="btnSm" numberOfLines={1}>
          {title}
        </Txt>
        <Txt v="mtTight" numberOfLines={1}>
          {ready ? done : idle}
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
  quick: { marginTop: SP.xxl, gap: SP.m },
  now: { marginTop: SP.xl, paddingHorizontal: SP.gutter },
  nowDivider: { height: 1, backgroundColor: surfaceC.softLine, marginVertical: SP.xs },
  deskRow: { marginTop: SP.section, paddingHorizontal: SP.gutter, flexDirection: 'row', alignItems: 'flex-start', gap: SP.section },
  deskMain: { flex: 1, minWidth: 0, gap: SP.section },
  deskAside: { width: HOME_ASIDE_W },
  deskPicks: { gap: SP.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xxl },
  addTile: {
    width: COVER_LG_W,
    height: NEW_TRIP_H,
    borderRadius: R.photo,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: surfaceC.softLine,
    backgroundColor: surfaceC.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.s,
  },
  cardRow: { paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xxl },
  section: { marginTop: SP.section, paddingHorizontal: SP.gutter, gap: SP.xxl },
  stretch: { alignItems: 'stretch' },
  start: { alignSelf: 'flex-start' },
  picks: { marginTop: SP.section + SP.m, gap: SP.xl },
  pickRow: { paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xl },
  rowWrap: { overflow: 'hidden' },
  arrow: { position: 'absolute', top: '50%', marginTop: -22 },
  arrowLeft: { left: SP.s },
  arrowRight: { right: SP.s },
  // '+' 손잡이와 당기기 칸: 연한 대표색 바탕의 잘린 카드(+ 만 진한 대표색)
  // 줄 양 끝: 좌우 여백을 없애 양쪽 잘린 카드가 화면 끝에 붙는다
  cardRowEnd: { paddingLeft: 0, paddingRight: 0 },
  peek: {
    width: NEW_TRIP_PEEK,
    height: NEW_TRIP_H,
    backgroundColor: surfaceC.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 오른쪽 끝(+): 왼쪽만 둥글다. 왼쪽 끝(링크): 오른쪽만 둥글다
  peekRight: { borderTopLeftRadius: R.photo, borderBottomLeftRadius: R.photo },
  peekLeft: { borderTopRightRadius: R.photo, borderBottomRightRadius: R.photo },
  // 손잡이와 같은 자리(화면 오른쪽 끝, 세로 여백 SP.s)에서 왼쪽으로 펼쳐진다. 오른쪽은 잘린 카드처럼 모서리 없이
  pull: {
    position: 'absolute',
    top: SP.s,
    height: NEW_TRIP_H,
    backgroundColor: surfaceC.accentTint,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.m,
  },
  pullRight: { right: 0, borderTopLeftRadius: R.photo, borderBottomLeftRadius: R.photo },
  pullLeft: { left: 0, borderTopRightRadius: R.photo, borderBottomRightRadius: R.photo },
  pullTint: { backgroundColor: surfaceC.accent },
  pullText: { alignItems: 'center', gap: 2 },
});
