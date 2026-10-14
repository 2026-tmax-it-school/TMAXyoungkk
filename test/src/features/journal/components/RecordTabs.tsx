import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';

import type { RootStackParamList } from '../../../navigation/routes';
import { Seg, type SegItem } from '../../../ui';

export type RecordTab = 'Photos' | 'Diary' | 'RecordMap';

const ITEMS: SegItem<RecordTab>[] = [
  { key: 'Photos', label: '사진', icon: 'camera' },
  { key: 'Diary', label: '일기', icon: 'book' },
  { key: 'RecordMap', label: '지도', icon: 'map', a11yLabel: '기록 지도' },
];

/**
 * 여행 기록(20 사진 · 21 일기 · 22 기록 지도) 공통 탭. 세 화면의 머리말 아래, 날짜 Seg 위에 둔다.
 * 탭을 바꾸면 화면을 바꿔 끼운다(replace). 쌓이지 않아 뒤로는 기록에 들어오기 전 화면으로 간다.
 * 보던 날짜를 그대로 넘긴다. 사진의 '전체'는 date를 넘기지 않고(undefined) 받는 화면이 처음 날짜를 고른다.
 */
export function RecordTabs({ current, tripId, date }: { current: RecordTab; tripId: string; date?: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Seg<RecordTab>
      items={ITEMS}
      value={current}
      onChange={(k) => {
        if (k !== current) navigation.replace(k, { tripId, date });
      }}
    />
  );
}
