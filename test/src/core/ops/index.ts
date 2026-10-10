import type { Op, OpType, Trip } from '../../types';
import { kstDate } from '../util';
import * as chat from './chat';
import * as journal from './journal';
import * as members from './members';
import * as schedule from './schedule';
import * as spots from './spots';
import { coverProblem } from '../trip/cover';
import * as trip from './trip';

/**
 * op 적용 규칙(계약 A3). 여행방 문서는 언제나 op 로그를 접은 결과다.
 *
 * 1. doc = foldOps(확정 로그 seq 순 + pending at 순). 확인 응답이나 늦게 온 낮은 seq op가 오면 다시 접는다.
 * 2. 중복은 foldOps와 outbox가 op.id로 거른다. applyOp는 op 하나만 적용하고 중복을 모른다.
 * 3. lastSeq는 applyOp가 max(doc.lastSeq, op.seq ?? 0)로 올린다.
 * 4. 필드 LWW는 ops/lww.ts(patchSpot·patchDay)만 쓴다.
 * 5. 종료일이 지나면 편집 op를 거부한다. 예외는 LOCK_EXEMPT와, 이름·표지만 바꾸는 trip/update다(trip.TRIP_PATCH_KEYS_AFTER_END).
 */

export type ReducerKey = 'trip' | 'members' | 'chat' | 'spots' | 'schedule' | 'journal';

interface Reducer {
  reduce(doc: Trip, op: Op): Trip;
  validate(doc: Trip, op: Op): string | null;
}

const REDUCERS: Record<ReducerKey, Reducer> = { trip, members, chat, spots, schedule, journal };

/** op 타입 → 리듀서 파일. 새 타입이 types.ts에 생기면 여기서 타입 오류가 난다. */
export const OP_OWNER: Record<OpType, ReducerKey> = {
  'trip/create': 'trip',
  'trip/update': 'trip',
  'trip/setDay': 'trip',
  'trip/delete': 'trip',
  'trip/issueInvite': 'trip',
  'trip/revokeInvite': 'trip',
  'member/join': 'members',
  'member/leave': 'members',
  'member/remove': 'members',
  'member/setCanInvite': 'members',
  'member/rename': 'members',
  'member/accountLinked': 'members',
  'member/anonymize': 'members',
  'chat/send': 'chat',
  'spot/extracted': 'spots',
  'spot/resolveAmbiguous': 'spots',
  'spot/add': 'spots',
  'spot/undoExtraction': 'spots',
  'spot/pin': 'spots',
  'spot/remove': 'spots',
  'spot/restore': 'spots',
  'spot/delete': 'spots',
  'schedule/reorder': 'schedule',
  'schedule/setStay': 'schedule',
  'schedule/setArrive': 'schedule',
  'schedule/setDate': 'schedule',
  'schedule/setDayTransport': 'schedule',
  'schedule/setLegTransport': 'schedule',
  'journal/photoAdded': 'journal',
  'journal/photoRemoved': 'journal',
  'journal/visit': 'journal',
  'journal/diaryGenerated': 'journal',
  'journal/diaryEdited': 'journal',
  'journal/diaryShared': 'journal',
};

/**
 * 종료 잠금 예외. 여행이 끝나도 사진 추가·일기 편집, 나가기, 계정 탈퇴 익명화, 방 삭제는 된다.
 */
export const LOCK_EXEMPT: ReadonlySet<OpType> = new Set<OpType>([
  'journal/photoAdded',
  'journal/photoRemoved',
  'journal/visit',
  'journal/diaryGenerated',
  'journal/diaryEdited',
  'journal/diaryShared',
  'member/leave',
  'member/anonymize',
  'trip/delete',
]);

/** 종료일(KST)이 지난 시각의 편집인지 */
export function isEditLocked(doc: Pick<Trip, 'endDate'>, at: number): boolean {
  return kstDate(at) > doc.endDate;
}

