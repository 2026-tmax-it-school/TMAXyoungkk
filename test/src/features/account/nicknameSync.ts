import type { Trip } from '../../types';

/**
 * 프로필 닉네임과 여행방 멤버 이름 맞추기(2026-10-17 사용자 요청, 순수).
 * 여행방 멤버 이름은 들어갈 때 이름으로 저장돼서, 프로필에서 닉네임을 바꾸면 예전 방은 옛 이름(카드 아바타 머리글자 등)이 남았다.
 * 내 사용자(userId)로 아직 활성인 멤버 중 이름이 다른 곳마다 member/rename을 보낸다(본인만 바꿀 수 있는 op).
 * 시연용 '다른 사람으로 합류'(actingAs) 멤버는 userId가 달라서 건드리지 않는다. 삭제된 방·나간 방도 뺀다.
 */
export function planNicknameSync(
  trips: readonly Trip[],
  userId: string,
  nickname: string,
): { tripId: string; memberId: string }[] {
  const name = nickname.trim();
  if (!name || !userId) return [];
  const out: { tripId: string; memberId: string }[] = [];
  for (const t of trips) {
    if (t.deletedAt != null) continue;
    const me = t.members.find((m) => m.userId === userId && m.leftAt == null && !m.anonymized);
    if (me && me.nickname !== name) out.push({ tripId: t.id, memberId: me.id });
  }
  return out;
}
