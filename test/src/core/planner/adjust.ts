import type { Adjustment, DayPlan, Plan, Spot, Trip } from '../../types';
import { priorityCompare } from '../spotUtil';
import { dayShort, humanMin, josa, toHHMM } from '../util';

/**
 * 수용량 초과 조정안(FR-503, 10 화면, WP4 소유, 순수). 막지 않고 숫자로 보여준다.
 * 체류 줄이기 → 다음 날로 옮기기 → 빼기 순서다. 라벨은 목업 10 문구('대릉원 체류를 60분으로', '석굴암을 10/19로 옮김')이고
 * 줄어드는 분은 오른쪽 값(-30분)이 따로 보여준다. 고정 스팟은 옮기거나 빼지 않는다(체류 줄이기는 된다).
 * savedMin은 지금 시간표 기준 어림이다(옮기거나 빼면 그 스팟의 이동+체류만큼). 정확한 결과는 previewOps로 본다.
 */

/** 체류를 이보다 짧게 줄이자고 하지 않는다 */
export const MIN_SUGGESTED_STAY = 30;

function spotOf(trip: Trip, id: string): Spot | undefined {
  return trip.spots.find((s) => s.id === id);
}

export function overflowAdjustments(trip: Trip, plan: Plan, date: string): Adjustment[] {
  const day = plan.days.find((d) => d.date === date);
  if (!day || day.overMin <= 0) return [];
  const over = day.overMin;
  const out: Adjustment[] = [];
  const items = day.items.map((it) => ({ it, spot: spotOf(trip, it.spotId) })).filter((x) => x.spot) as {
    it: DayPlan['items'][number];
    spot: Spot;
  }[];

  // 1. 체류 줄이기: 가장 긴 체류부터
  const byStay = [...items].sort((a, b) => b.it.stayMin - a.it.stayMin);
  for (const { it } of byStay.slice(0, 2)) {
    const cut = Math.min(over, it.stayMin - MIN_SUGGESTED_STAY);
    if (cut <= 0) continue;
    const next = it.stayMin - cut;
    out.push({
      id: `adj-stay-${it.spotId}`,
      kind: 'shortenStay',
      label: `${josa(`${it.name} 체류`, '을/를')} ${next}분으로`,
      savedMin: cut,
      ops: [{ type: 'schedule/setStay', spotId: it.spotId, stayMin: next }],
    });
  }

  // 2. 다음 날로 옮기기: 남는 시간이 그 스팟 체류보다 큰 날
  const movable = items.filter(({ spot }) => !spot.pinned).sort((a, b) => priorityCompare(b.spot, a.spot));
  const others = plan.days.filter((d) => d.date !== date && d.date > date);
  const earlier = plan.days.filter((d) => d.date !== date && d.date < date);
  for (const { it } of movable) {
    const target = [...others, ...earlier].find((d) => d.capacityMin - d.usedMin >= it.stayMin + it.travelMin);
    if (!target) continue;
    out.push({
      id: `adj-move-${it.spotId}`,
      kind: 'moveToDate',
      label: `${josa(it.name, '을/를')} ${josa(dayShort(target.date), '으로/로')} 옮김`,
      savedMin: it.stayMin + it.travelMin,
      ops: [{ type: 'schedule/setDate', spotId: it.spotId, date: target.date }],
    });
    break;
  }

  // 3. 빼기: FR-403 순서(제안자 적은 순, 등록 늦은 순)의 첫 비고정 스팟
  const first = movable[0];
  if (first) {
    out.push({
      id: `adj-exclude-${first.it.spotId}`,
      kind: 'exclude',
      label: `${first.it.name} 빼기`,
      savedMin: first.it.stayMin + first.it.travelMin,
      ops: [{ type: 'spot/remove', spotId: first.it.spotId, reason: 'user' }],
    });
  }
  return out;
}

/** 초과 요약 문장 */
export function overflowText(day: DayPlan): string {
  const end = day.startMin + day.usedMin;
  return `${toHHMM(end)}에 끝나 활동시간(${toHHMM(day.endLimitMin)}까지)을 ${humanMin(day.overMin)} 넘습니다`;
}
