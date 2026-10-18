import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Btn, IconBtn } from './Btn';
import { KeyboardAvoid, useBottomInset } from './KeyboardAvoid';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC } from './tokens';

/** 시트 패널의 최대 높이(창 높이 대비) */
const SHEET_MAX_RATIO = 0.85;
/** 열기: 패널이 먼저 올라오고(SLIDE_IN) 그다음 뒤 배경이 어두워진다(DIM_IN). 닫기는 둘을 함께 거둔다 */
export const SHEET_SLIDE_IN_MS = 240;
export const SHEET_DIM_IN_MS = 180;
export const SHEET_OUT_MS = 180;
const NATIVE = Platform.OS !== 'web';
const DIM = 'rgba(26,16,20,0.32)';

/**
 * 아래에서 올라오는 시트. 라운드 16, 위쪽 잡이.
 * - 2026-10-17: Modal 기본 'slide'는 어두운 배경까지 같이 밀려 올라왔다. 이제 Modal은 애니메이션 없이 띄우고,
 *   패널만 아래에서 올라온 뒤 뒤 배경이 서서히 어두워진다(배경은 제자리). 닫을 때는 배경이 걷히며 패널이 내려간 다음 Modal을 내린다.
 * - 패널은 늘 KeyboardAvoid(iOS·안드로이드 padding) 안에 있어 키보드가 시트 입력 칸과 버튼을 가리지 않는다.
 * - scroll이 켜졌을 때 패널 높이는 창 높이의 85%까지이고 넘치는 내용은 안에서 스크롤한다.
 *   scroll이 꺼진 시트는 상한을 두지 않는다(줄일 수 없는 내용이 화면 아래로 잘리지 않게, 예: 날짜 고르기 달력).
 * - scroll: 내용을 ScrollView로 감싼다(기본 꺼짐). 켜면 키보드가 열린 채로 결과를 처음 누를 때 바로 눌린다(handled).
 *   FlatList나 검색 목록이 든 시트(직접 추가, 동명 장소 고르기, 기점 검색, 묶음 목록)는 중첩 VirtualizedList가 되지 않게 꺼 둔다.
 * - title이 있으면 오른쪽에 닫기 아이콘 버튼을 둔다.
 */
export function Sheet({
  visible,
  onClose,
  title,
  scroll = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  scroll?: boolean;
  children?: React.ReactNode;
}) {
  const bottom = useBottomInset();
  const { height } = useWindowDimensions();
  // 닫는 애니메이션 동안에는 visible이 꺼져도 Modal을 띄워 둔다
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      slide.setValue(0);
      dim.setValue(0);
      Animated.sequence([
        Animated.timing(slide, { toValue: 1, duration: SHEET_SLIDE_IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
        Animated.timing(dim, { toValue: 1, duration: SHEET_DIM_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
      ]).start();
      return;
    }
    Animated.parallel([
      Animated.timing(dim, { toValue: 0, duration: SHEET_OUT_MS, useNativeDriver: NATIVE }),
      Animated.timing(slide, { toValue: 0, duration: SHEET_OUT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, slide, dim]);
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      {/* 뒤 배경: 제자리에서 어두워진다(같이 밀려 올라오지 않는다) */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DIM, opacity: dim }]} />
      <KeyboardAvoid>
        <Pressable accessibilityLabel="닫기" onPress={onClose} style={{ flex: 1 }} />
        <Animated.View
          style={{
            maxHeight: scroll ? Math.round(height * SHEET_MAX_RATIO) : undefined,
            backgroundColor: surfaceC.card,
            borderTopWidth: 1,
            borderTopColor: lineC.line,
            borderTopLeftRadius: R.sheet,
            borderTopRightRadius: R.sheet,
            paddingTop: SP.xl,
            paddingHorizontal: SP.gutter,
            paddingBottom: SP.section + bottom,
            gap: SP.xl,
            transform: [{ translateY }],
          }}
        >
          <View
            style={{
              width: H.grabberW,
              height: H.grabberH,
              borderRadius: H.grabberH / 2,
              backgroundColor: surfaceC.grabber,
              alignSelf: 'center',
            }}
          />
          {title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.m }}>
              <View accessibilityRole="header" style={{ flex: 1 }}>
                <Txt v="ttlSm">{title}</Txt>
              </View>
              <IconBtn icon="x" label="닫기" onPress={onClose} />
            </View>
          ) : null}
          {scroll ? (
            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ gap: SP.xl }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </Animated.View>
      </KeyboardAvoid>
    </Modal>
  );
}

/**
 * 삭제·나가기·내보내기·계정 탈퇴 확인 1회. 위험 색을 쓰지 않는다.
 * 버튼은 확인과 취소 둘뿐이다. cancelLabel로 취소 글자를 바꾸고('계속 만들기'), confirmDisabled로 확인을 끈다.
 * children은 설명 아래에 덧붙이는 내용(이유 한 줄 등)이다.
 * 이 함수 뒤에는 버튼을 그리는 다른 컴포넌트를 두지 않는다(wp6 테스트가 이 아래 버튼 수를 센다).
 */
export function ConfirmSheet({
  visible,
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = '취소',
  confirmDisabled,
  children,
}: {
  visible: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      <Txt v="body" c="muted">
        {text}
      </Txt>
      {children}
      <View style={{ gap: 9 }}>
        <Btn title={confirmLabel} onPress={onConfirm} disabled={confirmDisabled} />
        <Btn title={cancelLabel} variant="quiet" onPress={onCancel} />
      </View>
    </Sheet>
  );
}
