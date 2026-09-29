import type { ChatExtraction, ChatMessage, Op, OpOf, Proposal, Spot, Trip } from '../../types';
import { addProposals } from '../extract/spot';
import { activeMembers } from '../group';
import { patchSpot } from './lww';

/**
 * spot/* 리듀서(WP3 소유). 전 멤버가 쓸 수 있다.
 *
 * - 같은 placeId는 하나로 합치고 제안(proposals)만 중복 없이 누적한다(FR-402).
 *   spot/extracted·spot/add·spot/resolveAmbiguous 모두 이 규칙을 지킨다. 다른 기기에서 같은 장소가
 *   거의 동시에 새로 잡혀도 접는 순서대로 앞선 것에 합쳐져 후보가 둘이 되지 않는다.
 * - spot/undoExtraction(되돌리기)은 그 메시지로 새로 생긴 후보만 지우고, 병합된 기존 후보에서는
 *   그 메시지의 제안만 뺀다. 새로 생긴 후보라도 그 뒤 다른 메시지·사람이 제안을 더했으면 그 제안은 남긴다.
 *   어느 쪽이든 남은 제안이 0건이면 지운다(제안자 0명 후보는 두지 않는다).
 * - spot/pin·remove·restore는 공유 patchSpot(필드별 op.at LWW)만 쓴다. restore는 고정으로 되돌린다.
 * - spot/delete는 오인식 후보를 지운다. 말풍선 강조와 추출 카드에서도 뺀다.
 */

/** 채팅 제안은 그 메시지를 보낸 사람의 것이다. 동명 장소를 다른 멤버가 골라 줘도 제안자는 말한 사람이다. */
function chatProposal(msg: ChatMessage, op: Op): Proposal {
  return { memberId: msg.memberId, source: 'chat', messageId: msg.id, at: op.at };
}

function updateMessage(doc: Trip, messageId: string, fn: (m: ChatMessage) => ChatMessage): Trip {
  let changed = false;
  const messages = doc.messages.map((m) => {
    if (m.id !== messageId) return m;
    changed = true;
    return fn(m);
  });
  return changed ? { ...doc, messages } : doc;
}

function emptyExtraction(): ChatExtraction {
  return { createdSpotIds: [], mergedSpotIds: [], ambiguous: [], highlights: [] };
}

/**
 * 후보 하나를 넣거나 같은 placeId에 합친다. 돌려주는 id는 실제로 남은 후보 id,
 * created는 새로 생겼는지다.
 */
function upsertSpot(spots: Spot[], spot: Spot, proposals: Proposal[]): { spots: Spot[]; id: string; created: boolean } {
  const i = spots.findIndex((s) => s.placeId === spot.placeId);
  if (i >= 0) {
    const next = [...spots];
    next[i] = { ...spots[i], proposals: addProposals(spots[i].proposals, proposals) };
    return { spots: next, id: spots[i].id, created: false };
  }
  if (spots.some((s) => s.id === spot.id)) return { spots, id: spot.id, created: false };
  return { spots: [...spots, { ...spot, proposals: addProposals([], proposals) }], id: spot.id, created: true };
}

function reduceExtracted(doc: Trip, op: OpOf<'spot/extracted'>): Trip {
  const msg = doc.messages.find((m) => m.id === op.messageId);
  if (!msg) return doc;
  const proposal = chatProposal(msg, op);
  let spots = doc.spots;
  const createdIds: string[] = [];
  const mergedIds: string[] = [];
  for (const s of op.created) {
    const r = upsertSpot(spots, s, [proposal]);
    spots = r.spots;
    (r.created ? createdIds : mergedIds).push(r.id);
  }
  for (const id of op.mergedSpotIds) {
    const i = spots.findIndex((s) => s.id === id);
    if (i < 0) continue;
    spots = [...spots];
    spots[i] = { ...spots[i], proposals: addProposals(spots[i].proposals, [proposal]) };
    if (!mergedIds.includes(id)) mergedIds.push(id);
  }
  const nothing =
    createdIds.length === 0 && mergedIds.length === 0 && op.ambiguous.length === 0 && op.highlights.length === 0;
  if (nothing) return doc;
  const next = { ...doc, spots };
  return updateMessage(next, op.messageId, (m) => ({
    ...m,
    extraction: {
      createdSpotIds: createdIds,
      mergedSpotIds: mergedIds,
      ambiguous: op.ambiguous.map((a) => ({ ...a })),
      highlights: op.highlights.map((h) => ({ ...h })),
    },
  }));
}

