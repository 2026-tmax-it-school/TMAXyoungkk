import type { Member, Op, Trip } from '../../types';
import { DELETED_MEMBER_NAME, NICKNAME_MAX } from '../constants';
import { activeMembers, isHost, memberById } from '../group';
import { inviteStatus } from '../trip/invite';

/**
 * member/* 리듀서(WP2 소유). 의미는 계약 A3·A11을 따른다. validate는 op와 doc만 본다(시각은 op.at).
 * - join: 초대가 op.at 기준 'ok'이고, 정원은 방장 포함 활성 멤버 수 < capacity. 같은 userId 활성 멤버가 있으면 거부.
 *   예전에 스스로 나간 같은 사람이 같은 멤버 id로 다시 들어오면 그 행을 되살린다(제안·채팅 이력이 이어진다).
 * - leave: 본인만. 방장은 거부한다(방장 위임 미결정).
 * - remove: 방장만, 본인 불가. setCanInvite: 방장만(FR-303 초대 권한 토글, 프로토타입 가정).
 * - rename: 본인. accountLinked: actor 멤버를 isGuest=false, userId=op.userId로(게스트 승격).
 * - anonymize: 본인만. 이미 나간 본인도 허용(계정 탈퇴). 종료 잠금 예외다(ops/index LOCK_EXEMPT).
 *   방장도 그룹원과 같이 leftReason 'deleted'와 leftAt을 둔다(인수 기준, 02 결정). 탈퇴는 계정을 없애는 일이라
 *   방장 나가기 거부(방장 위임 미결정)와 따로 본다. 방장이 탈퇴한 방은 방장 없이 남고, 관리 공백은 정책 미결정이다
 *   (04 코드리뷰 회의 결정).
 * 나간 멤버의 행은 지우지 않는다. 제안·채팅의 memberId가 그대로 남아 '나간 멤버'로 보인다.
 */

export const MEMBER_REASON = {
  notMember: '이 여행방의 멤버가 아닙니다',
  selfOnly: '본인만 할 수 있습니다',
  hostLeave: '방장은 나갈 수 없습니다 · 방장 위임 미결정(프로토타입은 방장 위임을 지원하지 않습니다)',
  hostOnly: '방장만 할 수 있습니다',
  removeSelf: '방장 본인은 내보낼 수 없습니다',
  targetGone: '이미 나간 멤버입니다',
  targetHost: '방장에게는 쓸 수 없습니다',
  badNickname: `닉네임은 1~${NICKNAME_MAX}자로 적어 주세요`,
  anonymized: '탈퇴한 멤버입니다',
  joinActor: '합류는 합류하는 본인만 보낼 수 있습니다',
  joinRole: '초대로 합류한 멤버는 그룹원입니다',
  already: '이미 참여 중인 여행방입니다',
  duplicateId: '이미 있는 멤버 id입니다',
  inviteNotFound: '초대 코드를 찾을 수 없습니다',
  inviteExpired: '초대 링크가 만료되었습니다',
  inviteRevoked: '더 이상 쓸 수 없는 초대 링크입니다',
  inviteFull: '정원이 찼습니다',
} as const;

const INVITE_REASON = {
  notFound: MEMBER_REASON.inviteNotFound,
  expired: MEMBER_REASON.inviteExpired,
  revoked: MEMBER_REASON.inviteRevoked,
  full: MEMBER_REASON.inviteFull,
} as const;

/**
 * validate 사유 문구 → 합류 실패 코드(member/join validate 사유만). 종료 잠금(LOCKED_REASON)은 ops/index에 있어
 * 여기서 import하면 순환이 생긴다. 잠금까지 포함한 변환은 core/trip/join.joinFailure를 쓴다.
 */
export function joinFailCode(reason: string): 'notFound' | 'expired' | 'revoked' | 'full' {
  if (reason === MEMBER_REASON.inviteExpired) return 'expired';
  if (reason === MEMBER_REASON.inviteRevoked) return 'revoked';
  if (reason === MEMBER_REASON.inviteFull) return 'full';
  return 'notFound';
}

function validNickname(n: string): boolean {
  const t = n.trim();
  return t.length >= 1 && t.length <= NICKNAME_MAX;
}

function updateMember(doc: Trip, id: string, fn: (m: Member) => Member): Trip {
  let changed = false;
  const members = doc.members.map((m) => {
    if (m.id !== id) return m;
    const next = fn(m);
    if (next !== m) changed = true;
    return next;
  });
  return changed ? { ...doc, members } : doc;
}

