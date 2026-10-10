import React from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { lineC, SP } from './tokens';

/**
 * 카테고리 탭(DS CategoryTabs). 하나만 고르는 거르기(여행 상태, 확정/제외, 날짜).
 * icon이 있으면 아이콘 위·라벨 아래, 없으면 글자만. 켜진 칸만 잉크 글자와 잉크 밑줄 2px, 꺼진 칸은 muted.
 * 줄 아래에 1px line. 개수는 라벨 뒤 muted. 칸이 많은 시간표는 화면이 가로 스크롤로 감싼다.
 */
export function Seg<K extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: K; label: string; count?: number; icon?: IconName }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: SP.section - 4, borderBottomWidth: 1, borderBottomColor: lineC.line }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.key)}
            style={{
              alignItems: 'center',
              gap: SP.s,
              paddingTop: SP.m,
              paddingBottom: SP.l,
              marginBottom: -1,
              borderBottomWidth: 2,
              borderBottomColor: on ? lineC.ink : 'transparent',
            }}
          >
            {it.icon ? <Icon name={it.icon} size={24} color={on ? 'ink' : 'muted'} stroke={on ? 2 : 1.6} /> : null}
            <View style={{ flexDirection: 'row', gap: SP.xs }}>
              <Txt v={it.icon ? 'cat' : 'seg'} c={on ? 'ink' : 'muted'}>
                {it.label}
              </Txt>
              {it.count != null ? (
                <Txt v={it.icon ? 'cat' : 'seg'} c="muted">
                  {String(it.count)}
                </Txt>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
