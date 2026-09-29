import type { ExcludedSpot, Plan, Spot, TimetableItem, Trip } from '../../types';
import { DAYPART_EVENING, DAYPART_NOON } from '../../core/constants';
import { priorityCompare, proposerCount } from '../../core/spotUtil';
import { dayShort, humanMin, toMin } from '../../core/util';

/**
 * 06 후보 · 자동 선별 화면의 행 계산(WP3 소유, 순수). 화면은 이 결과만 그린다.
 *
 * - 확정 스팟: 계획(Plan)에서 어느 날에 배치된 후보. 우선순위(제안자 수 많은 순, 동점이면 등록 이른 순)로 둔다.
 *   부가 줄은 '종류 · 체류 N분 · 10/18 오전'이고, 고정 스팟은 시간대 대신 배치 시각을 적는다.
 * - 제외 스팟: plan.excluded. 사용자가 직접 뺀 후보인데 계획이 아직 모르면(재계산 전) '사용자가 직접 뺌'으로 채운다.
 *   조용한 제외는 없다. 모든 제외 행은 사유 문장을 가진다.
 * - 배치 전: 계획이 없거나 아직 계산되지 않은 후보. '계산 중'으로 보여주고 확정·제외 어느 쪽에도 넣지 않는다.
 */

export interface ConfirmedRow {
  spotId: string;
  name: string;
  sub: string;
  proposerCount: number;
  pinned: boolean;
  outsideRegion: boolean;
  date: string;
  arrive: string;
}

export interface ExcludedRow {
  spotId: string;
  name: string;
  sub: string;
  reason: string;
  reasonCode: ExcludedSpot['reasonCode'];
  proposerCount: number;
}

export interface PendingRow {
  spotId: string;
  name: string;
  sub: string;
  proposerCount: number;
  pinned: boolean;
}

export interface CandidateView {
  total: number;
  confirmed: ConfirmedRow[];
  excluded: ExcludedRow[];
  pending: PendingRow[];
  /** 자동으로 빠진 수(사용자가 뺀 것 제외) */
  autoExcluded: number;
  /** 그중 하루 수용량 초과(dayFull)로 빠진 수 */
  capacityExcluded: number;
  /** 그중 거리(tooFar)·기간(outOfPeriod) 때문에 빠진 수 */
  otherExcluded: number;
  overCapacity: { date: string; overMin: number; title: string; text: string }[];
}

/** 'HH:MM' → 오전/오후/저녁(경계 12:00·18:00) */
export function daypart(hhmm: string): '오전' | '오후' | '저녁' {
  const m = toMin(hhmm);
  if (m < toMin(DAYPART_NOON)) return '오전';
  if (m < toMin(DAYPART_EVENING)) return '오후';
  return '저녁';
}

export function kindLabel(spot: Pick<Spot, 'kind' | 'category'>): string {
  return spot.kind ?? spot.category;
}

/** spotId → 배치된 날짜와 시간표 항목 */
export function placementOf(plan: Plan | undefined): Map<string, { date: string; item: TimetableItem }> {
  const out = new Map<string, { date: string; item: TimetableItem }>();
  for (const d of plan?.days ?? []) for (const item of d.items) out.set(item.spotId, { date: d.date, item });
  return out;
}

export function placementText(date: string, arrive: string, pinned: boolean): string {
  return pinned ? `${dayShort(date)} ${arrive}` : `${dayShort(date)} ${daypart(arrive)}`;
}

export function candidateView(trip: Trip, plan: Plan | undefined): CandidateView {
  const placed = placementOf(plan);
  const excludedById = new Map((plan?.excluded ?? []).map((e) => [e.spotId, e]));
  const spots = [...trip.spots].sort(priorityCompare);
  const confirmed: ConfirmedRow[] = [];
  const excluded: ExcludedRow[] = [];
  const pending: PendingRow[] = [];
  for (const s of spots) {
    const count = proposerCount(s);
    const base = `${kindLabel(s)} · 체류 ${s.stayMin}분`;
    const ex = excludedById.get(s.id);
    const at = placed.get(s.id);
    if (ex || s.removedByUser) {
      const reason = ex?.reason ?? (s.removedReason === 'delay' ? '지연 조정안으로 뺌' : '사용자가 직접 뺌');
      excluded.push({
        spotId: s.id,
        name: s.name,
        sub: `${reason} · 제안자 ${count}`,
        reason,
        reasonCode: ex?.reasonCode ?? 'userRemoved',
        proposerCount: count,
      });
      continue;
    }
    if (at) {
      confirmed.push({
        spotId: s.id,
        name: s.name,
        sub: `${base} · ${placementText(at.date, at.item.arrive, s.pinned)}`,
        proposerCount: count,
        pinned: s.pinned,
        outsideRegion: !!s.outsideRegion,
        date: at.date,
        arrive: at.item.arrive,
      });
      continue;
    }
    pending.push({ spotId: s.id, name: s.name, sub: `${base} · 배치 계산 전`, proposerCount: count, pinned: s.pinned });
  }
  return {
    total: trip.spots.length,
    confirmed,
    excluded,
    pending,
    autoExcluded: excluded.filter((e) => e.reasonCode !== 'userRemoved').length,
    capacityExcluded: excluded.filter((e) => e.reasonCode === 'dayFull').length,
    otherExcluded: excluded.filter((e) => e.reasonCode === 'tooFar' || e.reasonCode === 'outOfPeriod').length,
    overCapacity: (plan?.overCapacity ?? []).map((o) => ({
      ...o,
      title: `${dayShort(o.date)} 수용량 초과`,
      text: `${dayShort(o.date)} 고정 스팟만으로 수용량을 ${humanMin(o.overMin)} 넘습니다`,
    })),
  };
}

/** 06 머리말 보조 줄 */
export function headline(v: CandidateView): string {
  if (v.total === 0) return '채팅에서 장소를 말하거나 검색해서 담으면 여기에 쌓입니다.';
  if (v.pending.length > 0 && v.confirmed.length === 0 && v.excluded.length === 0) return '루트를 계산하면 확정 스팟과 제외 스팟이 나뉩니다.';
  // 사유별로 나눠 적는다. 거리·기간 때문에 빠진 곳을 '수용량 초과'로 적지 않는다.
  const cap = v.capacityExcluded;
  const other = v.otherExcluded;
  if (cap > 0 && other > 0) return `하루 수용량을 넘는 ${cap}곳, 거리·기간 때문에 ${other}곳이 자동으로 빠졌습니다.`;
  if (cap > 0) return `하루 수용량을 넘는 ${cap}곳만 자동으로 빠졌습니다.`;
  if (other > 0) return `거리·기간 때문에 ${other}곳이 자동으로 빠졌습니다.`;
  return '하루 수용량 안에 모든 후보가 들어갔습니다.';
}
