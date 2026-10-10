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
import { acceptWhileForeground, initialBackground, onAppPhase, setRecording, type AppPhase, type BackgroundState } from './background';
import { msOfMinute, type LiveDay } from './context';
import { evaluateTiming, hasFreeTime, isDelayed, type Timing } from './delay';
import { throttleSample, type ThrottleDecision, type ThrottleState } from './throttle';

/**
 * 여행 진행 엔진(WP5 소유, 순수). 샘플 하나·시각 하나를 받아 상태와 효과(effect) 목록을 돌려준다.
 * 스토어(store/live.ts)는 효과를 op·토스트·비동기 조회로 옮기기만 한다. 판정은 전부 여기와 arrival·delay·throttle이다.
 *
 * 순서: 백그라운드 공백이면 버림 → 30초 스로틀 → 위치 로그(정지면 건너뜀) → 도착 판정 → 지연·빈 시간 판정.
 * 백그라운드 동선 기록(사용자가 켠 옵션)이 돌 때 화면 밖 샘플은 위치 로그와 도착 기록까지만 간다(ingestAway).
 * 화면 밖 도착은 방문 기록(visit)만 내고 도착 알림은 내지 않는다(돌아와도 띄우지 않는다).
 * 지연 조정안·빈 시간 추천도 내지 않고, 앱으로 돌아오면 시계 판정이 이어서 본다.
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
  /**
   * 아는 구간 길 모양(선택). legGeometryKey(출발, 도착, 수단) → 지도 선과 같은 모양이다(시뮬레이터 legShapes와 같은 키).
   * 스토어가 그날 계획 구간으로 경로 조회(routes.route)를 해서 받은 것만 담는다(실제 위치로 묻지 않는다).
   * 있으면 이동 중 남은 시간을 길 위 진행으로 잰다(delay evaluateTiming). 없으면 직선 비율이다.
   */
  legShapes?: Record<string, LatLng[]>;
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

/**
 * 샘플이 끊긴 뒤에도 마지막 위치를 믿는 시간. 도착 머묾(3분)보다 길어야 멈춰 선 사용자의 도착이 잡힌다.
 * 백그라운드 동선 기록이 도는 동안 멈추면 샘플이 오지 않는 받기(iOS 20m 이동 조건, stillSilent)라면 시간과 상관없이 믿는다.
 * 샘플이 없다는 것은 마지막 샘플 자리에 있다는 뜻이다. 받기가 끊기면 recording이 꺼진다(engineRecording).
 * 다만 기록을 켜기 전(공백 전) 샘플은 믿지 않고, 30초마다 오는 받기(안드로이드)에서 5분 넘게 끊긴 것은 신호가 없는 것이다.
 */
export const LAST_SAMPLE_MAX_AGE_MS = 5 * 60_000;

/** 마지막 샘플 자리에 now까지 있었다고 믿는지(tickAt의 머문 시간, 화면 밖 샘플 직전까지의 머문 시간) */
function holdsLast(st: EngineState, last: GpsSample, now: number): boolean {
  if (now - last.t <= LAST_SAMPLE_MAX_AGE_MS) return true;
  const bg = st.background;
  return !!bg.recording && !!bg.stillSilent && bg.recordingSince != null && last.t >= bg.recordingSince;
}

/** 위치 로그 효과. 오래 머문 뒤 떠났으면 떠난 자리를 먼저 남긴다(throttle departFrom) */
function trackEffects(decision: ThrottleDecision, sample: GpsSample, ctx: EngineCtx): EngineEffect[] {
  if (!decision.record) return [];
  const point: EngineEffect = { kind: 'track', point: { ...sample, source: ctx.source } };
  return decision.departFrom ? [{ kind: 'track', point: { ...decision.departFrom, source: ctx.source } }, point] : [point];
}

