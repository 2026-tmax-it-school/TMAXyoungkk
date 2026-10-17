import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC } from './tokens';

export interface SegItem<K extends string> {
  key: K;
  label: string;
  count?: number;
  icon?: IconName;
  /** 스크린리더 이름. 숫자 라벨이 순번으로 읽히지 않게 쓴다('10월 18일 토요일, 사진 3장', '후보 14곳') */
  a11yLabel?: string;
}

/** compact 칸의 보이는 높이는 36이고, 위아래를 더해 누르는 높이 44를 맞춘다 */
const COMPACT_SLOP = (H.touch - H.btnSm) / 2;

/**
 * 카테고리 탭(DS CategoryTabs). 하나만 고르는 거르기(여행 상태, 확정/제외, 날짜).
 * icon이 있으면 아이콘 위·라벨 아래, 없으면 글자만. 켜진 칸만 잉크 글자와 잉크 밑줄 2px, 꺼진 칸은 muted.
 * 줄 아래에 1px line. 개수는 라벨 뒤 muted.
 * 기본은 스스로 가로 ScrollView로 감싼다. 칸이 많으면(날짜) 가로로 밀고, 고른 칸이 바뀌면 그 칸(과 앞 칸)이 보이게 민다.
 * 화면이 바깥에 ScrollView를 따로 두지 않는다.
 * compact: 머리말 오른쪽 슬롯용 작은 나누기('채팅 | 지도'). 스크롤 없이 내용 폭만큼이고 높이 36(누르는 높이 44)이다.
 * 연회색 바탕 안에서 고른 칸만 흰 면과 선 테두리다(그림자 없음).
 */
export function Seg<K extends string>({
  items,
  value,
  onChange,
  compact,
}: {
  items: SegItem<K>[];
  value: K;
  onChange: (key: K) => void;
  compact?: boolean;
}) {
  if (compact) return <CompactSeg items={items} value={value} onChange={onChange} />;
  return <ScrollSeg items={items} value={value} onChange={onChange} />;
}

function ScrollSeg<K extends string>({
  items,
  value,
  onChange,
}: {
  items: SegItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const scroller = useRef<ScrollView>(null);
  const xs = useRef<Partial<Record<string, number>>>({});
  const keys = items.map((it) => it.key);
  const keySig = keys.join('|');
  const reveal = (animated: boolean) => {
    const i = keys.indexOf(value);
    if (i < 0) return;
    // 고른 칸 바로 앞 칸이 왼쪽 끝에 오게 민다(첫 칸이면 0)
    const prev = i > 0 ? xs.current[keys[i - 1]] : 0;
    if (prev == null) return;
    scroller.current?.scrollTo({ x: Math.max(0, prev), animated });
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    revealRef.current(true);
  }, [value, keySig]);
  return (
    <View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: lineC.line }}
      />
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        contentContainerStyle={{ flexDirection: 'row', gap: SP.section - 4 }}
      >
        {items.map((it) => {
          const on = it.key === value;
          return (
            <Pressable
              key={it.key}
              accessibilityRole="tab"
              accessibilityLabel={it.a11yLabel}
              accessibilityState={{ selected: on }}
              onPress={() => onChange(it.key)}
              onLayout={(e) => {
                xs.current[it.key] = e.nativeEvent.layout.x;
                if (on) revealRef.current(false);
              }}
              style={{
                alignItems: 'center',
                gap: SP.s,
                paddingTop: SP.m,
                paddingBottom: SP.l,
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
      </ScrollView>
    </View>
  );
}

function CompactSeg<K extends string>({
  items,
  value,
  onChange,
}: {
  items: SegItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        alignSelf: 'center',
        height: H.btnSm,
        padding: 3,
        borderRadius: R.btnSm,
        backgroundColor: surfaceC.soft,
      }}
    >
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityLabel={it.a11yLabel}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.key)}
            hitSlop={{ top: COMPACT_SLOP + 3, bottom: COMPACT_SLOP + 3 }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP.xs,
              paddingHorizontal: SP.l,
              borderRadius: R.btnSm - 2,
              borderWidth: 1,
              borderColor: on ? lineC.line : 'transparent',
              backgroundColor: on ? surfaceC.card : 'transparent',
            }}
          >
            {it.icon ? <Icon name={it.icon} size={16} color={on ? 'ink' : 'muted'} stroke={on ? 2 : 1.6} /> : null}
            <Txt v="btnSm" c={on ? 'ink' : 'muted'}>
              {it.label}
            </Txt>
            {it.count != null ? (
              <Txt v="btnSm" c="muted">
                {String(it.count)}
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
