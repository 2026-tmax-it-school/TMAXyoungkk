import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  ArrivalState,
  Category,
  DayPlan,
  FreeTime,
  GpsSample,
  LatLng,
  LiveProposal,
  NotifyLogEntry,
  Photo,
  SimPresetId,
  TrackPoint,
  Trip,
  Visit,
} from '../types';
import { LOCATION_INTERVAL_MS, STORAGE_KEYS, STORAGE_VERSION } from '../core/constants';
import type { LocationPermission, PhotoProvider, PickedPhoto } from '../core/ports';
import { isAccurate, type VisitStatus } from '../core/live/arrival';
import { BG_FAIL_LINE, BG_LINE, type AppPhase, type BgRecordBlock } from '../core/live/background';
import { liveDayFromTrip, type LiveDay } from '../core/live/context';
import type { Timing } from '../core/live/delay';
import {
  acknowledgeDelay,
  cancelArrivalEngine,
  engineAppPhase,
  engineRecording,
  evaluateAt,
  ingestSample,
  initialEngine,
  manualArrival,
  tickAt,
  type EngineCtx,
  type EngineEffect,
  type EngineState,
} from '../core/live/engine';
import { findFreeTime } from '../core/live/freetime';
import { liveModeFor } from '../core/live/mode';
import {
  closingMinutes,
  doneSpotIds,
  freeTimeLine,
  freshNotifyLog,
  LIVE_STOP_TEXT,
  liveStopReason,
  logLine,
  nextVisitAt,
  photoLine,
  replanPosition,
  sameLiveDay,
  staleSimVisits,
  statusesFromVisits,
  visitRecord,
  type LiveLogLine,
} from '../core/live/session';
import { appendTrack, clearSimTrackDay, noteLivePermission, pruneTracks, type DeniedStore } from '../core/live/track';
import { createWatchControl, type WatchControl } from '../core/live/watchControl';
import { coordLookup, dayLegs } from '../core/map/model';
import { replanForDelay } from '../core/planner/replan';
import { createSimClock, type SimClock } from '../core/sim/clock';
import { gatherLegShapes, newShapeKeys, type LegShapeGather } from '../core/sim/legShapes';
import { generateTrack, eventsBetween, type GenerateTrackInput, type SimTrack } from '../core/sim/track';
import { kstDate } from '../core/util';
import { legGeometry } from '../components/map/useLegGeometry';
import { appClock, isClockOverridden, setClockOverride, systemClock } from '../services/clock';
import { persistStorage, waitForHydration } from '../services/kv';
import { createBackgroundLocation, type BgEnableResult } from '../services/location/background';
import { createSimLocation } from '../services/location/sim';
import { createSimPhotoProvider } from '../services/photos/sim';
import { getServices, overrideServices } from '../services/registry';
import { useSession } from './session';
import { myMemberId, useTrips } from './trips';
import { useUi } from './ui';

/**
 * 여행 진행 상태(WP5 소유). 현재 위치, 도착 감지, 지연 조정안, 빈 시간 추천, 위치 로그, 여행 시뮬레이터.
 * 판정은 전부 core/live(순수 엔진)가 하고, 여기서는 엔진 효과를 op(journal/visit)·토스트·비동기 조회로 옮기기만 한다.
 *
 * - 시뮬레이터: SimClock이 appClock이 되고(setClockOverride), location·photos를 sim 제공자로 덮는다(overrideServices).
 *   stop·pause는 가상 시각을 멈춘 채 앱 시계로 남긴다. 기기 시각으로 돌아가는 것은 resetDemo뿐이다(계약 A5 시계 단조 규칙).
 *   점이 지도 선(길)을 따라가게 궤적을 만들기 전에 그날 구간 모양을 받는다(routes.route, 24시간 캐시, 지도와 같은 메모).
 *   구간을 한꺼번에 묻고 SHAPE_WAIT_MS까지만 기다린다. 못 받은 구간은 직선으로 시작하고, 늦게 받으면 같은 입력으로 다시 만든다
 *   (시각·이벤트는 그대로, 점만 길로 간다). 계획이 바뀌어 이어 만들 때도 아는 모양으로 바로 만들고 새 구간은 받는 대로 다시 만든다.
 *   엔진도 받은 구간 모양으로 이동 중 남은 시간을 잰다(EngineCtx.legShapes, 길이 크게 도는 구간에서 거짓 지연을 내지 않게).
 *   구간 모양은 계획 구간(스팟 좌표)으로만 묻는다. 실제 위치를 경로 서버에 보내지 않는다.
 * - 기기: registry의 location(expo-location, JS 30초 스로틀). 권한이 없으면 수동 진행 모드다.
 *   샘플이 끊겨도 시계로 도착 머묾과 지연을 이어서 본다(엔진 tickAt, 마지막 샘플 5분 안).
 *   가상 시각이 켜져 있으면(시뮬레이터·시각 점프·시나리오 채우기 뒤) 시작하지 않는다. 샘플은 실제 시각이라 섞이기 때문이다.
 * - 수동: 샘플 없이 시계만 흐른다. 도착 처리 버튼으로 진행하고 지연 판정은 시계로 한다.
 *   가상 시각이 켜져 있으면 그 시각에서 1배로 흘린다(멈춘 시계로는 지연 판정이 돌지 않는다).
 * - 알림 설정(notifyPrefs)은 엔진을 부를 때마다 다시 읽는다. 진행 중에 끄면 바로 반영된다.
 * - AppState가 background가 되면 watch와 재생, 시계 틱을 멈춘다. 돌아와도 그 사이 경로를 채우지 않고 재생도 자동으로 켜지 않는다.
 * - 백그라운드 동선 기록(bgRecord, 사용자가 켜는 옵션, 기본 꺼짐): 오늘 날짜를 기기 위치로 진행할 때만
 *   services/location/background가 화면 밖까지 받는다. 앱이 떠 있는 동안은 앱 안 감시도 함께 돌린다.
 *   어느 받기를 돌릴지는 core/live/background watchPlan이 정하고, 켜고 끄기는 core/live/watchControl이 한다(진행마다 하나).
 *   스토어는 상태가 바뀔 때 syncWatch를 부르고 그 결과(기록 상태·옵션 끄기·진행 기록 줄)를 옮기기만 한다.
 *   화면 밖 샘플은 엔진이 위치 로그와 도착 기록(방문 op·진행 기록 줄)에만 쓰고 그 구간을 공백으로 보지 않는다.
 *   화면 밖에서는 도착 알림·지연 조정안·빈 시간 추천을 내지 않는다(조정안·추천은 돌아온 뒤 시계 판정이 본다).
 *   화면 밖에서 효과가 없는 샘플(멈춰 있음)은 저장 쓰기를 하지 않고, 현재 위치는 돌아올 때 한 번 넣는다(awayLast).
 *   켤 때만 '항상 허용'을 묻는다. 묻는 동안 권한 창 때문에 바뀌는 앱 상태는 화면 밖으로 보지 않는다(askingBg).
 *   진행을 끝내거나(stop·teardown) 옵션을 끄거나 진행 날짜가 지나면 받기를 멈춘다. 날짜는 자정 타이머와 샘플마다 본다
 *   (안드로이드는 화면 밖에서 타이머가 멈추지만 30초마다 샘플이 온다). 전날 밤에 시작해 앱을 켜 둔 채 자정을 넘기면
 *   시계 틱이 그때 켠다. 시뮬레이터·수동에는 영향이 없다.
 * - 로그아웃·탈퇴, 기기 위치 진행 중 '기기 위치 사용' 끄기, 여행방 삭제·나가기면 진행을 끝낸다(core/live/session liveStopReason).
 * - 위치를 쓰려다 권한이 없어 수동이 되면 그 날짜에 거부 기록을 남긴다(denied, 기록 지도 안내). 위치 로그와 같이 90일 뒤 지운다.
 *   그날을 다시 진행하면(시뮬레이터·기기·수동) 그날 앞 시뮬레이터 재생의 위치 점을 지운다. 거부 기록 규칙과 같다
 *   (권한 거부 프리셋이면 기록 지도가 도착 지점만 잇고, 실제 진행한 날에 시연 점이 실제 이동처럼 그려지지 않는다).
 * - 조정안은 WP4 replanForDelay가 만든다. 시연 중에는 조정안이 뜨면 재생을 멈추고, 적용·원래대로를 누르면 이어서 재생한다.
 *   계산하는 동안에도 멈춘다(run.calcPause). 계산 중에 사용자가 재생·멈춤을 누르거나 화면 밖으로 가면 그 상태를 따르고,
 *   진행을 다시 시작하면(프리셋 바꿈) 조정안 때문에 멈춘 재생을 물려받지 않는다.
 * - 시작 중 기다림(일정 계산·구간 모양·권한) 뒤에는 로그아웃·여행방 삭제·나가기를 다시 본다(구독을 걸기 전이라).
 */

