import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { areaChipLabel, type ChatArea } from '../../../core/chatmap/areas';
import { H, lineC, R, SP, surfaceC, Txt } from '../../../ui';

/** 칩은 보이는 높이 36(ui Tag와 같은 모양)이고 위아래 hitSlop으로 누르는 높이 44를 맞춘다(줄 위아래 여백 8 안) */
const SLOP = (H.touch - H.btnSm) / 2;

/**
 * 채팅방 지도의 지역 칩 줄(FR-405). 칩 글자는 '{지역} {n}명'(n은 그곳 장소를 말한 활성 멤버 수)이고 '기타'가 마지막이다.
 * 채팅·지도 어느 쪽에서 눌러도 지도로 바뀌고 그 지역을 고른다. 고른 칩을 다시 누르면 풀린다. 지역이 없으면 줄을 숨긴다.
 * selected는 화면이 지금 지역 목록에서 찾은 키다(사라진 키면 null).
 */
export function AreaChips({
  areas,
  selected,
  onPick,
}: {
  areas: readonly ChatArea[];
  selected: string | null;
  onPick: (key: string) => void;
}) {
  if (areas.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {areas.map((a) => (
        <AreaChip key={a.key} label={areaChipLabel(a)} on={a.key === selected} onPress={() => onPick(a.key)} />
      ))}
    </ScrollView>
  );
}

function AreaChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      hitSlop={{ top: SLOP, bottom: SLOP }}
      style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
    >
      <Txt v="btnSm" c="ink">
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexGrow: 0,
  },
  content: {
    gap: SP.m,
    paddingHorizontal: SP.gutter,
    paddingVertical: SP.m,
  },
  chip: {
    height: H.btnSm,
    justifyContent: 'center',
    borderRadius: R.chip,
  },
  chipOff: {
    paddingHorizontal: SP.xxl,
    borderWidth: 1,
    borderColor: lineC.strong,
    backgroundColor: surfaceC.card,
  },
  chipOn: {
    paddingHorizontal: SP.xxl - 1,
    borderWidth: 2,
    borderColor: lineC.ink,
    backgroundColor: surfaceC.soft,
  },
});
