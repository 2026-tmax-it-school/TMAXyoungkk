import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';

import { backTarget, type TabRouteName } from './routes';

export { backTarget, type BackTarget } from './routes';

/**
 * 탭 맨 위 화면(후보·시간표·지도·커뮤니티·프로필 탭)의 뒤로 버튼. 탭에는 쌓인 화면이 없어서 늘 홈 탭으로 간다(2026-10-17).
 * 이미 홈이면 쓰지 않는다(홈에는 뒤로 버튼을 두지 않는다).
 */
export function useHomeBack(): () => void {
  const navigation = useNavigation();
  return useCallback(() => navigation.navigate('Main', { screen: 'Home' }), [navigation]);
}

/**
 * 머리말 뒤로 버튼(Header back)에 넘길 함수. 늘 함수를 돌려준다.
 * 쌓인 화면이 있으면 goBack, 없으면(딥링크·웹 새로고침으로 바로 연 화면) 대체 탭(fallback, 기본 홈)으로 간다.
 * 판단은 순수 backTarget(routes.ts)이 한다.
 */
export function useBack(fallback: TabRouteName = 'Home'): () => void {
  const navigation = useNavigation();
  return useCallback(() => {
    const t = backTarget(navigation.canGoBack(), fallback);
    if (t.kind === 'back') navigation.goBack();
    else navigation.navigate('Main', { screen: t.screen });
  }, [navigation, fallback]);
}