export type LiveMode = 'off' | 'sim' | 'device' | 'manual';
export type SimSpeed = 1 | 10 | 60 | 300;

/** 조정안 시트의 안내 한 줄에 쓰는 값(LiveProposal은 동결 타입이라 따로 둔다) */
export interface ProposalInfo {
  spotId: string;
  name: string;
  etaMin: number;
  plannedArriveMin: number;
}

export interface LiveState {
  permission: LocationPermission;
  mode: LiveMode;
  sim: { preset: SimPresetId; speed: SimSpeed; playing: boolean; virtualNow?: number };
  last?: GpsSample;
  arrival: ArrivalState;
  proposals: LiveProposal[];
  freeTime?: FreeTime;
  notifyLog: NotifyLogEntry[];
  /** tripId → date → 위치 로그 */
  track: Record<string, Record<string, TrackPoint[]>>;
  /** tripId → date → 위치 권한 거부 기록(기록 지도가 그날 거부였는지 안다) */
  denied: DeniedStore;
  /** 백그라운드 동선 기록 옵션. 사용자가 켠다(기본 꺼짐). 기기 위치로 진행할 때만 쓴다 */
  bgRecord: boolean;
  /** 지금 백그라운드 받기가 돌고 있는지 */
  bgActive: boolean;

  /* WP5 화면용 */
  tripId?: string;
  date?: string;
  /** 사용자가 고른 진행 방식(권한이 없으면 mode가 manual이 된다) */
  requested?: 'sim' | 'device' | 'manual';
  statuses: Record<string, VisitStatus>;
  timing?: Timing | null;
  shadow: boolean;
  /** 정확도를 모르는 샘플만 오는 중(웹). 도착은 버튼으로 기록한다 */
  accuracyUnknown: boolean;
  background: boolean;
  log: LiveLogLine[];
  proposalInfo: Record<string, ProposalInfo>;
  simWindow?: { startAt: number; endAt: number };

  start: (tripId: string, date: string, mode: LiveMode) => void;
  stop: () => void;
  setPreset: (preset: SimPresetId) => void;
  setSpeed: (speed: SimSpeed) => void;
  play: () => void;
  pause: () => void;
  jumpTo: (t: number) => void;
  /** adjustmentId가 없으면 첫 조정안(추천)을 적용한다 */
  acceptProposal: (id: string, adjustmentId?: string) => void;
  rejectProposal: (id: string) => void;
  dismissFreeTime: () => void;
  markArrived: (spotId: string) => void;
  cancelArrival: (visitId: string) => void;
  pruneTrack: (now: number) => void;
  /** 백그라운드 동선 기록을 켜고 끈다. 켤 때만 권한을 묻고, 켤 수 없으면 이유를 돌려준다 */
  setBgRecord: (on: boolean) => Promise<BgEnableResult>;
  reset: () => void;
  waitHydrated: () => Promise<void>;
}

const LOG_MAX = 40;
const TICK_MS = 500;
/** 샘플 없이 시계로 판정하는 간격(앱 시각) */
const EVAL_TICK_MS = 5_000;
/** 시뮬레이터 시작 때 구간 모양을 기다리는 상한(실제 시각). 지도가 먼저 받았으면 바로 끝난다 */
const SHAPE_WAIT_MS = 1_500;

const initial = {
  permission: 'undetermined' as LocationPermission,
  mode: 'off' as LiveMode,
  sim: { preset: 'full1018' as SimPresetId, speed: 60 as SimSpeed, playing: false },
  last: undefined as GpsSample | undefined,
  arrival: {} as ArrivalState,
  proposals: [] as LiveProposal[],
  freeTime: undefined as FreeTime | undefined,
  notifyLog: [] as NotifyLogEntry[],
  track: {} as Record<string, Record<string, TrackPoint[]>>,
  denied: {} as DeniedStore,
  bgRecord: false,
  bgActive: false,
  tripId: undefined as string | undefined,
  date: undefined as string | undefined,
  requested: undefined as LiveState['requested'],
  statuses: {} as Record<string, VisitStatus>,
  timing: undefined as Timing | null | undefined,
  shadow: false,
  accuracyUnknown: false,
  background: false,
  log: [] as LiveLogLine[],
  proposalInfo: {} as Record<string, ProposalInfo>,
  simWindow: undefined as LiveState['simWindow'],
};

/* ---------- 실행 중 자원(저장하지 않는다) ---------- */

interface Runtime {
  tripId: string;
  date: string;
  memberId: string;
  requested: 'sim' | 'device' | 'manual';
  ctx: EngineCtx;
  engine: EngineState;
  categories: Record<string, Category>;
  track?: SimTrack;
  /** 시뮬레이터 궤적 입력(구간 모양 빼고). 늦게 받은 구간 모양으로 같은 입력의 궤적을 다시 만든다 */
  simInput?: GenerateTrackInput;
  /**
   * 지금까지 받은 구간 모양(legGeometryKey → 길 모양). 시뮬레이터 점이 따라가는 지도 선이고,
   * 엔진이 이동 중 남은 시간을 재는 길이다(ctxOf가 EngineCtx.legShapes로 넣는다).
   */
  legShapes: Record<string, LatLng[]>;
  photos?: PhotoProvider;
  /** 앱 안 감시(기기·시뮬레이터)와 백그라운드 받기(백그라운드 동선 기록) 제어 */
  watch?: WatchControl;
  /** 화면 밖에서 효과 없이 받은 마지막 샘플. 저장 쓰기를 줄이려고 화면 값(last)에는 돌아올 때 넣는다 */
  awayLast?: GpsSample;
  restoreServices?: () => void;
  tick?: ReturnType<typeof setInterval>;
  lastTickT: number;
  /** 마지막으로 시계 판정(tickAt)을 한 앱 시각 */
  lastEvalT: number;
  unsubTrips?: () => void;
  unsubSession?: () => void;
  appState?: { remove(): void };
  /** 조정안 때문에 멈춘 재생을 결정 뒤 다시 켤지 */
  resumeAfterDecision: boolean;
  /**
   * 조정안을 계산하려고 재생을 멈췄으면 그 계산 번호. 계산 중에 사용자가 재생·멈춤을 누르거나 화면 밖으로 가면 지운다.
   * 지워졌으면 계산이 끝나도 재생을 대신 켜지 않고, 고른 뒤 재생하도록 남기지도 않는다(사용자가 고른 상태를 따른다).
   */
  calcPause?: number;
}

