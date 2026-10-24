import { createNavigationContainerRef } from '@react-navigation/native';

import { DEMO_TOOLS } from '../config';
import { useTour } from '../ui/tourStore';
import type { RootStackParamList } from './routes';

/**
 * 루트 내비게이션 ref. 시연 도구(EXPO_PUBLIC_DEMO_TOOLS)가 켜진 웹에서만 window.__ytNav로 내보내
 * 화면 점검 때 스택 화면을 주소 없이 바로 연다(스택 화면은 새로고침하면 홈으로 돌아간다). 일반 빌드에는 붙지 않는다.
 */
export const navRef = createNavigationContainerRef<RootStackParamList>();

if (DEMO_TOOLS && typeof window !== 'undefined') {
  (window as unknown as { __ytNav?: typeof navRef; __ytTour?: typeof useTour }).__ytNav = navRef;
  (window as unknown as { __ytTour?: typeof useTour }).__ytTour = useTour;
}
