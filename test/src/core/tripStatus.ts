import type { Trip } from '../types';
import { DATA_RETENTION_MS, TRACK_RETENTION_MS } from './constants';
import { addDays, atKst, daysBetween, kstDate } from './util';

/**
 * 여행방 상태(FR-203)와 보관 기한. 전부 KST 날짜로 판정하고 now는 appClock에서 받는다.
 * 시뮬레이터가 켜지면 가상 시각이 들어오므로 홈 상태와 종료 잠금이 같이 움직인다.
 */

export type TripStatus = 'upcoming' | 'ongoing' | 'done';

export function tripStatus(trip: Pick<Trip, 'startDate' | 'endDate'>, now: number): TripStatus {
  const today = kstDate(now);
  if (today < trip.startDate) return 'upcoming';
  if (today > trip.endDate) return 'done';
  return 'ongoing';
}

/** 시작일까지 남은 일수. 오늘이 시작일이면 0, 지났으면 음수. D-일 표시에 쓴다. */
export function daysUntil(trip: Pick<Trip, 'startDate'>, now: number): number {
  return daysBetween(kstDate(now), trip.startDate);
}

/** 종료일이 지났는지. 종료는 편집 잠금이지 삭제가 아니다. */
export function isEnded(trip: Pick<Trip, 'endDate'>, now: number): boolean {
  return kstDate(now) > trip.endDate;
}

/** 종료일 다음 날 00:00 KST */
function endBoundary(trip: Pick<Trip, 'endDate'>): number {
  return atKst(addDays(trip.endDate, 1), '00:00');
}

/** 위치 이력 90일 보관(개인정보). 종료일 다음 날 00:00 KST + 90일부터 만료다. */
export function isTrackExpired(trip: Pick<Trip, 'endDate'>, now: number): boolean {
  return now >= endBoundary(trip) + TRACK_RETENTION_MS;
}

/** 여행방·채팅·사진 1년 보관(데이터 보존). 이 시각부터 로컬에서 지운다. */
export function retentionUntil(trip: Pick<Trip, 'endDate'>): number {
  return endBoundary(trip) + DATA_RETENTION_MS;
}

export function isRetentionExpired(trip: Pick<Trip, 'endDate'>, now: number): boolean {
  return now >= retentionUntil(trip);
}