let rt: Runtime | undefined;
/** 백그라운드 받기. 작업 정의는 이 모듈을 불러올 때(index.ts) 이미 끝났다 */
const bgLocation = createBackgroundLocation();
/** 시뮬레이터 시계는 stop 뒤에도 남는다(앱 시계로 남아 가상 시각이 되돌아가지 않게). */
let simClock: SimClock | undefined;
let startSeq = 0;
/** 조정안 계산 번호. 진행의 calcPause가 어느 계산 때문에 멈춘 것인지 가린다(계산이 겹쳐도 앞 계산이 재생을 켜지 않게) */
let calcSeq = 0;
/**
 * '항상 허용'을 묻는 중인지(setBgRecord). iOS는 권한 창이 뜨면 inactive, 안드로이드 11부터는 설정 화면으로 넘어가 background가
 * 된다. 이것을 화면 밖으로 보면 앱 안 감시가 멈추고 공백이 생기고 반경 진입 기록이 버려진다. 묻는 동안은 무시한다.
 * 응답은 앱으로 돌아올 때 오므로(iOS DidBecomeActive, 안드로이드 설정 화면에서 돌아옴) 끝난 뒤 따로 맞추지 않는다.
 * 응답과 active 이벤트의 순서는 정해져 있지 않아, 끝난 직후 AppState.currentState로 맞추면 같은 문제가 다시 생긴다.
 */
let askingBg = false;

type PhotoImporter = (tripId: string, picked: PickedPhoto[]) => Promise<Photo[]>;
let photoImporter: PhotoImporter | undefined;

/**
 * 사진 이벤트를 올릴 함수(WP6 importPhotos). features/journal/api가 이 스토어를 import하므로
 * 순환을 피하려고 features/live/photoBridge가 앱 시작 때 등록한다.
 */
export function registerPhotoImporter(fn: PhotoImporter): void {
  photoImporter = fn;
}

function toast(text: string, tone: 'soft' | 'warn' = 'soft') {
  useUi.getState().showToast(text, tone);
}

/**
 * 엔진에 넘길 입력. 알림 설정은 부를 때마다 다시 읽는다(진행 중에 끄면 바로 반영).
 * 구간 길 모양은 지금까지 받은 것(run.legShapes)을 넣는다. 늦게 받은 모양도 다음 판정부터 쓴다.
 */
function ctxOf(run: Runtime): EngineCtx {
  const prefs = useSession.getState().notifyPrefs;
  if (run.ctx.prefs !== prefs || run.ctx.legShapes !== run.legShapes) run.ctx = { ...run.ctx, prefs, legShapes: run.legShapes };
  return run.ctx;
}

function nameOf(spotId: string): string {
  return rt?.ctx.day.items.find((i) => i.spotId === spotId)?.name ?? '스팟';
}

function ensureSimClock(startAt: number, speed: SimSpeed): SimClock {
  if (!simClock) simClock = createSimClock(systemClock, startAt, speed);
  else {
    simClock.pause();
    simClock.jumpTo(startAt);
    simClock.setSpeed(speed);
  }
  setClockOverride(simClock);
  return simClock;
}

/** 그날 구간 모양을 받기 시작한다. 지도 선과 같은 구간(dayLegs)·같은 메모(useLegGeometry)다. 구간은 한꺼번에 묻는다 */
function gatherDayShapes(trip: Trip, day: DayPlan): LegShapeGather {
  return gatherLegShapes(dayLegs(day, coordLookup(trip), trip.transport), legGeometry);
}

/** 모두 받거나 상한(ms)이 지나면 풀린다 */
function waitShapes(g: LegShapeGather, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([g.done, limit]).then(() => clearTimeout(timer));
}

/** 실행 중 자원을 모두 푼다. 시뮬레이터 시계는 멈추기만 하고 앱 시계로 남긴다. */
function teardown() {
  if (!rt) return;
  // 앱 안 감시, 백그라운드 받기, 자정 타이머를 모두 푼다.
  rt.watch?.dispose();
  if (rt.tick) clearInterval(rt.tick);
  rt.restoreServices?.();
  rt.unsubTrips?.();
  rt.unsubSession?.();
  rt.appState?.remove();
  simClock?.pause();
  rt = undefined;
}

