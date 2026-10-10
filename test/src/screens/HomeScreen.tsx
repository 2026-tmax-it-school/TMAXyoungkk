import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { Trip } from '../types';
import type { TripStatus } from '../core/tripStatus';
import { kstDate } from '../core/util';
import { regionById } from '../data/regions';
import {
  defaultSegment,
  HOME_PICKS,
  homeMenu,
  homeSegments,
  SEGMENT_ORDER,
  STATUS_LABEL,
  tripCardInfo,
  type HomeMenuCell,
} from '../features/account/home';
import { useSessionKeepAlive } from '../features/account/useSessionKeepAlive';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { useSession } from '../store/session';
import { useMyTrips, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  AvatarStack,
  Card,
  Col,
  CoverTile,
  Empty,
  Icon,
  IconBtn,
  QuickAction,
  Row,
  Screen,
  SectionTitle,
  Seg,
  SP,
  Txt,
  type IconName,
} from '../ui';

/**
 * 03 홈 · 메인 메뉴(FR-203, WP1 소유).
 * - 예정·진행중·완료 세그먼트와 개수. 상태는 공유 tripStatus(KST, appClock)라 시뮬레이터 시각을 따른다.
 * - 여행방 카드(D-일, 아바타, 후보·확정·제외 수) 다음에 메뉴 6칸(목업 03 순서).
 * - 개인 모드면 채팅 칸이 비활성이고 이유를 적는다. 길찾기 칸은 활성에 ScopeBadge '2차'.
 * - 여행방이 없으면 생성 유도 Empty.
 * - 2026-10-10 리디자인(숙박·여행 앱 레퍼런스): 카테고리 알약(세그먼트), 내 여행 표지 카드 가로 줄, 원형 빠른 메뉴 6칸, 추천 여행지 가로 줄 순서다.
 * - 쓰는 동안 세션을 유지한다(useSessionKeepAlive: 연장, 만료 폐기, 만료 3일 전 알림 한 번).
 * 판정은 features/account/home.ts(순수, wp1-home 테스트)에 있다.
 */
