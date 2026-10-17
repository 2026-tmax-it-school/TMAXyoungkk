import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { View } from 'react-native';

import { Seg, SP } from '../../../ui';

export type PlanSwitchValue = 'Schedule' | 'Candidates';

/**
 * 일정 탭 위 '시간표 | 후보 N' 나누기. 후보는 하단 탭 칸이 없고 여기서 오간다.
 * 두 화면 모두 탭 라우트라 navigate로 바꾸면 화면이 쌓이지 않는다(뒤로가 이 나누기를 되감지 않는다).
 * 후보 수는 스크린리더에 '후보 14곳'으로 읽힌다(순번으로 읽히지 않게).
 */
export function PlanSwitch({ value, candidates }: { value: PlanSwitchValue; candidates: number }) {
  const navigation = useNavigation();
  return (
    <View style={{ paddingHorizontal: SP.gutter }}>
      <Seg<PlanSwitchValue>
        items={[
          { key: 'Schedule', label: '시간표' },
          { key: 'Candidates', label: '후보', count: candidates, a11yLabel: `후보 ${candidates}곳` },
        ]}
        value={value}
        onChange={(k) => {
          if (k !== value) navigation.navigate('Main', { screen: k });
        }}
      />
    </View>
  );
}
