import { hasVote } from '../../../core/chatmap/votes';
import { isEditLocked } from '../../../core/ops';
import { appClock } from '../../../services/clock';
import { myMemberId, useTrips, type DispatchResult } from '../../../store/trips';
import { useUi } from '../../../store/ui';
import type { Spot, Trip } from '../../../types';
import { VOTE_REMOVED_REASON } from './text';

/**
 * 채팅방 지도의 투표 동작(FR-405, 명세 밖 추가). 스토어 API는 그대로 쓴다.
 * - 내 표를 뒤집는 spot/vote op 하나를 보낸다. placeId는 다른 기기에서 같은 장소가 합쳐졌을 때의 별칭이다.
 * - 접힌 문서에서 바로 수·순위·핀 라벨·투표자 아바타가 바뀐다(오프라인이면 대기 op로 바로 바뀌고, 연결되면 보낸다).
 * - 거절(멤버가 아님, 끝난 여행)은 스토어의 기존 토스트가 알린다.
 * - 제외된 후보는 보낼 때 여기서 막는다. core validate는 접을 때도 돌아서 제외 여부를 보지 않는다
 *   (제외·복원과 겹친 표가 도착 순서에 따라 버려지지 않게).
 */

/** 내가 지금 투표할 수 있는지. 멤버가 아니거나 여행이 끝났으면 못 한다 */
export function canVote(trip: Trip, now: number): boolean {
  return !!myMemberId(trip) && !isEditLocked(trip, now);
}

export function toggleVote(tripId: string, spot: Spot): DispatchResult | undefined {
  const trip = useTrips.getState().docs[tripId];
  if (!trip) return undefined;
  const me = myMemberId(trip);
  if (!me || !canVote(trip, appClock().now())) return undefined;
  // 화면이 들고 있던 스팟이 아니라 지금 접힌 문서의 스팟으로 뒤집는다(연달아 눌러도 한 번씩 바뀌게)
  const cur = trip.spots.find((s) => s.id === spot.id) ?? spot;
  if (cur.removedByUser) {
    useUi.getState().showToast(VOTE_REMOVED_REASON, 'warn');
    return { ok: false, reason: VOTE_REMOVED_REASON };
  }
  return useTrips
    .getState()
    .dispatch(tripId, { type: 'spot/vote', spotId: cur.id, placeId: cur.placeId, on: !hasVote(cur, me) }, { actorId: me });
}
