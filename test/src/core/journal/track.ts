import type { LatLng, Plan, TrackPoint, Trip } from '../../types';
import { ARRIVAL_RADIUS_M } from '../constants';
import { haversineKm, kstDate } from '../util';

/**
 * 이동 경로 기록(FR-704)과 실제 경로 표시(FR-804) 데이터(WP6 소유, 순수).
 * 도착 기록 + 위치 로그 + 사진 EXIF 위치를 시간순 점(marks)으로 모은다.
 * - 선으로 잇는 점은 한 종류만 쓴다. 위치 로그가 있으면 내 기기 GPS 점만, 없으면(권한 거부, 90일 지나 삭제) 도착 지점만 잇는다.
 *   다른 멤버의 도착 기록이나 사진 위치를 GPS 점열에 섞으면 따로 움직인 경로가 지그재그로 이어지기 때문이다.
 *   사진 위치(EXIF GPS만)는 점으로만 둔다.
 * - 도착 지점만 이을 때 그 사이는 기록이 없는 구간이다.
 * - 기록이 없는 구간(백그라운드 공백 포함)은 gaps로 내고 지도는 점선으로 그린다. 공백을 채워 넣지 않는다.
 */

/** 이 시간 넘게 기록이 끊기고 그사이 멀리 움직였으면 기록 없는 구간이다(프로토타입 가정, 30초 간격 10샘플). */
export const TRACK_GAP_MS = 5 * 60 * 1000;
/** 정지 중 갱신 중단은 공백이 아니다. 이 거리 안이면 끊겨도 잇는다. */
export const TRACK_GAP_MIN_M = ARRIVAL_RADIUS_M;
/** 이보다 정확도가 나쁜 샘플은 경로에 쓰지 않는다(도착 반경과 같음) */
export const TRACK_MAX_ACCURACY_M = ARRIVAL_RADIUS_M;

export type TrackMarkKind = 'gps' | 'arrival' | 'photo';

export interface TrackMark {
  t: number;
  coord: LatLng;
  kind: TrackMarkKind;
  spotId?: string;
}

export interface DayTrack {
  /** 실제 경로 점(시간순, 모든 marks) */
  actual: LatLng[];
  /** 계획 루트(기점 → 스팟 → 기점) */
  planned: LatLng[];
  /** 기록 없는 구간. 각 구간은 [앞 점, 뒤 점] */
  gaps: LatLng[][];
  /** 기록이 이어진 구간(점 2개 이상). 지도는 실선으로 그린다. 공백을 건너 잇지 않는다. */
  segments: LatLng[][];
  marks: TrackMark[];
  /** 위치 로그 없이 도착 지점만 이었는지 */
  arrivalsOnly: boolean;
}

function dist(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

/** 계획 루트 좌표. 기점이 없으면 첫 스팟부터 */
export function plannedPath(trip: Trip, plan: Plan | undefined, date: string): LatLng[] {
  const day = plan?.days.find((d) => d.date === date);
  if (!day) return [];
  const out: LatLng[] = [];
  if (day.base) out.push(day.base.coord);
  for (const it of day.items) {
    const s = trip.spots.find((x) => x.id === it.spotId);
    if (s) out.push(s.coord);
  }
  if (day.base && !day.noReturn && day.items.length > 0) out.push(day.base.coord);
  return out;
}

export function buildDayTrack(trip: Trip, plan: Plan | undefined, date: string, points: TrackPoint[]): DayTrack {
  const marks: TrackMark[] = [];

  const gps = points.filter(
    (p) => kstDate(p.t) === date && (p.accuracyM == null || p.accuracyM <= TRACK_MAX_ACCURACY_M),
  );
  for (const p of gps) marks.push({ t: p.t, coord: p.coord, kind: 'gps' });

  // 도착은 스팟마다 가장 이른 한 번(여러 멤버가 같은 곳에 도착해도 점 하나)
  const firstArrival = new Map<string, number>();
  for (const v of trip.visits) {
    if (v.date !== date || v.status !== 'arrived') continue;
    const t = v.arrivedAt ?? v.at;
    const prev = firstArrival.get(v.spotId);
    if (prev == null || t < prev) firstArrival.set(v.spotId, t);
  }
  for (const [spotId, t] of firstArrival) {
    const s = trip.spots.find((x) => x.id === spotId);
    if (s) marks.push({ t, coord: s.coord, kind: 'arrival', spotId });
  }

  for (const ph of trip.photos) {
    if (ph.source !== 'exif' || !ph.coord || kstDate(ph.takenAt) !== date) continue;
    marks.push({ t: ph.takenAt, coord: ph.coord, kind: 'photo' });
  }

  marks.sort((a, b) => a.t - b.t);
  const arrivalsOnly = gps.length === 0;

  const gaps: LatLng[][] = [];
  const segments: LatLng[][] = [];
  const linked = marks.filter((m) => m.kind === (arrivalsOnly ? 'arrival' : 'gps'));
  let run: LatLng[] = linked.length > 0 ? [linked[0].coord] : [];
  for (let i = 1; i < linked.length; i += 1) {
    const a = linked[i - 1];
    const b = linked[i];
    const far = dist(a.coord, b.coord) > TRACK_GAP_MIN_M;
    if (far && (arrivalsOnly || b.t - a.t > TRACK_GAP_MS)) {
      gaps.push([a.coord, b.coord]);
      if (run.length >= 2) segments.push(run);
      run = [b.coord];
    } else {
      run.push(b.coord);
    }
  }
  if (run.length >= 2) segments.push(run);

  return {
    actual: marks.map((m) => m.coord),
    planned: plannedPath(trip, plan, date),
    gaps,
    segments,
    marks,
    arrivalsOnly,
  };
}
