import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, surfaceC } from './tokens';

/**
 * 하단 탭(홈/후보/시간표/지도/프로필 고정). 켜진 탭은 아이콘·라벨 모두 주색(연두), 꺼진 탭은 muted.
 * 네비게이터와 무관한 표시 컴포넌트다. src/navigation이 react-navigation 탭에 연결한다.
 */
export function TabBar<K extends string>({
  items,
  active,
  onPress,
}: {
  items: { key: K; label: string; icon: IconName }[];
  active: K;
  onPress: (key: K) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        height: H.tabBar + insets.bottom,
        paddingTop: 10,
        paddingHorizontal: 12,
        paddingBottom: insets.bottom,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderTopWidth: 1,
        borderTopColor: lineC.line,
        backgroundColor: surfaceC.card,
      }}
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            onPress={() => onPress(it.key)}
            style={{ flex: 1, alignItems: 'center', gap: 5 }}
          >
            <Icon name={it.icon} size={25} color={on ? 'accent' : 'muted'} stroke={on ? 2 : 1.6} />
            <Txt v="tab" c={on ? 'accent' : 'muted'}>
              {it.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
