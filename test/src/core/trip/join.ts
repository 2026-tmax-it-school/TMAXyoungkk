import type { Member, OpDraft, Trip } from '../../types';
import { NICKNAME_MAX } from '../constants';
import { isEditLocked, LOCKED_REASON } from '../ops';
import { joinFailCode } from '../ops/members';
import type { IdGen } from '../ports';
import { INVITE_ERROR_TEXT, inviteStatus, type InviteStatus } from './invite';
import { activeMemberOfUser, leftMemberOfUser } from './members';

/**
 * 초대 수락(FR-302) 순수 판정. 스토어 acceptInvite가 op를 보내기 전에 부른다.
 * - 같은 userId가 이미 활성 멤버면 op 없이 already(중복 멤버를 만들지 않는다).
 * - 스스로 나갔던 같은 사람이면 그 멤버 id로 다시 합류한다(이력 이어짐).
 * - 아니면 새 그룹원(role member, canInvite false)이다. 닉네임은 방마다 따로 둔다(12자).
 * 합류 가능 여부(만료·무효·정원)는 member/join validate가 op.at으로 판정한다.
 */

export interface Joiner {
  userId: string;
  nickname: string;
  isGuest: boolean;
}

export type JoinPlan =
  | { already: true; memberId: string }
  | { already: false; member: Member; draft: OpDraft };

export function cleanNickname(n: string): string {
  return n.trim().slice(0, NICKNAME_MAX);
}

export function planJoin(trip: Trip, who: Joiner, code: string, deps: { ids: IdGen; now: number }): JoinPlan {
  const mine = activeMemberOfUser(trip, who.userId);
  if (mine) return { already: true, memberId: mine.id };
  const prev = leftMemberOfUser(trip, who.userId);
  const member: Member = {
    id: prev?.id ?? deps.ids.next('m'),
    userId: who.userId,
    nickname: cleanNickname(who.nickname),
    role: 'member',
    isGuest: who.isGuest,
    canInvite: false,
    joinedAt: deps.now,
  };
  return { already: false, member, draft: { type: 'member/join', member, inviteCode: code } };
}

/**
 * 합류 실패 사유(02 화면·acceptInvite 결과). 초대 판정(InviteStatus)에 두 가지를 더한다.
 * - ended: 종료일이 지난 방. member/join은 종료 잠금 예외가 아니라서 validate가 잠금 사유로 거부한다.
 * - offline: 이 기기에 없는 방을 오프라인이라 확인하거나 합류하지 못했다.
 */
export type JoinFail = Exclude<InviteStatus, 'ok'> | 'ended' | 'offline';

/**
 * 합류 가능 여부. 삭제 → 종료 잠금 → 초대 판정 순서다. validate(잠금 → member/join)와 같은 결론을 내도록 맞췄다.
 * 이미 참여 중인지는 여기서 보지 않는다(참여 중이면 종료된 방에도 들어간다).
 */
export function joinStatus(trip: Trip, code: string, now: number): 'ok' | Exclude<JoinFail, 'offline'> {
  if (trip.deletedAt != null) return 'notFound';
  if (isEditLocked(trip, now)) return 'ended';
  return inviteStatus(trip, code, now);
}

/** dispatch 거부 사유 → 합류 실패 코드. 종료 잠금은 ended, 나머지는 member/join validate 사유를 따른다. */
export function joinFailure(reason: string): Exclude<JoinFail, 'offline'> {
  if (reason === LOCKED_REASON) return 'ended';
  return joinFailCode(reason);
}

/** 합류 실패 사유를 화면 문구로 */
export const JOIN_ERROR_TEXT: Record<JoinFail, string> = {
  ...INVITE_ERROR_TEXT,
  ended: '여행이 끝난 여행방이라 합류할 수 없습니다. 이미 참여한 멤버는 계속 볼 수 있습니다.',
  offline: '오프라인이라 이 초대를 확인할 수 없습니다. 연결되면 다시 시도해 주세요.',
};
