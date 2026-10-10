import type { Adjustment, LatLng, Transport } from '../../types';
import { DELAY_THRESHOLD_MIN, DETOUR_FACTOR, FALLBACK_SPEED_KMH, FREE_TIME_MIN } from '../constants';
import { legGeometryKey } from '../map/model';
import { haversineKm } from '../util';
import { nextIndex, type ArrivalTracker } from './arrival';
import { minuteOfDay, type LiveDay } from './context';
import { legPathFor, progressOnPath, type LegAlong } from './legPath';

/**
 * 지연 감지(FR-603, WP5 소유, 순수). ETA 지연 계산과 15분 경계는 여기 하나뿐이다(03 회의 C3).
 * 조정안 생성은 인자로 주입받는다(앱은 WP4 replanForDelay, 테스트는 가짜).
 *
 * ETA 규칙
 * - 스팟에 도착해 머무는 중이면: 떠나는 시각 = max(지금, 그 스팟 예정 출발) → ETA = 그 시각 + 다음 구간 예정 이동 시간.
 *   예정 출발 전이면 남은 체류를 줄여 맞출 수 있다고 보고 지연으로 치지 않는다.
 * - 이동 중이면: ETA = 지금 + 현재 위치에서 다음 스팟까지 추정 이동 시간.
 *   그 구간 길 모양(지도 선과 같은 키·모양, 스토어가 경로 조회로 받은 것)을 알고 지금 위치가 그 길 위면
 *   예정 이동 시간 × (1 - 길 위 진행 비율)이다. 모르거나 길에서 멀면 직선 남은 거리 비율로 잰다.
 *   길이 크게 돌아가는 구간(처음 12km를 옆으로 가는 길)에서 직선 비율은 길을 따라 제때 가는 중에도 지연으로 본다.
 * - 위치를 모르면(수동 진행): ETA = max(지금, 직전 예정 출발) + 예정 이동 시간.
 * 빈 시간(FR-604)은 이동 중일 때만 본다: 예정 도착 - ETA가 30분 이상이면 빈 시간이다.
 */

/** 예정 도착(분)과 ETA(분)로 지연(분). 앞서면 0이다. 내림이라 14.9분은 14분이다(15분 경계, 빈 시간 gapMin과 같은 처리). */
export function delayMinutes(plannedArriveMin: number, etaMin: number): number {
  // 부동소수 오차(15.0이 14.9999…)로 경계를 놓치지 않게 아주 작은 값을 더한다.
  return Math.max(0, Math.floor(etaMin - plannedArriveMin + 1e-6));
}

export function isDelayed(delayMin: number): boolean {
  return delayMin >= DELAY_THRESHOLD_MIN;
}

export type MakeAdjustments = (delayMin: number) => Promise<Adjustment[]>;

/** 지연이 경계 이상이면 조정안을 만든다. 아니면 null(조정안 시트를 띄우지 않는다). */
export async function proposeForDelay(delayMin: number, make: MakeAdjustments): Promise<Adjustment[] | null> {
  if (!isDelayed(delayMin)) return null;
  return make(delayMin);
}

/** 직선거리로 이동 시간(분) 추정. 경로 API 없이 도는 기본값이다. */
export function straightTravelMin(a: LatLng, b: LatLng, transport: Transport): number {
  const km = haversineKm(a, b) * DETOUR_FACTOR[transport];
  return (km / FALLBACK_SPEED_KMH[transport]) * 60;
}

/**
 * 현재 위치 → 다음 스팟 추정 이동 시간(직선). 예정 구간(legFrom → to, planned분)이 있으면 남은 거리 비율로 줄이고,
 * 구간이 너무 짧거나 모르면 직선거리 속도로 잰다. 길 모양을 알면 evaluateTiming이 길 위 진행 비율을 먼저 쓴다.
 */
export function remainingTravelMin(
  pos: LatLng,
  to: LatLng,
  transport: Transport,
  planned?: { from: LatLng; minutes: number },
): number {
  if (planned) {
    const full = haversineKm(planned.from, to);
    if (full > 0.05) {
      const ratio = Math.min(1.5, haversineKm(pos, to) / full);
      return planned.minutes * ratio;
    }
  }
  return straightTravelMin(pos, to, transport);
}

