import type {
  DayBase,
  DayPlan,
  ItemNotice,
  LatLng,
  LegOverride,
  ReturnLeg,
  Spot,
  TimetableItem,
  Transport,
  Trip,
} from '../../types';
import { TRANSPORT_LABEL } from '../constants';
import { liveLegs } from '../ops/schedule';
import { proposerCount } from '../spotUtil';
import { dateRange, toHHMM, toMin, weekday } from '../util';
import { bestOrder, cheapestInsertion, type OrderInput } from './order';
import type { LegTime, Pair, TravelBook } from './travel';

/**
 * 하루 계산(WP4 소유, 순수). 날짜별 설정(FR-205)을 풀고, 순서(FR-501)와 시간표(FR-502)를 만든다.
 * 수용량 판정과 최종 시간표가 같은 함수를 쓴다. 그래서 "들어간다/안 들어간다"와 화면 시각이 어긋나지 않는다.
 */

export interface DayCtx {
  date: string;
  base: DayBase | null;
  baseSource: DayPlan['baseSource'];
  noReturn: boolean;
  startMin: number;
  endLimitMin: number;
  capacityMin: number;
  transport: Transport;
  legs: LegOverride[];
}

/**
 * 'inherit'는 직전 날짜 기점을 쓴다. 첫날의 'inherit'는 null과 같다.
 * 직전 날짜가 null(첫 스팟 기점)이면 다음 날의 'inherit'도 첫 스팟 기점이다(그 전 날짜 기점을 건너 물려받지 않는다).
 */
export function resolveBases(trip: Trip): { date: string; base: DayBase | null; source: DayPlan['baseSource'] }[] {
  let prev: DayBase | null = null;
  return dateRange(trip.startDate, trip.endDate).map((date) => {
    const setting = trip.days.find((d) => d.date === date);
    // 설정이 없을 때만 승계다. 명시한 null(첫 스팟 기점)을 ??로 승계로 바꾸지 않는다
    const raw = setting ? setting.base : 'inherit';
    if (raw === 'inherit') {
      return { date, base: prev, source: prev ? ('inherited' as const) : ('firstSpot' as const) };
    }
    if (raw === null) {
      prev = null;
      return { date, base: null, source: 'firstSpot' as const };
    }
    prev = raw;
    return { date, base: raw, source: 'set' as const };
  });
}

export function dayContexts(trip: Trip): DayCtx[] {
  return resolveBases(trip).map(({ date, base, source }) => {
    const setting = trip.days.find((d) => d.date === date);
    const startMin = toMin(setting?.dayStart ?? trip.dayStart);
    const endLimitMin = toMin(setting?.dayEnd ?? trip.dayEnd);
    return {
      date,
      base,
      baseSource: source,
      noReturn: setting?.noReturn ?? false,
      startMin,
      endLimitMin,
      capacityMin: Math.max(0, endLimitMin - startMin),
      transport: setting?.transport ?? trip.transport,
      legs: liveLegs(trip.legs).filter((l) => l.date === date),
    };
  });
}

/** 구간 수단. 구간별 지정(FR-504)이 있으면 그것, 없으면 그날 수단. id는 spotId 또는 'base' */
export function legTransport(ctx: DayCtx, fromId: string, toId: string): Transport {
  return ctx.legs.find((l) => l.fromId === fromId && l.toId === toId)?.transport ?? ctx.transport;
}

interface Stop {
  id: string;
  coord: LatLng;
}

/** 이 날 이 스팟들로 계산하려면 필요한 구간(기점 포함 모든 방향). */
export function dayPairs(ctx: DayCtx, spots: readonly Spot[]): Pair[] {
  const stops: Stop[] = spots.map((s) => ({ id: s.id, coord: s.coord }));
  if (ctx.base) stops.push({ id: 'base', coord: ctx.base.coord });
  const out: Pair[] = [];
  for (const a of stops) for (const b of stops) if (a !== b) out.push({ a: a.coord, b: b.coord, t: legTransport(ctx, a.id, b.id) });
  return out;
}

/** 기점 왕복 쌍(기점 행·열) */
export function basePairs(ctx: DayCtx, spots: readonly Spot[]): Pair[] {
  if (!ctx.base) return [];
  const out: Pair[] = [];
  for (const s of spots) {
    out.push({ a: ctx.base.coord, b: s.coord, t: legTransport(ctx, 'base', s.id) });
    out.push({ a: s.coord, b: ctx.base.coord, t: legTransport(ctx, s.id, 'base') });
  }
  return out;
}

