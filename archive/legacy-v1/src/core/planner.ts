import type { DayPlan, ExcludedSpot, Plan, Spot, TimetableItem, Trip } from '../types';
import { provider } from '../services';
import { dateRange, dayLabel, humanMin, toHHMM, toMin } from './util';

/**
 * FR-505 날짜 배분 → FR-403 자동 선별 → FR-501 순서 최적화 → FR-502 시간표 생성.
 * 명세서의 실행 순서(FR-505, FR-501, FR-502)를 그대로 따른다.
 *
 * 핵심 규칙 (되돌리지 말 것):
 *   - 확정 버튼은 없다. 후보 전부를 루트 대상에 넣고, 하루 수용량을 넘는 만큼만 자동으로 뺀다.
 *   - 제외 순서는 제안자 수가 적은 순, 동점이면 등록이 늦은 순.
 *   - 고정한 후보는 제외 대상에서 빠진다. 고정만으로 수용량을 넘기면 안내만 하고 사용자가 직접 뺀다.
 *   - 제외된 스팟은 이유와 함께 100% 표시한다. 조용한 제외는 없다.
 */

interface DayBucket {
  date: string;
  /** candidates 배열의 인덱스 순서 */
  order: number[];
  travelMin: number;
  stayMin: number;
}

/** 행렬 인덱스: 0 = 기점, 후보 i = i + 1 */
const mi = (candidateIndex: number) => candidateIndex + 1;

function travelOfOrder(order: number[], m: number[][]): number {
  if (order.length === 0) return 0;
  let total = m[0][mi(order[0])];
  for (let k = 0; k < order.length - 1; k += 1) {
    total += m[mi(order[k])][mi(order[k + 1])];
  }
  total += m[mi(order[order.length - 1])][0];
  return total;
}

/** 후보를 이 날짜에 넣었을 때 늘어나는 이동 시간의 최솟값과 그때의 순서 */
function bestInsertion(
  order: number[],
  candidate: number,
  m: number[][],
): { cost: number; order: number[] } {
  const before = travelOfOrder(order, m);
  let best = { cost: Infinity, order };
  for (let pos = 0; pos <= order.length; pos += 1) {
    const next = [...order.slice(0, pos), candidate, ...order.slice(pos)];
    const cost = travelOfOrder(next, m) - before;
    if (cost < best.cost) best = { cost, order: next };
  }
  return best;
}

/** FR-501. 기점에서 시작하는 최근접 이웃 정렬 뒤 2-opt로 다듬는다. */
function optimizeOrder(order: number[], m: number[][]): number[] {
  if (order.length < 2) return order;

  const remaining = [...order];
  const route: number[] = [];
  let current = 0; // 기점
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestMin = Infinity;
    remaining.forEach((c, idx) => {
      const t = m[current][mi(c)];
      if (t < bestMin) {
        bestMin = t;
        bestIdx = idx;
      }
    });
    current = mi(remaining[bestIdx]);
    route.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  // 스팟 10개 초과면 근사 정렬에서 멈춘다 (FR-501 예외 처리)
  if (route.length > 10) return route;

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i += 1) {
      for (let j = i + 1; j < route.length; j += 1) {
        const next = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        if (travelOfOrder(next, m) < travelOfOrder(route, m) - 0.001) {
          route.splice(0, route.length, ...next);
          improved = true;
        }
      }
    }
  }
  return route;
}

/** FR-502. 도착·체류·출발 시각을 붙인다. */
function buildTimetable(
  order: number[],
  candidates: Spot[],
  m: number[][],
  startHHMM: string,
): { items: TimetableItem[]; returnMin: number; endMin: number } {
  let cursor = toMin(startHHMM);
  let prev = 0;
  const items: TimetableItem[] = [];

  for (const c of order) {
    const travel = m[prev][mi(c)];
    const arrive = cursor + travel;
    const spot = candidates[c];
    const depart = arrive + spot.stayMin;
    items.push({
      spotId: spot.id,
      name: spot.name,
      travelMin: travel,
      arrive: toHHMM(arrive),
      depart: toHHMM(depart),
      stayMin: spot.stayMin,
      pinned: spot.pinned,
      proposerCount: spot.proposerIds.length,
    });
    cursor = depart;
    prev = mi(c);
  }

  const returnMin = order.length > 0 ? m[prev][0] : 0;
  return { items, returnMin, endMin: cursor + returnMin };
}