export function reduce(doc: Trip, op: Op): Trip {
  switch (op.type) {
    case 'member/join': {
      const joined: Member = { ...op.member, nickname: op.member.nickname.trim(), role: 'member', canInvite: false };
      const prev = memberById(doc, joined.id);
      if (!prev) return { ...doc, members: [...doc.members, joined] };
      if (prev.leftAt == null) return doc;
      // 스스로 나갔던 같은 사람이 다시 합류: 행을 되살린다.
      return updateMember(doc, joined.id, () => ({ ...joined, joinedAt: prev.joinedAt }));
    }
    case 'member/leave':
      return updateMember(doc, op.memberId, (m) =>
        m.leftAt != null ? m : { ...m, leftAt: op.at, leftReason: 'left', canInvite: false },
      );
    case 'member/remove':
      return updateMember(doc, op.memberId, (m) =>
        m.leftAt != null ? m : { ...m, leftAt: op.at, leftReason: 'removed', canInvite: false },
      );
    case 'member/setCanInvite':
      return updateMember(doc, op.memberId, (m) =>
        m.canInvite === op.canInvite ? m : { ...m, canInvite: op.canInvite },
      );
    case 'member/rename':
      return updateMember(doc, op.memberId, (m) => ({ ...m, nickname: op.nickname.trim() }));
    case 'member/accountLinked':
      return updateMember(doc, op.actorId, (m) => ({ ...m, isGuest: false, userId: op.userId }));
    case 'member/anonymize':
      return updateMember(doc, op.memberId, (m) => ({
        ...m,
        nickname: DELETED_MEMBER_NAME,
        anonymized: true,
        canInvite: false,
        leftReason: 'deleted',
        leftAt: m.leftAt ?? op.at,
      }));
    default:
      return doc;
  }
}

export function validate(doc: Trip, op: Op): string | null {
  const actor = memberById(doc, op.actorId);
  switch (op.type) {
    case 'member/join': {
      const m = op.member;
      if (op.actorId !== m.id) return MEMBER_REASON.joinActor;
      if (m.role !== 'member') return MEMBER_REASON.joinRole;
      if (!validNickname(m.nickname)) return MEMBER_REASON.badNickname;
      const prev = memberById(doc, m.id);
      if (prev && (prev.leftAt == null || prev.userId !== m.userId || prev.leftReason !== 'left')) {
        return MEMBER_REASON.duplicateId;
      }
      if (activeMembers(doc).some((x) => x.userId === m.userId)) return MEMBER_REASON.already;
      const st = inviteStatus(doc, op.inviteCode, op.at);
      return st === 'ok' ? null : INVITE_REASON[st];
    }
    case 'member/anonymize':
      if (!actor) return MEMBER_REASON.notMember;
      return op.memberId === op.actorId ? null : MEMBER_REASON.selfOnly;
    case 'member/accountLinked':
      if (!actor) return MEMBER_REASON.notMember;
      if (actor.anonymized) return MEMBER_REASON.anonymized;
      return op.userId ? null : MEMBER_REASON.notMember;
    default:
      break;
  }

  if (!actor || actor.leftAt != null) return MEMBER_REASON.notMember;
  switch (op.type) {
    case 'member/leave':
      if (op.memberId !== op.actorId) return MEMBER_REASON.selfOnly;
      return actor.role === 'host' ? MEMBER_REASON.hostLeave : null;
    case 'member/remove': {
      if (!isHost(doc, op.actorId)) return MEMBER_REASON.hostOnly;
      if (op.memberId === op.actorId) return MEMBER_REASON.removeSelf;
      const target = memberById(doc, op.memberId);
      if (!target || target.leftAt != null) return MEMBER_REASON.targetGone;
      return target.role === 'host' ? MEMBER_REASON.targetHost : null;
    }
    case 'member/setCanInvite': {
      if (!isHost(doc, op.actorId)) return MEMBER_REASON.hostOnly;
      const target = memberById(doc, op.memberId);
      if (!target || target.leftAt != null) return MEMBER_REASON.targetGone;
      return target.role === 'host' ? MEMBER_REASON.targetHost : null;
    }
    case 'member/rename':
      if (op.memberId !== op.actorId) return MEMBER_REASON.selfOnly;
      return validNickname(op.nickname) ? null : MEMBER_REASON.badNickname;
    default:
      return null;
  }
}
