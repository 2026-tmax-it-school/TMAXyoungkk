import type { GpsSample, LatLng, NotifyLogEntry, NotifyPrefs, TrackPoint } from '../../types';
import { recordNotify, shouldNotify } from '../notify';
import {
  cancelArrival as cancelTracker,
  initialTracker,
  isAccurate,
  manualArrive as manualTracker,
  resumeTracker,
  stepArrival,
  type ArrivalEvent,
  type ArrivalTracker,
  type VisitStatus,
} from './arrival';
import { acceptWhileForeground, initialBackground, onAppPhase, type AppPhase, type BackgroundState } from './background';
import { msOfMinute, type LiveDay } from './context';
import { evaluateTiming, hasFreeTime, isDelayed, type Timing } from './delay';
import { throttleSample, type ThrottleState } from './throttle';

/**
 * 여행 진행 엔진(WP5 소유, 순수). 샘플 하나·시각 하나를 받아 상태와 효과(effect) 목록을 돌려준다.
 * 스토어(store/live.ts)는 효과를 op·토스트·비동기 조회로 옮기기만 한다. 판정은 전부 여기와 arrival·delay·throttle이다.
 *
 * 순서: 백그라운드 공백이면 버림 → 30초 스로틀 → 위치 로그(정지면 건너뜀) → 도착 판정 → 지연·빈 시간 판정.
 * 샘플이 끊겨도 시계가 흐르면 tickAt이 마지막 정확한 위치로 머문 시간과 지연을 이어서 본다(기기 모드).
 * 알림 제한은 공유 core/notify(같은 유형·같은 키 30분 1회, 유형별 끄기)만 쓴다.
 * 지연·빈 시간의 키는 여행방·날짜(유형 단위)다. 다음 스팟이 바뀌어도 30분 안에는 다시 묻지 않는다.
 * 지연은 '이미 알린 지연(ackDelayMin)'보다 15분 이상 더 늘어났을 때만 다시 조정안을 낸다.
 * 적용하든 거절하든 같은 지연으로 다시 묻지 않기 위해서다(거절하면 일정이 그대로다).
 */

export interface EngineState {
  tracker: ArrivalTracker;
  throttle: ThrottleState;
  background: BackgroundState;
  notifyLog: NotifyLogEntry[];
  /** 조정안으로 이미 알린 지연(분). 따라잡으면 함께 줄어든다 */
  ackDelayMin: number;
  last?: GpsSample;
  timing?: Timing | null;
}

export interface EngineCtx {
  tripId: string;
  day: LiveDay;
  prefs: NotifyPrefs;
  source: TrackPoint['source'];
}

export type EngineEffect =
  | { kind: 'visit'; spotId: string; status: Exclude<VisitStatus, 'cancelled'>; arrivedAt?: number; at: number }
  | { kind: 'track'; point: TrackPoint }
  | { kind: 'shadow'; on: boolean; at: number }
  /** 정확도를 모르는 샘플(웹)만 오는 중. 켜지면 도착은 버튼으로 기록한다 */
  | { kind: 'accuracyUnknown'; on: boolean; at: number }
  /** 도착 알림(토스트). prefs.arrival과 30분 제한을 통과한 경우만 */
  | { kind: 'arrivalNotice'; spotId: string; name: string; at: number }
  /** 지연 조정안을 만들 차례. 조정안 생성(WP4 replanForDelay)은 스토어가 부른다 */
  | { kind: 'delay'; spotId: string; name: string; delayMin: number; etaMin: number; plannedArriveMin: number; at: number }
  /** 빈 시간 추천을 찾을 차례. 주변 조회(PlaceProvider.nearby)는 스토어가 한다 */
  | { kind: 'freeTime'; spotId: string; gapMin: number; until: number; position: LatLng; at: number };

export function initialEngine(opts: { statuses?: Record<string, VisitStatus>; notifyLog?: NotifyLogEntry[] } = {}): EngineState {
  return {
    tracker: initialTracker(opts.statuses),
    throttle: {},
    background: initialBackground,
    notifyLog: opts.notifyLog ?? [],
    ackDelayMin: 0,
  };
}

/** 도착 알림 키(스팟마다). */
export function notifyKey(tripId: string, date: string, spotId: string): string {
  return `${tripId}:${date}:${spotId}`;
}

