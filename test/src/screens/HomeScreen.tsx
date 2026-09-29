import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Trip } from '../types';
import type { TripStatus } from '../core/tripStatus';
import { kstDate } from '../core/util';
import {
  defaultSegment,
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
  Body,
  Card,
  Chip,
  Col,
  Empty,
  Icon,
  IconBtn,
  lineC,
  Row,
  Screen,
  ScopeBadge,
  Seg,
  SP,
  Txt,
} from '../ui';

/**
 * 03 홈 · 메인 메뉴(FR-203, WP1 소유).
 * - 예정·진행중·완료 세그먼트와 개수. 상태는 공유 tripStatus(KST, appClock)라 시뮬레이터 시각을 따른다.
 * - 여행방 카드(D-일, 아바타, 후보·확정·제외 수) 다음에 메뉴 6칸(목업 03 순서).
 * - 개인 모드면 채팅 칸이 비활성이고 이유를 적는다. 길찾기 칸은 활성에 ScopeBadge '2차'.
 * - 여행방이 없으면 생성 유도 Empty.
 * - 머리말은 목업 03 .hd-row: 한 줄에 eyebrow·제목과 오른쪽 아이콘 버튼 두 개. 목업의 검색 자리는
 *   홈 검색이 명세에 없어 프로필로 바꿨고, 멤버(users)는 지금 여행방 멤버 화면을 연다.
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
      <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: 14, gap: SP.xl }}>
        <Row gap={10}>
          <Col gap={4} grow>
            {who ? <Txt v="eyebrow">{who}</Txt> : null}
            <Txt v="ttl">내 여행</Txt>
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
            items={SEGMENT_ORDER.map((k) => ({ key: k, label: STATUS_LABEL[k], count: seg.counts[k] }))}
            value={active}
            onChange={setPicked}
          />
        ) : null}
      </View>
      <Body scroll>
        {trips.length === 0 ? (
          <Card>
            <Empty
              title="아직 여행방이 없습니다"
              text="여행방을 만들고 친구를 초대하면 채팅에서 나온 곳이 후보와 시간표가 됩니다."
              action={{ label: '여행방 만들기', onPress: () => navigation.navigate('CreateTrip') }}
            />
          </Card>
        ) : list.length === 0 ? (
          <Card>
            <Empty title={`${STATUS_LABEL[active]}인 여행방이 없습니다`} text="다른 칸을 눌러 보세요." />
          </Card>
        ) : (
          list.map((t) => (
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
          ))
        )}

        <Txt v="eyebrow" style={{ marginTop: 2 }}>
          {current ? `메인 메뉴 · ${current.title}` : '메인 메뉴'}
        </Txt>
        <MenuGrid cells={homeMenu(current, current ? plans[current.id] : undefined)} onPress={openMenu} />
      </Body>
    </Screen>
  );
}

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
  // 카드 전체를 버튼으로 두면 안의 "시간표 보기"가 버튼 속 버튼이 된다(웹에서 button 중첩).
  // 카드는 틀만 두고, 여행방 열기와 시간표 보기를 나란한 두 버튼으로 나눈다.
  return (
    <Card variant={selected ? 'selected' : 'default'}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${trip.title} 열기`} onPress={onPress}>
        <Row top>
          <Col gap={4} grow>
            <Chip text={info.badge} />
            <Txt v="nmLg" style={{ marginTop: 2 }}>
              {info.title}
            </Txt>
            <Txt v="mt">{info.dateText}</Txt>
          </Col>
          <AvatarStack names={info.memberNames.slice(0, 4)} />
        </Row>
      </Pressable>
      <View style={{ height: 1, backgroundColor: lineC.line, marginVertical: 4 }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`${trip.title} 열기`} onPress={onPress}>
          <Txt v="mt">{info.countsText}</Txt>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${trip.title} 시간표 보기`} onPress={onSchedule}>
          <Row gap={4}>
            <Txt v="btnSm" c="accent">
              시간표 보기
            </Txt>
            <Icon name="right" size={14} color="accent" stroke={2.2} />
          </Row>
        </Pressable>
      </Row>
    </Card>
  );
}

function MenuGrid({ cells, onPress }: { cells: HomeMenuCell[]; onPress: (c: HomeMenuCell) => void }) {
  const rows: HomeMenuCell[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  return (
    <Col gap={9}>
      {rows.map((r) => (
        <Row key={r.map((c) => c.key).join('-')} gap={9} top>
          {r.map((c) => (
            <Col key={c.key} grow>
              <Card
                variant={c.disabled ? 'excluded' : 'default'}
                onPress={c.disabled ? undefined : () => onPress(c)}
                style={{ minHeight: 92, gap: 9 }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Icon name={c.icon} size={22} color={c.disabled ? 'faint' : 'accent'} />
                  {c.scope ? <ScopeBadge phase={c.scope} /> : null}
                </Row>
                <Col gap={4}>
                  <Txt v="btnSm" c={c.disabled ? 'muted' : 'ink'}>
                    {c.label}
                  </Txt>
                  {c.sub ? <Txt v="mtTight">{c.sub}</Txt> : null}
                  {c.disabled && c.reason ? <Txt v="mtTight">{c.reason}</Txt> : null}
                </Col>
              </Card>
            </Col>
          ))}
        </Row>
      ))}
    </Col>
  );
}
