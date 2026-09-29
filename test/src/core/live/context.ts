import type { DayPlan, LatLng, Transport, Trip } from '../../types';
import { atKst, toMin } from '../util';

/**
 * 여행 진행 판정의 입력(WP5 소유, 순수). 그날 DayPlan을 좌표가 붙은 목록으로 편다.
 * 시각은 자정부터의 분이다. 가상 시각이든 기기 시각이든 ms → 분 변환은 minuteOfDay 하나로 한다.
 */

export interface LiveItem {
  spotId: string;
  name: string;
  coord: LatLng;
  /** 예정 도착·출발(자정부터 분) */
  arriveMin: number;
  departMin: number;
  /** 직전 지점에서 오는 예정 이동 시간(분) */
  travelMin: number;
  transport: Transport;
}

export interface LiveDay {
  tripId: string;
  date: string;
  /** 그날 00:00 KST(ms) */
  dayStartMs: number;
  startMin: number;
  base: LatLng | null;
  items: LiveItem[];
}

export function minuteOfDay(day: Pick<LiveDay, 'dayStartMs'>, t: number): number {
  return (t - day.dayStartMs) / 60_000;
}

export function msOfMinute(day: Pick<LiveDay, 'dayStartMs'>, min: number): number {
  return day.dayStartMs + min * 60_000;
}

export function buildLiveDay(tripId: string, day: DayPlan, coordOf: (spotId: string) => LatLng | undefined): LiveDay {
  const items: LiveItem[] = [];
  for (const it of day.items) {
    const coord = coordOf(it.spotId);
    if (!coord) continue;
    items.push({
      spotId: it.spotId,
      name: it.name,
      coord,
      arriveMin: toMin(it.arrive),
      departMin: toMin(it.depart),
      travelMin: it.travelMin,
      transport: it.legTransport,
    });
  }
  return {
    tripId,
    date: day.date,
    dayStartMs: atKst(day.date, '00:00'),
    startMin: day.startMin,
    base: day.base?.coord ?? null,
    items,
  };
}

export function liveDayFromTrip(trip: Pick<Trip, 'id' | 'spots'>, day: DayPlan): LiveDay {
  const m = new Map(trip.spots.map((s) => [s.id, s.coord]));
  return buildLiveDay(trip.id, day, (id) => m.get(id));
}
