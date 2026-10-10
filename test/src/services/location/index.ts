import type { LocationProvider } from '../../core/ports';
import { createExpoLocation } from './device';

/**
 * 기기 위치 제공자(WP5 소유). 시뮬레이터가 켜지면 registry.overrideServices로 sim.ts가 덮는다.
 * 앱이 떠 있을 때 쓴다. 백그라운드 동선 기록(옵션, 기본 꺼짐)은 background.ts가 맡고 스토어(store/live)가 직접 부른다.
 */
export function createDeviceLocation(): LocationProvider {
  return createExpoLocation();
}
