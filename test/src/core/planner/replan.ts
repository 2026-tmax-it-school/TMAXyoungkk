import type { Adjustment, LatLng, Plan, Spot, Trip } from '../../types';
import { priorityCompare } from '../spotUtil';
import { humanMin, toMin, weekday } from '../util';
import { dayContexts, legTransport, type DayCtx } from './day';
import type { PlanDeps } from './index';
import { heldKarp, type OrderInput } from './order';
import { createTravelBook, type Pair, type TravelBook } from './travel';

/**
 * 지연 조정안(FR-603, WP4 소유, 순수). 받은 delayMin을 흡수하는 조정안만 만든다.
 * ETA 지연 계산과 15분 경계 판정은 WP5 core/live/delay.ts가 한다(계약 A11, 03 회의 결정).
 *
 * 남은 일정(방문·지나침 처리하지 않은 스팟)을 지금 위치에서 다시 흘려 본다. 첫 남은 스팟 도착이
 * 계획보다 delayMin 늦도록 출발 시각을 맞춘다. 문제는 두 가지다: 활동시간 초과, 영업 종료 뒤 도착.
 * 지연 없이 흘려도 있던 문제(계획 단계 안내·고정 초과)는 지연 탓으로 치지 않는다.
 * 조정안 순서:
 *  1. reorder: 순서만 바꿔 두 문제가 모두 사라지면 먼저 낸다
 *  2. exclude: 영업 종료로 방문할 수 없게 된 스팟(spot.hours 기준)이 1순위, 그다음 FR-403 순서
 *     (제안자 적은 순, 등록 늦은 순). 고정과 날짜 지정 스팟은 빼지 않는다
 *  3. shortenStay: 다음 비고정 스팟 체류를 줄여 원래 시간표로 돌아가기
 * 조정안은 초안(OpDraft)만 담는다. 거절하면 아무것도 적용하지 않는다(이 함수는 문서를 바꾸지 않는다).
 */
export interface ReplanInput {
  trip: Trip;
  plan: Plan;
  date: string;
  now: number;
  position: LatLng;
  visitedSpotIds: string[];
  skippedSpotIds: string[];
  /** WP5가 계산한 지연(분). 15분 미만이면 WP5가 부르지 않는다. */
  delayMin: number;
}

/** 모든 순서를 다 보는 남은 스팟 수 상한(7! = 5040) */
const BRUTE_MAX = 7;
const MAX_EXCLUDE_OPTIONS = 3;
const MIN_STAY_AFTER_CUT = 30;

interface SimResult {
  end: number;
  over: number;
  closed: string[];
}

function canVisit(spot: Spot, date: string, arrive: number): boolean {
  const h = spot.hours;
  if (!h) return true;
  if (h.closedWeekdays?.includes(weekday(date))) return false;
  return arrive < toMin(h.close);
}

function simulate(ctx: DayCtx, book: TravelBook, from: LatLng, startAt: number, order: readonly Spot[]): SimResult {
  let t = startAt;
  let prev: { id: string; coord: LatLng } = { id: 'pos', coord: from };
  const closed: string[] = [];
  for (const s of order) {
    t += book.get(prev.coord, s.coord, legTransport(ctx, prev.id, s.id)).minutes;
    if (s.arriveOverride) t = Math.max(t, toMin(s.arriveOverride));
    if (!canVisit(s, ctx.date, t)) closed.push(s.id);
    t += s.stayMin;
    prev = { id: s.id, coord: s.coord };
  }
  if (ctx.base && !ctx.noReturn && order.length > 0) {
    t += book.get(prev.coord, ctx.base.coord, legTransport(ctx, prev.id, 'base')).minutes;
  }
  return { end: t, over: Math.max(0, t - ctx.endLimitMin), closed };
}

function better(a: SimResult, b: SimResult): boolean {
  if (a.closed.length !== b.closed.length) return a.closed.length < b.closed.length;
  if (a.over !== b.over) return a.over < b.over;
  return a.end < b.end;
}

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

