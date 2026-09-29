import type { DayField, DaySetting, Spot, SpotField, Trip } from '../../types';

/**
 * 필드별 나중 저장 우선(FR-503·703). 판정 시각은 op.at(저장한 시점)이다.
 * 오프라인 편집이 늦게 도착해도 저장 시점 기준으로 이긴다. 같은 at이면 뒤에 접힌 쪽을 적용한다.
 * schedule/*, spot/pin·remove·restore, trip/setDay, schedule/setDayTransport는 patchSpot·patchDay만 쓴다.
 */

export function lww(prevAt: number | undefined, at: number): boolean {
  return prevAt === undefined || at >= prevAt;
}

/** removedReason은 removedByUser와 한 묶음이라 같은 edited 키를 쓴다. */
export type SpotPatch = Partial<Pick<Spot, SpotField | 'removedReason'>>;

const SPOT_EDIT_KEY: Record<keyof SpotPatch, SpotField> = {
  pinned: 'pinned',
  stayMin: 'stayMin',
  fixedDate: 'fixedDate',
  manualOrder: 'manualOrder',
  arriveOverride: 'arriveOverride',
  removedByUser: 'removedByUser',
  removedReason: 'removedByUser',
};

/** 값이 undefined인 필드는 지운다(예: 날짜 지정 해제). */
export function patchSpot(spot: Spot, patch: SpotPatch, at: number): Spot {
  const next: Spot = { ...spot, edited: { ...spot.edited } };
  const touched = new Set<SpotField>();
  for (const k of Object.keys(patch) as (keyof SpotPatch)[]) {
    const key = SPOT_EDIT_KEY[k];
    if (!lww(spot.edited[key], at)) continue;
    const value = patch[k];
    if (value === undefined) delete (next as Partial<Spot>)[k];
    else (next as unknown as Record<string, unknown>)[k] = value;
    touched.add(key);
  }
  for (const key of touched) next.edited[key] = at;
  return next;
}

export type DayPatchAll = Partial<Pick<DaySetting, DayField>>;

/** 날짜 설정이 없으면 기본값(직전 날짜 기점 승계, 복귀 있음)으로 만든 뒤 고친다. */
export function patchDay(trip: Trip, date: string, patch: DayPatchAll, at: number): Trip {
  const idx = trip.days.findIndex((d) => d.date === date);
  const prev: DaySetting = idx >= 0 ? trip.days[idx] : { date, base: 'inherit', noReturn: false };
  const next: DaySetting = { ...prev, edited: { ...(prev.edited ?? {}) } };
  const edited = next.edited as Partial<Record<DayField, number>>;
  let changed = false;
  for (const k of Object.keys(patch) as DayField[]) {
    if (!lww(prev.edited?.[k], at)) continue;
    const value = patch[k];
    if (value === undefined) delete (next as Partial<DaySetting>)[k];
    else (next as unknown as Record<string, unknown>)[k] = value;
    edited[k] = at;
    changed = true;
  }
  if (!changed) return trip;
  const days = [...trip.days];
  if (idx >= 0) days[idx] = next;
  else {
    days.push(next);
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return { ...trip, days };
}
