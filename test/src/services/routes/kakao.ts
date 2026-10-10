import type { LatLng, Transport } from '../../types';
import { sameCoord } from '../../core/planner/estimate';
import type { Clock, FetchLike, ProviderId, RouteLeg, RouteProvider } from '../../core/ports';
import { SCENARIO_PLACES } from '../../data/scenario';
import { SCENARIO_ROUTE_TABLE } from '../../data/scenario-tuning';
import { createKakaoClient, isKakaoDisabled } from '../kakaoHttp';
import type { RouteLegOut, RouteMatrix } from './cache';
import { createPlaceIndex, lookupTable, type RouteTable } from './local';

/**
 * 카카오모빌리티 자동차 길찾기 어댑터(WP4 소유, 순수, 프로토타입 가정 · 국내 SDK 선정 미결정).
 * 자동차만 실제로 조회하고 도보·대중교통은 fallback(실제 길 OSRM 또는 로컬 모델, 대중교통은 transit.ts)으로 넘긴다.
 *
 * 문서(developers.kakaomobility.com/guide/navi-api/directions, 2026-09 확인):
 * - GET https://apis-navi.kakaomobility.com/v1/directions, 헤더 Authorization: KakaoAK {REST 키}
 * - origin·destination은 '경도,위도'(X,Y) 순서, priority RECOMMEND, summary=false면 roads·guides가 온다
 * - 응답 routes[0].result_code 0이 성공, summary.distance는 미터, summary.duration은 초
 * - sections[].roads[].vertexes는 [x1,y1,x2,y2,…] 평탄 배열, sections[].guides[]는 name·x·y·distance·duration·guidance
 * 행렬은 구간마다 GET 한 번이다(구간 단위 호출 수 = 요청 수). 다중 목적지 API(POST /v1/destinations/directions)는
 * 반경 제한이 있어 쓰지 않는다. result_code가 0이 아니면 그 구간은 경로 없음(null), 요청이 실패하면 던진다
 * (계획 쪽 TravelBook이 직선거리로 대체하고 estimated를 세운다). 실키 동작과 웹 CORS는 확인하지 못했다(추적표).
 *
 * 예시 구간표(src/data/scenario-tuning.ts)에 있는 자동차 구간은 구간표가 우선이다(2026-10-09 결정, 시연 수치 유지).
 * 행렬은 그 구간을 카카오에 묻지 않고 구간표 값을 쓴다(null이면 경로 없음). 경로는 선 모양·거리·안내 줄만 카카오에서 받고
 * 시간은 구간표 값으로 둔다(osm.ts도 구간표 구간은 같다).
 *
 * apiUrl(EXPO_PUBLIC_API_URL)이 있으면 키 없이 키 숨기는 서버를 거친다(kakaoHttp). 서버 경유에서 실패하면(서버에 카카오 키 없음 503,
 * 서버에 닿지 못함, 시간 초과, 429·5xx 등) 그 행렬·경로를 fallback(실제 길 OSRM · 로컬 모델)으로 넘기고 임시 결과로 표시해
 * 캐시에 두지 않는다(행렬 provisional, 경로 RouteLeg.provisional). 일시 장애나 서버에 키를 나중에 넣은 경우에 하루 내내
 * 추정값으로 남지 않게 한다. 그동안 id는 'local'이다(마지막 응답 출처, 화면의 예시 데이터 표시). 직접 호출(key)은 실패하면 던진다.
 *
 * 다만 서버에 카카오 키가 없다는 답(503 kakaoDisabled)은 일시 장애가 아니라 서버 설정이다(기본 서버는 KAKAO_REST_KEY가 비어 있다).
 * 이때마다 구간 하나에 카카오 503과 대체 요청이 함께 나가 재계산마다 같은 수를 되풀이하면 서버 요청 한도(분당 300)에 걸린다.
 * 그래서 이 답을 받으면(2026-10-09 리뷰 반영)
 * - netClock(실제 시계)이 있으면 KAKAO_DISABLED_COOLDOWN_MS 동안 자동차도 카카오에 묻지 않고 바로 대체 제공자로 간다
 * - 그동안 대체 제공자가 낸 결과가 임시가 아니면(OSRM이 답함, 로컬 모델) 캐시에 KAKAO_FALLBACK_TTL_MS만 둔다(ttlMs).
 *   재계산마다 다시 묻지 않고, 서버에 키를 넣으면 몇 분 안에 다시 카카오로 간다. 대체 제공자도 실패했으면 그대로 임시 결과다
 * 다른 실패(카카오 일시 503·429·5xx, 닿지 못함, 시간 초과)는 예전처럼 임시 결과이고 쉬지 않는다(닿지 못함은 kakaoHttp가 다시 확인한다).
 */

/** 서버가 카카오 키 없음(503 kakaoDisabled)이라고 한 뒤 카카오에 묻지 않는 시간(실제 시각 ms). netClock이 있을 때만 쉰다 */
export const KAKAO_DISABLED_COOLDOWN_MS = 5 * 60_000;
/** 카카오 키 없음 동안 대체 제공자가 낸 실제 결과(임시 아님)를 캐시에 두는 시간. 24시간 캐시보다 짧게 둔다 */
export const KAKAO_FALLBACK_TTL_MS = 10 * 60_000;

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
  const leg: RouteLeg = {
    transport: 'car',
    minutes: Math.max(1, Math.round((route.summary.duration ?? 0) / 60)),
    meters: Math.round(route.summary.distance ?? 0),
    polyline: polyline.length >= 2 ? polyline : [a, b],
    steps,
    note: '카카오모빌리티 자동차 길찾기(프로토타입 가정)',
    estimated: false,
  };
  if (polyline.length >= 2) leg.road = 'kakao';
  return leg;
}

