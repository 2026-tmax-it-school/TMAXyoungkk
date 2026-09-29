import type { FetchLike, PlaceProvider } from '../../core/ports';
import { createKakaoPlaces } from './kakao';
import { createLocalPlaces } from './local';

/**
 * 장소 제공자 팩토리(WP3 소유). 카카오 REST 키가 있으면 카카오 로컬 키워드 검색(프로토타입 가정),
 * 없으면 로컬 장소 사전이다. 구글 구현은 두지 않는다(국내 전용, 두 벌 금지).
 */
export function createPlaceProvider(opts: { kakaoKey?: string; fetch: FetchLike }): PlaceProvider {
  if (opts.kakaoKey) return createKakaoPlaces({ key: opts.kakaoKey, fetch: opts.fetch });
  return createLocalPlaces();
}
