import type { FetchLike, PlaceProvider, RecommendProvider, RecommendResult } from '../../core/ports';
import { createAiRecommend } from './ai';
import { createLocalRecommend } from './local';

/** 결과 출처. source가 없는 제공자는 제공자 id가 AI인 경우라 'ai'로 본다(로컬 제공자는 늘 'local'을 싣는다). */
export function resultSource(r: RecommendResult): 'ai' | 'local' {
  return r.source ?? 'ai';
}

/** 추천 제공자 팩토리(WP3 소유). AI 프록시 주소가 있으면 ai, 없으면 로컬(태그 + 근접도 + 인기도). */
export function createRecommendProvider(opts: {
  aiProxyUrl?: string;
  fetch: FetchLike;
  places: PlaceProvider;
}): RecommendProvider {
  const local = createLocalRecommend({ places: opts.places });
  if (opts.aiProxyUrl) return createAiRecommend({ url: opts.aiProxyUrl, fetch: opts.fetch, fallback: local });
  return local;
}
