import type { Category, LatLng, Transport } from '../types';
import { ROUTE_CACHE_TTL_MS } from '../core/constants';

/**
 * 지도 SDK 중립 인터페이스.
 *
 * 기능명세서 FR-800 절: "나중에 구글맵을 붙일 수 있도록 장소 검색, 좌표 매칭, 경로 조회를
 * SDK 중립 인터페이스로 감싼다." 이 프로토타입은 그 인터페이스 위에 구글 구현을 얹었다.
 * 국내 출시용 카카오맵·네이버지도 구현도 이 인터페이스만 맞추면 갈아끼울 수 있다.
 */

export interface PlaceHit {
  name: string;
  coord: LatLng;
  address?: string;
  category: Category;
}

export interface TravelMatrix {
  /** minutes[i][j] = origins[i] → destinations[j] 이동 시간(분) */
  minutes: number[][];
  /** 이번 호출에서 실제로 나간 경로 API 요청 수 */
  calls: number;
  /** 직선거리로 때운 값이 섞였는지 */
  estimated: boolean;
}

export interface MapProvider {
  id: 'google' | 'local';
  label: string;
  /** 지역 안에서 장소를 찾는다. 결과가 없으면 빈 배열. */
  searchPlaces(query: string, region: string, bias: LatLng): Promise<PlaceHit[]>;
  /** 구간 이동 시간 행렬. 실패하면 직선거리로 대체하고 estimated를 세운다. */
  travelMatrix(
    origins: LatLng[],
    destinations: LatLng[],
    transport: Transport,
  ): Promise<TravelMatrix>;
}

/** 동일 구간 24시간 캐시. 비기능 요구사항 "외부 API 비용" 항목. */
const cache = new Map<string, { minutes: number; at: number }>();

export function cacheKey(a: LatLng, b: LatLng, transport: Transport): string {
  const r = (n: number) => n.toFixed(5);
  return `${transport}|${r(a.latitude)},${r(a.longitude)}|${r(b.latitude)},${r(b.longitude)}`;
}

export function readCache(key: string): number | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ROUTE_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.minutes;
}

export function writeCache(key: string, minutes: number): void {
  cache.set(key, { minutes, at: Date.now() });
}

export function cacheSize(): number {
  return cache.size;
}

/** 구글 place types → 우리 카테고리 */
export function categoryFromTypes(types: string[] = []): Category {
  const t = new Set(types);
  if (t.has('restaurant') || t.has('meal_takeaway') || t.has('food')) return '식당';
  if (t.has('cafe') || t.has('bakery') || t.has('coffee_shop')) return '카페';
  if (t.has('park') || t.has('hiking_area') || t.has('national_park')) return '공원';
  if (t.has('shopping_mall') || t.has('store') || t.has('market')) return '쇼핑';
  if (
    t.has('tourist_attraction') ||
    t.has('museum') ||
    t.has('historical_landmark') ||
    t.has('place_of_worship') ||
    t.has('art_gallery')
  ) {
    return '관광지';
  }
  return '기타';
}
