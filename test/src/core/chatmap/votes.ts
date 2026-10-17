import type { Member, Proposal, Spot, Trip } from '../../types';
import { activeMembers } from '../group';
import { proposerIds } from '../spotUtil';

/**
 * 채팅방 지도의 표 계산(FR-405, 명세 밖 추가, 순수). 저장된 값은 Spot.votes(멤버별 LWW)뿐이고 나머지는 여기서 계산한다.
 * - 장소마다 한 사람이 한 표다. 말한(제안한) 사람은 처음부터 한 표가 들어가 있고, 명시적으로 끄면(on:false) 그 표가 빠진다.
 *   votes가 없는 옛 문서도 그대로 제안자의 표로 보인다.
 * - 세는 것은 활성 멤버의 표뿐이다(나간 멤버의 표는 문서에 남지만 세지 않는다).
 * - 제외된 스팟(removedByUser)은 순위·말한 장소에 나오지 않는다.
 *
 * 한 사람의 표 예산(VOTE_BUDGET = 3, 사용자 요청 2026-10-17):
 * - 예산에 드는 표는 '내가 말하지 않은 장소에 명시적으로 켠 표'(votes[me].on === true)뿐이다.
 * - 말한 사람의 처음 표(제안자 표)는 예산 밖이다. 명시적으로 껐다가 다시 켜도 같은 제안자 표라 예산 밖이다
 *   (한 장소에 한 사람 한 표라 이걸로 표를 늘릴 수는 없다). 꺼 두면 그 장소에는 표가 없다.
 * - 제외된 스팟(removedByUser)의 표는 세지 않는다. 지운 스팟은 표와 함께 사라진다.
 * - 지키는 곳은 core/ops/spots.validate다. 접을 때도 seq 순으로 돌아서, 오프라인·동시 op가 섞여도
 *   먼저 접힌 3표가 이기고 넘치는 켜기 op는 버려진다. 끄기는 언제나 된다.
 * - 복원(spot/restore)으로 예산이 넘치면 복원된 스팟의 표를 끈다(제외된 동안 다른 곳에 쓴 표가 이긴다).
 * - 제안을 되돌려(undoExtraction) 제안자 표가 예산 표로 바뀌는 드문 경우에는 넘칠 수 있다.
 *   그때는 남은 표가 0으로 보이고 새로 켜기만 막힌다.
 */

/** 한 사람이 여행방 전체에서 켤 수 있는 표 수(제안자 표 제외) */
export const VOTE_BUDGET = 3;

/** 예산을 넘는 켜기를 버릴 때의 이유. 화면은 이 문구를 그대로 토스트로 보인다 */
export const VOTE_BUDGET_REASON = '표는 한 사람당 3표까지예요. 다른 표를 빼고 다시 눌러 주세요';

/** 이 스팟에 켠 표가 그 멤버의 예산을 쓰는지(말하지 않은 장소면 쓴다) */
export function costsVote(spot: Spot, memberId: string): boolean {
  return !proposerIds(spot).includes(memberId);
}

/** 그 멤버가 쓴 표 수. 제외된 스팟과 exceptSpotId는 세지 않는다 */
export function usedVotes(spots: readonly Spot[], memberId: string, exceptSpotId?: string): number {
  let n = 0;
  for (const s of spots) {
    if (s.removedByUser || s.id === exceptSpotId) continue;
    if (s.votes?.[memberId]?.on === true && costsVote(s, memberId)) n += 1;
  }
  return n;
}

/** 남은 표(0..VOTE_BUDGET). 활성 멤버가 아니면 0 */
export function votesLeft(trip: Trip, memberId: string): number {
  if (!activeMembers(trip).some((m) => m.id === memberId)) return 0;
  return Math.max(0, VOTE_BUDGET - usedVotes(trip.spots, memberId));
}

/** 이 스팟에 지금 표를 켜면 예산을 넘는지. 이미 켜져 있거나 제안자 표면 넘지 않는다 */
export function voteBlocked(spots: readonly Spot[], spot: Spot, memberId: string): boolean {
  if (hasVote(spot, memberId) || !costsVote(spot, memberId)) return false;
  return usedVotes(spots, memberId, spot.id) >= VOTE_BUDGET;
}

export function hasVote(spot: Spot, memberId: string): boolean {
  const v = spot.votes?.[memberId];
  if (v) return v.on;
  return proposerIds(spot).includes(memberId);
}

/** 표를 준 활성 멤버 id(멤버 순서) */
export function voterIds(spot: Spot, active: readonly Member[]): string[] {
  return active.filter((m) => hasVote(spot, m.id)).map((m) => m.id);
}