function reduceResolve(doc: Trip, op: OpOf<'spot/resolveAmbiguous'>): Trip {
  const msg = doc.messages.find((m) => m.id === op.messageId);
  const pick = msg?.extraction?.ambiguous.find((a) => a.phrase === op.phrase);
  if (!msg || !msg.extraction || !pick || pick.resolved != null) return doc;
  const ex = msg.extraction;
  if (!op.spot && !op.mergeIntoSpotId) {
    return updateMessage(doc, op.messageId, (m) => ({
      ...m,
      extraction: {
        ...ex,
        ambiguous: ex.ambiguous.map((a) => (a.phrase === op.phrase ? { ...a, resolved: 'dismissed' } : a)),
      },
    }));
  }
  const proposal = chatProposal(msg, op);
  let spots = doc.spots;
  let resultId: string | undefined;
  let created = false;
  let placeId: string | undefined;
  const target = op.mergeIntoSpotId ? spots.find((s) => s.id === op.mergeIntoSpotId) : undefined;
  if (target) {
    spots = spots.map((s) => (s.id === target.id ? { ...s, proposals: addProposals(s.proposals, [proposal]) } : s));
    resultId = target.id;
    placeId = target.placeId;
  } else if (op.spot) {
    const r = upsertSpot(spots, op.spot, [proposal]);
    spots = r.spots;
    resultId = r.id;
    created = r.created;
    placeId = op.spot.placeId;
  }
  if (!resultId) return doc;
  const id = resultId;
  return updateMessage({ ...doc, spots }, op.messageId, (m) => ({
    ...m,
    extraction: {
      ...ex,
      createdSpotIds: created ? [...ex.createdSpotIds, id] : ex.createdSpotIds,
      mergedSpotIds: !created && !ex.mergedSpotIds.includes(id) ? [...ex.mergedSpotIds, id] : ex.mergedSpotIds,
      ambiguous: ex.ambiguous.map((a) => (a.phrase === op.phrase ? { ...a, resolved: placeId } : a)),
      highlights: ex.highlights.map((h) =>
        pick.options.some((o) => o.placeId === h.placeId) && placeId ? { ...h, placeId } : h,
      ),
    },
  }));
}

function reduceUndo(doc: Trip, messageId: string): Trip {
  const msg = doc.messages.find((m) => m.id === messageId);
  const ex = msg?.extraction;
  if (!msg || !ex) return doc;
  const touched = new Set([...ex.createdSpotIds, ...ex.mergedSpotIds]);
  const spots: Spot[] = [];
  const dropped: Spot[] = [];
  for (const s of doc.spots) {
    if (!touched.has(s.id)) {
      spots.push(s);
      continue;
    }
    const rest = s.proposals.filter((p) => p.messageId !== messageId);
    // 그 메시지의 제안만 뺀다. 남은 제안이 없으면 새로 생긴 후보든 병합된 후보든 지운다.
    // (A 생성 → B 병합 → A 되돌리기 → B 되돌리기, 두 기기 동시 생성이 병합된 경우에 제안자 0명 후보가 남지 않게)
    if (rest.length === 0) {
      dropped.push(s);
      continue;
    }
    spots.push({ ...s, proposals: rest });
  }
  let next: Trip = updateMessage({ ...doc, spots }, messageId, (m) => {
    const { extraction: _drop, ...plain } = m;
    return plain;
  });
  // 지운 후보는 다른 메시지의 추출 기록(생성·병합·강조)에서도 뺀다(spot/delete와 같은 정리).
  for (const s of dropped) next = scrubExtractions(next, s);
  return next;
}

