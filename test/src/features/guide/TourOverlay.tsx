import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { navRef } from '../../navigation/devNav';
import { Btn, Chip, PE, R, Row, SP, surfaceC, Txt, useTour, lineC } from '../../ui';
import { useActiveTrip } from '../trip/useActiveTrip';
import { holeLayout, rectVisible, tooltipBox, tooltipTop, tourCounter, tourSteps, tourText, type TourScreen } from './tour';

/** 안내가 비출 화면을 연다(탭 화면이거나 채팅) */
function openScreen(screen: TourScreen, tripId: string | undefined): void {
  if (!navRef.isReady()) return;
  if (screen === 'Chat') {
    if (tripId) navRef.navigate('Chat', { tripId });
    return;
  }
  navRef.navigate('Main', { screen });
}

/**
 * 앱 둘러보기 스포트라이트(2026-10-24). 켜져 있는 동안 화면 전체를 그림자로 덮고, 지금 설명하는 기능만 밝게 비춘다.
 * 설명 풍선(제목·한두 줄·이전/다음/건너뛰기)은 비춘 자리 아래(없으면 위)에 뜨고, 넓은 화면에서도 440 폭을 넘지 않는다. 다음을 누르면 화면을 넘겨 다음 기능을 비춘다.
 * 비출 자리가 화면 밖이거나 2.5초 안에 못 찾으면 풍선만 가운데에 보인다. 그림자 부분을 눌러도 아래 화면은 눌리지 않는다.
 */
export function TourOverlay() {
  const active = useTour((s) => s.active);
  const index = useTour((s) => s.index);
  const rect = useTour((s) => s.rect);
  const { trip } = useActiveTrip();
  const steps = useMemo(() => tourSteps(!!trip), [trip]);
  const step = steps[index];
  const { width, height } = useWindowDimensions();
  const [tipH, setTipH] = useState(190);
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (!active || !step) return undefined;
    setLate(false);
    openScreen(step.screen, trip?.id);
    // 화면이 바뀐 뒤에 비출 자리를 찾는다
    const find = setTimeout(() => useTour.getState().setTarget(step.target), 350);
    const giveUp = setTimeout(() => setLate(true), 2500);
    return () => {
      clearTimeout(find);
      clearTimeout(giveUp);
    };
  }, [active, index, step?.id]);

  // 단계 목록이 줄어(여행방이 생김·없어짐) 지금 단계가 없어지면 끝낸다
  useEffect(() => {
    if (active && !step) useTour.getState().stop();
  }, [active, step]);

  if (!active || !step) return null;

  const screen = { w: width, h: height };
  const shows = rectVisible(rect, screen);
  const ready = shows || late;
  const layout = shows && rect ? holeLayout(rect, screen) : undefined;
  const last = index === steps.length - 1;
  const top = tooltipTop(shows ? rect : undefined, screen, tipH);
  const tipBox = tooltipBox(shows ? rect : undefined, screen, SP.gutter);
  const box = (r: { x: number; y: number; w: number; h: number }) => ({ left: r.x, top: r.y, width: r.w, height: r.h });

  return (
    <View
      style={styles.root}
      // 그림자 부분을 눌러도 아래 화면이 눌리지 않게 막는다
      onStartShouldSetResponder={() => true}
      accessibilityViewIsModal
      {...(Platform.OS === 'web' ? ({ role: 'dialog', 'aria-label': `앱 둘러보기 ${tourCounter(index, steps.length)}` } as object) : null)}
    >
      {layout ? (
        <>
          {[layout.top, layout.bottom, layout.left, layout.right].map((r, i) => (
            <View key={i} style={[styles.dim, box(r)]} />
          ))}
          <View style={[styles.ring, box(layout.hole)]} />
        </>
      ) : (
        <View style={[styles.dim, styles.fill]} />
      )}
      {ready ? (
        <View
          onLayout={(e) => setTipH(e.nativeEvent.layout.height)}
          style={[styles.tip, { top, left: tipBox.left, width: tipBox.width }]}
        >
          <Row gap={SP.m}>
            <Chip text={tourCounter(index, steps.length)} tone="soft" />
            <View style={styles.grow} />
            <Btn title="건너뛰기" variant="quiet" size="sm" onPress={() => useTour.getState().stop()} />
          </Row>
          <Txt v="ttl">{step.title}</Txt>
          <Txt v="body">{tourText(step, width)}</Txt>
          <Row gap={SP.m}>
            <View style={styles.grow}>
              <Btn title="이전" variant="quiet" disabled={index === 0} onPress={() => useTour.getState().go(Math.max(0, index - 1))} />
            </View>
            <View style={styles.grow2}>
              <Btn
                title={last ? '끝내기' : '다음'}
                onPress={() => (last ? useTour.getState().stop() : useTour.getState().go(index + 1))}
              />
            </View>
          </Row>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 },
  dim: { position: 'absolute', backgroundColor: surfaceC.tourDim },
  fill: { top: 0, left: 0, right: 0, bottom: 0 },
  ring: { position: 'absolute', borderWidth: 3, borderColor: surfaceC.lime, borderRadius: R.card, ...PE.none },
  tip: {
    position: 'absolute',
    gap: SP.l,
    padding: SP.cardPad,
    borderRadius: R.sheet,
    backgroundColor: surfaceC.card,
    borderWidth: 1,
    borderColor: lineC.line,
  },
  grow: { flex: 1 },
  grow2: { flex: 2 },
});
