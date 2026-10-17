import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { H, Icon, lineC, R, SP, surfaceC, Txt } from '../../../ui';

/** 보이는 높이는 36이고 위아래 hitSlop으로 누르는 높이 44를 맞춘다 */
const SLOP = (H.touch - H.btnSm) / 2;

/**
 * 장소 하나에 내 한 표를 켜고 끄는 토글(채팅방 지도, FR-405). 체크박스 역할이다.
 * - 꺼짐: 카드 면에 선 테두리, '투표'
 * - 켜짐: soft 면에 잉크 2px 테두리, check 아이콘과 '투표함'
 * - 못 누를 때(멤버가 아님, 여행이 끝남)도 켜짐·꺼짐 모양은 그대로 두고(끝난 여행에서 내가 고른 곳이 보이게),
 *   글자·아이콘을 muted로, 테두리를 옅게 해서 누를 수 없음을 보인다. 읽는 상태(checked)와 보이는 모양이 같다.
 */
export function VoteToggle({
  name,
  on,
  disabled,
  onPress,
}: {
  name: string;
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const tone = disabled ? 'muted' : 'ink';
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${name} 투표`}
      accessibilityState={{ checked: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: SLOP, bottom: SLOP, left: SP.xs, right: SP.xs }}
      style={[styles.box, on ? styles.on : styles.off, disabled ? (on ? styles.onOff : styles.offOff) : null]}
    >
      {on ? <Icon name="check" size={14} color={tone} stroke={2.4} /> : null}
      <Txt v="btnSm" c={tone}>
        {on ? '투표함' : '투표'}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: H.btnSm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.xl,
    borderRadius: R.chip,
  },
  off: {
    backgroundColor: surfaceC.card,
    borderWidth: 1,
    borderColor: lineC.strong,
  },
  on: {
    backgroundColor: surfaceC.soft,
    borderWidth: 2,
    borderColor: lineC.ink,
    paddingHorizontal: SP.xl - 1,
  },
  /** 켜짐인데 누를 수 없음: 잉크 대신 진한 선 */
  onOff: {
    borderColor: lineC.strong,
  },
  /** 꺼짐인데 누를 수 없음: 옅은 선 */
  offOff: {
    borderColor: lineC.line,
  },
});
