import type { GpsSample } from '../../types';
import { LOCATION_INTERVAL_MS, STATIONARY_RADIUS_M } from '../constants';
import { haversineKm } from '../util';

/**
 * 위치 갱신 스로틀(NFR 위치·배터리, WP5 소유, 순수).
 * - 판정용 샘플은 30초(LOCATION_INTERVAL_MS)에 1개만 받는다. 웹 watchPosition은 간격을 보장하지 않아 JS에서 거른다.
 * - 정지 판정: 마지막 기록점에서 20m(STATIONARY_RADIUS_M) 안이면 정지로 보고 위치 로그 갱신을 멈춘다.
 *   도착 판정(머문 시간)에는 계속 쓴다. 움직이면 다시 기록한다.
 * 기기 어댑터(services/location/device.ts)와 스토어가 같은 함수를 쓴다.
 */

export interface ThrottleState {
  lastEmitAt?: number;
  lastRecorded?: GpsSample;
}

export interface ThrottleDecision {
  /** 판정에 넘길지(30초 간격) */
  emit: boolean;
  /** 위치 로그에 남길지(정지 아님) */
  record: boolean;
  stationary: boolean;
}

export function throttleSample(
  st: ThrottleState,
  s: GpsSample,
  opts: { intervalMs?: number; stationaryM?: number } = {},
): { state: ThrottleState; decision: ThrottleDecision } {
  const interval = opts.intervalMs ?? LOCATION_INTERVAL_MS;
  const stationaryM = opts.stationaryM ?? STATIONARY_RADIUS_M;
  const emit = st.lastEmitAt == null || s.t - st.lastEmitAt >= interval || s.t < st.lastEmitAt;
  if (!emit) return { state: st, decision: { emit: false, record: false, stationary: false } };
  const moved = st.lastRecorded ? haversineKm(st.lastRecorded.coord, s.coord) * 1000 : Infinity;
  const stationary = moved < stationaryM;
  const record = !stationary;
  return {
    state: { lastEmitAt: s.t, lastRecorded: record ? s : st.lastRecorded },
    decision: { emit: true, record, stationary },
  };
}

/* ---------- 정지 시 센서 갱신 줄이기 ---------- */

/** 정지 판정이 이만큼 이어지면(30초 간격이면 2분) 기기 감시를 정지용으로 바꾼다. */
export const STATIONARY_SWITCH_SAMPLES = 4;

/**
 * 기기 감시 방식. active는 30초 간격, stationary는 20m(STATIONARY_RADIUS_M) 넘게 움직일 때만 갱신을 받는다.
 * 정지 중에는 위치 로그를 멈출 뿐 아니라 센서 갱신 요청도 줄인다(NFR 배터리 '정지 상태에서는 갱신 중단').
 * 도착 머묾은 샘플이 없어도 엔진 tickAt이 마지막 위치로 이어서 잰다.
 */
export type WatchProfile = 'active' | 'stationary';

export interface WatchProfileState {
  profile: WatchProfile;
  stillCount: number;
}

export const initialWatchProfile: WatchProfileState = { profile: 'active', stillCount: 0 };

export function nextWatchProfile(st: WatchProfileState, decision: ThrottleDecision): { state: WatchProfileState; changed: boolean } {
  if (!decision.emit) return { state: st, changed: false };
  if (decision.stationary) {
    const stillCount = st.stillCount + 1;
    const profile: WatchProfile = stillCount >= STATIONARY_SWITCH_SAMPLES ? 'stationary' : st.profile;
    return { state: { profile, stillCount }, changed: profile !== st.profile };
  }
  return { state: initialWatchProfile, changed: st.profile !== 'active' };
}

/** 감시 방식별 요청 값(어댑터가 그대로 넘긴다) */
export function watchRequest(profile: WatchProfile, intervalMs: number): { timeIntervalMs: number; distanceIntervalM: number } {
  return profile === 'stationary'
    ? { timeIntervalMs: intervalMs * 2, distanceIntervalM: STATIONARY_RADIUS_M }
    : { timeIntervalMs: intervalMs, distanceIntervalM: 0 };
}
