import type { LocationPermission } from '../ports';

/**
 * 여행 진행 모드 판정(FR-601, WP5 소유, 순수).
 * 위치 권한이 없으면(거부·모름) 수동 진행 모드다. 계획 열람과 도착 처리 버튼은 그대로 쓴다.
 */
export type LiveMode = 'off' | 'sim' | 'device' | 'manual';

export function liveModeFor(requested: 'sim' | 'device' | 'manual', permission: LocationPermission): LiveMode {
  if (requested === 'manual') return 'manual';
  return permission === 'granted' ? requested : 'manual';
}
