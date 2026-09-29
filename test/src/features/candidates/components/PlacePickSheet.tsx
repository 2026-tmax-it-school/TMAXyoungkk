import React from 'react';
import { ScrollView } from 'react-native';

import type { PickOption } from '../../../core/extract/manual';
import { Btn, Card, Chip, Col, H, Row, Sheet, SP, Txt } from '../../../ui';

/**
 * 24 동명 장소 선택 시트(FR-202·401, WP3 소유). 라우트가 아니라 시트다.
 * 06 수동 검색 결과가 여러 곳일 때와 05 추출 카드의 동명 장소 고르기가 같이 쓴다.
 * 목적지 밖은 '목적지 밖 · N km' 칩을 달고 뒤로 보낸다. 이미 후보인 곳은 '이미 후보' 칩(담으면 제안자만 늘어난다).
 * 숙소·역 같은 기점 장소는 '기점 장소' 칩을 단다(담을 수는 있다).
 */
export function PlacePickSheet({
  visible,
  title,
  sub,
  options,
  onPick,
  onDismiss,
  onClose,
  dismissLabel = '닫기',
}: {
  visible: boolean;
  title: string;
  sub?: string;
  options: PickOption[];
  onPick: (opt: PickOption) => void;
  onDismiss: () => void;
  /** 바깥을 눌러 닫을 때. 없으면 onDismiss */
  onClose?: () => void;
  dismissLabel?: string;
}) {
  return (
    <Sheet visible={visible} onClose={onClose ?? onDismiss} title={title}>
      {sub ? <Txt v="mt">{sub}</Txt> : null}
      <ScrollView style={{ maxHeight: H.sheetList }} contentContainerStyle={{ gap: SP.m }}>
        {options.map((o) => (
          <Card key={o.place.placeId} onPress={() => onPick(o)}>
            <Row top>
              <Col grow gap={SP.xs}>
                <Txt v="nm">{o.place.name}</Txt>
                <Txt v="mtTight">
                  {[o.place.kind ?? o.place.category, o.place.address].filter(Boolean).join(' · ')}
                </Txt>
              </Col>
              <Col gap={SP.xs}>
                {o.outside ? <Chip text={`목적지 밖 · ${o.km}km`} tone="warn" /> : <Chip text={`중심에서 ${o.km}km`} tone="line" />}
                {o.existingSpotId ? <Chip text="이미 후보" tone="soft" /> : null}
                {o.base ? <Chip text="기점 장소" tone="line" /> : null}
              </Col>
            </Row>
          </Card>
        ))}
      </ScrollView>
      <Btn title={dismissLabel} variant="quiet" onPress={onDismiss} />
    </Sheet>
  );
}
