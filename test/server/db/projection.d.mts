/**
 * projection.mjs의 타입 선언(WP2 소유). 조회용 표 한 방 분량. 없는 값은 null이다.
 */

export interface InviteView {
  code: string;
  issuedAt: number | null;
  expiresAt: number | null;
  capacity: number | null;
  revokedAt: number | null;
}

export interface TripView {
  title: string | null;
  region: string | null;
  startDate: string | null;
  endDate: string | null;
  transport: string | null;
  dayStart: string | null;
  dayEnd: string | null;
  createdBy: string | null;
  createdAt: number | null;
  deletedAt: number | null;
  invite: InviteView | null;
}

export interface SpotView {
  id: string;
  placeId: string;
  name: string;
  category: string | null;
  kind: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  pinned: boolean;
  stayMin: number | null;
  fixedDate: string | null;
  manualDate: string | null;
  manualIndex: number | null;
  arriveOverride: string | null;
  removed: boolean;
  removedReason: string | null;
  /** 이 후보를 제안한 채팅 메시지 */
  messageIds: string[];
  /** 메시지에 묶이지 않은 제안이 있는지 */
  manual: boolean;
  createdAt: number | null;
  edited: Record<string, number>;
}

export interface DayView {
  date: string;
  baseMode: 'set' | 'firstSpot' | 'inherit';
  baseName: string | null;
  baseLat: number | null;
  baseLng: number | null;
  basePlaceId: string | null;
  noReturn: boolean;
  dayStart: string | null;
  dayEnd: string | null;
  transport: string | null;
  edited: Record<string, number>;
}

export interface LegView {
  date: string;
  fromId: string;
  toId: string;
  transport: string;
  at: number | null;
  cleared: boolean;
}

export interface TripViewState {
  trip: TripView | null;
  spots: Map<string, SpotView>;
  days: Map<string, DayView>;
  legs: Map<string, LegView>;
  /** 계산 전용: 방장 멤버 id(기간을 바꾸는 trip/update·방 삭제를 받는다) */
  hosts: Set<string>;
  /** 계산 전용: 메시지 id → 모호 항목(phrase) → 골랐는지 */
  picks: Map<string, Map<string, boolean>>;
}

export function emptyView(): TripViewState;
export function legKey(date: string, fromId: string, toId: string): string;
export function applyToView(view: TripViewState, op: unknown): TripViewState;
export function projectOps(ops: readonly unknown[], view?: TripViewState): TripViewState;
