import type { DayPlan, LatLng, Plan, Transport, Trip } from '../../types';
import type { RouteLeg } from '../ports';
import { dayColor } from '../constants';
import { haversineKm } from '../util';
import type { MapMarkerInput, MapPolylineInput } from './layout';

/**
 * 계획 → 지도 입력(FR-801·802, WP5 소유, 순수). 11 지도, 13 길찾기, 19 여행 진행이 같이 쓴다.
 * - 확정 스팟은 그날 방문 순번이 박힌 로즈 핀, 기점은 속 빈 링, 제외 스팟은 흰 핀('제외')이다.
 * - 선 색은 날짜 순서로 잉크, 청회색, 초록, 앰버(core/constants dayColor)다. '전체' 보기에서는 핀 면도 그날 선 색이다
 *   (날마다 순번이 1부터라 핀 색이 없으면 어느 날짜 핀인지 구별할 수 없다).
 * - 구간 모양은 routes.route()의 polyline을 쓰고, estimated이거나 모양이 없으면 직선으로 잇는다(FR-802 예외).
 *   지도의 route() 호출은 buildPlan의 routeCalls(08 수치)에 넣지 않는다(03 회의 C9).
 */

export interface MapLeg {
  /** legIndex. 0은 기점 → 첫 스팟, items.length는 마지막 스팟 → 기점 복귀 */
  index: number;
  key: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  from: LatLng;
  to: LatLng;
  transport: Transport;
  estimated: boolean;
  minutes: number;
}

export type CoordOf = (spotId: string) => LatLng | undefined;

export function coordLookup(trip: Pick<Trip, 'spots'>): CoordOf {
  const m = new Map(trip.spots.map((s) => [s.id, s.coord]));
  return (id) => m.get(id);
}

/** 구간 캐시 키. 좌표 소수 5자리(약 1m)와 수단. */
export function legGeometryKey(a: LatLng, b: LatLng, transport: Transport): string {
  const k = (c: LatLng) => `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
  return `${transport}:${k(a)}>${k(b)}`;
}

/** 하루 구간 목록. 기점이 없으면(첫 스팟 기점) 0번 구간이 없다. 복귀 없음이면 복귀 구간이 없다. */
export function dayLegs(day: DayPlan, coordOf: CoordOf, tripTransport: Transport = 'car'): MapLeg[] {
  const out: MapLeg[] = [];
  const base = day.base;
  let prev: { id: string; name: string; coord: LatLng } | undefined = base
    ? { id: 'base', name: base.name, coord: base.coord }
    : undefined;
  day.items.forEach((it, i) => {
    const coord = coordOf(it.spotId);
    if (!coord) return;
    if (prev) {
      out.push({
        index: i,
        key: legGeometryKey(prev.coord, coord, it.legTransport),
        fromId: prev.id,
        toId: it.spotId,
        fromName: prev.name,
        toName: it.name,
        from: prev.coord,
        to: coord,
        transport: it.legTransport,
        estimated: it.legEstimated,
        minutes: it.travelMin,
      });
    }
    prev = { id: it.spotId, name: it.name, coord };
  });
  if (base && !day.noReturn && prev && prev.id !== 'base') {
    const last = day.items[day.items.length - 1];
    const transport = last?.legTransport ?? tripTransport;
    out.push({
      index: day.items.length,
      key: legGeometryKey(prev.coord, base.coord, transport),
      fromId: prev.id,
      toId: 'base',
      fromName: prev.name,
      toName: base.name,
      from: prev.coord,
      to: base.coord,
      transport,
      estimated: false,
      minutes: day.returnMin,
    });
  }
  return out;
}

/** 구간 모양. estimated이거나 route가 없으면 직선이다. */
export function legShape(leg: MapLeg, geo: RouteLeg | null | undefined): LatLng[] {
  if (leg.estimated || !geo || geo.estimated || geo.polyline.length < 2) return [leg.from, leg.to];
  return geo.polyline;
}

/** 하루 선 하나. 구간 모양을 이어 붙인다. */
export function dayPolyline(
  id: string,
  legs: MapLeg[],
  geometry: Record<string, RouteLeg | null | undefined>,
  color: MapPolylineInput['color'],
): MapPolylineInput {
  const coords: LatLng[] = [];
  for (const leg of legs) {
    const shape = legShape(leg, geometry[leg.key]);
    for (const c of shape) {
      const last = coords[coords.length - 1];
      if (last && last.latitude === c.latitude && last.longitude === c.longitude) continue;
      coords.push(c);
    }
  }
  return { id, coords, color };
}

export interface PlanMapModel {
  markers: MapMarkerInput[];
  /** 날짜마다 구간과 색. 선은 geometry를 받아 dayPolyline으로 만든다. */
  days: { date: string; color: MapPolylineInput['color']; legs: MapLeg[] }[];
  /** 계획이 아직 없어 순번 없이 후보만 찍었는지 */
  unplanned: boolean;
}

/**
 * 여행방 지도 모델. date가 'all'이면 모든 날짜를 겹쳐 그린다(순번은 날마다 1부터).
 * 계획이 없으면 후보를 순번 없이 찍는다(루트 계산 전에도 지도가 빈칸이 아니다).
 */
export function planMapModel(trip: Trip, plan: Plan | undefined, date: string | 'all'): PlanMapModel {
  const coordOf = coordLookup(trip);
  const markers: MapMarkerInput[] = [];
  const days: PlanMapModel['days'] = [];
  const planDays = plan?.days ?? [];
  const hasItems = planDays.some((d) => d.items.length > 0);
  if (!plan || !hasItems) {
    for (const s of trip.spots) {
      if (s.removedByUser) continue;
      markers.push({ id: s.id, coord: s.coord, kind: 'spot', title: s.name });
    }
    const firstBase = trip.days.find((d) => d.base && d.base !== 'inherit')?.base;
    if (firstBase && firstBase !== 'inherit') {
      markers.unshift({ id: 'base', coord: firstBase.coord, kind: 'base', title: firstBase.name });
    }
    return { markers, days, unplanned: true };
  }
  const seenBase = new Set<string>();
  planDays.forEach((d, di) => {
    if (date !== 'all' && d.date !== date) return;
    if (d.base) {
      const k = `${d.base.coord.latitude},${d.base.coord.longitude}`;
      if (!seenBase.has(k)) {
        seenBase.add(k);
        markers.push({ id: `base:${d.date}`, coord: d.base.coord, kind: 'base', title: d.base.name });
      }
    }
    const color = dayColor(di);
    d.items.forEach((it, i) => {
      const coord = coordOf(it.spotId);
      if (!coord) return;
      const m: MapMarkerInput = { id: it.spotId, coord, kind: 'spot', label: String(i + 1), title: it.name };
      if (date === 'all') m.color = color;
      markers.push(m);
    });
    days.push({ date: d.date, color, legs: dayLegs(d, coordOf, trip.transport) });
  });
  for (const ex of plan.excluded) {
    const coord = coordOf(ex.spotId);
    if (!coord) continue;
    markers.push({ id: ex.spotId, coord, kind: 'excluded', label: '제외', title: `${ex.name} · ${ex.reason}` });
  }
  return { markers, days, unplanned: false };
}

/* ---------- 13 길찾기 구간 안내 ---------- */

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

/** a → b 방위(0=북, 시계 방향 도) */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compassWord(deg: number): string {
  return DIRS[Math.round(deg / 45) % 8];
}

export function distanceText(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10}m` : `${(meters / 1000).toFixed(1)}km`;
}