/** op 하나를 적용하는 순수 함수. 문서가 없으면 trip/create만 받는다. */
export function applyOp(doc: Trip | undefined, op: Op): Trip | undefined {
  let next: Trip | undefined;
  if (op.type === 'trip/create') {
    next = doc ?? trip.reduceCreate(op);
  } else {
    if (!doc) return undefined;
    next = REDUCERS[OP_OWNER[op.type]].reduce(doc, op);
  }
  const seq = op.seq ?? 0;
  if (seq > next.lastSeq) next = { ...next, lastSeq: seq };
  return next;
}

export type ValidateResult = { ok: true } | { ok: false; reason: string };

/**
 * op 시각 도장(계약 A3 규칙 6). 가상 시각(시뮬레이터)과 기기 시각이 섞여도 한 방의 op.at은 뒤로 가지 않는다.
 * 새 op.at = max(지금, 그 방 마지막 op.at + 1). 필드 LWW와 pending 정렬이 이 순서를 믿는다.
 * 잠금 판정은 이렇게 찍힌 op.at으로 한다(모든 기기가 같은 로그에서 같은 판정을 얻게).
 */
export function stampAt(now: number, lastAt: number | undefined): number {
  return lastAt == null ? now : Math.max(now, lastAt + 1);
}

/** 로그와 pending을 합쳐 가장 늦은 op.at. 비어 있으면 undefined */
export function lastOpAt(ops: readonly Op[]): number | undefined {
  let max: number | undefined;
  for (const o of ops) if (max == null || o.at > max) max = o.at;
  return max;
}

/** 종료 잠금 거부 사유. 화면은 이 문구를 그대로 안내한다. */
export const LOCKED_REASON = '여행이 끝나 편집할 수 없습니다. 일기와 사진은 계속 쓸 수 있습니다';

/** 잠금 검사 뒤 기능 validate. 삭제된 방에는 아무 op도 받지 않는다. */
export function validateOp(doc: Trip | undefined, op: Op): ValidateResult {
  if (op.type === 'trip/create') {
    if (doc) return { ok: false, reason: '이미 있는 여행방입니다' };
    const bad = op.trip.cover != null ? coverProblem(op.trip.cover) : null;
    return bad ? { ok: false, reason: bad } : { ok: true };
  }
  if (!doc) return { ok: false, reason: '여행방을 찾을 수 없습니다' };
  if (doc.deletedAt != null) return { ok: false, reason: '삭제된 여행방입니다' };
  const cosmetic =
    op.type === 'trip/update' && !!op.patch && Object.keys(op.patch).every((k) => trip.TRIP_PATCH_KEYS_AFTER_END.has(k));
  if (isEditLocked(doc, op.at) && !LOCK_EXEMPT.has(op.type) && !cosmetic) {
    return { ok: false, reason: LOCKED_REASON };
  }
  const reason = REDUCERS[OP_OWNER[op.type]].validate(doc, op);
  return reason == null ? { ok: true } : { ok: false, reason };
}

/**
 * 로그 전체를 접는다. seq가 있는 op는 seq 순, 없는 op(pending)는 at 순으로 뒤에 붙인다.
 * 같은 id는 한 번만 반영하고, seq가 달린 쪽을 확정으로 본다.
 * 검증에 실패하는 op는 건너뛴다. 모든 기기가 같은 로그에서 같은 문서를 얻게 하려고 여기서 거른다.
 */
export function foldOps(ops: Op[]): Trip | undefined {
  const byId = new Map<string, Op>();
  for (const op of ops) {
    const prev = byId.get(op.id);
    if (!prev || (prev.seq == null && op.seq != null)) byId.set(op.id, op);
  }
  const all = [...byId.values()];
  const confirmed = all
    .filter((o) => o.seq != null)
    .sort((a, b) => (a.seq as number) - (b.seq as number));
  const pending = all
    .filter((o) => o.seq == null)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let doc: Trip | undefined;
  for (const op of [...confirmed, ...pending]) {
    if (!validateOp(doc, op).ok) continue;
    doc = applyOp(doc, op);
  }
  return doc;
}
