import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { DaySetting, Member, Op, OpDraft, Plan, PlanStep, Transport, Trip, TripCover } from '../types';
import { RECOMPUTE_DEBOUNCE_MS, STORAGE_KEYS, STORAGE_VERSION } from '../core/constants';
import { activeMembers } from '../core/group';
import { lastOpAt, stampAt, validateOp } from '../core/ops';
import { buildPlan } from '../core/planner';
import { inviteStatus, normalizeInviteCode, wasIssued } from '../core/trip/invite';
import { joinFailure, joinStatus, planJoin, type JoinFail } from '../core/trip/join';
import { lookupInviteInLogs, lookupTripId } from '../core/trip/lookup';
import { activeMemberOfUser, expiredTripIds } from '../core/trip/members';
import {
  ack,
  docOf,
  droppedJoins,
  emptyOutbox,
  enqueue,
  flushable,
  lastSeqOf,
  markDirty,
  needsRecompute,
  receive,
  reconnectPlan,
  type OutboxState,
} from '../core/trip/outbox';
import { appClock, systemClock } from '../services/clock';
import { persistStorage, waitForHydration } from '../services/kv';
import { getServices } from '../services/registry';
import { getUserId, useSession } from './session';
import { useUi } from './ui';

/**
 * 여행방 문서와 op 로그(WP2 소유). 문서는 언제나 로그를 접은 결과다(계약 A3).
 *
 * dispatch: validateOp(잠금 → 권한) → outbox.enqueue → foldOps → persist → 온라인이면 push와 150ms 디바운스 재계산,
 *           오프라인이면 pending에 남기고 방을 dirty로 표시한다(재계산은 멈춘다).
 * 동기화: 방마다 SyncTransport.subscribe로 다른 기기의 op를 받고(receive), 재연결 때 pending을 at 순으로 보낸 뒤
 *         pull로 밀린 op를 받아 seq 순으로 다시 접는다. 그다음 dirty 방을 재계산한다.
 * 거부된 op는 사유를 토스트로 알린다(종료 잠금 안내 포함). 호출한 화면이 직접 알릴 때는 quiet를 준다.
 * 순수 판정은 core/trip(outbox, invite, join, members)에 있고 node 테스트는 그쪽을 본다.
 */

export type DispatchResult = { ok: true; op: Op } | { ok: false; reason: string };

export interface DispatchOpts {
  /** 이 방의 memberId. 없으면 myMemberId(actingAs 우선) */
  actorId?: string;
  /** 거부 사유 토스트를 띄우지 않는다(화면이 직접 안내할 때) */
  quiet?: boolean;
}

export interface CreateTripInput {
  title: string;
  region: string;
  startDate: string;
  endDate: string;
  transport: Transport;
  dayStart: string;
  dayEnd: string;
  /** base는 null 가능(기점 없이 만들기 → 그날 첫 스팟이 기점) */
  days: DaySetting[];
  hostNickname: string;
  /** 표지 이미지(선택) */
  cover?: TripCover;
}

/**
 * 합류 결과. 실패 사유는 초대 판정에 ended(종료된 방)와 offline(이 기기에 없는 방을 오프라인이라 확인 못 함)을 더한다
 * (계약 A6에 사유 두 개를 더했다. 04 코드리뷰 회의).
 */
export type AcceptInviteResult =
  | { ok: true; tripId: string; memberId: string; already: boolean }
  | { ok: false; reason: JoinFail };

/** 02 화면이 합류 전에 보여줄 초대 미리보기. local은 이 기기에 이미 있는 방인지다(오프라인 합류 안내에 쓴다). */
export type InvitePreview =
  | { ok: true; trip: Trip; code: string; already: boolean; memberId?: string; local: boolean }
  | { ok: false; code: string; reason: JoinFail };

export interface PlanningState {
  busy: boolean;
  steps: PlanStep[];
  error?: string;
}

export interface TripsState {
  docs: Record<string, Trip>;
  /** 서버 순번을 받은 op */
  log: Record<string, Op[]>;
  /** 아직 확인 응답을 받지 못한 op(모든 방) */
  pending: Op[];
  plans: Record<string, Plan>;
  planning: Record<string, PlanningState>;
  online: boolean;
  /** 오프라인 중 편집돼 재연결 때 다시 계산할 방 */
  dirty: Record<string, true>;

