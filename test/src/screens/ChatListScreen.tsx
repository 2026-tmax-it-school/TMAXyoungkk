import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback } from 'react';

import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { TabScreenProps } from '../navigation/routes';
import { useHomeBack } from '../navigation/useBack';
import { Empty, Header, Screen } from '../ui';

/**
 * 채팅 탭 자리(2026-10-21 사용자 요청: 목록 대신 단일 채팅방). 하단 '채팅' 칸은 탭바(RootNavigator)에서 바로 Chat을 열고,
 * 이 화면은 딥링크('chats')나 새로고침으로 들어왔을 때만 보인다. 가장 최근에 쓴 여행방(useActiveTrip)의 채팅으로 넘긴다.
 * 방 바꾸기는 채팅 화면 머리의 방 이름(▼)에서 한다.
 */
export default function ChatListScreen({ navigation }: TabScreenProps<'ChatList'>) {
  const back = useHomeBack();
  const { trip } = useActiveTrip();
  const tripId = trip?.id;
  useFocusEffect(
    useCallback(() => {
      if (!tripId) return;
      // 뒤로 가면 채팅 목록이 아니라 홈으로 가게, 홈 탭을 먼저 켠 뒤 채팅을 연다
      navigation.navigate('Home');
      navigation.navigate('Chat', { tripId });
    }, [navigation, tripId]),
  );
  return (
    <Screen>
      <Header back={back} title="채팅" />
      {tripId ? null : (
        <Empty
          icon="chat"
          title="아직 채팅방이 없어요"
          text="여행방을 만들거나 초대받으면 그 여행방의 채팅방이 생겨요"
          action={{ label: '홈으로', onPress: () => navigation.navigate('Home') }}
        />
      )}
    </Screen>
  );
}