export const useLive = create<LiveState>()(
  persist(
    (set, get) => {
      /* ---------- 효과 적용 ---------- */

      const pushLog = (lines: LiveLogLine[]) => {
        if (lines.length === 0) return;
        set({ log: [...lines.slice().reverse(), ...get().log].slice(0, LOG_MAX) });
      };

      /** 엔진 상태 중 화면이 쓰는 값 */
      const engineView = (run: Runtime): Partial<LiveState> => {
        const tr = run.engine.tracker;
        const cur = tr.current && !tr.current.left ? tr.current : undefined;
        const arrival: ArrivalState = cur
          ? { spotId: cur.spotId, enteredAt: cur.arrivedAt, visitId: `v-${run.date}-${cur.spotId}-${run.memberId}` }
          : tr.candidate
            ? { spotId: tr.candidate.spotId, enteredAt: tr.candidate.enteredAt }
            : {};
        return {
          statuses: tr.statuses,
          timing: run.engine.timing,
          shadow: tr.shadow,
          accuracyUnknown: !!tr.accuracyUnknown,
          notifyLog: run.engine.notifyLog,
          arrival,
        };
      };

      const syncEngine = () => {
        if (!rt) return;
        set(engineView(rt));
      };

      const recordVisit = (spotId: string, status: Visit['status'], at: number, arrivedAt: number | undefined, manual: boolean) => {
        if (!rt) return;
        const trip = useTrips.getState().docs[rt.tripId];
        if (!trip) return;
        const source: Visit['source'] = manual ? 'manual' : rt.requested === 'sim' ? 'sim' : 'gps';
        const base = visitRecord({ date: rt.date, spotId, memberId: rt.memberId, status, source, at, arrivedAt });
        const visit = { ...base, at: nextVisitAt(trip, base.id, at) };
        useTrips.getState().dispatch(rt.tripId, { type: 'journal/visit', visit }, { actorId: rt.memberId, quiet: true });
      };

      const makeProposal = async (e: Extract<EngineEffect, { kind: 'delay' }>) => {
        const run = rt;
        if (!run) return;
        const ts = useTrips.getState();
        const trip = ts.docs[run.tripId];
        const plan = ts.plans[run.tripId];
        if (!trip || !plan) return;
        const tr = run.engine.tracker;
        const last = get().last;
        const position = replanPosition(run.ctx.day, tr, last && isAccurate(last) ? last.coord : undefined);
        const now = appClock().now();
        // 시연 중에는 조정안을 계산하는 동안에도 가상 시각을 멈춘다. 계산이 경로 서버를 기다리는 사이 재생이 흐르면
        // (300배속이면 몇 초에 몇 시간) 조정안이 이미 지난 상황을 묻게 된다(2026-10-09 웹 실행에서 11:10 지연이 13:20 뒤에 뜸).
        // 멈춘 것은 진행에 이 계산 번호로 남긴다(run.calcPause). 계산 중에 사용자가 재생·멈춤을 누르거나 화면 밖으로 가면 지워진다.
        calcSeq += 1;
        const calc = calcSeq;
        if (run.requested === 'sim' && simClock?.playing()) {
          simClock.pause();
          run.calcPause = calc;
          set({ sim: { ...get().sim, playing: false } });
        }
        let adjustments: LiveProposal['adjustments'] = [];
        try {
          const r = await replanForDelay(
            {
              trip,
              plan,
              date: run.date,
              now,
              position,
              visitedSpotIds: doneSpotIds(tr, 'arrived'),
              skippedSpotIds: doneSpotIds(tr, 'skipped'),
              delayMin: e.delayMin,
            },
            { routes: getServices().routes, now },
          );
          adjustments = r.adjustments;
        } catch {
          adjustments = [];
        }
        if (rt !== run) return;
        // 이 계산 때문에 멈춘 채 그대로인지. 그사이 사용자가 재생·멈춤을 눌렀거나 화면 밖으로 갔으면 사용자가 고른 상태를 따른다.
        const pausedForCalc = run.calcPause === calc;
        if (pausedForCalc) run.calcPause = undefined;
        if (adjustments.length === 0) {
          // 흡수할 조정안이 없으면 이 지연으로는 다시 묻지 않고 그대로 간다. 계산하려고 멈췄으면 다시 재생한다.
          run.engine = acknowledgeDelay(run.engine, e.delayMin);
          pushLog([{ t: now, text: `${e.name} 조정안 없이 그대로 진행`, icon: 'right' }]);
          if (pausedForCalc && simClock && !simClock.playing() && !get().background) {
            simClock.play();
            set({ sim: { ...get().sim, playing: true } });
          }
          return;
        }
        const id = getServices().ids.next('lp');
        const proposal: LiveProposal = { id, createdAt: e.at, delayMin: e.delayMin, adjustments };
        // 시연 중에는 조정안을 읽는 동안 가상 시각이 흐르지 않게 멈춘다. 계산 전에 멈춘 채 그대로면 두고,
        // 계산 중에 사용자가 다시 재생했으면 여기서 멈춘다. 어느 쪽이든 고르면 이어서 재생한다(resumeIfPaused).
        // 계산 중에 사용자가 멈췄거나 화면 밖으로 갔으면 멈춘 채 두고 고른 뒤에도 켜지 않는다.
        let resume = pausedForCalc;
        if (run.requested === 'sim' && simClock?.playing()) {
          simClock.pause();
          set({ sim: { ...get().sim, playing: false } });
          resume = true;
        }
        if (resume) run.resumeAfterDecision = true;
        set({
          proposals: [proposal],
          proposalInfo: { [id]: { spotId: e.spotId, name: e.name, etaMin: e.etaMin, plannedArriveMin: e.plannedArriveMin } },
        });
      };

      const lookFreeTime = async (e: Extract<EngineEffect, { kind: 'freeTime' }>) => {
        const run = rt;
        if (!run) return;
        const trip = useTrips.getState().docs[run.tripId];
        if (!trip) return;
        const ft = await findFreeTime({
          gapMin: e.gapMin,
          until: e.until,
          position: e.position,
          places: getServices().places,
          excludePlaceIds: trip.spots.map((s) => s.placeId),
        });
        if (rt !== run || !ft) return;
        set({ freeTime: ft });
        pushLog([freeTimeLine(e.at, e.gapMin, ft.places.length)]);
      };

      /**
       * 엔진 효과를 옮기고 화면 상태(위치 로그·진행 기록·엔진 값, patch)를 set 한 번으로 바꾼다.
       * 저장(persist)은 set마다 위치 로그 전체를 직렬화해 쓰므로, 샘플 하나에 set을 한 번만 부른다
       * (백그라운드 기록 중에는 화면 밖에서도 30초마다 돈다).
       */
      const applyEffects = (effects: EngineEffect[], manual = false, patch: Partial<LiveState> = {}) => {
        const run = rt;
        if (!run) return;
        let track = get().track;
        let trackChanged = false;
        let arrived = false;
        const lines: LiveLogLine[] = [];
        for (const e of effects) {
          switch (e.kind) {
            case 'track':
              track = appendTrack(track, run.tripId, run.date, e.point);
              trackChanged = true;
              break;
            case 'visit':
              recordVisit(e.spotId, e.status, e.at, e.arrivedAt, manual);
              if (e.status === 'arrived') arrived = true;
              break;
            case 'arrivalNotice':
              toast(`${e.name} 도착을 기록했어요`);
              break;
            case 'delay':
              void makeProposal(e);
              break;
            case 'freeTime':
              void lookFreeTime(e);
              break;
            default:
              break;
          }
          const line = logLine(e, nameOf);
          if (line) lines.push(line);
        }
        // 방문 기록을 올리는 사이 진행이 끝났으면(여행방 변경으로 stop) 끝난 화면 값을 엔진 값으로 덮지 않는다.
        const next: Partial<LiveState> = { ...patch, ...(rt === run ? engineView(run) : {}) };
        if (trackChanged) next.track = track;
        // 다음 스팟에 도착하면 빈 시간은 끝났다. 추천 카드를 남겨 두지 않는다.
        if (arrived && get().freeTime) next.freeTime = undefined;
        if (lines.length > 0) next.log = [...lines.slice().reverse(), ...get().log].slice(0, LOG_MAX);
        set(next);
      };

      /* ---------- 샘플·시계·앱 상태 ---------- */

      const onSample = (sample: GpsSample) => {
        const run = rt;
        if (!run) return;
        // 진행 날짜가 지났는지 샘플마다 본다(자정 타이머가 화면 밖에서 돌지 않는 기기 대비). 지났으면 받기를 멈추고,
        // 화면 밖이면 이 샘플부터 공백이다(엔진이 버린다).
        if (run.watch?.bgActive()) syncWatch();
        if (rt !== run) return;
        const r = ingestSample(run.engine, sample, ctxOf(run));
        run.engine = r.state;
        // 현재 위치는 앞으로만 간다. 앱이 떠 있을 때 백그라운드 받기가 뒤늦게 넘긴 멈춘 자리(앱 안 감시보다 이른 샘플)를
        // 엔진이 버렸으면, 지도 점과 조정안 위치(makeProposal)를 그 옛 자리로 되돌리지 않는다. 시뮬레이터 되감기는 엔진이 받는다.
        const prev = run.awayLast ?? get().last;
        const current = r.state.last === sample || prev == null || sample.t > prev.t;
        if (r.effects.length === 0 && run.engine.background.inBackground) {
          // 화면 밖에서 효과가 없으면(멈춰 있어 위치 로그도 도착도 없음) set을 부르지 않는다. 저장(persist)은 set마다
          // 위치 로그 전체를 쓰는데, 안드로이드는 멈춰 있어도 30초마다 샘플이 온다. 현재 위치는 돌아올 때 넣는다.
          if (current) run.awayLast = sample;
          return;
        }
        if (current) run.awayLast = undefined;
        applyEffects(r.effects, false, current ? { last: sample } : {});
      };

      /**
       * 위치 받기를 지금 상태에 맞춘다(core/live/watchControl, 판정은 watchPlan). 진행 시작, 앱 상태 변화, 옵션 켜고 끄기,
       * 시계 틱, 샘플이 부른다(자정 타이머·받기 실패는 제어 안에서 다시 맞춘다). 이미 맞으면 아무것도 하지 않는다.
       */
      const syncWatch = () => {
        rt?.watch?.sync();
      };

      /** 이 진행의 받기 제어. 기록 상태는 엔진과 화면(bgActive)에, 실패는 옵션 끄기에, 줄은 진행 기록에 옮긴다 */
      const watchControlFor = (run: Runtime): WatchControl =>
        createWatchControl({
          date: run.date,
          intervalMs: LOCATION_INTERVAL_MS,
          bg: bgLocation,
          fg: () => getServices().location,
          now: () => appClock().now(),
          setTimer: (fn, ms) => setTimeout(fn, ms),
          clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
          read: () => ({ pref: get().bgRecord, mode: get().mode, inBackground: run.engine.background.inBackground }),
          onSample,
          onRecording: (on, at, stillSilent) => {
            if (rt === run) run.engine = engineRecording(run.engine, on, at, { stillSilent });
            set({ bgActive: on });
          },
          onFail: () => {
            if (rt === run) set({ bgRecord: false });
          },
          onLine: (text, at) => {
            if (rt === run) pushLog([{ t: at, text, icon: 'locate' }]);
          },
        });

      const importSimPhotos = async (multiple: boolean, t: number) => {
        const run = rt;
        if (!run?.photos || !photoImporter) return;
        try {
          const picked = await run.photos.pick({ multiple });
          // 고르는 사이 재생을 끝냈거나 프리셋을 바꿨으면 옛 재생의 사진을 올리지 않는다.
          if (rt !== run) return;
          const photos = await photoImporter(run.tripId, picked);
          if (photos.length > 0) pushLog([photoLine(t, photos.length, photos.filter((p) => p.source === 'estimated').length)]);
        } catch {
          // 사진 이벤트가 실패해도 여행 진행은 계속한다.
        }
      };

      const onTick = () => {
        const run = rt;
        if (!run) return;
        const now = appClock().now();
        const st = get();
        if (run.requested === 'sim' && run.track) {
          if (st.sim.virtualNow !== now) set({ sim: { ...st.sim, virtualNow: now } });
          if (now > run.lastTickT) {
            for (const ev of eventsBetween(run.track.events, run.lastTickT, now)) void importSimPhotos(ev.multiple, ev.t);
          }
          if (now >= run.track.endAt && simClock?.playing()) {
            simClock.pause();
            set({ sim: { ...get().sim, playing: false } });
            pushLog([{ t: now, text: '재생 끝 · 오늘 일정을 모두 흘렸습니다', icon: 'check' }]);
          }
        }
        // 수동 진행은 샘플이 없고, 기기는 멈춰 있으면 샘플이 끊길 수 있다. 그래서 시계로도 판정한다.
        // 시뮬레이터는 30초(가상)마다 샘플이 오므로 샘플마다 판정한다.
        if ((st.mode === 'manual' || st.mode === 'device') && !st.background && Math.abs(now - run.lastEvalT) >= EVAL_TICK_MS) {
          run.lastEvalT = now;
          // 앱이 떠 있는 동안 자정을 넘기면 받기를 맞춘다. 돌던 백그라운드 받기는 멈추고(타이머가 늦게 돌아도),
          // 진행 날짜 전날 밤에 시작한 진행은 그날이 되면 켠다. watchPlan은 순수 함수라 틱마다 불러도 된다.
          if (st.mode === 'device') syncWatch();
          const prevTracker = run.engine.tracker;
          const r = tickAt(run.engine, now, ctxOf(run));
          run.engine = r.state;
          if (r.effects.length > 0) applyEffects(r.effects);
          else if (
            r.state.timing?.nextIdx !== st.timing?.nextIdx ||
            r.state.timing?.delayMin !== st.timing?.delayMin ||
            r.state.tracker !== prevTracker
          )
            syncEngine();
        }
        if (st.freeTime && now > st.freeTime.until) set({ freeTime: undefined });
        run.lastTickT = now;
      };

      const startTick = () => {
        if (!rt) return;
        if (rt.tick) clearInterval(rt.tick);
        rt.tick = setInterval(onTick, TICK_MS);
      };

      const onAppState = (status: AppStateStatus) => {
        const run = rt;
        if (!run) return;
        // '항상 허용' 권한 창 때문에 inactive·background가 된 것은 화면 밖으로 간 것이 아니다(askingBg).
        if (askingBg && status !== 'active') return;
        const r = engineAppPhase(run.engine, status as AppPhase, appClock().now());
        run.engine = r.state;
        if (r.state.background.inBackground && !get().background) {
          // 화면 밖에서는 시계 판정을 하지 않는다. 백그라운드 기록 중에도 틱이 CPU를 깨우지 않게 멈춘다(돌아오면 다시 켠다).
          if (run.tick) clearInterval(run.tick);
          run.tick = undefined;
          // 돌아와도 재생을 자동으로 켜지 않는다. 조정안 계산 때문에 멈춘 표시도 지운다(계산이 끝나도 재생을 켜지 않게).
          run.calcPause = undefined;
          if (r.stop && simClock?.playing()) simClock.pause();
          set(r.stop ? { background: true, sim: { ...get().sim, playing: false } } : { background: true });
        }
        // 앱 안 감시는 화면 밖에서 멈추고 돌아오면 켠다. 백그라운드 받기는 기록 중이면 그대로 둔다(날짜가 지났으면 멈춘다).
        syncWatch();
        if (r.resumed && rt === run) {
          // 화면 밖에서 저장을 건너뛴 현재 위치와 엔진 값(반경 진입 등)을 한 번에 넣는다.
          const awayLast = run.awayLast;
          run.awayLast = undefined;
          set({ background: false, ...(awayLast ? { last: awayLast } : {}), ...engineView(run) });
          if (!run.tick) startTick();
          if (get().mode === 'device') {
            const text = r.state.background.recording
              ? '앱으로 돌아옴 · 화면 밖에 있던 동안도 동선과 도착을 기록함'
              : '앱으로 돌아옴 · 꺼져 있던 동안의 경로는 채우지 않음';
            pushLog([{ t: appClock().now(), text, icon: 'locate' }]);
          }
        }
      };

      /** 진행을 끝내야 하는 이유(로그아웃·탈퇴, 기기 위치 진행 중 '기기 위치 사용' 끔, 여행방 삭제·나가기). 없으면 undefined */
      const invalidReason = (tripId: string, mode: LiveMode) => {
        const ses = useSession.getState();
        const trip = useTrips.getState().docs[tripId];
        return liveStopReason({
          signedIn: ses.session != null,
          useDevice: ses.useDeviceLocation,
          mode,
          tripExists: trip != null,
          member: trip != null && myMemberId(trip) != null,
        });
      };

      /** 끝내야 하는 이유가 있으면 진행을 끝내고(모든 받기를 멈춘다) 이유를 알린다. 진행을 시작하는 중 기다린 뒤에도 쓴다 */
      const stopFor = (tripId: string, mode: LiveMode): boolean => {
        const reason = invalidReason(tripId, mode);
        if (!reason) return false;
        get().stop();
        toast(LIVE_STOP_TEXT[reason]);
        return true;
      };

      /** 세션·기기 위치 설정·여행방이 바뀌면 진행을 그대로 둘지 본다 */
      const stopIfInvalid = (): boolean => (rt ? stopFor(rt.tripId, get().mode) : false);

      /**
       * 시뮬레이터 궤적을 지금 입력(simInput)과 지금까지 받은 구간 모양으로 다시 만들고 위치 제공자를 새 궤적으로 덮는다.
       * 이미 흘린 시각은 다시 흘리지 않는다(위치 제공자가 지금 시각부터 넘긴다).
       */
      const rebuildSimTrack = (run: Runtime) => {
        if (!run.simInput || !simClock) return;
        const track = generateTrack({ ...run.simInput, legShapes: run.legShapes });
        run.track = track;
        run.restoreServices?.();
        run.restoreServices = overrideServices({
          location: createSimLocation({ clock: simClock, samples: track.samples, permission: track.permission }),
          ...(run.photos ? { photos: run.photos } : {}),
        });
        set({ simWindow: { startAt: get().simWindow?.startAt ?? track.startAt, endAt: track.endAt } });
        // 새 궤적으로 다시 구독한다. 화면 밖이면 돌아올 때 켠다.
        run.watch?.restartFg();
      };

      /** 상한 뒤에 받은 구간 모양. 새 모양이 있으면 같은 입력으로 궤적을 다시 만든다(점이 그 구간부터 길을 따라간다) */
      const addLateShapes = (run: Runtime, g: LegShapeGather) => {
        void g.done.then(() => {
          if (rt !== run || run.track?.permission !== 'granted') return;
          if (newShapeKeys(g.got, run.legShapes).length === 0) return;
          run.legShapes = { ...run.legShapes, ...g.got };
          rebuildSimTrack(run);
        });
      };

      /** 계획이 다시 계산되면(조정안 적용 등) 그날 입력을 바꾸고, 시연 중이면 지금 위치에서 궤적을 이어 만든다. */
      const onTripsChange = () => {
        const run = rt;
        if (!run) return;
        const ts = useTrips.getState();
        if (stopIfInvalid()) return;
        const plan = ts.plans[run.tripId];
        const trip = ts.docs[run.tripId];
        const day = plan?.days.find((d) => d.date === run.date);
        if (!trip || !day) return;
        const next = liveDayFromTrip(trip, day);
        if (sameLiveDay(run.ctx.day, next)) return;
        run.ctx = { ...run.ctx, day: next };
        if (run.requested === 'sim' && run.track && run.track.permission === 'granted' && simClock) {
          const now = simClock.now();
          const last = get().last;
          run.simInput = {
            day: next,
            preset: get().sim.preset,
            categories: run.categories,
            resume: {
              t: now,
              coord: last?.coord ?? replanPosition(next, run.engine.tracker),
              doneSpotIds: doneSpotIds(run.engine.tracker),
              // 지금 구간 길 위 직전 진행(엔진 판정). 같은 구간이면 겹친 길(유턴)에서 뒤쪽 차선으로 붙지 않는다.
              along: run.engine.timing?.along,
            },
          };
          // 아는 구간 모양으로 바로 이어 만든다. 바뀐 구간(빠진 스팟 앞뒤를 잇는 새 구간 등)은 받는 대로 다시 만든다.
          rebuildSimTrack(run);
          addLateShapes(run, gatherDayShapes(trip, day));
        }
        // 화면 밖(백그라운드 기록 중 iOS는 앱이 살아 있어 동기화가 계속 온다)에서는 그날 입력만 바꾼다.
        // 지연 조정안(경로 요청)·빈 시간 추천(주변 조회)은 돌아온 뒤 첫 시계 판정(tickAt)이 본다.
        if (run.engine.background.inBackground) return;
        // 바뀐 계획으로 다음 스팟·예상 도착을 바로 다시 잰다(다음 샘플이나 멈춘 수동 시계를 기다리지 않는다).
        const last = get().last;
        const r = evaluateAt(run.engine, appClock().now(), ctxOf(run), last && isAccurate(last) ? last.coord : undefined);
        run.engine = r.state;
        applyEffects(r.effects);
      };

      /* ---------- 시작 ---------- */

      const startLive = async (tripId: string, date: string, requested: 'sim' | 'device' | 'manual') => {
        startSeq += 1;
        const seq = startSeq;
        // 조정안 때문에(계산 중·고르는 중) 멈춘 시연을 다시 시작하면(프리셋 바꿈 등) 그 멈춤을 물려받지 않는다. 사용자는 재생 중이었다.
        if (rt?.requested === 'sim' && (rt.calcPause != null || rt.resumeAfterDecision)) set({ sim: { ...get().sim, playing: true } });
        teardown();
        const ts = useTrips.getState();
        const trip = ts.docs[tripId];
        if (!trip) {
          toast('여행방을 찾을 수 없습니다', 'warn');
          return;
        }
        const plan = ts.plans[tripId] ?? (await ts.recompute(tripId));
        if (seq !== startSeq) return;
        const day = plan?.days.find((d) => d.date === date);
        if (!day || day.items.length === 0) {
          toast('이 날짜에는 계산된 일정이 없습니다. 후보를 담고 루트를 계산해 주세요', 'warn');
          set({ mode: 'off' });
          return;
        }
        let doc = useTrips.getState().docs[tripId] ?? trip;
        const memberId = myMemberId(doc);
        if (!memberId) {
          toast('이 여행방의 멤버가 아닙니다', 'warn');
          return;
        }
        const liveDay: LiveDay = liveDayFromTrip(doc, day);
        const categories: Record<string, Category> = {};
        for (const s of doc.spots) categories[s.id] = s.category;
        if (requested === 'device' && isClockOverridden()) {
          // 가상 시각(시뮬레이터·시각 점프·시나리오)이 앱 시계인데 기기 샘플은 실제 시각이다. 섞으면 도착·지연이 틀어진다.
          toast('가상 시각이 켜져 있어 기기 위치로 시작하지 않습니다. 더보기에서 시연을 처음 상태로 되돌린 뒤 시작해 주세요', 'warn');
          set({ mode: 'off' });
          return;
        }
        const prefs = useSession.getState().notifyPrefs;
        get().pruneTrack(appClock().now());

        // 시뮬레이터는 프리셋을 처음부터 다시 재생한다. 기기·수동은 이미 남긴 방문 기록에서 이어 간다.
        const statuses = requested === 'sim' ? {} : statusesFromVisits(doc, date, memberId);
        let engine = initialEngine({ statuses, notifyLog: freshNotifyLog(get().notifyLog, appClock().now()) });
        let permission: LocationPermission = get().permission;
        let track: SimTrack | undefined;
        let simInput: GenerateTrackInput | undefined;
        let legShapes: Record<string, LatLng[]> = {};
        let shapes: LegShapeGather | undefined;
        let photos: PhotoProvider | undefined;
        let restoreServices: (() => void) | undefined;

        if (requested === 'sim') {
          // 점이 지도 선(길)을 따라가게 그날 구간 모양을 받는다. 상한까지만 기다리고 못 받은 구간은 직선으로 시작한다.
          shapes = gatherDayShapes(doc, day);
          await waitShapes(shapes, SHAPE_WAIT_MS);
          if (seq !== startSeq) return;
          // 기다리는 사이 로그아웃했거나 여행방을 지웠거나 나갔으면 옛 문서로 시작하지 않는다.
          // 시뮬레이터 시계를 앱 시계로 바꾸거나 옛 방문 기록을 취소로 덮기 전에 본다.
          const fresh = useTrips.getState();
          const freshDoc = fresh.docs[tripId];
          if (stopFor(tripId, requested) || !freshDoc) return;
          // 기다리는 사이 그날 계획이 바뀌었으면 바뀐 계획으로 다시 시작한다(받은 모양은 메모에 있어 바로 끝난다).
          const freshDay = fresh.plans[tripId]?.days.find((d) => d.date === date);
          if (freshDay && freshDoc && !sameLiveDay(liveDay, liveDayFromTrip(freshDoc, freshDay))) {
            void startLive(tripId, date, requested);
            return;
          }
          // 그날 시간표는 같다. 옛 방문 기록 덮기·영업 종료는 지금 문서로 본다.
          doc = freshDoc;
          const { preset, speed } = get().sim;
          simInput = { day: liveDay, preset, categories, closeMin: closingMinutes(doc, date) };
          legShapes = { ...shapes.got };
          track = generateTrack({ ...simInput, legShapes });
          const clock = ensureSimClock(track.startAt, speed);
          photos = createSimPhotoProvider({
            clock: { now: () => appClock().now() },
            getPosition: () => useLive.getState().last?.coord,
            seed: track.seed,
          });
          restoreServices = overrideServices({
            location: createSimLocation({ clock, samples: track.samples, permission: track.permission }),
            photos,
          });
          permission = track.permission;
          // 새 재생은 새 알림 기록으로 시작한다(같은 프리셋을 다시 봐도 조정안이 다시 나온다).
          engine = initialEngine({ statuses });
          // 옛 재생이 남긴 방문 기록은 취소로 덮는다(새 재생이 도달하지 않는 스팟에 옛 도착이 남지 않게).
          const stale = staleSimVisits(doc, date, memberId);
          if (stale.length > 0) {
            const at = clock.now();
            useTrips.getState().dispatchMany(
              tripId,
              stale.map((v) => ({
                type: 'journal/visit' as const,
                visit: { ...v, status: 'cancelled' as const, at: nextVisitAt(doc, v.id, at) },
              })),
              { actorId: memberId, quiet: true },
            );
          }
        } else if (requested === 'device') {
          const loc = getServices().location;
          permission = await loc.permission();
          if (permission === 'undetermined') permission = await loc.request();
          if (seq !== startSeq) return;
        }

        const mode = liveModeFor(requested, permission);
        let bgLine: string | undefined;
        if (mode === 'device' && get().bgRecord && !bgLocation.block()) {
          // 켤 때 받은 '항상 허용'을 설정에서 거뒀으면 여기서는 묻지 않고 옵션을 끈다(켤 때만 묻는다).
          // 이전 설정으로 만든 빌드라 권한을 볼 수 없으면 빌드가 이유라고 남긴다.
          const bgPermission = await bgLocation.permission();
          if (seq !== startSeq) return;
          if (bgPermission !== 'granted') {
            set({ bgRecord: false });
            bgLine = bgPermission === 'notInBuild' ? BG_FAIL_LINE.notInBuild : BG_LINE.noAlways;
          }
        }
        // 기다리는 사이(일정 계산·권한 묻기) 로그아웃했거나 여행방을 지웠거나 나갔거나 기기 위치 사용을 껐으면
        // 기록을 남기거나 받기를 켜기 전에 끝낸다. 여기부터 구독을 걸 때까지 기다림이 없어 그 뒤 변화는 구독이 본다.
        if (stopFor(tripId, mode)) {
          restoreServices?.();
          return;
        }
        // 위치를 쓰려다 권한이 없어 수동이 되면 그 날짜에 남긴다(기록 지도 안내). 그날을 다시 진행하면 옛 시뮬레이터 기록은 지운다.
        const denied = noteLivePermission(get().denied, tripId, date, { requested, permission, at: appClock().now() });
        if (denied !== get().denied) set({ denied });
        // 앞 시뮬레이터 재생의 위치 점도 같은 규칙으로 지운다. 시뮬레이터는 처음부터 다시 재생하고(권한 거부 프리셋이면
        // 기록 지도가 도착 지점만 잇게), 기기·수동 진행은 그날 실제 기록이라 시연 점이 실제 이동처럼 그려지면 안 된다. 기기 점은 남긴다.
        const cleared = clearSimTrackDay(get().track, tripId, date);
        if (cleared !== get().track) set({ track: cleared });
        const now = appClock().now();
        rt = {
          tripId,
          date,
          memberId,
          requested,
          ctx: { tripId, day: liveDay, prefs, source: requested === 'sim' ? 'sim' : 'device', legShapes },
          engine,
          categories,
          track,
          simInput,
          legShapes,
          photos,
          restoreServices,
          lastTickT: now,
          lastEvalT: now,
          resumeAfterDecision: false,
        };
        set({
          mode,
          permission,
          tripId,
          date,
          requested,
          last: undefined,
          proposals: [],
          proposalInfo: {},
          freeTime: undefined,
          shadow: false,
          accuracyUnknown: false,
          background: false,
          log: [],
          simWindow: track ? { startAt: track.startAt, endAt: track.endAt } : undefined,
          sim: { ...get().sim, virtualNow: requested === 'sim' ? now : get().sim.virtualNow },
        });
        if (requested === 'sim') {
          const presetLine: LiveLogLine = { t: now, text: '여행 시뮬레이터 준비 · 실제 위치 아님', icon: 'locate' };
          pushLog([presetLine]);
        }
        if (mode === 'manual') {
          const text = requested === 'manual' ? '수동 진행으로 시작 · 도착은 버튼으로 기록' : '위치 권한이 없어 수동 진행 모드로 시작';
          pushLog([{ t: now, text, icon: 'locate' }]);
        }
        if (bgLine) pushLog([{ t: now, text: bgLine, icon: 'locate' }]);
        if (requested === 'manual' && isClockOverridden()) {
          // 가상 시각이 켜져 있으면 그 시각에서 1배로 흘린다. 멈춘 시계로는 지연 판정과 도착 시각이 모두 한 점에 묶인다.
          if (!simClock || appClock() !== simClock) {
            simClock = createSimClock(systemClock, appClock().now(), 1);
            setClockOverride(simClock);
          }
          simClock.setSpeed(1);
          simClock.play();
          pushLog([{ t: now, text: '가상 시각에서 실제 속도로 진행', icon: 'clock' }]);
        }
        const first = evaluateAt(rt.engine, now, ctxOf(rt));
        rt.engine = first.state;
        syncEngine();
        // 백그라운드 받기를 켜면 받기 제어가 '켜짐' 줄을 남긴다.
        rt.watch = watchControlFor(rt);
        syncWatch();
        if (!get().bgActive && mode === 'device' && get().bgRecord && !bgLocation.block() && kstDate(now) !== date) {
          // 옵션은 켜져 있지만 오늘이 아닌 날짜라 돌리지 않는다. 화면 밖에서 기록된다고 믿지 않게 알린다.
          pushLog([{ t: now, text: BG_LINE.notToday, icon: 'locate' }]);
        }
        startTick();
        rt.appState = AppState.addEventListener('change', onAppState);
        rt.unsubTrips = useTrips.subscribe((s, prev) => {
          if (rt && (s.plans[rt.tripId] !== prev.plans[rt.tripId] || s.docs[rt.tripId] !== prev.docs[rt.tripId])) onTripsChange();
        });
        // 로그아웃·탈퇴하거나 기기 위치 사용을 끄면 진행을 끝낸다(화면 밖 위치 수집이 남지 않게).
        rt.unsubSession = useSession.subscribe((s, prev) => {
          if (s.session !== prev.session || s.useDeviceLocation !== prev.useDeviceLocation) stopIfInvalid();
        });
        // 상한 뒤에 받은 구간 모양으로 다시 만든다(시각·이벤트는 그대로라 재생 중이어도 점만 길로 옮겨 간다).
        if (shapes) addLateShapes(rt, shapes);
        if (requested === 'sim' && get().sim.playing) simClock?.play();
      };

      const resumeIfPaused = () => {
        if (!rt?.resumeAfterDecision) return;
        rt.resumeAfterDecision = false;
        if (rt.requested === 'sim' && simClock && !get().background) {
          simClock.play();
          set({ sim: { ...get().sim, playing: true } });
        }
      };

      return {
        ...initial,

        start: (tripId, date, mode) => {
          if (mode === 'off') {
            get().stop();
            return;
          }
          void startLive(tripId, date, mode);
        },

        stop: () => {
          startSeq += 1;
          teardown();
          set({
            mode: 'off',
            requested: undefined,
            sim: { ...get().sim, playing: false },
            proposals: [],
            proposalInfo: {},
            freeTime: undefined,
            timing: undefined,
            shadow: false,
            accuracyUnknown: false,
            arrival: {},
          });
        },

        setPreset: (preset) => {
          set({ sim: { ...get().sim, preset } });
          if (rt && rt.requested === 'sim') void startLive(rt.tripId, rt.date, 'sim');
        },

        setSpeed: (speed) => {
          simClock?.setSpeed(speed);
          set({ sim: { ...get().sim, speed } });
        },

        play: () => {
          set({ sim: { ...get().sim, playing: true } });
          // 사용자가 고른 재생이다. 조정안 계산 때문에 멈춘 표시는 지운다(계산이 끝나면 조정안을 읽는 동안만 다시 멈춘다).
          if (rt) rt.calcPause = undefined;
          if (rt?.requested === 'sim' && simClock) {
            if (rt.track && simClock.now() >= rt.track.endAt) {
              // 끝까지 재생했으면 처음부터 다시
              void startLive(rt.tripId, rt.date, 'sim');
              return;
            }
            simClock.play();
          }
        },

        pause: () => {
          simClock?.pause();
          if (rt) {
            // 사용자가 멈췄다. 조정안 계산·결정이 끝나도 다시 켜지 않는다.
            rt.resumeAfterDecision = false;
            rt.calcPause = undefined;
          }
          set({ sim: { ...get().sim, playing: false } });
        },

        jumpTo: (t) => {
          if (!simClock) {
            // 시뮬레이터를 켜지 않았어도 시각 점프는 된다(여행 종료 뒤 상태 시연). 지금 앱 시각에서 이어 간다.
            simClock = createSimClock(systemClock, appClock().now(), get().sim.speed);
            setClockOverride(simClock);
          }
          simClock.jumpTo(t);
          set({ sim: { ...get().sim, virtualNow: t } });
          if (rt?.track && t >= rt.track.endAt && simClock.playing()) {
            simClock.pause();
            set({ sim: { ...get().sim, playing: false } });
          }
        },

        acceptProposal: (id, adjustmentId) => {
          const p = get().proposals.find((x) => x.id === id);
          if (!p || !rt) return;
          const adj = p.adjustments.find((a) => a.id === adjustmentId) ?? p.adjustments[0];
          if (adj) {
            const r = useTrips.getState().dispatchMany(rt.tripId, adj.ops, { actorId: rt.memberId });
            if (!r.ok) return;
            pushLog([{ t: appClock().now(), text: `조정안 적용 · ${adj.label}`, icon: 'check' }]);
          }
          rt.engine = acknowledgeDelay(rt.engine, p.delayMin);
          set({ proposals: get().proposals.filter((x) => x.id !== id) });
          resumeIfPaused();
        },

        rejectProposal: (id) => {
          const p = get().proposals.find((x) => x.id === id);
          if (!p) return;
          if (rt) rt.engine = acknowledgeDelay(rt.engine, p.delayMin);
          set({ proposals: get().proposals.filter((x) => x.id !== id) });
          pushLog([{ t: appClock().now(), text: '원래대로 · 일정을 바꾸지 않음', icon: 'x' }]);
          resumeIfPaused();
        },

        dismissFreeTime: () => set({ freeTime: undefined }),

        markArrived: (spotId) => {
          if (!rt) return;
          const r = manualArrival(rt.engine, spotId, appClock().now(), ctxOf(rt));
          rt.engine = r.state;
          applyEffects(r.effects, true);
        },

        cancelArrival: (visitId) => {
          if (!rt) return;
          const trip = useTrips.getState().docs[rt.tripId];
          const found = trip?.visits.find((v) => v.id === visitId);
          const spotId = found?.spotId ?? rt.engine.tracker.current?.spotId;
          if (!spotId || !trip) return;
          rt.engine = cancelArrivalEngine(rt.engine, spotId);
          const now = appClock().now();
          recordVisit(spotId, 'cancelled', now, found?.arrivedAt, found?.source === 'manual');
          pushLog([{ t: now, text: `${nameOf(spotId)} 도착 취소 · 남은 일정으로 되돌림`, icon: 'undo' }]);
          syncEngine();
        },

        pruneTrack: (now) => {
          const docs = useTrips.getState().docs;
          const next = pruneTracks(get().track, docs, now);
          if (Object.keys(next).length !== Object.keys(get().track).length) set({ track: next });
          // 날짜별 권한 거부 기록도 위치 로그와 같이 지운다.
          const denied = pruneTracks(get().denied, docs, now);
          if (Object.keys(denied).length !== Object.keys(get().denied).length) set({ denied });
        },

        setBgRecord: async (on) => {
          if (!on) {
            set({ bgRecord: false });
            // 진행 중이면 백그라운드 받기를 멈춘다(돌고 있었으면 받기 제어가 '끔' 줄을 남긴다). 앱 안 감시는 그대로 돈다.
            syncWatch();
            return { ok: true };
          }
          askingBg = true;
          let r: BgEnableResult;
          try {
            r = await bgLocation.enable();
          } finally {
            askingBg = false;
          }
          if (!r.ok) return r;
          set({ bgRecord: true });
          const run = rt;
          if (run && !get().bgActive) {
            // 켜지면 받기 제어가 '켜짐' 줄을 남긴다. 오늘이 아니라 켜지지 않았을 때만 그 이유를 남긴다
            // (화면 밖이라 아직 못 켰으면 돌아올 때 켜며 '켜짐'을 남긴다).
            syncWatch();
            if (!get().bgActive && get().mode === 'device' && kstDate(appClock().now()) !== run.date) {
              pushLog([{ t: appClock().now(), text: BG_LINE.notToday, icon: 'locate' }]);
            }
          }
          return r;
        },

        reset: () => {
          startSeq += 1;
          teardown();
          simClock = undefined;
          set({ ...initial });
        },

        waitHydrated: (): Promise<void> => waitForHydration(useLive),
      };
    },
    {
      name: STORAGE_KEYS.live,
      version: STORAGE_VERSION,
      storage: persistStorage,
      partialize: (s) => ({
        track: s.track,
        denied: s.denied,
        bgRecord: s.bgRecord,
        notifyLog: s.notifyLog,
        sim: { preset: s.sim.preset, speed: s.sim.speed, playing: false },
      }),
      // 앱을 켤 때마다 90일 지난 위치 로그를 지운다(NFR 개인정보). 19를 다시 열지 않아도 지워져야 한다.
      onRehydrateStorage: () => () => {
        void pruneAfterHydration();
      },
    },
  ),
);