  dispatch: (tripId: string, draft: OpDraft, opts?: DispatchOpts) => DispatchResult;
  dispatchMany: (
    tripId: string,
    drafts: OpDraft[],
    opts?: DispatchOpts,
  ) => { ok: true; ops: Op[] } | { ok: false; reason: string; index: number };
  createTrip: (input: CreateTripInput) => string;
  acceptInvite: (
    code: string,
    who: { userId: string; nickname: string; isGuest: boolean },
  ) => Promise<AcceptInviteResult>;
  /** 합류하지 않고 초대만 확인한다(02 미리보기). 로그는 내려받지 않는다. */
  previewInvite: (code: string, userId?: string) => Promise<InvitePreview>;
  recompute: (tripId: string) => Promise<Plan | undefined>;
  setOnline: (v: boolean) => void;
  removeLocal: (tripId: string) => void;
  purgeExpired: (now: number) => void;
  reset: () => void;
  waitHydrated: () => Promise<void>;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const subscriptions = new Map<string, () => void>();
const flushing = new Set<string>();
const FLUSH_RETRY_MS = 3000;
/** 재계산 세대. 방마다 마지막으로 시작한 재계산만 결과를 쓴다(늦게 끝난 낡은 계산이 덮어쓰지 않게). */
const recomputeGen = new Map<string, number>();
let genCounter = 0;
/** 합류가 반영되지 않았다는 안내('확정'은 확정 스팟 용어라 쓰지 않는다) */
const JOIN_DROPPED_TEXT = '합류가 반영되지 않았습니다. 그사이 정원이 찼거나 초대 링크가 바뀌었을 수 있습니다. 방장에게 새 링크를 받아 주세요.';

function scheduleRecompute(tripId: string) {
  const prev = timers.get(tripId);
  if (prev) clearTimeout(prev);
  timers.set(
    tripId,
    setTimeout(() => {
      timers.delete(tripId);
      void useTrips.getState().recompute(tripId);
    }, RECOMPUTE_DEBOUNCE_MS),
  );
}

function outboxOf(s: Pick<TripsState, 'log' | 'pending'>, tripId: string): OutboxState {
  return { log: s.log[tripId] ?? [], pending: s.pending.filter((o) => o.tripId === tripId) };
}

function replacePending(all: Op[], tripId: string, mine: Op[]): Op[] {
  return [...all.filter((o) => o.tripId !== tripId), ...mine];
}

/** 이 방에서 지금 행동하는 멤버. 같은 기기 시연 전환(actingAs)이 우선이다. */
export function myMemberId(trip: Trip): string | undefined {
  const acting = useUi.getState().actingAs[trip.id];
  if (acting && trip.members.some((m) => m.id === acting && m.leftAt == null)) return acting;
  const userId = getUserId();
  return activeMembers(trip).find((m) => m.userId === userId)?.id;
}

/**
 * 이 기기가 계속 구독·재연결할 방. 삭제되지 않았고 내가 활성 멤버인 방, 그리고 보낼 op가 남은 방이다.
 * 나간 방, 내보내진 방, 삭제된 방, 합류하지 못한 방은 더 받지 않는다.
 */
function shouldFollow(s: Pick<TripsState, 'docs' | 'pending'>, tripId: string): boolean {
  if (s.pending.some((o) => o.tripId === tripId)) return true;
  const doc = s.docs[tripId];
  return !!doc && doc.deletedAt == null && !!myMemberId(doc);
}

/** 지금 보고 있는 방이 삭제됐거나 내가 더 이상 멤버가 아니면 선택을 푼다. */
function releaseCurrentIfGone(tripId: string) {
  const ui = useUi.getState();
  if (ui.currentTripId !== tripId) return;
  const doc = useTrips.getState().docs[tripId];
  if (!doc || doc.deletedAt != null || !myMemberId(doc)) ui.setCurrentTrip(undefined);
}

const initial = {
  docs: {} as Record<string, Trip>,
  log: {} as Record<string, Op[]>,
  pending: [] as Op[],
  plans: {} as Record<string, Plan>,
  planning: {} as Record<string, PlanningState>,
  online: true,
  dirty: {} as Record<string, true>,
};

export const useTrips = create<TripsState>()(
  persist(
    (set, get) => {
      /** 다른 기기(또는 서버 확인 응답)에서 온 op를 접는다. */
      function onRemote(tripId: string, ops: Op[]) {
        const s = get();
        const box = outboxOf(s, tripId);
        const known = new Set([...box.log, ...box.pending].map((o) => o.id));
        const r = receive(box, ops.filter((o) => o.tripId === tripId));
        if (!r.changed) return;
        const doc = docOf(r.state);
        const foreign = ops.filter((o) => !known.has(o.id));
        set({
          log: { ...s.log, [tripId]: r.state.log },
          pending: replacePending(s.pending, tripId, r.state.pending),
          docs: doc ? { ...s.docs, [tripId]: doc } : s.docs,
        });
        noticeDroppedJoins(box.pending, r.state, doc);
        releaseCurrentIfGone(tripId);
        if (!shouldFollow(get(), tripId)) disconnect(tripId);
        if (foreign.some((o) => needsRecompute(o.type))) {
          if (get().online) scheduleRecompute(tripId);
          else set({ dirty: { ...get().dirty, [tripId]: true } });
        }
      }

      /** 내 합류 op가 확인 응답 뒤 seq 순으로 다시 접혔을 때 빠졌으면(동시 합류로 정원 초과, 직전 재발급) 알린다. */
      function noticeDroppedJoins(prevPending: Op[], next: OutboxState, doc: Trip | undefined) {
        if (droppedJoins(prevPending, next, doc).length > 0) useUi.getState().showToast(JOIN_DROPPED_TEXT, 'warn');
      }

      function connect(tripId: string) {
        if (subscriptions.has(tripId)) return;
        try {
          const off = getServices().sync.subscribe(tripId, (ops) => onRemote(tripId, ops));
          subscriptions.set(tripId, off);
        } catch {
          // 구독 실패는 재연결 때 pull로 메운다.
        }
      }

      function disconnect(tripId: string) {
        subscriptions.get(tripId)?.();
        subscriptions.delete(tripId);
        const t = retryTimers.get(tripId);
        if (t) clearTimeout(t);
        retryTimers.delete(tripId);
      }

      function scheduleFlushRetry(tripId: string) {
        if (!get().online || retryTimers.has(tripId)) return;
        retryTimers.set(
          tripId,
          setTimeout(() => {
            retryTimers.delete(tripId);
            void flush(tripId);
          }, FLUSH_RETRY_MS),
        );
      }

      /** pending을 at 순으로 보내고 확인 응답으로 log에 옮긴다. 실패하면 pending에 남기고 잠시 뒤 다시 보낸다. */
      async function flush(tripId: string): Promise<void> {
        if (flushing.has(tripId)) return;
        flushing.add(tripId);
        try {
          for (let round = 0; round < 5; round += 1) {
            if (!get().online) return;
            const ops = flushable(outboxOf(get(), tripId));
            if (ops.length === 0) return;
            const acks = await getServices().sync.push(ops);
            const cur = get();
            const before = outboxOf(cur, tripId);
            const next = ack(before, acks);
            const doc = docOf(next);
            set({
              log: { ...cur.log, [tripId]: next.log },
              pending: replacePending(cur.pending, tripId, next.pending),
              docs: doc ? { ...cur.docs, [tripId]: doc } : cur.docs,
            });
            noticeDroppedJoins(before.pending, next, doc);
          }
          // 다섯 번을 돌고도 남았으면(연속 편집, 일부 op에 확인 응답 없음) 잠시 뒤 다시 보낸다.
          if (flushable(outboxOf(get(), tripId)).length > 0) scheduleFlushRetry(tripId);
        } catch {
          // 전송 실패: pending으로 남긴다. 온라인이면 잠시 뒤 다시 보낸다.
          scheduleFlushRetry(tripId);
        } finally {
          flushing.delete(tripId);
        }
      }

      /** 재연결 뒤 밀린 op를 받는다. */
      async function catchUp(tripId: string): Promise<void> {
        try {
          const after = lastSeqOf(outboxOf(get(), tripId));
          const ops = await getServices().sync.pull(tripId, after);
          if (ops.length > 0) onRemote(tripId, ops);
        } catch {
          // 다음 재연결 때 다시 받는다.
        }
      }

      /**
       * 이 기기에 있는 방에서 초대 코드를 찾는다. 지금 코드면 판정 결과를, 예전에 발급했다가 바뀐 코드면 revokedHere다.
       * 이미 참여 중인 사람도 만료·정원과 상관없이 방으로 들어가야 하므로 error에도 tripId를 싣는다.
       */
      function findLocalInvite(
        code: string,
        now: number,
      ):
        | { kind: 'found'; tripId: string }
        | { kind: 'error'; tripId: string; reason: 'notFound' | 'expired' | 'revoked' | 'full' }
        | { kind: 'revokedHere' }
        | { kind: 'none' } {
        let revokedHere = false;
        for (const doc of Object.values(get().docs)) {
          // 삭제된 방의 코드로는 이전 멤버도 들어가지 않는다.
          if (doc.deletedAt != null) continue;
          if (doc.invite?.code === code) {
            const st = inviteStatus(doc, code, now);
            return st === 'ok' ? { kind: 'found', tripId: doc.id } : { kind: 'error', tripId: doc.id, reason: st };
          }
          const box = outboxOf(get(), doc.id);
          if (wasIssued([...box.log, ...box.pending], code)) revokedHere = true;
        }
        return revokedHere ? { kind: 'revokedHere' } : { kind: 'none' };
      }

      /**
       * 이 기기에 없는 방의 초대를 동기화 서버에서 확인한다. 조회가 tripId를 주면(합류할 수 없는 코드 포함) 로그를 내려받아
       * 이 기기 시각(appClock, 여행 시뮬레이터 포함)으로 다시 판정한다. 전송의 시계와 상관없이 로컬 판정과 같은 결론이 된다.
       * 이미 참여 중인 사람은 만료·정원과 상관없이 already다(FR-302). 로그는 저장하지 않는다(합류할 때 스토어가 접는다).
       */
      async function fetchRemoteInvite(
        code: string,
        userId: string | undefined,
        now: number,
        revokedHere: boolean,
      ): Promise<
        | { kind: 'fail'; reason: JoinFail }
        | { kind: 'ok'; tripId: string; ops: Op[]; trip: Trip }
        | { kind: 'already'; tripId: string; ops: Op[]; trip: Trip; memberId: string }
      > {
        if (!get().online) return { kind: 'fail', reason: revokedHere ? 'revoked' : 'offline' };
        const { sync } = getServices();
        try {
          const r = await sync.lookupInvite(code);
          const tripId = lookupTripId(r);
          if (!tripId) {
            const reason = 'error' in r ? r.error : 'notFound';
            return { kind: 'fail', reason: revokedHere && reason === 'notFound' ? 'revoked' : reason };
          }
          const ops = (await sync.pull(tripId, 0)).filter((o) => o.tripId === tripId);
          const trip = docOf(receive(emptyOutbox(), ops).state);
          if (!trip || trip.deletedAt != null) return { kind: 'fail', reason: 'notFound' };
          const mine = activeMemberOfUser(trip, userId);
          if (mine) return { kind: 'already', tripId, ops, trip, memberId: mine.id };
          const judged = lookupInviteInLogs([ops], code, now);
          if ('error' in judged) return { kind: 'fail', reason: judged.error };
          const st = joinStatus(trip, code, now);
          return st === 'ok' ? { kind: 'ok', tripId, ops, trip } : { kind: 'fail', reason: st };
        } catch {
          return { kind: 'fail', reason: get().online ? 'notFound' : 'offline' };
        }
      }

      return {
        ...initial,

        dispatch: (tripId, draft, opts) => {
          const s = get();
          const doc = s.docs[tripId];
          const actorId = opts?.actorId ?? (doc ? myMemberId(doc) : undefined);
          const reject = (reason: string): DispatchResult => {
            if (!opts?.quiet) useUi.getState().showToast(reason, 'warn');
            return { ok: false, reason };
          };
          if (!actorId) return reject('이 여행방의 멤버가 아닙니다');
          // op.at은 그 방에서 뒤로 가지 않는다(계약 A11, 가상 시각과 기기 시각이 섞여도 LWW 유지).
          const box0 = outboxOf(s, tripId);
          const op = {
            ...draft,
            id: getServices().ids.next('op'),
            tripId,
            actorId,
            at: stampAt(appClock().now(), lastOpAt([...box0.log, ...box0.pending])),
          } as Op;
          const v = validateOp(doc, op);
          if (!v.ok) return reject(v.reason);
          const box = enqueue(box0, op);
          const nextDoc = docOf(box);
          set({
            pending: replacePending(s.pending, tripId, box.pending),
            docs: nextDoc ? { ...s.docs, [tripId]: nextDoc } : s.docs,
            dirty: markDirty(s.dirty, tripId, op, s.online),
          });
          connect(tripId);
          releaseCurrentIfGone(tripId);
          if (s.online) {
            void flush(tripId);
            if (needsRecompute(op.type)) scheduleRecompute(tripId);
          }
          return { ok: true, op };
        },

        dispatchMany: (tripId, drafts, opts) => {
          const ops: Op[] = [];
          for (let i = 0; i < drafts.length; i += 1) {
            const r = get().dispatch(tripId, drafts[i], opts);
            if (!r.ok) return { ok: false, reason: r.reason, index: i };
            ops.push(r.op);
          }
          return { ok: true, ops };
        },

        createTrip: (input) => {
          const { ids } = getServices();
          const now = appClock().now();
          const tripId = ids.next('trip');
          const userId = getUserId() ?? ids.next('u');
          const host: Member = {
            id: ids.next('m'),
            userId,
            nickname: input.hostNickname.trim() || '나',
            role: 'host',
            isGuest: useSession.getState().session?.kind !== 'account',
            canInvite: false,
            joinedAt: now,
          };
          const trip: Omit<Trip, 'lastSeq'> = {
            id: tripId,
            title: input.title.trim(),
            region: input.region,
            startDate: input.startDate,
            endDate: input.endDate,
            transport: input.transport,
            dayStart: input.dayStart,
            dayEnd: input.dayEnd,
            ...(input.cover ? { cover: input.cover } : {}),
            days: input.days,
            legs: [],
            members: [host],
            spots: [],
            messages: [],
            photos: [],
            visits: [],
            diaries: {},
            createdAt: now,
            createdBy: userId,
          };
          get().dispatch(tripId, { type: 'trip/create', trip }, { actorId: host.id });
          useUi.getState().setCurrentTrip(tripId);
          return tripId;
        },

        acceptInvite: async (rawCode, who) => {
          const code = normalizeInviteCode(rawCode) || rawCode.trim().toUpperCase();
          const now = appClock().now();
          const { ids } = getServices();

          // 1. 이 기기에 이미 있는 방(같은 기기 시연, 전송 전 초대 포함)
          const local = findLocalInvite(code, now);
          if (local.kind === 'error') {
            // 이미 참여 중이면 만료·정원과 상관없이 방으로 들어간다.
            const localDoc = get().docs[local.tripId];
            const mine = activeMemberOfUser(localDoc, who.userId);
            if (!mine) {
              // 미리보기(previewInvite)와 같은 순서(삭제 → 종료 잠금 → 초대)로 사유를 고른다.
              const st = joinStatus(localDoc, code, now);
              return { ok: false, reason: st === 'ok' ? local.reason : st };
            }
            connect(local.tripId);
            useUi.getState().setCurrentTrip(local.tripId);
            return { ok: true, tripId: local.tripId, memberId: mine.id, already: true };
          }
          let tripId = local.kind === 'found' ? local.tripId : undefined;
          const hadLocal = tripId != null;

          // 2. 동기화 서버에서 찾고 로그를 내려받는다(이 기기 시각으로 다시 판정)
          if (!tripId) {
            const remote = await fetchRemoteInvite(code, who.userId, now, local.kind === 'revokedHere');
            if (remote.kind === 'fail') return { ok: false, reason: remote.reason };
            tripId = remote.tripId;
            onRemote(tripId, remote.ops);
            if (remote.kind === 'already') {
              connect(tripId);
              useUi.getState().setCurrentTrip(tripId);
              return { ok: true, tripId, memberId: remote.memberId, already: true };
            }
          }

          const doc = get().docs[tripId];
          if (!doc) return { ok: false, reason: 'notFound' };
          // 합류하지 못하면, 이 합류를 위해 내려받은 방은 이 기기에서 다시 지운다.
          const fail = (reason: JoinFail): AcceptInviteResult => {
            if (!hadLocal && tripId && !activeMemberOfUser(get().docs[tripId] ?? doc, who.userId)) get().removeLocal(tripId);
            return { ok: false, reason };
          };

          // 3. 이미 참여 중이면 중복 멤버 없이 방으로 들어간다(종료된 방도 들어간다)
          const plan = planJoin(doc, who, code, { ids, now });
          if (plan.already) {
            connect(tripId);
            useUi.getState().setCurrentTrip(tripId);
            return { ok: true, tripId, memberId: plan.memberId, already: true };
          }
          const res = get().dispatch(tripId, plan.draft, { actorId: plan.member.id, quiet: true });
          if (!res.ok) return fail(joinFailure(res.reason));
          useUi.getState().setCurrentTrip(tripId);
          return { ok: true, tripId, memberId: plan.member.id, already: false };
        },

        previewInvite: async (rawCode, userId) => {
          const code = normalizeInviteCode(rawCode) || rawCode.trim().toUpperCase();
          const now = appClock().now();
          const judge = (trip: Trip, isLocal: boolean): InvitePreview => {
            if (trip.deletedAt != null) return { ok: false, code, reason: 'notFound' };
            const mine = activeMemberOfUser(trip, userId);
            if (mine) return { ok: true, trip, code, already: true, memberId: mine.id, local: isLocal };
            // 종료된 방은 초대가 7일 안이어도 합류할 수 없다(member/join은 잠금 예외가 아니다).
            const st = joinStatus(trip, code, now);
            return st === 'ok' ? { ok: true, trip, code, already: false, local: isLocal } : { ok: false, code, reason: st };
          };
          const local = findLocalInvite(code, now);
          if (local.kind === 'found' || local.kind === 'error') {
            const doc = get().docs[local.tripId];
            if (doc) return judge(doc, true);
          }
          const remote = await fetchRemoteInvite(code, userId, now, local.kind === 'revokedHere');
          if (remote.kind === 'fail') return { ok: false, code, reason: remote.reason };
          if (remote.kind === 'already') {
            return { ok: true, trip: remote.trip, code, already: true, memberId: remote.memberId, local: false };
          }
          return { ok: true, trip: remote.trip, code, already: false, local: false };
        },

        recompute: async (tripId) => {
          const doc = get().docs[tripId];
          if (!doc || doc.deletedAt != null) return undefined;
          if (!get().online) {
            set({ dirty: { ...get().dirty, [tripId]: true } });
            return get().plans[tripId];
          }
          genCounter += 1;
          const gen = genCounter;
          recomputeGen.set(tripId, gen);
          const latest = () => recomputeGen.get(tripId) === gen;
          const steps: PlanStep[] = [];
          set({ planning: { ...get().planning, [tripId]: { busy: true, steps } } });
          try {
            const plan = await buildPlan(doc, {
              routes: getServices().routes,
              now: appClock().now(),
              // 08 단계 시간('0.4초')은 실제 걸린 시간이라 기기 시계로 잰다(가상 시각은 멈추거나 빨리 흐른다).
              clock: systemClock,
              onStep: (step) => {
                if (!latest()) return;
                const i = steps.findIndex((x) => x.key === step.key);
                if (i >= 0) steps[i] = step;
                else steps.push(step);
                set({ planning: { ...get().planning, [tripId]: { busy: true, steps: [...steps] } } });
              },
            });
            // 더 늦게 시작한 재계산이 있으면 이 결과는 버린다.
            if (!latest()) return get().plans[tripId];
            // 계산하는 동안 문서가 바뀌었으면(오프라인 편집 포함) dirty를 지우지 않는다. 온라인이면 다시 계산한다.
            const unchanged = get().docs[tripId] === doc;
            const { [tripId]: _done, ...restDirty } = get().dirty;
            set({
              plans: { ...get().plans, [tripId]: plan },
              planning: { ...get().planning, [tripId]: { busy: false, steps: plan.steps } },
              dirty: unchanged ? restDirty : get().dirty,
            });
            if (!unchanged && get().online) scheduleRecompute(tripId);
            return plan;
          } catch (e) {
            if (latest()) {
              set({
                planning: { ...get().planning, [tripId]: { busy: false, steps, error: String(e) } },
              });
            }
            return undefined;
          }
        },

        setOnline: (v) => {
          getServices().sync.setOnline(v);
          set({ online: v });
          if (!v) return;
          // 재연결: pending flush(at 순) → 밀린 op pull(seq 순 재접기) → dirty 방 재계산
          const plan = reconnectPlan(get().pending, get().dirty);
          // 구독 대상은 내가 활성 멤버인 방과 보낼 op가 남은 방뿐이다(나간·삭제된 방은 더 받지 않는다).
          const tripIds = new Set([...plan.flush, ...Object.keys(get().docs).filter((id) => shouldFollow(get(), id))]);
          // 방마다 따로 이어 붙인다. 한 방의 요청이 늦어져도 다른 방의 재계산은 기다리지 않는다.
          const dirtyIds = new Set(plan.recompute);
          for (const id of tripIds) {
            void (async () => {
              if (get().docs[id]) connect(id);
              await flush(id);
              await catchUp(id);
              if (dirtyIds.has(id) && get().dirty[id]) void get().recompute(id);
            })();
          }
          for (const id of dirtyIds) if (!tripIds.has(id) && get().dirty[id]) void get().recompute(id);
        },

        removeLocal: (tripId) => {
          disconnect(tripId);
          const s = get();
          const { [tripId]: _d, ...docs } = s.docs;
          const { [tripId]: _l, ...log } = s.log;
          const { [tripId]: _p, ...plans } = s.plans;
          const { [tripId]: _g, ...planning } = s.planning;
          const { [tripId]: _y, ...dirty } = s.dirty;
          set({ docs, log, plans, planning, dirty, pending: s.pending.filter((o) => o.tripId !== tripId) });
          if (useUi.getState().currentTripId === tripId) useUi.getState().setCurrentTrip(undefined);
        },

        purgeExpired: (now) => {
          // 데이터 보존: 종료 다음 날 00:00 KST + 365일이 지난 방을 이 기기에서 지운다.
          for (const id of expiredTripIds(get().docs, now)) get().removeLocal(id);
        },

        reset: () => {
          for (const t of timers.values()) clearTimeout(t);
          timers.clear();
          for (const t of retryTimers.values()) clearTimeout(t);
          retryTimers.clear();
          for (const off of subscriptions.values()) off();
          subscriptions.clear();
          flushing.clear();
          recomputeGen.clear();
          set({ ...initial });
        },

        waitHydrated: (): Promise<void> => waitForHydration(useTrips),
      };
    },
    {
      name: STORAGE_KEYS.trips,
      version: STORAGE_VERSION,
      storage: persistStorage,
      partialize: (s) => ({
        docs: s.docs,
        log: s.log,
        pending: s.pending,
        plans: s.plans,
        dirty: s.dirty,
      }),
      onRehydrateStorage: () => () => {
        // 복원 뒤: 보관 기한 지난 방 정리, 남은 pending 전송과 구독 재개(setOnline(true)가 flush·pull·재계산을 한다).
        setTimeout(() => {
          const st = useTrips.getState();
          st.purgeExpired(appClock().now());
          st.setOnline(true);
        }, 0);
      },
    },
  ),
);

/* ---------- 훅 ---------- */

export function useTripDoc(id?: string): Trip | undefined {
  return useTrips((s) => (id ? s.docs[id] : undefined));
}

/**
 * 지금 고른 여행방. 삭제됐거나 이 기기의 사람이 활성 멤버가 아니면 undefined다(로그아웃·계정 전환·내보내짐 뒤
 * 선택이 남아 있어도 이전 사람의 방이 보이지 않게). actingAs 시연 전환도 멤버로 본다(myMemberId).
 */
export function useCurrentTrip(): Trip | undefined {
  const id = useUi((s) => s.currentTripId);
  const doc = useTripDoc(id);
  const userId = useSession((s) => s.session?.userId);
  const acting = useUi((s) => (id ? s.actingAs[id] : undefined));
  if (!doc || doc.deletedAt != null) return undefined;
  const member = (m: Trip['members'][number]) => m.leftAt == null && (m.userId === userId || m.id === acting);
  return doc.members.some(member) ? doc : undefined;
}

export function usePlan(id?: string): Plan | undefined {
  return useTrips((s) => (id ? s.plans[id] : undefined));
}

export function usePlanning(id?: string): PlanningState | undefined {
  return useTrips((s) => (id ? s.planning[id] : undefined));
}

/** 내가(이 기기의 userId) 참여 중인 여행방. 삭제된 방은 뺀다. 결과 배열은 docs나 세션이 바뀔 때만 새로 만든다. */
export function useMyTrips(): Trip[] {
  const docs = useTrips((s) => s.docs);
  const userId = useSession((s) => s.session?.userId);
  return useMemo(
    () =>
      Object.values(docs).filter(
        (t) => t.deletedAt == null && t.members.some((m) => m.userId === userId && m.leftAt == null),
      ),
    [docs, userId],
  );
}
