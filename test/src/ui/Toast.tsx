import React from 'react';
import { View } from 'react-native';

import { Txt } from './Txt';
import { R, SP, surfaceC } from './tokens';

/** 짧은 알림. tint는 일반, warn은 앰버. 그림자는 지도 위 요소 전용이라 쓰지 않고 테두리로 구분한다. */
export function Toast({ text, tone = 'soft' }: { text: string; tone?: 'soft' | 'warn' }) {
  const warn = tone === 'warn';
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
          position: 'absolute',
          left: SP.gutter,
          right: SP.gutter,
          bottom: 96,
          paddingVertical: SP.l,
          paddingHorizontal: 14,
          borderRadius: R.card,
          borderWidth: 1,
          borderColor: warn ? surfaceC.warnLine : surfaceC.softLine,
          backgroundColor: warn ? surfaceC.warnBg : surfaceC.soft,
      }}
    >
      <Txt v="mt" c={warn ? 'warn' : 'accentStrong'}>
        {text}
      </Txt>
    </View>
  );
}
