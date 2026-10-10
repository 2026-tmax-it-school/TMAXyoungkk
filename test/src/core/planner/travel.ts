import type { LatLng, Transport } from '../../types';
import type { RouteProvider } from '../ports';
import { coordKey, estimateMinutes, FALLBACK_TRANSPORT, sameCoord } from './estimate';

/**
 * 구간 이동 시간 장부(WP4 소유, 순수). 계산 한 번 동안 조회한 구간을 기억하고, 아직 모르는 구간은
 * 직선거리 추정으로 채운다(FR-505: 직선거리로 먼저 묶고 필요한 구간만 조회).
 *
 * 호출 수(비기능 요구사항 재계산 1회당 100구간 이하)는 제공자가 돌려준 TravelMatrix.calls의 합이다.
 * 캐시에서 나온 구간은 cacheHits로만 센다. 같은 구간은 장부가 한 번만 묻는다.
 * 출발지와 수단이 같은 구간은 묶어 matrix([출발지], [목적지들], 수단) 한 번으로 묻는다(ENSURE_BATCH_MAX개까지).
 * 구간마다 따로 물으면 실제 길 서버(OSRM table)에 두 점짜리 요청이 구간 수만큼 나가 서버 요청 한도에 걸린다(2026-10-09 리뷰).
 * 호출 수는 제공자가 구간 단위로 세므로 묶어도 같다(계약 A11). 추정 여부는 칸마다(estimatedCells) 본다.
 * 동시에 묻는 묶음은 ENSURE_CONCURRENCY개까지다(실제 제공자의 요청 한도에 걸려 조용히 추정으로 떨어지지 않게).
 *
 * 실패 해석(FR-504와 FR-501이 겹치는 곳):
 * - 제공자가 null(그 수단 경로 없음)을 주면 FR-504대로 대체 수단(자동차는 도보)으로 계산하고 noRoute를 단다
 * - 제공자가 던지면(요청 실패) FR-501대로 같은 수단의 직선거리 추정으로 때우고 failed·estimated를 단다
 */

/** 한 번에 제공자에 보내는 묶음 요청 수 상한 */
export const ENSURE_CONCURRENCY = 4;
/**
 * 묶음 하나의 목적지 수 상한. 카카오는 목적지마다 요청 하나라 묶음 안에서는 차례로 묻는다.
 * 너무 크게 묶으면 묶음 하나가 오래 걸려 동시에 묻는 이점이 없어지고 진행 숫자도 드물게 오른다
 */
export const ENSURE_BATCH_MAX = 12;

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
  /** onProgress는 묶음이 하나 끝날 때마다 (끝난 구간 수, 새로 묻는 구간 수)로 불린다. 끝난 수는 줄지 않고 마지막은 새로 묻는 수다. 계산 화면 진행 숫자용 */
  ensure(pairs: Pair[], onProgress?: (done: number, total: number) => void): Promise<number>;
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

  /** 같은 출발지·수단 구간 묶음을 한 번에 묻는다. 결과는 bs 순서다 */
  async function fetchBatch(a: LatLng, bs: LatLng[], t: Transport): Promise<LegTime[]> {
    try {
      const m = await routes.matrix([a], bs, t);
      calls += m.calls;
      cacheHits += m.cacheHits;
      return bs.map((b, j) => {
        const v = m.minutes[0]?.[j];
        if (v == null) {
          const fb = FALLBACK_TRANSPORT[t];
          return { minutes: estimateMinutes(a, b, fb), transport: fb, estimated: true, known: true, noRoute: true };
        }
        return { minutes: v, transport: t, estimated: m.estimatedCells?.[0]?.[j] ?? m.estimated, known: true };
      });
    } catch {
      return bs.map((b) => ({ ...temp(a, b, t), known: true, failed: true }));
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
    async ensure(pairs, onProgress) {
      const todo = new Map<string, Pair>();
      for (const p of pairs) {
        if (sameCoord(p.a, p.b)) continue;
        const k = keyOf(p.a, p.b, p.t);
        if (!known.has(k) && !todo.has(k)) todo.set(k, p);
      }
      // 같은 출발지·수단끼리 처음 나온 순서대로 묶는다(ENSURE_BATCH_MAX개씩)
      const groups = new Map<string, [string, Pair][][]>();
      for (const entry of todo) {
        const g = `${entry[1].t}|${coordKey(entry[1].a)}`;
        const list = groups.get(g) ?? [[]];
        if (list[list.length - 1].length >= ENSURE_BATCH_MAX) list.push([]);
        list[list.length - 1].push(entry);
        groups.set(g, list);
      }
      const batches = [...groups.values()].flat();
      const total = todo.size;
      asked += total;
      let next = 0;
      let finished = 0;
      const worker = async () => {
        while (next < batches.length) {
          const batch = batches[next];
          next += 1;
          const [, first] = batch[0];
          const got = await fetchBatch(
            first.a,
            batch.map(([, p]) => p.b),
            first.t,
          );
          batch.forEach(([k], j) => known.set(k, got[j]));
          finished += batch.length;
          onProgress?.(finished, total);
        }
      };
      await Promise.all(Array.from({ length: Math.min(ENSURE_CONCURRENCY, batches.length) }, worker));
      return total;
    },
    stats: () => ({ calls, cacheHits, asked }),
  };
}
