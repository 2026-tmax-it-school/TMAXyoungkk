import React from 'react';
import { View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { lineC, R, surfaceC, type TextColorKey } from './tokens';

/**
 * 상태 배지(DS Badge, 라운드 4, 누를 수 없음). soft: 연회색 면·잉크(개수·속성), line: 흰 면·경계선·muted(범위 배지,
 * 예시 데이터), card: 흰 면·경계선·잉크(지도 위 날짜 칩), warn: 앰버(조정 필요), ok: brand-soft·brand-ink(확정·추천)
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
          gap: 4,
          paddingVertical: 3,
          paddingHorizontal: 8,
          borderRadius: R.tag,
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
