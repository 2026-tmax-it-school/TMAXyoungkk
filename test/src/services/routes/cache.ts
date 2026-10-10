import type { LatLng, Transport } from '../../types';
import { ROUTE_CACHE_TTL_MS } from '../../core/constants';
import { coordKey, sameCoord } from '../../core/planner/estimate';
import type { Clock, KV, RouteLeg, RouteProvider, TravelMatrix } from '../../core/ports';

/**
 * 경로 캐시(WP4 소유, 순수). 동일 구간 결과를 24시간(ROUTE_CACHE_TTL_MS) 둔다. KV 주입이라 node 테스트가 된다.
 * 구간 단위로 저장한다. 행렬 요청 가운데 캐시에 있는 구간은 cacheHits로, 없는 구간만 안쪽 제공자에 묻고 calls로 센다.
 * 모르는 구간이 같은 출발지들(묻는 목적지가 같은 출발지끼리)은 안쪽 제공자에 한 번에 묻는다(OSRM table 하나로 묶인다).
 * 경로 없음(null)도 저장한다(같은 구간을 다시 묻지 않게). 도로 모양을 못 받은 임시 결과(provisional)는 저장하지 않는다.
 * 행렬도 같다. 안쪽 제공자가 대체로 낸 임시 행렬(RouteMatrix.provisional, 서버 경유 카카오나 OSRM table이 실패해 다음 제공자로
 * 넘긴 값)은 두지 않는다. 안쪽 제공자가 ttlMs를 달면(서버에 카카오 키가 없어 대체한 실제 값, kakao.ts) 그 시간만 둔다.
 * 추정 표시는 칸마다 둔다(TravelMatrix.estimatedCells). 목적지 여럿을 한 번에 물어도 실제 시간 칸이 추정으로 바뀌지 않는다.
 * KV에는 키 나열이 없으므로 색인 키 'index' 하나에 전체를 JSON으로 둔다(계약 A11). 지난 항목은 쓸 때 지운다.
 * 쓰기는 한 번에 하나만 하고, 쓰기를 기다리는 동안 들어온 저장 요청은 다음 쓰기 하나로 모은다(구간마다 전체를 다시 쓰지 않게).
 * route() 결과는 polyline을 담아 크므로 ROUTE_ENTRY_MAX개까지만 두고 오래된 것부터 버린다(웹 저장소 용량).
 *
 * 제공자 서명(signature): 어느 제공자 조합으로 낸 값인지다(도로 모양 켬·주소, 카카오 방식, 예시 구간표 해시 등, index.ts).
 * 색인에 함께 두고, 읽을 때 서명이 다르면(설정·구간표가 바뀜) 예전 항목을 모두 버린다. 형식 v:2부터다(v:1 색인은 버린다).
 * 길 모양 없이 낸 직선 추정이 도로 모양을 켠 뒤에도 하루 내내 남지 않게 한다(2026-10-09 리뷰 반영).
 * 시계는 실제 시계를 넘긴다(registry가 systemClock. 시뮬레이터 가상 시각이면 300배속에서 24시간이 몇 분이 된다).
 * 받은 시각이 지금보다 뒤인 항목(시계가 되돌아감)은 지난 것으로 본다.
 *
 * 같은 구간을 동시에 물으면 안쪽 제공자에는 한 번만 묻고 답을 나눠 쓴다(행렬은 구간마다, 경로는 구간 키마다).
 * 나눠 받은 구간은 cacheHits로 센다(안쪽에 묻지 않았다). 묻던 요청이 실패하면 같이 기다리던 요청도 실패한다.
 * clear()는 세대를 올린다. 그 전에 시작한 요청의 답은 새 캐시에 두지 않고, 쓰기는 언제나 지금 색인을 쓴다
 * (진행 중이던 요청이 끝나며 지운 항목을 되살리지 않게).
 *
 * 같은 구간이면 행렬과 경로가 같은 분을 낸다(경로 비교·지도와 계획이 어긋나지 않게, 2026-10-09 실제 길 시간 결정).
 * 실제 길 시간은 행렬(OSRM table·카카오 요약)과 경로(OSRM route·카카오 길찾기)를 따로 묻고, 카카오는 실시간 교통이라
 * 묻는 때마다 달라질 수 있다. 그래서 둘 다 실제 시간(추정 아님)이면 먼저 받아 캐시에 있는 쪽을 따른다.
 * - route(): 같은 구간의 행렬 값이 캐시에 있으면 경로의 분을 그 값으로 둔다(계획이 쓰는 값이 먼저다)
 * - matrix(): 행렬 값이 없고 같은 구간의 경로가 캐시에 있으면 그 분을 쓰고 cacheHits로 센다(안쪽에 묻지 않는다)
 * 어느 한쪽이 추정이면 맞추지 않는다(직선 추정과 실제 시간을 섞지 않는다).
 */

