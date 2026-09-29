import type { LatLng, Plan, TrackPoint, Trip } from '../../types';
import type { MapDotInput, MapMarkerInput, MapPolylineInput } from '../map/layout';
import { isTrackExpired } from '../tripStatus';
import { dateRange, kstDate } from '../util';
import { buildDayTrack, type DayTrack } from './track';

/**
 * 22 기록 지도 모델(FR-704·804, WP6 소유, 순수). buildDayTrack 결과를 MapCanvas 입력으로 바꾼다.
 * - 계획 루트: 날짜 색(1일 로즈, 2일 초록, 3일 앰버, 4일부터 잉크) 실선
 * - 실제 경로: 잉크 점만 찍는다(FR-804 '실제 이동한 지점을 점으로'). 실선을 겹치면 계획 루트 선을 가린다.
 *   기록 없는 구간(백그라운드 공백, 권한 거부)은 잉크 점선이고 채워 넣지 않는다.
 * - 핀 번호는 계획 순번이다. 도착 목록(rows)도 같은 번호를 쓰고, 지나친 계획 스팟은 흰 핀(번호만), 계획 밖 도착은 번호 없는 핀이다.
 * - 위치 이력 90일이 지나면(공유 isTrackExpired) 위치 로그를 쓰지 않고 도착 지점만 잇는다.
 * - 위치 권한 상태는 지금 값만 알 수 있어, '권한 거부' 안내는 오늘 날짜에만 띄운다. 다른 날은 '위치 기록 없음'이다.
 */

const DAY_LINE: MapPolylineInput['color'][] = ['ink', 'slate', 'ok', 'warn'];

export type RecordNoticeKind = 'expired' | 'denied' | 'noLog' | 'sim';

/** 22 도착 목록 한 줄. label은 지도 핀 번호(계획 순번) */
export interface RecordRow {
  spotId: string;
  label?: string;
  state: 'arrived' | 'passed' | 'offPlan';
  /** 도착 시각(지나침이면 없음) */
  t?: number;
}

export interface RecordMapModel {
  track: DayTrack;
  markers: MapMarkerInput[];
  polylines: MapPolylineInput[];
  dots: MapDotInput[];
  fitTo: LatLng[];
  plannedColor: MapPolylineInput['color'];
  notices: RecordNoticeKind[];
  /** 도착 목록. 계획 순번 순서, 계획 밖 도착은 뒤에 시각 순 */
  rows: RecordRow[];
  /** 그날 도착한 스팟 수 */
  arrivals: number;
  /** 경로에 쓴 위치 샘플 수 */
  gpsPoints: number;
  /** 보여줄 것이 하나도 없는지(계획도 기록도 없음) */
  empty: boolean;
}

export function dayLineColor(trip: Pick<Trip, 'startDate' | 'endDate'>, date: string): MapPolylineInput['color'] {
  const i = Math.max(0, dateRange(trip.startDate, trip.endDate).indexOf(date));
  return DAY_LINE[Math.min(i, DAY_LINE.length - 1)];
}

export function recordMapModel(
  trip: Trip,
  plan: Plan | undefined,
  date: string,
  points: TrackPoint[],
  opts: { now: number; permission: 'granted' | 'denied' | 'undetermined' },
): RecordMapModel {
  const expired = isTrackExpired(trip, opts.now);
  const usable = expired ? [] : points;
  const track = buildDayTrack(trip, plan, date, usable);
  const plannedColor = dayLineColor(trip, date);

  const markers: MapMarkerInput[] = [];
  const day = plan?.days.find((d) => d.date === date);
  if (day?.base) markers.push({ id: 'base', coord: day.base.coord, kind: 'base', title: day.base.name });
  const arrivedAt = new Map<string, number>();
  for (const m of track.marks) if (m.kind === 'arrival' && m.spotId) arrivedAt.set(m.spotId, m.t);
  const skipped = new Set(
    trip.visits.filter((v) => v.date === date && v.status === 'skipped' && !arrivedAt.has(v.spotId)).map((v) => v.spotId),
  );
  const items = (day?.items ?? []).filter((it) => trip.spots.some((x) => x.id === it.spotId));
  // 뒤 순번 스팟에 도착했는데 앞 순번에 도착 기록이 없으면 지나친 것이다.
  let lastArrivedIdx = -1;
  items.forEach((it, i) => {
    if (arrivedAt.has(it.spotId)) lastArrivedIdx = i;
  });

  const rows: RecordRow[] = [];
  const onPlan = new Set<string>();
  items.forEach((it, i) => {
    const s = trip.spots.find((x) => x.id === it.spotId)!;
    onPlan.add(s.id);
    const label = String(i + 1);
    const t = arrivedAt.get(s.id);
    const passed = t == null && (skipped.has(s.id) || i < lastArrivedIdx);
    markers.push({ id: s.id, coord: s.coord, kind: passed ? 'excluded' : 'spot', label, title: s.name });
    if (t != null) rows.push({ spotId: s.id, label, state: 'arrived', t });
    else if (passed) rows.push({ spotId: s.id, label, state: 'passed' });
  });
  const offPlan = track.marks
    .filter((m) => m.kind === 'arrival' && m.spotId && !onPlan.has(m.spotId))
    .sort((a, b) => a.t - b.t);
  for (const m of offPlan) {
    const s = trip.spots.find((x) => x.id === m.spotId);
    if (!s) continue;
    // 계획에 없던 곳(일정 변경 뒤 도착 등)은 순번 없이 둔다.
    markers.push({ id: s.id, coord: s.coord, kind: 'spot', title: s.name });
    rows.push({ spotId: s.id, state: 'offPlan', t: m.t });
  }

  const polylines: MapPolylineInput[] = [];
  if (track.planned.length >= 2) polylines.push({ id: 'planned', coords: track.planned, color: plannedColor });
  track.gaps.forEach((g, i) => polylines.push({ id: `gap-${i}`, coords: g, color: 'ink', dashed: true }));

  const dots: MapDotInput[] = track.marks
    .filter((m) => m.kind !== 'arrival')
    .map((m, i) => ({
      id: `${m.kind}-${i}`,
      coord: m.coord,
      tone: m.kind === 'gps' ? 'ink' : 'faint',
      size: m.kind === 'gps' ? 'md' : 'sm',
    }));

  const notices: RecordNoticeKind[] = [];
  // 90일이 지나면 WP5 pruneTrack이 로그를 지우므로 남은 점이 없어도 안내한다.
  if (expired) notices.push('expired');
  if (track.arrivalsOnly) {
    if (opts.permission === 'denied' && date === kstDate(opts.now)) notices.push('denied');
    else if (!expired && track.marks.length > 0) notices.push('noLog');
  }
  if (!expired && usable.some((p) => p.source === 'sim')) notices.push('sim');

  const gpsPoints = track.marks.filter((m) => m.kind === 'gps').length;
  const arrivals = track.marks.filter((m) => m.kind === 'arrival').length;
  return {
    track,
    markers,
    polylines,
    dots,
    fitTo: [...track.planned, ...track.actual],
    plannedColor,
    notices,
    rows,
    arrivals,
    gpsPoints,
    empty: track.planned.length === 0 && track.marks.length === 0,
  };
}
