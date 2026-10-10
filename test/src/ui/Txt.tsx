import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { T, TABULAR_NUMS, textC, type TextColorKey, type TypeKey } from './tokens';

/** 기본 글자색. 보조 글씨 계열과 eyebrow(작은 구역 제목)는 muted */
const DEFAULT_COLOR: Partial<Record<TypeKey, TextColorKey>> = {
  mt: 'muted',
  mtTight: 'muted',
  label: 'muted',
  time: 'muted',
  eyebrow: 'muted',
  tab: 'muted',
  sub: 'muted',
  mtSm: 'muted',
  mtLoose: 'muted',
  note: 'muted',
  step: 'muted',
};

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Txt가 받는 배치용 style. 글꼴·크기·행간·자간·색은 타입 스케일(v)과 글자색(c)으로만 바꾼다.
 * 새 크기가 필요하면 tokens.T에 변형을 더한다.
 */
export type TxtLayoutStyle = Pick<
  TextStyle,
  | 'flex'
  | 'flexGrow'
  | 'flexShrink'
  | 'flexBasis'
  | 'alignSelf'
  | 'width'
  | 'minWidth'
  | 'maxWidth'
  | 'margin'
  | 'marginTop'
  | 'marginBottom'
  | 'marginLeft'
  | 'marginRight'
  | 'marginHorizontal'
  | 'marginVertical'
  | 'padding'
  | 'paddingTop'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'paddingRight'
  | 'paddingHorizontal'
  | 'paddingVertical'
>;

/**
 * 모든 글자는 이것으로 쓴다. 타입 스케일(v)과 글자색 토큰(c)만 받는다.
 * style은 여백·flex 같은 배치용이다. 글꼴·굵기·색을 style로 덮지 않는다.
 */
export function Txt({
  v,
  c,
  numberOfLines,
  style,
  center,
  underline,
  children,
}: {
  v: TypeKey;
  c?: TextColorKey;
  numberOfLines?: number;
  style?: StyleProp<TxtLayoutStyle>;
  /** 가운데 정렬. 스플래시·Empty·지도 안 글자에만 쓴다(디자인 규칙). */
  center?: boolean;
  /** 밑줄(15 로그인 '계정찾기' 같은 글자 링크). ui/Auth TextLink가 쓴다 */
  underline?: boolean;
  children?: React.ReactNode;
}) {
  const color = textC[c ?? DEFAULT_COLOR[v] ?? 'ink'];
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[T[v], { color }, TABULAR_NUMS.includes(v) ? TABULAR : null, center ? { textAlign: 'center' } : null, underline ? { textDecorationLine: 'underline' } : null, style]}
    >
      {children}
    </Text>
  );
}
