import type { TrackPoint, Trip } from '../../types';
import { isTrackExpired } from '../tripStatus';

/**
 * 위치 로그(FR-704 입력, NFR 개인정보, WP5 소유, 순수).
 * useLive.track[tripId][date]에 쌓는다. 90일 판정은 공유 isTrackExpired만 쓴다.
 * 그룹원 위치 공유는 만들지 않는다(미결정). 로그는 이 기기에만 있다.
 */

export type TrackStore = Record<string, Record<string, TrackPoint[]>>;

/** 하루 로그 상한. 30초 간격이면 약 16시간 분이다. */
export const TRACK_DAY_MAX = 2000;

export function appendTrack(track: TrackStore, tripId: string, date: string, p: TrackPoint): TrackStore {
  const days = track[tripId] ?? {};
  const list = days[date] ?? [];
  const last = list[list.length - 1];
  // 같은 시각이 다시 오면(시뮬레이터 되감기) 뒤쪽을 잘라 시간순을 지킨다.
  const kept = last && last.t >= p.t ? list.filter((x) => x.t < p.t) : list;
  const next = [...kept, p].slice(-TRACK_DAY_MAX);
  return { ...track, [tripId]: { ...days, [date]: next } };
}

export function clearTrackDay(track: TrackStore, tripId: string, date: string): TrackStore {
  const days = track[tripId];
  if (!days || !days[date]) return track;
  const rest = { ...days };
  delete rest[date];
  return { ...track, [tripId]: rest };
}

/** 90일 지난 여행방의 위치 로그를 지운다. 여행방이 이 기기에 없으면 로그도 지운다. */
export function pruneTracks(track: TrackStore, trips: Record<string, Pick<Trip, 'endDate'>>, now: number): TrackStore {
  const out: TrackStore = {};
  for (const [tripId, days] of Object.entries(track)) {
    const trip = trips[tripId];
    if (!trip) continue;
    if (isTrackExpired(trip, now)) continue;
    out[tripId] = days;
  }
  return out;
}
