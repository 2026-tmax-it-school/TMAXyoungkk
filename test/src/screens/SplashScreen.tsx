import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, View } from 'react-native';

import { surfaceC } from '../ui';

const SPLASH = require('../../assets/splash.png');

/** assets/splash.png 크기와 그 안의 워드마크 자리(이미지 픽셀). 이미지를 바꾸면 같이 고친다 */
const IMG = { w: 852, h: 1846 };
const MARK = { left: 270, right: 585, bottom: 980 };
/** 워드마크 아래 로딩 바까지 간격(이미지 픽셀)과 바 두께(dp) */
const BAR_GAP = 48;
const BAR_HEIGHT = 4;
/** 이미지가 뜨면 워드마크와 바를 함께 이만큼에 걸쳐 드러낸다 */
const FADE_MS = 200;
/** 이미지가 이 안에 안 뜨면(느린 네트워크, 오류) 뜬 것으로 치고 넘어간다. 스플래시에 갇히지 않게 한다 */
const SHOW_TIMEOUT_MS = 3000;

/**
 * 01 스플래시 · 로딩(WP1 소유). 라우트가 아니다. App이 bootstrap 동안 그린다.
 * 연두 바탕에 흰 'young trip' 워드마크 이미지(assets/splash.png) 한 장을 화면에 꽉 채운다(2026-10-17 개편).
 * 이미지와 화면 비율이 달라도 가장자리가 끊기지 않게 같은 색(surfaceC.splash)을 바탕에 깐다.
 * 워드마크 바로 아래에 워드마크 폭의 로딩 바를 그린다. cover 배율을 같이 계산해 어느 화면에서도 글자 밑에 붙는다.
 * 이미지를 받기 전에는 바탕만 두고, 받으면 워드마크와 바를 함께 페이드로 드러낸 뒤 onShown을 부른다.
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
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [shownAt, setShownAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const shownRef = useRef(false);

  // 이미지 onLoad·onError·시한 중 먼저 온 한 번만 드러낸다
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

  // resizeMode cover: 화면을 다 덮는 쪽 배율로 키우고 가운데 맞춘다
  const scale = Math.max(size.w / IMG.w, size.h / IMG.h);
  const barWidth = (MARK.right - MARK.left) * scale;
  const barTop = size.h / 2 + (MARK.bottom + BAR_GAP - IMG.h / 2) * scale;

  return (
    <View
      style={{ flex: 1, backgroundColor: surfaceC.splash }}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityRole="progressbar"
      accessibilityLabel={`Young Trip, ${label}`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
    >
      <Animated.View style={{ flex: 1, opacity }}>
        <Image
          source={SPLASH}
          resizeMode="cover"
          fadeDuration={0}
          onLoad={show}
          onError={show}
          style={{ flex: 1, width: '100%' }}
        />
        {size.w > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: barTop,
              left: (size.w - barWidth) / 2,
              width: barWidth,
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              backgroundColor: surfaceC.splashBarTrack,
              overflow: 'hidden',
            }}
          >
            <View style={{ width: `${filled * 100}%`, height: '100%', backgroundColor: surfaceC.splashBarFill }} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
