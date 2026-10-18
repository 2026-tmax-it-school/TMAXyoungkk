import React from 'react';
import { Image, Pressable, View } from 'react-native';

import { coverUri } from '../../../core/trip/cover';
import { copyInvite, issueInvite, shareInvite } from '../../trip/actions';
import { useTrips } from '../../../store/trips';
import type { Trip } from '../../../types';
import { Icon, lineC, R, Row, Sheet, SP, surfaceC, Txt, type IconName } from '../../../ui';

const THUMB = 44;

/**
 * 여행방 공유 시트(2026-10-17, 메신저형 채팅의 '여행방 공유'). 여행방 썸네일·이름 아래에 테두리 칸 셋:
 * '초대 링크 복사'(복사하면 토스트), '메시지로 보내기'(기기 공유 시트, 안 되면 복사로 대신), '멤버·초대 관리'(14 화면).
 * 초대 링크가 아직 없으면 먼저 새로 만든다(issueInvite).
 */
export function ShareTripSheet({
  trip,
  visible,
  onClose,
  onManage,
}: {
  trip: Trip;
  visible: boolean;
  onClose: () => void;
  onManage: () => void;
}) {
  const cover = coverUri(trip.cover);
  /** 초대 링크가 있는 최신 문서(없으면 새로 만든 뒤의 문서) */
  const withInvite = (): Trip | undefined => {
    if (!trip.invite?.code) issueInvite(trip.id);
    return useTrips.getState().docs[trip.id];
  };
  const row = (label: string, icon: IconName, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: SP.xl,
        borderWidth: 1,
        borderColor: lineC.line,
        borderRadius: R.btn,
        backgroundColor: pressed ? surfaceC.off : surfaceC.card,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP.m,
      })}
    >
      <View style={{ flex: 1 }}>
        <Txt v="nm">{label}</Txt>
      </View>
      <Icon name={icon} size={20} color="ink" stroke={1.8} />
    </Pressable>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="이 여행방 공유하기">
      <Row gap={SP.l}>
        <View
          style={{ width: THUMB, height: THUMB, borderRadius: R.btnSm, overflow: 'hidden', backgroundColor: surfaceC.off, alignItems: 'center', justifyContent: 'center' }}
        >
          {cover ? (
            <Image source={{ uri: cover }} resizeMode="cover" accessibilityIgnoresInvertColors style={{ width: THUMB, height: THUMB }} />
          ) : (
            <Icon name="pin" size={18} color="muted" stroke={1.7} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="body" numberOfLines={2}>
            {trip.title}
          </Txt>
        </View>
      </Row>
      <View style={{ gap: SP.m }}>
        {row('초대 링크 복사', 'link', () => {
          const t = withInvite();
          onClose();
          if (t) void copyInvite(t);
        })}
        {row('메시지로 보내기', 'chat', () => {
          const t = withInvite();
          onClose();
          if (t) void shareInvite(t);
        })}
        {row('멤버·초대 관리', 'dots', () => {
          onClose();
          onManage();
        })}
      </View>
    </Sheet>
  );
}
