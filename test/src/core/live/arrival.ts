import type { GpsSample, Visit } from '../../types';
import { ARRIVAL_ACCURACY_M, ARRIVAL_DWELL_MS, ARRIVAL_RADIUS_M, GPS_SHADOW_SAMPLES } from '../constants';
import { haversineKm } from '../util';
import type { LiveDay } from './context';

/**
 * 도착 감지(FR-602, WP5 소유, 순수 리듀서).
 * - 정확도 50m 이하 샘플만 판정에 쓴다. 50m 초과·정확도 모름(웹 null)은 판정에서 빼고 머문 시간을 끊지도 않는다.
 * - 스팟 반경 100m 안에 3분 이상 머물면 도착이다. 도착 시각은 반경에 들어온 시각이다.
 * - 지나친 뒤 다음 스팟에 도착하면 그 앞의 아직 남은 스팟(기록 없음·취소함)은 건너뜀(skipped)이다.
 * - 수동 취소하면 cancelled가 되고 그 스팟은 다시 남은 일정이 된다. 반경을 벗어나기 전까지는 다시 잡지 않는다.
 * - 반경 안에 남은 스팟이 여럿이면 순서상 다음 스팟을 먼저 잡는다. 없으면 가장 가까운 곳이다.
 * - 도착해 머무는 스팟의 반경 안에서는 다른 스팟을 잡지 않는다. 예외는 순서상 다음 스팟이 더 가까울 때뿐이다
 *   (30~80m 붙은 두 스팟에서 옆 스팟이 저절로 도착되고 사이 스팟이 건너뜀이 되는 것을 막는다).
 * - 정확도 초과 샘플이 연속 3개면 GPS 음영 안내를 켠다(FR-601). 정확한 샘플이 오면 끈다.
 * - 정확도를 모르는 샘플(웹 null)이 연속 3개면 '정확도 모름' 안내를 켠다. 이때 도착은 버튼으로 기록한다.
 */

export type VisitStatus = Visit['status'];

export interface ArrivalTracker {
  /** 이 날짜 스팟별 상태. 없으면 아직 남은 일정 */
  statuses: Record<string, VisitStatus>;
  /** 반경 안에 들어와 머무는 중인 스팟 */
  candidate?: { spotId: string; enteredAt: number };
  /** 도착해 아직 반경을 벗어나지 않은 스팟 */
  current?: { spotId: string; arrivedAt: number; left: boolean };
  /** 수동 취소한 스팟. 반경을 벗어날 때까지 다시 잡지 않는다 */
  suppressed?: string;
  badStreak: number;
  shadow: boolean;
  /** 정확도를 모르는(null) 샘플 연속 개수와 그 안내 */
  unknownStreak?: number;
  accuracyUnknown?: boolean;
}

export type ArrivalEvent =
  | { kind: 'arrived'; spotId: string; at: number }
  | { kind: 'skipped'; spotId: string; at: number }
  | { kind: 'left'; spotId: string; at: number }
  | { kind: 'shadowOn'; at: number }
  | { kind: 'shadowOff'; at: number }
  | { kind: 'unknownOn'; at: number }
  | { kind: 'unknownOff'; at: number };

export function initialTracker(statuses: Record<string, VisitStatus> = {}): ArrivalTracker {
  return { statuses: { ...statuses }, badStreak: 0, shadow: false };
}

export function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  return haversineKm(a, b) * 1000;
}

/** 판정에 쓸 수 있는 샘플인지(정확도 50m 이하) */
export function isAccurate(s: Pick<GpsSample, 'accuracyM'>): boolean {
  return s.accuracyM != null && s.accuracyM <= ARRIVAL_ACCURACY_M;
}

/** 아직 남은 스팟(기록 없음 또는 취소됨) */
export function isRemaining(tr: ArrivalTracker, spotId: string): boolean {
  const st = tr.statuses[spotId];
  return st == null || st === 'cancelled';
}

function markArrived(
  tr: ArrivalTracker,
  day: LiveDay,
  spotId: string,
  arrivedAt: number,
  at: number,
): { tracker: ArrivalTracker; events: ArrivalEvent[] } {
  const events: ArrivalEvent[] = [];
  const statuses = { ...tr.statuses };
  const idx = day.items.findIndex((i) => i.spotId === spotId);
  for (let i = 0; i < idx; i += 1) {
    const id = day.items[i].spotId;
    // 취소한 스팟도 남은 일정이다. 그 뒤 스팟에 도착했으면 지나온 것이다.
    if (statuses[id] == null || statuses[id] === 'cancelled') {
      statuses[id] = 'skipped';
      events.push({ kind: 'skipped', spotId: id, at });
    }
  }
  statuses[spotId] = 'arrived';
  events.push({ kind: 'arrived', spotId, at: arrivedAt });
  return {
    tracker: {
      ...tr,
      statuses,
      candidate: undefined,
      current: { spotId, arrivedAt, left: false },
      suppressed: tr.suppressed != null && (tr.suppressed === spotId || statuses[tr.suppressed] === 'skipped') ? undefined : tr.suppressed,
    },
    events,
  };
}