/**
 * 우선순위. 앞에 올수록 먼저 자리를 잡는다.
 * 제외 순서(제안자 적은 순 → 등록 늦은 순)의 정확한 반대다.
 */
function byPriority(a: Spot, b: Spot): number {
  const aFixed = a.pinned || !!a.fixedDate;
  const bFixed = b.pinned || !!b.fixedDate;
  if (aFixed !== bFixed) return aFixed ? -1 : 1;
  if (a.proposerIds.length !== b.proposerIds.length) {
    return b.proposerIds.length - a.proposerIds.length;
  }
  return a.createdAt - b.createdAt;
}

export async function buildPlan(trip: Trip): Promise<Plan> {
  const candidates = trip.spots.filter((s) => !s.removedByUser);
  const dates = dateRange(trip.startDate, trip.endDate);
  const capacity = toMin(trip.dayEnd) - toMin(trip.dayStart);

  if (candidates.length === 0) {
    return {
      days: dates.map((date) => ({
        date,
        items: [],
        returnMin: 0,
        usedMin: 0,
        capacityMin: capacity,
      })),
      excluded: [],
      overCapacityDates: [],
      computedAt: Date.now(),
      routeCalls: 0,
      estimated: false,
    };
  }

  // 경로 조회는 한 번에 묶어서 한다. 기점 + 후보 전체의 정방 행렬 1회.
  const points = [trip.base.coord, ...candidates.map((c) => c.coord)];
  const matrix = await provider.travelMatrix(points, points, trip.transport);
  const m = matrix.minutes;

  const buckets: DayBucket[] = dates.map((date) => ({
    date,
    order: [],
    travelMin: 0,
    stayMin: 0,
  }));
  const excluded: ExcludedSpot[] = [];
  const overCapacity = new Set<string>();

  const queue = candidates
    .map((spot, index) => ({ spot, index }))
    .sort((a, b) => byPriority(a.spot, b.spot));

  for (const { spot, index } of queue) {
    const allowed = spot.fixedDate
      ? buckets.filter((b) => b.date === spot.fixedDate)
      : buckets;

    let chosen: { bucket: DayBucket; order: number[]; used: number } | undefined;
    let nearest: { bucket: DayBucket; order: number[]; used: number } | undefined;

    for (const bucket of allowed) {
      const ins = bestInsertion(bucket.order, index, m);
      const used = bucket.travelMin + ins.cost + bucket.stayMin + spot.stayMin;
      const option = { bucket, order: ins.order, used };
      if (!nearest || used < nearest.used) nearest = option;
      if (used <= capacity && (!chosen || used < chosen.used)) chosen = option;
    }

    const target = chosen ?? nearest;
    if (!target) {
      // 지정한 날짜가 여행 기간 밖이다. 조용히 흘리지 않고 이유를 남긴다.
      excluded.push({
        spotId: spot.id,
        name: spot.name,
        reason: `지정한 날짜 ${spot.fixedDate ?? '?'}가 여행 기간 밖이라`,
        proposerCount: spot.proposerIds.length,
      });
      continue;
    }

    if (!chosen) {
      // 자리가 없다.
      if (spot.pinned || spot.fixedDate) {
        // 고정은 자동 제외 대상이 아니다. 넣고 초과를 알린다.
        target.bucket.order = target.order;
        target.bucket.travelMin = travelOfOrder(target.order, m);
        target.bucket.stayMin += spot.stayMin;
        overCapacity.add(target.bucket.date);
        continue;
      }
      const roundTrip = m[0][mi(index)] + m[mi(index)][0];
      const reason =
        roundTrip + spot.stayMin > capacity
          ? `왕복 ${humanMin(roundTrip)}이라 하루 활동시간 안에 넣을 수 없어서`
          : `${dayLabel(target.bucket.date)}이(가) 꽉 차서`;
      excluded.push({
        spotId: spot.id,
        name: spot.name,
        reason,
        proposerCount: spot.proposerIds.length,
      });
      continue;
    }

    chosen.bucket.order = chosen.order;
    chosen.bucket.travelMin = travelOfOrder(chosen.order, m);
    chosen.bucket.stayMin += spot.stayMin;
  }

  const days: DayPlan[] = buckets.map((bucket) => {
    const order = optimizeOrder(bucket.order, m);
    const { items, returnMin, endMin } = buildTimetable(order, candidates, m, trip.dayStart);
    return {
      date: bucket.date,
      items,
      returnMin,
      usedMin: Math.max(0, endMin - toMin(trip.dayStart)),
      capacityMin: capacity,
    };
  });

  // 사용자가 직접 뺀 후보도 제외 목록에 이유와 함께 남긴다.
  for (const spot of trip.spots) {
    if (spot.removedByUser) {
      excluded.push({
        spotId: spot.id,
        name: spot.name,
        reason: '사용자가 직접 뺌',
        proposerCount: spot.proposerIds.length,
      });
    }
  }

  return {
    days,
    excluded,
    overCapacityDates: [...overCapacity],
    computedAt: Date.now(),
    routeCalls: matrix.calls,
    estimated: matrix.estimated,
  };
}

