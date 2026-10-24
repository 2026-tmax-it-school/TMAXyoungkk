import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * 키보드가 입력 칸과 아래 버튼을 가리지 않게 내용을 밀어 올린다(화면·시트·글쓰기가 같이 쓴다).
 * iOS와 안드로이드 둘 다 padding이다. Expo SDK 57(RN 0.86)은 안드로이드가 edge-to-edge 고정이라
 * 창 크기 조정(adjustResize)으로는 창이 줄지 않는다. 그래서 안드로이드도 키보드 높이만큼 직접 띄운다.
 * 웹은 키보드가 창을 줄이므로 아무것도 하지 않는다.
 */
export function KeyboardAvoid({ children, offset = 0 }: { children?: React.ReactNode; offset?: number }) {
  // offset: 이 칸 위에 화면 위 가장자리까지 차지하는 것(안전 영역 위쪽 등)이 있으면 그 높이. KeyboardAvoidingView는
  // 자기 위치(onLayout)를 부모 기준으로 재서, 부모가 화면 위에서 떨어져 있으면 그만큼 키보드가 입력줄을 덮는다
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'web' ? 0 : offset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

/** 앱(iOS·안드로이드)에서 키보드가 떠 있는지. 웹은 늘 false */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // iOS는 will 이벤트가 있어 패딩이 키보드와 같이 움직인다. 안드로이드는 did만 온다
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEv, () => setShown(true));
    const b = Keyboard.addListener(hideEv, () => setShown(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return shown;
}

/**
 * 맨 아래 입력줄·버튼 줄의 아래 안전 영역. 키보드가 떠 있으면 키보드가 홈 표시줄·내비게이션 바를 덮으므로 0이다
 * (그대로 두면 KeyboardAvoid가 띄운 위에 빈 칸이 한 번 더 생긴다).
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  return keyboard ? 0 : insets.bottom;
}
