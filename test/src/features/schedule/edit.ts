import type { DayPlan, OpDraft, Transport, Trip } from '../../types';
import { dateRange, kstDate, toHHMM, toMin } from '../../core/util';
import { liveLegs, STAY_MAX_LIMIT, STAY_MIN_LIMIT } from '../../core/ops/schedule';

/**
 * 10 일정 편집·12 이동수단 화면의 순수 도우미(WP4 소유). 화면은 그리기와 dispatch만 한다.
 * 편집은 누르는 즉시 op로 저장되고(재계산은 스토어가 한다) 되돌리기는 적용 전에 만든 역 op로 한다.
 */

/** 목록에서 index 항목을 앞(-1)이나 뒤(+1)로 한 칸 옮긴 새 목록. 끝이면 그대로 */
export function moveInOrder(ids: readonly string[], index: number, dir: -1 | 1): string[] {
  const j = index + dir;
  if (index < 0 || index >= ids.length || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[index], out[j]] = [out[j], out[index]];
  return out;
}

/** 체류 단계 조절(15분). 리듀서 범위(5~600분) 안으로 자른다 */
export const STAY_STEP = 15;
export function stepStay(stayMin: number, dir: -1 | 1): number {
  return Math.max(STAY_MIN_LIMIT, Math.min(STAY_MAX_LIMIT, stayMin + dir * STAY_STEP));
}

/** 도착 시각 단계 조절(15분). 리듀서가 받는 00:00~23:45 안으로 자른다 */
export const ARRIVE_STEP = 15;
const ARRIVE_MAX_MIN = 23 * 60 + 45;
export function stepArrive(hhmm: string, dir: -1 | 1): string {
  return toHHMM(Math.max(0, Math.min(ARRIVE_MAX_MIN, toMin(hhmm) + dir * ARRIVE_STEP)));
}

/** 이 도착 시각을 그대로 지정할 수 있는지(활동시간을 넘겨 24시 뒤가 된 시각은 안 된다) */
export function canPinArrive(hhmm: string): boolean {
  return toMin(hhmm) < 24 * 60;
}

/**
 * 10 화면이 순서 편집의 기준으로 쓰는 목록. 계획은 디바운스·오프라인 때문에 문서보다 늦게 바뀌므로, 문서의 그날 수동 순서를
 * 먼저 따르고(이미 보낸 reorder가 바로 반영된다) 계획에만 있는 스팟은 계획 순서대로 뒤에 붙인다. 계획에 없는 스팟은 뺀다.
 */
export function editOrder(trip: Trip, day: DayPlan): string[] {
  const inPlan = day.items.map((it) => it.spotId);
  const manual = manualIds(trip, day.date).filter((id) => inPlan.includes(id));
  return [...manual, ...inPlan.filter((id) => !manual.includes(id))];
}

/**
 * 12 '이 구간만' 초안. 구간 지정은 두 스팟이 이웃일 때만 뜻이 있으므로, 그날 지금 순서를 수동 순서로 함께 굳힌다.
 * 그러지 않으면 느린 수단 비용 때문에 정렬기가 두 스팟을 떼어 놓아 지정한 구간이 시간표에서 사라진다.
 */
export function legDrafts(trip: Trip, day: DayPlan, fromId: string, toId: string, transport: Transport | null): OpDraft[] {
  return [
    { type: 'schedule/reorder', date: day.date, spotIds: editOrder(trip, day) },
    { type: 'schedule/setLegTransport', date: day.date, fromId, toId, transport },
  ];
}

/** 그날 수동 순서(스팟 id를 index 순으로). 없으면 빈 목록 */
function manualIds(trip: Trip, date: string): string[] {
  return trip.spots
    .filter((s) => s.manualOrder?.date === date)
    .sort((a, b) => (a.manualOrder?.index ?? 0) - (b.manualOrder?.index ?? 0))
    .map((s) => s.id);
}

/**
 * drafts를 적용하기 전 문서에서 되돌릴 초안을 만든다. 되돌릴 수 없는 초안(빼기 등)이 있으면 null.
 * 초안 단위로 거꾸로다(뒤에 적용한 초안부터 되돌린다). 한 초안의 역 op 묶음 안 순서는 그대로다.
 */
