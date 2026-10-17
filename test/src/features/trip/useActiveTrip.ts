import { useEffect, useMemo } from 'react';

import { pickCurrentTrip } from '../../core/trip/current';
import { kstDate } from '../../core/util';
import { useNow } from '../../services/clock';
import { useMyTrips } from '../../store/trips';
import { useUi } from '../../store/ui';
import type { Trip } from '../../types';

/**
 * 지금 보는 여행방(공통). 홈, 일정·후보·지도 탭, 프로필 탭이 이 훅 하나로 방을 정한다.
 * trips는 내가 활성 멤버인 방 전부(useMyTrips), trip은 pickCurrentTrip(지정한 방 → 진행 중 → 예정 → 최근 완료)이다.
 * 고른 방이 저장된 선택(useUi.currentTripId)과 다르면 저장값을 맞춘다. 그래서 채팅·설정 같은 스택 화면도 같은 방을 본다.
 * 방은 TripBar(일정·지도 탭 맨 위)에서 그 자리에서 바꾼다.
 */
export function useActiveTrip(): { trip: Trip | undefined; trips: Trip[] } {
  const trips = useMyTrips();
  const currentTripId = useUi((s) => s.currentTripId);
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  const now = useNow();
  const today = kstDate(now);
  const trip = useMemo(() => pickCurrentTrip(trips, currentTripId, today), [trips, currentTripId, today]);
  useEffect(() => {
    if (trip && trip.id !== currentTripId) setCurrentTrip(trip.id);
  }, [trip, currentTripId, setCurrentTrip]);
  return { trip, trips };
}
