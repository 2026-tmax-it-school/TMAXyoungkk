import type { Category, LatLng, Place } from '../../types';
import type { FetchLike, PlaceProvider, ProviderId, Region } from '../../core/ports';
import { createKakaoClient } from '../kakaoHttp';

/**
 * 카카오 로컬 장소 검색 어댑터(WP3 소유, 순수). 프로토타입 가정 · 국내 SDK 선정 미결정.
 * registry가 켜는 경우는 둘이다.
 * - EXPO_PUBLIC_API_URL(apiUrl): 키 없이 키 숨기는 서버를 거친다(kakaoHttp). registry가 fallback(로컬 장소 사전)을 준다.
 *   서버에 닿지 못하거나 서버·카카오가 실패하면(서버에 카카오 키 없음 503, 시간 초과, 429·5xx 등) 그 호출을 fallback으로 넘긴다.
 *   그동안 id는 'local'이다(마지막 응답을 어디서 받았는지. 화면이 예시 데이터 표시를 이 값으로 정한다). 다시 되면 'kakao'다.
 * - EXPO_PUBLIC_KAKAO_REST_KEY(key): 시연 한정 직접 호출. REST 키가 번들에 들어간다. 실패하면 던진다.
 *
 * 카카오 개발자 문서(developers.kakao.com/docs/ko/local/dev-guide, 2026-09-26 다시 확인) 기준:
 * - 키워드 검색 GET https://dapi.kakao.com/v2/local/search/keyword.json
 *   query(필수), x(경도)·y(위도)·radius(0~20000m), page(1~45), size(1~15), sort(accuracy|distance)
 *   x·y는 radius와 함께 줄 때만 결과를 그 반경 안으로 거른다. radius가 없으면 거리 계산·정렬에만 쓰여 전국 대상이 된다.
 *   그래서 키워드 검색은 두 단계다. 먼저 지역 중심·반경(min(지역 반경, 20km))으로 찾고, 0건일 때만 반경 없이 다시 찾는다.
 * - 카테고리 검색 GET https://dapi.kakao.com/v2/local/search/category.json
 *   category_group_code(필수) + x·y·radius
 * - 인증 헤더 'Authorization: KakaoAK {REST 키}'(직접 호출은 kakaoHttp가, 서버 경유는 서버가 붙인다)
 * - 응답 documents[]: id, place_name, category_name, category_group_code, address_name, road_address_name, x, y, distance
 * 실키 동작과 웹 브라우저 CORS 허용 여부는 확인하지 못했다(추적표). 실패하면 던지고, 호출 쪽이 '검색 실패'로 안내한다.
 */

export const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
export const KAKAO_CATEGORY_URL = 'https://dapi.kakao.com/v2/local/search/category.json';
/** 카카오 반경 상한(m) */
export const KAKAO_MAX_RADIUS_M = 20000;
/** 주변 추천·지도 선택에 쓰는 카테고리. 관광명소, 문화시설, 카페, 음식점 */
export const NEARBY_CATEGORIES = ['AT4', 'CT1', 'CE7', 'FD6'] as const;

export interface KakaoPlaceDoc {
  id: string;
  place_name: string;
  category_name?: string;
  category_group_code?: string;
  address_name?: string;
  road_address_name?: string;
  x: string;
  y: string;
  distance?: string;
}

/** 카카오 카테고리 → 앱 카테고리. 그룹 코드가 비어 있으면 category_name 경로로 판정한다. */
export function mapKakaoCategory(code: string | undefined, name: string | undefined): Category {
  const path = name ?? '';
  if (/공원|수목원|호수|산책/.test(path)) return '공원';
  switch (code) {
    case 'FD6':
      return '식당';
    case 'CE7':
      return '카페';
    case 'AT4':
    case 'CT1':
      return '관광지';
    case 'MT1':
    case 'CS2':
      return '쇼핑';
    default:
      break;
  }
  if (/쇼핑|시장|거리/.test(path)) return '쇼핑';
  // '여행'은 최상위 분류('여행 > 관광,명소')일 때만 본다. '가정,생활 > 여행사' 같은 업종을 관광지로 잡지 않는다.
  if (/^\s*여행\s*>|관광|명소|문화/.test(path)) return '관광지';
  return '기타';
}

