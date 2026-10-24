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
 * a11yLabel은 스크린리더가 읽는 이름이다. 없으면 title을 이름으로 준다(2026-10-22: 웹에서 이름이 비어 읽히지 않았다). 같은 title의 버튼이 여러 개일 때 대상을 붙여 구분한다.
 */
export function Btn({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  disabled,
  a11yLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: BtnVariant;
  size?: 'lg' | 'sm';
  icon?: IconName;
  disabled?: boolean;
  a11yLabel?: string;
}) {
  const look = LOOK[disabled ? 'off' : variant];
  const sm = size === 'sm';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? title}
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
 * 보이는 원은 40이고 hitSlop 4로 실제 누르는 넓이는 48이다(44pt 이상).
 */
const ICON_HIT_SLOP = 4;

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
      hitSlop={ICON_HIT_SLOP}
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