/** 스팟 id → 표 수(제외된 스팟은 없다) */
export function voteCounts(spots: readonly Spot[], active: readonly Member[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of spots) if (!s.removedByUser) out[s.id] = voterIds(s, active).length;
  return out;
}

export interface RankRow {
  spotId: string;
  name: string;
  areaName: string;
  count: number;
  voterIds: string[];
  /** 1부터. 표가 같으면 같은 순위(1, 1, 3) */
  rank: number;
  /** 내가 표를 줬는지 */
  mine: boolean;
}

const byKo = (a: string, b: string) => a.localeCompare(b, 'ko');

/** 여행방 전체 순위. 표 수 내림차순, 먼저 생긴 순, 이름(ko) 순 */
export function rankSpots(
  spots: readonly Spot[],
  areaBySpot: Readonly<Record<string, string>>,
  active: readonly Member[],
  me: string | undefined,
): RankRow[] {
  const live = spots.filter((s) => !s.removedByUser);
  const rows = live.map((s) => {
    const ids = voterIds(s, active);
    return {
      spot: s,
      row: {
        spotId: s.id,
        name: s.name,
        areaName: areaBySpot[s.id] ?? '',
        count: ids.length,
        voterIds: ids,
        rank: 0,
        mine: me ? ids.includes(me) : false,
      },
    };
  });
  rows.sort((a, b) => b.row.count - a.row.count || a.spot.createdAt - b.spot.createdAt || byKo(a.spot.name, b.spot.name));
  const counts = rows.map((r) => r.row.count);
  return rows.map(({ row }) => ({ ...row, rank: 1 + counts.filter((c) => c > row.count).length }));
}

/** 막대 비율. 가장 많은 표를 1로 본다(표가 하나도 없으면 0) */
export function barRatio(count: number, maxCount: number): number {
  return count / Math.max(1, maxCount);
}

export interface MentionRow {
  spotId: string;
  name: string;
  areaName: string;
  source: Proposal['source'];
  /** 그 멤버가 이 장소를 처음 말한 채팅 메시지 글. 직접 추가(manual)면 없다 */
  quote?: string;
  /** 그 멤버의 가장 이른 제안 시각 */
  firstAt: number;
  count: number;
  /** 내가 표를 줬는지 */
  mine: boolean;
}

/**
 * 한 멤버가 말한 장소(한 스팟에 한 줄). 인용은 그 멤버의 가장 이른 채팅 제안 메시지에서 가져온다.
 * 고른 지역(selAreaKey)의 줄이 먼저 오고, 같은 무리 안에서는 처음 말한 순서다.
 */
export function mentionsOf(
  trip: Trip,
  memberId: string,
  areaBySpot: Readonly<Record<string, string>>,
  selAreaKey?: string | null,
  me?: string,
): MentionRow[] {
  const active = activeMembers(trip);
  const rows: MentionRow[] = [];
  for (const s of trip.spots) {
    if (s.removedByUser) continue;
    const mine = s.proposals.filter((p) => p.memberId === memberId);
    if (mine.length === 0) continue;
    const firstAt = Math.min(...mine.map((p) => p.at));
    const chats = mine.filter((p) => p.source === 'chat').sort((a, b) => a.at - b.at);
    let quote: string | undefined;
    for (const p of chats) {
      quote = trip.messages.find((m) => m.id === p.messageId)?.text;
      if (quote) break;
    }
    rows.push({
      spotId: s.id,
      name: s.name,
      areaName: areaBySpot[s.id] ?? '',
      source: chats.length > 0 ? 'chat' : 'manual',
      quote,
      firstAt,
      count: voterIds(s, active).length,
      mine: me ? hasVote(s, me) && active.some((m) => m.id === me) : false,
    });
  }
  const inSel = (r: MentionRow) => (selAreaKey && r.areaName === selAreaKey ? 0 : 1);
  return rows.sort((a, b) => inSel(a) - inSel(b) || a.firstAt - b.firstAt);
}

/**
 * 왼쪽 열의 멤버 순서. 지역을 고르지 않았으면(pickerIds null) 멤버 순서 그대로,
 * 골랐으면 그 지역을 고른 사람이 먼저(멤버 순서), 나머지가 뒤(멤버 순서)다.
 */
export function railOrder(active: readonly Member[], pickerIds: readonly string[] | null): Member[] {
  if (!pickerIds) return [...active];
  const picked = active.filter((m) => pickerIds.includes(m.id));
  const rest = active.filter((m) => !pickerIds.includes(m.id));
  return [...picked, ...rest];
}
