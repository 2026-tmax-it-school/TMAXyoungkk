import React from 'react';
import { Pressable, View } from 'react-native';

import { Btn, Card, Chip, Col, Icon, Row, SP, Txt } from '../../../ui';
import type { ExtractionCard } from '../view';

/**
 * 추출 묶음 카드(05, WP3 소유). 한 메시지의 추출 결과를 카드 하나에 담아 대화 흐름을 끊지 않는다.
 * 잘못 잡았을 때를 위해 되돌리기를 제목과 같은 줄에 둔다. 동명 장소는 자동 등록하지 않고 여기서 고른다.
 * 행을 누르면 스팟 상세(07)로 간다. 오인식 후보 지우기는 07에 있다.
 * 글자는 목업 값(제목 12.5, 행 이름 13.5 Bold)에 가장 가까운 기존 변형을 쓴다(time 12 Bold, btnSm 13 Bold). 대화 흐름보다 두드러지지 않게 한다.
 */
export function ExtractionCardView({
  card,
  onUndo,
  onOpen,
  onPick,
}: {
  card: ExtractionCard;
  onUndo: () => void;
  onOpen: (spotId: string) => void;
  onPick: (phrase: string) => void;
}) {
  return (
    <Card style={{ padding: SP.xl }}>
      <Row>
        <Row gap={SP.s} style={{ flex: 1 }}>
          <Icon name="pin" size={15} color="accent" stroke={1.8} />
          <Txt v="time" c="accent">
            {card.title}
          </Txt>
        </Row>
        {card.canUndo ? (
          <Pressable accessibilityRole="button" accessibilityLabel="추출 되돌리기" onPress={onUndo} hitSlop={8}>
            <Txt v="mtTight">되돌리기</Txt>
          </Pressable>
        ) : null}
      </Row>
      <Col gap={SP.s}>
        {card.rows.map((r) => (
          <Pressable key={r.spotId} accessibilityRole="button" onPress={() => onOpen(r.spotId)}>
            <Row gap={SP.m}>
              <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: SP.xs }}>
                <Txt v="btnSm">{r.name}</Txt>
                <Txt v="mtTight">{`· ${r.kind}`}</Txt>
              </View>
              {r.pinned ? (
                <Chip text="고정" icon="pinlock" />
              ) : (
                <>
                  <Chip text={`제안자 ${r.proposerCount}`} />
                  <Chip text={r.status === 'created' ? '후보 추가됨' : '제안 더함'} tone="ok" />
                </>
              )}
            </Row>
          </Pressable>
        ))}
        {card.picks.map((p) => (
          <Row key={p.phrase} gap={SP.m}>
            <Col grow gap={2}>
              <Txt v="btnSm">{p.phrase}</Txt>
              <Txt v="mtTight">{`같은 이름이 ${p.options.length}곳이라 담기 전에 골라 주세요`}</Txt>
            </Col>
            <Btn title="고르기" size="sm" variant="ghost" onPress={() => onPick(p.phrase)} />
          </Row>
        ))}
      </Col>
    </Card>
  );
}
