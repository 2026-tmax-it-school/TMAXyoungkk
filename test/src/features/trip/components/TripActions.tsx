import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { View } from 'react-native';

import { homeActions, type HomeMenuCell } from '../../account/home';
import { kstDate } from '../../../core/util';
import { useNow } from '../../../services/clock';
import { usePlan } from '../../../store/trips';
import { useUi } from '../../../store/ui';
import type { Trip } from '../../../types';
import { QuickAction, Row, SP } from '../../../ui';

/**
 * 여행방 빠른 메뉴(원형 칸, 단계별). 예전 홈의 '선택한 여행방' 구역에 있던 것을 홈 카드를 누르면 가는 화면
 * (후보·시간표) 위로 옮겼다(2026-10-17 사용자 요청). 칸 목록은 features/account/home의 homeActions다.
 * - 예정: 멤버 초대, 그룹 채팅(혼자면 채팅 메모), AI 여행지 추천, 여행방 설정
 * - 진행 중: 구간 안내, 채팅, 일기 쓰기, 여행방 설정
 * - 완료: 여행일지, 채팅, 일정 공유하기, 여행방 설정
 * (여행 이름 줄 오른쪽의 채팅·멤버·설정 아이콘은 뺐다, 2026-10-17)
 * 새 여행 만들기는 여기 없다(홈 카드 줄 오른쪽 '+' 칸).
 */
export function TripActions({ trip }: { trip: Trip }) {
  const navigation = useNavigation();
  const plan = usePlan(trip.id);
  const today = kstDate(useNow());
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  const cells = homeActions(trip, plan, today);
  if (cells.length === 0) return null;

  const open = (cell: HomeMenuCell) => {
    const tripId = trip.id;
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
      case 'itineraries':
        return navigation.navigate('Itineraries');
      case 'share':
        return navigation.navigate('ShareItinerary', { tripId });
      case 'diary':
        return navigation.navigate('Journal', cell.date ? { tripId, date: cell.date } : { tripId });
      default:
        return undefined;
    }
  };

  // 칸이 5개 이상이면 오륜기처럼 위 3칸, 아래 나머지를 가운데에 두어 위 칸 사이에 엇갈려 놓는다(2026-10-17).
  // 칸 폭이 한 줄의 1/3이라 'AI 여행지 추천'·'여행방 설정'이 잘리지 않는다. 4칸 이하는 한 줄이다
  const rows = cells.length >= 5 ? [cells.slice(0, 3), cells.slice(3)] : [cells];
  const third = cells.length >= 5;
  return (
    <View style={{ paddingHorizontal: SP.gutter, gap: SP.l }}>
      {rows.map((row, i) => (
        <Row key={i} gap={third ? 0 : SP.xs} top style={third ? { justifyContent: 'center' } : undefined}>
          {row.map((c) => (
            <View key={c.key} style={third ? { width: '33.33%' } : { flex: 1 }}>
              <QuickAction icon={c.icon} label={c.label} disabled={c.disabled} onPress={() => open(c)} />
            </View>
          ))}
        </Row>
      ))}
    </View>
  );
}