/**
 * 구간 안내 줄. 경로 제공자가 steps를 주면 그대로 쓰고, 없으면(로컬 추정) 방위와 거리로 한 줄을 만든다.
 */
export function legSteps(leg: Pick<MapLeg, 'from' | 'to' | 'toName'>, geo: RouteLeg | null | undefined): { text: string; meters: number }[] {
  if (geo && geo.steps.length > 0) return geo.steps;
  const meters = geo?.meters ?? Math.round(haversineKm(leg.from, leg.to) * 1000);
  return [
    { text: `${compassWord(bearingDeg(leg.from, leg.to))}쪽으로 ${distanceText(meters)} 이동`, meters },
    { text: `${leg.toName} 도착`, meters: 0 },
  ];
}

/**
 * 진행률(0~1)로 지금 따라가는 안내 줄. 앞 줄들의 거리 합이 진행 거리를 넘는 첫 줄이다.
 * 마지막(도착) 줄은 진행률 1에서만 고른다.
 */
export function stepIndexAt(steps: { meters: number }[], fraction: number): number {
  if (steps.length === 0) return -1;
  const total = steps.reduce((s, x) => s + x.meters, 0);
  if (fraction >= 1 || total <= 0) return steps.length - 1;
  const done = Math.max(0, fraction) * total;
  let acc = 0;
  for (let i = 0; i < steps.length; i += 1) {
    acc += steps[i].meters;
    if (done < acc) return i;
  }
  return steps.length - 1;
}

/** 구간 진행률. 출발점에서 멀어진 만큼과 도착점까지 남은 만큼으로 잰다(직선 기준). */
export function legProgress(from: LatLng, to: LatLng, pos: LatLng): number {
  const total = haversineKm(from, to);
  if (total <= 0) return 1;
  const left = haversineKm(pos, to);
  return Math.min(1, Math.max(0, 1 - left / total));
}

/* ---------- 11 하단 시트 ---------- */

const ORDINALS = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];

/** 0 → '첫째 날'. 열흘을 넘으면 'N일째' */
export function dayOrdinal(index: number): string {
  return index < ORDINALS.length ? `${ORDINALS[index]} 날` : `${index + 1}일째`;
}

/** 하루 이동·체류 합(분). 이동에는 기점 복귀를 넣는다. */
export function daySummary(day: Pick<DayPlan, 'items' | 'returnMin'>): { travelMin: number; stayMin: number } {
  let travelMin = day.returnMin;
  let stayMin = 0;
  for (const it of day.items) {
    travelMin += it.travelMin;
    stayMin += it.stayMin;
  }
  return { travelMin, stayMin };
}
