import type { Member, Op, Trip } from '../../types';
import { isRetentionExpired } from '../tripStatus';
import { dateLongShort } from './format';

/**
 * 14 멤버 화면과 방 정리의 순수 판정(WP2 소유).
 */

export interface MemberRow {
  id: string;
  nickname: string;
  /** '방장 · 이 기기', '게스트 · 10월 9일 합류 · 초대 가능', '합류 전송 대기 · 연결되면 반영', '나간 멤버 · 정책 미결정' */
  sub: string;
  role: Member['role'];
  isMe: boolean;
  /** 이 멤버가 제안한 후보 수(FR-402 제안자 규칙과 연결) */
  candidates: number;
  /**
   * 합류 op가 아직 확인 응답을 받지 못함(칩 '전송 대기'). 목업 14의 '대기'(링크 열람 · 아직 합류 전)와 뜻이 다르다.
   * 링크를 열어 보기만 한 사람은 op를 남기지 않아 알 수 없다(04 코드리뷰 회의, 추적표 편차).
   */
  waiting: boolean;
  canInvite: boolean;
  left: boolean;
  anonymized: boolean;
}

/** 이 멤버가 제안자로 들어 있는 후보 수. 사용자가 뺀 후보도 제안 이력이라 센다. */
export function candidateCount(trip: Trip, memberId: string): number {
  return trip.spots.filter((s) => s.proposals.some((p) => p.memberId === memberId)).length;
}

function subOf(m: Member, isMe: boolean, waiting: boolean): string {
  if (m.anonymized) return '탈퇴한 멤버 · 제안과 채팅은 남습니다';
  if (m.leftAt != null) {
    const why = m.leftReason === 'removed' ? '내보낸 멤버' : '나간 멤버';
    return `${why} · 제안·채팅 유지 · 정책 미결정`;
  }
  if (waiting) return '합류 전송 대기 · 연결되면 반영';
  const kind = m.role === 'host' ? '방장' : m.isGuest ? '게스트' : '계정';
  // 초대 권한은 칩 대신 보조 줄에 붙인다(행 오른쪽 폭, 목업 14에 없는 칩).
  const perm = m.canInvite && m.role !== 'host' ? ' · 초대 가능' : '';
  if (isMe) return `${kind} · 이 기기${perm}`;
  return `${kind} · ${dateLongShort(m.joinedAt)} 합류${perm}`;
}

/** 멤버 행. 활성 멤버(방장 먼저, 합류 순) 뒤에 나간 멤버를 둔다. */
export function memberRows(trip: Trip, opts: { meId?: string; pending?: readonly Op[] } = {}): MemberRow[] {
  const waitingIds = new Set(
    (opts.pending ?? [])
      .filter((o) => o.tripId === trip.id && o.type === 'member/join')
      .map((o) => o.actorId),
  );
  const order = (m: Member) => (m.leftAt != null ? 2 : m.role === 'host' ? 0 : 1);
  return [...trip.members]
    .sort((a, b) => order(a) - order(b) || a.joinedAt - b.joinedAt)
    .map((m) => {
      const isMe = m.id === opts.meId;
      const waiting = m.leftAt == null && waitingIds.has(m.id);
      return {
        id: m.id,
        nickname: m.nickname,
        sub: subOf(m, isMe, waiting),
        role: m.role,
        isMe,
        candidates: candidateCount(trip, m.id),
        waiting,
        canInvite: m.canInvite,
        left: m.leftAt != null,
        anonymized: !!m.anonymized,
      };
    });
}

/** 나간 멤버 표시 이름. 채팅·후보 화면이 memberId로 이름을 찾을 때 쓴다. */
export function memberLabel(trip: Trip, memberId: string): string {
  const m = trip.members.find((x) => x.id === memberId);
  if (!m) return '나간 멤버';
  if (m.anonymized) return m.nickname;
  return m.leftAt != null ? `${m.nickname}(나간 멤버)` : m.nickname;
}

/** 보관 기한(종료 후 1년)이 지난 방. 부팅 때 로컬에서 지운다. */
export function expiredTripIds(docs: Record<string, Trip>, now: number): string[] {
  return Object.values(docs)
    .filter((t) => isRetentionExpired(t, now))
    .map((t) => t.id);
}

/** 이 userId가 활성 멤버로 있는 행 */
export function activeMemberOfUser(trip: Trip, userId: string | undefined): Member | undefined {
  if (!userId) return undefined;
  return trip.members.find((m) => m.userId === userId && m.leftAt == null);
}

/** 예전에 스스로 나간 같은 사람의 행(다시 합류하면 되살린다) */
export function leftMemberOfUser(trip: Trip, userId: string): Member | undefined {
  return trip.members.find((m) => m.userId === userId && m.leftAt != null && m.leftReason === 'left' && !m.anonymized);
}
