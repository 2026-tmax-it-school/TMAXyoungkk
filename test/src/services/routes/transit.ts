import type { LatLng } from '../../types';
import { DETOUR_FACTOR, FALLBACK_SPEED_KMH } from '../../core/constants';
import { sameCoord } from '../../core/planner/estimate';
import type { RouteProvider, TravelMatrix } from '../../core/ports';
import { haversineKm } from '../../core/util';
import { SCENARIO_PLACES } from '../../data/scenario';
import { SCENARIO_ROUTE_TABLE, SCENARIO_TRANSIT } from '../../data/scenario-tuning';
import type { RouteLegOut } from './cache';
import { createPlaceIndex, lookupTable, type PlaceIndex, type RouteTable } from './local';
import { OSM_ATTRIBUTION } from './osm';

/**
 * 대중교통 모의 모델(FR-504 2차, WP4 소유, 순수). 'transit'만 가로채고 나머지 수단은 inner로 넘긴다.
 * 분 = 도보 접근 + 배차 간격 절반 대기 + 승차 + 환승 횟수 × 환승 벌점.
 * 승차 시간은 구간 덮어쓰기가 없으면 직선거리 × 우회 계수 ÷ 승차 속도다. 환승은 8km를 넘으면 1회로 본다(가정).
 * 구간표 transit 값이 null이면 경로 없음이다. 실제 노선이 아니므로 언제나 estimated다.
 * 선 모양은 inner가 자동차 도로 모양(road)을 주면 그것을 빌린다. 없으면 두 점 직선이다.
 * 실제 길 시간 결정(2026-10-09) 뒤에도 승차 시간은 자동차 길 시간으로 바꾸지 않는다. 버스는 정류장 정차·노선 우회가 있어
 * 자동차 시간(교통 보정 포함)보다 늘 길고, 노선 없이 자동차 시간을 쓰면 실제 노선처럼 보여 추정 표시와 어긋난다.
 * 계획 행렬에서 대중교통 때문에 길 서버에 묻는 일도 없게 둔다(재계산 경로 예산).
 * 자동차 도로 모양은 carShape로 묻는다. 앱(index.ts)은 캐시를 거친 제공자의 자동차 경로를 넘긴다(구간 비교에서 자동차 칸과
 * 같은 요청을 나눠 쓰고 24시간 캐시에서 나온다). 넘기지 않으면 inner의 자동차 경로다.
 * 자동차 경로가 실패하면(카카오 직접 호출이 던짐) 직선이지만 임시 결과(provisional)로 두어 캐시가 하루 내내 직선으로 두지 않는다.
 * 빌린 자동차 경로가 짧게만 캐시되는 값이면(ttlMs, 서버에 카카오 키 없음) 대중교통 경로도 그만큼만 둔다.
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
  opts: {
    table?: RouteTable;
    params?: TransitParams;
    places?: readonly { placeId: string; coord: LatLng }[];
    /** 선 모양을 빌릴 자동차 경로. 없으면 inner.route(a, b, 'car') */
    carShape?: (a: LatLng, b: LatLng) => Promise<RouteLegOut | null>;
  } = {},
): RouteProvider {
  const table = opts.table ?? SCENARIO_ROUTE_TABLE;
  const carShape: (a: LatLng, b: LatLng) => Promise<RouteLegOut | null> = opts.carShape ?? ((a, b) => inner.route(a, b, 'car'));
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
      const meters = Math.round(haversineKm(a, b) * DETOUR_FACTOR.transit * 1000);
      const p = r.parts ?? transitBreakdown(a, b, params, legKey(a, b));
      const steps = [
        { text: `정류장까지 걷기 ${p.accessMin}분`, meters: 0 },
        { text: `버스 기다리기 ${p.waitMin}분(배차 간격의 절반)`, meters: 0 },
        { text: `버스 타고 ${p.rideMin}분`, meters },
      ];
      if (p.transfers > 0) steps.push({ text: `환승 ${p.transfers}회 ${p.transferMin}분`, meters: 0 });
      const leg: RouteLegOut = {
        transport,
        minutes: r.minutes,
        meters,
        polyline: [a, b],
        steps,
        note: '대중교통 모의 모델(2차) · 실제 노선 아님',
        estimated: true,
      };
      // 버스도 찻길로 다니므로 선 모양은 자동차 도로 모양을 빌린다(노선 자체는 아니다). 시간·안내 줄은 모의 모델 그대로다
      // 자동차 경로가 실패하면 직선을 임시 결과로 둔다(일시 장애 한 번으로 하루 내내 직선이 되지 않게)
      const road = await carShape(a, b).catch(() => {
        leg.provisional = true;
        return null;
      });
      if (road?.ttlMs !== undefined) leg.ttlMs = road.ttlMs;
      if (road?.road && road.polyline.length >= 2) {
        const roadMeters = road.meters;
        leg.polyline = road.polyline;
        leg.road = road.road;
        leg.meters = roadMeters;
        leg.steps = steps.map((x) => (x.meters > 0 ? { ...x, meters: roadMeters } : x));
        leg.note = `${leg.note} · 선은 찻길 모양${road.road === 'osm' ? `(${OSM_ATTRIBUTION})` : ''}`;
      } else if (road?.provisional) leg.provisional = true;
      return leg;
    },
    clearCache: () => inner.clearCache(),
  };
}
