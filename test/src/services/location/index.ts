import type { LocationProvider } from '../../core/ports';
import { createExpoLocation } from './device';

/**
 * 기기 위치 제공자(WP5 소유). 시뮬레이터가 켜지면 registry.overrideServices로 sim.ts가 덮는다.
 * 앱이 떠 있을 때만 쓴다. 백그라운드 상시 추적은 범위 밖이다.
 */
export function createDeviceLocation(): LocationProvider {
  return createExpoLocation();
}