export interface Timing {
  nextIdx: number;
  spotId: string;
  name: string;
  phase: 'atSpot' | 'moving';
  plannedArriveMin: number;
  etaMin: number;
  delayMin: number;
  /** 이동 중에만 의미가 있다. 예정 도착 - ETA(분) */
  gapMin: number;
  /** 직전 스팟을 떠났는지(빈 시간 판정 조건) */
  betweenSpots: boolean;
  /** 이동 중 지금 구간 길 위 진행. 길 모양을 알 때만 있다. 다음 판정과 이어서 만들기가 겹친 길에서 뒤로 붙지 않게 쓴다 */
  along?: LegAlong;
}

/** 길 모양 입력. shapes는 legGeometryKey → 구간 길 모양, prev는 직전 판정의 길 위 진행이다 */
export interface RoadInput {
  shapes?: Record<string, LatLng[]>;
  prev?: LegAlong;
}

export function evaluateTiming(day: LiveDay, tr: ArrivalTracker, now: number, position?: LatLng, road: RoadInput = {}): Timing | null {
  const ni = nextIndex(tr, day);
  if (ni < 0) return null;
  const next = day.items[ni];
  const nowMin = minuteOfDay(day, now);
  let etaMin: number;
  let phase: Timing['phase'];
  let along: LegAlong | undefined;
  const cur = tr.current;
  const curIdx = cur ? day.items.findIndex((i) => i.spotId === cur.spotId) : -1;
  if (cur && !cur.left && curIdx >= 0) {
    phase = 'atSpot';
    etaMin = Math.max(nowMin, day.items[curIdx].departMin) + next.travelMin;
  } else {
    phase = 'moving';
    const prev = ni > 0 ? day.items[ni - 1].coord : day.base;
    const key = prev ? legGeometryKey(prev, next.coord, next.transport) : undefined;
    const prevAlong = key && road.prev?.key === key ? road.prev : undefined;
    const path = prev ? legPathFor(road.shapes, prev, next.coord, next.transport) : undefined;
    const on = path && position ? progressOnPath(path, position, prevAlong?.alongM) : undefined;
    // 길 위 진행이 없으면(위치 없음·길에서 멂) 같은 구간의 직전 진행을 이어 둔다
    along = on && key ? { key, alongM: on.alongM } : prevAlong;
    if (on) etaMin = nowMin + next.travelMin * (1 - on.fraction);
    else if (position) {
      etaMin =
        nowMin +
        remainingTravelMin(position, next.coord, next.transport, prev ? { from: prev, minutes: next.travelMin } : undefined);
    } else {
      const prevDepart = ni > 0 ? day.items[ni - 1].departMin : day.startMin;
      etaMin = Math.max(nowMin, prevDepart) + next.travelMin;
    }
  }
  const betweenSpots = !!cur && cur.left;
  return {
    nextIdx: ni,
    spotId: next.spotId,
    name: next.name,
    phase,
    plannedArriveMin: next.arriveMin,
    etaMin,
    delayMin: delayMinutes(next.arriveMin, etaMin),
    gapMin: phase === 'moving' ? Math.floor(next.arriveMin - etaMin) : 0,
    betweenSpots,
    ...(along ? { along } : {}),
  };
}

/** 빈 시간 판정(FR-604). 스팟을 떠나 이동 중이고 다음 일정까지 30분 이상 남을 때만 참이다. */
export function hasFreeTime(t: Timing | null): t is Timing {
  return !!t && t.phase === 'moving' && t.betweenSpots && t.gapMin >= FREE_TIME_MIN;
}

/* ---------- 조정안 문구 ---------- */

/** 조정안 시트 제목. 경고가 아니라 제안이다('늦었다'류 문구를 쓰지 않는다). */
export const PROPOSAL_TITLE = '뒤 일정을 이렇게 바꿀까요';
export const PROPOSAL_APPLY = '적용';
export const PROPOSAL_KEEP = '원래대로';

/** 조정안 시트 안내 한 줄. 예: '석굴암 예상 도착 11:32 · 계획 11:07보다 25분 뒤' */
export function proposalLead(name: string, etaHHMM: string, plannedHHMM: string, delayMin: number): string {
  return `${name} 예상 도착 ${etaHHMM} · 계획 ${plannedHHMM}보다 ${delayMin}분 뒤`;
}