/** 지워진 후보를 모든 메시지의 추출 기록에서 뺀다. 목록에 남은 후보는 건드리지 않는다. */
function scrubExtractions(doc: Trip, spot: Spot): Trip {
  let changed = false;
  const messages = doc.messages.map((m) => {
    const ex = m.extraction;
    if (!ex) return m;
    const has =
      ex.createdSpotIds.includes(spot.id) ||
      ex.mergedSpotIds.includes(spot.id) ||
      ex.highlights.some((h) => h.placeId === spot.placeId);
    if (!has) return m;
    changed = true;
    return {
      ...m,
      extraction: {
        ...ex,
        createdSpotIds: ex.createdSpotIds.filter((id) => id !== spot.id),
        mergedSpotIds: ex.mergedSpotIds.filter((id) => id !== spot.id),
        highlights: ex.highlights.filter((h) => h.placeId !== spot.placeId),
      },
    };
  });
  return changed ? { ...doc, messages } : doc;
}

function reduceDelete(doc: Trip, spotId: string): Trip {
  const spot = doc.spots.find((s) => s.id === spotId);
  if (!spot) return doc;
  return scrubExtractions({ ...doc, spots: doc.spots.filter((s) => s.id !== spotId) }, spot);
}

function patchById(doc: Trip, spotId: string, fn: (s: Spot) => Spot): Trip {
  const i = doc.spots.findIndex((s) => s.id === spotId);
  if (i < 0) return doc;
  const spots = [...doc.spots];
  spots[i] = fn(spots[i]);
  return { ...doc, spots };
}

export function reduce(doc: Trip, op: Op): Trip {
  switch (op.type) {
    case 'spot/extracted':
      return reduceExtracted(doc, op);
    case 'spot/resolveAmbiguous':
      return reduceResolve(doc, op);
    case 'spot/add': {
      const proposals = op.spot.proposals.length
        ? op.spot.proposals
        : [{ memberId: op.actorId, source: 'manual' as const, at: op.at }];
      return { ...doc, spots: upsertSpot(doc.spots, op.spot, proposals).spots };
    }
    case 'spot/undoExtraction':
      return reduceUndo(doc, op.messageId);
    case 'spot/pin':
      return patchById(doc, op.spotId, (s) => patchSpot(s, { pinned: op.pinned }, op.at));
    case 'spot/remove':
      return patchById(doc, op.spotId, (s) =>
        patchSpot(s, { removedByUser: true, removedReason: op.reason ?? 'user' }, op.at),
      );
    case 'spot/restore':
      return patchById(doc, op.spotId, (s) =>
        patchSpot(s, { removedByUser: undefined, removedReason: undefined, pinned: true }, op.at),
      );
    case 'spot/delete':
      return reduceDelete(doc, op.spotId);
    default:
      return doc;
  }
}

const NOT_MEMBER = '이 여행방의 멤버가 아닙니다';
const NO_SPOT = '후보를 찾을 수 없습니다';

export function validate(doc: Trip, op: Op): string | null {
  if (!op.type.startsWith('spot/')) return null;
  if (!activeMembers(doc).some((m) => m.id === op.actorId)) return NOT_MEMBER;
  switch (op.type) {
    case 'spot/extracted':
      return doc.messages.some((m) => m.id === op.messageId) ? null : '메시지를 찾을 수 없습니다';
    case 'spot/resolveAmbiguous': {
      const pick = doc.messages.find((m) => m.id === op.messageId)?.extraction?.ambiguous.find((a) => a.phrase === op.phrase);
      if (!pick) return '고를 장소 목록이 없습니다';
      if (pick.resolved != null) return '이미 고른 장소입니다';
      if (op.mergeIntoSpotId && !doc.spots.some((s) => s.id === op.mergeIntoSpotId)) return NO_SPOT;
      return null;
    }
    case 'spot/add':
      if (!op.spot.placeId || !op.spot.name.trim()) return '장소 정보가 없습니다';
      return null;
    case 'spot/undoExtraction':
      return doc.messages.find((m) => m.id === op.messageId)?.extraction ? null : '되돌릴 추출 결과가 없습니다';
    case 'spot/pin':
    case 'spot/remove':
    case 'spot/restore':
    case 'spot/delete':
      return doc.spots.some((s) => s.id === op.spotId) ? null : NO_SPOT;
    default:
      return null;
  }
}