export function inverseDrafts(trip: Trip, drafts: readonly OpDraft[]): OpDraft[] | null {
  const groups: OpDraft[][] = [];
  for (const d of drafts) {
    const out: OpDraft[] = [];
    groups.push(out);
    switch (d.type) {
      case 'schedule/reorder':
        out.push({ type: 'schedule/reorder', date: d.date, spotIds: manualIds(trip, d.date) });
        break;
      case 'schedule/setStay': {
        const s = trip.spots.find((x) => x.id === d.spotId);
        if (!s) return null;
        out.push({ type: 'schedule/setStay', spotId: s.id, stayMin: s.stayMin });
        break;
      }
      case 'schedule/setArrive': {
        const s = trip.spots.find((x) => x.id === d.spotId);
        if (!s) return null;
        out.push({ type: 'schedule/setArrive', spotId: s.id, arrive: s.arriveOverride ?? null });
        break;
      }
      case 'schedule/setDate': {
        const s = trip.spots.find((x) => x.id === d.spotId);
        if (!s) return null;
        out.push({ type: 'schedule/setDate', spotId: s.id, date: s.fixedDate ?? null });
        // setDate는 다른 날짜의 수동 순서를 해제한다. 원래 수동 순서가 있던 날은 그 순서로 되돌린다
        if (s.manualOrder) out.push({ type: 'schedule/reorder', date: s.manualOrder.date, spotIds: manualIds(trip, s.manualOrder.date) });
        break;
      }
      case 'spot/pin': {
        const s = trip.spots.find((x) => x.id === d.spotId);
        if (!s) return null;
        out.push({ type: 'spot/pin', spotId: s.id, pinned: s.pinned });
        break;
      }
      case 'schedule/setLegTransport': {
        const prev = liveLegs(trip.legs).find((l) => l.date === d.date && l.fromId === d.fromId && l.toId === d.toId);
        out.push({ type: 'schedule/setLegTransport', date: d.date, fromId: d.fromId, toId: d.toId, transport: prev?.transport ?? null });
        break;
      }
      case 'schedule/setDayTransport': {
        const prev = trip.days.find((x) => x.date === d.date)?.transport;
        out.push({ type: 'schedule/setDayTransport', date: d.date, transport: prev ?? null });
        break;
      }
      default:
        return null;
    }
  }
  return groups.reverse().flat();
}

/** 하루 전체 수단 적용 초안: 날짜 수단을 바꾸고 그날 구간 지정을 푼다(구간 지정이 날짜 수단보다 앞서므로) */
export function dayTransportDrafts(trip: Trip, date: string, transport: DayPlan['items'][number]['legTransport']): OpDraft[] {
  const drafts: OpDraft[] = [{ type: 'schedule/setDayTransport', date, transport }];
  for (const l of liveLegs(trip.legs)) {
    if (l.date === date) drafts.push({ type: 'schedule/setLegTransport', date, fromId: l.fromId, toId: l.toId, transport: null });
  }
  return drafts;
}

/** 그날 유효한 구간 번호 목록(0은 기점에서 첫 스팟, items.length는 복귀). 기점 없는 날은 0이 없다 */
export function legIndexes(day: DayPlan): number[] {
  const n = day.items.length;
  if (n === 0) return [];
  const hasBase = day.baseSource !== 'firstSpot' && !!day.base;
  const out: number[] = [];
  if (hasBase) out.push(0);
  for (let i = 1; i < n; i += 1) out.push(i);
  if (hasBase && !day.noReturn) out.push(n);
  return out;
}

/** '구간 2 / 6' */
export function legPositionText(day: DayPlan, legIndex: number): string {
  const all = legIndexes(day);
  const at = all.indexOf(legIndex);
  return at < 0 ? '' : `구간 ${at + 1} / ${all.length}`;
}

/** 시간표 탭이 처음 보여줄 날짜: 요청 날짜 → 오늘(여행 기간 안이면) → 첫날 */
export function initialScheduleDate(trip: Pick<Trip, 'startDate' | 'endDate'>, now: number, wanted?: string): string {
  const dates = dateRange(trip.startDate, trip.endDate);
  if (wanted && dates.includes(wanted)) return wanted;
  const today = kstDate(now);
  return dates.includes(today) ? today : dates[0] ?? trip.startDate;
}
