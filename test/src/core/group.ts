import type { Member, Trip } from '../types';

/**
 * 개인·그룹 모드(명세 FR-300 상태도). 모드는 저장하지 않고 활성 멤버 수로 계산한다.
 * 개인 모드에서는 채팅과 대화 인식만 비활성이고 나머지는 그대로 동작한다.
 */

/** 나가지 않은 멤버 */
export function activeMembers(trip: Trip): Member[] {
  return trip.members.filter((m) => m.leftAt == null);
}

/** 활성 멤버 2명 이상이면 그룹방이다. 방장 외 전원이 나가면 개인 모드로 돌아간다. */
export function tripMode(trip: Trip): 'personal' | 'group' {
  return activeMembers(trip).length >= 2 ? 'group' : 'personal';
}

export function memberById(trip: Trip, id: string): Member | undefined {
  return trip.members.find((m) => m.id === id);
}

export function isHost(trip: Trip, memberId: string): boolean {
  return memberById(trip, memberId)?.role === 'host';
}

/** 초대 링크 발급·무효화는 방장 또는 초대 권한을 켠 그룹원(기본 false, FR-303 가정). */
export function canIssueInvite(trip: Trip, memberId: string): boolean {
  const m = memberById(trip, memberId);
  if (!m || m.leftAt != null) return false;
  return m.role === 'host' || m.canInvite;
}
