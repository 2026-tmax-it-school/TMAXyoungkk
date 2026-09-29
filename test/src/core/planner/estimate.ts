import type { LatLng, Transport } from '../../types';
import { DETOUR_FACTOR, FALLBACK_SPEED_KMH } from '../constants';
import { haversineKm } from '../util';

/**
 * 직선거리 추정(WP4 소유, 순수). FR-501 예외 "경로 API 실패 시 직선거리 기준"과
 * 아직 조회하지 않은 구간의 임시 값이 이 함수 하나를 쓴다. 로컬 경로 제공자도 같은 식이라
 * 키 없는 환경에서는 계획의 추정과 제공자 값이 같다.
 */

/** 주차·신호·진입 같은 구간 고정 비용(분) */
const OVERHEAD_MIN: Record<Transport, number> = { car: 4, walk: 1, transit: 6 };

export function estimateMeters(a: LatLng, b: LatLng, transport: Transport): number {
  return Math.round(haversineKm(a, b) * DETOUR_FACTOR[transport] * 1000);
}

export function estimateMinutes(a: LatLng, b: LatLng, transport: Transport): number {
  if (sameCoord(a, b)) return 0;
  const km = haversineKm(a, b) * DETOUR_FACTOR[transport];
  const minutes = (km / FALLBACK_SPEED_KMH[transport]) * 60;
  return Math.max(1, Math.round(minutes + OVERHEAD_MIN[transport]));
}

/** 소수 5자리(약 1m)까지 같으면 같은 지점 */
export function sameCoord(a: LatLng, b: LatLng): boolean {
  return coordKey(a) === coordKey(b);
}

export function coordKey(c: LatLng): string {
  return `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

/**
 * 경로가 없을 때 대신 계산할 수단(FR-504). 자동차가 없으면 도보, 대중교통이 없으면 자동차,
 * 도보가 없으면 자동차다(프로토타입 가정).
 */
export const FALLBACK_TRANSPORT: Record<Transport, Transport> = { car: 'walk', transit: 'car', walk: 'car' };
