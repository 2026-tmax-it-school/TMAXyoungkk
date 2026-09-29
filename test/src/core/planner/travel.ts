import type { LatLng, Transport } from '../../types';
import type { RouteProvider } from '../ports';
import { coordKey, estimateMinutes, FALLBACK_TRANSPORT, sameCoord } from './estimate';

/**
 * 구간 이동 시간 장부(WP4 소유, 순수). 계산 한 번 동안 조회한 구간을 기억하고, 아직 모르는 구간은
 * 직선거리 추정으로 채운다(FR-505: 직선거리로 먼저 묶고 필요한 구간만 조회).
 *
 * 호출 수(비기능 요구사항 재계산 1회당 100구간 이하)는 제공자가 돌려준 TravelMatrix.calls의 합이다.
 * 캐시에서 나온 구간은 cacheHits로만 센다. 같은 구간은 장부가 한 번만 묻는다.
 * 동시에 묻는 구간은 ENSURE_CONCURRENCY개까지다(실제 제공자의 요청 한도에 걸려 조용히 추정으로 떨어지지 않게).
 *
 * 실패 해석(FR-504와 FR-501이 겹치는 곳):
 * - 제공자가 null(그 수단 경로 없음)을 주면 FR-504대로 대체 수단(자동차는 도보)으로 계산하고 noRoute를 단다
 * - 제공자가 던지면(요청 실패) FR-501대로 같은 수단의 직선거리 추정으로 때우고 failed·estimated를 단다
 */

/** 한 번에 제공자에 보내는 구간 요청 수 상한 */
export const ENSURE_CONCURRENCY = 4;

export interface LegTime {
  minutes: number;
  /** 실제로 계산한 수단. 경로가 없어 대체했으면 요청 수단과 다르다. */
  transport: Transport;
  /** 제공자가 추정값을 줬거나 아직 조회하지 않은 구간 */
  estimated: boolean;
  /** 조회했는지(false면 임시 추정) */
  known: boolean;
  /** 제공자가 실패해서(던짐) 직선거리로 때웠다 */
  failed?: boolean;
  /** 그 수단 경로가 없어 대체 수단으로 계산했다 */
  noRoute?: boolean;
}

export interface Pair {
  a: LatLng;
  b: LatLng;
  t: Transport;
}

export interface TravelBook {
  get(a: LatLng, b: LatLng, t: Transport): LegTime;
  has(a: LatLng, b: LatLng, t: Transport): boolean;
  /** 모르는 구간만 조회한다. 조회한 구간 수를 돌려준다. */
  ensure(pairs: Pair[]): Promise<number>;
  stats(): { calls: number; cacheHits: number; asked: number };
}

function keyOf(a: LatLng, b: LatLng, t: Transport): string {
  return `${t}|${coordKey(a)}>${coordKey(b)}`;
}

export function createTravelBook(routes: RouteProvider): TravelBook {
  const known = new Map<string, LegTime>();
  let calls = 0;
  let cacheHits = 0;
  let asked = 0;

  function temp(a: LatLng, b: LatLng, t: Transport): LegTime {
    return { minutes: estimateMinutes(a, b, t), transport: t, estimated: true, known: false };
  }

  async function fetchOne(a: LatLng, b: LatLng, t: Transport): Promise<LegTime> {
    try {
      const m = await routes.matrix([a], [b], t);
      calls += m.calls;
      cacheHits += m.cacheHits;
      const v = m.minutes[0]?.[0];
      if (v == null) {
        const fb = FALLBACK_TRANSPORT[t];
        return { minutes: estimateMinutes(a, b, fb), transport: fb, estimated: true, known: true, noRoute: true };
      }
      return { minutes: v, transport: t, estimated: m.estimated, known: true };
    } catch {
      return { ...temp(a, b, t), known: true, failed: true };
    }
  }

  return {
    get(a, b, t) {
      if (sameCoord(a, b)) return { minutes: 0, transport: t, estimated: false, known: true };
      return known.get(keyOf(a, b, t)) ?? temp(a, b, t);
    },
    has(a, b, t) {
      return sameCoord(a, b) || known.has(keyOf(a, b, t));
    },
    async ensure(pairs) {
      const todo = new Map<string, Pair>();
      for (const p of pairs) {
        if (sameCoord(p.a, p.b)) continue;
        const k = keyOf(p.a, p.b, p.t);
        if (!known.has(k) && !todo.has(k)) todo.set(k, p);
      }
      const entries = [...todo.entries()];
      asked += entries.length;
      let next = 0;
      const worker = async () => {
        while (next < entries.length) {
          const [k, p] = entries[next];
          next += 1;
          known.set(k, await fetchOne(p.a, p.b, p.t));
        }
      };
      await Promise.all(Array.from({ length: Math.min(ENSURE_CONCURRENCY, entries.length) }, worker));
      return entries.length;
    },
    stats: () => ({ calls, cacheHits, asked }),
  };
}
