import type { LatLng, Transport } from '../../types';
import { TRANSPORT_LABEL } from '../../core/constants';
import { estimateMeters, estimateMinutes, sameCoord } from '../../core/planner/estimate';
import type { RouteLeg, RouteProvider, TravelMatrix } from '../../core/ports';
import { SCENARIO_PLACES } from '../../data/scenario';
import { SCENARIO_ROUTE_TABLE } from '../../data/scenario-tuning';

/**
 * 로컬 경로 제공자(WP4 소유, 순수). 키가 없을 때의 기본값이다.
 * 1. 구간표(placeId 키, 방향별)에 있으면 그 값을 쓴다. null은 그 수단 경로 없음이다.
 * 2. 없으면 직선거리 × 우회 계수 ÷ 수단 속도 + 구간 고정 비용으로 추정한다(core/planner/estimate와 같은 식).
 *
 * RouteProvider는 좌표만 받으므로 장소 좌표를 소수 4자리(약 10m)로 색인해 좌표 → placeId를 찾는다(계약 A11).
 * 호출 수는 계산한 구간 수로 센다(캐시에서 나오지 않은 구간 = 호출). 같은 지점끼리는 세지 않는다.
 * 행렬은 칸마다 추정인지(estimatedCells)도 낸다(구간표 칸과 직선 추정 칸이 한 행렬에 섞여도 구간마다 맞게).
 */

export type RouteTable = Record<Transport, Record<string, number | null>>;

export interface PlaceIndex {
  placeIdAt(c: LatLng): string | undefined;
}

export function coordKey4(c: LatLng): string {
  return `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;
}

export function createPlaceIndex(places: readonly { placeId: string; coord: LatLng }[]): PlaceIndex {
  const map = new Map<string, string>();
  for (const p of places) if (!map.has(coordKey4(p.coord))) map.set(coordKey4(p.coord), p.placeId);
  return { placeIdAt: (c) => map.get(coordKey4(c)) };
}

/** 구간표 조회. 표에 없으면 undefined, 경로 없음이면 null */
export function lookupTable(
  table: RouteTable,
  index: PlaceIndex,
  a: LatLng,
  b: LatLng,
  t: Transport,
): number | null | undefined {
  const pa = index.placeIdAt(a);
  const pb = index.placeIdAt(b);
  if (!pa || !pb) return undefined;
  const key = `${pa}>${pb}`;
  const row = table[t];
  return key in row ? row[key] : undefined;
}

export interface LocalRoutesOptions {
  table?: RouteTable;
  places?: readonly { placeId: string; coord: LatLng }[];
}

export function createLocalRoutes(opts: LocalRoutesOptions = {}): RouteProvider {
  const table = opts.table ?? SCENARIO_ROUTE_TABLE;
  const index = createPlaceIndex(opts.places ?? SCENARIO_PLACES);

  function one(a: LatLng, b: LatLng, t: Transport): { minutes: number | null; estimated: boolean } {
    if (sameCoord(a, b)) return { minutes: 0, estimated: false };
    const known = lookupTable(table, index, a, b, t);
    if (known !== undefined) return { minutes: known, estimated: false };
    return { minutes: estimateMinutes(a, b, t), estimated: true };
  }

  return {
    id: 'local',
    async matrix(origins, destinations, transport): Promise<TravelMatrix> {
      let calls = 0;
      let estimated = false;
      const estimatedCells = origins.map(() => destinations.map(() => false));
      const minutes = origins.map((o, i) =>
        destinations.map((d, j) => {
          if (!sameCoord(o, d)) calls += 1;
          const r = one(o, d, transport);
          estimated ||= r.estimated;
          estimatedCells[i][j] = r.estimated;
          return r.minutes;
        }),
      );
      return { minutes, calls, cacheHits: 0, estimated, estimatedCells };
    },
    async route(a, b, transport): Promise<RouteLeg | null> {
      const r = one(a, b, transport);
      if (r.minutes == null) return null;
      const meters = estimateMeters(a, b, transport);
      return {
        transport,
        minutes: r.minutes,
        meters,
        polyline: [a, b],
        steps: [
          { text: `${TRANSPORT_LABEL[transport]}로 출발`, meters: 0 },
          { text: `약 ${(meters / 1000).toFixed(1)}km 이동 후 도착`, meters },
        ],
        note: r.estimated ? '직선거리 기준 추정(예시 데이터)' : '예시 구간표(예시 데이터)',
        estimated: r.estimated,
      };
    },
    async clearCache() {},
  };
}
