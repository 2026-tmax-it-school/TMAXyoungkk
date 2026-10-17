import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { PickOption } from '../../../core/extract/manual';
import { Btn, Card, Chip, Col, H, Icon, Row, SP, Txt } from '../../../ui';
import { INLINE_PICK_MAX, type ExtractionCard, type ExtractionRow } from '../view';

/** 되돌리기 글자 버튼: 보이는 높이 36, 위아래 hitSlop으로 누르는 높이 44 */
const UNDO_SLOP = (H.touch - H.btnSm) / 2;

function rowChip(r: ExtractionRow): React.ReactNode {
  if (r.pinned) return <Chip text="고정" icon="pinlock" />;
  if (r.status === 'created') return <Chip text="새 후보" tone="ok" />;
  return <Chip text={`제안자 ${r.proposerCount}명`} />;
}

/**
 * 추출 묶음 카드(05, WP3 소유). 한 메시지의 추출 결과를 카드 하나에 담아 대화 흐름을 끊지 않는다.
 * - 제목은 '후보 N곳에 담았어요'이고, 잘못 잡았을 때를 위해 되돌리기(아이콘과 글자)를 같은 줄에 둔다.
 * - 줄마다 칩은 하나(고정 / 새 후보 / 제안자 N명)이고 오른쪽 꺾쇠가 있다. 누르면 스팟 상세(07)로 간다.
 * - 동명 장소는 자동 등록하지 않는다. 카드 안 안내 한 줄 아래, 3곳 이하면 카드 안에서 바로 고르고 4곳 이상이면 고르기 시트를 연다.
 */
export function ExtractionCardView({
  card,
  onUndo,
  onOpen,
  onPick,
  optionsFor,
  onChoose,
  onNone,
}: {
  card: ExtractionCard;
  onUndo: () => void;
  onOpen: (spotId: string) => void;
  /** 고르기 시트 열기(4곳 이상) */
  onPick: (phrase: string) => void;
  /** 지역 안에서 고를 수 있는 곳(카드 안에서 바로 고를 때) */
  optionsFor: (phrase: string) => PickOption[];
  onChoose: (phrase: string, option: PickOption) => void;
  onNone: (phrase: string) => void;
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="추출 되돌리기"
            onPress={onUndo}
            hitSlop={{ top: UNDO_SLOP, bottom: UNDO_SLOP, left: SP.xs, right: SP.xs }}
            style={styles.undo}
          >
            <Icon name="undo" size={14} color="muted" stroke={1.8} />
            <Txt v="mtTight">되돌리기</Txt>
          </Pressable>
        ) : null}
      </Row>
      <Col gap={SP.s}>
        {card.rows.map((r) => (
          <Pressable
            key={r.spotId}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${r.kind}, 스팟 상세 보기`}
            onPress={() => onOpen(r.spotId)}
            style={styles.row}
          >
            <Row gap={SP.m}>
              <View style={styles.name}>
                <Txt v="btnSm">{r.name}</Txt>
                <Txt v="mtTight">{`· ${r.kind}`}</Txt>
              </View>
              {rowChip(r)}
              <Icon name="right" size={16} color="muted" stroke={2} />
            </Row>
          </Pressable>
        ))}
        {card.pickHint ? <Txt v="mtTight">{card.pickHint}</Txt> : null}
        {card.picks.map((p) => {
          const opts = optionsFor(p.phrase);
          const inline = opts.length > 0 && opts.length <= INLINE_PICK_MAX;
          return (
            <Col key={p.phrase} gap={SP.s}>
              <Row gap={SP.m}>
                <Col grow gap={2}>
                  <Txt v="btnSm">{p.phrase}</Txt>
                </Col>
                {inline ? null : <Btn title="고르기" size="sm" variant="ghost" onPress={() => onPick(p.phrase)} />}
              </Row>
              {inline ? (
                <Row wrap gap={SP.s}>
                  {opts.map((o) => (
                    <Btn
                      key={o.place.placeId}
                      title={o.place.address ? `${o.place.name} · ${o.place.address}` : o.place.name}
                      size="sm"
                      variant="ghost"
                      onPress={() => onChoose(p.phrase, o)}
                    />
                  ))}
                  <Btn title="해당 없음" size="sm" variant="quiet" onPress={() => onNone(p.phrase)} />
                </Row>
              ) : null}
            </Col>
          );
        })}
      </Col>
    </Card>
  );
}

const styles = StyleSheet.create({
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    minHeight: H.btnSm,
  },
  row: {
    minHeight: H.touch,
    justifyContent: 'center',
  },
  name: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: SP.xs,
  },
});
