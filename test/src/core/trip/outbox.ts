import type { Op, OpType, Trip } from '../../types';
import { foldOps } from '../ops';

/**
 * 오프라인 큐(FR-304 재전송 큐·순서 보정, WP2 소유). 순수 함수다. 한 여행방 몫이다.
 * log는 서버 순번(seq)을 받은 op, pending은 아직 확인 응답을 받지 못한 op다.
 *
 * - 오프라인 중 op는 pending에 쌓이고, 재연결 때 at 순으로 보낸다(flushable).
 * - 확인 응답(ack)이나 같은 id가 seq를 달고 다시 오면(receive) pending에서 log로 옮긴다.
 * - 늦게 온 낮은 seq op나 뒤섞인 순서는 docOf가 로그 전체를 seq 순으로 다시 접어 바로잡는다.
 * - 같은 op를 여러 번 받아도 id로 한 번만 남긴다.
 */

export interface OutboxState {
  log: Op[];
  pending: Op[];
}

export function emptyOutbox(): OutboxState {
  return { log: [], pending: [] };
}

function bySeq(a: Op, b: Op): number {
  return (a.seq ?? 0) - (b.seq ?? 0);
}

export function enqueue(s: OutboxState, op: Op): OutboxState {
  if (s.pending.some((o) => o.id === op.id) || s.log.some((o) => o.id === op.id)) return s;
  const { seq: _drop, ...clean } = op;
  return { ...s, pending: [...s.pending, clean as Op] };
}

/** 확인 응답. pending에서 빼고 seq를 달아 log로 옮긴다. 이미 log에 있으면(구독으로 먼저 받음) pending만 비운다. */
export function ack(s: OutboxState, acks: { opId: string; seq: number }[]): OutboxState {
  const seqById = new Map(acks.map((a) => [a.opId, a.seq]));
  if (!s.pending.some((o) => seqById.has(o.id))) return s;
  const inLog = new Set(s.log.map((o) => o.id));
  const moved = s.pending
    .filter((o) => seqById.has(o.id) && !inLog.has(o.id))
    .map((o) => ({ ...o, seq: seqById.get(o.id) }) as Op);
  return {
    log: [...s.log, ...moved].sort(bySeq),
    pending: s.pending.filter((o) => !seqById.has(o.id)),
  };
}

/**
 * 서버(다른 기기 포함)에서 온 op. seq가 없는 op는 받지 않는다.
 * 같은 id가 seq를 달고 오면 확인 응답으로 본다. 이미 log에 있는 id는 중복이라 버린다.
 * changed는 log가 실제로 늘었는지다(순서만 바뀐 중복 수신은 false).
 */
export function receive(s: OutboxState, ops: Op[]): { state: OutboxState; changed: boolean } {
  const seen = new Set(s.log.map((o) => o.id));
  const fresh: Op[] = [];
  for (const op of ops) {
    if (op.seq == null || seen.has(op.id)) continue;
    seen.add(op.id);
    fresh.push(op);
  }
  if (fresh.length === 0) return { state: s, changed: false };
  const freshIds = new Set(fresh.map((o) => o.id));
  return {
    state: {
      log: [...s.log, ...fresh].sort(bySeq),
      pending: s.pending.filter((o) => !freshIds.has(o.id)),
    },
    changed: true,
  };
}

/**
 * 확인 응답 뒤 빠진 내 합류. prevPending(확인 응답 전 pending)에 있던 member/join이 next.log로 옮겨졌는데
 * 다시 접은 문서(doc)에 그 멤버가 같은 userId로 활성이 아니면 돌려준다.
 * seq 순으로 다시 접으면 먼저 도착한 다른 합류 때문에 정원이 찼거나, 직전에 재발급·무효화된 코드라 validate에서 떨어진 경우다.
 * 문서를 접지 못했으면(생성 op 없음) 판정하지 않는다.
 */
export function droppedJoins(prevPending: readonly Op[], next: OutboxState, doc: Trip | undefined): Op[] {
  if (!doc) return [];
  const logged = new Set(next.log.map((o) => o.id));
  return prevPending.filter((o) => {
    if (o.type !== 'member/join' || !logged.has(o.id)) return false;
    const m = doc.members.find((x) => x.id === o.member.id);
    return !m || m.leftAt != null || m.userId !== o.member.userId;
  });
}

/** 보낼 op. at 순(같으면 id 순)이다. */
export function flushable(s: OutboxState): Op[] {
  return [...s.pending].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** log에서 받은 가장 큰 seq. 재연결 때 pull(afterSeq)에 쓴다. */
export function lastSeqOf(s: OutboxState): number {
  let max = 0;
  for (const o of s.log) if ((o.seq ?? 0) > max) max = o.seq as number;
  return max;
}

export function docOf(s: OutboxState): Trip | undefined {
  return foldOps([...s.log, ...s.pending]);
}

/** 이 op 뒤에는 계획을 다시 계산한다(계약 A6 재계산 대상). */
export function needsRecompute(type: OpType): boolean {
  return (
    type.startsWith('spot/') ||
    type.startsWith('schedule/') ||
    type.startsWith('member/') ||
    type === 'trip/create' ||
    type === 'trip/update' ||
    type === 'trip/setDay'
  );
}

/** 오프라인 중 편집이면 그 방을 dirty로 표시한다. 온라인이면 바로 재계산하므로 표시하지 않는다. */
export function markDirty(dirty: Record<string, true>, tripId: string, op: Pick<Op, 'type'>, online: boolean): Record<string, true> {
  if (online || !needsRecompute(op.type) || dirty[tripId]) return dirty;
  return { ...dirty, [tripId]: true };
}

/**
 * 재연결 계획. 보낼 op가 남은 방은 flush 대상, dirty 방은 flush 뒤 재계산 대상이다.
 * 스토어 setOnline(true)가 이 순서로 처리한다.
 */
export function reconnectPlan(pending: readonly Op[], dirty: Record<string, true>): { flush: string[]; recompute: string[] } {
  const flush = [...new Set(pending.map((o) => o.tripId))];
  const recompute = Object.keys(dirty).filter((id) => dirty[id]);
  return { flush, recompute };
}
