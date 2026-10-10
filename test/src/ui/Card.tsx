import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { lineC, R, SP, surfaceC } from './tokens';

export type CardVariant = 'default' | 'tinted' | 'flat' | 'excluded' | 'warn' | 'selected';

const VARIANT: Record<CardVariant, ViewStyle> = {
  default: { backgroundColor: surfaceC.card, borderColor: lineC.line, borderWidth: 1 },
  tinted: { backgroundColor: surfaceC.soft, borderColor: surfaceC.softLine, borderWidth: 1 },
  flat: { backgroundColor: 'transparent', borderWidth: 0, padding: 0 },
  excluded: { backgroundColor: surfaceC.excludedBg, borderColor: surfaceC.excludedLine, borderWidth: 1 },
  warn: { backgroundColor: surfaceC.warnBg, borderColor: surfaceC.warnLine, borderWidth: 1 },
  selected: { backgroundColor: surfaceC.card, borderColor: lineC.ink, borderWidth: 2 },
};

/** 카드(DS). 라운드 12, 패딩 16, 1px line, 그림자 없음. 선택은 잉크 2px 테두리. 왼쪽 컬러 보더 없음 */
export function Card({
  variant = 'default',
  onPress,
  style,
  children,
}: {
  variant?: CardVariant;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const base: ViewStyle = { borderRadius: R.card, padding: SP.cardPad, gap: SP.l, ...VARIANT[variant] };
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={[base, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}
