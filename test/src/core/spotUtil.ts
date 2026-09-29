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

export function proposerCount(spot: Spot): number {
  return proposerIds(spot).length;
}

/** 사용자가 직접 빼지 않은 후보. 자동 선별(planner)의 입력이다. */
export function activeSpots(trip: Trip): Spot[] {
  return trip.spots.filter((s) => !s.removedByUser);
}

/**
 * 우선순위 비교. 정렬하면 앞이 우선순위가 높다.
 * FR-403: 제외는 제안자 수가 적은 순, 동점이면 등록이 늦은 순이다. 그 정확한 반대가 우선순위다.
 * 그래도 같으면 id로 순서를 고정한다. 단, id 비교는 생성 방식에 따라 뜻이 달라진다(seqIds는 'x_10' < 'x_9',
 * 앱 id는 난수). 그래서 등록 시각이 같아지지 않게 하는 쪽이 규칙이다: 시나리오는 줄 × 60초로 시각을 찍고(03 회의),
 * 추출은 한 메시지에서 새로 만든 스팟의 createdAt을 at + 원문 등장 순서(ms)로 준다(계약 A7).
 */
export function priorityCompare(a: Spot, b: Spot): number {
  const byCount = proposerCount(b) - proposerCount(a);
  if (byCount !== 0) return byCount;
  const byCreated = a.createdAt - b.createdAt;
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
