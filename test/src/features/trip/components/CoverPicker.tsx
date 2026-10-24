import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import type { TripCover } from '../../../types';
import { coverUri } from '../../../core/trip/cover';
import { COVER_PICK_TEXT, pickTripCover } from '../../../services/tripCover';
import { Btn, Icon, lineC, R, RegionArt, Row, SP, surfaceC, Txt } from '../../../ui';

/**
 * 여행방 표지 고르기(2026-10-10). 여행방 만들기·설정·빠른 수정이 함께 쓴다.
 * 비어 있으면 상자를 눌러 사진을 고르고, 고른 뒤에는 미리보기 아래에서 바꾸거나 뺀다.
 */
const COVER_H = 150;

export function CoverPicker({
  value,
  onChange,
  disabled,
  regionId,
}: {
  value?: TripCover;
  /** 사진이 없을 때 깔 지역 그림(피그마 최종안 10). 없으면 연회색 빈 상자 */
  regionId?: string;
  onChange: (cover: TripCover | null) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const pick = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setProblem(undefined);
    const r = await pickTripCover();
    setBusy(false);
    if (!r.ok) return setProblem(COVER_PICK_TEXT[r.reason]);
    if (r.cover) onChange(r.cover);
  };

  const uri = coverUri(value);
  return (
    <View style={{ gap: SP.s }}>
      <Txt v="label">표지 이미지 · 선택</Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={uri ? '표지 이미지 바꾸기' : '표지 이미지 고르기'}
        accessibilityState={{ disabled: !!disabled || busy }}
        disabled={disabled || busy}
        onPress={() => void pick()}
        style={{
          height: COVER_H,
          borderRadius: R.card,
          borderWidth: 1,
          borderColor: lineC.line,
          backgroundColor: surfaceC.soft,
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP.s,
          overflow: 'hidden',
        }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        ) : regionId ? (
          // 피그마 최종안 10: 사진이 없으면 지역 그림을 깔고 오른쪽 아래에 '표지 사진 고르기' 알약
          <>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <RegionArt regionId={regionId} />
            </View>
            <View
              style={{
                position: 'absolute',
                right: SP.xl,
                bottom: SP.xl,
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP.s,
                paddingVertical: SP.s,
                paddingHorizontal: SP.xl,
                borderRadius: R.iconBtn,
                backgroundColor: surfaceC.card,
              }}
            >
              <Icon name="camera" size={16} color="ink" />
              <Txt v="btnSm">{busy ? '불러오는 중' : '표지 사진 고르기'}</Txt>
            </View>
          </>
        ) : (
          <>
            <Icon name="camera" size={22} color="muted" />
            <Txt v="btnSm" c="muted">
              {busy ? '불러오는 중' : '표지 사진 고르기'}
            </Txt>
          </>
        )}
      </Pressable>
      {uri && !disabled ? (
        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn title={busy ? '불러오는 중' : '표지 바꾸기'} size="sm" variant="ghost" icon="camera" disabled={busy} onPress={() => void pick()} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="표지 빼기" size="sm" variant="quiet" disabled={busy} onPress={() => onChange(null)} />
          </View>
        </Row>
      ) : null}
      {problem ? (
        <Txt v="mtTight" c="warn">
          {problem}
        </Txt>
      ) : null}
    </View>
  );
}
