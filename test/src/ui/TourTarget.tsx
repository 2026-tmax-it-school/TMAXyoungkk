import React, { useEffect, useRef } from 'react';
import { Dimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTour } from './tourStore';

/**
 * 앱 둘러보기가 비출 수 있는 자리 표시(2026-10-24). 평소에는 그냥 View(레이아웃은 style로만 바뀐다).
 * 안내가 이 id를 비추는 동안에만 화면 좌표를 재서 알린다(0.25초마다, 스크롤·화면 전환 중에도 따라간다).
 */
export function TourTarget({ id, style, children }: { id: string; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const ref = useRef<View>(null);
  const on = useTour((s) => s.active && s.targetId === id);
  useEffect(() => {
    if (!on) return undefined;
    let scrolled = false;
    const measure = () => {
      ref.current?.measureInWindow((x, y, w, h) => {
        if (w <= 0 || h <= 0) return;
        // 화면 밖이면 한 번 스크롤해서 보이게 한다(웹. 앱에서는 풍선만 가운데에 뜬다)
        const screenH = Dimensions.get('window').height;
        if (!scrolled && (y + h > screenH - 160 || y < 0)) {
          scrolled = true;
          (ref.current as unknown as { scrollIntoView?: (o: object) => void } | null)?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
          return;
        }
        useTour.getState().setRect(id, { x, y, w, h });
      });
    };
    measure();
    const t = setInterval(measure, 250);
    return () => clearInterval(t);
  }, [on, id]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}
