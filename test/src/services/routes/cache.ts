import type { LatLng, Transport } from '../../types';
import { ROUTE_CACHE_TTL_MS } from '../../core/constants';
import { coordKey, sameCoord } from '../../core/planner/estimate';
import type { Clock, KV, RouteLeg, RouteProvider, TravelMatrix } from '../../core/ports';

/**
 * 경로 캐시(WP4 소유, 순수). 동일 구간 결과를 24시간(ROUTE_CACHE_TTL_MS) 둔다. KV 주입이라 node 테스트가 된다.
 * 구간 단위로 저장한다. 행렬 요청 가운데 캐시에 있는 구간은 cacheHits로, 없는 구간만 안쪽 제공자에 묻고 calls로 센다.
 * 경로 없음(null)도 저장한다(같은 구간을 다시 묻지 않게).
 * KV에는 키 나열이 없으므로 색인 키 'index' 하나에 전체를 JSON으로 둔다(계약 A11). 지난 항목은 쓸 때 지운다.
 * 쓰기는 한 번에 하나만 하고, 쓰기를 기다리는 동안 들어온 저장 요청은 다음 쓰기 하나로 모은다(구간마다 전체를 다시 쓰지 않게).
 * route() 결과는 polyline을 담아 크므로 ROUTE_ENTRY_MAX개까지만 두고 오래된 것부터 버린다(웹 저장소 용량).
 */

const INDEX_KEY = 'index';
export const ROUTE_ENTRY_MAX = 200;

interface MinEntry {
  at: number;
  m: number | null;
  est: boolean;
}
interface LegEntry {
  at: number;
  leg: RouteLeg | null;
}
interface Blob {
  v: 1;
  m: Record<string, MinEntry>;
  r: Record<string, LegEntry>;
}

export interface RouteCache {
  wrap(inner: RouteProvider): RouteProvider;
  clear(): Promise<void>;
}

function pairKey(t: Transport, a: LatLng, b: LatLng): string {
  return `${t}|${coordKey(a)}>${coordKey(b)}`;
}

export function createRouteCache(opts: { clock: Clock; kv: KV; ttlMs?: number }): RouteCache {
  const ttl = opts.ttlMs ?? ROUTE_CACHE_TTL_MS;
  let blob: Blob | undefined;
  let loading: Promise<Blob> | undefined;

  async function load(): Promise<Blob> {
    if (blob) return blob;
    if (!loading) {
      loading = (async () => {
        let parsed: Blob = { v: 1, m: {}, r: {} };
        try {
          const raw = await opts.kv.get(INDEX_KEY);
          if (raw) {
            const j = JSON.parse(raw) as Partial<Blob>;
            if (j && j.v === 1) parsed = { v: 1, m: j.m ?? {}, r: j.r ?? {} };
          }
        } catch {
          // 깨진 캐시는 버린다
        }
        blob = parsed;
        return parsed;
      })();
    }
    return loading;
  }

  const fresh = (at: number) => opts.clock.now() - at <= ttl;

  async function write(b: Blob): Promise<void> {
    for (const k of Object.keys(b.m)) if (!fresh(b.m[k].at)) delete b.m[k];
    for (const k of Object.keys(b.r)) if (!fresh(b.r[k].at)) delete b.r[k];
    const routeKeys = Object.keys(b.r);
    if (routeKeys.length > ROUTE_ENTRY_MAX) {
      routeKeys
        .sort((x, y) => b.r[x].at - b.r[y].at)
        .slice(0, routeKeys.length - ROUTE_ENTRY_MAX)
        .forEach((k) => delete b.r[k]);
    }
    try {
      await opts.kv.set(INDEX_KEY, JSON.stringify(b));
    } catch {
      // 저장 실패는 캐시가 없는 것과 같다
    }
  }

  let inflight: Promise<void> = Promise.resolve();
  let queued: Promise<void> | undefined;
  /** 아직 시작하지 않은 쓰기가 있으면 그것에 합친다. 쓰기는 시작할 때 blob 전체를 읽으므로 그 전 변경이 모두 들어간다 */
  function save(b: Blob): Promise<void> {
    if (queued) return queued;
    const q = inflight.then(() => {
      queued = undefined;
      return write(b);
    });
    queued = q;
    inflight = q;
    return q;
  }

  async function clear(): Promise<void> {
    // 기다리던 쓰기가 지운 뒤에 예전 내용을 다시 쓰지 않게 먼저 끝낸다
    await inflight;
    blob = { v: 1, m: {}, r: {} };
    loading = Promise.resolve(blob);
    await opts.kv.remove(INDEX_KEY);
  }

  return {
    clear,
    wrap(inner) {
      return {
        id: inner.id,
        async matrix(origins, destinations, t): Promise<TravelMatrix> {
          const b = await load();
          const minutes: (number | null)[][] = origins.map(() => destinations.map(() => null));
          let cacheHits = 0;
          let calls = 0;
          let estimated = false;
          // 출발지별로 모르는 목적지만 묻는다
          const missByOrigin = new Map<number, number[]>();
          origins.forEach((o, i) =>
            destinations.forEach((d, j) => {
              if (sameCoord(o, d)) {
                minutes[i][j] = 0;
                return;
              }
              const e = b.m[pairKey(t, o, d)];
              if (e && fresh(e.at)) {
                minutes[i][j] = e.m;
                estimated ||= e.est;
                cacheHits += 1;
              } else {
                const list = missByOrigin.get(i) ?? [];
                list.push(j);
                missByOrigin.set(i, list);
              }
            }),
          );
          if (missByOrigin.size > 0) {
            const now = opts.clock.now();
            for (const [i, js] of missByOrigin) {
              const res = await inner.matrix(
                [origins[i]],
                js.map((j) => destinations[j]),
                t,
              );
              calls += res.calls;
              cacheHits += res.cacheHits;
              estimated ||= res.estimated;
              js.forEach((j, k) => {
                const m = res.minutes[0]?.[k] ?? null;
                minutes[i][j] = m;
                b.m[pairKey(t, origins[i], destinations[j])] = { at: now, m, est: res.estimated };
              });
            }
            await save(b);
          }
          return { minutes, calls, cacheHits, estimated };
        },
        async route(a, bb, t) {
          const blobNow = await load();
          const k = pairKey(t, a, bb);
          const e = blobNow.r[k];
          if (e && fresh(e.at)) return e.leg;
          const leg = await inner.route(a, bb, t);
          blobNow.r[k] = { at: opts.clock.now(), leg };
          await save(blobNow);
          return leg;
        },
        async clearCache() {
          await clear();
          await inner.clearCache();
        },
      };
    },
  };
}
