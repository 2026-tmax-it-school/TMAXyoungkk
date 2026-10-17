import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { tripMode } from '../../../core/group';
import type { TripStatus } from '../../../core/tripStatus';
import { useNow } from '../../../services/clock';
import { useUi } from '../../../store/ui';
import type { Trip } from '../../../types';
import { Chip, H, Icon, IconBtn, ListRow, MapPill, Sheet, SP, Txt } from '../../../ui';
import { homeSegments, tripBadge } from '../../account/home';
import { useActiveTrip } from '../useActiveTrip';

/** 여행방 바꾸기 시트의 묶음 순서와 이름 */
const GROUPS: { key: TripStatus; label: string }[] = [
  { key: 'ongoing', label: '진행 중' },
  { key: 'upcoming', label: '예정' },
  { key: 'done', label: '완료' },
];

const PICK_TITLE = '여행방을 골라 주세요';

/**
 * 지금 보는 여행방 줄(일정·후보·지도 탭 맨 위). 방은 useActiveTrip이 정하고 여기서 그 자리에서 바꾼다.
 * - variant 'bar': 첫 줄에 여행방 이름과 아래 꺾쇠, 둘째 줄에 상태 칩(tripBadge). 360px에서 오른쪽 아이콘이 셋이어도
 *   이름이 줄 너비를 다 쓰도록 칩을 이름 옆이 아니라 아래에 둔다. 누르면 '여행방 바꾸기' 시트(진행 중·예정·완료 순 ListRow).
 *   오른쪽에 채팅(그룹 모드만), 멤버·초대, 여행방 설정(개인 모드도 늘)을 둔다.
 * - variant 'chip': 지도 위 왼쪽 위 알약(MapPill). 누르면 같은 시트가 열린다.
 * 방이 0개면 아무것도 그리지 않는다(화면이 Empty와 '여행방 만들기'를 보인다).
 * 방은 있는데 고른 방이 없으면 '여행방을 골라 주세요'를 보인다.
 */
export function TripBar({ variant = 'bar', back }: { variant?: 'bar' | 'chip'; back?: () => void }) {
  const navigation = useNavigation();
  const { trip, trips } = useActiveTrip();
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  const now = useNow();
  const [open, setOpen] = useState(false);
  if (trips.length === 0) return null;

  const badge = trip ? tripBadge(trip, now) : undefined;
  const title = trip ? trip.title : PICK_TITLE;
  const a11y = trip ? `여행방 바꾸기, 지금 ${trip.title}, ${badge}` : PICK_TITLE;
  const pick = (t: Trip) => {
    setCurrentTrip(t.id);
    setOpen(false);
  };
  const sheet = (
    <TripPickSheet visible={open} trips={trips} currentId={trip?.id} now={now} onPick={pick} onClose={() => setOpen(false)} />
  );

  if (variant === 'chip') {
    return (
      <>
        <MapPill label={title} sub={badge} chevron numberOfLines={1} a11yLabel={a11y} onPress={() => setOpen(true)} />
        {sheet}
      </>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingTop: SP.s, paddingLeft: back ? SP.xl : SP.gutter, paddingRight: SP.xl }}>
      {back ? <IconBtn icon="back" label="뒤로" onPress={back} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        onPress={() => setOpen(true)}
        style={{ flex: 1, minWidth: 0, minHeight: H.touch, justifyContent: 'center', gap: SP.xs }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.m }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Txt v="ttlSm" numberOfLines={1}>
              {title}
            </Txt>
          </View>
          <Icon name="down" size={16} color="muted" stroke={2.2} />
        </View>
        {badge ? <Chip text={badge} tone="soft" /> : null}
      </Pressable>
      {trip ? (
        <IconBtn icon="chat" label={tripMode(trip) === 'group' ? '채팅' : '채팅 메모'} onPress={() => navigation.navigate('Chat', { tripId: trip.id })} />
      ) : null}
      {trip ? (
        <IconBtn icon="users" label="멤버·초대" onPress={() => navigation.navigate('Members', { tripId: trip.id })} />
      ) : null}
      {trip ? (
        <IconBtn icon="gear" label="여행방 설정" onPress={() => navigation.navigate('TripSettings', { tripId: trip.id })} />
      ) : null}
      {sheet}
    </View>
  );
}

/** '여행방 바꾸기' 시트. 진행 중·예정·완료 묶음 순서로 내 여행방을 늘어놓고, 지금 보는 방에는 '보는 중' 칩을 단다 */
function TripPickSheet({
  visible,
  trips,
  currentId,
  now,
  onPick,
  onClose,
}: {
  visible: boolean;
  trips: Trip[];
  currentId?: string;
  now: number;
  onPick: (t: Trip) => void;
  onClose: () => void;
}) {
  const { groups } = homeSegments(trips, now);
  return (
    <Sheet visible={visible} onClose={onClose} title="여행방 바꾸기" scroll>
      {GROUPS.filter((g) => groups[g.key].length > 0).map((g) => (
        <View key={g.key}>
          <Txt v="eyebrow">{`${g.label} ${groups[g.key].length}`}</Txt>
          {groups[g.key].map((t, i) => (
            <ListRow
              key={t.id}
              first={i === 0}
              label={t.title}
              sub={tripBadge(t, now)}
              right={t.id === currentId ? <Chip text="보는 중" tone="ok" /> : undefined}
              onPress={() => onPick(t)}
            />
          ))}
        </View>
      ))}
    </Sheet>
  );
}
