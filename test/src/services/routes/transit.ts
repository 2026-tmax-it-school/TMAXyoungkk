import type { LatLng } from '../../types';
import { DETOUR_FACTOR, FALLBACK_SPEED_KMH } from '../../core/constants';
import { sameCoord } from '../../core/planner/estimate';
import type { RouteProvider, TravelMatrix } from '../../core/ports';
import { haversineKm } from '../../core/util';
import { SCENARIO_PLACES } from '../../data/scenario';
import { SCENARIO_ROUTE_TABLE, SCENARIO_TRANSIT } from '../../data/scenario-tuning';
import type { RouteLegOut } from './cache';
import { createPlaceIndex, lookupTable, type PlaceIndex, type RouteTable } from './local';
import type { OdsayOutcome } from './odsay';

/**
 * 대중교통(FR-504, WP4 소유, 순수). 'transit'만 가로채고 나머지 수단은 inner로 넘긴다.
 *
 * 경로(route): real(ODsay, 서버 경유)이 있으면 먼저 실제 노선을 묻는다(odsay.ts). 버스 번호·지하철 노선·승하차 정류장·정류장 수가
 * 안내 줄에 들어가고, 선은 노선 모양(또는 지나는 정류장)을 따른다. ODsay가 대중교통 경로가 없다고 하면(너무 가까움 등) 경로 없음(null)이다.
 * ODsay를 쓸 수 없으면(키 없음·닿지 못함) 아래 추정 모델로 넘어가고, 그 결과는 캐시에 오래 두지 않는다
 * (키 없음은 ODSAY_FALLBACK_TTL_MS, 일시 장애는 임시 결과). 예시 구간표의 transit 값(시연 수치)이 있는 구간은 구간표가 먼저다.
 *
 * 대중교통 시간은 탑승 시간만이다(2026-10-10 결정). 걷기·배차 간격 대기·환승 시간은 넣지 않는다.
 * 실제 노선(ODsay)은 여러 경로 중 탑승 시간이 가장 짧은 경로 하나를 보인다(odsay.ts).
 * 추정 모델(행렬 · ODsay를 못 쓸 때의 경로): 분 = 승차 시간. 시나리오 값의 accessWalkMin·headwayMin·transferPenaltyMin은 읽지 않는다.
 * - 시내(직선 40km 이하): 승차 = 직선거리 × 우회 계수 ÷ 시내 승차 속도(구간 덮어쓰기 rideMin이 있으면 그 값)
 * - 시외(직선 40km 초과): 열차·고속버스로 본다. 승차 = 직선 × 1.15 ÷ 130km/h(가정).
 *   예전에는 장거리도 시내버스 속도로 계산해 서울역 → 경주역이 18시간으로 나왔다(2026-10-10 수정, 이제 약 3시간)
 * 구간표 transit 값이 null이면 경로 없음이다. 추정은 실제 노선이 아니므로 언제나 estimated이고, 선은 두 점 직선이다
 * (찻길 모양을 빌리면 실제 노선처럼 보여 오해를 산다. 2026-10-10 결정).
 * 계획 행렬은 언제나 추정 모델이다(재계산 경로 예산: 구간마다 ODsay를 묻지 않는다).
 */

export interface TransitParams {
  accessWalkMin: number;
  defaultHeadwayMin: number;
  transferPenaltyMin: number;
  legs: Record<string, { rideMin: number; headwayMin: number; transfers: number }>;
}

/**
 * 대중교통 추정 계산 버전. 계산이 바뀌면 올린다. 경로 캐시 서명(index.ts routeCacheSignature)에 들어가
 * 기기에 남은 예전 계산 결과(24시간 캐시)를 버린다. 3: 배차 간격 대기 제거, 4: 탑승 시간만 · 가장 빠른 경로(2026-10-10)
 */
export const TRANSIT_MODEL_VERSION = 4;

/** 이 직선거리를 넘으면 시외(열차·고속버스)로 본다 */
export const INTERCITY_KM = 40;
/** 시외 추정 값(가정): 승차 속도(직선 기준), 우회 계수 */
export const INTERCITY = { speedKmh: 130, detour: 1.15 } as const;
/** ODsay 키가 없는 동안 추정 결과를 캐시에 두는 시간(키를 넣으면 몇 분 안에 실제 노선으로 바뀐다) */
export const ODSAY_FALLBACK_TTL_MS = 10 * 60_000;

export interface TransitBreakdown {
  /** 탑승 시간(분) */
  rideMin: number;
  /** 대중교통 시간 = 탑승 시간 */
  total: number;
  /** 시외(열차·고속버스) 추정인지 */
  intercity: boolean;
}