/**
 * FR-503 편집 뒤 재계산용. 날짜별 순서는 사용자가 정한 그대로 두고 시각만 다시 계산한다.
 * "편집 후 뒤 일정 자동 재계산"이 이 함수다.
 */
export async function recalcDay(trip: Trip, date: string, orderedSpotIds: string[]): Promise<DayPlan> {
  const spots = orderedSpotIds
    .map((id) => trip.spots.find((s) => s.id === id))
    .filter((s): s is Spot => !!s);

  const capacity = toMin(trip.dayEnd) - toMin(trip.dayStart);
  if (spots.length === 0) {
    return { date, items: [], returnMin: 0, usedMin: 0, capacityMin: capacity };
  }

  const points = [trip.base.coord, ...spots.map((s) => s.coord)];
  const matrix = await provider.travelMatrix(points, points, trip.transport);
  const order = spots.map((_, i) => i);
  const { items, returnMin, endMin } = buildTimetable(order, spots, matrix.minutes, trip.dayStart);

  return {
    date,
    items,
    returnMin,
    usedMin: Math.max(0, endMin - toMin(trip.dayStart)),
    capacityMin: capacity,
  };
}

/**
 * FR-503 / FR-603의 조정안. 하루가 활동시간을 넘겼을 때 줄일 방법을 숫자와 함께 제시한다.
 * 제외 1순위는 FR-403과 같은 순서(제안자 적은 순 → 등록 늦은 순)를 따른다.
 */
export function adjustments(day: DayPlan, trip: Trip): Array<{ label: string; savedMin: number }> {
  const over = day.usedMin - day.capacityMin;
  if (over <= 0) return [];

  const out: Array<{ label: string; savedMin: number }> = [];
  const spots = day.items
    .map((item) => trip.spots.find((s) => s.id === item.spotId))
    .filter((s): s is Spot => !!s)
    .filter((s) => !s.pinned)
    .sort((a, b) => {
      if (a.proposerIds.length !== b.proposerIds.length) {
        return a.proposerIds.length - b.proposerIds.length;
      }
      return b.createdAt - a.createdAt;
    });

  const longest = [...spots].sort((a, b) => b.stayMin - a.stayMin)[0];
  if (longest && longest.stayMin > 30) {
    out.push({
      label: `${longest.name} 체류를 ${longest.stayMin - 30}분으로 줄이기`,
      savedMin: 30,
    });
  }

  const first = spots[0];
  if (first) {
    const item = day.items.find((i) => i.spotId === first.id);
    const saved = (item?.stayMin ?? 0) + (item?.travelMin ?? 0);
    out.push({
      label: `${first.name} 빼기 (제안자 ${first.proposerIds.length}명)`,
      savedMin: saved,
    });
  }

  return out;
}
