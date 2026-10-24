import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from './Txt';
import { H, R, SP, surfaceC } from './tokens';

/**
 * 짧은 알림. tint는 일반, warn은 앰버. 그림자는 지도 위 요소 전용이라 쓰지 않고 테두리로 구분한다.
 * 토스트는 한 문장(~요)이다. 설명이 필요하면 화면 Notice로 둔다.
 * 화면 위쪽(안전 영역 아래)에 띄우고 터치를 막지 않는다. 아래쪽에 두면 탭바가 없는 화면(온보딩, 여행방 만들기,
 * 시트)에서 주 버튼을 가리고 그 버튼을 누른 손가락을 가로챘다(2026-10-09 웹 실행에서 시연 리셋 뒤 '게스트로 시작하기'를 가림).
 * 위쪽이라도 머리줄(뒤로 버튼·방 이름, 높이 약 52) 아래에 띄운다(2026-10-22 셀프 QA: 맨 위에 떠서 뒤로 버튼과 방 이름을 가렸다).
 * 위치와 pointerEvents는 StyleSheet로 준다. react-native-web 0.21은 인라인 style의 pointerEvents를 버려서
 * 웹에서 토스트가 아래 버튼의 누름을 가로챘다.
 */
export function Toast({ text, tone = 'soft' }: { text: string; tone?: 'soft' | 'warn' }) {
  const warn = tone === 'warn';
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          top: insets.top + H.iconBtn + SP.xxl,
          borderColor: warn ? surfaceC.warnLine : surfaceC.softLine,
          backgroundColor: warn ? surfaceC.warnBg : surfaceC.soft,
        },
      ]}
    >
      <Txt v="mt" c={warn ? 'warn' : 'accentStrong'}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    pointerEvents: 'none',
    position: 'absolute',
    left: SP.gutter,
    right: SP.gutter,
    paddingVertical: SP.l,
    paddingHorizontal: 14,
    borderRadius: R.card,
    borderWidth: 1,
  },
});
