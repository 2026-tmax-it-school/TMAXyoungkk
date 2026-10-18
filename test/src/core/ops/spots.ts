import type { ChatExtraction, ChatMessage, Op, OpOf, Proposal, Spot, Trip } from '../../types';
import { costsVote, usedVotes, VOTE_BUDGET, VOTE_BUDGET_REASON } from '../chatmap/votes';
import { addProposals } from '../extract/spot';
import { activeMembers, isHost } from '../group';
import { patchSpot, patchVote } from './lww';

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
 * - spot/vote(채팅방 지도의 한 표, FR-405)는 공유 patchVote(멤버별 op.at LWW)만 쓴다. 대상은 spotId이고, 없으면
 *   같은 placeId의 후보다(다른 기기에서 같은 장소가 먼저 생겨 이 기기의 후보가 그쪽에 합쳐진 경우).
 *   새 후보를 만들 때는 페이로드의 votes를 버리고, 기존 후보에 합칠 때는 votes를 그대로 둔다.
 *   후보를 지우는 spot/delete·undoExtraction은 votes도 함께 사라진다. pin은 votes를 건드리지 않는다.
 * - spot/hostPick(2026-10-17 사용자 요청)은 방장만 쓴다. 투표 결과를 덮는 방장 결정(keep 꼭 넣기, drop 빼기, null 투표대로)이고
 *   공유 patchSpot(hostPick 필드 LWW)만 쓴다. 계획 계산은 core/planner plannedSpots가 읽는다.
 * - 표 예산(VOTE_BUDGET, core/chatmap/votes): 켜기가 그 멤버의 예산을 넘으면 validate가 버린다(접을 때도 seq 순이라
 *   먼저 접힌 3표가 이긴다). 끄기는 언제나 된다. restore로 제외가 풀려 예산이 넘치는 멤버는 복원된 스팟의 표를 끈다.
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
  return { spots: [...spots, { ...spot, votes: undefined, proposals: addProposals([], proposals) }], id: spot.id, created: true };
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

/**
 * 복원으로 다시 세게 된 표가 예산을 넘으면 그 스팟의 표를 끈다. 제외된 동안 다른 곳에 쓴 표가 이긴다.
 * 끈 기록의 at은 원래 at과 복원 at 중 큰 쪽이라, 늦게 도착한 옛 켜기가 다시 덮지 못한다.
 */
function trimRestoredVotes(doc: Trip, spotId: string, at: number): Trip {
  const i = doc.spots.findIndex((s) => s.id === spotId);
  const spot = doc.spots[i];
  if (!spot || spot.removedByUser || !spot.votes) return doc;
  let votes = spot.votes;
  for (const [memberId, v] of Object.entries(spot.votes)) {
    if (!v.on || !costsVote(spot, memberId)) continue;
    if (usedVotes(doc.spots, memberId, spotId) < VOTE_BUDGET) continue;
    votes = { ...votes, [memberId]: { on: false, at: Math.max(v.at, at) } };
  }
  if (votes === spot.votes) return doc;
  const spots = [...doc.spots];
  spots[i] = { ...spot, votes };
  return { ...doc, spots };
}

function patchById(doc: Trip, spotId: string, fn: (s: Spot) => Spot, placeId?: string): Trip {
  let i = doc.spots.findIndex((s) => s.id === spotId);
  if (i < 0 && placeId) i = doc.spots.findIndex((s) => s.placeId === placeId);
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
    case 'spot/restore': {
      const wasRemoved = !!doc.spots.find((s) => s.id === op.spotId)?.removedByUser;
      const next = patchById(doc, op.spotId, (s) =>
        patchSpot(s, { removedByUser: undefined, removedReason: undefined, pinned: true }, op.at),
      );
      return wasRemoved ? trimRestoredVotes(next, op.spotId, op.at) : next;
    }
    case 'spot/delete':
      return reduceDelete(doc, op.spotId);
    case 'spot/vote':
      return patchById(doc, op.spotId, (s) => patchVote(s, op.actorId, op.on, op.at), op.placeId);
    case 'spot/hostPick':
      return patchById(doc, op.spotId, (s) => patchSpot(s, { hostPick: op.pick ?? undefined }, op.at));
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
    case 'spot/hostPick':
      if (!doc.spots.some((s) => s.id === op.spotId)) return NO_SPOT;
      if (!isHost(doc, op.actorId)) return '방장만 정할 수 있어요';
      return op.pick === null || op.pick === 'keep' || op.pick === 'drop' ? null : '잘못된 요청이에요';
    case 'spot/vote': {
      const spot = doc.spots.find((s) => s.id === op.spotId) ?? (op.placeId ? doc.spots.find((s) => s.placeId === op.placeId) : undefined);
      if (!spot) return NO_SPOT;
      if (typeof op.on !== 'boolean') return '잘못된 요청이에요';
      // 표 예산: 새로 켜는 것만 본다(끄기와 이미 켠 곳 다시 켜기는 언제나 된다). 접을 때도 seq 순으로 돌아서 먼저 접힌 표가 이긴다.
      if (op.on && spot.votes?.[op.actorId]?.on !== true && costsVote(spot, op.actorId) && usedVotes(doc.spots, op.actorId, spot.id) >= VOTE_BUDGET) {
        return VOTE_BUDGET_REASON;
      }
      // 제외 여부는 여기서 보지 않는다. validate는 접을 때도 돌아서, 제외와 겹친 표가 도착 순서(seq)에 따라
      // 버려지거나 남게 된다(복원 뒤 결과가 op.at이 아니라 순서를 따른다). 제외된 후보에는 화면이 표를 내지 않는다.
      return null;
    }
    default:
      return null;
  }
}
