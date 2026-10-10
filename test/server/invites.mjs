/**
 * 초대 코드 간이 판정(WP2 소유). 메모리 저장소와 PostgreSQL 저장소가 같이 쓴다.
 *
 * 서버는 코드가 어느 방 것인지만 알려 주고, 최종 판정은 앱이 로그를 내려받아 core(lookupInviteInLogs)로 한다
 * (판정 로직을 core 하나에 모은다. 04 코드리뷰 회의). 합류할 수 없는 코드도 tripId를 준다. 이미 참여한 사람은
 * 만료·정원과 상관없이 방으로 들어가야 해서다. status는 로그를 훑은 간이 판정이고 참고용이다.
 * 간이 판정도 리듀서와 같은 뜻으로 센다. 합류는 그 시각(op.at)에 초대가 유효하고 자리가 있을 때만 활성으로 세고,
 * 나가기·내보내기·탈퇴(anonymize)는 방장이든 그룹원이든 활성에서 뺀다.
 */

/** 판정에 쓰는 op 종류. Postgres 저장소는 이 종류만 골라 읽는다. */
export const INVITE_OP_TYPES = [
  'trip/create',
  'trip/issueInvite',
  'trip/revokeInvite',
  'trip/delete',
  'member/join',
  'member/leave',
  'member/remove',
  'member/anonymize',
];

/** 이 시각에 초대 코드로 합류할 수 있는지(리듀서 member/join validate와 같은 순서: 무효 → 만료 → 정원) */
function inviteOpen(invite, code, at, activeCount) {
  if (!invite || invite.code !== code) return false;
  if (invite.revokedAt != null && invite.revokedAt <= at) return false;
  if (at >= invite.expiresAt) return false;
  return activeCount < invite.capacity;
}

/** 로그를 훑어 초대 코드 상태를 판정한다(간이, 참고용). */
export function judgeInvite(ops, code, now) {
  let invite;
  let issued = false;
  let deleted = false;
  /** memberId → userId */
  const active = new Map();
  for (const op of ops) {
    switch (op.type) {
      case 'trip/create':
        for (const m of op.trip?.members ?? []) if (m.leftAt == null) active.set(m.id, m.userId);
        break;
      case 'trip/issueInvite':
        invite = { ...op.invite };
        if (op.invite?.code === code) issued = true;
        break;
      case 'trip/revokeInvite':
        if (invite && invite.revokedAt == null) invite.revokedAt = op.at;
        break;
      case 'trip/delete':
        deleted = true;
        break;
      case 'member/join': {
        const m = op.member;
        if (!m || active.has(m.id) || [...active.values()].includes(m.userId)) break;
        // 그 시각에 초대가 유효하고 자리가 있던 합류만 센다(동시 합류로 정원 초과된 op, 재발급 직전 코드의 op는 뺀다).
        if (inviteOpen(invite, op.inviteCode, op.at, active.size)) active.set(m.id, m.userId);
        break;
      }
      case 'member/leave':
      case 'member/remove':
      case 'member/anonymize':
        active.delete(op.memberId);
        break;
      default:
        break;
    }
  }
  if (!issued || deleted) return 'notFound';
  if (!invite || invite.code !== code) return 'revoked';
  if (invite.revokedAt != null && invite.revokedAt <= now) return 'revoked';
  if (now >= invite.expiresAt) return 'expired';
  if (active.size >= invite.capacity) return 'full';
  return 'ok';
}

/** 이 로그의 마지막 발급 코드가 code인지(무효화만 된 코드와 재발급으로 바뀐 코드를 가른다) */
export function isCurrentCode(ops, code) {
  let current;
  for (const op of ops) if (op.type === 'trip/issueInvite') current = op.invite?.code;
  return current === code;
}

/**
 * 여행방들의 로그를 처음 받은 순서대로 훑어 코드 조회 응답을 만든다.
 * 재발급으로 바뀐 옛 코드만 있는 방은 revoked로 기억해 두고, 지금 코드인 방이 있으면 그 방을 준다.
 * trips: [tripId, ops(seq 순)]의 반복자
 */
export function lookupInTrips(trips, code, now) {
  let revokedTrip;
  for (const [tripId, ops] of trips) {
    const st = judgeInvite(ops, code, now);
    if (st === 'notFound') continue;
    if (st === 'revoked' && !isCurrentCode(ops, code)) {
      revokedTrip ??= tripId;
      continue;
    }
    return { tripId, status: st };
  }
  return revokedTrip ? { tripId: revokedTrip, error: 'revoked' } : { error: 'notFound' };
}
