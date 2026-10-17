import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { nextOnTap, sheetHeights, SNAP_LABEL, snapAfterDrag, stepA11y, type SheetHeights, type SheetSnap } from './sheetSnap';
import { E, H, R, surfaceC } from './tokens';

/** 손잡이 줄 높이. 위아래 hitSlop으로 누르는 높이 44를 맞춘다 */
const GRIP_ROW_H = 24;
const GRIP_SLOP = (H.touch - GRIP_ROW_H) / 2;
/** 이만큼 넘게 세로로 움직여야 끌기로 본다(그 전에는 머리의 버튼이 누름을 받는다) */
const DRAG_START_PX = 4;

const DEFAULT_SNAPS: readonly SheetSnap[] = ['peek', 'full'];

/**
 * 화면 안 하단 시트(모달이 아님). 지도 탭과 채팅방 지도가 지도 위에 두고 mini·peek·full에 붙인다.
 * - 높이는 Animated 값이고 Animated.spring(useNativeDriver false)으로 움직인다. 스냅 높이는 sheetSnap.sheetHeights(areaHeight, maxRatio)에
 *   heights로 덮어쓴 값이다. areaHeight는 부모가 onLayout으로 잰 지도 영역 높이다(0이면 그리지 않는다).
 * - 끌기: 손잡이 줄과 head 감싸개에만 PanResponder를 단다. 시작할 때는 잡지 않고(onStartShouldSetPanResponder false),
 *   세로로 4px 넘게, 가로보다 많이 움직일 때만 잡는다. 그래서 head 안의 IconBtn·Pressable은 탭을 그대로 받는다.
 *   놓을 때는 snapAfterDrag로 위치·속도에 맞는 스냅을 고르고, 탭은 처리하지 않는다(한 번 눌러 두 번 바뀌지 않게).
 * - 끌지 않는 길: 손잡이를 누르면 nextOnTap, 스크린리더는 손잡이(adjustable)의 increment '펼치기' / decrement '접기'.
 * - mini 스냅에서 mini가 있으면 head와 children 대신 mini 한 줄을 그린다.
 * - 웹: 손잡이·head에 cursor grab과 touchAction none을 준다(브라우저 스크롤이 끌기를 가로채지 않게). RN Web은 마우스도 응답자로 받는다.
 * - bottomInset: 탭 바 없이 화면 맨 아래에 닿는 시트(채팅방 지도)는 아래 안전 영역만큼 더 높게 그리고 그만큼 안쪽을 띄운다.
 *   onSettle도 그 높이를 더해 알린다. 부모는 areaHeight에서 그만큼 빼서 넘긴다(펼친 시트가 위로 넘치지 않게).
 * - 표면은 카드색, 위쪽만 R.sheet 라운드, 지도 위에 뜨므로 E.float 그림자다.
 */
