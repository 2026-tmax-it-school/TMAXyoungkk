import type { GpsSample } from '../../types';
import { LOCATION_INTERVAL_MS, STATIONARY_RADIUS_M } from '../constants';
import { haversineKm } from '../util';

/**
 * 위치 갱신 스로틀(NFR 위치·배터리, WP5 소유, 순수).
 * - 판정용 샘플은 30초(LOCATION_INTERVAL_MS)에 1개만 받는다. 웹 watchPosition은 간격을 보장하지 않아 JS에서 거른다.
 * - 정지 판정: 마지막 기록점에서 20m(STATIONARY_RADIUS_M) 안이면 정지로 보고 위치 로그 갱신을 멈춘다.
 *   도착 판정(머문 시간)에는 계속 쓴다. 움직이면 다시 기록한다. 4분(STILL_DEPART_MS) 넘게 머문 뒤 움직이면
 *   떠난 자리(정지로 건너뛴 마지막 샘플)를 먼저 남겨, 머문 시간이 기록 지도에서 공백으로 보이지 않게 한다.
 * 기기 어댑터(services/location/device.ts, background.ts)와 스토어가 같은 함수를 쓴다.
 */

export interface ThrottleState {
  lastEmitAt?: number;
  lastRecorded?: GpsSample;
  /**
   * 묶음 스로틀(throttleBatch)이 간격 안이라 넘기지 않은 샘플 중 가장 늦은 것. 그 뒤로 간격만큼 샘플이 없으면 뒤늦게 넘긴다
   * (flushPending). 20m 이동 조건으로 받으면 멈춘 뒤에는 샘플이 더 오지 않아, 앞쪽만 남기면 멈춘 자리를 잃는다.
   */
  pending?: GpsSample;
  /** 마지막 기록점 뒤로 정지라 위치 로그에 남기지 않은 샘플 중 가장 늦은 것(떠난 자리, departFrom) */
  lastStill?: GpsSample;
}

export interface ThrottleDecision {
  /** 판정에 넘길지(30초 간격) */
  emit: boolean;
  /** 위치 로그에 남길지(정지 아님) */
  record: boolean;
  stationary: boolean;
  /**
   * 오래 머문 뒤 다시 움직였을 때 이 샘플보다 먼저 위치 로그에 남길 떠난 자리(정지로 건너뛴 마지막 샘플).
   * 마지막 기록점에서 STILL_DEPART_MS 넘게 지났을 때만 낸다. 거리 조건 없이 30초마다 받으면(안드로이드 백그라운드)
   * 출발 뒤 첫 점이 도착 점에서 수백 m 떨어져, 기록 지도가 머문 시간 전체를 '기록 없는 구간'으로 본다.
   */
  departFrom?: GpsSample;
}

/**
 * 마지막 기록점에서 이만큼 지난 뒤 다시 움직이면 떠난 자리를 먼저 남긴다. 기록 지도 공백 기준(journal TRACK_GAP_MS 5분)보다
 * 짧아야 머문 시간이 공백으로 보이지 않는다. 짧게 멈췄다 움직이는 흔들림에는 점을 더하지 않는다.
 */
export const STILL_DEPART_MS = 4 * 60_000;

export function throttleSample(
  st: ThrottleState,
  s: GpsSample,
  opts: { intervalMs?: number; stationaryM?: number } = {},
): { state: ThrottleState; decision: ThrottleDecision } {
  const interval = opts.intervalMs ?? LOCATION_INTERVAL_MS;
  const emit = st.lastEmitAt == null || s.t - st.lastEmitAt >= interval || s.t < st.lastEmitAt;
  if (!emit) return { state: st, decision: { emit: false, record: false, stationary: false } };
  return emitSample(st, s, opts.stationaryM ?? STATIONARY_RADIUS_M);
}

/**
 * 넘기기로 한 샘플의 정지 판정(마지막 기록점에서 20m 안이면 위치 로그를 건너뛴다).
 * 오래 머문 뒤 다시 움직이면 정지로 건너뛴 마지막 샘플을 떠난 자리(departFrom)로 함께 낸다.
 */
