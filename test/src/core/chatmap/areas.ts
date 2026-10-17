import type { LatLng, Member, Spot } from '../../types';
import { proposerIds } from '../spotUtil';
import { haversineKm } from '../util';

/**
 * 채팅방 지도의 지역(FR-405, 명세 밖 추가, 순수). 여행 지역 안의 작은 지역을 스팟 주소에서 정한다.
 * 지역 경계 데이터가 없으므로 주소 글자만 보고, 도로 이름만 있는 주소는 가까운 기준 지역에 붙인다.
 *
 * areaOf(address, region)
 * 1. 주소가 없으면 '기타'. 괄호 묶음을 지우고 공백을 줄여 토큰으로 나눈다.
 * 2. region.label의 마지막 토큰('경주시', '제주특별자치도')을 앞 2개 토큰 안에서 찾는다. 없으면 region.name으로 시작하고
 *    도·시·군으로 끝나는 토큰('경북 경주시'의 경주시, '제주 제주시'의 제주시)을 받는다. 그것도 없으면 지역 이름 그대로인
 *    토큰을 받는다(카카오가 줄여 쓰는 광역시·특별시: '서울 종로구', '부산 해운대구'). 셋 다 없으면 지역 밖이라 '기타'다.
 * 3. 남은 토큰 r0, r1로 정한다.
 *    a. r0이 시·군·구로 끝나면 r1이 읍·면일 때 r1, 아니면 r0
 *    b. r0이 읍·면·동·리·가로 끝나면 r0(동 앞 숫자는 지운다: 일도1동 → 일도동)
 *    c. r0이 도로(…로, …길, …99번길)면 번길 꼬리를 뗀 도로 이름이고 loose(기준 지역에 붙일 후보)다
 *    d. 그 밖은 '기타'
 *
 * groupAreas(spots, region, active)
 * - 제외된 스팟은 뺀다. a·b 결과가 기준 지역이다.
 * - loose 스팟은 기준 지역 스팟들의 중심까지 거리가 2km 안인 가장 가까운 지역에 붙고, 없으면 '{도로} 일대'가 된다.
 * - 정렬은 고른 사람 수, 스팟 수, 이름(ko) 순이고 '기타'는 늘 마지막이다. 8개를 넘으면 뒤쪽을 '기타'로 접는다.
 * - pickerIds는 그 지역 스팟을 말한(제안한) 활성 멤버를 멤버 순서로 둔다.
 */

export const ETC_AREA = '기타';
export const MAX_AREAS = 8;
/** 도로 이름만 있는 스팟이 기준 지역에 붙는 거리(km) */
export const LOOSE_JOIN_KM = 2;

export interface AreaRegion {
  name: string;
  label: string;
}

export interface ParsedArea {
  name: string;
  /** 도로 이름에서 나온 지역(기준 지역에 붙일 후보) */
  loose: boolean;
}

export interface ChatArea {
  key: string;
  name: string;
  spotIds: string[];
  pickerIds: string[];
}

const ETC: ParsedArea = { name: ETC_AREA, loose: false };
const ROAD_TAIL = /\d+번?길$/;

function tokensOf(address: string): string[] {
  return address
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0);
}

/** 주소 한 줄의 지역과 loose 여부 */
export function parseArea(address: string | undefined, region: AreaRegion | undefined): ParsedArea {
  if (!address || !region) return ETC;
  const tokens = tokensOf(address);
  if (tokens.length === 0) return ETC;
  const head = tokens.slice(0, 2);
  const labelLast = region.label.split(/\s+/).filter(Boolean).pop() ?? '';
  let at = labelLast ? head.indexOf(labelLast) : -1;
  if (at < 0) at = head.findIndex((t) => t.startsWith(region.name) && /(도|시|군)$/.test(t));
  if (at < 0) at = head.indexOf(region.name);
  if (at < 0) return ETC;
  const [r0, r1] = tokens.slice(at + 1);
  if (!r0) return ETC;
  if (/(시|군|구)$/.test(r0)) return { name: r1 && /(읍|면)$/.test(r1) ? r1 : r0, loose: false };
  if (/(읍|면|동|리|가)$/.test(r0)) return { name: r0.replace(/\d+동$/, '동'), loose: false };
  if (/(로|길)$/.test(r0) || ROAD_TAIL.test(r0)) {
    const road = r0.replace(ROAD_TAIL, '');
    return road ? { name: road, loose: true } : ETC;
  }
  return ETC;
}

