import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { View } from 'react-native';

import { homeActions, type HomeMenuCell } from '../../account/home';
import { kstDate } from '../../../core/util';
import { useNow } from '../../../services/clock';
import { usePlan } from '../../../store/trips';
import { useUi } from '../../../store/ui';
import type { Trip } from '../../../types';
import { QuickAction, Row, SP } from '../../../ui';

/** 접힌 상태에서 보이는 칸 수(나머지는 '더 보기'로 편다) */
export const QUICK_VISIBLE = 3;
/** 한 줄 칸 수(4열 격자). 접힌 줄은 3칸 + '더 보기', 편 줄도 같은 격자에 왼쪽부터 놓는다 */
export const QUICK_COLS = 4;

/**
 * 여행방 빠른 메뉴(원형 칸, 단계별). 홈 카드를 누르면 가는 화면(후보·시간표) 위에 있다. 칸 목록은 features/account/home의 homeActions이고
 * 칸 순서는 단계별 우선도 순이다(2026-10-17, 자세한 순서는 homeActions 주석).
 * 배치 원칙(2026-10-17 사용자 요청: 시각적 계층·근접성·일관성·점진적 공개):
 * - 시각적 계층: 첫 칸(그 단계에서 가장 먼저 할 일)만 원을 주색으로 채워 눈이 먼저 닿게 한다(primary).
 * - 점진적 공개: 처음에는 우선도 높은 3칸 + '더 보기'만 한 줄로 보인다. '더 보기'를 누르면 나머지 칸이 아래 줄에 펼쳐지고 '접기'로 바뀐다.
 * - 일관성: 늘 4열 격자(칸 폭 25%)라 칸 위치와 크기가 단계·펼침과 상관없이 같다. 칸 사이 간격은 SP 토큰(4의 배수)만 쓴다.
 * - 근접성: 메뉴 묶음과 아래 '시간표 | 후보' 나누기 사이는 화면이 여백을 둔다(같은 묶음끼리만 붙는다).
 * 칸이 4개 이하면 '더 보기' 없이 한 줄이다. 새 여행 만들기는 여기 없다(홈 카드 줄 오른쪽 '+' 칸).
 */
export function TripActions({ trip }: { trip: Trip }) {
  const navigation = useNavigation();
  const plan = usePlan(trip.id);
  const today = kstDate(useNow());
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  const [more, setMore] = useState(false);
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

  const folds = cells.length > QUICK_COLS;
  const first = folds ? cells.slice(0, QUICK_VISIBLE) : cells;
  const rest = folds ? cells.slice(QUICK_VISIBLE) : [];
  const cell = (c: HomeMenuCell, i: number) => (
    <View key={c.key} style={{ width: `${100 / QUICK_COLS}%` }}>
      <QuickAction icon={c.icon} label={c.label} disabled={c.disabled} primary={i === 0} onPress={() => open(c)} />
    </View>
  );
  return (
    <View style={{ paddingHorizontal: SP.gutter, gap: SP.l }}>
      <Row gap={0} top>
        {first.map((c, i) => cell(c, i))}
        {folds ? (
          <View style={{ width: `${100 / QUICK_COLS}%` }}>
            <QuickAction icon={more ? 'up' : 'dots'} label={more ? '접기' : '더 보기'} onPress={() => setMore((v) => !v)} />
          </View>
        ) : null}
      </Row>
      {folds && more ? (
        <Row gap={0} top>
          {rest.map((c) => cell(c, -1))}
        </Row>
      ) : null}
    </View>
  );
}
