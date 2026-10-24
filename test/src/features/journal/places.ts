import type { Trip } from '../../types';

/** 그날 도착한 곳 이름(도착 시각 순, 겹치지 않게). 피그마 최종안 30 '오늘 간 곳' 배지 줄 */
export function arrivedNames(trip: Pick<Trip, 'visits' | 'spots'>, date: string): string[] {
  const out: string[] = [];
  const arrived = trip.visits.filter((v) => v.date === date && v.status === 'arrived').sort((a, b) => a.at - b.at);
  for (const v of arrived) {
    const name = trip.spots.find((s) => s.id === v.spotId)?.name;
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
