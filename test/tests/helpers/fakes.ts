import type { LatLng, Place, Transport } from '../../src/types';
import type {
  Clock,
  FetchLike,
  Hasher,
  IdGen,
  PlaceProvider,
  Region,
  Rng,
  RouteLeg,
  RouteProvider,
  TravelMatrix,
} from '../../src/core/ports';
import { memoryKV } from '../../src/core/kv';
import { sha256Hex } from '../../src/core/sha256';
import { haversineKm } from '../../src/core/util';

/**
 * 테스트용 가짜 외부 의존. 전부 결정적이다. 패키지 테스트는 여기서 가져다 쓴다(계약 A1).
 */

export { memoryKV };

export interface FixedClock extends Clock {
  set(t: number): void;
  advance(ms: number): void;
}

/** 멈춘 시계. set·advance로만 움직인다. */
export function fixedClock(start: number): FixedClock {
  let t = start;
  return {
    now: () => t,
    set(v) {
      t = v;
    },
    advance(ms) {
      t += ms;
    },
  };
}

/** 'prefix_1', 'prefix_2' … 순번 ID */
export function seqIds(): IdGen & { count(): number } {
  let n = 0;
  return {
    next(prefix: string) {
      n += 1;
      return `${prefix}_${n}`;
    },
    count: () => n,
  };
}

/** 시드 고정 난수(mulberry32). 같은 시드면 같은 바이트열 */
export function seededRng(seed = 1): Rng & { float(): number } {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    bytes(n: number) {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) out[i] = Math.floor(next() * 256);
      return out;
    },
    float: next,
  };
}

/** 순수 SHA-256 그대로(결정적) */
export const fakeHasher: Hasher = { sha256: async (t: string) => sha256Hex(t) };

export function coordKey(c: LatLng): string {
  return `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

/** 구간 키 'lat,lng>lat,lng' */
export function routeKey(a: LatLng, b: LatLng): string {
  return `${coordKey(a)}>${coordKey(b)}`;
}

/**
 * 구간표 RouteProvider. 표에 없는 구간은 직선거리 30km/h로 추정한다(estimated).
 * table 값이 null이면 그 구간 경로 없음. 조회한 구간 수를 calls로 센다.
 */
export function tableRoutes(
  table: Record<string, number | null> = {},
  opts: { speedKmh?: number } = {},
): RouteProvider & { calls: number } {
  const speed = opts.speedKmh ?? 30;
  const minutesOf = (a: LatLng, b: LatLng): { m: number | null; estimated: boolean } => {
    const k = routeKey(a, b);
    if (k in table) return { m: table[k], estimated: false };
    return { m: Math.max(1, Math.round((haversineKm(a, b) / speed) * 60)), estimated: true };
  };
  const self = {
    id: 'local' as const,
    calls: 0,
    async matrix(origins: LatLng[], destinations: LatLng[], _t: Transport): Promise<TravelMatrix> {
      let estimated = false;
      let calls = 0;
      const minutes = origins.map((o) =>
        destinations.map((d) => {
          calls += 1;
          const r = minutesOf(o, d);
          estimated ||= r.estimated;
          return r.m;
        }),
      );
      self.calls += calls;
      return { minutes, calls, cacheHits: 0, estimated };
    },
    async route(a: LatLng, b: LatLng, transport: Transport): Promise<RouteLeg | null> {
      self.calls += 1;
      const r = minutesOf(a, b);
      if (r.m == null) return null;
      return {
        transport,
        minutes: r.m,
        meters: Math.round(haversineKm(a, b) * 1000),
        polyline: [a, b],
        steps: [],
        estimated: r.estimated,
      };
    },
    async clearCache() {},
  };
  return self;
}

/** 이름 포함 검색만 하는 PlaceProvider */
export function fakePlaces(places: Place[]): PlaceProvider {
  return {
    id: 'local',
    async search(query: string, _region: Region) {
      const q = query.replace(/\s+/g, '');
      return places.filter((p) => p.name.replace(/\s+/g, '').includes(q));
    },
    async nearby(coord, radiusM, o = {}) {
      const ex = new Set(o.excludePlaceIds ?? []);
      return places
        .filter((p) => !ex.has(p.placeId) && haversineKm(coord, p.coord) * 1000 <= radiusM)
        .slice(0, o.limit ?? 20);
    },
    async at(coord, radiusM) {
      return places.find((p) => haversineKm(coord, p.coord) * 1000 <= radiusM) ?? null;
    },
  };
}

export interface FakeFetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

/** 요청을 기록하는 fetch. handler가 없으면 200과 빈 객체를 돌려준다. */
export function fakeFetch(
  handler?: (call: FakeFetchCall) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>,
): FetchLike & { calls: FakeFetchCall[] } {
  const calls: FakeFetchCall[] = [];
  const fn = (async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const res = handler ? await handler(call) : { status: 200, body: {} };
    const status = res.status ?? 200;
    const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as FetchLike & { calls: FakeFetchCall[] };
  fn.calls = calls;
  return fn;
}
