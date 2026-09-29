import type { DayPlan, ExcludedSpot, LatLng, Plan, PlanStep, Spot, Trip } from '../../types';
import { DAYPART_EVENING, DAYPART_NOON, FAR_ROUNDTRIP_MIN, ROUTE_CALL_BUDGET } from '../constants';
import type { Clock, RouteProvider } from '../ports';
import { activeSpots, priorityCompare, proposerCount } from '../spotUtil';
import { dayShort, haversineKm, humanMin, josa, toMin } from '../util';
import {
  basePairs,
  dayContexts,
  dayPairs,
  evaluateDay,
  insertionDelta,
  isManualHere,
  legTransport,
  toDayPlan,
  type DayCtx,
  type DayEval,
} from './day';
import { createTravelBook, type Pair, type TravelBook } from './travel';

/**
 * 루트 계산(WP4 소유, 순수). FR-505 날짜 배분 → FR-403 선별 → FR-501 정렬 → FR-502 시간표.
 *
 * 1. 위치 확인: 사용자가 뺀 후보(userRemoved)와 기간 밖 날짜 지정(outOfPeriod)을 먼저 가른다.
 *    직선거리로 가까운 스팟끼리 묶는다(군집).
 * 2. 이동시간 조회: 기점 행·열과 군집 안 가까운 이웃만 묻는다(구간 단위 100 이하, 캐시 구간은 세지 않는다).
 * 3. 배치: 고정·날짜 지정을 먼저 그날에 둔다(자동 제외하지 않는다). 나머지는 우선순위 순(FR-403의
 *    정확한 반대)으로 수용량 안에 드는 날 가운데 끼워 넣는 비용이 가장 작은 날에 둔다(근접도). 수동 순서가 걸린 스팟은
 *    그 날에 들어가면 그 날에 두지만 고정 취급은 아니다(넘치면 FR-403 순서대로 제외될 수 있다). 어느 날에도 안 들어가면
 *    제외 후보가 된다. 그다음 교환 보정과 삽입 보정을 더 바뀌지 않을 때까지 되풀이한다.
 *    - 교환 불변식: 제외 스팟보다 우선순위가 낮은 비고정 확정 스팟과 바꿔 넣어 수용량 안에 드는 교환이 없다.
 *    - 삽입 불변식: 제외 스팟은 어느 날에도 그대로 끼워 넣을 수 없다(기점 왕복이 멀어도 자리가 있으면 확정).
 *    - 고정 불가침: 고정·기간 안 날짜 지정은 제외하지 않는다. 넘치면 overCapacity로 알린다.
 *    확정한 날의 실제 구간을 조회한 뒤 값이 바뀌었으면 배치를 다시 한다(최대 3회). 마지막 회차에서도 조회가 있었으면
 *    조회 없이 한 번 더 배치해 최종 배치와 시간표가 같은 값을 쓰게 한다.
 * 4. 제외 사유: 제외가 정해진 뒤 문장만 고른다. 기점 왕복 60분 이상이면 tooFar, 아니면 dayFull.
 *
 * 시나리오 전용 분기는 없다. 골든 수치는 data/scenario-tuning.ts의 구간표와 날짜 설정으로만 맞춘다.
 */

export interface PlanDeps {
  routes: RouteProvider;
  now: number;
  onStep?: (s: PlanStep) => void;
  /** 단계별 소요 시간(ms)을 재고 싶을 때만 준다. 없으면 ms는 0이다. */
  clock?: Clock;
}

export { resolveBases } from './day';

/** 직선거리 군집 기준(km). 이 안에서 이어지는 스팟은 같은 군집이다. */
export const CLUSTER_KM = 2.5;
/** 군집 안에서 스팟마다 조회할 가까운 이웃 수 */
export const CLUSTER_NEIGHBORS = 2;
/** 배치 뒤 실제 구간 조회를 위해 남겨 두는 호출 수 */
const FINAL_RESERVE = 40;
const MAX_ROUNDS = 3;

