import React from 'react';

import { kstHHMM } from '../../../core/util';
import { Avatar, Card, Row, SP, Txt } from '../../../ui';
import { splitMark, type SpotQuote } from '../talk';

/**
 * 07 스팟 상세 '채팅에서 나온 말'(2026-10-23 피그마 최종안 18). 연회색 카드 안에 말한 사람 아바타와 원문,
 * 원문 속 장소 이름은 채팅 말풍선과 같은 굵은 주색으로 강조한다. 아래 줄은 '이름 · 보낸 시각'.
 */
export function ChatQuote({ quote, place }: { quote: SpotQuote; place: string }) {
  return (
    <Card variant="tinted">
      <Txt v="eyebrow">채팅에서 나온 말</Txt>
      <Row top gap={SP.m}>
        <Avatar name={quote.name} index={quote.index} />
        <Txt v="bubble" style={{ flex: 1 }}>
          {splitMark(quote.text, place).map((p, i) =>
            p.mark ? (
              <Txt key={i} v="bubbleBold" c="accent">
                {p.text}
              </Txt>
            ) : (
              p.text
            ),
          )}
        </Txt>
      </Row>
      <Txt v="mtTight">{`${quote.name} · ${kstHHMM(quote.sentAt)}`}</Txt>
    </Card>
  );
}
