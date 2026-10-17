import type { DaySetting, DayBase, LatLng, Transport } from '../../types';
import type { Region, RouteLeg } from '../ports';
import { haversineKm } from '../util';
import { effectiveBase } from '../trip/create';
import { distanceText, legShape, legSteps, type MapLeg } from './model';

/**
 * 자유 길찾기(FR-601~603 확장, WP5 소유, 순수). 지도 탭의 '길찾기'(27 화면)가 쓴다.
 * 13 구간 내비는 계획 구간(스팟 → 다음 스팟)만 안내하고, 여기서는 아무 두 지점(내 위치·기점·스팟·검색 결과·지도에서 고른 곳)을
 * 도보·자동차·대중교통으로 견준다. 카카오맵 앱의 길찾기와 같은 흐름이다.
 * - 위치 원칙: 위치는 서버로 올리지 않는다. 사용자가 '내 위치'를 직접 고른 길찾기 질의만 예외로, 그 좌표가 경로 서버로 간다
 *   (ME_NOTICE를 화면에 한 줄로 보인다). 기본 출발은 기점이고 '내 위치'는 고를 때만 읽는다.
 * - 화면이 오래된 응답을 그리지 않게 요청마다 번호를 매긴다(createRequestGuard).
 */

export type EndpointKind = 'me' | 'base' | 'spot' | 'place' | 'map';

export interface Endpoint {
  kind: EndpointKind;
  name: string;
  coord: LatLng;
  /** 스팟 id나 장소 id. 내 위치·지도에서 고른 곳은 없다 */
  id?: string;
}

export type EndpointSide = 'from' | 'to';

export interface EndpointPair {
  from?: Endpoint;
  to?: Endpoint;
}

export const MAP_PICK_NAME = '지도에서 고른 곳';
export const ME_NAME = '내 위치';
/** 내 위치를 고른 길찾기만 위치가 밖으로 나간다(위치 비업로드 원칙의 유일한 예외) */
export const ME_NOTICE = '내 위치 좌표는 경로 계산 서버로만 가고, 카카오맵으로 열 때만 카카오맵에 넘깁니다.';

/** 화면에 보이는 이름. 기점은 '기점 · 이름', 이름 없는 지도 선택은 '지도에서 고른 곳' */
export function endpointLabel(e: Endpoint | undefined): string {
  if (!e) return '';
  if (e.kind === 'me') return ME_NAME;
  if (e.kind === 'base') return `기점 · ${e.name}`;
  const name = e.name.trim();
  return name.length > 0 ? name : MAP_PICK_NAME;
}

/** 칸이 비었을 때 안내 문구 */
export function endpointPlaceholder(side: EndpointSide): string {
  return side === 'from' ? '출발 위치를 고르세요' : '도착 위치를 고르세요';
}

/** 출발과 도착을 맞바꾼다. 한쪽만 있어도 바꾼다 */
export function swapEndpoints(p: EndpointPair): EndpointPair {
  return { from: p.to, to: p.from };
}

/** 지도에서 누른 곳. 근처 장소가 있으면 그 이름, 없으면 '지도에서 고른 곳'(누른 좌표 그대로) */
export function mapPickEndpoint(coord: LatLng, place: { name: string; coord: LatLng; placeId?: string } | null | undefined): Endpoint {
  if (place && place.name.trim()) return { kind: 'place', name: place.name, coord: place.coord, id: place.placeId };
  return { kind: 'map', name: MAP_PICK_NAME, coord };
}

/** 같은 지점으로 볼 거리(m) */
export const SAME_POINT_M = 15;

export type ReadyState = { ready: true } | { ready: false; reason: 'missing' | 'same' };

/** 경로를 물어도 되는지. 두 끝이 다 있고 서로 떨어져 있어야 한다(그 전에는 경로 요청을 하지 않는다) */
export function routeReady(p: EndpointPair): ReadyState {
  if (!p.from || !p.to) return { ready: false, reason: 'missing' };
  if (haversineKm(p.from.coord, p.to.coord) * 1000 < SAME_POINT_M) return { ready: false, reason: 'same' };
  return { ready: true };
}

/** 요청 묶음 키. 좌표 소수 5자리(약 1m). 같은 키면 다시 묻지 않는다 */
export function directionsKey(p: EndpointPair): string {
  const k = (e?: Endpoint) => (e ? `${e.coord.latitude.toFixed(5)},${e.coord.longitude.toFixed(5)}` : '-');
  return `${k(p.from)}>${k(p.to)}`;
}

