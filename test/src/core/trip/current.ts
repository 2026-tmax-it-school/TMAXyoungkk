import type { Trip } from '../../types';

/**
 * 지금 보는 여행방 고르기(순수). 홈, 일정·후보·지도 탭, 프로필 탭, 채팅이 같은 규칙으로 방을 고른다.
 * 앱 쪽 훅은 features/trip/useActiveTrip이다(store/trips의 useCurrentTrip도 같은 규칙을 쓴다).
 *
 * 순서
 * 1. 지정한 방(currentTripId): 삭제되지 않았고 내가 활성 멤버일 때
 * 2. 진행 중인 방 중 첫 방(시작일이 이른 순, 같으면 먼저 만든 방)
 * 3. 예정인 방 중 첫 방(시작일이 가까운 순)
 * 4. 가장 최근에 끝난 방(종료일이 늦은 순)
 * 5. 없으면 undefined
 *
 * today는 KST 'YYYY-MM-DD'다(앱 시계에서 받는다. 시뮬레이터가 켜지면 가상 날짜). userId를 주면 그 사람이 활성 멤버인
 * 방만 본다(나간 방·내보내진 방은 건너뛴다). 이미 내 방만 거른 목록(useMyTrips)을 넘기면 생략해도 된다.
 */
export function pickCurrentTrip(
  trips: readonly Trip[],
  currentTripId: string | undefined,
  today: string,
  userId?: string,
): Trip | undefined {
  const mine = trips.filter(
    (t) => t.deletedAt == null && (userId == null || t.members.some((m) => m.userId === userId && m.leftAt == null)),
  );
  if (currentTripId) {
    const chosen = mine.find((t) => t.id === currentTripId);
    if (chosen) return chosen;
  }
  const byStart = (a: Trip, b: Trip) => a.startDate.localeCompare(b.startDate) || a.createdAt - b.createdAt;
  const ongoing = mine.filter((t) => t.startDate <= today && today <= t.endDate).sort(byStart);
  if (ongoing.length > 0) return ongoing[0];
  const upcoming = mine.filter((t) => today < t.startDate).sort(byStart);
  if (upcoming.length > 0) return upcoming[0];
  const done = mine
    .filter((t) => t.endDate < today)
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.createdAt - a.createdAt);
  return done[0];
}
