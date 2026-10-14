import React from 'react';

import { Notice } from '../../../ui';

/**
 * 13 상단 띠와 19 상태 줄의 진행 방식 칩 글자. line 톤이다(앰버 띠는 쓰지 않는다).
 * 19는 띠 대신 상태 줄 왼쪽 칩에 이 글자를 쓴다(안내 상자를 쌓지 않는다).
 */
export const SIM_BANNER_TEXT = '시뮬레이터 · 실제 위치 아님';

export function SimBanner() {
  return <Notice icon="play" text={SIM_BANNER_TEXT} />;
}