/**
 * 오래된 응답 거르기. begin()이 새 번호를 주고, 응답이 오면 isCurrent(번호)로 아직 최신인지 본다.
 * 끝점이 바뀌면 begin()을 다시 불러 앞 요청의 응답을 버린다.
 */
export interface RequestGuard {
  begin(): number;
  isCurrent(token: number): boolean;
  /** 화면을 떠날 때 모든 응답을 버린다 */
  cancel(): void;
}

export function createRequestGuard(): RequestGuard {
  let seq = 0;
  return {
    begin() {
      seq += 1;
      return seq;
    },
    isCurrent(token) {
      return token === seq;
    },
    cancel() {
      seq += 1;
    },
  };
}

/** 카카오맵 웹 길찾기 링크. 이름은 URL 인코딩한다(쉼표·빗금도 %2C·%2F가 되어 구분자와 섞이지 않는다) */
export function kakaoDirectionsUrl(from: Endpoint, to: Endpoint): string {
  const part = (e: Endpoint) =>
    `${encodeURIComponent(endpointLabel(e))},${e.coord.latitude.toFixed(6)},${e.coord.longitude.toFixed(6)}`;
  return `https://map.kakao.com/link/from/${part(from)}/to/${part(to)}`;
}

/* ---------- 수단 비교 줄 ---------- */

/** 수단 줄 순서(카카오맵 길찾기처럼 자동차·대중교통·도보) */
export const MODE_ORDER: Transport[] = ['car', 'transit', 'walk'];

/** 이 직선거리(km)를 넘으면 도보 경로를 묻지도 보이지도 않는다(서울역 → 경주역 도보 78시간 같은 칸을 없앤다) */
export const WALK_MAX_KM = 30;

/** 두 끝점 사이에 견줄 수단. 직선 WALK_MAX_KM 초과면 도보를 뺀다. 끝점이 덜 정해졌으면 모두 */
export function modesFor(from: LatLng | undefined, to: LatLng | undefined): Transport[] {
  if (from && to && haversineKm(from, to) > WALK_MAX_KM) return MODE_ORDER.filter((t) => t !== 'walk');
  return MODE_ORDER;
}

const MODE_LABEL: Record<Transport, string> = { car: '자동차', transit: '대중교통', walk: '도보' };
const MODE_ICON: Record<Transport, 'car' | 'bus' | 'walk'> = { car: 'car', transit: 'bus', walk: 'walk' };

export type ModeResult = RouteLeg | null | undefined;

export interface ModeRow {
  transport: Transport;
  label: string;
  icon: 'car' | 'bus' | 'walk';
  /** loading: 아직 응답 없음, none: 경로 없음(null), ok: 결과 있음 */
  state: 'loading' | 'none' | 'ok';
  minutes?: number;
  meters?: number;
  /** '25분' · '찾는 중' · '경로 없음' */
  timeText: string;
  /** '3.2km'. 결과가 없으면 빈 문자열 */
  distText: string;
  estimated: boolean;
  /** 추정 칩 문구. 길 모양이 실제 길이면 '시간 추정', 직선이면 '직선거리 추정' */
  estimateText?: '시간 추정' | '직선거리 추정';
  /** 결과가 있는 수단 중 가장 빠르다(같으면 앞 순서) */
  fastest: boolean;
}

