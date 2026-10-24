import React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { TourTarget } from './TourTarget';
import { Txt } from './Txt';
import { RAIL_W, useLayout } from './responsive';
import { H, lineC, R, SP, surfaceC } from './tokens';

/**
 * 하단 탭 다섯 칸. 아이콘 아래 짧은 글자를 둔다(2026-10-22: 아이콘만으로는 칸이 무엇인지 몰랐다. 2026-10-17에는 아이콘만이었다).
 * 글자는 short(없으면 label), 스크린 리더 이름은 label이다. 켜진 탭은 주색(연두), 꺼진 탭은 muted.
 * 네비게이터와 무관한 표시 컴포넌트다. src/navigation이 react-navigation 탭에 연결한다.
 */
export function TabBar<K extends string>({
  items,
  active,
  onPress,
}: {
  items: { key: K; label: string; short?: string; icon: IconName }[];
  active: K;
  onPress: (key: K) => void;
}) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const { width } = useWindowDimensions();
  // 컴퓨터 폭(ui/responsive): 왼쪽 세로 메뉴. 칸마다 아이콘 + 글자 한 줄, 켜진 칸은 연한 면
  if (layout.rail) {
    return (
      <View
        accessibilityRole="tablist"
        style={{
          width: RAIL_W,
          paddingTop: insets.top + SP.xxl,
          paddingHorizontal: SP.l,
          gap: SP.xs,
          borderRightWidth: 1,
          borderRightColor: lineC.line,
          backgroundColor: surfaceC.card,
        }}
      >
        <View style={{ paddingHorizontal: SP.l, paddingBottom: SP.xl }}>
          <Txt v="ttlSm">Young Trip</Txt>
        </View>
        {items.map((it) => {
          const on = it.key === active;
          return (
            <TourTarget key={it.key} id={`tab-${it.key}`}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={it.label}
              onPress={() => onPress(it.key)}
              style={{
                minHeight: H.btn,
                paddingHorizontal: SP.l,
                borderRadius: R.btn,
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP.l,
                backgroundColor: on ? surfaceC.soft : 'transparent',
              }}
            >
              <Icon name={it.icon} size={22} color={on ? 'accent' : 'muted'} stroke={on ? 2 : 1.6} />
              <Txt v="btnSm" c={on ? 'accentStrong' : 'ink'} numberOfLines={1}>
                {it.label}
              </Txt>
            </Pressable>
            </TourTarget>
          );
        })}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="tablist"
      style={{
        height: H.tabBar + insets.bottom,
        // 태블릿 폭이면 칸들이 본문과 같은 가운데 폭에 모인다(양옆으로 흩어지지 않게)
        paddingHorizontal: layout.contentMax ? Math.max(12, (width - layout.contentMax) / 2) : 12,
        paddingBottom: insets.bottom,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'stretch',
        borderTopWidth: 1,
        borderTopColor: lineC.line,
        backgroundColor: surfaceC.card,
      }}
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <TourTarget key={it.key} id={`tab-${it.key}`} style={{ flex: 1 }}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={it.label}
              onPress={() => onPress(it.key)}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}
            >
              <Icon name={it.icon} size={23} color={on ? 'accent' : 'muted'} stroke={on ? 2 : 1.6} />
              <Txt v="tab" c={on ? 'accent' : 'muted'} numberOfLines={1}>
                {it.short ?? it.label}
              </Txt>
            </Pressable>
          </TourTarget>
        );
      })}
    </View>
  );
}
