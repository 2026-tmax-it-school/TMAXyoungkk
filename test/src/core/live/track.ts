import type { TrackPoint, Trip } from '../../types';
import type { LocationPermission } from '../ports';
import { isTrackExpired } from '../tripStatus';
import { kstDate } from '../util';

/**
 * 위치 로그(FR-704 입력, NFR 개인정보, WP5 소유, 순수).
 * useLive.track[tripId][date]에 쌓는다. 90일 판정은 공유 isTrackExpired만 쓴다.
 * 그룹원 위치 공유는 만들지 않는다(미결정). 로그는 이 기기에만 있고 서버로 보내지 않는다.
 * 백그라운드 동선 기록(사용자가 켠 옵션)으로 받은 샘플도 같은 로그에 같은 규칙(30초, 정지 건너뜀)으로 쌓는다.
 * 날짜별 권한 거부 기록(useLive.denied)도 여기서 다룬다. 기록 지도가 그날 왜 도착 지점만 이었는지 안내하는 데 쓴다.
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

/**
 * 그날 시뮬레이터 점만 지운다. 시뮬레이터 재생은 처음부터 다시 하므로 앞 재생 점을 남길 이유가 없다.
 * 남기면 '정상' 재생 뒤 '권한 거부' 프리셋으로 바꿨을 때 기록 지도가 앞 재생 점을 그날 이동처럼 그리고 거부 안내를 띄우지 않는다.
 * 기기 점은 그대로 둔다.
 */
export function clearSimTrackDay(track: TrackStore, tripId: string, date: string): TrackStore {
  const list = track[tripId]?.[date];
  if (!list || !list.some((p) => p.source === 'sim')) return track;
  const kept = list.filter((p) => p.source !== 'sim');
  if (kept.length === 0) return clearTrackDay(track, tripId, date);
  return { ...track, [tripId]: { ...track[tripId], [date]: kept } };
}

/**
 * 90일 지난 여행방의 위치 로그를 지운다. 여행방이 이 기기에 없으면 로그도 지운다.
 * 날짜별 권한 거부 기록도 같은 규칙으로 지운다(여행방 id가 첫 키인 저장이면 무엇이든).
 */
export function pruneTracks<T>(track: Record<string, T>, trips: Record<string, Pick<Trip, 'endDate'>>, now: number): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [tripId, days] of Object.entries(track)) {
    const trip = trips[tripId];
    if (!trip) continue;
    if (isTrackExpired(trip, now)) continue;
    out[tripId] = days;
  }
  return out;
}

/* ---------- 날짜별 권한 거부 기록 ---------- */

/** 그날 위치를 쓰려다 권한이 없어 수동 진행으로 돈 기록 */
export interface DeniedMark {
  /** 처음 거부된 시각 */
  at: number;
  /** sim이면 시뮬레이터 권한 거부 프리셋이다. 그날을 다시 진행하면(시뮬레이터·수동·기기) 지우거나 덮는다 */
  source: TrackPoint['source'];
}

/** tripId → date → 거부 기록 */
export type DeniedStore = Record<string, Record<string, DeniedMark>>;

/**
 * 여행 진행을 시작할 때 그날 거부 기록을 고친다.
 * - 위치를 쓰려다(시뮬레이터·기기) 권한이 없으면 남긴다. 수동 진행을 고른 것은 거부가 아니라 남기지 않는다.
 * - 기기 거부는 그날 실제로 진행할 때(진행 날짜가 오늘)만 남긴다. 출발 전에 앞날 일정을 기기 위치로 미리 시작해 보다가
 *   거부한 것은 그날 기록이 아니다. 남기면 그날 수동 진행으로 도착을 기록해도 기록 지도가 '권한이 없어'라고 안내한다.
 *   시뮬레이터는 가상 시각이 그 날짜라 그대로 남긴다.
 * - 그날 남은 기기 거부 기록은 지우지 않는다. 나중에 허용해 위치 로그가 생기면 기록 지도는 로그를 쓰고 안내를 띄우지 않는다.
 * - 시뮬레이터 기록은 그날을 다시 진행하면 지운다. 시뮬레이터 재생은 처음부터 다시 하고, 수동·기기 진행은 그날 실제 기록이라
 *   시연 때 남은 '시뮬레이터 권한 거부' 안내가 실제 도착 위에 뜨면 안 된다. 거부로 다시 진행하면 새 기록이 덮는다.
 *   진행 날짜가 아닌 날에 남은 기기 기록(이 규칙 전 기록)도 같이 지운다.
 * - 기기 거부를 시뮬레이터가 덮지 않는다.
 */
export function noteLivePermission(
  store: DeniedStore,
  tripId: string,
  date: string,
  r: { requested: 'sim' | 'device' | 'manual'; permission: LocationPermission; at: number },
): DeniedStore {
  const days = store[tripId] ?? {};
  const prev = days[date];
  // 다시 진행하면 지워도 되는 기록: 시뮬레이터 기록, 그 날짜가 아닌 때 남은 기기 기록
  const replaceable = prev != null && (prev.source === 'sim' || kstDate(prev.at) !== date);
  const denied = r.requested === 'sim' || (r.requested === 'device' && kstDate(r.at) === date);
  if (!denied || r.permission === 'granted') {
    if (!replaceable) return store;
    const rest = { ...days };
    delete rest[date];
    return { ...store, [tripId]: rest };
  }
  const source: DeniedMark['source'] = r.requested === 'sim' ? 'sim' : 'device';
  // 기기 거부는 처음 시각을 지킨다. 시뮬레이터 기록은 새 재생이나 기기 거부가 덮는다.
  if (prev != null && !replaceable) return store;
  return { ...store, [tripId]: { ...days, [date]: { at: r.at, source } } };
}