export async function replanForDelay(input: ReplanInput, deps: PlanDeps): Promise<{ adjustments: Adjustment[] }> {
  const { trip, plan, date, position, delayMin } = input;
  const day = plan.days.find((d) => d.date === date);
  const ctx = dayContexts(trip).find((c) => c.date === date);
  if (!day || !ctx || delayMin <= 0) return { adjustments: [] };
  const done = new Set([...input.visitedSpotIds, ...input.skippedSpotIds]);
  const remainingItems = day.items.filter((it) => !done.has(it.spotId));
  const remaining = remainingItems
    .map((it) => trip.spots.find((s) => s.id === it.spotId))
    .filter((s): s is Spot => !!s);
  if (remaining.length === 0) return { adjustments: [] };

  // 필요한 구간만 조회: 지금 위치 → 남은 스팟, 남은 스팟 사이, 남은 스팟 → 기점
  const book = createTravelBook(deps.routes);
  const pairs: Pair[] = [];
  for (const s of remaining) {
    pairs.push({ a: position, b: s.coord, t: legTransport(ctx, 'pos', s.id) });
    for (const o of remaining) if (o !== s) pairs.push({ a: s.coord, b: o.coord, t: legTransport(ctx, s.id, o.id) });
    if (ctx.base && !ctx.noReturn) pairs.push({ a: s.coord, b: ctx.base.coord, t: legTransport(ctx, s.id, 'base') });
  }
  await book.ensure(pairs);

  const first = remaining[0];
  const firstLeg = book.get(position, first.coord, legTransport(ctx, 'pos', first.id)).minutes;
  const startAt = toMin(remainingItems[0].arrive) + delayMin - firstLeg;
  const sim = (order: readonly Spot[]) => simulate(ctx, book, position, startAt, order);
  const base = sim(remaining);
  // 지연 없이 흘렸을 때 이미 있던 문제(계획 단계의 영업시간 안내, 고정 초과)는 지연 탓이 아니다
  const calm = simulate(ctx, book, position, startAt - delayMin, remaining);
  const troubled = base.over > calm.over || base.closed.some((id) => !calm.closed.includes(id));
  const adjustments: Adjustment[] = [];

  // 1. 순서만 바꾸기
  if (troubled && remaining.length >= 2) {
    let best = base;
    let bestOrder: Spot[] = remaining;
    const orders: Spot[][] =
      remaining.length <= BRUTE_MAX
        ? permutations(remaining)
        : [
            heldKarp({
              n: remaining.length,
              start: (j) => book.get(position, remaining[j].coord, ctx.transport).minutes,
              end: (j) => (ctx.base && !ctx.noReturn ? book.get(remaining[j].coord, ctx.base.coord, ctx.transport).minutes : 0),
              step: (i, j) => book.get(remaining[i].coord, remaining[j].coord, ctx.transport).minutes,
            } satisfies OrderInput).map((i) => remaining[i]),
          ];
    for (const o of orders) {
      const r = sim(o);
      if (better(r, best)) {
        best = r;
        bestOrder = o;
      }
    }
    if (bestOrder !== remaining && best.over <= calm.over && best.closed.length <= calm.closed.length) {
      const visited = day.items.filter((it) => done.has(it.spotId)).map((it) => it.spotId);
      adjustments.push({
        id: `adj-reorder-${date}`,
        kind: 'reorder',
        label: `순서 바꾸기: ${bestOrder.map((s) => s.name).join(', ')} 순`,
        savedMin: Math.max(0, base.end - best.end),
        ops: [{ type: 'schedule/reorder', date, spotIds: [...visited, ...bestOrder.map((s) => s.id)] }],
      });
    }
  }

  // 2. 빼기
  if (troubled) {
    const removable = remaining.filter((s) => !s.pinned && !s.fixedDate);
    const closedFirst = removable.filter((s) => base.closed.includes(s.id));
    const rest = removable.filter((s) => !base.closed.includes(s.id)).sort((a, b) => priorityCompare(b, a));
    for (const s of [...closedFirst, ...rest].slice(0, MAX_EXCLUDE_OPTIONS)) {
      const r = sim(remaining.filter((x) => x.id !== s.id));
      const isClosed = base.closed.includes(s.id);
      adjustments.push({
        id: `adj-exclude-${s.id}`,
        kind: 'exclude',
        label: isClosed ? `${s.name} 빼기(도착하면 영업 종료 ${s.hours?.close ?? ''})` : `${s.name} 빼기`,
        savedMin: Math.max(0, base.end - r.end),
        ops: [{ type: 'spot/remove', spotId: s.id, reason: 'delay' }],
      });
    }
  }

  // 3. 체류 줄이기(원래 시간표로 돌아가기)
  const next = remaining.find((s) => !s.pinned && s.stayMin - MIN_STAY_AFTER_CUT > 0);
  if (next) {
    const cut = Math.min(delayMin, next.stayMin - MIN_STAY_AFTER_CUT);
    adjustments.push({
      id: `adj-stay-${next.id}`,
      kind: 'shortenStay',
      label: `${next.name} 체류 ${humanMin(next.stayMin)}에서 ${humanMin(next.stayMin - cut)}으로`,
      savedMin: cut,
      ops: [{ type: 'schedule/setStay', spotId: next.id, stayMin: next.stayMin - cut }],
    });
  }
  return { adjustments };
}