export function placeFromKakao(d: KakaoPlaceDoc): Place | null {
  const latitude = Number(d.y);
  const longitude = Number(d.x);
  if (!d.id || !d.place_name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const segs = (d.category_name ?? '').split('>').map((s) => s.trim()).filter(Boolean);
  const place: Place = {
    placeId: `kakao:${d.id}`,
    name: d.place_name,
    coord: { latitude, longitude },
    category: mapKakaoCategory(d.category_group_code, d.category_name),
  };
  const kind = segs[segs.length - 1];
  if (kind) place.kind = kind;
  const address = d.road_address_name || d.address_name;
  if (address) place.address = address;
  return place;
}

function docsOf(res: unknown): KakaoPlaceDoc[] {
  const docs = (res as { documents?: unknown } | null)?.documents;
  return Array.isArray(docs) ? (docs as KakaoPlaceDoc[]) : [];
}

function toPlaces(res: unknown): Place[] {
  const out: Place[] = [];
  for (const d of docsOf(res)) {
    const p = placeFromKakao(d);
    if (p && !out.some((o) => o.placeId === p.placeId)) out.push(p);
  }
  return out;
}

function radiusOf(m: number): number {
  return Math.max(1, Math.min(KAKAO_MAX_RADIUS_M, Math.round(m)));
}

export function createKakaoPlaces(opts: {
  key?: string;
  apiUrl?: string;
  fetch: FetchLike;
  fallback?: PlaceProvider;
  /** 요청 하나의 시간 제한(기본 kakaoHttp의 KAKAO_TIMEOUT_MS) */
  timeoutMs?: number;
}): PlaceProvider {
  const client = createKakaoClient(opts);

  async function byCategory(coord: LatLng, radiusM: number, code: string, size: number): Promise<(Place & { d: number })[]> {
    const res = await client.get(KAKAO_CATEGORY_URL, {
      category_group_code: code,
      x: coord.longitude,
      y: coord.latitude,
      radius: radiusOf(radiusM),
      sort: 'distance',
      size,
    });
    return docsOf(res)
      .map((d) => {
        const p = placeFromKakao(d);
        return p ? { ...p, d: Number(d.distance ?? '0') } : null;
      })
      .filter((x): x is Place & { d: number } => x != null);
  }

  const kakao: PlaceProvider = {
    id: 'kakao',
    async search(query: string, region: Region, bias?: LatLng): Promise<Place[]> {
      const q = query.trim();
      if (q.length < 2) return [];
      const center = bias ?? region.center;
      // 1단계: 지역 중심·반경으로 거른다. 전국에 흔한 이름('중앙시장', 'OO 카페')이 다른 지역 결과로 밀려
      // matchPhrase의 inRegion에서 전부 버려지는 일을 막는다. 반경의 중심은 bias가 아니라 지역 중심이다.
      const near = toPlaces(
        await client.get(KAKAO_KEYWORD_URL, {
          query: q,
          x: region.center.longitude,
          y: region.center.latitude,
          radius: radiusOf(region.radiusKm * 1000),
          sort: 'accuracy',
          size: 15,
        }),
      );
      if (near.length > 0) return near;
      // 2단계: 0건이면 반경 없이 다시 찾는다. 카카오 반경 상한이 20km라 경주(30km)의 감은사지 삼층석탑(중심에서 약 26km)은
      // 1단계에서 오지 않고, FR-202의 '목적지 밖 확인 뒤 등록'도 여기서 나온 결과로 한다.
      // 지역 판정은 호출 쪽(matchPhrase의 inRegion, pickOptions의 outside)이 한다.
      const res = await client.get(KAKAO_KEYWORD_URL, {
        query: q,
        x: center.longitude,
        y: center.latitude,
        sort: 'accuracy',
        size: 15,
      });
      // 동명 장소는 여러 건 그대로 둔다(FR-401·202 사용자 선택).
      return toPlaces(res);
    },
    async nearby(coord: LatLng, radiusM: number, o = {}): Promise<Place[]> {
      const exclude = new Set(o.excludePlaceIds ?? []);
      const limit = o.limit ?? 20;
      const all: (Place & { d: number })[] = [];
      for (const code of NEARBY_CATEGORIES) {
        for (const p of await byCategory(coord, radiusM, code, 15)) {
          if (!exclude.has(p.placeId) && !all.some((a) => a.placeId === p.placeId)) all.push(p);
        }
      }
      return all
        .sort((a, b) => a.d - b.d)
        .slice(0, limit)
        .map(({ d: _d, ...p }) => p);
    },
    async at(coord: LatLng, radiusM: number): Promise<Place | null> {
      let best: (Place & { d: number }) | null = null;
      for (const code of NEARBY_CATEGORIES) {
        const [first] = await byCategory(coord, radiusM, code, 1);
        if (first && (!best || first.d < best.d)) best = first;
      }
      if (!best) return null;
      const { d: _d, ...p } = best;
      return p;
    },
  };

  const fallback = opts.fallback;
  if (!fallback) return kakao;
  /** 마지막 응답의 출처. 서버 경유에서 대체로 넘어가면 'local'이다 */
  let served: ProviderId = 'kakao';
  /** 카카오 호출이 실패하면(어떤 이유든) 그 호출을 fallback으로 넘긴다 */
  async function orFallback<T>(run: () => Promise<T>, alt: () => Promise<T>): Promise<T> {
    let out: T;
    try {
      out = await run();
    } catch {
      served = 'local';
      return alt();
    }
    served = 'kakao';
    return out;
  }
  return {
    get id() {
      return served;
    },
    search: (query, region, bias) =>
      orFallback(
        () => kakao.search(query, region, bias),
        () => fallback.search(query, region, bias),
      ),
    nearby: (coord, radiusM, o) =>
      orFallback(
        () => kakao.nearby(coord, radiusM, o),
        () => fallback.nearby(coord, radiusM, o),
      ),
    at: (coord, radiusM) =>
      orFallback(
        () => kakao.at(coord, radiusM),
        () => fallback.at(coord, radiusM),
      ),
  };
}
