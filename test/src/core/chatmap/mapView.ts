import type { LatLng, Spot } from '../../types';
import type { MapMarkerInput } from '../map/layout';
import { proposerIds } from '../spotUtil';
import { H, SP } from '../../ui/tokens';

/**
 * 채팅방 지도의 지도 입력(FR-405, 명세 밖 추가, 순수). MapCanvas(components/map)에 그대로 넘긴다.
 * - 핀은 스팟 하나에 하나(kind 'spot', id = spotId, title = 장소 이름)다.
 * - 라벨은 표가 있을 때만 '{n}표'다. 숫자만 쓰면 pinName이 순번('3번')으로 읽으므로 쓰지 않는다('3표 불국사'로 읽힌다).
 * - 고른 지역 밖이거나 고른 멤버가 말하지 않은 핀은 slate 색에 dim(흐림)이다. 그 밖은 ink다.
 * - 크기는 표 수를 따른다: 가장 많은 표면 1.3, 그 절반(올림) 이상이면 1.15, 나머지 1.
 * - 맞출 좌표(fitTo)는 포커스한 스팟 > 고른 멤버의 스팟(지역을 골랐으면 그 안) > 고른 지역의 스팟 > 전체 순이다.
 */

export interface ChatMapSelection {
  area?: string | null;
  member?: string | null;
  focusSpotId?: string | null;
}

export const PIN_SCALE_TOP = 1.3;
export const PIN_SCALE_HALF = 1.15;
/** 라벨 숫자는 두 자리까지('99표') */
const LABEL_MAX = 99;

export function voteLabel(n: number): string | undefined {
  return n > 0 ? `${Math.min(n, LABEL_MAX)}표` : undefined;
}

export function pinScaleFor(n: number, maxCount: number): number {
  if (maxCount <= 0 || n <= 0) return 1;
  if (n === maxCount) return PIN_SCALE_TOP;
  if (n >= Math.ceil(maxCount / 2)) return PIN_SCALE_HALF;
  return 1;
}

export function chatMapInput(
  spots: readonly Spot[],
  areaBySpot: Readonly<Record<string, string>>,
  counts: Readonly<Record<string, number>>,
  sel: ChatMapSelection,
): { markers: MapMarkerInput[]; fitTo: LatLng[] } {
  const live = spots.filter((s) => !s.removedByUser);
  const maxCount = live.reduce((m, s) => Math.max(m, counts[s.id] ?? 0), 0);
  // 고른 지역 키가 지금 데이터에 없으면(지역이 다시 묶이거나 마지막 장소가 빠짐) 고르지 않은 것으로 본다.
  // 그대로 쓰면 모든 핀이 흐려지는데 칩·왼쪽 열에는 고른 것이 없어 이유가 보이지 않는다.
  const areaOn = !!sel.area && live.some((s) => areaBySpot[s.id] === sel.area);
  const inArea = (s: Spot) => !areaOn || areaBySpot[s.id] === sel.area;
  const byMember = (s: Spot) => !sel.member || proposerIds(s).includes(sel.member);

  const markers: MapMarkerInput[] = live.map((s) => {
    const n = counts[s.id] ?? 0;
    const dim = !inArea(s) || !byMember(s);
    const m: MapMarkerInput = {
      id: s.id,
      coord: s.coord,
      kind: 'spot',
      title: s.name,
      color: dim ? 'slate' : 'ink',
      scale: pinScaleFor(n, maxCount),
    };
    const label = voteLabel(n);
    if (label) m.label = label;
    if (dim) m.dim = true;
    return m;
  });

  const focus = sel.focusSpotId ? live.find((s) => s.id === sel.focusSpotId) : undefined;
  const memberSpots = sel.member ? live.filter((s) => byMember(s) && inArea(s)) : [];
  const areaSpots = areaOn ? live.filter(inArea) : [];
  const pick = focus ? [focus] : memberSpots.length > 0 ? memberSpots : areaSpots.length > 0 ? areaSpots : live;
  return { markers, fitTo: pick.map((s) => s.coord) };
}

/** 넓은 화면(≥ 900)에서 시트 최대 폭. 오른쪽에 붙여 왼쪽 열을 가리지 않는다 */
export const WIDE_SHEET_W = 440;
/** 넓은 화면에서 시트 최소 폭(360 휴대폰 시트와 비슷한 목록 폭) */
export const WIDE_SHEET_MIN_W = 320;
/** 넓은 화면에서 시트 왼쪽에 늘 남기는 폭: 아바타 칸(64)과 짧은 이름표, '전체 보기' 버튼(왼쪽 아래)이 들어간다 */
export const WIDE_FREE_MIN = 150;
/** 왼쪽 열이 피하는 '전체 보기' 자리: 지도 로고 줄(24) + 아래 여백 + 버튼 높이 + 간격 */
export const FIT_ALL_RESERVE = 24 + SP.xl + H.btnSm + SP.m;
/** 왼쪽 열 최소 높이: 제목 알약(안내 줄 포함 약 40)과 간격, 프로필 한 줄(고리 두른 44) */
export const RAIL_MIN_H = H.touch + SP.m + H.avatarLg + 4;
/** 왼쪽 열 위쪽 여백(MemberRail top) */
export const RAIL_TOP = SP.m;