export function areaOf(address: string | undefined, region: AreaRegion | undefined): string {
  return parseArea(address, region).name;
}

function center(cs: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const c of cs) {
    lat += c.latitude;
    lng += c.longitude;
  }
  return { latitude: lat / cs.length, longitude: lng / cs.length };
}

const byKo = (a: string, b: string) => a.localeCompare(b, 'ko');

export function groupAreas(spots: readonly Spot[], region: AreaRegion | undefined, active: readonly Member[]): ChatArea[] {
  const live = spots.filter((s) => !s.removedByUser);
  const parsed = live.map((s) => ({ spot: s, area: parseArea(s.address, region) }));

  // 기준 지역(행정 지역)과 그 스팟 좌표
  const anchors = new Map<string, Spot[]>();
  for (const { spot, area } of parsed) {
    if (area.loose || area.name === ETC_AREA) continue;
    anchors.set(area.name, [...(anchors.get(area.name) ?? []), spot]);
  }
  const centers = [...anchors.entries()].map(([name, ss]) => ({ name, at: center(ss.map((s) => s.coord)) }));

  const areaOfSpot = new Map<string, string>();
  for (const { spot, area } of parsed) {
    if (!area.loose) {
      areaOfSpot.set(spot.id, area.name);
      continue;
    }
    let best: { name: string; km: number } | undefined;
    for (const c of centers) {
      const km = haversineKm(spot.coord, c.at);
      if (km <= LOOSE_JOIN_KM && (!best || km < best.km)) best = { name: c.name, km };
    }
    areaOfSpot.set(spot.id, best ? best.name : `${area.name} 일대`);
  }

  const order = new Map<string, string[]>();
  for (const s of live) {
    const name = areaOfSpot.get(s.id) ?? ETC_AREA;
    order.set(name, [...(order.get(name) ?? []), s.id]);
  }

  const byId = new Map(live.map((s) => [s.id, s]));
  const pickersOf = (spotIds: string[]): string[] => {
    const said = new Set<string>();
    for (const id of spotIds) for (const m of proposerIds(byId.get(id) as Spot)) said.add(m);
    return active.filter((m) => said.has(m.id)).map((m) => m.id);
  };

  const named: ChatArea[] = [];
  let etcIds: string[] = order.get(ETC_AREA) ?? [];
  for (const [name, spotIds] of order) {
    if (name === ETC_AREA) continue;
    named.push({ key: name, name, spotIds, pickerIds: pickersOf(spotIds) });
  }
  named.sort((a, b) => b.pickerIds.length - a.pickerIds.length || b.spotIds.length - a.spotIds.length || byKo(a.name, b.name));

  const room = etcIds.length > 0 || named.length > MAX_AREAS ? MAX_AREAS - 1 : MAX_AREAS;
  const kept = named.slice(0, room);
  for (const folded of named.slice(room)) etcIds = [...etcIds, ...folded.spotIds];
  if (etcIds.length > 0) {
    // 접힌 스팟도 원래 스팟 순서로 둔다
    const set = new Set(etcIds);
    const ids = live.filter((s) => set.has(s.id)).map((s) => s.id);
    kept.push({ key: ETC_AREA, name: ETC_AREA, spotIds: ids, pickerIds: pickersOf(ids) });
  }
  return kept;
}

/** 스팟 id → 지역 key(칩·지도·시트가 같이 쓴다) */
export function areaIndex(areas: readonly ChatArea[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of areas) for (const id of a.spotIds) out[id] = a.key;
  return out;
}

/** 칩 글자 '{지역} {n}명'(n은 그곳을 말한 활성 멤버 수) */
export function areaChipLabel(area: Pick<ChatArea, 'name' | 'pickerIds'>): string {
  return `${area.name} ${area.pickerIds.length}명`;
}