const INDEX_KEY = 'index';
export const ROUTE_ENTRY_MAX = 200;

interface MinEntry {
  at: number;
  m: number | null;
  est: boolean;
  /** 이 항목만의 보관 시간(ms). 없으면 캐시 기본값 */
  ttl?: number;
}
interface LegEntry {
  at: number;
  leg: RouteLeg | null;
  ttl?: number;
}
interface Blob {
  v: 2;
  /** 제공자 서명. 다르면 색인 전체를 버린다 */
  sig: string;
  m: Record<string, MinEntry>;
  r: Record<string, LegEntry>;
}

/**
 * 경로 패키지 안에서 주고받는 행렬. provisional이면 대체로 낸 임시 값이라 캐시에 두지 않고 다음에 다시 묻는다
 * (RouteLeg.provisional과 같은 원리. TravelMatrix에는 없는 값이라 이 패키지 안에서만 본다).
 * ttlMs가 있으면 캐시가 그 시간만 둔다(기본 24시간보다 짧게)
 */
export interface RouteMatrix extends TravelMatrix {
  provisional?: boolean;
  ttlMs?: number;
}

/** 경로 패키지 안에서 주고받는 경로. ttlMs가 있으면 캐시가 그 시간만 둔다 */
export interface RouteLegOut extends RouteLeg {
  ttlMs?: number;
}

export interface RouteCache {
  wrap(inner: RouteProvider): RouteProvider;
  clear(): Promise<void>;
}

/** 다른 요청이 묻는 중인 구간의 답 */
interface Shared {
  m: number | null;
  est: boolean;
}
interface Deferred {
  p: Promise<Shared>;
  resolve(v: Shared): void;
  reject(e: unknown): void;
}

function pairKey(t: Transport, a: LatLng, b: LatLng): string {
  return `${t}|${coordKey(a)}>${coordKey(b)}`;
}

function deferred(): Deferred {
  let resolve!: (v: Shared) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<Shared>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // 같이 기다리는 요청이 없어도 처리되지 않은 거부가 되지 않게 한다
  p.catch(() => {});
  return { p, resolve, reject };
}

