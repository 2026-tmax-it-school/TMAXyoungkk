import type { Category, DayPlan, ItemNotice, Spot, Transport, Visit } from '../../types';
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
 * - 스팟 행은 시각 열 두 줄(도착 time, 떠나는 depart)과 보조 줄 '관광지 · 체류 90분'(spotSubLine)을 그린다.
 *   카테고리는 계획 항목에 없어 문서의 스팟(spots)에서 찾는다. 스팟을 못 찾으면 카테고리 없이 '체류 90분'만 적는다
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
      /** 문서 스팟의 카테고리. spots를 넘기지 않았거나 스팟이 없으면 없다 */
      category?: Category;
      /** 문서 스팟의 세부 분류(카카오 'kind', 예: '절,사찰'). 있으면 보조 줄은 후보 목록과 같은 이 이름을 쓴다(2026-10-22) */
      place?: string;
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

export function timelineRows(
  day: DayPlan,
  visitStatus?: Record<string, Visit['status']>,
  spots?: readonly (Pick<Spot, 'id' | 'category'> & Partial<Pick<Spot, 'kind'>>)[],
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const categoryOf = new Map((spots ?? []).map((s) => [s.id, s.category]));
  const kindOf = new Map((spots ?? []).map((s) => [s.id, s.kind]));
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
      category: categoryOf.get(it.spotId),
      place: kindOf.get(it.spotId),
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

/** 스팟 카드 보조 줄 '관광지 · 체류 90분'(카테고리가 없으면 '체류 90분') */
/**
 * 보조 줄 '절·사찰 · 체류 90분'. 장소 분류는 후보 목록(candidates/rows.kindLabel)과 같은 규칙이다
 * (2026-10-22 셀프 QA: 후보는 '절,사찰', 시간표는 모두 '관광지'였다).
 */
export function spotSubLine(row: { category?: Category; place?: string; stayMin: number }): string {
  const stay = `체류 ${row.stayMin}분`;
  const label = placeLabel(row.place, row.category);
  return label ? `${label} · ${stay}` : stay;
}

/** 세부 분류가 있으면 그것('절,사찰' → '절·사찰'), 없으면 카테고리. 둘 다 없으면 빈 문자열 */
export function placeLabel(kind: string | undefined, category: string | undefined): string {
  const k = (kind ?? '').trim();
  return k ? k.replace(/\s*,\s*/g, '·') : (category ?? '');
}

/** 이동수단 아이콘 이름 */
export function transportIcon(t: Transport): 'car' | 'walk' | 'bus' {
  return t === 'walk' ? 'walk' : t === 'transit' ? 'bus' : 'car';
}