export function createKakaoRoutes(opts: {
  key?: string;
  apiUrl?: string;
  fetch: FetchLike;
  fallback: RouteProvider;
  /** 요청 하나의 시간 제한(기본 kakaoHttp의 KAKAO_TIMEOUT_MS) */
  timeoutMs?: number;
  /** 예시 구간표(기본 SCENARIO_ROUTE_TABLE)와 좌표 색인용 장소(기본 SCENARIO_PLACES) */
  table?: RouteTable;
  places?: readonly { placeId: string; coord: LatLng }[];
  /** 카카오 키 없음 뒤 쉬는 시간을 재는 실제 시계. 없으면 쉬지 않는다(대체 결과를 짧게 캐시하는 것은 같다) */
  netClock?: Clock;
  disabledCooldownMs?: number;
}): RouteProvider {
  const client = createKakaoClient(opts);
  const table = opts.table ?? SCENARIO_ROUTE_TABLE;
  const index = createPlaceIndex(opts.places ?? SCENARIO_PLACES);
  /** 마지막 응답의 출처. 서버 경유에서 대체로 넘어가면 'local'이다 */
  let served: ProviderId = 'kakao';

  /** 이 시각(netClock)까지는 서버에 카카오 키가 없다고 보고 묻지 않는다 */
  let offUntil = Number.NEGATIVE_INFINITY;
  const resting = () => !!opts.netClock && opts.netClock.now() < offUntil;
  /** 서버 경유 실패를 받았다. 카카오 키 없음이면 쉬기 시작하고 true(대체 결과를 짧게 캐시해도 된다) */
  function failed(e: unknown): boolean {
    if (!client.viaServer) throw e;
    served = 'local';
    if (!isKakaoDisabled(e)) return false;
    if (opts.netClock) offUntil = opts.netClock.now() + (opts.disabledCooldownMs ?? KAKAO_DISABLED_COOLDOWN_MS);
    return true;
  }
  /** 대체 행렬. 키 없음(off)이면 임시가 아닌 결과를 짧게 캐시하고, 일시 장애면 임시 결과다 */
  function fallbackMatrix(fb: RouteMatrix, off: boolean): RouteMatrix {
    if (!off || fb.provisional) return { ...fb, provisional: true };
    return { ...fb, ttlMs: KAKAO_FALLBACK_TTL_MS };
  }
  function fallbackLeg(fb: RouteLegOut | null, off: boolean): RouteLegOut | null {
    if (!fb) return fb;
    if (!off || fb.provisional) return { ...fb, provisional: true };
    return { ...fb, ttlMs: KAKAO_FALLBACK_TTL_MS };
  }

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
    get id() {
      return served;
    },
    async matrix(origins, destinations, t: Transport): Promise<RouteMatrix> {
      if (t !== 'car') return opts.fallback.matrix(origins, destinations, t);
      if (resting()) {
        served = 'local';
        return fallbackMatrix(await opts.fallback.matrix(origins, destinations, t), true);
      }
      let calls = 0;
      let asked = false;
      const minutes: (number | null)[][] = [];
      for (const o of origins) {
        const row: (number | null)[] = [];
        for (const d of destinations) {
          if (sameCoord(o, d)) {
            row.push(0);
            continue;
          }
          calls += 1;
          const known = lookupTable(table, index, o, d, 'car');
          if (known !== undefined) {
            row.push(known);
            continue;
          }
          let leg: RouteLeg | null;
          try {
            leg = await carRoute(o, d, true);
          } catch (e) {
            // 서버·카카오를 못 쓴다. 이 행렬은 통째로 대체 제공자로 계산한다(호출 수도 대체 제공자 것).
            // 일시 장애면 캐시에 두지 않고, 서버에 카카오 키가 없으면 짧게만 둔다
            const off = failed(e);
            return fallbackMatrix(await opts.fallback.matrix(origins, destinations, t), off);
          }
          asked = true;
          row.push(leg ? leg.minutes : null);
        }
        minutes.push(row);
      }
      if (asked) served = 'kakao';
      return { minutes, calls, cacheHits: 0, estimated: false };
    },
    async route(a, b, t): Promise<RouteLegOut | null> {
      if (t !== 'car') return opts.fallback.route(a, b, t);
      const known = lookupTable(table, index, a, b, 'car');
      // 구간표가 자동차 경로 없음이라고 하면 묻지 않는다(행렬과 같게)
      if (known === null) return null;
      if (resting()) {
        served = 'local';
        return fallbackLeg(await opts.fallback.route(a, b, t), true);
      }
      let leg: RouteLeg | null;
      try {
        leg = await carRoute(a, b, false);
      } catch (e) {
        const off = failed(e);
        return fallbackLeg(await opts.fallback.route(a, b, t), off);
      }
      served = 'kakao';
      if (known === undefined) return leg;
      // 구간표 구간: 카카오가 경로를 못 찾으면 대체 제공자(구간표 시간), 찾으면 선 모양은 카카오 · 시간은 구간표
      if (!leg) return opts.fallback.route(a, b, t);
      return { ...leg, minutes: known, note: `${leg.note ?? ''} · 시간은 예시 구간표` };
    },
    clearCache: () => opts.fallback.clearCache(),
  };
}
