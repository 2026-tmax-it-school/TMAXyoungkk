import type { FreeTime, LatLng, Place } from '../../types';
import { FREE_TIME_MIN, WALKABLE_RADIUS_M } from '../constants';
import type { PlaceProvider } from '../ports';

/**
 * 빈 시간 추천(FR-604, 3차, WP5 소유, 순수).
 * 다음 일정까지 30분 이상 남으면 도보 이동 가능 반경(WALKABLE_RADIUS_M 800m, 프로토타입 가정) 안에서 2~3곳을 고른다.
 * 29분이면 찾지 않는다. 주변 결과가 2곳 미만이면 추천을 생략하고 아무것도 보이지 않는다
 * (명세 출력이 '장소 2~3개'라 1곳만 보이는 반쪽 추천은 만들지 않는다).
 */

export const FREE_TIME_MIN_PLACES = 2;
export const FREE_TIME_MAX_PLACES = 3;

export function pickFreeTime(gapMin: number, until: number, nearby: Place[]): FreeTime | null {
  if (gapMin < FREE_TIME_MIN) return null;
  if (nearby.length < FREE_TIME_MIN_PLACES) return null;
  return { until, places: nearby.slice(0, FREE_TIME_MAX_PLACES) };
}

export async function findFreeTime(input: {
  gapMin: number;
  until: number;
  position: LatLng;
  places: Pick<PlaceProvider, 'nearby'>;
  excludePlaceIds: string[];
}): Promise<FreeTime | null> {
  if (input.gapMin < FREE_TIME_MIN) return null;
  let found: Place[] = [];
  try {
    found = await input.places.nearby(input.position, WALKABLE_RADIUS_M, {
      excludePlaceIds: input.excludePlaceIds,
      limit: FREE_TIME_MAX_PLACES,
    });
  } catch {
    return null;
  }
  return pickFreeTime(input.gapMin, input.until, found);
}
