import type { DayPlan, ItemNotice, Transport, Visit } from '../../types';
import { returnLegOf } from '../../core/planner/day';
import { toHHMM, toMin } from '../../core/util';

/**
 * 09 시간표 행 계산(WP4 소유, 순수). 기점 출발 → (이동 → 스팟)… → 이동 → 기점 복귀.
 * 이동 구간은 카드가 아니라 Leg 줄(아이콘+분)이다. 시각은 52px 고정 폭 열에 둔다.
 * - 기점이 없는 날(첫 스팟 기점)은 출발 행이 첫 스팟 이름이고, 첫 이동 줄이 없다
 * - 복귀 없음 날은 복귀 대신 '여기서 일정 끝' 행을 둔다
 * - 활동시간을 넘는 스팟은 carryOver(다음 날 이월 제안)로 표시한다
 * - 방문 상태(19 여행 진행)는 visitStatus로 받는다
 * - 복귀 줄의 수단·추정과 복귀 행의 대체 안내는 계획의 복귀 구간 값(returnLegOf)을 쓴다. 없으면(예전 계획) 마지막 도착 구간 값
 */

export type TimelineRow =
  | { kind: 'base'; key: string; time: string; title: string; sub: string }
  | { kind: 'leg'; key: string; transport: Transport; minutes: number; estimated: boolean; toSpotId?: string; legIndex: number }
  | {
      kind: 'spot';
      key: string;
      spotId: string;
      index: number;
      time: string;
      depart: string;
      title: string;
      stayMin: number;
      pinned: boolean;
      proposerCount: number;
      manual: boolean;
      carryOver: boolean;
      notices: ItemNotice[];
      status?: Visit['status'];
    }
  | { kind: 'return'; key: string; time: string; title: string; sub: string; notices: ItemNotice[] }
  | { kind: 'end'; key: string; time: string; title: string };

export function baseSub(day: DayPlan): string {
  if (day.baseSource === 'firstSpot') return '기점 없음 · 첫 스팟에서 시작';
  if (day.baseSource === 'inherited') return '기점 · 출발 · 직전 날짜와 같음';
  return '기점 · 출발';
}

export function timelineRows(day: DayPlan, visitStatus?: Record<string, Visit['status']>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const noBase = day.baseSource === 'firstSpot';
  if (!noBase || day.items.length === 0) {
    rows.push({
      kind: 'base',
      key: 'base-start',
      time: toHHMM(day.startMin),
      title: day.base?.name ?? '기점 없음',
      sub: baseSub(day),
    });
  }
  const carry = new Set(day.carryOver);
  day.items.forEach((it, i) => {
    if (!(noBase && i === 0)) {
      rows.push({
        kind: 'leg',
        key: `leg-${it.spotId}`,
        transport: it.legTransport,
        minutes: it.travelMin,
        estimated: it.legEstimated,
        toSpotId: it.spotId,
        legIndex: i,
      });
    }
    rows.push({
      kind: 'spot',
      key: `spot-${it.spotId}`,
      spotId: it.spotId,
      index: i,
      time: it.arrive,
      depart: it.depart,
      title: it.name,
      stayMin: it.stayMin,
      pinned: it.pinned,
      proposerCount: it.proposerCount,
      manual: it.manual,
      carryOver: carry.has(it.spotId),
      notices: it.notices,
      status: visitStatus?.[it.spotId],
    });
  });
  const last = day.items[day.items.length - 1];
  if (!last) return rows;
  if (!day.noReturn && day.base) {
    const ret = returnLegOf(day);
    rows.push({
      kind: 'leg',
      key: 'leg-return',
      transport: ret?.transport ?? last.legTransport,
      minutes: day.returnMin,
      estimated: ret?.estimated ?? last.legEstimated,
      legIndex: day.items.length,
    });
    rows.push({
      kind: 'return',
      key: 'base-return',
      time: toHHMM(toMin(last.depart) + day.returnMin),
      title: `${day.base.name} 복귀`,
      sub: '기점 · 복귀',
      notices: ret?.notices ?? [],
    });
  } else {
    rows.push({ kind: 'end', key: 'day-end', time: last.depart, title: '여기서 일정 끝 · 복귀 없음' });
  }
  return rows;
}

/** 이동수단 아이콘 이름 */
export function transportIcon(t: Transport): 'car' | 'walk' | 'bus' {
  return t === 'walk' ? 'walk' : t === 'transit' ? 'bus' : 'car';
}
