import React from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { E, lineC, R, SP, surfaceC } from './tokens';

/**
 * 카테고리 알약(숙박 앱 홈의 '전체·숙소·체험' 줄). 켜진 항목은 연회색 면에 잉크 글씨, 꺼진 항목은 흰 면에
 * 옅은 그림자. 개수는 라벨 옆에 같은 색으로 붙는다('진행중 1').
 * 넘치면 다음 줄로 내린다(날짜가 많은 시간표는 화면이 가로 스크롤로 감싼다).
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
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingVertical: SP.xs, gap: SP.m }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.key)}
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP.s,
                height: 40,
                paddingHorizontal: SP.xl + 1,
                borderRadius: R.chip,
                borderWidth: 1,
              },
              on
                ? { backgroundColor: surfaceC.soft, borderColor: lineC.faint }
                : { backgroundColor: surfaceC.card, borderColor: lineC.line, ...E.pill },
            ]}
          >
            {it.icon ? <Icon name={it.icon} size={15} color={on ? 'ink' : 'muted'} /> : null}
            <Txt v="seg" c={on ? 'ink' : 'muted'}>
              {it.label}
            </Txt>
            {it.count != null ? (
              <View style={{ minWidth: 20, paddingHorizontal: 6, borderRadius: R.chip, backgroundColor: on ? surfaceC.ink : surfaceC.soft }}>
                <Txt v="chip" c={on ? 'onInk' : 'muted'} center>
                  {String(it.count)}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