function emitSample(st: ThrottleState, s: GpsSample, stationaryM: number): { state: ThrottleState; decision: ThrottleDecision } {
  const moved = st.lastRecorded ? haversineKm(st.lastRecorded.coord, s.coord) * 1000 : Infinity;
  const stationary = moved < stationaryM;
  const record = !stationary;
  if (stationary) {
    return {
      state: { lastEmitAt: s.t, lastRecorded: st.lastRecorded, lastStill: s },
      decision: { emit: true, record, stationary },
    };
  }
  const still = st.lastStill;
  const depart =
    still && st.lastRecorded && still.t > st.lastRecorded.t && still.t < s.t && s.t - st.lastRecorded.t > STILL_DEPART_MS
      ? still
      : undefined;
  return {
    state: { lastEmitAt: s.t, lastRecorded: s },
    decision: depart ? { emit: true, record, stationary, departFrom: depart } : { emit: true, record, stationary },
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

/* ---------- 백그라운드 동선 기록 ---------- */

/**
 * 백그라운드 받기(startLocationUpdatesAsync) 요청 값. 진행을 시작할 때 한 번 등록하고 화면 밖까지 이어 받는다.
 * 작업을 다시 등록하지 않으려고 감시 방식(watchRequest)을 바꾸지 않는다.
 * - iOS: 20m(STATIONARY_RADIUS_M) 넘게 움직일 때만 받는다(iOS는 간격을 보지 않는다). 멈춰 있으면 콜백이 오지 않아
 *   엔진은 기록 중에는 마지막 위치로 머문 시간을 잰다. 화면 밖에서도 앱이 살아 있어 자정 타이머가 돈다.
 * - 안드로이드: 거리 조건 없이 30초 간격으로 받는다. 화면 밖에서는 JS 타이머가 멈추고 작업이 돌 때만 깨어나므로,
 *   멈춰 있어도 샘플이 와야 진행 날짜가 지났는지 보고 받기를 멈출 수 있다(store/live onSample). GPS는 어느 쪽이든
 *   30초마다 위치를 잡으므로 센서 비용은 같고, 위치 로그는 정지 판정이 그대로 거른다.
 * 앱이 떠 있을 때는 앱 안 감시(watchRequest)를 함께 돌려 30초 간격으로 도착 머묾을 잰다(core/live/background watchPlan).
 */
export function backgroundWatchRequest(intervalMs: number, platform: string): { timeIntervalMs: number; distanceIntervalM: number } {
  return platform === 'android'
    ? { timeIntervalMs: intervalMs, distanceIntervalM: 0 }
    : { timeIntervalMs: intervalMs, distanceIntervalM: STATIONARY_RADIUS_M };
}

/**
 * 백그라운드 받기가 멈춰 있으면 샘플을 보내지 않는지(거리 조건이 있는 iOS). 엔진은 이때만 기록 중 오래된 마지막 샘플을 믿는다
 * (engine holdsLast). 안드로이드는 30초마다 오므로 5분 넘게 끊기면 신호가 없는 것이다.
 */
export function backgroundStillSilent(platform: string): boolean {
  return backgroundWatchRequest(LOCATION_INTERVAL_MS, platform).distanceIntervalM > 0;
}

/**
 * OS가 몰아서 넘긴 샘플 묶음을 시간순으로 거른다(백그라운드 어댑터). 규칙은 throttleSample과 같다(30초 1개, 정지 판정).
 * 기기 샘플은 시간을 거꾸로 가지 않는다. 이미 넘긴 샘플보다 이르거나 같은 시각은 버린다
 * (throttleSample은 시뮬레이터 되감기를 위해 이른 샘플을 새 시작으로 보지만, 늦게 온 기기 묶음에서는 위치 로그 뒤쪽이 잘린다).
 * 간격 안이라 넘기지 않은 마지막 샘플은 pending으로 들고 있다. 그 뒤로 간격만큼 샘플이 없었으면 그 자리에 멈춰 있던 것이라
 * 다음 샘플보다 먼저 넘긴다. 같은 묶음 안이든 다음 묶음이든 같다. 다음 샘플이 오지 않으면 어댑터가 간격이 지난 뒤
 * flushPending으로 넘긴다(앞쪽과 멈춘 자리를 모두 남기는 스로틀). 멈춘 자리 한 점만 30초보다 촘촘할 수 있다.
 */
export function throttleBatch(
  st: ThrottleState,
  batch: readonly GpsSample[],
  opts: { intervalMs?: number; stationaryM?: number } = {},
): { state: ThrottleState; out: { sample: GpsSample; decision: ThrottleDecision }[] } {
  const interval = opts.intervalMs ?? LOCATION_INTERVAL_MS;
  let state = st;
  const out: { sample: GpsSample; decision: ThrottleDecision }[] = [];
  const sorted = [...batch].sort((a, b) => a.t - b.t);
  for (const s of sorted) {
    if (state.lastEmitAt != null && s.t <= state.lastEmitAt) continue;
    if (state.pending && s.t - state.pending.t >= interval) {
      const f = flushPending(state, s.t, opts);
      state = f.state;
      out.push(...f.out);
    }
    const r = throttleSample(state, s, opts);
    if (r.decision.emit) {
      state = r.state;
      out.push({ sample: s, decision: r.decision });
    } else if (!state.pending || state.pending.t < s.t) {
      state = { ...state, pending: s };
    }
  }
  return { state, out };
}

/**
 * 들고 있던 샘플(pending)을 멈춘 자리로 넘길 차례인지 보고 넘긴다. 그 뒤로 간격만큼 다른 샘플이 없었을 때만이다
 * (계속 움직이면 다음 샘플이 30초 규칙으로 넘어가므로 넘기지 않는다). 정지 판정은 같다.
 * 어댑터는 pending 시각 + 간격에 타이머로 부른다.
 */
export function flushPending(
  st: ThrottleState,
  now: number,
  opts: { intervalMs?: number; stationaryM?: number } = {},
): { state: ThrottleState; out: { sample: GpsSample; decision: ThrottleDecision }[] } {
  const interval = opts.intervalMs ?? LOCATION_INTERVAL_MS;
  const p = st.pending;
  if (!p) return { state: st, out: [] };
  if (st.lastEmitAt != null && p.t <= st.lastEmitAt) return { state: { ...st, pending: undefined }, out: [] };
  if (now - p.t < interval) return { state: st, out: [] };
  const r = emitSample(st, p, opts.stationaryM ?? STATIONARY_RADIUS_M);
  return { state: r.state, out: [{ sample: p, decision: r.decision }] };
}
