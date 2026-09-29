import React from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconBtn } from './Btn';
import { Txt } from './Txt';
import { SP, surfaceC } from './tokens';

/**
 * 화면 틀. 앱 바탕은 라이트 고정이다. 390 × 844 기준, 모바일 웹 우선.
 * 바탕은 흰색(bg) 또는 카드색(card)뿐이다. 주색 전체면은 두지 않는다.
 */
export function Screen({ children, bg = 'bg' }: { children?: React.ReactNode; bg?: 'bg' | 'card' }) {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: surfaceC[bg] }}>
      {children}
    </SafeAreaView>
  );
}

/**
 * 목업 .hd. 뒤로·닫기 버튼, eyebrow, 제목(Hahmlet), 보조 줄, 오른쪽 슬롯.
 * step은 뒤로 버튼 바로 옆 왼쪽의 단계 라벨이다(목업 04 '2 / 3 단계').
 */
export function Header({
  back,
  close,
  eyebrow,
  title,
  size = 'lg',
  sub,
  step,
  right,
}: {
  back?: () => void;
  close?: () => void;
  eyebrow?: string;
  title: string;
  size?: 'lg' | 'sm';
  sub?: string;
  step?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: 14, gap: SP.xl }}>
      {back || close || right || step ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.l }}>
          {back ? <IconBtn icon="back" label="뒤로" onPress={back} /> : null}
          {step ? <Txt v="mt">{step}</Txt> : null}
          <View style={{ flex: 1 }} />
          {right}
          {close ? <IconBtn icon="x" label="닫기" onPress={close} /> : null}
        </View>
      ) : null}
      <View style={{ gap: SP.xs }}>
        {eyebrow ? <Txt v="eyebrow">{eyebrow}</Txt> : null}
        <Txt v={size === 'lg' ? 'ttl' : 'ttlSm'}>{title}</Txt>
        {sub ? <Txt v="sub">{sub}</Txt> : null}
      </View>
    </View>
  );
}

/** 목업 .body. scroll이면 스크롤, flush면 좌우 여백 없음 */
export function Body({
  scroll,
  flush,
  children,
}: {
  scroll?: boolean;
  flush?: boolean;
  children?: React.ReactNode;
}) {
  const pad: ViewStyle = { paddingHorizontal: flush ? 0 : SP.gutter, gap: SP.xl };
  if (scroll) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[pad, { paddingBottom: SP.section }]}>
        {children}
      </ScrollView>
    );
  }
  return <View style={[{ flex: 1, minHeight: 0 }, pad]}>{children}</View>;
}

/** 목업 .foot. 아래 안전 영역을 더한다. */
export function Foot({ children }: { children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: 14,
        paddingHorizontal: SP.gutter,
        paddingBottom: SP.section + insets.bottom,
        gap: 9,
        backgroundColor: surfaceC.bg,
      }}
    >
      {children}
    </View>
  );
}

export function Row({
  gap = SP.l,
  top,
  wrap,
  style,
  children,
}: {
  gap?: number;
  top?: boolean;
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: top ? 'flex-start' : 'center', gap },
        wrap ? { flexWrap: 'wrap' } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Col({
  gap = 0,
  grow,
  style,
  children,
}: {
  gap?: number;
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  return <View style={[{ gap }, grow ? { flex: 1, minWidth: 0 } : null, style]}>{children}</View>;
}
