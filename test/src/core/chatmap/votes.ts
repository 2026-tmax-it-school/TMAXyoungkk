import type { Member, Proposal, Spot, Trip } from '../../types';
import { activeMembers } from '../group';
import { proposerIds } from '../spotUtil';

/**
 * 채팅방 지도의 표 계산(FR-405, 명세 밖 추가, 순수). 저장된 값은 Spot.votes(멤버별 LWW)뿐이고 나머지는 여기서 계산한다.
 * - 장소마다 한 사람이 한 표다. 말한(제안한) 사람은 처음부터 한 표가 들어가 있고, 명시적으로 끄면(on:false) 그 표가 빠진다.
 *   votes가 없는 옛 문서도 그대로 제안자의 표로 보인다.
 * - 세는 것은 활성 멤버의 표뿐이다(나간 멤버의 표는 문서에 남지만 세지 않는다).
 * - 제외된 스팟(removedByUser)은 순위·말한 장소에 나오지 않는다.
 */

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
