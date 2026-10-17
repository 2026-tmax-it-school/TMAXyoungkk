import type { LatLng } from '../types';
import type { FetchLike, Region } from '../core/ports';
import { nearestRegionLocal, regionFromAdmin, searchRegionsLocal } from '../data/regions';
import { createKakaoClient, type KakaoClient } from './kakaoHttp';

/**
 * 여행 지역 고르기(FR-201, 2026-10-10). 여행방 만들기·설정의 지역 시트가 쓴다.
 * - search('익산') → 카카오 주소 검색(REGION 결과)에서 시·군을 뽑아 여행 지역으로 바꾼다(data/regions regionFromAdmin)
 * - at(좌표) → 카카오 좌표 → 행정구역으로 그 지점의 시·군을 찾고, 그 시·군의 중심을 주소 검색으로 다시 받는다
 * 카카오를 쓸 수 없으면(키 없음, 서버 실패) 목록 지역(data/regions REGIONS) 안에서 찾는다.
 *
 * 문서(developers.kakao.com 로컬 API):
 * - 주소 검색 GET /v2/local/search/address.json?query → documents[]{address_name, address_type, x, y,
 *   address{region_1depth_name, region_2depth_name, region_3depth_name}}. 시·군 자체는 address_type 'REGION'이다
 * - 좌표 → 행정구역 GET /v2/local/geo/coord2regioncode.json?x&y → documents[]{region_type 'B'|'H', region_1depth_name,
 *   region_2depth_name, region_3depth_name, x, y}
 */

export const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
export const KAKAO_REGION_CODE_URL = 'https://dapi.kakao.com/v2/local/geo/coord2regioncode.json';

export interface RegionSearch {
  /** 검색어로 찾은 여행 지역(겹치지 않게, 많아야 limit개) */
  search(query: string, limit?: number): Promise<Region[]>;
  /** 이 지점이 속한 여행 지역. 국외이거나 못 찾으면 undefined */
  at(coord: LatLng): Promise<Region | undefined>;
}

interface AddressDoc {
  address_type?: string;
  x?: string;
  y?: string;
  address?: { region_1depth_name?: string; region_2depth_name?: string; region_3depth_name?: string } | null;
  road_address?: { region_1depth_name?: string; region_2depth_name?: string } | null;
}
interface RegionCodeDoc {
  region_type?: string;
  region_1depth_name?: string;
  region_2depth_name?: string;
}

function coordOf(d: { x?: string; y?: string }): LatLng | undefined {
  const lng = Number(d.x);
  const lat = Number(d.y);
  return Number.isFinite(lng) && Number.isFinite(lat) && d.x !== undefined && d.y !== undefined ? { latitude: lat, longitude: lng } : undefined;
}

/** 주소 검색 결과 → 여행 지역(겹치는 지역은 하나만). 시·군 자체(REGION)를 앞에 둔다 */
export function regionsFromAddress(json: unknown, limit = 8): Region[] {
  const docs = ((json as { documents?: AddressDoc[] } | null)?.documents ?? []).slice();
  // 시·군 자체 결과(동·리가 비어 있는 REGION)가 먼저다. 같은 시·군의 동·도로명 결과는 그 시·군으로 모인다
  const rank = (d: AddressDoc) => (d.address_type === 'REGION' ? (d.address?.region_3depth_name ? 1 : 0) : 2);
  docs.sort((a, b) => rank(a) - rank(b));
  const out: Region[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const a = d.address ?? d.road_address;
    const c = coordOf(d);
    if (!a?.region_1depth_name || !c) continue;
    const r = regionFromAdmin(a.region_1depth_name, a.region_2depth_name, c);
    if (!r || seen.has(r.label)) continue;
    seen.add(r.label);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

export function createRegionSearch(opts: { apiUrl?: string; kakaoKey?: string; fetch: FetchLike }): RegionSearch {
  const client: KakaoClient | undefined =
    opts.apiUrl || opts.kakaoKey ? createKakaoClient({ apiUrl: opts.apiUrl, key: opts.apiUrl ? undefined : opts.kakaoKey, fetch: opts.fetch }) : undefined;

  async function kakaoSearch(query: string, limit: number): Promise<Region[]> {
    if (!client) throw new Error('카카오 없음');
    const json = await client.get(KAKAO_ADDRESS_URL, { query, size: 30 });
    return regionsFromAddress(json, limit);
  }

  return {
    async search(query, limit = 8) {
      const q = query.trim();
      if (q.length < 1) return [];
      try {
        const found = await kakaoSearch(q, limit);
        if (found.length > 0) return found;
      } catch {
        // 카카오를 못 쓰면 목록에서 찾는다
      }
      return searchRegionsLocal(q).slice(0, limit);
    },
    async at(coord) {
      if (client) {
        try {
          const json = await client.get(KAKAO_REGION_CODE_URL, { x: coord.longitude, y: coord.latitude });
          const docs = (json as { documents?: RegionCodeDoc[] } | null)?.documents ?? [];
          const doc = docs.find((d) => d.region_type === 'B') ?? docs[0];
          if (doc?.region_1depth_name) {
            // 지역 중심은 그 시·군의 주소 검색 좌표(누른 지점이 아니다). 못 받으면 누른 지점
            const name = [doc.region_1depth_name, doc.region_2depth_name].filter(Boolean).join(' ');
            const center = (await kakaoSearch(name, 1).catch(() => []))[0]?.center;
            const r = regionFromAdmin(doc.region_1depth_name, doc.region_2depth_name, center ?? coord);
            if (r) return r;
          }
          if (docs.length === 0) return undefined;
        } catch {
          // 아래 목록 지역으로
        }
      }
      return nearestRegionLocal(coord);
    },
  };
}

/** 목록 지역만 쓰는 검색(테스트·카카오 없음) */
export function createLocalRegionSearch(): RegionSearch {
  return {
    async search(query, limit = 8) {
      return searchRegionsLocal(query).slice(0, limit);
    },
    async at(coord) {
      return nearestRegionLocal(coord);
    },
  };
}

