import { regionById, REGIONS } from '../../data/regions';
import { sampleTripFor } from '../../data/sampleTrips';
import type { Region } from '../../core/ports';
import type { Trip } from '../../types';

/**
 * 홈 '내 여행' 검색(2026-10-17 사용자 요청, 순수). 홈 제목 아래 검색칸에 적으면:
 * - 내 여행방: 방 이름 또는 여행지(지역 이름·주소 이름)에 들어 있는 방. 예: '서울' → 여행지가 서울인 방
 * - 지역: 목록 지역(REGIONS)에서 이름·주소에 들어 있는 곳(많아야 3곳). 예시 일정이 있는지도 알려 준다.
 *   목록에 없는 시·군은 화면이 지역 검색(RegionSearch)으로 더 찾는다
 * - AI 추천 여행지: 첫 지역으로 AI 추천을 묻는다(화면이 services recommend로)
 * 비교는 공백·대소문자를 무시하고, 글자(한글)는 그대로 비교한다.
 */

export function normQuery(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

/** 방 이름이나 여행지 이름에 검색어가 들어 있는 내 여행방(순서는 그대로) */
export function searchTrips(trips: readonly Trip[], query: string): Trip[] {
  const q = normQuery(query);
  if (!q) return [...trips];
  return trips.filter((t) => {
    const r = regionById(t.region);
    return [t.title, r?.name ?? '', r?.label ?? ''].some((s) => normQuery(s).includes(q));
  });
}

export interface RegionHit {
  region: Region;
  /** 지역별 예시 2박 3일이 있으면 '예시 일정 보기'를 보인다 */
  hasSample: boolean;
}

/** 검색어가 이름·주소에 들어 있는 목록 지역(이름으로 시작하는 곳 먼저, 많아야 limit곳) */
export function searchRegions(query: string, limit = 3): RegionHit[] {
  const q = normQuery(query);
  if (!q) return [];
  const hits = REGIONS.filter((r) => normQuery(r.name).includes(q) || normQuery(r.label).includes(q));
  hits.sort((a, b) => Number(!normQuery(a.name).startsWith(q)) - Number(!normQuery(b.name).startsWith(q)));
  return hits.slice(0, limit).map((region) => ({ region, hasSample: !!sampleTripFor(region.id) }));
}

/** 목록 지역과 지역 검색 결과를 합친다(같은 id는 한 번, 목록 지역 먼저) */
export function mergeRegionHits(listed: readonly RegionHit[], searched: readonly Region[], limit = 3): RegionHit[] {
  const out = [...listed];
  for (const r of searched) {
    if (out.length >= limit) break;
    if (out.some((h) => h.region.id === r.id || h.region.name === r.name)) continue;
    out.push({ region: r, hasSample: !!sampleTripFor(r.id) });
  }
  return out.slice(0, limit);
}
