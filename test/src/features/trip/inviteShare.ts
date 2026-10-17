import type { Trip } from '../../types';
import { inviteStatus } from '../../core/trip/invite';

/**
 * 14 멤버 초대의 주 버튼 한 개('링크 만들고 공유하기' / '링크 공유하기')의 흐름(순수, WP2).
 * 스토어와 공유 시트는 주입한다(actions.ts의 issueAndShare가 실제 것을 넣고, 테스트는 가짜를 넣는다).
 * - 쓸 수 있는 링크가 있으면 그 링크를 공유한다.
 * - 링크가 없거나 무효(만료·재발급으로 무효)면 새로 만들고 그 링크를 공유한다.
 * - 만들 수 없으면(권한 없음·잠김, 사유 토스트는 dispatch가 띄운다) 공유하지 않고 'denied'다.
 */
export type ShareResult = 'shared' | 'copied' | 'failed' | 'dismissed';
export type IssueShareResult = ShareResult | 'denied';

/** 공유할 수 있는 링크인지. 정원이 찬 링크도 공유는 할 수 있다(화면의 링크 줄과 같은 기준). */
export function hasUsableInvite(trip: Trip, now: number): boolean {
  const code = trip.invite?.code;
  if (!code) return false;
  const s = inviteStatus(trip, code, now);
  return s === 'ok' || s === 'full';
}

export interface IssueShareDeps {
  /** 지금 문서(발급 뒤에 다시 읽는다) */
  getTrip: () => Trip | undefined;
  /** 새 초대 링크 발급. 성공하면 true */
  issue: () => boolean;
  share: (trip: Trip) => Promise<ShareResult>;
  now: number;
}

export async function issueAndShareWith(d: IssueShareDeps): Promise<IssueShareResult> {
  let trip = d.getTrip();
  if (!trip) return 'denied';
  if (!hasUsableInvite(trip, d.now)) {
    if (!d.issue()) return 'denied';
    trip = d.getTrip();
    if (!trip || !hasUsableInvite(trip, d.now)) return 'denied';
  }
  return d.share(trip);
}
