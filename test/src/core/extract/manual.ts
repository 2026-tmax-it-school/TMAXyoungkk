import type { Place, Spot, Trip } from '../../types';
import type { Region } from '../ports';
import { haversineKm, josa } from '../util';
import { inRegion, isBasePlace } from './index';
import { spotFromPlace } from './spot';

/**
 * 스팟 수동 등록 판정(FR-202, WP3 소유, 순수). 06 헤더 검색과 지도에서 선택, 24 선택 시트가 쓴다.
 *
 * - 검색 결과가 없으면 'none'(06이 '결과 없음'을 알린다).
 * - 결과가 하나면 'one', 여러 곳이면 'many'(24 시트에서 고른다). 동명 장소는 여러 건 그대로 둔다.
 * - 목적지 반경 밖이면 outside를 세운다. 자동 추출과 달리 버리지 않고 확인 뒤 담는다(명세 FR-202/401 기준 차이).
 * - 이미 후보인 장소면 existingSpotId를 준다. 담으면 새 후보 대신 제안자만 늘어난다(spot/add 병합).
 * - 기점 장소(숙소·역)는 막지 않고 base를 세운다(24 시트가 '기점 장소' 칩을 단다). 지도 선택은 기점을 건너뛴다.
 * 옵션은 지역 안 → 지역 중심에서 가까운 순이다.
 */

export interface PickOption {
  place: Place;
  outside: boolean;
  /** 지역 중심에서 거리(km, 소수 한 자리) */
  km: number;
  existingSpotId?: string;
  /** 기점 장소(숙소·역)인지 */
  base?: boolean;
}

export type ManualPick = { kind: 'none' } | { kind: 'one'; option: PickOption } | { kind: 'many'; options: PickOption[] };

export function pickOptions(results: Place[], region: Region, trip: Pick<Trip, 'spots'> & Partial<Pick<Trip, 'days'>>): PickOption[] {
  const seen = new Set<string>();
  const out: PickOption[] = [];
  for (const place of results) {
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    const existing = trip.spots.find((s) => s.placeId === place.placeId);
    const opt: PickOption = {
      place,
      outside: !inRegion(region, place),
      km: Math.round(haversineKm(region.center, place.coord) * 10) / 10,
    };
    if (existing) opt.existingSpotId = existing.id;
    if (isBasePlace({ days: trip.days ?? [] }, place)) opt.base = true;
    out.push(opt);
  }
  // 제공자 순서(정확도)를 유지하되, 지역 밖은 뒤로 보낸다.
  return [...out.filter((o) => !o.outside), ...out.filter((o) => o.outside)];
}

export function planManualAdd(results: Place[], region: Region, trip: Pick<Trip, 'spots'> & Partial<Pick<Trip, 'days'>>): ManualPick {
  const options = pickOptions(results, region, trip);
  if (options.length === 0) return { kind: 'none' };
  if (options.length === 1) return { kind: 'one', option: options[0] };
  return { kind: 'many', options };
}

/** 수동 등록 후보. 제안 출처는 'manual'이다. */
export function manualSpot(place: Place, opts: { id: string; memberId: string; at: number; outside: boolean }): Spot {
  return spotFromPlace(place, {
    id: opts.id,
    proposal: { memberId: opts.memberId, source: 'manual', at: opts.at },
    createdAt: opts.at,
    outsideRegion: opts.outside,
  });
}

/**
 * 이미 후보인 곳을 다시 담을 때의 판정. 내가 이미 수동으로 제안했으면 'already'(아무것도 바꾸지 않는다),
 * 직접 뺀 후보면 'removed'(제안은 더하지만 제외 스팟에 남는다), 그 밖에는 'merge'.
 */
export function existingAddState(
  trip: Pick<Trip, 'spots'>,
  opt: Pick<PickOption, 'existingSpotId'>,
  memberId: string | undefined,
): 'new' | 'already' | 'removed' | 'merge' {
  const spot = opt.existingSpotId ? trip.spots.find((s) => s.id === opt.existingSpotId) : undefined;
  if (!spot) return 'new';
  if (spot.proposals.some((p) => p.memberId === memberId && p.source === 'manual')) return 'already';
  if (spot.removedByUser) return 'removed';
  return 'merge';
}

/** 확인 문구. 목적지 밖이면 거리까지 적는다. */
export function outsideConfirmText(opt: PickOption, region: Region): string {
  return `${josa(opt.place.name, '은/는')} ${region.name} 중심에서 ${opt.km}km 떨어져 있어 목적지 밖입니다. 그래도 후보에 담을까요?`;
}
