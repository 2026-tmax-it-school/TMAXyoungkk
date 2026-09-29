import React from 'react';
import { Pressable } from 'react-native';

import { H, Icon, R, surfaceC } from '../../../ui';

/**
 * 05 입력줄의 전송 버튼(WP3 소유). 목업의 44 정사각 아이콘 버튼이고, 라벨 없는 입력 칸(Field size sm)과 같은 높이(H.fieldSm)다.
 * 글자 버튼 대신 아이콘만 두고 이름은 접근성 라벨로 준다.
 */
export function SendButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="보내기"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: H.fieldSm,
        height: H.fieldSm,
        borderRadius: R.btn,
        backgroundColor: disabled ? surfaceC.off : surfaceC.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="nav" size={20} color={disabled ? 'faint' : 'onAccent'} stroke={1.8} />
    </Pressable>
  );
}
