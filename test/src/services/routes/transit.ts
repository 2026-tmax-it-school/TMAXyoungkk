import type { LatLng } from '../../types';
import { DETOUR_FACTOR, FALLBACK_SPEED_KMH } from '../../core/constants';
import { sameCoord } from '../../core/planner/estimate';
import type { RouteLeg, RouteProvider, TravelMatrix } from '../../core/ports';
import { haversineKm } from '../../core/util';
import { SCENARIO_PLACES } from '../../data/scenario';
import { SCENARIO_ROUTE_TABLE, SCENARIO_TRANSIT } from '../../data/scenario-tuning';
import { createPlaceIndex, lookupTable, type PlaceIndex, type RouteTable } from './local';

/**
 * 대중교통 모의 모델(FR-504 2차, WP4 소유, 순수). 'transit'만 가로채고 나머지 수단은 inner로 넘긴다.
 * 분 = 도보 접근 + 배차 간격 절반 대기 + 승차 + 환승 횟수 × 환승 벌점.
 * 승차 시간은 구간 덮어쓰기가 없으면 직선거리 × 우회 계수 ÷ 승차 속도다. 환승은 8km를 넘으면 1회로 본다(가정).
 * 구간표 transit 값이 null이면 경로 없음이다. 실제 노선이 아니므로 언제나 estimated다.
 */

export interface TransitParams {
  accessWalkMin: number;
  defaultHeadwayMin: number;
  transferPenaltyMin: number;
  legs: Record<string, { rideMin: number; headwayMin: number; transfers: number }>;
}

/** 이 거리를 넘으면 환승 1회로 본다(프로토타입 가정) */
const TRANSFER_KM = 8;

export interface TransitBreakdown {
  accessMin: number;
  waitMin: number;
  rideMin: number;
  transfers: number;
  transferMin: number;
  total: number;
}

export function transitBreakdown(
  a: LatLng,
  b: LatLng,
  params: TransitParams,
  legKey?: string,
): TransitBreakdown {
  const over = legKey ? params.legs[legKey] : undefined;
  const km = haversineKm(a, b);
  const rideMin = over?.rideMin ?? Math.max(1, Math.round(((km * DETOUR_FACTOR.transit) / FALLBACK_SPEED_KMH.transit) * 60));
  const headway = over?.headwayMin ?? params.defaultHeadwayMin;
  const transfers = over?.transfers ?? (km > TRANSFER_KM ? 1 : 0);
  const waitMin = Math.round(headway / 2);
  const transferMin = transfers * params.transferPenaltyMin;
  const accessMin = params.accessWalkMin;
  return { accessMin, waitMin, rideMin, transfers, transferMin, total: accessMin + waitMin + rideMin + transferMin };
}

export function withTransitModel(
  inner: RouteProvider,
  opts: { table?: RouteTable; params?: TransitParams; places?: readonly { placeId: string; coord: LatLng }[] } = {},
): RouteProvider {
  const table = opts.table ?? SCENARIO_ROUTE_TABLE;
  const params = opts.params ?? SCENARIO_TRANSIT;
  const index: PlaceIndex = createPlaceIndex(opts.places ?? SCENARIO_PLACES);

  function legKey(a: LatLng, b: LatLng): string | undefined {
    const pa = index.placeIdAt(a);
    const pb = index.placeIdAt(b);
    return pa && pb ? `${pa}>${pb}` : undefined;
  }

  function one(a: LatLng, b: LatLng): { minutes: number | null; parts?: TransitBreakdown } {
    if (sameCoord(a, b)) return { minutes: 0 };
    const known = lookupTable(table, index, a, b, 'transit');
    if (known === null) return { minutes: null };
    if (known !== undefined) return { minutes: known };
    const parts = transitBreakdown(a, b, params, legKey(a, b));
    return { minutes: parts.total, parts };
  }

  return {
    id: inner.id,
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
    async route(a, b, transport): Promise<RouteLeg | null> {
      if (transport !== 'transit') return inner.route(a, b, transport);
      const r = one(a, b);
      if (r.minutes == null) return null;
      const meters = Math.round(haversineKm(a, b) * DETOUR_FACTOR.transit * 1000);
      const p = r.parts ?? transitBreakdown(a, b, params, legKey(a, b));
      const steps = [
        { text: `정류장까지 걷기 ${p.accessMin}분`, meters: 0 },
        { text: `버스 기다리기 ${p.waitMin}분(배차 간격의 절반)`, meters: 0 },
        { text: `버스 타고 ${p.rideMin}분`, meters },
      ];
      if (p.transfers > 0) steps.push({ text: `환승 ${p.transfers}회 ${p.transferMin}분`, meters: 0 });
      return {
        transport,
        minutes: r.minutes,
        meters,
        polyline: [a, b],
        steps,
        note: '대중교통 모의 모델(2차) · 실제 노선 아님',
        estimated: true,
      };
    },
    clearCache: () => inner.clearCache(),
  };
}
