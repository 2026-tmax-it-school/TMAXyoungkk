import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Plan, Trip } from '../../../types';
import { H, Icon, lineC, R, SP, surfaceC, Txt } from '../../../ui';
import { candidateView } from '../../candidates/rows';
import { summaryLine } from '../../candidates/summary';

/**
 * 채팅 입력줄 바로 위 후보 요약 한 줄(05). 글자는 후보 탭 머리말과 같은 summaryLine이다('후보 14곳 · 확정 11 · 제외 3').
 * 누르면 후보 탭으로 간다. 후보가 없으면 줄을 숨긴다(높이가 바뀌지 않게 메시지 위가 아니라 입력줄 위에 둔다).
 * 채팅 화면은 입력할 때마다 다시 그려지므로 요약(모든 스팟 정렬·포맷)은 여행·계획이 바뀔 때만 다시 만든다.
 */
export function CandidateBar({ trip, plan, onPress }: { trip: Trip; plan: Plan | undefined; onPress: () => void }) {
  const line = useMemo(() => summaryLine(candidateView(trip, plan)), [trip, plan]);
  if (!line) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${line}, 후보 탭에서 보기`} onPress={onPress} style={styles.bar}>
      <Icon name="list" size={16} color="muted" stroke={1.8} />
      <View style={styles.text}>
        <Txt v="mtSemi" numberOfLines={1}>
          {line}
        </Txt>
      </View>
      <Icon name="right" size={16} color="muted" stroke={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
    minHeight: H.touch,
    paddingHorizontal: SP.xl,
    borderRadius: R.field,
    borderWidth: 1,
    borderColor: lineC.line,
    backgroundColor: surfaceC.card,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});
