import type { Place } from '../../types';
import type { FetchLike, RecommendProvider, RecommendResult } from '../../core/ports';
import { inRegion } from '../../core/extract';
import { clampLimit, recommendable } from '../../core/recommend';
import { BASE_PLACE_IDS } from '../../data/places';
import { createAiProxyClient } from '../aiProxy';

/**
 * AI 프록시 추천(WP3 소유, 순수). AI 키는 프록시 서버에만 있다.
 * 규약: POST {프록시}/recommend, 본문 {region:{id,name}, dates, tags, existing:[placeId], limit},
 * 응답 {items:[{place, reason}], fallback}. 응답을 그대로 믿지 않는다. 기존 후보·지역 밖·모양이 틀린 항목을 버리고,
 * 거르는 규칙은 로컬과 같은 recommendable(중복 placeId, 기점 장소, '기타', 여행 날짜 전부 휴무)이다.
 * 남은 것이 3곳 미만이거나 호출이 실패하면 로컬 추천으로 대체한다. 결과의 source가 'ai'인지 'local'인지로 알려 준다
 * (23이 '예시 데이터' 칩을 제공자 id가 아니라 결과 출처로 정한다).
 */
function isPlace(v: unknown): v is Place {
  const p = v as Place | null;
  return (
    !!p &&
    typeof p.placeId === 'string' &&
    typeof p.name === 'string' &&
    !!p.coord &&
    Number.isFinite(p.coord.latitude) &&
    Number.isFinite(p.coord.longitude) &&
    typeof p.category === 'string'
  );
}

export function createAiRecommend(opts: {
  url: string;
  fetch: FetchLike;
  fallback: RecommendProvider;
}): RecommendProvider {
  const client = createAiProxyClient({ url: opts.url, fetch: opts.fetch });
  return {
    id: 'ai',
    async recommend(req): Promise<RecommendResult> {
      try {
        const res = await client.call<{ items?: unknown; fallback?: unknown }>('/recommend', {
          region: { id: req.region.id, name: req.region.name },
          dates: req.dates,
          tags: req.tags,
          existing: req.existing.map((p) => p.placeId),
          limit: clampLimit(req.limit),
        });
        const seen = new Set<string>();
        const ok = (p: Place) =>
          recommendable(p, {
            existing: req.existing,
            inRegion: (x) => inRegion(req.region, x),
            skipPlaceIds: BASE_PLACE_IDS,
            dates: req.dates,
            seen,
          });
        const items = (Array.isArray(res?.items) ? res.items : [])
          .map((it) => it as { place?: unknown; reason?: unknown })
          .filter((it) => isPlace(it.place) && typeof it.reason === 'string' && it.reason.trim() !== '')
          .map((it) => ({ place: it.place as Place, reason: String(it.reason).split('\n')[0] }))
          .filter((it) => ok(it.place))
          .slice(0, clampLimit(req.limit));
        if (items.length < 3) throw new Error('추천 결과가 부족하다');
        return { items, fallback: res.fallback === true, source: 'ai' };
      } catch {
        return opts.fallback.recommend(req);
      }
    },
  };
}
