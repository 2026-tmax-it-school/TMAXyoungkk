import { EXACT_ORDER_MAX } from '../constants';

/**
 * FR-501 방문 순서(WP4 소유, 순수). 기점 출발 → 스팟들 → (복귀 있으면) 기점.
 * start[j]는 기점 → j, end[j]는 j → 기점 이동 시간이다. 기점이 없거나(첫 스팟 기점) 복귀가 없으면 0을 넣는다.
 * 그래서 복귀 있음은 순환, 복귀 없음은 경로, 기점 없음은 시작점이 자유로운 경로가 한 식으로 풀린다.
 *
 * - 하루 스팟 EXACT_ORDER_MAX(10)개 이하: Held-Karp 동적계획법 정확해(10개에 약 10만 연산)
 * - 11개 이상: 최근접 이웃 + 2-opt·재배치 근사
 */

export interface OrderInput {
  n: number;
  start: (j: number) => number;
  end: (j: number) => number;
  step: (i: number, j: number) => number;
}

export function tourCost(order: readonly number[], inp: OrderInput): number {
  if (order.length === 0) return 0;
  let c = inp.start(order[0]);
  for (let k = 1; k < order.length; k += 1) c += inp.step(order[k - 1], order[k]);
  return c + inp.end(order[order.length - 1]);
}

/** Held-Karp. dp[mask][j] = mask를 다 돌고 j에서 끝나는 최소 비용. 동점은 번호가 작은 쪽을 고른다. */
export function heldKarp(inp: OrderInput): number[] {
  const { n } = inp;
  if (n === 0) return [];
  if (n === 1) return [0];
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const parent = new Int8Array(size * n).fill(-1);
  const step: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    step.push([]);
    for (let j = 0; j < n; j += 1) step[i].push(i === j ? 0 : inp.step(i, j));
  }
  for (let j = 0; j < n; j += 1) dp[(1 << j) * n + j] = inp.start(j);
  for (let mask = 1; mask < size; mask += 1) {
    for (let j = 0; j < n; j += 1) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * n + j];
      if (cur === Infinity) continue;
      for (let k = 0; k < n; k += 1) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const v = cur + step[j][k];
        if (v < dp[next * n + k]) {
          dp[next * n + k] = v;
          parent[next * n + k] = j;
        }
      }
    }
  }
  const full = size - 1;
  let best = Infinity;
  let last = 0;
  for (let j = 0; j < n; j += 1) {
    const v = dp[full * n + j] + inp.end(j);
    if (v < best) {
      best = v;
      last = j;
    }
  }
  const order: number[] = [];
  let mask = full;
  let cur = last;
  while (cur >= 0) {
    order.push(cur);
    const p = parent[mask * n + cur];
    mask &= ~(1 << cur);
    cur = p;
  }
  return order.reverse();
}

/** 최근접 이웃으로 시작하고 2-opt(구간 뒤집기)와 한 곳 재배치로 더 줄지 않을 때까지 다듬는다. */
export function nearestTwoOpt(inp: OrderInput): number[] {
  const { n } = inp;
  if (n <= 1) return n === 1 ? [0] : [];
  const left = new Set<number>();
  for (let i = 0; i < n; i += 1) left.add(i);
  let first = 0;
  for (let j = 1; j < n; j += 1) if (inp.start(j) < inp.start(first)) first = j;
  const order = [first];
  left.delete(first);
  while (left.size > 0) {
    const cur = order[order.length - 1];
    let best = -1;
    for (const j of left) if (best < 0 || inp.step(cur, j) < inp.step(cur, best)) best = j;
    order.push(best);
    left.delete(best);
  }
  let cost = tourCost(order, inp);
  let improved = true;
  let guard = 0;
  while (improved && guard < 200) {
    improved = false;
    guard += 1;
    for (let i = 0; i < n - 1; i += 1) {
      for (let k = i + 1; k < n; k += 1) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const c = tourCost(cand, inp);
        if (c < cost - 1e-9) {
          order.splice(0, n, ...cand);
          cost = c;
          improved = true;
        }
      }
    }
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < n; k += 1) {
        if (i === k) continue;
        const cand = [...order];
        const [x] = cand.splice(i, 1);
        cand.splice(k, 0, x);
        const c = tourCost(cand, inp);
        if (c < cost - 1e-9) {
          order.splice(0, n, ...cand);
          cost = c;
          improved = true;
        }
      }
    }
  }
  return order;
}

export function bestOrder(inp: OrderInput, maxExact = EXACT_ORDER_MAX): { order: number[]; method: 'exact' | 'approx' } {
  if (inp.n <= maxExact) return { order: heldKarp(inp), method: 'exact' };
  return { order: nearestTwoOpt(inp), method: 'approx' };
}

/**
 * 가장 싼 끼워 넣기 자리. 기점이 있으면 기점도 이웃으로 친다(순환으로 본다).
 * FR-505 근접도 판단에 쓴다: 복귀 없음 날이라도 먼 곳을 한쪽 길로만 싸게 보지 않게 한다.
 */
export function cheapestInsertion(
  order: readonly number[],
  x: number,
  loop: { start: (j: number) => number; end: (j: number) => number; step: (i: number, j: number) => number },
  /** 끼우면 안 되는 자리(p번째 앞). 모든 자리가 막히면 막힘을 무시한다 */
  blocked?: (pos: number) => boolean,
): { pos: number; delta: number } {
  if (order.length === 0) return { pos: 0, delta: loop.start(x) + loop.end(x) };
  if (blocked) {
    const open = Array.from({ length: order.length + 1 }, (_, p) => p).filter((p) => !blocked(p));
    if (open.length === 0) return cheapestInsertion(order, x, loop);
  }
  let best = { pos: 0, delta: Infinity };
  for (let p = 0; p <= order.length; p += 1) {
    if (blocked?.(p)) continue;
    const prev = p === 0 ? undefined : order[p - 1];
    const next = p === order.length ? undefined : order[p];
    const before = prev === undefined ? (next === undefined ? 0 : loop.start(next)) : next === undefined ? loop.end(prev) : loop.step(prev, next);
    const inA = prev === undefined ? loop.start(x) : loop.step(prev, x);
    const inB = next === undefined ? loop.end(x) : loop.step(x, next);
    const d = inA + inB - before;
    if (d < best.delta) best = { pos: p, delta: d };
  }
  return best;
}