function leg(ctx: DayCtx, book: TravelBook, from: Stop, to: Stop): LegTime {
  return book.get(from.coord, to.coord, legTransport(ctx, from.id, to.id));
}

function orderInput(ctx: DayCtx, spots: readonly Spot[], book: TravelBook, loop = false): OrderInput {
  const stops: Stop[] = spots.map((s) => ({ id: s.id, coord: s.coord }));
  const base: Stop | undefined = ctx.base ? { id: 'base', coord: ctx.base.coord } : undefined;
  return {
    n: stops.length,
    start: (j) => (base ? leg(ctx, book, base, stops[j]).minutes : 0),
    end: (j) => (base && (loop || !ctx.noReturn) ? leg(ctx, book, stops[j], base).minutes : 0),
    step: (i, j) => leg(ctx, book, stops[i], stops[j]).minutes,
  };
}

/** 수동 순서(FR-503)가 이 날에 걸린 스팟 */
export function isManualHere(spot: Spot, date: string): boolean {
  return spot.manualOrder?.date === date;
}

/**
 * 순서를 정한다. 수동 순서가 있는 날은 정렬하지 않는다(수동 순서대로, 나머지는 싼 자리에 끼운다).
 * 끼울 때 구간 지정(FR-504)이 걸린 이웃 사이에는 넣지 않는다(지정한 구간이 시간표에서 사라지지 않게).
 * 10개 이하는 정확해, 넘으면 근사.
 */
export function orderSpots(
  ctx: DayCtx,
  spots: readonly Spot[],
  book: TravelBook,
): { order: Spot[]; method: DayPlan['orderMethod'] } {
  if (spots.some((s) => isManualHere(s, ctx.date))) {
    const manual = spots
      .filter((s) => isManualHere(s, ctx.date))
      .sort((a, b) => (a.manualOrder?.index ?? 0) - (b.manualOrder?.index ?? 0) || (a.id < b.id ? -1 : 1));
    const rest = spots.filter((s) => !isManualHere(s, ctx.date));
    const all = [...manual, ...rest];
    const inp = orderInput(ctx, all, book, true);
    const idx: number[] = manual.map((_, i) => i);
    const pinnedPair = (a: string, b: string) => ctx.legs.some((l) => l.fromId === a && l.toId === b);
    rest.forEach((_, k) => {
      const x = manual.length + k;
      const blocked = (p: number) =>
        pinnedPair(p === 0 ? 'base' : all[idx[p - 1]].id, p === idx.length ? 'base' : all[idx[p]].id);
      const { pos } = cheapestInsertion(idx, x, inp, ctx.legs.length ? blocked : undefined);
      idx.splice(pos, 0, x);
    });
    return { order: idx.map((i) => all[i]), method: 'manual' };
  }
  const { order, method } = bestOrder(orderInput(ctx, spots, book));
  return { order: repairHours(ctx, order.map((i) => spots[i]), book), method };
}

/** 영업시간 밖에 걸리는 스팟 수(시작 전 도착, 종료 뒤까지 머묾. 휴무일 제외)와 복귀까지 끝나는 시각 */
function hoursScore(ctx: DayCtx, order: readonly Spot[], book: TravelBook): { late: number; end: number } {
  let t = ctx.startMin;
  let late = 0;
  let prev: Stop | undefined = ctx.base ? { id: 'base', coord: ctx.base.coord } : undefined;
  for (const s of order) {
    const here: Stop = { id: s.id, coord: s.coord };
    if (prev) t += leg(ctx, book, prev, here).minutes;
    if (s.arriveOverride) t = Math.max(t, toMin(s.arriveOverride));
    const open = s.hours && !s.hours.closedWeekdays?.includes(weekday(ctx.date));
    if (open && s.hours && (t < toMin(s.hours.open) || t + s.stayMin > toMin(s.hours.close))) late += 1;
    t += s.stayMin;
    prev = here;
  }
  if (ctx.base && !ctx.noReturn && prev) t += leg(ctx, book, prev, { id: 'base', coord: ctx.base.coord }).minutes;
  return { late, end: t };
}

