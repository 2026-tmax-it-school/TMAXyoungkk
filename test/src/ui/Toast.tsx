import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from './Txt';
import { R, SP, surfaceC } from './tokens';

/**
 * 짧은 알림. tint는 일반, warn은 앰버. 그림자는 지도 위 요소 전용이라 쓰지 않고 테두리로 구분한다.
 * 화면 위쪽(안전 영역 아래)에 띄우고 터치를 막지 않는다. 아래쪽에 두면 탭바가 없는 화면(온보딩, 여행방 만들기,
 * 시트)에서 주 버튼을 가리고 그 버튼을 누른 손가락을 가로챘다(2026-10-09 웹 실행에서 시연 리셋 뒤 '게스트로 시작하기'를 가림).
 */
export function Toast({ text, tone = 'soft' }: { text: string; tone?: 'soft' | 'warn' }) {
  const warn = tone === 'warn';
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: SP.gutter,
        right: SP.gutter,
        top: insets.top + SP.m,
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
