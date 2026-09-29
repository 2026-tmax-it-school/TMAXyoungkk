import type { LatLng, Place } from '../../types';
import type { PlaceProvider, Region } from '../../core/ports';
import { compactKey } from '../../core/extract/text';
import { haversineKm } from '../../core/util';
import { PLACES, surfacesOf, type DictPlace } from '../../data/places';

/**
 * 로컬 장소 사전 제공자(WP3 소유, 순수). 키 없이 전부 돌려보게 하려고 둔다. 예시 데이터다.
 *
 * search 순서: 이름·별칭이 검색어와 같은 곳 → 이름·별칭이 검색어로 시작하는 곳 → 검색어를 품은 곳.
 * 같은 단계 안에서는 bias(없으면 지역 중심)에서 가까운 순이다. 동명 장소는 여러 건 그대로 돌려준다.
 * 띄어쓰기는 무시한다. 지역 밖 장소도 돌려준다(수동 등록은 확인 뒤 담고, 자동 추출은 호출 쪽이 버린다).
 */

function strip({ aliases: _a, region: _r, ...place }: DictPlace): Place {
  return place;
}

function rank(p: DictPlace, q: string): number {
  const keys = surfacesOf(p).map(compactKey);
  if (keys.some((k) => k === q)) return 0;
  if (keys.some((k) => k.startsWith(q))) return 1;
  if (q.length >= 2 && keys.some((k) => k.includes(q))) return 2;
  return -1;
}

export function createLocalPlaces(opts: { places?: DictPlace[] } = {}): PlaceProvider {
  const dict = opts.places ?? PLACES;
  return {
    id: 'local',
    async search(query: string, region: Region, bias?: LatLng): Promise<Place[]> {
      const q = compactKey(query);
      if (q.length < 2) return [];
      const center = bias ?? region.center;
      return dict
        .map((p) => ({ p, r: rank(p, q) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r || haversineKm(center, a.p.coord) - haversineKm(center, b.p.coord))
        .map((x) => strip(x.p));
    },
    async nearby(coord: LatLng, radiusM: number, o = {}): Promise<Place[]> {
      const exclude = new Set(o.excludePlaceIds ?? []);
      return dict
        .filter((p) => !exclude.has(p.placeId) && haversineKm(coord, p.coord) * 1000 <= radiusM)
        .sort((a, b) => haversineKm(coord, a.coord) - haversineKm(coord, b.coord))
        .slice(0, o.limit ?? 20)
        .map(strip);
    },
    async at(coord: LatLng, radiusM: number): Promise<Place | null> {
      let best: DictPlace | null = null;
      let bestM = Infinity;
      for (const p of dict) {
        const m = haversineKm(coord, p.coord) * 1000;
        if (m <= radiusM && m < bestM) {
          best = p;
          bestM = m;
        }
      }
      return best ? strip(best) : null;
    },
  };
}
