import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, View } from 'react-native';

import { RegionArt, SP, surfaceC, Txt } from '../ui';

/** 그림 원 지름, 로딩 바 폭·두께(dp) */
const ART = 200;
const BAR_WIDTH = 160;
const BAR_HEIGHT = 4;
/** 그림이 자리를 잡으면 워드마크와 바를 함께 이만큼에 걸쳐 드러낸다 */
const FADE_MS = 200;
/** 이 안에 자리를 못 잡으면 뜬 것으로 치고 넘어간다. 스플래시에 갇히지 않게 한다 */
const SHOW_TIMEOUT_MS = 3000;

/**
 * 01 스플래시 · 로딩(WP1 소유). 라우트가 아니다. App이 bootstrap 동안 그린다.
 * 2026-10-23 피그마 최종안: 흰 바탕에 지역 그림 원, 'Young Trip' 워드마크, 한 줄 소개, 로딩 바.
 * (2026-10-17의 연두 이미지 한 장 화면은 네이티브 스플래시·앱 아이콘에 남는다.)
 * 그림이 자리를 잡으면 워드마크와 바를 함께 페이드로 드러낸 뒤 onShown을 부른다.
 * App은 그때부터 최소 시간을 센다. 글자가 늦게 떠도 늘 minMs 이상 보인다.
 * 바는 부팅 진행률(단계 수 기준)과 드러난 뒤 minMs 경과 비율 중 작은 쪽만큼 찬다. 부팅이 빨리 끝나도 minMs에 걸쳐 차오른다.
 */
export default function SplashScreen({
  progress,
  label,
  minMs,
  onShown,
}: {
  progress: number;
  label: string;
  minMs: number;
  onShown: () => void;
}) {
  const [shownAt, setShownAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const shownRef = useRef(false);

  // 그림 onLayout·시한 중 먼저 온 한 번만 드러낸다
  const show = useRef(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: Platform.OS !== 'web' }).start();
    setShownAt(Date.now());
    onShownRef.current();
  }).current;

  useEffect(() => {
    const t = setTimeout(show, SHOW_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [show]);

  useEffect(() => {
    if (shownAt == null) return;
    let frame = 0;
    const tick = () => {
      const t = Date.now() - shownAt;
      setElapsed(t);
      if (t < minMs) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shownAt, minMs]);

  const booted = Math.max(0, Math.min(1, progress));
  const filled = Math.min(booted, minMs > 0 ? elapsed / minMs : 1);
  const pct = Math.round(booted * 100);

  // 피그마 최종안 01(2026-10-23): 흰 바탕 가운데 지역 그림 원, 워드마크, 한 줄 소개, 그 아래 로딩 바.
  // 예전 연두 이미지(assets/splash.png)는 앱 아이콘·네이티브 스플래시에 그대로 쓴다.
  return (
    <View
      style={{ flex: 1, backgroundColor: surfaceC.bg, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="progressbar"
      accessibilityLabel={`Young Trip, ${label}`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
    >
      <Animated.View style={{ alignItems: 'center', gap: SP.xxl, opacity }}>
        <View style={{ width: ART, height: ART, borderRadius: ART / 2, overflow: 'hidden' }} onLayout={show}>
          <RegionArt regionId="gyeongju" />
        </View>
        <Txt v="display">Young Trip</Txt>
        <Txt v="mt">친구들이 고른 곳으로, 하루가 짜여요</Txt>
        <View
          style={{
            marginTop: SP.xl,
            width: BAR_WIDTH,
            height: BAR_HEIGHT,
            borderRadius: BAR_HEIGHT / 2,
            backgroundColor: surfaceC.track,
            overflow: 'hidden',
          }}
        >
          <View style={{ width: `${filled * 100}%`, height: '100%', backgroundColor: surfaceC.accent }} />
        </View>
      </Animated.View>
    </View>
  );
}