/**
 * 왼쪽 열 크기.
 * - 이름표는 열이 쓸 수 있는 폭(freeW)에서 아바타 열(60)과 여백을 뺀 만큼(최대 200)이다.
 * - 높이(제목 알약 + 목록 전체)는 지도 높이에서 위 여백, 열 아래를 덮는 시트 높이(coverBottom),
 *   그 위 '전체 보기' 자리를 뺀 만큼이다. 넘치면 목록만 스크롤한다.
 */
export function railLayout(freeW: number, mapH: number, coverBottom: number): { tagMaxWidth: number; railMaxHeight: number } {
  return {
    tagMaxWidth: Math.max(0, Math.min(200, freeW - 60 - SP.l)),
    railMaxHeight: Math.max(RAIL_MIN_H, mapH - RAIL_TOP - coverBottom - FIT_ALL_RESERVE),
  };
}

export interface ChatMapLayout {
  /** 시트 폭과 왼쪽 위치 */
  sheetW: number;
  sheetLeft: number;
  /** 지도에 알리는 아래 덮임(맞춤 영역·'전체 보기' 높이) */
  overlayBottom: number;
  tagMaxWidth: number;
  railMaxHeight: number;
}

/**
 * 채팅방 지도 한 판의 배치(지도 크기, 지금 시트 높이, 넓은 화면 여부).
 * - 좁은 화면: 시트는 지도 폭 전부라 왼쪽 열과 '전체 보기'를 아래에서 덮는다(overlayBottom = sheetH).
 * - 넓은 화면: 시트는 오른쪽에 붙고 폭은 440 이하, 왼쪽에 WIDE_FREE_MIN을 늘 남긴다. 그래서 왼쪽 열·이름표·
 *   '전체 보기'·지도 로고를 덮지 않고, 열 높이도 시트 높이를 빼지 않는다(full이어도 멤버가 다 보인다).
 */
export function chatMapLayout(mapW: number, mapH: number, sheetH: number, wide: boolean): ChatMapLayout {
  if (!wide) return { sheetW: mapW, sheetLeft: 0, overlayBottom: sheetH, ...railLayout(mapW, mapH, sheetH) };
  const sheetW = Math.max(0, Math.min(mapW, WIDE_SHEET_W, Math.max(WIDE_SHEET_MIN_W, mapW - WIDE_FREE_MIN)));
  const sheetLeft = Math.max(0, mapW - sheetW);
  return { sheetW, sheetLeft, overlayBottom: 0, ...railLayout(sheetLeft, mapH, 0) };
}

/* ------------------------------------------------------------------ */
/* 화면 상태(지역·멤버·시트 탭·스냅·포커스)의 바뀜. 화면은 useReducer로 쓴다. */
/* ------------------------------------------------------------------ */

export type ChatSheetSnap = 'mini' | 'peek' | 'full';
/** 시트 탭: 고른 멤버가 말한 장소, 여행방 전체 순위 */
export type ChatSheetTab = 'mentions' | 'rank';

export interface ChatMapState {
  selArea: string | null;
  selMember: string | null;
  tab: ChatSheetTab;
  snap: ChatSheetSnap;
  focusSpotId: string | null;
}

export const CHAT_MAP_INITIAL: ChatMapState = { selArea: null, selMember: null, tab: 'rank', snap: 'mini', focusSpotId: null };

export type ChatMapEvent =
  /** 칩·핀: 고른 지역을 다시 누르면 풀린다. 멤버를 비우고 시트를 mini로 */
  | { t: 'area'; key: string }
  /** 프로필: 말한 장소를 peek로 연다. 같은 사람을 다시 누르면 풀고 mini로 */
  | { t: 'member'; id: string }
  /** 끌기·손잡이·스크린리더 조절. mini로 내려가면 고른 멤버와 포커스도 비운다 */
  | { t: 'snap'; snap: ChatSheetSnap }
  /** peek에서 '전체' 탭을 고르면 full로 펼친다 */
  | { t: 'tab'; tab: ChatSheetTab }
  /** 줄 본문: 그 핀에 맞추고 시트는 peek(핀이 보이게) */
  | { t: 'focus'; spotId: string }
  /** 닫기: mini로 내리고 고른 멤버를 비운다 */
  | { t: 'close' }
  /** '채팅'으로 바꿈: 지역은 남기고 멤버를 비우고 mini로 */
  | { t: 'toChat' };

export function chatMapStep(s: ChatMapState, e: ChatMapEvent): ChatMapState {
  switch (e.t) {
    case 'area':
      return { ...s, selArea: s.selArea === e.key ? null : e.key, selMember: null, snap: 'mini', focusSpotId: null };
    case 'member':
      if (s.selMember === e.id) return { ...s, selMember: null, snap: 'mini', focusSpotId: null };
      return { ...s, selMember: e.id, tab: 'mentions', snap: 'peek', focusSpotId: null };
    case 'snap':
      // mini로 내리면 닫기와 같다. 포커스도 풀어 지도가 고른 지역·전체로 돌아간다(한 핀에 갇히지 않게)
      if (e.snap === 'mini') return { ...s, snap: 'mini', selMember: null, focusSpotId: null };
      return { ...s, snap: e.snap };
    case 'tab':
      return { ...s, tab: e.tab, snap: e.tab === 'rank' && s.snap === 'peek' ? 'full' : s.snap };
    case 'focus':
      return { ...s, focusSpotId: e.spotId, snap: 'peek' };
    case 'close':
      return { ...s, snap: 'mini', selMember: null, focusSpotId: null };
    case 'toChat':
      return { ...s, selMember: null, snap: 'mini', focusSpotId: null };
    default:
      return s;
  }
}
