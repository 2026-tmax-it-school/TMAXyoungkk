import React from 'react';
import { View } from 'react-native';

import { H, surfaceC } from './tokens';

/** 진행 막대(0~1). 가짜 진행률에 쓰지 않는다. 실제 단계 수로만 채운다. */
export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{
        height: H.progress,
        borderRadius: H.progress / 2,
        backgroundColor: surfaceC.track,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${v * 100}%`,
          height: '100%',
          borderRadius: H.progress / 2,
          backgroundColor: surfaceC.accent,
        }}
      />
    </View>
  );
}
