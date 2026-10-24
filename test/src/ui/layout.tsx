import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconBtn } from './Btn';
import { Icon } from './Icon';
import { KeyboardAvoid, useBottomInset } from './KeyboardAvoid';
import { Txt } from './Txt';
import { useLayout } from './responsive';
import { H, lineC, SP, surfaceC } from './tokens';

/**
 * 화면 틀. 앱 바탕은 라이트 고정이다. 390 × 844 기준, 모바일 웹 우선.
 * 바탕은 흰색(bg) 또는 카드색(card)뿐이다. 주색 전체면은 두지 않는다.
 * keyboard: 입력 칸이 있는 화면. 내용(Body·Foot)을 KeyboardAvoidingView로 감싸 키보드가 Foot과 입력 칸을 가리지 않게 한다
 * (iOS·안드로이드는 KeyboardAvoid가 키보드 높이만큼 띄우고, 웹은 키보드가 창을 줄인다).
 * 아래 안전 영역(홈 표시줄·안드로이드 내비게이션 바)은 셋 중 하나가 맡는다: Foot이 있으면 Foot, 탭 화면이면 탭 바,
 * 둘 다 없으면 Body(scroll)의 끝 여백. 그래서 Foot이 Screen에 자기가 있다고 알린다(FootCtx).
 */
const FootCtx = createContext<{ register: () => () => void; hasFoot: boolean } | null>(null);

export function Screen({
  children,
  bg = 'bg',
  keyboard,
  wide,
}: {
  children?: React.ReactNode;
  bg?: 'bg' | 'card';
  keyboard?: boolean;
  /** 넓은 화면에서 본문 칸 폭을 이 값으로 넓힌다(홈 컴퓨터 화면의 두 단 배치 등). 폰에서는 쓰지 않는다 */
  wide?: number;
}) {
  const [feet, setFeet] = useState(0);
  const register = useCallback(() => {
    setFeet((n) => n + 1);
    return () => setFeet((n) => n - 1);
  }, []);
  const foot = useMemo(() => ({ register, hasFoot: feet > 0 }), [register, feet]);
  const layout = useLayout();
  const topInset = useSafeAreaInsets().top;
  return (
    <FootCtx.Provider value={foot}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: surfaceC[bg] }}>
        {/* 넓은 화면(ui/responsive): 본문은 가운데 칸(태블릿 640, 컴퓨터 720)에 둔다. 폰은 화면 폭 그대로 */}
        <View
          style={[
            { flex: 1, width: '100%' },
            layout.contentMax ? { maxWidth: wide ?? layout.contentMax, alignSelf: 'center', borderWidth: 1, borderTopWidth: 0, borderBottomWidth: 0, borderColor: lineC.line } : null,
          ]}
        >
          {keyboard ? <KeyboardAvoid offset={topInset}>{children}</KeyboardAvoid> : children}
        </View>
      </SafeAreaView>
    </FootCtx.Provider>
  );
}

/** 머리말 오른쪽 슬롯. 여러 노드(작은 Seg, 아이콘 버튼)를 한 줄로 받는다 */
function HeaderRight({ children }: { children?: React.ReactNode }) {
  if (children == null || children === false) return null;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>{children}</View>;
}

/**
 * 목업 .hd. 뒤로·닫기 버튼, eyebrow, 제목(Hahmlet), 보조 줄, 오른쪽 슬롯.
 * step은 뒤로 버튼 바로 옆 왼쪽의 단계 라벨이다(목업 04 '2 / 3 단계').
 * 제목은 accessibilityRole header로 감싸 스크린리더가 화면 제목으로 읽는다.
 * size 'row': 한 줄 머리말(채팅·일정 편집·길찾기). 뒤로 버튼, 제목(nm)과 보조 줄(mtTight) 두 줄, 오른쪽 슬롯이 한 줄에 있다.
 * 오른쪽 슬롯은 여러 노드를 받는다(작은 Seg와 아이콘 버튼을 같이 둔다).
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
  onTitlePress,
  titlePressLabel,
}: {
  back?: () => void;
  close?: () => void;
  eyebrow?: string;
  title: string;
  size?: 'lg' | 'sm' | 'row';
  sub?: string;
  step?: string;
  right?: React.ReactNode;
  /** row: 제목 줄을 누르면 하는 일(예: 채팅방 바꾸기). 있으면 제목 옆에 아래 꺾쇠를 그린다 */
  onTitlePress?: () => void;
  /** onTitlePress의 스크린리더 이름 */
  titlePressLabel?: string;
}) {
  if (size === 'row') {
    const titleBlock = (
      <>
        {eyebrow ? (
          <Txt v="eyebrow" numberOfLines={1}>
            {eyebrow}
          </Txt>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Txt v="nm" numberOfLines={1}>
              {title}
            </Txt>
          </View>
          {onTitlePress ? <Icon name="down" size={16} color="muted" stroke={2} /> : null}
        </View>
        {sub ? (
          <Txt v="mtTight" numberOfLines={1}>
            {sub}
          </Txt>
        ) : null}
      </>
    );
    return (
      <View style={{ paddingTop: SP.s, paddingLeft: back ? SP.xl : SP.gutter, paddingRight: SP.xl, paddingBottom: SP.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.m, minHeight: H.iconBtn }}>
          {back ? <IconBtn icon="back" label="뒤로" onPress={back} /> : null}
          {step ? <Txt v="mt">{step}</Txt> : null}
          {onTitlePress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={titlePressLabel ?? title}
              onPress={onTitlePress}
              style={{ flex: 1, minWidth: 0 }}
            >
              {titleBlock}
            </Pressable>
          ) : (
            <View accessibilityRole="header" style={{ flex: 1, minWidth: 0 }}>
              {titleBlock}
            </View>
          )}
          <HeaderRight>{right}</HeaderRight>
          {close ? <IconBtn icon="x" label="닫기" onPress={close} /> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: 14, gap: SP.xl }}>
      {back || close || right || step ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.l }}>
          {back ? <IconBtn icon="back" label="뒤로" onPress={back} /> : null}
          {step ? <Txt v="mt">{step}</Txt> : null}
          <View style={{ flex: 1 }} />
          <HeaderRight>{right}</HeaderRight>
          {close ? <IconBtn icon="x" label="닫기" onPress={close} /> : null}
        </View>
      ) : null}
      <View accessibilityRole="header" style={{ gap: SP.xs }}>
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
  // Foot도 탭 바도 없으면 스크롤 끝이 화면 맨 아래라 아래 안전 영역을 더한다(끝 내용이 내비게이션 바에 가리지 않게)
  const foot = useContext(FootCtx);
  const inTabs = useContext(BottomTabBarHeightContext) != null;
  const bottom = useBottomInset();
  const safeEnd = foot?.hasFoot || inTabs ? 0 : bottom;
  if (scroll) {
    // 키보드가 열린 채로 결과·버튼을 처음 누를 때 바로 눌리게 한다(handled). 끌면 키보드를 내린다.
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[pad, { paddingBottom: SP.section + safeEnd }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[{ flex: 1, minHeight: 0 }, pad]}>{children}</View>;
}

/** 목업 .foot. 아래 안전 영역을 더한다. */
export function Foot({ children }: { children?: React.ReactNode }) {
  const bottom = useBottomInset();
  const register = useContext(FootCtx)?.register;
  useEffect(() => register?.(), [register]);
  return (
    <View
      style={{
        paddingTop: 14,
        paddingHorizontal: SP.gutter,
        paddingBottom: SP.section + bottom,
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
