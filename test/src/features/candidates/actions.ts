import type { LatLng, Place, Trip } from '../../types';
import { isBasePlace } from '../../core/extract';
import { manualSpot, planManualAdd, type ManualPick } from '../../core/extract/manual';
import { regionById } from '../../data/regions';
import { getServices } from '../../services/registry';
import { myMemberId, useTrips, type DispatchResult } from '../../store/trips';

/**
 * 후보 조작(WP3 소유). 06 수동 등록·지도 선택, 07 상세, 23 추천이 같이 쓴다.
 * 판정은 core/extract/manual.ts(순수, wp3-candidates 테스트)에 있고 여기서는 제공자와 스토어를 잇기만 한다.
 */

/** 지도에서 누른 지점 근처로 볼 반경(m) */
export const MAP_PICK_RADIUS_M = 300;

export type SearchOutcome = ManualPick | { kind: 'error'; text: string };

export async function searchForManual(trip: Trip, query: string): Promise<SearchOutcome> {
  const region = regionById(trip.region);
  if (!region) return { kind: 'error', text: '여행방 지역을 찾을 수 없습니다' };
  const q = query.trim();
  if (q.length < 2) return { kind: 'error', text: '두 글자 이상 입력해 주세요' };
  try {
    const results = await getServices().places.search(q, region, region.center);
    return planManualAdd(results, region, trip);
  } catch {
    return { kind: 'error', text: '장소 검색에 실패했습니다. 잠시 뒤 다시 시도해 주세요' };
  }
}

export async function pickAtCoord(trip: Trip, coord: LatLng): Promise<SearchOutcome> {
  const region = regionById(trip.region);
  if (!region) return { kind: 'error', text: '여행방 지역을 찾을 수 없습니다' };
  try {
    const place = await getServices().places.at(coord, MAP_PICK_RADIUS_M);
    // 기점 장소(숙소·역)는 지도 선택으로 후보가 되지 않는다.
    return planManualAdd(place && !isBasePlace(trip, place) ? [place] : [], region, trip);
  } catch {
    return { kind: 'error', text: '지도에서 장소를 고르지 못했습니다. 잠시 뒤 다시 시도해 주세요' };
  }
}

/** 장소를 후보에 담는다. 같은 장소가 이미 후보면 제안자만 늘어난다(spot/add 병합). 제안자는 지금 행동하는 멤버다. */
export function addPlace(tripId: string, place: Place, outside: boolean, opts: { quiet?: boolean } = {}): DispatchResult {
  const { ids, clock } = getServices();
  const doc = useTrips.getState().docs[tripId];
  const me = doc ? myMemberId(doc) : undefined;
  if (!me) return { ok: false, reason: '이 여행방의 멤버가 아닙니다' };
  return useTrips.getState().dispatch(
    tripId,
    { type: 'spot/add', spot: manualSpot(place, { id: ids.next('spot'), memberId: me, at: clock.now(), outside }) },
    { actorId: me, quiet: opts.quiet },
  );
}
