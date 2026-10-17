import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FreeTime, LatLng, Place } from '../../../types';
import { distanceText } from '../../../core/map/model';
import { haversineKm, kstHHMM } from '../../../core/util';
import { Card, Col, Icon, IconBtn, Row, SP, Txt } from '../../../ui';

/**
 * 빈 시간 추천(FR-604, 3차, WP5 소유). 다음 일정까지 30분 이상 남을 때만 뜬다.
 * 도보 이동 가능 반경 800m는 프로토타입 가정이다. 주변 결과가 없으면 이 카드 자체가 없다.
 * 장소 줄을 누르면 onPressPlace(장소)를 부른다(19는 그 장소를 카카오맵으로 연다. 링크에는 목적지 이름과 좌표만 들어가고
 * 내 위치는 넣지 않는다. 걸어갈지 고르는 것은 카카오맵에서 한다).
 * 장소 줄은 앱 밖으로 나가는 링크라 role link와 '{장소}, 카카오맵으로 열기' 이름을 붙이고, 끝 아이콘도 앱 안 이동 화살표 대신 지도다.
 * 닫기는 카드 오른쪽 위 아이콘 버튼이다(가장 눈에 띄는 행동이 '닫기'가 되지 않게).
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
  onPressPlace?: (place: Place) => void;
}) {
  const leftMin = Math.max(0, Math.round((freeTime.until - now) / 60_000));
  return (
    <Card variant="tinted">
      <Col gap={SP.l}>
        <Row gap={SP.m}>
          <Icon name="pin" size={18} color="accent" />
          <View style={styles.grow}>
            <Txt v="nm">{`다음 일정까지 ${leftMin}분`}</Txt>
          </View>
          <IconBtn icon="x" label="빈 시간 추천 닫기" onPress={onClose} />
        </Row>
        <Txt v="mt">{`${kstHHMM(freeTime.until)} 전까지 걸어서 다녀올 만한 곳`}</Txt>
        <Col gap={SP.s}>
          {freeTime.places.map((p) => {
            const walk = from ? `도보 ${distanceText(haversineKm(from, p.coord) * 1000)}` : undefined;
            const row = (
              <Card>
                <Row gap={SP.l}>
                  <View style={styles.text}>
                    <Txt v="nm" numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <Txt v="mtTight">{p.kind ? `${p.category} · ${p.kind}` : p.category}</Txt>
                  </View>
                  {walk ? <Txt v="mt">{walk}</Txt> : null}
                  {onPressPlace ? <Icon name="map" size={14} color="muted" /> : null}
                </Row>
              </Card>
            );
            if (!onPressPlace) return <React.Fragment key={p.placeId}>{row}</React.Fragment>;
            return (
              <Pressable
                key={p.placeId}
                accessibilityRole="link"
                accessibilityLabel={placeLinkLabel(p, walk)}
                onPress={() => onPressPlace(p)}
              >
                {row}
              </Pressable>
            );
          })}
        </Col>
      </Col>
    </Card>
  );
}

/** 장소 줄 접근성 이름. 실제 동작(앱 밖 카카오맵으로 열기)을 말한다 */
function placeLinkLabel(p: Pick<Place, 'name' | 'category'>, walk?: string): string {
  return [p.name, p.category, walk, '카카오맵으로 열기'].filter(Boolean).join(', ');
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
