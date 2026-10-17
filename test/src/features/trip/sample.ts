import { sampleOps, sampleDates } from '../../core/trip/sample';
import { sampleTripFor, type SampleTrip } from '../../data/sampleTrips';
import { getServices } from '../../services/registry';
import { appClock } from '../../services/clock';
import { myMemberId, useTrips } from '../../store/trips';

/**
 * 예시 일정을 방금 만든 여행방에 담는다(WP2 소유). 만들기 화면이 방을 만든 직후 부른다.
 * 후보 추가·날짜·순서 op를 한 번에 보내고, 계산은 스토어가 평소처럼 이어서 한다.
 * 담지 못하면 방은 그대로 두고 false를 돌려준다(방 만들기는 막지 않는다).
 */
export function applySampleTrip(tripId: string, regionId: string, start: string, end: string, given?: SampleTrip): boolean {
  const sample = given ?? sampleTripFor(regionId);
  const doc = useTrips.getState().docs[tripId];
  const me = doc ? myMemberId(doc) : undefined;
  if (!sample || !me) return false;
  const { ids } = getServices();
  const { drafts } = sampleOps(sample, {
    dates: sampleDates(start, end),
    memberId: me,
    at: appClock().now(),
    newSpotId: () => ids.next('spot'),
  });
  const r = useTrips.getState().dispatchMany(tripId, drafts, { actorId: me, quiet: true });
  return r.ok;
}
