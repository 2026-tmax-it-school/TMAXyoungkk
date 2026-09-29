import React from 'react';
import { View } from 'react-native';

import type { ChatHighlight } from '../../../types';
import { lineC, R, SP, surfaceC, Txt } from '../../../ui';
import { bubbleSegments } from '../view';

/**
 * 말풍선(05, WP3 소유). 장소는 밑줄 대신 연핑크 면으로 강조한다(원문을 해치지 않는다).
 * Txt에는 면색을 줄 수 없어서 어절 단위 조각을 줄바꿈 가능한 가로 줄로 늘어놓는다(한국어는 어절에서 줄이 바뀐다).
 * 강조는 굵은 글씨(bubbleBold)다. 남의 말풍선은 연핑크 면에 roseDeep 글씨(목업 .msg .hl, 대비 8.33:1),
 * 내 말풍선은 로즈 위 흰 22% 합성 면(onRoseHl)에 흰 글씨(4.74:1)다(목업 .msg.me .hl).
 */
function tokens(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

export function Bubble({ text, highlights, mine }: { text: string; highlights: readonly ChatHighlight[]; mine: boolean }) {
  const segs = bubbleSegments(text, highlights);
  return (
    <View
      style={{
        maxWidth: '100%',
        paddingVertical: SP.bubbleV,
        paddingHorizontal: SP.xl,
        borderRadius: R.bubble,
        backgroundColor: mine ? surfaceC.accent : surfaceC.card,
        borderWidth: mine ? 0 : 1,
        borderColor: lineC.line,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignSelf: mine ? 'flex-end' : 'flex-start',
      }}
    >
      {segs.map((s, i) =>
        s.hl ? (
          <View
            key={`h${i}`}
            accessibilityLabel={`장소 ${s.text}`}
            style={{ backgroundColor: mine ? surfaceC.onAccentHl : surfaceC.soft, borderRadius: R.hl, paddingHorizontal: SP.hl }}
          >
            <Txt v="bubbleBold" c={mine ? 'onAccent' : 'accentStrong'}>
              {s.text}
            </Txt>
          </View>
        ) : (
          tokens(s.text).map((t, j) => (
            <Txt key={`t${i}-${j}`} v="bubble" c={mine ? 'onAccent' : 'ink'}>
              {t}
            </Txt>
          ))
        ),
      )}
    </View>
  );
}
