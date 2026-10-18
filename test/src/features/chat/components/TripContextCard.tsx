import React from 'react';
import { Image, View } from 'react-native';

import { coverUri } from '../../../core/trip/cover';
import { periodLabel } from '../../../core/trip/create';
import { regionById } from '../../../data/regions';
import type { Trip } from '../../../types';
import { Btn, Icon, lineC, R, Row, SP, surfaceC, Txt } from '../../../ui';

/** 표지 썸네일 한 변 */
const THUMB = 44;

/**
 * 채팅방 머리 아래 여행방 카드(2026-10-17, 메신저형 채팅). 이 대화가 어느 여행 이야기인지 늘 위에 보인다.
 * 표지 썸네일(없으면 핀), 여행 이름, '기간 · 후보 N곳', 그리고 작은 버튼 둘: '일정 보기'(시간표), '여행방 공유'(공유 시트).
 */
export function TripContextCard({ trip, onSchedule, onShare }: { trip: Trip; onSchedule: () => void; onShare: () => void }) {
  const cover = coverUri(trip.cover);
  const spots = trip.spots.filter((s) => !s.removedByUser).length;
  const place = regionById(trip.region)?.name ?? '';
  return (
    <View
      style={{
        paddingHorizontal: SP.gutter,
        paddingVertical: SP.m,
        gap: SP.m,
        borderBottomWidth: 1,
        borderBottomColor: lineC.line,
      }}
    >
      <Row gap={SP.l}>
        <View
          style={{
            width: THUMB,
            height: THUMB,
            borderRadius: R.btnSm,
            overflow: 'hidden',
            backgroundColor: surfaceC.off,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {cover ? (
            <Image source={{ uri: cover }} resizeMode="cover" accessibilityIgnoresInvertColors style={{ width: THUMB, height: THUMB }} />
          ) : (
            <Icon name="pin" size={18} color="muted" stroke={1.7} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="nm" numberOfLines={1}>
            {place ? `${trip.title} · ${place}` : trip.title}
          </Txt>
          <Txt v="mtTight" numberOfLines={1}>
            {`${periodLabel(trip.startDate, trip.endDate)} · 후보 ${spots}곳`}
          </Txt>
        </View>
      </Row>
      <Row gap={SP.s}>
        <Btn title="일정 보기" icon="cal" size="sm" variant="quiet" onPress={onSchedule} />
        <Btn title="여행방 공유" icon="share" size="sm" variant="quiet" onPress={onShare} />
      </Row>
    </View>
  );
}
