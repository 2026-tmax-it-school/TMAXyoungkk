import React from 'react';
import { View, type ViewStyle } from 'react-native';

import { Txt } from './Txt';
import { H, lineC, surfaceC, type TextColorKey } from './tokens';

/** 순서별 아바타 면. 첫 번째는 로즈, 그다음 앰버·초록, 넷째부터 흰 바탕에 muted 글자 */
const LOOK: { bg: string; border: string; text: TextColorKey }[] = [
  { bg: surfaceC.accent, border: surfaceC.bg, text: 'onAccent' },
  { bg: surfaceC.amber, border: surfaceC.bg, text: 'onAccent' },
  { bg: surfaceC.moss, border: surfaceC.bg, text: 'onAccent' },
  { bg: surfaceC.card, border: lineC.line, text: 'muted' },
];

export function Avatar({ name, index, style }: { name: string; index: number; style?: ViewStyle }) {
  const look = LOOK[Math.min(index, LOOK.length - 1)];
  return (
    <View
      accessibilityLabel={name}
      style={[
        {
          width: H.avatar,
          height: H.avatar,
          borderRadius: H.avatar / 2,
          borderWidth: H.avatarBorder,
          borderColor: look.border,
          backgroundColor: look.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Txt v="chip" c={look.text}>
        {name.slice(0, 1)}
      </Txt>
    </View>
  );
}

/** 겹친 아바타 줄(겹침 -8) */
export function AvatarStack({ names }: { names: string[] }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {names.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} index={i} style={i > 0 ? { marginLeft: H.avatarOverlap } : undefined} />
      ))}
    </View>
  );
}