/** 지연·빈 시간 알림 키. 유형 단위 30분 1회(NFR 알림)라 스팟을 넣지 않는다. */
export function dayNotifyKey(tripId: string, date: string): string {
  return `${tripId}:${date}`;
}

/** 샘플이 끊긴 뒤에도 마지막 위치를 믿는 시간. 도착 머묾(3분)보다 길어야 멈춰 선 사용자의 도착이 잡힌다. */
export const LAST_SAMPLE_MAX_AGE_MS = 5 * 60_000;

function arrivalEffects(st: EngineState, events: ArrivalEvent[], ctx: EngineCtx): { state: EngineState; effects: EngineEffect[] } {
  let next = st;
  const effects: EngineEffect[] = [];
  for (const e of events) {
    if (e.kind === 'arrived' || e.kind === 'skipped') {
      effects.push({
        kind: 'visit',
        spotId: e.spotId,
        status: e.kind,
        arrivedAt: e.kind === 'arrived' ? e.at : undefined,
        at: e.at,
      });
      if (e.kind === 'arrived') {
        const entry: NotifyLogEntry = { kind: 'arrival', key: notifyKey(ctx.tripId, ctx.day.date, e.spotId), at: e.at };
        if (shouldNotify(next.notifyLog, entry, ctx.prefs)) {
          next = { ...next, notifyLog: recordNotify(next.notifyLog, entry, e.at) };
          const name = ctx.day.items.find((i) => i.spotId === e.spotId)?.name ?? '';
          effects.push({ kind: 'arrivalNotice', spotId: e.spotId, name, at: e.at });
        }
      }
    } else if (e.kind === 'shadowOn' || e.kind === 'shadowOff') {
      effects.push({ kind: 'shadow', on: e.kind === 'shadowOn', at: e.at });
    } else if (e.kind === 'unknownOn' || e.kind === 'unknownOff') {
      effects.push({ kind: 'accuracyUnknown', on: e.kind === 'unknownOn', at: e.at });
    }
  }
  return { state: next, effects };
}

/** 위치 샘플 하나를 받는다. */
export function ingestSample(st: EngineState, sample: GpsSample, ctx: EngineCtx): { state: EngineState; effects: EngineEffect[] } {
  if (!acceptWhileForeground(st.background, sample.t)) return { state: st, effects: [] };
  const th = throttleSample(st.throttle, sample);
  if (!th.decision.emit) return { state: st, effects: [] };
  const effects: EngineEffect[] = [];
  let next: EngineState = { ...st, throttle: th.state, last: sample };
  // 정확도를 넘는 샘플은 판정에서 빠지지만 위치 로그에는 남긴다(기록 지도에서 흔들림이 보이는 편이 정직하다).
  if (th.decision.record) effects.push({ kind: 'track', point: { ...sample, source: ctx.source } });
  const ar = stepArrival(next.tracker, sample, ctx.day);
  next = { ...next, tracker: ar.tracker };
  const ae = arrivalEffects(next, ar.events, ctx);
  next = ae.state;
  effects.push(...ae.effects);
  const ev = evaluateAt(next, sample.t, ctx, isAccurate(sample) ? sample.coord : undefined);
  return { state: ev.state, effects: [...effects, ...ev.effects] };
}

/** 이 시각 기준 지연·빈 시간 판정. 샘플이 없어도(수동 진행) 시계가 흐르면 부른다. */
export function evaluateAt(
  st: EngineState,
  now: number,
  ctx: EngineCtx,
  position?: LatLng,
): { state: EngineState; effects: EngineEffect[] } {
  const timing = evaluateTiming(ctx.day, st.tracker, now, position);
  const effects: EngineEffect[] = [];
  if (!timing) return { state: { ...st, timing: null }, effects };
  let next: EngineState = { ...st, timing, ackDelayMin: Math.min(st.ackDelayMin, timing.delayMin) };
  const key = dayNotifyKey(ctx.tripId, ctx.day.date);

  if (isDelayed(timing.delayMin - next.ackDelayMin)) {
    const entry: NotifyLogEntry = { kind: 'delay', key, at: now };
    if (shouldNotify(next.notifyLog, entry, ctx.prefs)) {
      next = { ...next, notifyLog: recordNotify(next.notifyLog, entry, now) };
      effects.push({
        kind: 'delay',
        spotId: timing.spotId,
        name: timing.name,
        delayMin: timing.delayMin,
        etaMin: timing.etaMin,
        plannedArriveMin: timing.plannedArriveMin,
        at: now,
      });
    }
  }

  if (hasFreeTime(timing) && position) {
    const entry: NotifyLogEntry = { kind: 'freeTime', key, at: now };
    if (shouldNotify(next.notifyLog, entry, ctx.prefs)) {
      next = { ...next, notifyLog: recordNotify(next.notifyLog, entry, now) };
      effects.push({
        kind: 'freeTime',
        spotId: timing.spotId,
        gapMin: timing.gapMin,
        until: msOfMinute(ctx.day, timing.plannedArriveMin),
        position,
        at: now,
      });
    }
  }
  return { state: next, effects };
}

