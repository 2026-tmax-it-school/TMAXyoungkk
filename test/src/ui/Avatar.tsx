import React from 'react';
import { View, type ViewStyle } from 'react-native';

import { Txt } from './Txt';
import { avatarLook, H, SP } from './tokens';

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
  // 순서별 면(tokens AVATAR_LOOK). 채팅방 지도 핀의 프로필도 같은 값이다
  const look = avatarLook(index);
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
