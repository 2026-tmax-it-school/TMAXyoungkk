import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  ArrivalState,
  Category,
  FreeTime,
  GpsSample,
  LiveProposal,
  NotifyLogEntry,
  Photo,
  SimPresetId,
  TrackPoint,
  Visit,
} from '../types';
import { LOCATION_INTERVAL_MS, STORAGE_KEYS, STORAGE_VERSION } from '../core/constants';
import type { LocationPermission, PhotoProvider, PickedPhoto } from '../core/ports';
import { isAccurate, type VisitStatus } from '../core/live/arrival';
import type { AppPhase } from '../core/live/background';
import { liveDayFromTrip, type LiveDay } from '../core/live/context';
import type { Timing } from '../core/live/delay';
import {
  acknowledgeDelay,
  cancelArrivalEngine,
  engineAppPhase,
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
import { appendTrack, pruneTracks } from '../core/live/track';
import { replanForDelay } from '../core/planner/replan';
import { createSimClock, type SimClock } from '../core/sim/clock';
import { generateTrack, eventsBetween, type SimTrack } from '../core/sim/track';
import { appClock, isClockOverridden, setClockOverride, systemClock } from '../services/clock';
import { persistStorage, waitForHydration } from '../services/kv';
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
 * - 기기: registry의 location(expo-location, JS 30초 스로틀). 권한이 없으면 수동 진행 모드다.
 *   샘플이 끊겨도 시계로 도착 머묾과 지연을 이어서 본다(엔진 tickAt, 마지막 샘플 5분 안).
 *   가상 시각이 켜져 있으면(시뮬레이터·시각 점프·시나리오 채우기 뒤) 시작하지 않는다. 샘플은 실제 시각이라 섞이기 때문이다.
 * - 수동: 샘플 없이 시계만 흐른다. 도착 처리 버튼으로 진행하고 지연 판정은 시계로 한다.
 *   가상 시각이 켜져 있으면 그 시각에서 1배로 흘린다(멈춘 시계로는 지연 판정이 돌지 않는다).
 * - 알림 설정(notifyPrefs)은 엔진을 부를 때마다 다시 읽는다. 진행 중에 끄면 바로 반영된다.
 * - AppState가 background가 되면 watch와 재생을 멈춘다. 돌아와도 그 사이 경로를 채우지 않고 재생도 자동으로 켜지 않는다.
 * - 조정안은 WP4 replanForDelay가 만든다. 시연 중에는 조정안이 뜨면 재생을 멈추고, 적용·원래대로를 누르면 이어서 재생한다.
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
  reset: () => void;
  waitHydrated: () => Promise<void>;
}

const LOG_MAX = 40;
const TICK_MS = 500;
/** 샘플 없이 시계로 판정하는 간격(앱 시각) */
const EVAL_TICK_MS = 5_000;

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
  photos?: PhotoProvider;
  stopWatch?: () => void;
  restoreServices?: () => void;
  tick?: ReturnType<typeof setInterval>;
  lastTickT: number;
  /** 마지막으로 시계 판정(tickAt)을 한 앱 시각 */
  lastEvalT: number;
  unsubTrips?: () => void;
  appState?: { remove(): void };
  /** 조정안 때문에 멈춘 재생을 결정 뒤 다시 켤지 */
  resumeAfterDecision: boolean;
}

let rt: Runtime | undefined;
/** 시뮬레이터 시계는 stop 뒤에도 남는다(앱 시계로 남아 가상 시각이 되돌아가지 않게). */
let simClock: SimClock | undefined;
let startSeq = 0;

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

