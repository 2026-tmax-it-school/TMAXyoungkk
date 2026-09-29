import type { PlaceProvider, RecommendProvider, RecommendResult } from '../../core/ports';
import { inRegion } from '../../core/extract';
import { pickRecommendations } from '../../core/recommend';
import { BASE_PLACE_IDS } from '../../data/places';

/**
 * 로컬 추천(FR-404, WP3 소유, 순수). 태그 겹침 + 근접도 + 인기도(core/recommend.ts).
 * 후보 풀은 장소 제공자의 nearby(지역 중심, 지역 반경)다. 로컬이면 사전, 카카오면 주변 카테고리 검색이다.
 * 기존 후보와 겹치지 않고 지역 안만 낸다. 태그가 부족하면 인기 장소로 대체하고 fallback을 세운다.
 * 근접도 기준점은 req.anchor(확정 스팟), 없으면 지역 안 기존 후보다. 결과 source는 'local'이다.
 */
export function createLocalRecommend(opts: { places: PlaceProvider }): RecommendProvider {
  return {
    id: 'local',
    async recommend(req): Promise<RecommendResult> {
      const pool = await opts.places.nearby(req.region.center, req.region.radiusKm * 1000, {
        excludePlaceIds: req.existing.map((p) => p.placeId),
        limit: 200,
      });
      const picked = pickRecommendations({
        pool,
        tags: req.tags,
        existing: req.existing,
        limit: req.limit,
        inRegion: (p) => inRegion(req.region, p),
        skipPlaceIds: BASE_PLACE_IDS,
        dates: req.dates,
        anchor: req.anchor,
      });
      return { ...picked, source: 'local' };
    },
  };
}