export function stepArrival(tr: ArrivalTracker, sample: GpsSample, day: LiveDay): { tracker: ArrivalTracker; events: ArrivalEvent[] } {
  const events: ArrivalEvent[] = [];
  if (sample.accuracyM == null) {
    // 정확도를 모르는 샘플(웹 null)은 음영으로 세지 않고 판정에서 뺀다. 연속이면 버튼으로 기록하라고 안내한다.
    const unknownStreak = (tr.unknownStreak ?? 0) + 1;
    const turnOn = !tr.accuracyUnknown && unknownStreak >= GPS_SHADOW_SAMPLES;
    if (turnOn) events.push({ kind: 'unknownOn', at: sample.t });
    return { tracker: { ...tr, unknownStreak, accuracyUnknown: tr.accuracyUnknown || turnOn }, events };
  }
  if (!isAccurate(sample)) {
    const badStreak = tr.badStreak + 1;
    const turnOn = !tr.shadow && badStreak >= GPS_SHADOW_SAMPLES;
    if (turnOn) events.push({ kind: 'shadowOn', at: sample.t });
    return { tracker: { ...tr, badStreak, shadow: tr.shadow || turnOn }, events };
  }

  let next: ArrivalTracker = { ...tr, badStreak: 0, unknownStreak: 0 };
  if (tr.shadow) {
    next.shadow = false;
    events.push({ kind: 'shadowOff', at: sample.t });
  }
  if (tr.accuracyUnknown) {
    next.accuracyUnknown = false;
    events.push({ kind: 'unknownOff', at: sample.t });
  }

  const dist = (spotId: string) => {
    const it = day.items.find((i) => i.spotId === spotId);
    return it ? distanceM(sample.coord, it.coord) : Infinity;
  };

  if (next.current && !next.current.left && dist(next.current.spotId) > ARRIVAL_RADIUS_M) {
    next.current = { ...next.current, left: true };
    events.push({ kind: 'left', spotId: next.current.spotId, at: sample.t });
  }
  if (next.suppressed && dist(next.suppressed) > ARRIVAL_RADIUS_M) next.suppressed = undefined;

  // 반경 안의 남은 스팟. 순서상 다음 스팟이 반경 안이면 그곳, 아니면 가장 가까운 곳(지나친 뒤 뒤 스팟 도착).
  // 머무는 스팟 반경 안이면 순서상 다음 스팟이 머무는 스팟보다 더 가까울 때만 본다.
  const stay = next.current && !next.current.left ? dist(next.current.spotId) : Infinity;
  const nextId = day.items[nextIndex(next, day)]?.spotId;
  let inside: string | undefined;
  let best = Infinity;
  for (const it of day.items) {
    if (!isRemaining(next, it.spotId)) continue;
    if (it.spotId === next.suppressed) continue;
    if (stay <= ARRIVAL_RADIUS_M && it.spotId !== nextId) continue;
    const d = distanceM(sample.coord, it.coord);
    if (d > ARRIVAL_RADIUS_M) continue;
    if (stay <= ARRIVAL_RADIUS_M && d >= stay) continue;
    if (it.spotId === nextId) {
      inside = it.spotId;
      break;
    }
    if (d < best) {
      best = d;
      inside = it.spotId;
    }
  }

  if (!inside) {
    next.candidate = undefined;
    return { tracker: next, events };
  }
  if (next.candidate?.spotId === inside) {
    if (sample.t - next.candidate.enteredAt >= ARRIVAL_DWELL_MS) {
      const r = markArrived(next, day, inside, next.candidate.enteredAt, sample.t);
      return { tracker: r.tracker, events: [...events, ...r.events] };
    }
    return { tracker: next, events };
  }
  next.candidate = { spotId: inside, enteredAt: sample.t };
  return { tracker: next, events };
}

/** 수동 도착 처리(권한 거부 시 수동 진행 모드). 앞의 남은 스팟(기록 없음·취소함)은 건너뜀이다. */
export function manualArrive(tr: ArrivalTracker, day: LiveDay, spotId: string, at: number) {
  return markArrived(tr, day, spotId, at, at);
}

/** 오탐 수동 취소. 그 스팟은 다시 남은 일정이 된다. */
export function cancelArrival(tr: ArrivalTracker, spotId: string): ArrivalTracker {
  return {
    ...tr,
    statuses: { ...tr.statuses, [spotId]: 'cancelled' },
    current: tr.current?.spotId === spotId ? undefined : tr.current,
    candidate: undefined,
    suppressed: spotId,
  };
}

/**
 * 앱으로 돌아왔을 때. 꺼지기 전에 반경에 들어온 기록(candidate)은 버린다.
 * 꺼져 있던 동안 머문 시간을 복원하지 않기 위해서다(NFR 백그라운드).
 */
export function resumeTracker(tr: ArrivalTracker): ArrivalTracker {
  return tr.candidate ? { ...tr, candidate: undefined } : tr;
}

/** 다음 목적지: 순서상 첫 남은 스팟(도착해 머무는 곳은 제외) */
export function nextIndex(tr: ArrivalTracker, day: LiveDay): number {
  for (let i = 0; i < day.items.length; i += 1) {
    const id = day.items[i].spotId;
    if (tr.current && !tr.current.left && tr.current.spotId === id) continue;
    if (isRemaining(tr, id)) return i;
  }
  return -1;
}
