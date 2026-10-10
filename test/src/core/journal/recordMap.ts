import type { LatLng, Plan, TrackPoint, Trip } from '../../types';
import { dayColor } from '../constants';
import type { DeniedMark } from '../live/track';
import type { MapDotInput, MapMarkerInput, MapPolylineInput } from '../map/layout';
import { isTrackExpired } from '../tripStatus';
import { dateRange } from '../util';
import { buildDayTrack, type DayTrack } from './track';

/**
 * 22 기록 지도 모델(FR-704·804, WP6 소유, 순수). buildDayTrack 결과를 MapCanvas 입력으로 바꾼다.
 * - 계획 루트: 날짜 색(core/constants dayColor: 1일 잉크, 2일 청회색, 3일 초록, 4일부터 앰버) 실선
 * - 실제 경로: 이동 점(tone ink)만 찍는다(FR-804 '실제 이동한 지점을 점으로'). 점은 현재 위치와 같은 파랑(mapC.user)으로
 *   그려 어느 날짜 선 색과도 겹치지 않는다. 실선을 겹치면 계획 루트 선을 가린다.
 *   기록 없는 구간(백그라운드 공백, 권한 거부)은 점선이고 채워 넣지 않는다. 점선은 잉크인데, 계획 선이 잉크인 날(1일)은
 *   계획 선 위에 겹쳐도 보이도록 청회색이다(gapLineColor).
 * - 핀 번호는 계획 순번이다. 도착 목록(rows)도 같은 번호를 쓰고, 지나친 계획 스팟은 흰 핀(번호만), 계획 밖 도착은 번호 없는 핀이다.
 * - 위치 이력 90일이 지나면(공유 isTrackExpired) 위치 로그를 쓰지 않고 도착 지점만 잇는다.
 * - '권한 거부' 안내는 그날 남은 거부 기록(useLive.denied, core/live/track noteLivePermission)으로 띄운다.
 *   도착 지점이 있으면 '도착 지점만 이었다'(denied), 없으면 '이동 기록이 없다'(deniedNone)다.
 *   거부 기록이 없는 날에 로그가 없으면 '위치 기록 없음'이다. 시뮬레이터 권한 거부 프리셋이면 시뮬레이터 안내도 함께 띄운다.
 * - 그날 기기 위치를 쓰려다 거부된 기록이 있으면 같은 날 남은 시뮬레이터 점(시연 재생)은 쓰지 않는다. 시연 점이 실제 이동처럼
 *   그려지고 거부 안내가 가려지지 않게(스토어는 그날을 실제로 진행할 때 시뮬레이터 점을 지운다. 그 전에 남은 기록 대비).
 */

/** deniedNone: 권한이 없었고 도착 기록도 없어 이은 점이 없다 */
export type RecordNoticeKind = 'expired' | 'denied' | 'deniedNone' | 'noLog' | 'sim';

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
  /** 기록 없는 구간 점선 색. 계획 선과 다르다 */
  gapColor: MapPolylineInput['color'];
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

/** 계획 루트 색. 지도(11)·길찾기와 같은 날짜 색 체계(core/constants dayColor)를 쓴다. 여행 밖 날짜는 1일 색 */
export function dayLineColor(trip: Pick<Trip, 'startDate' | 'endDate'>, date: string): MapPolylineInput['color'] {
  return dayColor(Math.max(0, dateRange(trip.startDate, trip.endDate).indexOf(date)));
}

/** 기록 없는 구간 점선 색. 점선은 계획 선 위에 겹치기 쉬워(권한 거부면 도착 지점끼리라 계획 선과 같은 자리) 계획 선과 다른 색을 쓴다 */
export function gapLineColor(planned: MapPolylineInput['color']): MapPolylineInput['color'] {
  return planned === 'ink' ? 'slate' : 'ink';
}

/** 실제 이동 점 tone. 렌더러는 ink tone을 현재 위치와 같은 파랑(mapC.user)으로 그린다. 날짜 선 색에는 파랑이 없다 */
export const ACTUAL_DOT_TONE: MapDotInput['tone'] = 'ink';

export function recordMapModel(
  trip: Trip,
  plan: Plan | undefined,
  date: string,
  points: TrackPoint[],
  opts: { now: number; denied?: DeniedMark },
): RecordMapModel {
  const expired = isTrackExpired(trip, opts.now);
  // 기기 거부 날에 남은 시뮬레이터 점은 그날 이동이 아니다.
  const usable = expired ? [] : opts.denied?.source === 'device' ? points.filter((p) => p.source !== 'sim') : points;
  const track = buildDayTrack(trip, plan, date, usable);
  const plannedColor = dayLineColor(trip, date);
  const gapColor = gapLineColor(plannedColor);

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
  track.gaps.forEach((g, i) => polylines.push({ id: `gap-${i}`, coords: g, color: gapColor, dashed: true }));

  const dots: MapDotInput[] = track.marks
    .filter((m) => m.kind !== 'arrival')
    .map((m, i) => ({
      id: `${m.kind}-${i}`,
      coord: m.coord,
      tone: m.kind === 'gps' ? ACTUAL_DOT_TONE : 'faint',
      size: m.kind === 'gps' ? 'md' : 'sm',
    }));

  const notices: RecordNoticeKind[] = [];
  // 90일이 지나면 WP5 pruneTrack이 로그를 지우므로 남은 점이 없어도 안내한다.
  if (expired) notices.push('expired');
  const gpsPoints = track.marks.filter((m) => m.kind === 'gps').length;
  const arrivals = track.marks.filter((m) => m.kind === 'arrival').length;
  const denied = !expired && track.arrivalsOnly && opts.denied != null;
  if (track.arrivalsOnly) {
    // 도착 지점이 없으면 '도착 지점만 이었다'가 아니라 이동 기록이 없다고 알린다(이은 점도 점선도 없다).
    if (denied) notices.push(arrivals > 0 ? 'denied' : 'deniedNone');
    else if (!expired && track.marks.length > 0) notices.push('noLog');
  }
  // 시뮬레이터 권한 거부 프리셋은 위치 점이 없어도 시뮬레이터 기록이라고 알린다.
  if (!expired && (usable.some((p) => p.source === 'sim') || (denied && opts.denied?.source === 'sim'))) notices.push('sim');

  return {
    track,
    markers,
    polylines,
    dots,
    fitTo: [...track.planned, ...track.actual],
    plannedColor,
    gapColor,
    notices,
    rows,
    arrivals,
    gpsPoints,
    empty: track.planned.length === 0 && track.marks.length === 0,
  };
}