/** 도착 판정 결과를 효과로 바꾼다. away(화면 밖 기록)면 방문 기록만 내고 도착 알림·GPS 안내는 내지 않는다 */
function arrivalEffects(
  st: EngineState,
  events: ArrivalEvent[],
  ctx: EngineCtx,
  away = false,
): { state: EngineState; effects: EngineEffect[] } {
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
      if (e.kind === 'arrived' && !away) {
        const entry: NotifyLogEntry = { kind: 'arrival', key: notifyKey(ctx.tripId, ctx.day.date, e.spotId), at: e.at };
        if (shouldNotify(next.notifyLog, entry, ctx.prefs)) {
          next = { ...next, notifyLog: recordNotify(next.notifyLog, entry, e.at) };
          const name = ctx.day.items.find((i) => i.spotId === e.spotId)?.name ?? '';
          effects.push({ kind: 'arrivalNotice', spotId: e.spotId, name, at: e.at });
        }
      }
    } else if (away) {
      continue;
    } else if (e.kind === 'shadowOn' || e.kind === 'shadowOff') {
      effects.push({ kind: 'shadow', on: e.kind === 'shadowOn', at: e.at });
    } else if (e.kind === 'unknownOn' || e.kind === 'unknownOff') {
      effects.push({ kind: 'accuracyUnknown', on: e.kind === 'unknownOn', at: e.at });
    }
  }
  return { state: next, effects };
}

/**
 * 화면 밖 기록(백그라운드 동선 기록). 위치 로그와 도착 기록(방문 op)까지만 한다. 화면 밖에서 들른 곳이 앱으로 돌아온 뒤
 * 지나침이 되거나 이미 다녀온 곳으로 지연 조정안이 뜨지 않게 도착은 판정한다. 알림·지연·빈 시간은 돌아와서 본다.
 * - 간격은 어댑터(throttleBatch: 30초 1개, 멈춘 자리는 뒤늦게)가 맞췄다. 여기서는 정지 판정만 한다(간격 0).
 *   오래 머문 뒤 떠나면 떠난 자리를 먼저 남긴다(안드로이드 30초 받기에서 머문 시간이 기록 지도 공백이 되지 않게).
 * - iOS 샘플은 20m 넘게 움직일 때만 온다. 새 샘플 직전까지는 앞 샘플 자리에 있었다고 보고 머문 시간을 먼저 잰다
 *   (tickAt과 같은 규칙 holdsLast. 기록을 켜기 전 샘플이나 안드로이드에서 5분 넘게 끊긴 뒤에는 잇지 않는다).
 * - 정확도가 나쁜 샘플도 로그에는 남긴다(기록 지도가 정확도로 거른다). 판정에서는 빠진다.
 */
function ingestAway(st: EngineState, sample: GpsSample, ctx: EngineCtx): { state: EngineState; effects: EngineEffect[] } {
  let next = st;
  const effects: EngineEffect[] = [];
  const last = st.last;
  if (last && isAccurate(last) && sample.t > last.t && holdsLast(st, last, sample.t)) {
    const held = stepArrival(next.tracker, { ...last, t: sample.t }, ctx.day);
    const he = arrivalEffects({ ...next, tracker: held.tracker }, held.events, ctx, true);
    next = he.state;
    effects.push(...he.effects);
  }
  const th = throttleSample(next.throttle, sample, { intervalMs: 0 });
  next = { ...next, throttle: th.state, last: sample };
  effects.push(...trackEffects(th.decision, sample, ctx));
  const ar = stepArrival(next.tracker, sample, ctx.day);
  const ae = arrivalEffects({ ...next, tracker: ar.tracker }, ar.events, ctx, true);
  return { state: ae.state, effects: [...effects, ...ae.effects] };
}