/**
 * 시계만 흐를 때(샘플 없음). 웹 watchPosition은 멈춰 있으면 콜백을 보내지 않을 수 있어서,
 * 마지막 정확한 샘플이 LAST_SAMPLE_MAX_AGE_MS 안이면 그 자리에 계속 있다고 보고 도착 머묾을 잰다.
 * 위치 로그는 남기지 않는다(실제 샘플이 아니다). 마지막 샘플이 오래됐으면 위치 없이 지연만 본다.
 */
export function tickAt(st: EngineState, now: number, ctx: EngineCtx): { state: EngineState; effects: EngineEffect[] } {
  if (st.background.inBackground) return { state: st, effects: [] };
  const last = st.last;
  const fresh = last && isAccurate(last) && now > last.t && now - last.t <= LAST_SAMPLE_MAX_AGE_MS ? last : undefined;
  let next = st;
  const effects: EngineEffect[] = [];
  if (fresh) {
    const ar = stepArrival(next.tracker, { ...fresh, t: now }, ctx.day);
    next = { ...next, tracker: ar.tracker };
    const ae = arrivalEffects(next, ar.events, ctx);
    next = ae.state;
    effects.push(...ae.effects);
  }
  const ev = evaluateAt(next, now, ctx, fresh?.coord);
  return { state: ev.state, effects: [...effects, ...ev.effects] };
}

/** 조정안을 적용하거나 거절했다. 이 지연으로는 다시 묻지 않는다. */
export function acknowledgeDelay(st: EngineState, delayMin: number): EngineState {
  return { ...st, ackDelayMin: Math.max(st.ackDelayMin, delayMin) };
}

/** 수동 도착 처리(권한 거부 시 수동 진행 모드, 또는 사용자가 직접 누름) */
export function manualArrival(st: EngineState, spotId: string, now: number, ctx: EngineCtx): { state: EngineState; effects: EngineEffect[] } {
  const r = manualTracker(st.tracker, ctx.day, spotId, now);
  const ae = arrivalEffects({ ...st, tracker: r.tracker }, r.events, ctx);
  const ev = evaluateAt(ae.state, now, ctx);
  return { state: ev.state, effects: [...ae.effects, ...ev.effects] };
}

/** 도착 오탐 수동 취소. 그 스팟이 다시 남은 일정이 된다. */
export function cancelArrivalEngine(st: EngineState, spotId: string): EngineState {
  return { ...st, tracker: cancelTracker(st.tracker, spotId) };
}

/** 앱 상태 변화. 돌아오면 꺼지기 전 반경 진입 기록을 버린다(꺼진 동안 머문 시간을 채우지 않는다). */
export function engineAppPhase(st: EngineState, phase: AppPhase, now: number): { state: EngineState; stop: boolean; resumed: boolean } {
  const r = onAppPhase(st.background, phase, now);
  const tracker = r.resumed ? resumeTracker(st.tracker) : st.tracker;
  return { state: { ...st, background: r.state, tracker }, stop: r.stop, resumed: r.resumed };
}

/** 방문 기록 id. 같은 날·같은 스팟·같은 멤버는 같은 id라 취소·재도착이 at LWW로 덮인다(journal/visit). */
export function visitId(date: string, spotId: string, memberId: string): string {
  return `v-${date}-${spotId}-${memberId}`;
}
