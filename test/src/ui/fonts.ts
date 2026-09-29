import { GothicA1_400Regular } from '@expo-google-fonts/gothic-a1/400Regular';
import { GothicA1_600SemiBold } from '@expo-google-fonts/gothic-a1/600SemiBold';
import { GothicA1_700Bold } from '@expo-google-fonts/gothic-a1/700Bold';
import { GothicA1_800ExtraBold } from '@expo-google-fonts/gothic-a1/800ExtraBold';

import { F } from './tokens';

/**
 * 폰트 자산. 폰트 패키지는 이 파일에서만, 굵기별 서브패스로만 불러온다.
 * 패키지 루트에서 불러오면 굵기 18개 ttf가 전부 번들에 들어간다(웹 export ttf는 정확히 4개여야 한다).
 * 키가 family 이름이다. tokens.F와 같다. 부팅(bootstrap)이 이 순서대로 Font.loadAsync를 부른다.
 */
export const FONT_ASSETS = {
  [F.title]: GothicA1_800ExtraBold,
  [F.regular]: GothicA1_400Regular,
  [F.semibold]: GothicA1_600SemiBold,
  [F.bold]: GothicA1_700Bold,
} as const;

export const FONT_LABELS: Record<keyof typeof FONT_ASSETS, string> = {
  [F.title]: '제목 글꼴(고딕 굵게)',
  [F.regular]: '본문 글꼴',
  [F.semibold]: '본문 글꼴(중간)',
  [F.bold]: '본문 글꼴(굵게)',
};
