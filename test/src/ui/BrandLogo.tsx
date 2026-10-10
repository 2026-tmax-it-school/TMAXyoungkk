import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { brandC, H } from './tokens';

/**
 * 소셜 로그인 로고(15 로그인 카카오·구글 버튼 전용). 24 viewBox SVG이고 색은 tokens.brandC만 쓴다.
 * - kakao: 검정 말풍선 심볼(카카오 로그인 디자인 가이드)
 * - google: 네 색 'G'(구글 로그인 브랜드 가이드)
 * 장식용으로 다른 화면에 쓰지 않는다.
 */
export function BrandLogo({ brand, size = H.brandLogo }: { brand: 'kakao' | 'google'; size?: number }) {
  if (brand === 'kakao') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
        <Path
          fill={brandC.kakaoSymbol}
          d="M12 3.2c-5.25 0-9.5 3.33-9.5 7.44 0 2.66 1.78 4.99 4.46 6.3l-.92 3.37c-.08.3.26.54.52.37l4.04-2.68c.46.05.93.08 1.4.08 5.25 0 9.5-3.33 9.5-7.44S17.25 3.2 12 3.2z"
        />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        fill={brandC.googleBlue}
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <Path
        fill={brandC.googleGreen}
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <Path
        fill={brandC.googleYellow}
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <Path
        fill={brandC.googleRed}
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </Svg>
  );
}