export default function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const trips = useMyTrips();
  const plans = useTrips((s) => s.plans);
  const now = useNow();
  const session = useSession((s) => s.session);
  const currentTripId = useUi((s) => s.currentTripId);
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);

  const seg = useMemo(() => homeSegments(trips, now), [trips, now]);
  const [picked, setPicked] = useState<TripStatus | undefined>(undefined);
  const active = picked ?? defaultSegment(seg.counts);
  const list = seg.groups[active];
  const current = trips.find((t) => t.id === currentTripId) ?? seg.groups.ongoing[0] ?? seg.groups.upcoming[0];

  // 쓰는 동안 세션을 연장하고, 시뮬레이터 시각이 만료를 넘으면 폐기한다(FR-105·FR-102).
  useSessionKeepAlive();

  const openMenu = (cell: HomeMenuCell) => {
    if (cell.key === 'create') return navigation.navigate('CreateTrip');
    if (!current) return;
    setCurrentTrip(current.id);
    const today = kstDate(now);
    const date = today >= current.startDate && today <= current.endDate ? today : current.startDate;
    switch (cell.key) {
      case 'chat':
        return navigation.navigate('Chat', { tripId: current.id });
      case 'candidates':
        return navigation.navigate('Candidates');
      case 'map':
        return navigation.navigate('Map', { date });
      case 'members':
        return navigation.navigate('Members', { tripId: current.id });
      case 'navigate':
        return navigation.navigate('Navigate', { tripId: current.id, date, legIndex: 0 });
    }
  };

  const who = session ? `${session.kind === 'guest' ? '게스트' : '계정'} · ${session.nickname}` : '';

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SP.section * 2 }}>
        <View style={{ paddingTop: SP.l, paddingHorizontal: SP.gutter, gap: SP.xxl }}>
          <Row gap={10}>
            <Col gap={2} grow>
              {who ? <Txt v="eyebrow">{who}</Txt> : null}
            </Col>
            <IconBtn icon="user" label="프로필" onPress={() => navigation.navigate('Profile')} />
            {current ? (
              <IconBtn
                icon="users"
                label={`${current.title} 멤버`}
                onPress={() => {
                  setCurrentTrip(current.id);
                  navigation.navigate('Members', { tripId: current.id });
                }}
              />
            ) : null}
          </Row>
          {trips.length > 0 ? (
            <Seg
              items={SEGMENT_ORDER.map((k) => ({ key: k, label: STATUS_LABEL[k], count: seg.counts[k], icon: SEG_ICON[k] }))}
              value={active}
              onChange={setPicked}
            />
          ) : null}
        </View>

        {/* 내 여행 */}
        <View style={{ marginTop: SP.section, gap: SP.xl }}>
          <View style={{ paddingHorizontal: SP.gutter }}>
            <SectionTitle
              title="내 여행"
              moreLabel="여행방 만들기"
              onMore={trips.length > 0 ? () => navigation.navigate('CreateTrip') : undefined}
            />
          </View>
          {trips.length === 0 ? (
            <View style={{ paddingHorizontal: SP.gutter }}>
              <Card>
                <Empty
                  icon="compass"
                  title="다음 여행을 계획해 보세요"
                  action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
                />
              </Card>
            </View>
          ) : list.length === 0 ? (
            <View style={{ paddingHorizontal: SP.gutter }}>
              <Card>
                <Empty icon="cal" title={`${STATUS_LABEL[active]}인 여행방이 없습니다`} />
              </Card>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xxl }}
            >
              {list.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  selected={t.id === current?.id}
                  info={tripCardInfo(t, plans[t.id], now)}
                  onPress={() => setCurrentTrip(t.id)}
                  onSchedule={() => {
                    setCurrentTrip(t.id);
                    navigation.navigate('Schedule', {});
                  }}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* 빠른 메뉴 */}
        <View style={{ marginTop: SP.section, paddingHorizontal: SP.gutter, gap: SP.xxl }}>
          <SectionTitle title="빠른 메뉴" />
          <MenuGrid cells={homeMenu(current, current ? plans[current.id] : undefined)} onPress={openMenu} />
        </View>

        {/* 추천 여행지 */}
        <View style={{ marginTop: SP.section + SP.m, gap: SP.xl }}>
          <View style={{ paddingHorizontal: SP.gutter }}>
            <SectionTitle title="추천 여행지" />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SP.gutter, paddingVertical: SP.s, gap: SP.xl }}
          >
            {HOME_PICKS.map((p, i) => (
              <CoverTile
                key={p.id}
                seed={i}
                place={p.name}
                title={p.name}
                lines={[p.blurb]}
                onPress={() => navigation.navigate('CreateTrip')}
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
  onPress,
  onSchedule,
}: {
  trip: Trip;
  info: ReturnType<typeof tripCardInfo>;
  selected: boolean;
  onPress: () => void;
  onSchedule: () => void;
}) {
  // 표지(여행방 고르기)와 '시간표 보기'를 나란한 두 버튼으로 둔다(웹에서 button 중첩을 피한다).
  return (
    <CoverTile
      size="lg"
      seed={trip.region}
      place={regionById(trip.region)?.name ?? trip.title}
      badge={info.badge}
      title={info.title}
      lines={[info.dateText, info.countsText]}
      selected={selected}
      onPress={onPress}
      footer={
        <Row style={{ justifyContent: 'space-between' }}>
          <AvatarStack names={info.memberNames.slice(0, 4)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`${trip.title} 시간표 보기`} onPress={onSchedule}>
            <Row gap={4}>
              <Txt v="btnSm" c="accent">
                시간표 보기
              </Txt>
              <Icon name="right" size={14} color="accent" stroke={2.2} />
            </Row>
          </Pressable>
        </Row>
      }
    />
  );
}

/** 원형 빠른 메뉴 3칸씩 두 줄(여행 앱 홈의 아이콘 줄) */
function MenuGrid({ cells, onPress }: { cells: HomeMenuCell[]; onPress: (c: HomeMenuCell) => void }) {
  const rows: HomeMenuCell[][] = [];
  for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3));
  return (
    <Col gap={SP.section}>
      {rows.map((r) => (
        <Row key={r.map((c) => c.key).join('-')} gap={SP.m} top>
          {r.map((c) => (
            <QuickAction
              key={c.key}
              icon={c.icon}
              label={c.label}
              badge={c.scope}
              disabled={c.disabled}
              onPress={() => onPress(c)}
            />
          ))}
        </Row>
      ))}
    </Col>
  );
}