/**
 * 영업시간 보정(FR-502). 이동 시간 최적 순서에서 영업시간 밖에 걸리는 스팟이 있으면, 스팟 하나를 앞자리로 옮겨 본다.
 * 늦은 도착이 줄고 활동시간 초과가 늘지 않을 때만 바꾼다. 바꿀 수 없으면 그대로 두고 시간표에 안내만 단다.
 * 휴무일은 순서로 풀 수 없으므로 세지 않는다.
 */
export function repairHours(ctx: DayCtx, order: Spot[], book: TravelBook): Spot[] {
  if (!order.some((s) => s.hours)) return order;
  let cur = order;
  let score = hoursScore(ctx, cur, book);
  const overOf = (end: number) => Math.max(0, end - ctx.endLimitMin);
  for (let guard = 0; guard < order.length && score.late > 0; guard += 1) {
    let best: { order: Spot[]; late: number; end: number } | undefined;
    for (let i = 1; i < cur.length; i += 1) {
      for (let p = 0; p < i; p += 1) {
        const cand = [...cur];
        const [x] = cand.splice(i, 1);
        cand.splice(p, 0, x);
        const sc = hoursScore(ctx, cand, book);
        if (sc.late >= score.late || overOf(sc.end) > overOf(score.end)) continue;
        if (!best || sc.late < best.late || (sc.late === best.late && sc.end < best.end)) best = { order: cand, ...sc };
      }
    }
    if (!best) break;
    cur = best.order;
    score = { late: best.late, end: best.end };
  }
  return cur;
}

/** 근접도(FR-505) 판단용: 이 날 지금 순서에 x를 끼울 때 늘어나는 이동 시간(기점 왕복으로 본다). */
export function insertionDelta(ctx: DayCtx, order: readonly Spot[], x: Spot, book: TravelBook): number {
  const all = [...order, x];
  const inp = orderInput(ctx, all, book, true);
  return cheapestInsertion(
    order.map((_, i) => i),
    all.length - 1,
    inp,
  ).delta;
}

/**
 * 복귀 구간(마지막 스팟 → 기점)의 실제 수단·추정·안내. 통합 때 공유 DayPlan.returnLeg로 들어갔다.
 * 아래 두 이름은 호환용이다. 없으면(예전 계획, 다른 곳에서 만든 DayPlan) undefined.
 */
export type { ReturnLeg };

export type DayPlanWithReturn = DayPlan;

export function returnLegOf(day: DayPlan): ReturnLeg | undefined {
  return day.returnLeg;
}

export interface DayEval {
  ctx: DayCtx;
  order: Spot[];
  method: DayPlan['orderMethod'];
  items: TimetableItem[];
  returnMin: number;
  returnEstimated: boolean;
  /** 복귀 구간이 있을 때만 */
  returnLeg?: ReturnLeg;
  usedMin: number;
  overMin: number;
  carryOver: string[];
  /** 추정으로 때운 구간이 있다 */
  estimated: boolean;
}

function hoursNotice(spot: Spot, date: string, arrive: number, depart: number): ItemNotice | undefined {
  const h = spot.hours;
  if (!h) return undefined;
  if (h.closedWeekdays?.includes(weekday(date))) return { kind: 'outsideHours', text: '이 날은 휴무일입니다(예시 영업시간)' };
  const open = toMin(h.open);
  const close = toMin(h.close);
  if (arrive >= close) return { kind: 'outsideHours', text: `영업 종료(${h.close}) 뒤 도착` };
  if (arrive < open) return { kind: 'outsideHours', text: `영업 시작(${h.open}) 전 도착` };
  if (depart > close) return { kind: 'outsideHours', text: `영업 종료(${h.close}) 뒤까지 머묾` };
  return undefined;
}

function legNotice(t: LegTime, wanted: Transport): ItemNotice | undefined {
  if (t.noRoute) {
    return wanted === 'car'
      ? { kind: 'fallbackTransport', text: `자동차 경로가 없어 ${TRANSPORT_LABEL[t.transport]}로 계산했습니다` }
      : { kind: 'noRoute', text: `${TRANSPORT_LABEL[wanted]} 경로가 없어 ${TRANSPORT_LABEL[t.transport]}로 계산했습니다` };
  }
  if (t.failed) return { kind: 'estimated', text: '경로 조회에 실패해 직선거리로 추정했습니다' };
  return undefined;
}

