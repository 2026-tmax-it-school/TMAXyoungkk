import React from 'react';
import { View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { lineC, R, surfaceC, type TextColorKey } from './tokens';

/**
 * tint: 연핑크 면·accentDeep, line: 흰 면·경계선·muted(범위 배지, 예시 데이터),
 * card: 흰 면·경계선·accentDeep 굵은 글자(목업 11 지도 위 날짜 칩), warn: 앰버, ok: 초록
 */
export type ChipTone = 'soft' | 'line' | 'card' | 'warn' | 'ok';

const TONE: Record<ChipTone, { box: ViewStyle; text: TextColorKey }> = {
  soft: { box: { backgroundColor: surfaceC.soft }, text: 'accentStrong' },
  line: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.line }, text: 'muted' },
  card: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.line }, text: 'accentStrong' },
  warn: { box: { backgroundColor: surfaceC.warnBg }, text: 'warn' },
  ok: { box: { backgroundColor: surfaceC.okBg }, text: 'ok' },
};

export function Chip({ text, tone = 'soft', icon }: { text: string; tone?: ChipTone; icon?: IconName }) {
  const t = TONE[tone];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 5,
          paddingVertical: 4,
          paddingHorizontal: 9,
          borderRadius: R.chip,
        },
        t.box,
      ]}
    >
      {icon ? <Icon name={icon} size={12} color={t.text} stroke={2.2} /> : null}
      <Txt v={tone === 'line' ? 'chipLine' : 'chip'} c={t.text}>
        {text}
      </Txt>
    </View>
  );
}

/** 2·3차 기능 표시. 비활성 문구 대신 이 배지를 단다(line 칩). */
export function ScopeBadge({ phase }: { phase: '2차' | '3차' }) {
  return <Chip text={phase} tone="line" />;
}
