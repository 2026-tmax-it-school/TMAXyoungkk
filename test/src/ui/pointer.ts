import { StyleSheet } from 'react-native';

/**
 * 누름 통과 스타일(2026-10-22). View의 pointerEvents 속성은 react-native-web 0.21에서 지원 중단 경고가 나서
 * style로 준다. 인라인 style의 pointerEvents는 웹에서 버려지므로(ui/Toast 주석) 반드시 이 StyleSheet 값을 쓴다.
 */
export const PE = StyleSheet.create({
  none: { pointerEvents: 'none' },
  boxNone: { pointerEvents: 'box-none' },
});
