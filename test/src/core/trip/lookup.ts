import type { Op, Trip } from '../../types';
import { foldOps } from '../ops';
import type { InviteLookup } from '../ports';
import { inviteStatus, wasIssued } from './invite';

/**
 * 초대 조회 결과. 포트 InviteLookup의 좁힌 모양이다(notFound에는 tripId가 없다).
 * 코드를 찾았지만 합류할 수 없을 때(만료·정원·무효)도 tripId를 싣는다. 이미 참여한 사람은 만료·정원과 상관없이
 * 방으로 들어가야 하므로(FR-302 already), 스토어가 이 tripId로 로그를 받아 참여 여부를 다시 본다.
 * 에러의 tripId는 통합 때 포트에 선택 필드로 들어갔다. 다른 전송이면 tripId가 없을 뿐이다.
 */
export type InviteLookupResult =
  | { trip: Trip }
  | { error: 'notFound' }
  | { error: 'expired' | 'revoked' | 'full'; tripId?: string };

/** 포트 결과에서 tripId를 꺼낸다(없으면 undefined). */
export function lookupTripId(r: InviteLookup): string | undefined {
  return 'trip' in r ? r.trip.id : r.tripId;
}

/**
 * 여러 여행방 로그에서 초대 코드를 찾는다(루프백 전송과 HTTP 전송이 쓴다).
 * 지금 코드면 inviteStatus로 판정하고, 예전에 발급했다가 바뀐 코드면 revoked다. 둘 다 tripId를 싣는다.
 */
export function lookupInviteInLogs(logs: Iterable<readonly Op[]>, code: string, now: number): InviteLookupResult {
  let revokedTrip: string | undefined;
  for (const ops of logs) {
    if (!wasIssued(ops, code)) continue;
    const trip = foldOps([...ops]);
    if (!trip || trip.deletedAt != null) continue;
    if (trip.invite?.code === code) {
      const st = inviteStatus(trip, code, now);
      if (st === 'ok') return { trip };
      if (st === 'notFound') return { error: 'notFound' };
      return { error: st, tripId: trip.id };
    }
    revokedTrip ??= trip.id;
  }
  return revokedTrip ? { error: 'revoked', tripId: revokedTrip } : { error: 'notFound' };
}
