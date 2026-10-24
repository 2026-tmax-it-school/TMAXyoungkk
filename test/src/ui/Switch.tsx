import React from 'react';
import { Pressable, View } from 'react-native';

import { H, lineC, R, surfaceC } from './tokens';

/** 손잡이와 트랙 가장자리 사이 */
const KNOB_GAP = 3;
const KNOB = H.switchH - KNOB_GAP * 2;

/**
 * 켜고 끄는 스위치(44 × 26). 켜짐은 brand 트랙, 꺼짐은 line-strong 트랙, 손잡이는 카드색(흰색).
 * 세 색은 서로, 그리고 카드 위에서 3:1 이상이다(foundation-contrast NON_TEXT_PAIRS).
 * onValueChange가 있으면 스스로 누를 수 있는 스위치(role switch, checked)이고,
 * 없으면 그림만 그린다(ListRow switch처럼 줄 전체가 토글일 때. 그때 접근성은 줄이 맡는다).
 * 누르는 넓이는 hitSlop으로 44를 넘긴다.
 */
export function Switch({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: boolean;
  onValueChange?: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  const track = (
    <View
      style={{
        width: H.switchW,
        height: H.switchH,
        borderRadius: R.chip,
        padding: KNOB_GAP,
        justifyContent: 'center',
        alignItems: value ? 'flex-end' : 'flex-start',
        backgroundColor: value ? surfaceC.accent : lineC.strong,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ width: KNOB, height: KNOB, borderRadius: R.chip, backgroundColor: surfaceC.card }} />
    </View>
  );
  if (!onValueChange) {
    return (
      <View aria-hidden>
        {track}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      hitSlop={{ top: (H.touch - H.switchH) / 2, bottom: (H.touch - H.switchH) / 2, left: 4, right: 4 }}
    >
      {track}
    </Pressable>
  );
}