export function PeekSheet({
  snap,
  onSnap,
  snaps = DEFAULT_SNAPS,
  areaHeight,
  maxRatio,
  heights,
  head,
  mini,
  children,
  style,
  gripLabel,
  onSettle,
  bottomInset = 0,
}: {
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  snaps?: readonly SheetSnap[];
  areaHeight: number;
  maxRatio?: number;
  heights?: Partial<SheetHeights>;
  head: React.ReactNode;
  mini?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  gripLabel: string;
  onSettle?: (h: number) => void;
  /** 시트가 화면 맨 아래에 닿을 때(탭 바가 없는 화면) 아래 안전 영역. 스냅 높이 위에 더해 내용이 홈 표시줄·내비게이션 바에 가리지 않는다 */
  bottomInset?: number;
}) {
  const hs: SheetHeights = { ...sheetHeights(areaHeight, maxRatio), ...heights };
  const target = hs[snap];
  const ready = areaHeight > 0;

  const anim = useRef(new Animated.Value(ready ? target : 0)).current;
  const current = useRef(ready ? target : 0);
  const placed = useRef(ready);
  const dragFrom = useRef(0);
  useEffect(() => {
    const id = anim.addListener(({ value }) => {
      current.current = value;
    });
    return () => anim.removeListener(id);
  }, [anim]);

  // 렌더마다 최신 값을 PanResponder(한 번 만든다)에 넘긴다
  const latest = useRef({ hs, snaps, snap, onSnap, onSettle, bottomInset });
  latest.current = { hs, snaps, snap, onSnap, onSettle, bottomInset };

  const settle = (to: number) => {
    Animated.spring(anim, { toValue: to, useNativeDriver: false, bounciness: 0, speed: 18 }).start(({ finished }) => {
      if (finished) latest.current.onSettle?.(to + latest.current.bottomInset);
    });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  useEffect(() => {
    if (!ready) return;
    if (!placed.current) {
      // 처음 잰 높이에서는 움직이지 않고 바로 놓는다
      placed.current = true;
      anim.setValue(target);
      latest.current.onSettle?.(target + bottomInset);
      return;
    }
    settleRef.current(target);
  }, [ready, target, anim]);

  const shown = useMemo(() => (bottomInset > 0 ? Animated.add(anim, bottomInset) : anim), [anim, bottomInset]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > DRAG_START_PX && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          // 움직이던 스프링을 멈추고 그 높이에서 끌기 시작한다(JS 구동이라 콜백이 바로 불린다)
          dragFrom.current = current.current;
          anim.stopAnimation((v) => {
            dragFrom.current = v;
          });
        },
        onPanResponderMove: (_e, g) => {
          const { hs: h, snaps: list } = latest.current;
          const range = list.length > 0 ? list.map((s) => h[s]) : [h.peek, h.full];
          const lo = Math.min(...range);
          const hi = Math.max(...range);
          anim.setValue(Math.max(lo, Math.min(hi, dragFrom.current - g.dy)));
        },
        onPanResponderRelease: (_e, g) => {
          const { hs: h, snaps: list, snap: now, onSnap: change } = latest.current;
          const next = snapAfterDrag(dragFrom.current - g.dy, g.vy, h, list);
          settleRef.current(h[next]);
          if (next !== now) change(next);
        },
        onPanResponderTerminate: () => {
          const { hs: h, snap: now } = latest.current;
          settleRef.current(h[now]);
        },
      }),
    [anim],
  );

  if (!ready) return null;

  const onA11y = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name !== 'increment' && name !== 'decrement') return;
    const next = stepA11y(snap, name, snaps);
    if (next !== snap) onSnap(next);
  };
  const showMini = snap === 'mini' && mini != null;

  return (
    <Animated.View style={[styles.sheet, { height: shown, paddingBottom: bottomInset }, style]}>
      <View {...pan.panHandlers} style={styles.dragArea}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={gripLabel}
          accessibilityValue={{ text: SNAP_LABEL[snap] }}
          accessibilityActions={[
            { name: 'increment', label: '펼치기' },
            { name: 'decrement', label: '접기' },
          ]}
          onAccessibilityAction={onA11y}
          onPress={() => {
            const next = nextOnTap(snap, snaps);
            if (next !== snap) onSnap(next);
          }}
          hitSlop={{ top: GRIP_SLOP, bottom: GRIP_SLOP }}
          style={styles.gripRow}
        >
          <View style={styles.grabber} />
        </Pressable>
        {showMini ? mini : head}
      </View>
      {showMini ? null : <View style={styles.body}>{children}</View>}
    </Animated.View>
  );
}

const WEB_DRAG: ViewStyle = Platform.select<ViewStyle>({
  web: { cursor: 'grab', touchAction: 'none' } as unknown as ViewStyle,
  default: {},
});

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: surfaceC.card,
    borderTopLeftRadius: R.sheet,
    borderTopRightRadius: R.sheet,
    ...E.float,
  },
  dragArea: {
    ...WEB_DRAG,
  },
  gripRow: {
    minHeight: GRIP_ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
    ...WEB_DRAG,
  },
  grabber: {
    width: H.grabberW,
    height: H.grabberH,
    borderRadius: H.grabberH / 2,
    backgroundColor: surfaceC.grabber,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
});