/** 시간표(FR-502). arrive = 직전 depart + 이동, depart = arrive + 체류. 도착 지정이 늦으면 기다린다. */
export function evaluateDay(ctx: DayCtx, spots: readonly Spot[], book: TravelBook): DayEval {
  const { order, method } = orderSpots(ctx, spots, book);
  const items: TimetableItem[] = [];
  let clock = ctx.startMin;
  let estimated = false;
  let prev: Stop | undefined = ctx.base ? { id: 'base', coord: ctx.base.coord } : undefined;
  for (const s of order) {
    const here: Stop = { id: s.id, coord: s.coord };
    const wanted = prev ? legTransport(ctx, prev.id, here.id) : ctx.transport;
    const t: LegTime = prev ? leg(ctx, book, prev, here) : { minutes: 0, transport: wanted, estimated: false, known: true };
    estimated ||= t.estimated && !!prev;
    let arrive = clock + t.minutes;
    const notices: ItemNotice[] = [];
    const ln = legNotice(t, wanted);
    if (ln) notices.push(ln);
    if (s.arriveOverride) {
      const ov = toMin(s.arriveOverride);
      if (ov > arrive) arrive = ov;
      else if (ov < arrive) {
        notices.push({ kind: 'overrideLate', text: `지정한 도착 ${s.arriveOverride}보다 ${arrive - ov}분 늦게 도착합니다` });
      }
    }
    const depart = arrive + s.stayMin;
    const hn = hoursNotice(s, ctx.date, arrive, depart);
    if (hn) notices.push(hn);
    items.push({
      spotId: s.id,
      name: s.name,
      travelMin: t.minutes,
      legTransport: t.transport,
      legEstimated: t.estimated,
      arrive: toHHMM(arrive),
      depart: toHHMM(depart),
      stayMin: s.stayMin,
      pinned: s.pinned,
      proposerCount: proposerCount(s),
      manual: method === 'manual' || !!s.arriveOverride,
      notices,
    });
    clock = depart;
    prev = here;
  }
  let returnMin = 0;
  let returnEstimated = false;
  let returnLeg: ReturnLeg | undefined;
  if (ctx.base && !ctx.noReturn && order.length > 0) {
    const last = order[order.length - 1];
    const t = leg(ctx, book, { id: last.id, coord: last.coord }, { id: 'base', coord: ctx.base.coord });
    returnMin = t.minutes;
    returnEstimated = t.estimated;
    estimated ||= t.estimated;
    const ln = legNotice(t, legTransport(ctx, last.id, 'base'));
    returnLeg = { transport: t.transport, estimated: t.estimated, notices: ln ? [ln] : [] };
  }
  const usedMin = order.length === 0 ? 0 : clock + returnMin - ctx.startMin;
  const overMin = Math.max(0, usedMin - ctx.capacityMin);
  const carryOver: string[] = [];
  if (overMin > 0) {
    items.forEach((it, i) => {
      const end = toMin(it.depart) + (i === items.length - 1 ? returnMin : 0);
      if (end > ctx.endLimitMin && !it.pinned) carryOver.push(it.spotId);
    });
  }
  return { ctx, order, method, items, returnMin, returnEstimated, returnLeg, usedMin, overMin, carryOver, estimated };
}

export function toDayPlan(ev: DayEval): DayPlanWithReturn {
  const first = ev.order[0];
  const base: DayBase | null =
    ev.ctx.base ?? (first ? { name: first.name, coord: first.coord, placeId: first.placeId } : null);
  const out: DayPlanWithReturn = {
    date: ev.ctx.date,
    base,
    baseSource: ev.ctx.baseSource,
    noReturn: ev.ctx.noReturn || !ev.ctx.base,
    startMin: ev.ctx.startMin,
    endLimitMin: ev.ctx.endLimitMin,
    items: ev.items,
    returnMin: ev.returnMin,
    usedMin: ev.usedMin,
    capacityMin: ev.ctx.capacityMin,
    overMin: ev.overMin,
    carryOver: ev.carryOver,
    orderMethod: ev.method,
  };
  if (ev.returnLeg) out.returnLeg = ev.returnLeg;
  return out;
}
