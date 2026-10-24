import React from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from './Icon';
import { RegionArt } from './RegionArt';
import { E, H, lineC, R, SP, surfaceC } from './tokens';

/** 목록 썸네일(2026-10-23 피그마 최종안 11·12·25): 지역 그림을 정사각형으로 자른다. 사진이 없는 장소·방에 쓴다 */
export function ArtThumb({ regionId, size = 64 }: { regionId: string | undefined; size?: number }) {
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: R.field, overflow: 'hidden', backgroundColor: surfaceC.soft }}>
      <RegionArt regionId={regionId} />
    </View>
  );
}

/**
 * 담기 원 버튼(피그마 최종안 12). 안 담았으면 흰 원에 +, 담았으면 주색 원에 체크(누를 수 없음).
 * 보이는 크기 40, hitSlop으로 44.
 */
export function AddCircle({ added, label, onPress, disabled }: { added: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  const d = H.iconBtn;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={added ? `${label}, 후보에 담김` : `${label} 후보에 담기`}
      accessibilityState={{ disabled: added || !!disabled, selected: added }}
      disabled={added || disabled}
      onPress={onPress}
      hitSlop={(H.touch - d) / 2}
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: added ? surfaceC.accent : surfaceC.card,
        borderWidth: added ? 0 : 1,
        borderColor: lineC.line,
      }}
    >
      <Icon name={added ? 'check' : 'plus'} size={18} color={added ? 'onAccent' : 'ink'} stroke={2.2} />
    </Pressable>
  );
}

/**
 * 그림 머리(피그마 최종안 14·18): 위쪽 지역 그림(높이 height)과 그 위에 뜬 흰 원 버튼(뒤로·오른쪽 동작).
 * 본문은 아래에서 이어 그린다. 사진이 없는 상세 화면(예시 일정, 올라온 일정)의 머리다.
 */
export function ArtHero({
  regionId,
  height = 200,
  onBack,
  right,
}: {
  regionId: string | undefined;
  height?: number;
  onBack: () => void;
  right?: { icon: 'share' | 'heart' | 'map'; label: string; onPress: () => void };
}) {
  const float = (icon: 'back' | 'share' | 'heart' | 'map', label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[{ width: H.touch, height: H.touch, borderRadius: R.iconBtn, backgroundColor: surfaceC.card, alignItems: 'center', justifyContent: 'center' }, E.float]}
    >
      <Icon name={icon} size={20} color="ink" stroke={2} />
    </Pressable>
  );
  return (
    <View style={{ height, backgroundColor: surfaceC.soft }}>
      <RegionArt regionId={regionId} />
      <View style={{ position: 'absolute', top: SP.xl, left: SP.xxl, right: SP.xxl, flexDirection: 'row', justifyContent: 'space-between' }}>
        {float('back', '뒤로', onBack)}
        {right ? float(right.icon, right.label, right.onPress) : null}
      </View>
    </View>
  );
}
