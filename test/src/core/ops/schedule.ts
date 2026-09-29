import type { LegOverride, Op, OpOf, Spot, Transport, Trip } from '../../types';
import { dateRange } from '../util';
import { lww, patchDay, patchSpot } from './lww';

/**
 * schedule/* 리듀서(WP4 소유, 순수). FR-503 일정 수동 편집과 FR-504 이동수단.
 * 값은 전부 스팟과 날짜 설정에 저장한다(plan은 동기화하지 않고 기기마다 다시 계산한다). 그래서 다른 op로
 * 재계산해도 사용자 순서·체류·도착 시각·날짜가 남는다(1단계의 편집 소실 결함 회귀 방지).
 * 필드 충돌은 공유 patchSpot·patchDay가 op.at으로 판정한다(나중 저장 우선).
 *
 * - reorder{date,spotIds}: 목록 순서대로 manualOrder{date,index}. 그날 수동 순서였는데 목록에서 빠진 스팟은 해제
 * - setStay: stayMin
 * - setArrive: arriveOverride(null이면 해제)
 * - setDate: fixedDate(null이면 해제). 다른 날짜로 옮기면 원래 날짜의 수동 순서는 함께 해제한다
 * - setDayTransport: 날짜 설정 transport(null이면 여행방 기본 수단)
 * - setLegTransport: 구간별 수단(null이면 해제). legs는 같은 구간 하나만 둔다. 구간마다 마지막 편집 시각(at)을 두고
 *   op.at이 그보다 이르면 무시한다(나중 저장 우선). 해제도 cleared 묘비로 남긴다. 그래야 늦게 도착한 예전 지정이
 *   나중 해제를 이기지 못한다. 읽는 쪽은 liveLegs()로 묘비를 거른다.
 */

/**
 * 구간 지정 항목. at·cleared는 통합 때 공유 LegOverride 타입에 들어갔다. 이 이름은 호환용 별칭이다.
 * cleared면 transport는 해제 전 값이고 계산에 쓰지 않는다.
 */
export type LegEntry = LegOverride;

/** 계산에 쓰는 구간 지정(묘비 제외) */
export function liveLegs(legs: readonly LegOverride[]): LegOverride[] {
  return legs.filter((l) => !l.cleared);
}

function setLeg(doc: Trip, op: OpOf<'schedule/setLegTransport'>): Trip {
  const same = (l: LegOverride) => l.date === op.date && l.fromId === op.fromId && l.toId === op.toId;
  const prev = doc.legs.find(same);
  if (prev && !lww(prev.at, op.at)) return doc;
  const legs = doc.legs.filter((l) => !same(l));
  const entry: LegEntry = op.transport
    ? { date: op.date, fromId: op.fromId, toId: op.toId, transport: op.transport, at: op.at }
    : { date: op.date, fromId: op.fromId, toId: op.toId, transport: prev?.transport ?? 'car', at: op.at, cleared: true };
  legs.push(entry);
  return { ...doc, legs };
}

const TRANSPORTS: readonly Transport[] = ['car', 'walk', 'transit'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const STAY_MIN_LIMIT = 5;
export const STAY_MAX_LIMIT = 600;

function mapSpot(doc: Trip, id: string, f: (s: Spot) => Spot): Trip {
  let changed = false;
  const spots = doc.spots.map((s) => {
    if (s.id !== id) return s;
    const next = f(s);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...doc, spots } : doc;
}

function reorder(doc: Trip, op: OpOf<'schedule/reorder'>): Trip {
  const index = new Map(op.spotIds.map((id, i) => [id, i]));
  const spots = doc.spots.map((s) => {
    const i = index.get(s.id);
    if (i !== undefined) return patchSpot(s, { manualOrder: { date: op.date, index: i } }, op.at);
    if (s.manualOrder?.date === op.date) return patchSpot(s, { manualOrder: undefined }, op.at);
    return s;
  });
  return { ...doc, spots };
}

export function reduce(doc: Trip, op: Op): Trip {
  switch (op.type) {
    case 'schedule/reorder':
      return reorder(doc, op);
    case 'schedule/setStay':
      return mapSpot(doc, op.spotId, (s) => patchSpot(s, { stayMin: op.stayMin }, op.at));
    case 'schedule/setArrive':
      return mapSpot(doc, op.spotId, (s) => patchSpot(s, { arriveOverride: op.arrive ?? undefined }, op.at));
    case 'schedule/setDate':
      return mapSpot(doc, op.spotId, (s) => {
        // 날짜 지정 해제(null)는 수동 순서를 건드리지 않는다. 다른 날짜로 옮길 때만 그 순서를 푼다
        const moved = op.date !== null && s.manualOrder && s.manualOrder.date !== op.date;
        return patchSpot(
          s,
          moved ? { fixedDate: op.date ?? undefined, manualOrder: undefined } : { fixedDate: op.date ?? undefined },
          op.at,
        );
      });
    case 'schedule/setDayTransport':
      return patchDay(doc, op.date, { transport: op.transport ?? undefined }, op.at);
    case 'schedule/setLegTransport':
      return setLeg(doc, op);
    default:
      return doc;
  }
}

export function validate(doc: Trip, op: Op): string | null {
  const dates = dateRange(doc.startDate, doc.endDate);
  const hasSpot = (id: string) => doc.spots.some((s) => s.id === id);
  switch (op.type) {
    case 'schedule/reorder': {
      if (!dates.includes(op.date)) return '여행 기간 밖의 날짜입니다';
      if (new Set(op.spotIds).size !== op.spotIds.length) return '같은 스팟이 두 번 들어 있습니다';
      if (!op.spotIds.every(hasSpot)) return '없는 스팟이 들어 있습니다';
      return null;
    }
    case 'schedule/setStay':
      if (!hasSpot(op.spotId)) return '스팟을 찾을 수 없습니다';
      if (!Number.isInteger(op.stayMin) || op.stayMin < STAY_MIN_LIMIT || op.stayMin > STAY_MAX_LIMIT) {
        return `체류 시간은 ${STAY_MIN_LIMIT}분에서 ${STAY_MAX_LIMIT}분 사이로 정합니다`;
      }
      return null;
    case 'schedule/setArrive':
      if (!hasSpot(op.spotId)) return '스팟을 찾을 수 없습니다';
      if (op.arrive !== null && !HHMM.test(op.arrive)) return '도착 시각은 HH:MM으로 적습니다';
      return null;
    case 'schedule/setDate':
      if (!hasSpot(op.spotId)) return '스팟을 찾을 수 없습니다';
      if (op.date !== null && !dates.includes(op.date)) return '여행 기간 안의 날짜만 고를 수 있습니다';
      return null;
    case 'schedule/setDayTransport':
      if (!dates.includes(op.date)) return '여행 기간 밖의 날짜입니다';
      if (op.transport !== null && !TRANSPORTS.includes(op.transport)) return '알 수 없는 이동수단입니다';
      return null;
    case 'schedule/setLegTransport': {
      if (!dates.includes(op.date)) return '여행 기간 밖의 날짜입니다';
      const ok = (id: string) => id === 'base' || hasSpot(id);
      if (!ok(op.fromId) || !ok(op.toId) || op.fromId === op.toId) return '구간을 찾을 수 없습니다';
      if (op.transport !== null && !TRANSPORTS.includes(op.transport)) return '알 수 없는 이동수단입니다';
      return null;
    }
    default:
      return null;
  }
}