/** 엔진에 넘길 입력. 알림 설정은 부를 때마다 다시 읽는다(진행 중에 끄면 바로 반영). */
function ctxOf(run: Runtime): EngineCtx {
  const prefs = useSession.getState().notifyPrefs;
  if (run.ctx.prefs !== prefs) run.ctx = { ...run.ctx, prefs };
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

/** 실행 중 자원을 모두 푼다. 시뮬레이터 시계는 멈추기만 하고 앱 시계로 남긴다. */
function teardown() {
  if (!rt) return;
  rt.stopWatch?.();
  if (rt.tick) clearInterval(rt.tick);
  rt.restoreServices?.();
  rt.unsubTrips?.();
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

      const syncEngine = () => {
        if (!rt) return;
        const tr = rt.engine.tracker;
        const cur = tr.current && !tr.current.left ? tr.current : undefined;
        const arrival: ArrivalState = cur
          ? { spotId: cur.spotId, enteredAt: cur.arrivedAt, visitId: `v-${rt.date}-${cur.spotId}-${rt.memberId}` }
          : tr.candidate
            ? { spotId: tr.candidate.spotId, enteredAt: tr.candidate.enteredAt }
            : {};
        set({
          statuses: tr.statuses,
          timing: rt.engine.timing,
          shadow: tr.shadow,
          accuracyUnknown: !!tr.accuracyUnknown,
          notifyLog: rt.engine.notifyLog,
          arrival,
        });
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
        if (adjustments.length === 0) {
          // 흡수할 조정안이 없으면 이 지연으로는 다시 묻지 않고 그대로 간다.
          run.engine = acknowledgeDelay(run.engine, e.delayMin);
          pushLog([{ t: now, text: `${e.name} 조정안 없이 그대로 진행`, icon: 'right' }]);
          return;
        }
        const id = getServices().ids.next('lp');
        const proposal: LiveProposal = { id, createdAt: e.at, delayMin: e.delayMin, adjustments };
        // 시연 중에는 조정안을 읽는 동안 가상 시각이 흐르지 않게 멈춘다.
        if (run.requested === 'sim' && simClock?.playing()) {
          simClock.pause();
          run.resumeAfterDecision = true;
          set({ sim: { ...get().sim, playing: false } });
        }
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

      const applyEffects = (effects: EngineEffect[], manual = false) => {
        const run = rt;
        if (!run) return;
        let track = get().track;
        let trackChanged = false;
        const lines: LiveLogLine[] = [];
        for (const e of effects) {
          switch (e.kind) {
            case 'track':
              track = appendTrack(track, run.tripId, run.date, e.point);
              trackChanged = true;
              break;
            case 'visit':
              recordVisit(e.spotId, e.status, e.at, e.arrivedAt, manual);
              // 다음 스팟에 도착하면 빈 시간은 끝났다. 추천 카드를 남겨 두지 않는다.
              if (e.status === 'arrived' && get().freeTime) set({ freeTime: undefined });
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
        if (trackChanged) set({ track });
        pushLog(lines);
        syncEngine();
      };

      /* ---------- 샘플·시계·앱 상태 ---------- */

      const onSample = (sample: GpsSample) => {
        if (!rt) return;
        const r = ingestSample(rt.engine, sample, ctxOf(rt));
        rt.engine = r.state;
        set({ last: sample });
        applyEffects(r.effects);
      };

      const startWatch = () => {
        if (!rt || (get().mode !== 'sim' && get().mode !== 'device')) return;
        rt.stopWatch?.();
        rt.stopWatch = getServices().location.watch(onSample, { intervalMs: LOCATION_INTERVAL_MS });
      };

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
        if (!rt) return;
        const r = engineAppPhase(rt.engine, status as AppPhase, appClock().now());
        rt.engine = r.state;
        if (r.stop) {
          rt.stopWatch?.();
          rt.stopWatch = undefined;
          if (rt.tick) clearInterval(rt.tick);
          rt.tick = undefined;
          if (simClock?.playing()) simClock.pause();
          set({ background: true, sim: { ...get().sim, playing: false } });
        }
        if (r.resumed) {
          set({ background: false });
          startWatch();
          startTick();
          if (get().mode === 'device') {
            pushLog([{ t: appClock().now(), text: '앱으로 돌아옴 · 꺼져 있던 동안의 경로는 채우지 않음', icon: 'locate' }]);
          }
        }
      };

      /** 계획이 다시 계산되면(조정안 적용 등) 그날 입력을 바꾸고, 시연 중이면 지금 위치에서 궤적을 이어 만든다. */
      const onTripsChange = () => {
        const run = rt;
        if (!run) return;
        const ts = useTrips.getState();
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
          const track = generateTrack({
            day: next,
            preset: get().sim.preset,
            categories: run.categories,
            resume: {
              t: now,
              coord: last?.coord ?? replanPosition(next, run.engine.tracker),
              doneSpotIds: doneSpotIds(run.engine.tracker),
            },
          });
          run.track = track;
          run.restoreServices?.();
          run.restoreServices = overrideServices({
            location: createSimLocation({ clock: simClock, samples: track.samples, permission: track.permission }),
            ...(run.photos ? { photos: run.photos } : {}),
          });
          set({ simWindow: { startAt: get().simWindow?.startAt ?? track.startAt, endAt: track.endAt } });
          startWatch();
        }
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
        const doc = useTrips.getState().docs[tripId] ?? trip;
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
        let photos: PhotoProvider | undefined;
        let restoreServices: (() => void) | undefined;

        if (requested === 'sim') {
          const { preset, speed } = get().sim;
          track = generateTrack({ day: liveDay, preset, categories, closeMin: closingMinutes(doc, date) });
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
        const now = appClock().now();
        rt = {
          tripId,
          date,
          memberId,
          requested,
          ctx: { tripId, day: liveDay, prefs, source: requested === 'sim' ? 'sim' : 'device' },
          engine,
          categories,
          track,
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
        startWatch();
        startTick();
        rt.appState = AppState.addEventListener('change', onAppState);
        rt.unsubTrips = useTrips.subscribe((s, prev) => {
          if (rt && (s.plans[rt.tripId] !== prev.plans[rt.tripId] || s.docs[rt.tripId] !== prev.docs[rt.tripId])) onTripsChange();
        });
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
          if (rt) rt.resumeAfterDecision = false;
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
          const next = pruneTracks(get().track, useTrips.getState().docs, now);
          const before = Object.keys(get().track).length;
          if (Object.keys(next).length !== before) set({ track: next });
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
      partialize: (s) => ({ track: s.track, notifyLog: s.notifyLog, sim: { preset: s.sim.preset, speed: s.sim.speed, playing: false } }),
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
