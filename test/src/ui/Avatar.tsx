import React from 'react';
import { View, type ViewStyle } from 'react-native';

import { Txt } from './Txt';
import { H, lineC, SP, surfaceC, type TextColorKey } from './tokens';

/** 순서별 아바타 면. 첫 번째는 주색(연두), 그다음 앰버·초록, 넷째부터 흰 바탕에 muted 글자 */
const LOOK: { bg: string; border: string; text: TextColorKey }[] = [
  { bg: surfaceC.accent, border: surfaceC.bg, text: 'onAccent' },
  { bg: surfaceC.amber, border: surfaceC.bg, text: 'onAccent' },
  { bg: surfaceC.moss, border: surfaceC.bg, text: 'onAccent' },
  { bg: surfaceC.card, border: lineC.line, text: 'muted' },
];

/** size 'md'(기본 27)는 목록·겹친 줄, 'lg'(44)는 채팅방 지도 왼쪽 열 프로필이다 */
export function Avatar({
  name,
  index,
  style,
  size = 'md',
}: {
  name: string;
  index: number;
  style?: ViewStyle;
  size?: 'md' | 'lg';
}) {
  const look = LOOK[Math.min(index, LOOK.length - 1)];
  const d = size === 'lg' ? H.avatarLg : H.avatar;
  return (
    <View
      accessibilityLabel={name}
      style={[
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          borderWidth: H.avatarBorder,
          borderColor: look.border,
          backgroundColor: look.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Txt v={size === 'lg' ? 'nm' : 'chip'} c={look.text}>
        {name.slice(0, 1)}
      </Txt>
    </View>
  );
}

/**
 * 겹친 아바타 줄(겹침 -8). max를 넘으면 앞 max명만 그리고 뒤에 '+{남은 수}'를 붙인다.
 * 스크린리더는 줄 전체를 '이름, 이름 외 N명'으로 읽는다.
 */
export function AvatarStack({ names, max }: { names: string[]; max?: number }) {
  const shown = max != null && names.length > max ? names.slice(0, Math.max(0, max)) : names;
  const rest = names.length - shown.length;
  const label = rest > 0 ? `${shown.join(', ')} 외 ${rest}명` : names.join(', ');
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} index={i} style={i > 0 ? { marginLeft: H.avatarOverlap } : undefined} />
      ))}
      {rest > 0 ? (
        <View style={{ marginLeft: SP.xs }}>
          <Txt v="chip" c="muted">{`+${rest}`}</Txt>
        </View>
      ) : null}
    </View>
  );
}