export function minutesText(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}시간` : `${h}시간 ${r}분`;
}

export function estimateTextOf(leg: RouteLeg): ModeRow['estimateText'] {
  if (!leg.estimated) return undefined;
  return leg.road ? '시간 추정' : '직선거리 추정';
}

/** 수단별 결과 → 비교 줄(순서 고정). 대중교통은 실제 노선(ODsay, estimated false)이면 추정 표시가 없고, 추정 모델이면 '시간 추정'이다 */
export function modeRows(results: Partial<Record<Transport, ModeResult>>, modes: readonly Transport[] = MODE_ORDER): ModeRow[] {
  const rows: ModeRow[] = modes.map((t) => {
    const r = results[t];
    const base = { transport: t, label: MODE_LABEL[t], icon: MODE_ICON[t], fastest: false };
    if (r === undefined) return { ...base, state: 'loading', timeText: '찾는 중', distText: '', estimated: false };
    if (r === null) return { ...base, state: 'none', timeText: '경로 없음', distText: '', estimated: false };
    const estimated = r.estimated;
    // 대중교통 추정은 선이 직선이어도 거리를 재지 않은 '시간' 추정이다
    const estimateText = r.estimated && t === 'transit' ? '시간 추정' : estimateTextOf(r);
    return {
      ...base,
      state: 'ok',
      minutes: r.minutes,
      meters: r.meters,
      timeText: minutesText(r.minutes),
      distText: distanceText(r.meters),
      estimated,
      estimateText,
    };
  });
  let best: ModeRow | undefined;
  for (const row of rows) if (row.state === 'ok' && (!best || (row.minutes ?? 0) < (best.minutes ?? 0))) best = row;
  if (best) best.fastest = true;
  return rows;
}

/** 처음 고를 수단. 고른 수단에 결과가 있으면 그대로, 없으면 결과가 있는 첫 수단 */
export function pickMode(rows: ModeRow[], wanted: Transport): Transport {
  const w = rows.find((r) => r.transport === wanted);
  if (w && w.state !== 'none') return wanted;
  // 고른 수단이 줄에 없거나(먼 거리의 도보) 경로가 없으면 결과가 있는 첫 수단, 없으면 첫 줄
  return rows.find((r) => r.state === 'ok')?.transport ?? (w ? wanted : rows[0]?.transport ?? wanted);
}

/* ---------- 선·안내 줄 ---------- */

function pseudoLeg(from: Endpoint, to: Endpoint, leg: RouteLeg | null | undefined): MapLeg {
  return {
    index: 0,
    key: 'directions',
    fromId: from.id ?? from.kind,
    toId: to.id ?? to.kind,
    fromName: endpointLabel(from),
    toName: endpointLabel(to),
    from: from.coord,
    to: to.coord,
    transport: leg?.transport ?? 'walk',
    estimated: false,
    minutes: leg?.minutes ?? 0,
  };
}

/** 지도에 그릴 선. 실제 길 모양이면 그 길(핀까지 짧게 잇는다), 직선 추정이거나 결과가 없으면 두 점 직선 */
export function directionsShape(from: Endpoint, to: Endpoint, leg: RouteLeg | null | undefined): LatLng[] {
  return legShape(pseudoLeg(from, to, leg), leg);
}

/** 안내 줄. 경로 제공자의 steps가 있으면 그대로, 없으면 방위·거리 한 줄과 도착 줄(13 legSteps와 같은 규칙) */
export function directionsSteps(from: Endpoint, to: Endpoint, leg: RouteLeg | null | undefined): RouteLeg['steps'] {
  return legSteps({ from: from.coord, to: to.coord, toName: endpointLabel(to) }, leg);
}

/* ---------- 기본 끝점 ---------- */

/** 여행방 기점. 그날 기점(직전 날짜 승계 포함), 없으면 날짜와 상관없이 처음 지정된 기점 */
export function tripBaseFor(days: readonly DaySetting[], date: string | undefined): DayBase | null {
  if (date) {
    const b = effectiveBase(days, date);
    if (b) return b;
  }
  for (const d of days) if (d.base && d.base !== 'inherit') return d.base;
  return null;
}

/**
 * 장소 검색 지역. 여행방 지역이 있으면 그 지역, 없으면 반대쪽 끝점이 들어 있는 지역, 그것도 없으면 첫 지역(기본).
 * 지역 목록은 호출하는 쪽이 넘긴다(data/regions).
 */
export function searchRegionFor(regions: readonly Region[], tripRegion: Region | undefined, near: LatLng | undefined): Region | undefined {
  if (tripRegion) return tripRegion;
  if (near) {
    const inside = regions.find((r) => haversineKm(r.center, near) <= r.radiusKm);
    if (inside) return inside;
  }
  return regions[0];
}

/**
 * 길찾기 장소 검색은 언제나 전국에서 찾는다(여행방 안에서 열었어도). 길찾기는 어디로든 갈 수 있어야 하고,
 * 지역 반경(중심 20km)으로 거르면 '성남역'을 찾을 때 서울 반경 안의 모란역·태평역만 나오던 문제가 생긴다(2026-10-10).
 * 결과 순서는 카카오 정확도순이고 반대쪽 끝점(searchBiasFor)은 거리 계산에만 쓴다.
 */
export const DIRECTIONS_SEARCH_ANYWHERE = true;

/**
 * 장소 검색의 가까운 쪽 기준점. 반대쪽 끝이 '내 위치'면 그 좌표를 검색 서비스로 보내지 않고 지역 중심을 쓴다
 * (내 위치 좌표는 경로 서버와 사용자가 누른 카카오맵 링크로만 간다).
 */
export function searchBiasFor(other: Endpoint | undefined, region: Region): LatLng {
  if (!other || other.kind === 'me') return region.center;
  return other.coord;
}

/** 검색어가 물어볼 만한지(두 글자 이상) */
export const MIN_QUERY = 2;
export function searchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY;
}