/** 단일 연결 군집. 같은 군집이면 같은 번호 */
export function clusterSpots(spots: readonly { coord: LatLng }[], km = CLUSTER_KM): number[] {
  const parent = spots.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 1; j < spots.length; j += 1) {
      if (haversineKm(spots[i].coord, spots[j].coord) <= km) parent[find(i)] = find(j);
    }
  }
  return spots.map((_, i) => find(i));
}

/** 시간대 이름. 경계 12:00·18:00 */
export function daypart(min: number): '오전' | '오후' | '저녁' {
  if (min < toMin(DAYPART_NOON)) return '오전';
  if (min < toMin(DAYPART_EVENING)) return '오후';
  return '저녁';
}

/** 그날 활동시간이 두 시간대 이상에 걸치는지 */
export function spansDayparts(ctx: Pick<DayCtx, 'startMin' | 'endLimitMin'>): boolean {
  return daypart(ctx.startMin) !== daypart(Math.max(ctx.startMin, ctx.endLimitMin - 1));
}

/**
 * 고정 취급 날짜: 기간 안 날짜 지정(FR-505). 수동 순서(FR-503)는 고정 취급이 아니다.
 * 명세상 자동 제외에서 빠지는 것은 고정(FR-403)과 날짜 지정뿐이다.
 */
export function forcedDate(spot: Spot, dates: readonly string[]): string | undefined {
  if (spot.fixedDate && dates.includes(spot.fixedDate)) return spot.fixedDate;
  return undefined;
}

/** 수동 순서가 걸린 날짜(기간 안). 그 날에 들어가면 그 날을 먼저 고른다 */
export function preferredDate(spot: Spot, dates: readonly string[]): string | undefined {
  if (spot.manualOrder && dates.includes(spot.manualOrder.date)) return spot.manualOrder.date;
  return undefined;
}

export function isForced(spot: Spot, dates: readonly string[]): boolean {
  return spot.pinned || forcedDate(spot, dates) !== undefined;
}

/** 배치 결과. 날짜 순서대로 스팟 목록 */
export interface Allocation {
  days: Spot[][];
  excluded: Spot[];
}

/** 하루 평가를 같은 입력이면 다시 계산하지 않는다(장부가 바뀌면 새로 만든다) */
export interface DayEvaluator {
  evalDay(dayIndex: number, spots: readonly Spot[]): DayEval;
  fits(dayIndex: number, spots: readonly Spot[]): boolean;
}

export function createEvaluator(ctxs: readonly DayCtx[], book: TravelBook): DayEvaluator {
  const memo = new Map<string, DayEval>();
  const evalDay = (i: number, spots: readonly Spot[]): DayEval => {
    const key = `${i}|${spots
      .map((s) => `${s.id}:${s.stayMin}:${s.arriveOverride ?? ''}:${s.manualOrder?.date ?? ''}${s.manualOrder?.index ?? ''}`)
      .sort()
      .join(',')}`;
    let ev = memo.get(key);
    if (!ev) {
      ev = evaluateDay(ctxs[i], spots, book);
      memo.set(key, ev);
    }
    return ev;
  };
  return { evalDay, fits: (i, spots) => evalDay(i, spots).overMin === 0 };
}

/**
 * FR-505·403 배치. 고정 취급 스팟을 먼저 두고, 나머지를 우선순위 순으로 가장 가까운 들어가는 날에 둔다.
 * 그다음 교환·삽입 보정. 순수 함수이고 장부 값만 쓴다.
 */