export function transitBreakdown(
  a: LatLng,
  b: LatLng,
  params: TransitParams,
  legKey?: string,
): TransitBreakdown {
  const over = legKey ? params.legs[legKey] : undefined;
  const km = haversineKm(a, b);
  if (!over && km > INTERCITY_KM) {
    const rideMin = Math.max(1, Math.round(((km * INTERCITY.detour) / INTERCITY.speedKmh) * 60));
    return { rideMin, total: rideMin, intercity: true };
  }
  const rideMin = over?.rideMin ?? Math.max(1, Math.round(((km * DETOUR_FACTOR.transit) / FALLBACK_SPEED_KMH.transit) * 60));
  return { rideMin, total: rideMin, intercity: false };
}

/** 추정 안내 줄. 탑승 한 줄이고, 실제 노선이 아니라는 것을 숨기지 않는다 */
function estimateSteps(p: TransitBreakdown, meters: number): { text: string; meters: number }[] {
  return [{ text: `${p.intercity ? '열차·고속버스' : '버스·지하철'} 타고 ${p.rideMin}분(추정)`, meters }];
}

/** 실제 대중교통 경로(odsay.ts createOdsayTransit) */
export interface RealTransit {
  route(a: LatLng, b: LatLng): Promise<OdsayOutcome>;
}

export function withTransitModel(
  inner: RouteProvider,
  opts: {
    table?: RouteTable;
    params?: TransitParams;
    places?: readonly { placeId: string; coord: LatLng }[];
    /** 실제 노선(ODsay). 없으면 언제나 추정 모델 */
    real?: RealTransit;
  } = {},
): RouteProvider {
  const table = opts.table ?? SCENARIO_ROUTE_TABLE;
  const params = opts.params ?? SCENARIO_TRANSIT;
  const index: PlaceIndex = createPlaceIndex(opts.places ?? SCENARIO_PLACES);

  function legKey(a: LatLng, b: LatLng): string | undefined {
    const pa = index.placeIdAt(a);
    const pb = index.placeIdAt(b);
    return pa && pb ? `${pa}>${pb}` : undefined;
  }

  function one(a: LatLng, b: LatLng): { minutes: number | null; parts?: TransitBreakdown; fromTable?: boolean } {
    if (sameCoord(a, b)) return { minutes: 0 };
    const known = lookupTable(table, index, a, b, 'transit');
    if (known === null) return { minutes: null };
    if (known !== undefined) return { minutes: known, fromTable: true };
    const parts = transitBreakdown(a, b, params, legKey(a, b));
    return { minutes: parts.total, parts };
  }

  function estimateLeg(a: LatLng, b: LatLng, minutes: number, parts: TransitBreakdown): RouteLegOut {
    const km = haversineKm(a, b);
    const meters = Math.round(km * (parts.intercity ? INTERCITY.detour : DETOUR_FACTOR.transit) * 1000);
    return {
      transport: 'transit',
      minutes,
      meters,
      polyline: [a, b],
      steps: estimateSteps(parts, meters),
      note: parts.intercity ? '대중교통 추정(시외 열차·고속버스, 탑승 시간만) · 실제 노선 아님' : '대중교통 추정(탑승 시간만) · 실제 노선 아님',
      estimated: true,
    };
  }

  return {
    // 안쪽 제공자의 id가 바뀔 수 있다(서버 경유 카카오가 대체로 넘어가면 'local')
    get id() {
      return inner.id;
    },
    // 대중교통이 아니면 안쪽 결과를 그대로 넘긴다(임시 행렬 표시 provisional도 그대로 간다)
    async matrix(origins, destinations, transport): Promise<TravelMatrix> {
      if (transport !== 'transit') return inner.matrix(origins, destinations, transport);
      let calls = 0;
      const minutes = origins.map((o) =>
        destinations.map((d) => {
          if (!sameCoord(o, d)) calls += 1;
          return one(o, d).minutes;
        }),
      );
      return { minutes, calls, cacheHits: 0, estimated: true };
    },
    async route(a, b, transport): Promise<RouteLegOut | null> {
      if (transport !== 'transit') return inner.route(a, b, transport);
      const r = one(a, b);
      if (r.minutes == null) return null;
      // 실제 노선: 같은 점이 아니고 예시 구간표 구간이 아니면 ODsay에 먼저 묻는다
      let fallbackMark: Pick<RouteLegOut, 'ttlMs' | 'provisional'> = {};
      if (opts.real && r.parts) {
        const out = await opts.real.route(a, b);
        if (out.kind === 'leg') return out.leg;
        if (out.kind === 'none') return null;
        fallbackMark = out.disabled ? { ttlMs: ODSAY_FALLBACK_TTL_MS } : { provisional: true };
      }
      const p = r.parts ?? transitBreakdown(a, b, params, legKey(a, b));
      const leg = estimateLeg(a, b, r.minutes, p);
      return { ...leg, ...fallbackMark };
    },
    clearCache: () => inner.clearCache(),
  };
}
