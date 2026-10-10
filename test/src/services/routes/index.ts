import type { Clock, FetchLike, KV, RouteProvider } from '../../core/ports';
import { sha256Hex } from '../../core/sha256';
import { SCENARIO_ROUTE_TABLE, SCENARIO_TRANSIT } from '../../data/scenario-tuning';
import { createRouteCache } from './cache';
import { createKakaoRoutes } from './kakao';
import { createLocalRoutes } from './local';
import {
  createOsmRoutes,
  OSM_PROXY_TIMEOUT_MS,
  OSM_ROUTING_URL,
  OSM_TABLE_TIMEOUT_MS,
  osmProxyBase,
  OSRM_CAR_TIME_FACTOR,
} from './osm';
import { createOdsayTransit } from './odsay';
import { TRANSIT_MODEL_VERSION, withTransitModel } from './transit';

/**
 * 경로 제공자 팩토리(WP4 소유, 순수). 24시간 캐시 → 대중교통 모의 모델 → 카카오(자동차만 실제) → 실제 길(OSM) → 로컬.
 * 구글 구현은 두지 않는다. 테스트·골든은 roadShapes 없이 만든다(외부 호출 없음, 시간은 구간표 · 직선 추정).
 * roadShapes가 있으면(2026-10-09 결정) 도보·자동차 시간도 OpenStreetMap 길(OSRM)에서 받는다. 행렬은 OSRM table,
 * 경로는 선 모양·거리·안내 줄과 그 경로의 시간이다. 예시 구간표에 있는 구간은 구간표 시간이 우선이다(osm.ts).
 * 자동차는 카카오가 있으면 카카오가 먼저다. 같은 구간이면 행렬과 경로가 같은 분을 낸다(cache.ts가 맞춘다).
 * 대중교통은 서버(apiUrl)가 있으면 ODsay 실제 노선(버스·지하철·열차, 노선 모양의 선)이고, 못 쓰면 추정 모델(직선)이다(transit.ts).
 *
 * apiUrl(EXPO_PUBLIC_API_URL)이 있으면 키 숨기는 서버를 거친다. 카카오 자동차는 키 없이 서버로 가고(kakaoKey는 쓰지 않는다),
 * 서버·카카오를 못 쓰면(서버에 카카오 키 없음 503, 닿지 못함, 시간 초과 등) 실제 길(OSRM, roadShapes가 있을 때) · 로컬 모델로
 * 넘어가고 그 결과는 캐시에 두지 않는다(카카오가 다시 되면 바로 카카오). 예시 구간표에 있는 자동차 구간은 구간표 시간이 우선이다(kakao.ts).
 * 실제 길의 기본 주소도 서버의 /osrm이다(roadShapes.baseUrl을 따로 주면 그 주소가 먼저다).
 * netClock(실제 시계)을 주면 경로 서버가 막히거나(429·5xx) 닿지 않을 때 OSM_COOLDOWN_MS 동안 묻지 않고 바로 대체한다(osm.ts).
 * 서버가 카카오 키 없음(503 kakaoDisabled)이라고 하면 KAKAO_DISABLED_COOLDOWN_MS 동안 카카오에 묻지 않고, 그동안의 실제 대체 값은
 * 캐시에 KAKAO_FALLBACK_TTL_MS만 둔다(kakao.ts). 재계산마다 카카오 503과 대체 요청을 되풀이해 서버 요청 한도에 걸리지 않게 한다.
 * 캐시 서명(routeCacheSignature)은 도로 모양·카카오 방식·예시 구간표가 바뀌면 달라져 예전 캐시를 버린다(cache.ts).
 */

/**
 * 경로 캐시 서명. 캐시 값을 낸 제공자 조합이다. 도로 모양(끔 · 기본 주소), 카카오(서버 주소 · 직접 키 · 없음),
 * 자동차 교통 보정 계수, 예시 구간표와 대중교통 모의 값의 해시를 하나로 해시한다(키 값은 넣지 않는다. 직접 키는 'key'로만 적는다)
 */