export function allocate(
  ctxs: readonly DayCtx[],
  candidates: readonly Spot[],
  book: TravelBook,
  ev: DayEvaluator = createEvaluator(ctxs, book),
  onPlaced?: (done: number, total: number) => void,
): Allocation {
  const dates = ctxs.map((c) => c.date);
  const days: Spot[][] = ctxs.map(() => []);
  const n = ctxs.length;
  const total = candidates.length;
  let done = 0;
  const tick = () => {
    done += 1;
    onPlaced?.(done, total);
  };

  const ordered = [...candidates].sort(priorityCompare);
  const forced = ordered.filter((s) => isForced(s, dates));
  const free = ordered.filter((s) => !isForced(s, dates));

  // 날짜가 정해진 고정 취급 스팟
  for (const s of forced) {
    const d = forcedDate(s, dates);
    if (d !== undefined) {
      days[dates.indexOf(d)].push(s);
      tick();
    }
  }
  // 날짜 없는 고정: 들어가는 날 가운데 가장 가까운 날, 없으면 초과가 가장 적은 날
  for (const s of forced) {
    if (forcedDate(s, dates) !== undefined) continue;
    let best = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!ev.fits(i, [...days[i], s])) continue;
      const delta = insertionDelta(ctxs[i], ev.evalDay(i, days[i]).order, s, book);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    }
    if (best < 0) {
      let bestOver = Infinity;
      for (let i = 0; i < n; i += 1) {
        const over = ev.evalDay(i, [...days[i], s]).overMin;
        if (over < bestOver) {
          bestOver = over;
          best = i;
        }
      }
    }
    if (best >= 0) days[best].push(s);
    tick();
  }

  /** 들어가는 날 가운데 끼워 넣는 비용이 가장 작은 날. 수동 순서 날짜에 들어가면 그 날. 없으면 -1 */
  const placeDay = (s: Spot): number => {
    const pref = preferredDate(s, dates);
    if (pref !== undefined) {
      const pi = dates.indexOf(pref);
      if (ev.fits(pi, [...days[pi], s])) return pi;
    }
    let best = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!ev.fits(i, [...days[i], s])) continue;
      const delta = insertionDelta(ctxs[i], ev.evalDay(i, days[i]).order, s, book);
      if (delta < bestDelta - 1e-9) {
        bestDelta = delta;
        best = i;
      }
    }
    return best;
  };

  let excluded: Spot[] = [];
  for (const s of free) {
    const d = placeDay(s);
    if (d >= 0) days[d].push(s);
    else excluded.push(s);
    tick();
  }

  // 교환·삽입 보정
  const isForcedSpot = (s: Spot) => isForced(s, dates);
  for (let guard = 0; guard < 200; guard += 1) {
    let changed = false;
    excluded.sort(priorityCompare);
    // 교환: 우선순위가 높은 제외 스팟부터, 가장 낮은 확정 스팟과 바꿔 본다
    outer: for (const e of excluded) {
      const lower: { s: Spot; day: number }[] = [];
      days.forEach((list, i) => {
        for (const c of list) if (!isForcedSpot(c) && priorityCompare(e, c) < 0) lower.push({ s: c, day: i });
      });
      lower.sort((a, b) => priorityCompare(b.s, a.s));
      for (const { s: c, day } of lower) {
        const next = [...days[day].filter((x) => x.id !== c.id), e];
        if (ev.fits(day, next)) {
          days[day] = next;
          excluded = [...excluded.filter((x) => x.id !== e.id), c];
          changed = true;
          break outer;
        }
      }
    }
    // 삽입: 제외 스팟이 그대로 들어가는 날이 있으면 넣는다
    excluded.sort(priorityCompare);
    for (const e of [...excluded]) {
      const d = placeDay(e);
      if (d >= 0) {
        days[d].push(e);
        excluded = excluded.filter((x) => x.id !== e.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { days, excluded };
}

/** 제외 사유 문장(A2 사유 규칙). 제외 여부는 바꾸지 않는다. */
export function reasonFor(
  s: Spot,
  ctxs: readonly DayCtx[],
  days: readonly Spot[][],
  ev: DayEvaluator,
  book: TravelBook,
): Omit<ExcludedSpot, 'spotId' | 'name' | 'proposerCount'> {
  let nearest = -1;
  let bestOver = Infinity;
  for (let i = 0; i < ctxs.length; i += 1) {
    const over = ev.evalDay(i, [...days[i], s]).overMin;
    if (over < bestOver) {
      bestOver = over;
      nearest = i;
    }
  }
  if (nearest < 0) return { reasonCode: 'dayFull', reason: '넣을 날짜가 없어서' };
  const ctx = ctxs[nearest];
  const baseCtx = ctx.base ? ctx : ctxs.find((c) => c.base);
  if (baseCtx?.base) {
    const b = baseCtx.base.coord;
    const rt =
      book.get(b, s.coord, legTransport(baseCtx, 'base', s.id)).minutes +
      book.get(s.coord, b, legTransport(baseCtx, s.id, 'base')).minutes;
    if (rt >= FAR_ROUNDTRIP_MIN) {
      return { reasonCode: 'tooFar', reason: `왕복 ${humanMin(rt)}` };
    }
  }
  // 남은 시간이 시작되는 시각(그날 마지막 출발)의 시간대를 붙인다
  const cur = ev.evalDay(nearest, days[nearest]);
  const last = cur.items[cur.items.length - 1];
  const freeFrom = last ? toMin(last.depart) : ctx.startMin;
  const label = spansDayparts(ctx) ? `${dayShort(ctx.date)} ${daypart(freeFrom)}` : dayShort(ctx.date);
  return { reasonCode: 'dayFull', reason: `${josa(label, '이/가')} 꽉 차서`, nearestDate: ctx.date };
}

/** 군집 안 가까운 이웃 쌍 */
function clusterPairs(ctxs: readonly DayCtx[], spots: readonly Spot[]): Pair[] {
  const cl = clusterSpots(spots);
  const transports = [...new Set(ctxs.map((c) => c.transport))];
  const out: Pair[] = [];
  spots.forEach((s, i) => {
    const near = spots
      .map((o, j) => ({ j, km: haversineKm(s.coord, o.coord) }))
      .filter((x) => x.j !== i && cl[x.j] === cl[i])
      .sort((a, b) => a.km - b.km || a.j - b.j)
      .slice(0, CLUSTER_NEIGHBORS);
    for (const { j } of near) {
      for (const t of transports) {
        out.push({ a: s.coord, b: spots[j].coord, t });
        out.push({ a: spots[j].coord, b: s.coord, t });
      }
    }
  });
  return out;
}

/** 이 배치를 시간표로 만들 때 쓰는 구간. 먼저 지금 순서의 구간(기점 출발, 스팟 사이, 복귀) */
function finalPairs(evals: readonly DayEval[]): Pair[] {
  const out: Pair[] = [];
  for (const e of evals) {
    const stops = e.order.map((s) => ({ id: s.id, coord: s.coord }));
    const seq = e.ctx.base ? [{ id: 'base', coord: e.ctx.base.coord }, ...stops] : stops;
    for (let k = 1; k < seq.length; k += 1) {
      out.push({ a: seq[k - 1].coord, b: seq[k].coord, t: legTransport(e.ctx, seq[k - 1].id, seq[k].id) });
    }
    if (e.ctx.base && !e.ctx.noReturn && stops.length > 0) {
      const last = stops[stops.length - 1];
      out.push({ a: last.coord, b: e.ctx.base.coord, t: legTransport(e.ctx, last.id, 'base') });
    }
  }
  return out;
}

/** 그날 안의 나머지 구간(순서를 다시 고를 때 추정이 아니라 조회값을 쓰게) */
function restDayPairs(evals: readonly DayEval[]): Pair[] {
  return evals.flatMap((e) => dayPairs(e.ctx, e.order));
}

/** 제외 스팟과 날짜마다 가장 가까운 두 곳(기점 포함) */
function reasonPairs(ctxs: readonly DayCtx[], alloc: Allocation): Pair[] {
  const out: Pair[] = [];
  for (const e of alloc.excluded) {
    ctxs.forEach((ctx, i) => {
      const stops = alloc.days[i].map((s) => ({ id: s.id, coord: s.coord }));
      if (ctx.base) stops.push({ id: 'base', coord: ctx.base.coord });
      stops
        .sort((a, b) => haversineKm(e.coord, a.coord) - haversineKm(e.coord, b.coord))
        .slice(0, 2)
        .forEach((o) => {
          out.push({ a: e.coord, b: o.coord, t: legTransport(ctx, e.id, o.id) });
          out.push({ a: o.coord, b: e.coord, t: legTransport(ctx, o.id, e.id) });
        });
    });
  }
  return out;
}

/** 아직 모르는 구간만, 남은 예산 안에서 앞에서부터 */
function withinBudget(book: TravelBook, pairs: Pair[], limit: number): Pair[] {
  const out: Pair[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    if (out.length >= limit) break;
    if (book.has(p.a, p.b, p.t)) continue;
    const k = `${p.t}|${p.a.latitude},${p.a.longitude}>${p.b.latitude},${p.b.longitude}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export async function buildPlan(trip: Trip, deps: PlanDeps): Promise<Plan> {
  const steps: PlanStep[] = [];
  const clockNow = () => deps.clock?.now() ?? 0;
  let mark = clockNow();
  /** 배치 중 추가 조회에 쓴 시간. 이동시간 조회 단계에 더하고 배치 단계에서 뺀다 */
  let lookupMs = 0;
  const msOf = (key: PlanStep['key']) => steps.find((x) => x.key === key)?.ms ?? 0;
  const emit = (step: Omit<PlanStep, 'ms'>, final = false, ms?: number) => {
    const s: PlanStep = { ...step, ms: ms ?? (final ? clockNow() - mark : msOf(step.key)) };
    const i = steps.findIndex((x) => x.key === s.key);
    if (i >= 0) steps[i] = s;
    else steps.push(s);
    deps.onStep?.(s);
    if (final) mark = clockNow();
  };

  const ctxs = dayContexts(trip);
  const dates = ctxs.map((c) => c.date);
  const book = createTravelBook(deps.routes);

  // 1. 위치 확인
  const excluded: ExcludedSpot[] = [];
  const pushEx = (s: Spot, rest: Omit<ExcludedSpot, 'spotId' | 'name' | 'proposerCount'>) =>
    excluded.push({ spotId: s.id, name: s.name, proposerCount: proposerCount(s), ...rest });
  for (const s of trip.spots) {
    if (s.removedByUser) {
      pushEx(s, { reasonCode: 'userRemoved', reason: s.removedReason === 'delay' ? '지연 조정안으로 뺌' : '사용자가 직접 뺌' });
    }
  }
  const candidates: Spot[] = [];
  for (const s of activeSpots(trip)) {
    if (s.fixedDate && !dates.includes(s.fixedDate)) {
      pushEx(s, { reasonCode: 'outOfPeriod', reason: `지정한 날짜 ${josa(dayShort(s.fixedDate), '이/가')} 여행 기간 밖이라` });
    } else candidates.push(s);
  }
  emit({ key: 'locate', label: '위치 확인', done: candidates.length, total: candidates.length }, true);

  // 2. 이동시간 조회: 기점 행·열 → 군집 안 이웃
  const baseAsk = ctxs.flatMap((c) => basePairs(c, candidates));
  const clusterAsk = clusterPairs(ctxs, candidates);
  const firstLimit = Math.max(0, ROUTE_CALL_BUDGET - FINAL_RESERVE);
  const ask1 = withinBudget(book, [...baseAsk, ...clusterAsk], firstLimit);
  const matrixTotal = ask1.length;
  emit({ key: 'matrix', label: '이동시간 조회', done: 0, total: matrixTotal });
  await book.ensure(ask1);
  emit({ key: 'matrix', label: '이동시간 조회', done: matrixTotal, total: matrixTotal }, true);

  // 3. 배치(실제 구간을 조회하고 값이 바뀌면 다시)
  let alloc: Allocation = { days: ctxs.map(() => []), excluded: [] };
  let ev = createEvaluator(ctxs, book);
  const runAllocate = () => {
    ev = createEvaluator(ctxs, book);
    alloc = allocate(ctxs, candidates, book, ev, (done, total) =>
      emit({ key: 'allocate', label: `배치 ${done}/${total}`, done, total }),
    );
  };
  let settled = false;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    runAllocate();
    const evals = alloc.days.map((list, i) => ev.evalDay(i, list));
    const asked = book.stats().asked;
    const more = withinBudget(
      book,
      [...finalPairs(evals), ...reasonPairs(ctxs, alloc), ...restDayPairs(evals)],
      Math.max(0, ROUTE_CALL_BUDGET - asked),
    );
    if (more.length === 0) {
      settled = true;
      break;
    }
    const t0 = clockNow();
    await book.ensure(more);
    const spent = clockNow() - t0;
    lookupMs += spent;
    emit({ key: 'matrix', label: '이동시간 조회', done: book.stats().asked, total: book.stats().asked }, false, msOf('matrix') + spent);
  }
  // 마지막 회차에서 새로 조회했으면 조회 없이 한 번 더 배치한다(최종 배치가 조회값 기준으로 수용량·불변식을 지키게)
  if (!settled) runAllocate();
  emit(
    { key: 'allocate', label: `배치 ${candidates.length}/${candidates.length}`, done: candidates.length, total: candidates.length },
    false,
    Math.max(0, clockNow() - mark - lookupMs),
  );
  mark = clockNow();

  const evals = alloc.days.map((list, i) => ev.evalDay(i, list));
  const days: DayPlan[] = evals.map(toDayPlan);

  // 4. 제외 사유. 제외 스팟과 날짜별 가장 가까운 스팟 사이 구간을 남은 예산 안에서 조회한다(가장 적은 초과 날짜 판정용)
  const reasonAsk = withinBudget(
    book,
    reasonPairs(ctxs, alloc),
    Math.max(0, ROUTE_CALL_BUDGET - book.stats().asked),
  );
  if (reasonAsk.length > 0) {
    await book.ensure(reasonAsk);
    ev = createEvaluator(ctxs, book);
  }
  const autoEx = [...alloc.excluded].sort(priorityCompare).reverse();
  autoEx.forEach((s, k) => {
    pushEx(s, reasonFor(s, ctxs, alloc.days, ev, book));
    emit({ key: 'reasons', label: `제외 사유 ${k + 1}/${autoEx.length}`, done: k + 1, total: autoEx.length });
  });
  emit({ key: 'reasons', label: `제외 사유 ${autoEx.length}/${autoEx.length}`, done: autoEx.length, total: autoEx.length }, true);

  const order = new Map(trip.spots.map((s, i) => [s.id, i]));
  excluded.sort((a, b) => (order.get(a.spotId) ?? 0) - (order.get(b.spotId) ?? 0));

  const stats = book.stats();
  return {
    tripId: trip.id,
    days,
    excluded,
    overCapacity: days.filter((d) => d.overMin > 0).map((d) => ({ date: d.date, overMin: d.overMin })),
    computedAt: deps.now,
    routeCalls: stats.calls,
    cacheHits: stats.cacheHits,
    estimated: evals.some((e) => e.estimated),
    steps,
  };
}

/** 스팟 id → 그 스팟이 배치된 날짜(확정이면) */
export function placedDateOf(plan: Plan): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of plan.days) for (const it of d.items) out[it.spotId] = d.date;
  return out;
}

export { isManualHere };