/**
 * 하이드레이션 뒤 위치 로그 정리. 여행방이 복원된 뒤여야 한다(방이 없으면 로그도 지우므로).
 * 여행방 복원이 실패(시간 초과)했으면 지우지 않는다.
 */
async function pruneAfterHydration(): Promise<void> {
  await useTrips.getState().waitHydrated();
  if (!useTrips.persist.hasHydrated()) return;
  useLive.getState().pruneTrack(appClock().now());
}

/** 19 백그라운드 동선 기록 줄. 이 환경에서 켤 수 없는 이유(웹·Expo Go·빌드에 없음). 켤 수 있으면 undefined */
export function backgroundRecordBlock(): BgRecordBlock | undefined {
  return bgLocation.block();
}

/** 13·19의 시뮬레이터 띠. 이 여행방·날짜를 시뮬레이터로 진행 중일 때만(권한 거부 프리셋으로 수동이 돼도) 띄운다. */
export function useSimBanner(tripId: string | undefined, date: string | undefined): boolean {
  return useLive((s) => s.mode !== 'off' && s.requested === 'sim' && s.tripId === tripId && s.date === date);
}

/** 19 화면의 방문 상태(DayTimeline visitStatus). 진행 중인 날짜가 아니면 방문 기록에서 편다. */
export function useVisitStatuses(tripId: string | undefined, date: string | undefined): Record<string, VisitStatus> {
  const live = useLive((s) => (s.tripId === tripId && s.date === date && s.mode !== 'off' ? s.statuses : undefined));
  const trip = useTrips((s) => (tripId ? s.docs[tripId] : undefined));
  if (live) return live;
  if (!trip || !date) return EMPTY_STATUSES;
  return statusesFromVisits(trip, date, myMemberId(trip));
}

const EMPTY_STATUSES: Record<string, VisitStatus> = {};