export function routeCacheSignature(opts: { kakaoKey?: string; apiUrl?: string; roadShapes?: { baseUrl?: string } }): string {
  const shapeBase = opts.roadShapes?.baseUrl || (opts.apiUrl ? osmProxyBase(opts.apiUrl) : OSM_ROUTING_URL);
  const road = opts.roadShapes ? `osm:${shapeBase}` : 'off';
  const kakao = opts.apiUrl ? `server:${opts.apiUrl}` : opts.kakaoKey ? 'key' : 'none';
  // 대중교통: 서버가 있으면 ODsay, 없으면 추정 모델. 추정 계산이 바뀌면(TRANSIT_MODEL_VERSION) 예전 캐시를 버린다
  const transit = `${opts.apiUrl ? `odsay:${opts.apiUrl}` : 'model'}:v${TRANSIT_MODEL_VERSION}`;
  const data = sha256Hex(JSON.stringify({ table: SCENARIO_ROUTE_TABLE, transit: SCENARIO_TRANSIT }));
  return sha256Hex(['road', road, 'kakao', kakao, 'transit', transit, 'car', OSRM_CAR_TIME_FACTOR, 'data', data].join('|')).slice(0, 16);
}

export function createRouteProvider(opts: {
  kakaoKey?: string;
  apiUrl?: string;
  fetch: FetchLike;
  clock: Clock;
  kv: KV;
  roadShapes?: { baseUrl?: string };
  /** 경로 서버 쉬는 시간을 재는 실제 시계(앱은 systemClock). 없으면 쉬지 않는다 */
  netClock?: Clock;
}): RouteProvider {
  const local = createLocalRoutes();
  // 도로 모양 주소를 따로 주지 않았고 서버 주소가 있으면 서버의 /osrm을 거친다(시간 제한은 서버 대기만큼 길게)
  const shapeViaServer = !opts.roadShapes?.baseUrl && !!opts.apiUrl;
  const shapeBase = opts.roadShapes?.baseUrl || (opts.apiUrl ? osmProxyBase(opts.apiUrl) : undefined);
  const shaped = opts.roadShapes
    ? createOsmRoutes({
        fetch: opts.fetch,
        fallback: local,
        baseUrl: shapeBase,
        timeoutMs: shapeViaServer ? OSM_PROXY_TIMEOUT_MS : undefined,
        // 공개 서버에 직접 묻는 table은 짧게 끊는다(계획 재계산이 오래 멈추지 않게). 서버 중계는 서버 대기만큼 길게 둔다
        tableTimeoutMs: shapeViaServer ? undefined : OSM_TABLE_TIMEOUT_MS,
        netClock: opts.netClock,
      })
    : local;
  const kakao = opts.apiUrl ? { apiUrl: opts.apiUrl } : opts.kakaoKey ? { key: opts.kakaoKey } : undefined;
  const inner = kakao ? createKakaoRoutes({ ...kakao, fetch: opts.fetch, fallback: shaped, netClock: opts.netClock }) : shaped;
  const cache = createRouteCache({ clock: opts.clock, kv: opts.kv, signature: routeCacheSignature(opts) });
  const real = opts.apiUrl ? createOdsayTransit({ apiUrl: opts.apiUrl, fetch: opts.fetch, netClock: opts.netClock }) : undefined;
  return cache.wrap(withTransitModel(inner, { real }));
}

export { createRouteCache, type RouteLegOut, type RouteMatrix } from './cache';
export {
  createKakaoRoutes,
  KAKAO_DIRECTIONS_URL,
  KAKAO_DISABLED_COOLDOWN_MS,
  KAKAO_FALLBACK_TTL_MS,
  parseKakaoRoute,
} from './kakao';
export { createLocalRoutes } from './local';
export {
  createOsmRoutes,
  OSM_ATTRIBUTION,
  OSM_PROXY_PATH,
  OSM_PROXY_TIMEOUT_MS,
  OSM_ROUTING_URL,
  OSM_COOLDOWN_MS,
  OSM_TABLE_MAX_COORDS,
  OSM_TABLE_TIMEOUT_MS,
  OSRM_CAR_TIME_FACTOR,
  osmProxyBase,
  osmRouteUrl,
  osmStepText,
  osmTableUrl,
  osrmMinutes,
  parseOsmRoute,
  parseOsmTable,
} from './osm';
export {
  INTERCITY,
  INTERCITY_KM,
  ODSAY_FALLBACK_TTL_MS,
  transitBreakdown,
  withTransitModel,
  type RealTransit,
} from './transit';
export {
  createOdsayTransit,
  ODSAY_ATTRIBUTION,
  ODSAY_DISABLED_COOLDOWN_MS,
  odsayErrorCode,
  odsayLaneUrl,
  odsaySearchUrl,
  odsayStepText,
  parseOdsayLanes,
  parseOdsayRoute,
} from './odsay';
