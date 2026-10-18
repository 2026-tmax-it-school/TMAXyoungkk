import React from 'react';
import { Pressable } from 'react-native';

import { H, Icon, R, surfaceC } from '../../../ui';

/** 알약 입력 칸 안 둥근 보내기 버튼 지름(칸 높이 48 안에서 위아래 8씩 남는다) */
const ROUND = 32;

/**
 * 05 입력줄의 전송 버튼(WP3 소유). 글자 버튼 대신 아이콘만 두고 이름은 접근성 라벨로 준다.
 * - 기본: 44 정사각 아이콘 버튼(라벨 없는 입력 칸 Field size sm과 같은 높이).
 * - round(2026-10-17 메신저형 채팅): 알약 입력 칸(Field look 'pill') 안 오른쪽 끝의 32 원, 위 화살표. 누르는 높이는 hitSlop으로 44.
 */
export function SendButton({ onPress, disabled, round }: { onPress: () => void; disabled?: boolean; round?: boolean }) {
  const size = round ? ROUND : H.fieldSm;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="보내기"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={round ? (H.touch - ROUND) / 2 : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: round ? R.chip : R.btn,
        backgroundColor: disabled ? surfaceC.off : surfaceC.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={round ? 'up' : 'nav'} size={round ? 18 : 20} color={disabled ? 'faint' : 'onAccent'} stroke={round ? 2.4 : 1.8} />
    </Pressable>
  );
}