export function createRouteCache(opts: { clock: Clock; kv: KV; ttlMs?: number; signature?: string }): RouteCache {
  const ttl = opts.ttlMs ?? ROUTE_CACHE_TTL_MS;
  const sig = opts.signature ?? '';
  const empty = (): Blob => ({ v: 2, sig, m: {}, r: {} });
  let blob: Blob | undefined;
  let loading: Promise<Blob> | undefined;
  /** clear()마다 오른다. 그 전에 시작한 요청의 답은 두지 않는다 */
  let gen = 0;
  /** 묻는 중인 행렬 구간·경로(구간 키). 같은 구간을 동시에 물으면 이 답을 같이 쓴다 */
  let pendingM = new Map<string, Promise<Shared>>();
  let pendingR = new Map<string, Promise<RouteLegOut | null>>();

  async function load(): Promise<Blob> {
    if (blob) return blob;
    if (!loading) {
      const g0 = gen;
      loading = (async () => {
        let parsed = empty();
        try {
          const raw = await opts.kv.get(INDEX_KEY);
          if (raw) {
            const j = JSON.parse(raw) as Partial<Blob>;
            // 형식이 다르거나(v:1) 제공자 서명이 다르면 예전 항목을 버린다
            if (j && j.v === 2 && j.sig === sig) parsed = { v: 2, sig, m: j.m ?? {}, r: j.r ?? {} };
          }
        } catch {
          // 깨진 캐시는 버린다
        }
        // 읽는 동안 clear()가 불렸으면 읽은 내용을 버린다
        if (g0 !== gen) return blob ?? parsed;
        blob = parsed;
        return parsed;
      })();
    }
    return loading;
  }

  const fresh = (at: number, life?: number) => {
    const age = opts.clock.now() - at;
    return age >= 0 && age <= (life ?? ttl);
  };
  const ttlOf = (ms: number | undefined) => (ms !== undefined && ms < ttl ? { ttl: ms } : {});

  /** 경로의 분을 같은 구간의 행렬 값(계획이 쓰는 값)에 맞춘다. 둘 다 실제 시간일 때만 */
  function withPlanMinutes(b: Blob, k: string, leg: RouteLegOut | null): RouteLegOut | null {
    const m = b.m[k];
    if (!leg || leg.estimated || !m || !fresh(m.at, m.ttl) || m.est || m.m == null || m.m === leg.minutes) return leg;
    return { ...leg, minutes: m.m };
  }

  /** 지금 색인을 쓴다(예전 세대의 색인을 들고 있던 요청이 불러도 지운 항목이 되살아나지 않는다) */
  async function write(): Promise<void> {
    const b = blob;
    if (!b) return;
    for (const k of Object.keys(b.m)) if (!fresh(b.m[k].at, b.m[k].ttl)) delete b.m[k];
    for (const k of Object.keys(b.r)) if (!fresh(b.r[k].at, b.r[k].ttl)) delete b.r[k];
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
  /** 아직 시작하지 않은 쓰기가 있으면 그것에 합친다. 쓰기는 시작할 때 색인 전체를 읽으므로 그 전 변경이 모두 들어간다 */
  function save(): Promise<void> {
    if (queued) return queued;
    const q = inflight.then(() => {
      queued = undefined;
      return write();
    });
    queued = q;
    inflight = q;
    return q;
  }

  async function clear(): Promise<void> {
    gen += 1;
    blob = empty();
    loading = Promise.resolve(blob);
    pendingM = new Map();
    pendingR = new Map();
    // 이미 시작한 쓰기가 끝난 뒤에 지운다(지운 뒤에 예전 내용이 다시 써지지 않게)
    await inflight;
    await opts.kv.remove(INDEX_KEY);
  }

  return {
    clear,
    wrap(inner) {
      return {
        // 안쪽 제공자의 id가 바뀔 수 있다(서버 경유 카카오가 대체로 넘어가면 'local')
        get id() {
          return inner.id;
        },
        async matrix(origins, destinations, t): Promise<TravelMatrix> {
          const g = gen;
          const b = await load();
          const pending = pendingM;
          const minutes: (number | null)[][] = origins.map(() => destinations.map(() => null));
          const cells: boolean[][] = origins.map(() => destinations.map(() => false));
          let cacheHits = 0;
          let calls = 0;
          let dirty = false;
          // 출발지별로 모르는 목적지만 묻는다. 다른 요청이 묻는 중인 구간은 그 답을 기다린다
          const missByOrigin = new Map<number, number[]>();
          /** 내가 묻는 구간. 답하면 빠진다 */
          const mine = new Map<string, Deferred>();
          const registered: [string, Deferred][] = [];
          const waits: { i: number; j: number; p: Promise<Shared> }[] = [];
          origins.forEach((o, i) =>
            destinations.forEach((d, j) => {
              if (sameCoord(o, d)) {
                minutes[i][j] = 0;
                return;
              }
              const k = pairKey(t, o, d);
              const e = b.m[k];
              const r = b.r[k];
              if (e && fresh(e.at, e.ttl)) {
                minutes[i][j] = e.m;
                cells[i][j] = e.est;
                cacheHits += 1;
              } else if (r && fresh(r.at, r.ttl) && r.leg && !r.leg.estimated) {
                // 같은 구간의 실제 경로를 이미 받았다. 그 분을 행렬 값으로도 둔다(받은 시각·보관 시간 그대로라 함께 지난다)
                minutes[i][j] = r.leg.minutes;
                b.m[k] = { at: r.at, m: r.leg.minutes, est: false, ...ttlOf(r.ttl) };
                dirty = true;
                cacheHits += 1;
              } else {
                const p = pending.get(k);
                if (p) {
                  waits.push({ i, j, p });
                  return;
                }
                const own = deferred();
                pending.set(k, own.p);
                mine.set(k, own);
                registered.push([k, own]);
                const list = missByOrigin.get(i) ?? [];
                list.push(j);
                missByOrigin.set(i, list);
              }
            }),
          );
          // 묻는 목적지가 같은 출발지끼리 한 번에 묻는다(안쪽이 묻는 칸 = 모르는 칸이라 구간 수가 그대로다)
          const groups = new Map<string, { is: number[]; js: number[] }>();
          for (const [i, js] of missByOrigin) {
            const key = js.join(',');
            const grp = groups.get(key) ?? { is: [], js };
            grp.is.push(i);
            groups.set(key, grp);
          }
          let failure: { e: unknown } | undefined;
          try {
            const now = opts.clock.now();
            for (const { is, js } of groups.values()) {
              const res: RouteMatrix = await inner.matrix(
                is.map((i) => origins[i]),
                js.map((j) => destinations[j]),
                t,
              );
              calls += res.calls;
              cacheHits += res.cacheHits;
              is.forEach((i, x) =>
                js.forEach((j, y) => {
                  const m = res.minutes[x]?.[y] ?? null;
                  const est = res.estimatedCells?.[x]?.[y] ?? res.estimated;
                  minutes[i][j] = m;
                  cells[i][j] = est;
                  const k = pairKey(t, origins[i], destinations[j]);
                  // 대체로 낸 임시 값은 두지 않는다(다음에 다시 묻는다). clear() 전에 시작한 요청의 답도 두지 않는다
                  if (!res.provisional && g === gen) {
                    b.m[k] = { at: now, m, est, ...ttlOf(res.ttlMs) };
                    dirty = true;
                  }
                  mine.get(k)?.resolve({ m, est });
                  mine.delete(k);
                }),
              );
            }
          } catch (e) {
            failure = { e };
          }
          // 답하지 못한 구간을 기다리던 요청도 실패한다. 묻는 중 표시는 내가 건 것만 지운다
          for (const own of mine.values()) own.reject(failure?.e ?? new Error('경로를 받지 못함'));
          for (const [k, own] of registered) if (pending.get(k) === own.p) pending.delete(k);
          if (dirty && g === gen) await save();
          if (failure) throw failure.e;
          for (const w of waits) {
            const v = await w.p;
            minutes[w.i][w.j] = v.m;
            cells[w.i][w.j] = v.est;
            cacheHits += 1;
          }
          const estimated = cells.some((row) => row.some(Boolean));
          return { minutes, calls, cacheHits, estimated, estimatedCells: cells };
        },
        async route(a, bb, t) {
          const g = gen;
          const blobNow = await load();
          const k = pairKey(t, a, bb);
          const e = blobNow.r[k];
          if (e && fresh(e.at, e.ttl)) return withPlanMinutes(blobNow, k, e.leg);
          const pending = pendingR;
          let p = pending.get(k);
          if (!p) {
            const asking = (async () => {
              const leg: RouteLegOut | null = await inner.route(a, bb, t);
              // 도로 모양을 못 받은 임시 결과는 두지 않는다(다음에 다시 묻는다). clear() 전에 시작한 요청의 답도 두지 않는다
              if (!leg?.provisional && g === gen) {
                blobNow.r[k] = { at: opts.clock.now(), leg, ...ttlOf(leg?.ttlMs) };
                await save();
              }
              return leg;
            })();
            const done = () => {
              if (pending.get(k) === asking) pending.delete(k);
            };
            asking.then(done, done);
            pending.set(k, asking);
            p = asking;
          }
          const leg = await p;
          return withPlanMinutes(blobNow, k, leg);
        },
        async clearCache() {
          await clear();
          await inner.clearCache();
        },
      };
    },
  };
}
