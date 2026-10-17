import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTrips } from '../store/trips';
import { SP, surfaceC, Txt } from '../ui';

export const OFFLINE_TEXT = '오프라인 · 연결되면 보내요';

/**
 * 오프라인 안내 한 줄(앱 전체에 하나, App.tsx). 오프라인일 때만 화면 맨 위 안전 영역 아래에 얇게 보인다.
 * 화면마다 두던 일반 오프라인 Notice를 대신한다(화면에는 할 일이 바뀌는 안내만 남긴다).
 * 누를 수 없고 터치를 막지 않는다(pointerEvents는 StyleSheet로 준다. 웹 RNW 0.21이 인라인 값을 버린다).
 * 화면 흐름 안에 두어 아래 화면이 밀려 내려간다(머리말의 뒤로 버튼을 가리지 않는다).
 */
export function OfflineBar() {
  const online = useTrips((s) => s.online);
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.bar, { paddingTop: insets.top + SP.xs }]}>
      <Txt v="mtTight" c="warn" numberOfLines={1}>
        {OFFLINE_TEXT}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    pointerEvents: 'none',
    paddingBottom: SP.xs,
    paddingHorizontal: SP.gutter,
    alignItems: 'center',
    backgroundColor: surfaceC.warnBg,
    borderBottomWidth: 1,
    borderBottomColor: surfaceC.warnLine,
  },
});
