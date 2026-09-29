import React from 'react';

import { Notice } from '../../../ui';

/** 13·19 상단 띠. line 톤이다(앰버 띠는 쓰지 않는다). */
export const SIM_BANNER_TEXT = '여행 시뮬레이터로 재생 중 · 실제 위치 아님';

export function SimBanner() {
  return <Notice icon="play" text={SIM_BANNER_TEXT} />;
}
