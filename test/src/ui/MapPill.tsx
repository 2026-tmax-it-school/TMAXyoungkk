import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { E, H, R, SP, surfaceC, type TextColorKey } from './tokens';

/** 정적 알약의 최소 높이(이름표, 레일 제목) */
const STATIC_MIN_H = 28;

/**
 * 지도 위에 떠 있는 알약(카드색, pill 라운드, E.float). 지도 탭 왼쪽 위 여행방 칩(TripBar chip), 지도 위 '길찾기',
 * 채팅방 지도 왼쪽 열의 제목과 이름표가 쓴다.
 * - onPress가 있으면 누를 수 있는 알약(높이 44 이상, role button). chevron이면 오른쪽에 아래 꺾쇠(시트가 열림)를 둔다.
 * - 없으면 정적인 작은 알약(높이 28 이상). 글자는 numberOfLines로 자르고, 폭은 style(maxWidth)로 정한다.
 * - sub는 이름 아래 보조 한 줄(muted)이다. muted면 이름도 muted로 그린다(지역을 고르기 전 이름표).
 */
export function MapPill({
  icon,
  label,
  sub,
  onPress,
  chevron,
  a11yLabel,
  style,
  numberOfLines,
  muted,
}: {
  icon?: IconName;
  label: string;
  sub?: string;
  onPress?: () => void;
  chevron?: boolean;
  a11yLabel?: string;
  style?: StyleProp<ViewStyle>;
  numberOfLines?: number;
  muted?: boolean;
}) {
  const pressable = !!onPress;
  const tone: TextColorKey = muted ? 'muted' : 'ink';
  const content = (
    <>
      {icon ? <Icon name={icon} size={pressable ? 18 : 14} color={tone} stroke={1.9} /> : null}
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Txt v={pressable ? 'btnSm' : 'chip'} c={tone} numberOfLines={numberOfLines}>
          {label}
        </Txt>
        {sub ? (
          <Txt v="mtTight" numberOfLines={numberOfLines}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {chevron ? <Icon name="down" size={14} color="muted" stroke={2.2} /> : null}
    </>
  );
  const box: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: pressable ? SP.s : SP.xs,
    minHeight: pressable ? H.touch : STATIC_MIN_H,
    paddingHorizontal: pressable ? SP.xl : SP.l,
    paddingVertical: pressable ? SP.xs : 3,
    borderRadius: R.chip,
    backgroundColor: surfaceC.card,
    ...E.float,
  };
  if (!pressable) {
    return (
      <View accessibilityLabel={a11yLabel} style={[box, style]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? (sub ? `${label}, ${sub}` : label)}
      onPress={onPress}
      style={[box, style]}
    >
      {content}
    </Pressable>
  );
}
