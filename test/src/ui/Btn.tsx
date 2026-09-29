import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, R, surfaceC, type IconColorKey, type TextColorKey } from './tokens';

export type BtnVariant = 'primary' | 'ghost' | 'quiet' | 'off';

const LOOK: Record<BtnVariant, { box: ViewStyle; text: TextColorKey; icon: IconColorKey }> = {
  primary: { box: { backgroundColor: surfaceC.accent }, text: 'onAccent', icon: 'onAccent' },
  ghost: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.accent }, text: 'accent', icon: 'accent' },
  quiet: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.line }, text: 'muted', icon: 'muted' },
  // off 글씨는 목업의 #8D7B82가 대비 미달이라 muted로 올렸다.
  off: { box: { backgroundColor: surfaceC.off }, text: 'muted', icon: 'faint' },
};

/**
 * 버튼. danger는 없다. 삭제·나가기·내보내기·계정 탈퇴는 quiet + ConfirmSheet 1회로 한다.
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

/** 34 × 34 아이콘 버튼. label은 스크린리더용이다. disabled면 누를 수 없고 아이콘이 faint가 된다. */
export function IconBtn({
  icon,
  onPress,
  label,
  color = 'muted',
  disabled,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: IconColorKey;
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
        borderWidth: 1,
        borderColor: lineC.line,
        backgroundColor: surfaceC.card,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View>
        <Icon name={icon} size={18} color={disabled ? 'faint' : color} />
      </View>
    </Pressable>
  );
}
