import { useMemo } from 'react';

import type { Plan, Trip } from '../../types';
import type { MapMarkerInput, MapPolylineInput } from '../../core/map/layout';
import { dayPolyline, planMapModel, type MapLeg, type PlanMapModel } from '../../core/map/model';
import { useLegGeometry } from '../../components/map/useLegGeometry';

/**
 * 계획 → 지도 입력 훅(WP5 소유). 11 지도, 13 길찾기, 19 여행 진행이 같이 쓴다.
 * 모델 계산은 core/map/model(순수)이고, 여기서는 구간 모양(routes.route)을 받아 선으로 잇기만 한다.
 * MapCanvas가 입력 배열이 같으면 다시 계산하지 않도록 memo로 같은 배열을 돌려준다.
 */

const NO_MARKERS: MapMarkerInput[] = [];
const NO_LINES: MapPolylineInput[] = [];
const NO_LEGS: MapLeg[] = [];

export interface DayMap {
  model?: PlanMapModel;
  markers: MapMarkerInput[];
  polylines: MapPolylineInput[];
  legs: MapLeg[];
  /** 선 가운데 하나라도 OpenStreetMap 길 모양이면 true. 화면이 출처를 적는다 */
  osmRoads: boolean;
}

export function useDayMap(trip: Trip | undefined, plan: Plan | undefined, date: string | 'all'): DayMap {
  const model = useMemo(() => (trip ? planMapModel(trip, plan, date) : undefined), [trip, plan, date]);
  const legs = useMemo(() => (model ? model.days.flatMap((d) => d.legs) : NO_LEGS), [model]);
  const geo = useLegGeometry(legs);
  const polylines = useMemo(
    () => (model ? model.days.map((d) => dayPolyline(`day:${d.date}`, d.legs, geo, d.color)) : NO_LINES),
    [model, geo],
  );
  const osmRoads = legs.some((l) => geo[l.key]?.road === 'osm');
  return { model, markers: model?.markers ?? NO_MARKERS, polylines, legs, osmRoads };
}
