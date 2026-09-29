import type { DayPlan, LatLng, Transport, Trip } from '../../types';
import { TRANSPORT_LABEL } from '../constants';
import type { RouteLeg, RouteProvider } from '../ports';
import { liveLegs } from '../ops/schedule';
import { josa } from '../util';
import { dayContexts, legTransport } from './day';

/**
 * 구간 하나(FR-504, 12 화면, WP4 소유, 순수). legIndex 0은 기점 → 첫 스팟, i는 (i-1)번째 → i번째 스팟,
 * items.length는 마지막 스팟 → 기점 복귀다. 기점 없는 날(첫 스팟 기점)은 0번 구간이 없다.
 * 수단 비교는 route()를 수단마다 부른다. 이 호출은 24시간 캐시를 거치고 buildPlan의 호출 수에 넣지 않는다(A11).
 */

export interface LegEnds {
  date: string;
  legIndex: number;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  from: LatLng;
  to: LatLng;
  /** 지금 이 구간에 걸린 수단(구간 지정 → 날짜 수단 → 여행방 기본) */
  transport: Transport;
  /** 구간별 지정이 있는지 */
  overridden: boolean;
  /** 지금 계획의 이 구간 분 */
  plannedMin: number;
}

export function legEndpoints(trip: Trip, day: DayPlan, legIndex: number): LegEnds | undefined {
  const ctx = dayContexts(trip).find((c) => c.date === day.date);
  if (!ctx) return undefined;
  const hasBase = day.baseSource !== 'firstSpot' && !!day.base;
  const coordOf = (id: string) => trip.spots.find((s) => s.id === id)?.coord;
  const items = day.items;
  let fromId: string;
  let toId: string;
  let fromName: string;
  let toName: string;
  let plannedMin: number;
  if (legIndex === 0) {
    if (!hasBase || !items[0]) return undefined;
    fromId = 'base';
    fromName = day.base?.name ?? '기점';
    toId = items[0].spotId;
    toName = items[0].name;
    plannedMin = items[0].travelMin;
  } else if (legIndex < items.length) {
    fromId = items[legIndex - 1].spotId;
    fromName = items[legIndex - 1].name;
    toId = items[legIndex].spotId;
    toName = items[legIndex].name;
    plannedMin = items[legIndex].travelMin;
  } else if (legIndex === items.length && items.length > 0 && hasBase && !day.noReturn) {
    fromId = items[items.length - 1].spotId;
    fromName = items[items.length - 1].name;
    toId = 'base';
    toName = day.base?.name ?? '기점';
    plannedMin = day.returnMin;
  } else return undefined;
  const from = fromId === 'base' ? day.base?.coord : coordOf(fromId);
  const to = toId === 'base' ? day.base?.coord : coordOf(toId);
  if (!from || !to) return undefined;
  const overridden = liveLegs(trip.legs).some((l) => l.date === day.date && l.fromId === fromId && l.toId === toId);
  return {
    date: day.date,
    legIndex,
    fromId,
    toId,
    fromName,
    toName,
    from,
    to,
    transport: legTransport(ctx, fromId, toId),
    overridden,
    plannedMin,
  };
}

export interface LegOption {
  transport: Transport;
  leg: RouteLeg | null;
  /** 지금 수단보다 몇 분 더 걸리는지(느리면 +). 둘 중 하나라도 경로가 없으면 null */
  deltaMin: number | null;
  /** 이 수단 경로가 없을 때 대체 수단 안내 */
  fallbackText?: string;
}

export const LEG_TRANSPORTS: readonly Transport[] = ['car', 'walk', 'transit'];

export async function compareLeg(
  routes: RouteProvider,
  from: LatLng,
  to: LatLng,
  current: Transport,
): Promise<LegOption[]> {
  const legs = await Promise.all(
    LEG_TRANSPORTS.map(async (t) => {
      try {
        return await routes.route(from, to, t);
      } catch {
        return null;
      }
    }),
  );
  const cur = legs[LEG_TRANSPORTS.indexOf(current)];
  const available = LEG_TRANSPORTS.map((t, i) => ({ t, leg: legs[i] }))
    .filter((x) => x.leg)
    .sort((a, b) => (a.leg?.minutes ?? 0) - (b.leg?.minutes ?? 0));
  return LEG_TRANSPORTS.map((t, i) => {
    const leg = legs[i];
    const option: LegOption = { transport: t, leg, deltaMin: leg && cur ? leg.minutes - cur.minutes : null };
    if (!leg) {
      const alt = available.find((x) => x.t !== t);
      option.fallbackText = alt
        ? `${TRANSPORT_LABEL[t]} 경로가 없습니다. ${josa(TRANSPORT_LABEL[alt.t], '으로/로')} ${alt.leg?.minutes}분 걸립니다`
        : `${TRANSPORT_LABEL[t]} 경로가 없습니다`;
    }
    return option;
  });
}
