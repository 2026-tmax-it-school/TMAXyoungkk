import type { NotifyKind, Session, Trip } from '../../types';
import type { LocationPermission } from '../../core/ports';
import { isExpirySoon, tokenTail } from '../../core/session';
import { retentionUntil } from '../../core/tripStatus';
import { kstDate } from '../../core/util';

/**
 * 18 더보기 · 설정 문구(WP1 소유, 순수). wp1-home 테스트가 node로 부른다.
 */

export const NOTIFY_ROWS: { kind: NotifyKind; label: string; sub: string; scope: '2차' | '3차' }[] = [
  { kind: 'delay', label: '뒤 일정 조정안', sub: '예정보다 15분 이상 밀리면 조정안을 보여줍니다', scope: '2차' },
  { kind: 'arrival', label: '도착 확인', sub: '스팟 100m 안에 3분 머물면 도착으로 기록합니다', scope: '2차' },
  { kind: 'freeTime', label: '빈 시간 추천', sub: '다음 일정까지 30분 이상 남으면 근처를 추천합니다', scope: '3차' },
  { kind: 'sessionExpiry', label: '게스트 세션 만료 안내', sub: '만료 3일 전에 한 번 알려 드려요', scope: '2차' },
];

export const PERMISSION_LABEL: Record<LocationPermission, string> = {
  granted: '허용됨',
  denied: '거부됨 · 수동 진행 모드',
  undetermined: '아직 묻지 않음',
};

export interface SessionSummary {
  title: string;
  lines: string[];
  soon: boolean;
}

/** 세션 요약. 토큰은 끝 4자리만 보인다. */
export function sessionSummary(session: Session | undefined, now: number): SessionSummary {
  if (!session) return { title: '세션 없음', lines: ['닉네임으로 게스트를 시작하거나 로그인해 주세요.'], soon: false };
  const until = kstDate(session.expiresAt);
  if (session.kind === 'guest') {
    return {
      title: `게스트 · ${session.nickname}`,
      lines: [
        `${until}까지 유지 · 쓸 때마다 30일 연장`,
        `기기 토큰 ${tokenTail(session)} · 이 기기 한정, 만료되면 복구할 수 없음`,
      ],
      soon: isExpirySoon(session, now),
    };
  }
  return {
    title: `계정 · ${session.nickname}`,
    lines: [
      `${session.email ?? ''} · 로그인 ${until}까지 유지, 쓸 때마다 30일 연장`,
      `기기 토큰 ${tokenTail(session)}`,
    ],
    soon: false,
  };
}

/** 데이터 보존 안내. 여행방이 있으면 그 방의 보관 기한을 적는다. */
export function retentionText(trip: Trip | undefined): string {
  const base = '여행방·채팅·사진은 여행 종료 후 1년 동안 보관하고 그 뒤 이 기기에서 지웁니다. 위치 이력은 종료 후 90일입니다.';
  if (!trip) return base;
  return `${base} ${trip.title}: ${kstDate(retentionUntil(trip) - 1)}까지 보관.`;
}
