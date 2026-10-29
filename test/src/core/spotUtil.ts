import type { Spot, Trip } from '../types';

/**
 * 후보(스팟) 공용 판정. FR-402 제안자 누적과 FR-403 우선순위의 기준이 여기 하나뿐이다.
 */

/** 제안자 memberId 목록. 같은 사람이 여러 번 말해도 한 명이다. 등장 순서를 유지한다. */
export function proposerIds(spot: Spot): string[] {
  const out: string[] = [];
  for (const p of spot.proposals) {
    if (!out.includes(p.memberId)) out.push(p.memberId);
  }
  return out;
}

/**
 * '누가 추가했나' 한 줄. 처음 담은 사람 이름과 나머지 수('민지 외 2명'). 이름을 모르는 멤버(나간 사람 포함)는 '멤버'로 읽는다.
 * 제안이 없으면 빈 문자열이다.
 */
export function adderText(trip: Pick<Trip, 'members'>, spot: Spot | undefined): string {
  if (!spot) return '';
  const ids = proposerIds(spot);
  if (ids.length === 0) return '';
  const nameOf = (id: string) => trip.members.find((m) => m.id === id)?.nickname ?? '멤버';
  return ids.length === 1 ? nameOf(ids[0]) : `${nameOf(ids[0])} 외 ${ids.length - 1}명`;
}

export function proposerCount(spot: Spot): number {
  return proposerIds(spot).length;
}

/**
 * 이 후보에 표를 준 멤버 id(2026-10-17, 투표로 우선순위를 정한다). 제안자는 처음부터 한 표이고, 명시적으로 끄면 빠진다.
 * 채팅방 지도의 표 계산(core/chatmap/votes.hasVote)과 같은 규칙이다. 나간 멤버를 거르는 것은 부르는 쪽이 한다(active).
 */
export function spotVoterIds(spot: Spot, active?: readonly { id: string }[]): string[] {
  const ids = new Set<string>();
  for (const id of proposerIds(spot)) if (spot.votes?.[id]?.on !== false) ids.add(id);
  for (const [id, v] of Object.entries(spot.votes ?? {})) if (v.on) ids.add(id);
  const out = [...ids];
  return active ? out.filter((id) => active.some((m) => m.id === id)) : out;
}

/** 표 수. 우선순위(priorityCompare)의 첫 기준이다 */
export function voteCount(spot: Spot): number {
  return spotVoterIds(spot).length;
}

/**
 * 표로 자동 고정되는지(2026-10-17 사용자 요청). 활성 멤버의 과반이 표를 주면 고정 취급한다.
 * 혼자인 방(활성 1명)은 모든 후보가 과반이 돼 자동 제외가 없어지므로 보지 않는다.
 * 방장이 정한 후보(hostPick)는 방장 결정이 앞서므로 여기서는 false다.
 */
export function votePinned(spot: Spot, active: readonly { id: string }[]): boolean {
  if (spot.hostPick || active.length < 2) return false;
  return spotVoterIds(spot, active).length * 2 > active.length;
}

/** 사용자가 직접 빼지 않은 후보. 자동 선별(planner)의 입력이다. */
export function activeSpots(trip: Trip): Spot[] {
  return trip.spots.filter((s) => !s.removedByUser);
}

/**
 * 우선순위 비교. 정렬하면 앞이 우선순위가 높다.
 * FR-403: 제외는 제안자 수가 적은 순, 동점이면 등록이 늦은 순이다. 그 정확한 반대가 우선순위다.
 * 2026-10-17 사용자 요청: 제안자 수 대신 표 수(voteCount, 제안자 표 + 채팅방 지도에서 켠 표)로 센다.
 * 표를 따로 켜지 않은 방에서는 표 수가 제안자 수와 같아 FR-403 그대로다.
 * 그래도 같으면 id로 순서를 고정한다. 단, id 비교는 생성 방식에 따라 뜻이 달라진다(seqIds는 'x_10' < 'x_9',
 * 앱 id는 난수). 그래서 등록 시각이 같아지지 않게 하는 쪽이 규칙이다: 시나리오는 줄 × 60초로 시각을 찍고(03 회의),
 * 추출은 한 메시지에서 새로 만든 스팟의 createdAt을 at + 원문 등장 순서(ms)로 준다(계약 A7).
 */
export function priorityCompare(a: Spot, b: Spot): number {
  const byCount = voteCount(b) - voteCount(a);
  if (byCount !== 0) return byCount;
  const byCreated = a.createdAt - b.createdAt;
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
