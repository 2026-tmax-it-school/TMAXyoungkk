import React from 'react';
import { Text } from 'react-native-svg';

import { F, textC, type TextColorKey } from './tokens';

/**
 * SVG 안의 글자(지도 핀 순번, '제외', 클러스터 숫자, 모의 사진 타일 이름)는 이것만 쓴다.
 * 폰트와 색은 토큰에서 넣는다. y는 글자 기준선이다.
 */
const VARIANT = {
  pin: { fontFamily: F.bold, fontSize: 11 },
  /** 순번 핀(목업 11의 13px 순번) */
  pinLg: { fontFamily: F.bold, fontSize: 13 },
  pinSm: { fontFamily: F.bold, fontSize: 9.5 },
  cluster: { fontFamily: F.bold, fontSize: 12 },
  tile: { fontFamily: F.semibold, fontSize: 11 },
} as const;

export type SvgLabelVariant = keyof typeof VARIANT;

export function SvgLabel({
  x,
  y,
  text,
  v,
  c,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  text: string;
  v: SvgLabelVariant;
  c: TextColorKey;
  anchor?: 'middle' | 'start';
}) {
  const s = VARIANT[v];
  return (
    <Text x={x} y={y} fill={textC[c]} fontFamily={s.fontFamily} fontSize={s.fontSize} textAnchor={anchor}>
      {text}
    </Text>
  );
}
