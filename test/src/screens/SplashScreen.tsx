import React from 'react';
import { View } from 'react-native';

import { lineC, ProgressBar, Row, Screen, SP, Txt } from '../ui';

/**
 * 01 스플래시 · 로딩(WP1 소유). 라우트가 아니다. App이 bootstrap 동안 그린다.
 * 흰 바탕에 잉크 워드마크. 색면을 깔지 않는다(2026-09-29 개편).
 * - 워드마크: 고딕 ExtraBold 'Young' / 'Trip' 두 줄, 가운데
 * - 짧은 구분선(1px 잉크), 한 줄 태그라인(muted)
 * - 아래: 진행 막대, 그 밑 한 줄에 단계 이름(왼쪽)과 퍼센트(오른쪽)
 * 진행률은 단계 수(폰트 4 + 저장소 4) 기준이다. 바이트 진행률이 아니다.
 */
export default function SplashScreen({ progress, label }: { progress: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: SP.gutter }}>
        <View accessibilityRole="header" accessibilityLabel="Young Trip">
          <Txt v="display" center>
            Young
          </Txt>
          <Txt v="display" center>
            Trip
          </Txt>
        </View>
        <View style={{ width: 28, height: 1, marginTop: 20, marginBottom: 16, backgroundColor: lineC.accent, alignSelf: 'center' }} />
        <Txt v="sub" c="muted" center>
          말하면 일정이 됩니다
        </Txt>
      </View>
      <View style={{ paddingTop: 14, paddingHorizontal: SP.gutter, paddingBottom: 40, gap: SP.xl }}>
        <ProgressBar value={progress} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="mtSm" c="muted" numberOfLines={1} style={{ flex: 1 }}>
            {label}
          </Txt>
          <Txt v="time" c="muted">{`${pct}%`}</Txt>
        </Row>
      </View>
    </Screen>
  );
}
