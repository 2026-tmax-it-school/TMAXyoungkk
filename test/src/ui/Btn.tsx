import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, R, surfaceC, type IconColorKey, type TextColorKey } from './tokens';

export type BtnVariant = 'primary' | 'ghost' | 'quiet' | 'off';

const LOOK: Record<BtnVariant, { box: ViewStyle; text: TextColorKey; icon: IconColorKey }> = {
  primary: { box: { backgroundColor: surfaceC.accent }, text: 'onAccent', icon: 'onAccent' },
  ghost: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.ink }, text: 'ink', icon: 'ink' },
  quiet: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.line }, text: 'ink', icon: 'muted' },
  // off 글씨는 목업의 #8D7B82가 대비 미달이라 muted로 올렸다.
  off: { box: { backgroundColor: surfaceC.off }, text: 'muted', icon: 'faint' },
};

/**
 * 버튼(DS Button). primary는 brand 면, 화면당 하나. ghost는 DS secondary(잉크 1px 테두리).
 * quiet는 회색 선의 보조 버튼. 높이 48/36, 라운드 12/8. danger는 없다. 삭제·나가기·내보내기·계정 탈퇴는 quiet + ConfirmSheet 1회로 한다.
 * disabled면 off 모양이 된다.
 */
export function Btn({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: BtnVariant;
  size?: 'lg' | 'sm';
  icon?: IconName;
  disabled?: boolean;
}) {
  const look = LOOK[disabled ? 'off' : variant];
  const sm = size === 'sm';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          height: sm ? H.btnSm : H.btn,
          borderRadius: sm ? R.btnSm : R.btn,
          paddingHorizontal: sm ? 14 : 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
        },
        look.box,
      ]}
    >
      {icon ? <Icon name={icon} size={sm ? 16 : 18} color={look.icon} /> : null}
      <Txt v={sm ? 'btnSm' : 'btn'} c={look.text}>
        {title}
      </Txt>
    </Pressable>
  );
}

/**
 * 40 × 40 원형 아이콘 버튼(DS IconButton). label은 스크린리더용이다. disabled면 누를 수 없고 아이콘이 faint가 된다.
 * plain(기본): 머리말 뒤로·닫기, soft: 연회색 원(탭 첫 화면 오른쪽 위).
 */
export function IconBtn({
  icon,
  onPress,
  label,
  color = 'ink',
  variant = 'plain',
  disabled,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: IconColorKey;
  variant?: 'plain' | 'soft';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: H.iconBtn,
        height: H.iconBtn,
        borderRadius: R.iconBtn,
        backgroundColor: variant === 'soft' ? surfaceC.soft : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View>
        <Icon name={icon} size={22} color={disabled ? 'faint' : color} stroke={1.9} />
      </View>
    </Pressable>
  );
}
