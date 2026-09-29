import type { LatLng, Transport } from '../../types';
import { sameCoord } from '../../core/planner/estimate';
import type { FetchLike, RouteLeg, RouteProvider, TravelMatrix } from '../../core/ports';
import { createKakaoClient } from '../kakaoHttp';

/**
 * 카카오모빌리티 자동차 길찾기 어댑터(WP4 소유, 순수, 프로토타입 가정 · 국내 SDK 선정 미결정).
 * 자동차만 실제로 조회하고 도보·대중교통은 fallback(로컬 모델, estimated)으로 넘긴다.
 *
 * 문서(developers.kakaomobility.com/guide/navi-api/directions, 2026-09 확인):
 * - GET https://apis-navi.kakaomobility.com/v1/directions, 헤더 Authorization: KakaoAK {REST 키}
 * - origin·destination은 '경도,위도'(X,Y) 순서, priority RECOMMEND, summary=false면 roads·guides가 온다
 * - 응답 routes[0].result_code 0이 성공, summary.distance는 미터, summary.duration은 초
 * - sections[].roads[].vertexes는 [x1,y1,x2,y2,…] 평탄 배열, sections[].guides[]는 name·x·y·distance·duration·guidance
 * 행렬은 구간마다 GET 한 번이다(구간 단위 호출 수 = 요청 수). 다중 목적지 API(POST /v1/destinations/directions)는
 * 반경 제한이 있어 쓰지 않는다. result_code가 0이 아니면 그 구간은 경로 없음(null), 요청이 실패하면 던진다
 * (계획 쪽 TravelBook이 직선거리로 대체하고 estimated를 세운다). 실키 동작과 웹 CORS는 확인하지 못했다(추적표).
 */

export const KAKAO_DIRECTIONS_URL = 'https://apis-navi.kakaomobility.com/v1/directions';

interface KakaoGuide {
  name?: string;
  x?: number;
  y?: number;
  distance?: number;
  duration?: number;
  guidance?: string;
}
interface KakaoRoute {
  result_code?: number;
  result_msg?: string;
  summary?: { distance?: number; duration?: number };
  sections?: { roads?: { vertexes?: number[] }[]; guides?: KakaoGuide[] }[];
}

function xy(c: LatLng): string {
  return `${c.longitude},${c.latitude}`;
}

/** 카카오 응답 → RouteLeg. 경로가 없으면 null */
export function parseKakaoRoute(json: unknown, a: LatLng, b: LatLng): RouteLeg | null {
  const route = (json as { routes?: KakaoRoute[] } | null)?.routes?.[0];
  if (!route || route.result_code !== 0 || !route.summary) return null;
  const polyline: LatLng[] = [];
  const steps: { text: string; meters: number }[] = [];
  for (const sec of route.sections ?? []) {
    for (const road of sec.roads ?? []) {
      const v = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) polyline.push({ longitude: v[i], latitude: v[i + 1] });
    }
    for (const g of sec.guides ?? []) {
      if (g.guidance) steps.push({ text: g.name ? `${g.guidance} · ${g.name}` : g.guidance, meters: g.distance ?? 0 });
    }
  }
  return {
    transport: 'car',
    minutes: Math.max(1, Math.round((route.summary.duration ?? 0) / 60)),
    meters: Math.round(route.summary.distance ?? 0),
    polyline: polyline.length >= 2 ? polyline : [a, b],
    steps,
    note: '카카오모빌리티 자동차 길찾기(프로토타입 가정)',
    estimated: false,
  };
}

export function createKakaoRoutes(opts: { key: string; fetch: FetchLike; fallback: RouteProvider }): RouteProvider {
  const client = createKakaoClient(opts);

  async function carRoute(a: LatLng, b: LatLng, summary: boolean): Promise<RouteLeg | null> {
    const json = await client.get(KAKAO_DIRECTIONS_URL, {
      origin: xy(a),
      destination: xy(b),
      priority: 'RECOMMEND',
      summary: summary ? 'true' : 'false',
    });
    return parseKakaoRoute(json, a, b);
  }

  return {
    id: 'kakao',
    async matrix(origins, destinations, t: Transport): Promise<TravelMatrix> {
      if (t !== 'car') return opts.fallback.matrix(origins, destinations, t);
      let calls = 0;
      const minutes: (number | null)[][] = [];
      for (const o of origins) {
        const row: (number | null)[] = [];
        for (const d of destinations) {
          if (sameCoord(o, d)) {
            row.push(0);
            continue;
          }
          calls += 1;
          const leg = await carRoute(o, d, true);
          row.push(leg ? leg.minutes : null);
        }
        minutes.push(row);
      }
      return { minutes, calls, cacheHits: 0, estimated: false };
    },
    async route(a, b, t) {
      if (t !== 'car') return opts.fallback.route(a, b, t);
      return carRoute(a, b, false);
    },
    clearCache: () => opts.fallback.clearCache(),
  };
}
