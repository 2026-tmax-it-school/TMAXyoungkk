import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ChatRoomList } from '../features/chat/components/ChatRoomList';
import type { TabScreenProps } from '../navigation/routes';
import { useHomeBack } from '../navigation/useBack';
import { useUi } from '../store/ui';
import { Field, Header, IconBtn, Row, Screen, SP } from '../ui';

/**
 * 채팅방 목록(2026-10-17 사용자 요청). 하단 탭 '채팅' 칸(탭 라우트)이라 아래 탭 줄이 보인다. 내 여행방마다 채팅방이 하나다.
 * 방을 누르면 그 채팅(05), 꾹 누르면 고정/삭제(삭제하면 그 여행방에서 나간다). 목록과 메뉴는 features/chat ChatRoomList.
 */
export default function ChatListScreen({ navigation }: TabScreenProps<'ChatList'>) {
  // 탭 맨 위 화면이라 뒤로는 홈 탭(다른 탭 화면과 같다)
  const back = useHomeBack();
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  // 위쪽 검색칸: 적는 대로 방 이름·마지막 말로 거른다(features/chat/rooms filterRooms)
  const [query, setQuery] = useState('');
  return (
    <Screen>
      <Header back={back} title="채팅" />
      <Row gap={SP.s} style={{ paddingHorizontal: SP.gutter, paddingBottom: SP.m }}>
        <View style={{ flex: 1 }}>
          <Field
            label="채팅방 검색"
            hideLabel
            size="sm"
            value={query}
            onChangeText={(v) => setQuery(v.slice(0, 40))}
            placeholder="검색"
          />
        </View>
        {/* 적는 대로 걸러지므로 검색 버튼은 두지 않고, 적었을 때만 지우기 버튼을 둔다 */}
        {query ? <IconBtn icon="x" label="검색어 지우기" onPress={() => setQuery('')} /> : null}
      </Row>
      <ScrollView contentContainerStyle={{ paddingBottom: SP.section }} keyboardShouldPersistTaps="handled">
        <ChatRoomList
          query={query}
          onOpen={(tripId) => {
            setCurrentTrip(tripId);
            navigation.navigate('Chat', { tripId });
          }}
        />
      </ScrollView>
    </Screen>
  );
}
