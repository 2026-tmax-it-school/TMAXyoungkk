import type { LatLng, Plan, Trip } from '../../types';
import type { MapMarkerInput, MapPolylineInput } from '../../core/map/layout';
import { dayPolyline, planMapModel } from '../../core/map/model';

/** 컴퓨터 시간표 오른쪽 단 너비와 본문+오른쪽 단 전체 너비(피그마 최종안 D3: 720 + 32 + 340) */
export const DESK_ASIDE_W = 340;
export const DESK_W = 1092;

/**
 * 컴퓨터 시간표 오른쪽 단의 그날 지도(순수). 순번 핀과 구간을 잇는 선(길 모양 없이 두 점 직선)이다.
 * 길 모양까지 그리는 큰 지도는 지도 탭이 맡는다.
 */
export function scheduleDayMap(
  trip: Trip,
  plan: Plan | undefined,
  date: string,
): { markers: MapMarkerInput[]; polylines: MapPolylineInput[]; fitTo: LatLng[] } {
  const model = planMapModel(trip, plan, date);
  const polylines = model.days.map((d) => dayPolyline(`day:${d.date}`, d.legs, {}, d.color));
  const markers = model.markers.filter((m) => m.kind !== 'excluded');
  return { markers, polylines, fitTo: markers.map((m) => m.coord) };
}
