import type { Clock, FetchLike, KV, RouteProvider } from '../../core/ports';
import { createRouteCache } from './cache';
import { createKakaoRoutes } from './kakao';
import { createLocalRoutes } from './local';
import { withTransitModel } from './transit';

/**
 * 경로 제공자 팩토리(WP4 소유, 순수). 24시간 캐시 → 대중교통 모의 모델 → 카카오(자동차만 실제) 또는 로컬.
 * 도보·대중교통은 키가 있어도 로컬 모델로 계산하고 estimated를 세운다. 구글 구현은 두지 않는다.
 */
export function createRouteProvider(opts: {
  kakaoKey?: string;
  fetch: FetchLike;
  clock: Clock;
  kv: KV;
}): RouteProvider {
  const local = createLocalRoutes();
  const inner = opts.kakaoKey ? createKakaoRoutes({ key: opts.kakaoKey, fetch: opts.fetch, fallback: local }) : local;
  return createRouteCache({ clock: opts.clock, kv: opts.kv }).wrap(withTransitModel(inner));
}

export { createRouteCache } from './cache';
export { createKakaoRoutes, KAKAO_DIRECTIONS_URL, parseKakaoRoute } from './kakao';
export { createLocalRoutes } from './local';
export { transitBreakdown, withTransitModel } from './transit';
