import { useWindowDimensions } from 'react-native';

/**
 * 넓은 화면 대응(2026-10-22). 화면 안쪽은 폰(390) 디자인 그대로 두고, 틀만 넓이에 맞춘다.
 * 기준은 기기 이름이 아니라 실측이다: 1024px에서 넘침은 없었지만 주 버튼이 화면의 60% 넘게 늘어나고
 * 카드 줄은 왼쪽에 붙고 하단 탭 다섯 칸이 흩어졌다. 폰 한 줄 구성이 640px를 넘으면 줄이 길어진다.
 * - phone(768 미만): 지금 그대로
 * - tablet(768 이상): 본문·하단 탭·시트를 가운데 640 칸에
 * - desktop(1100 이상): 하단 탭 대신 왼쪽 세로 메뉴(220), 본문은 가운데 720 칸
 */
export type LayoutMode = 'phone' | 'tablet' | 'desktop';

export const BP_TABLET = 768;
export const BP_DESKTOP = 1100;
export const CONTENT_MAX_TABLET = 640;
export const CONTENT_MAX_DESKTOP = 720;
export const RAIL_W = 220;
/** 시트 패널 최대 폭(넓은 화면) */
export const SHEET_MAX_W = 560;

export interface Layout {
  mode: LayoutMode;
  /** 본문 칸 최대 폭. 폰이면 없음(화면 폭 그대로) */
  contentMax?: number;
  /** 왼쪽 세로 메뉴를 쓰는지 */
  rail: boolean;
}

/** 화면 폭(px) → 틀 배치(순수) */
export function layoutFor(width: number): Layout {
  if (width >= BP_DESKTOP) return { mode: 'desktop', contentMax: CONTENT_MAX_DESKTOP, rail: true };
  if (width >= BP_TABLET) return { mode: 'tablet', contentMax: CONTENT_MAX_TABLET, rail: false };
  return { mode: 'phone', rail: false };
}

export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  return layoutFor(width);
}