/** 위치 샘플 하나를 받는다. */
export function ingestSample(st: EngineState, sample: GpsSample, ctx: EngineCtx): { state: EngineState; effects: EngineEffect[] } {
  if (st.background.recording) {
    // 늦게 온 OS 묶음의 옛 샘플은 버린다. 받으면 스로틀이 되감기로 보고 위치 로그 뒤쪽을 자른다.
    // 앱이 떠 있으면 앱 안 감시와 백그라운드 받기가 함께 넘기므로 겹친 샘플도 여기서 걸러진다.
    if (st.last && sample.t <= st.last.t) return { state: st, effects: [] };
    if (st.background.inBackground) return ingestAway(st, sample, ctx);
  }
  if (!acceptWhileForeground(st.background, sample.t)) return { state: st, effects: [] };
  const th = throttleSample(st.throttle, sample);
  if (!th.decision.emit) return { state: st, effects: [] };
  const effects: EngineEffect[] = [];
  let next: EngineState = { ...st, throttle: th.state, last: sample };
  // 정확도를 넘는 샘플은 판정에서 빠지지만 위치 로그에는 남긴다(기록 지도에서 흔들림이 보이는 편이 정직하다).
  effects.push(...trackEffects(th.decision, sample, ctx));
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
  // 직전 판정의 길 위 진행을 넘겨 겹친 길(유턴 등)에서 뒤쪽 차선으로 붙지 않게 한다.
  const timing = evaluateTiming(ctx.day, st.tracker, now, position, { shapes: ctx.legShapes, prev: st.timing?.along });
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
 * 백그라운드 동선 기록이 도는 동안 멈추면 샘플이 오지 않는 받기(iOS 20m 이동 조건)라면, 기록을 켠 뒤 받은 샘플은 오래돼도 믿는다
 * (holdsLast). 화면 밖에서 스팟에 들어가 멈춰 선 뒤 앱을 열면 돌아온 첫 틱에 도착이 잡힌다(새 샘플을 기다리는 동안
 * 이미 와 있는 곳으로 지연 조정안을 내지 않는다). 기록을 켜기 전 샘플과 30초마다 오는 받기(안드로이드)는 5분까지만 믿는다.
 * 위치 로그는 남기지 않는다(실제 샘플이 아니다). 마지막 샘플이 오래됐으면 위치 없이 지연만 본다.
 */
export function tickAt(st: EngineState, now: number, ctx: EngineCtx): { state: EngineState; effects: EngineEffect[] } {
  if (st.background.inBackground) return { state: st, effects: [] };
  const last = st.last;
  const fresh = last && isAccurate(last) && now > last.t && holdsLast(st, last, now) ? last : undefined;
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

/**
 * 앱 상태 변화. 돌아오면 꺼지기 전 반경 진입 기록을 버린다(꺼진 동안 머문 시간을 채우지 않는다).
 * 백그라운드 동선 기록이 끝까지 돌았으면 버리지 않는다. 화면 밖에서도 샘플로 머문 시간을 이어 쟀기 때문이다.
 */
export function engineAppPhase(st: EngineState, phase: AppPhase, now: number): { state: EngineState; stop: boolean; resumed: boolean } {
  const r = onAppPhase(st.background, phase, now);
  const tracker = r.resumed && !r.state.recording ? resumeTracker(st.tracker) : st.tracker;
  return { state: { ...st, background: r.state, tracker }, stop: r.stop, resumed: r.resumed };
}

/**
 * 백그라운드 동선 기록이 시작되거나 멈췄다(스토어가 받기 시작·실패·끄기 때 부른다).
 * 화면 밖에서 늦게 켜지면 그 앞은 공백이라, 공백 전에 반경에 들어온 기록은 버린다(돌아올 때와 같은 규칙).
 * stillSilent: 멈춰 있으면 받기가 샘플을 보내지 않는지(어댑터 BackgroundLocation.stillSilent, iOS 참).
 */
export function engineRecording(st: EngineState, on: boolean, now: number, opts: { stillSilent?: boolean } = {}): EngineState {
  const background = setRecording(st.background, on, now, opts);
  if (background === st.background) return st;
  const gapped = background.gaps.length > st.background.gaps.length;
  return { ...st, background, tracker: gapped ? resumeTracker(st.tracker) : st.tracker };
}

/** 방문 기록 id. 같은 날·같은 스팟·같은 멤버는 같은 id라 취소·재도착이 at LWW로 덮인다(journal/visit). */
export function visitId(date: string, spotId: string, memberId: string): string {
  return `v-${date}-${spotId}-${memberId}`;
}
