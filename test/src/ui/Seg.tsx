import React from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from './Txt';
import { lineC, SP } from './tokens';

/**
 * 목업 .seg. 켜진 항목은 잉크 글씨에 로즈 밑줄 2px, 꺼진 항목은 muted(목업 #8D7B82는 대비 미달).
 * 개수는 라벨과 같은 색이다(목업 03·06 '진행중 1', '확정 스팟 11').
 */
export function Seg<K extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: lineC.line }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.key)}
            style={{
              paddingTop: 9,
              paddingBottom: 11,
              marginRight: 20,
              marginBottom: -1,
              borderBottomWidth: 2,
              borderBottomColor: on ? lineC.accent : 'transparent',
              flexDirection: 'row',
              gap: SP.xs,
            }}
          >
            <Txt v="seg" c={on ? 'ink' : 'muted'}>
              {it.label}
            </Txt>
            {it.count != null ? (
              <Txt v="seg" c={on ? 'ink' : 'muted'}>
                {String(it.count)}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
