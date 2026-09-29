import React from 'react';
import { View } from 'react-native';

import type { FreeTime, LatLng } from '../../../types';
import { distanceText } from '../../../core/map/model';
import { haversineKm, kstHHMM } from '../../../core/util';
import { Btn, Card, Col, Icon, Row, ScopeBadge, SP, Txt } from '../../../ui';

/**
 * 빈 시간 추천(FR-604, 3차, WP5 소유). 다음 일정까지 30분 이상 남을 때만 뜬다.
 * 도보 이동 가능 반경 800m는 프로토타입 가정이다. 주변 결과가 없으면 이 카드 자체가 없다.
 */
export function FreeTimeCard({
  freeTime,
  from,
  now,
  onClose,
  onPressPlace,
}: {
  freeTime: FreeTime;
  from?: LatLng;
  now: number;
  onClose: () => void;
  onPressPlace?: (placeId: string) => void;
}) {
  const leftMin = Math.max(0, Math.round((freeTime.until - now) / 60_000));
  return (
    <Card variant="tinted">
      <Col gap={SP.l}>
        <Row gap={SP.m}>
          <Icon name="pin" size={18} color="accent" />
          <View style={{ flex: 1 }}>
            <Txt v="nm">{`다음 일정까지 ${leftMin}분`}</Txt>
          </View>
          <ScopeBadge phase="3차" />
        </Row>
        <Txt v="mt">{`${kstHHMM(freeTime.until)} 전까지 걸어서 다녀올 만한 곳`}</Txt>
        <Col gap={SP.s}>
          {freeTime.places.map((p) => (
            <Card key={p.placeId} onPress={onPressPlace ? () => onPressPlace(p.placeId) : undefined}>
              <Row gap={SP.l}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="nm" numberOfLines={1}>
                    {p.name}
                  </Txt>
                  <Txt v="mtTight">{p.kind ? `${p.category} · ${p.kind}` : p.category}</Txt>
                </View>
                {from ? <Txt v="mt">{`도보 ${distanceText(haversineKm(from, p.coord) * 1000)}`}</Txt> : null}
              </Row>
            </Card>
          ))}
        </Col>
        <Btn title="닫기" variant="quiet" size="sm" onPress={onClose} />
      </Col>
    </Card>
  );
}
