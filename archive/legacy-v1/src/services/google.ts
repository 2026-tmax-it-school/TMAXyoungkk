import type { LatLng, Transport } from '../types';
import { GOOGLE_MAPS_API_KEY } from '../config';
import { estimateMinutes } from './local';
import {
  cacheKey,
  categoryFromTypes,
  readCache,
  writeCache,
  type MapProvider,
  type PlaceHit,
  type TravelMatrix,
} from './maps';

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

const TRAVEL_MODE: Record<Transport, string> = { car: 'DRIVE', walk: 'WALK' };

/** 마지막으로 난 오류. 화면에 그대로 띄워서 키 문제를 바로 알아채게 한다. */
let lastError = '';

export function getLastGoogleError(): string {
  return lastError;
}

async function post(url: string, fieldMask: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const googleProvider: MapProvider = {
  id: 'google',
  label: '구글 지도 API',

  /** Places API (New) Text Search */
  async searchPlaces(query: string, region: string, bias: LatLng): Promise<PlaceHit[]> {
    try {
      const data = await post(
        PLACES_URL,
        'places.displayName,places.formattedAddress,places.location,places.types',
        {
          textQuery: `${region} ${query}`.trim(),
          languageCode: 'ko',
          regionCode: 'KR',
          maxResultCount: 5,
          locationBias: {
            circle: { center: { latitude: bias.latitude, longitude: bias.longitude }, radius: 30000 },
          },
        },
      );
      lastError = '';
      const places: any[] = data?.places ?? [];
      return places
        .filter((p) => p?.location)
        .map((p) => ({
          name: p.displayName?.text ?? query,
          address: p.formattedAddress,
          coord: { latitude: p.location.latitude, longitude: p.location.longitude },
          category: categoryFromTypes(p.types ?? []),
        }));
    } catch (e: any) {
      lastError = `장소 검색 실패: ${e?.message ?? e}`;
      return [];
    }
  },

  /**
   * Routes API computeRouteMatrix.
   * 이미 24시간 캐시에 있는 구간은 요청에서 빼고, 남은 게 없으면 호출 자체를 하지 않는다.
   */
  async travelMatrix(
    origins: LatLng[],
    destinations: LatLng[],
    transport: Transport,
  ): Promise<TravelMatrix> {
    const minutes = origins.map(() => destinations.map(() => -1));
    let missing = 0;

    for (let i = 0; i < origins.length; i += 1) {
      for (let j = 0; j < destinations.length; j += 1) {
        const cached = readCache(cacheKey(origins[i], destinations[j], transport));
        if (cached === undefined) missing += 1;
        else minutes[i][j] = cached;
      }
    }

    if (missing === 0) return { minutes, calls: 0, estimated: false };

    try {
      const body: any = {
        origins: origins.map((o) => ({
          waypoint: { location: { latLng: { latitude: o.latitude, longitude: o.longitude } } },
        })),
        destinations: destinations.map((d) => ({
          waypoint: { location: { latLng: { latitude: d.latitude, longitude: d.longitude } } },
        })),
        travelMode: TRAVEL_MODE[transport],
      };
      if (transport === 'car') body.routingPreference = 'TRAFFIC_UNAWARE';

      const data = await post(MATRIX_URL, 'originIndex,destinationIndex,duration,condition', body);
      const rows: any[] = Array.isArray(data) ? data : [];

      for (const row of rows) {
        const i = row.originIndex ?? 0;
        const j = row.destinationIndex ?? 0;
        if (row.condition !== 'ROUTE_EXISTS' || !row.duration) continue;
        const sec = Number(String(row.duration).replace('s', ''));
        if (!Number.isFinite(sec)) continue;
        const min = Math.max(1, Math.round(sec / 60));
        minutes[i][j] = min;
        writeCache(cacheKey(origins[i], destinations[j], transport), min);
      }

      // 경로가 없는 칸만 직선거리로 메운다 (FR-504: 자동차 경로 실패 시 대체 계산)
      let estimated = false;
      for (let i = 0; i < origins.length; i += 1) {
        for (let j = 0; j < destinations.length; j += 1) {
          if (minutes[i][j] < 0) {
            minutes[i][j] = estimateMinutes(origins[i], destinations[j], transport);
            estimated = true;
          }
        }
      }
      lastError = '';
      return { minutes, calls: 1, estimated };
    } catch (e: any) {
      lastError = `경로 조회 실패: ${e?.message ?? e}`;
      // FR-501 예외 처리: 경로 API 실패 시 직선거리 기준
      for (let i = 0; i < origins.length; i += 1) {
        for (let j = 0; j < destinations.length; j += 1) {
          if (minutes[i][j] < 0) {
            minutes[i][j] = estimateMinutes(origins[i], destinations[j], transport);
          }
        }
      }
      return { minutes, calls: 1, estimated: true };
    }
  },
};
