import type { SampleTrip } from '../../data/sampleTrips';
import type { ItineraryDraft, SharedDay, SharedItinerary } from '../ports';
import type { Plan, Spot, Trip } from '../../types';

/**
 * 일정 공유 규칙(WP2 소유, 2026-10-17). 서버(server/itineraries.mjs)와 한도가 같다. 순수 함수만 둔다.
 * - 내 여행방 → 올릴 일정: 시간표(plan)의 날짜별 순서를 따르고, 시간표가 아직 없으면 후보 전체를 하루로 묶는다.
 * - 올라온 일정 → 예시 일정(SampleTrip): 가져오기는 추천 여행지 예시와 같은 길(core/trip/sample)로 여행방을 만든다.
 * 올리는 것은 장소 이름·분류·주소·좌표뿐이다. 채팅·멤버·사진·메모는 올리지 않는다.
 */

export const TITLE_MAX = 60;
export const NOTE_MAX = 300;
export const DAYS_MAX = 7;
export const PLACES_PER_DAY_MAX = 10;
export const SEARCH_MAX = 30;

const active = (s: Spot) => !s.removedByUser;

/** 올릴 날짜별 장소. 장소가 없는 날은 뺀다 */
export function shareDays(trip: Trip, plan: Plan | undefined): SharedDay[] {
  const byId = new Map(trip.spots.map((s) => [s.id, s]));
  const toPlace = (s: Spot) => ({
    name: s.name.slice(0, 40),
    category: s.category,
    kind: s.kind ?? '',
    address: s.address ?? '',
    coord: s.coord,
    note: '',
  });
  const days: SharedDay[] = [];
  for (const d of plan?.days ?? []) {
    const places = d.items
      .map((it) => byId.get(it.spotId))
      .filter((s): s is Spot => !!s && active(s))
      .slice(0, PLACES_PER_DAY_MAX)
      .map(toPlace);
    if (places.length > 0) days.push({ title: `${days.length + 1}일차`, places });
  }
  if (days.length > 0) return days.slice(0, DAYS_MAX);
  const all = trip.spots.filter(active).slice(0, PLACES_PER_DAY_MAX).map(toPlace);
  return all.length > 0 ? [{ title: '1일차', places: all }] : [];
}

export function shareCounts(days: readonly SharedDay[]): { days: number; places: number } {
  return { days: days.length, places: days.reduce((n, d) => n + d.places.length, 0) };
}

export interface ShareInput {
  title: string;
  note: string;
  tags: string[];
}

/** 올릴 일정 만들기 + 검사 문장(없으면 올릴 수 있다) */
export function shareDraft(trip: Trip, plan: Plan | undefined, input: ShareInput, regionLabel: string): { draft: ItineraryDraft; problem?: string } {
  const days = shareDays(trip, plan);
  const tripBase = trip.days.map((d) => d.base).find((b): b is Exclude<typeof b, 'inherit' | null | undefined> => !!b && b !== 'inherit');
  const base = plan?.days.find((d) => d.base)?.base ?? tripBase ?? null;
  const draft: ItineraryDraft = {
    title: input.title.trim(),
    regionId: trip.region,
    regionLabel,
    note: input.note.trim(),
    tags: input.tags,
    days,
    base: base ? { name: base.name, address: '', coord: base.coord } : null,
  };
  let problem: string | undefined;
  if (days.length === 0) problem = '장소를 한 곳 이상 담은 뒤에 공유할 수 있어요';
  else if (draft.title.length === 0) problem = '일정 이름을 입력해 주세요';
  else if (draft.title.length > TITLE_MAX) problem = `일정 이름은 ${TITLE_MAX}자까지예요`;
  else if (draft.note.length > NOTE_MAX) problem = `소개는 ${NOTE_MAX}자까지예요`;
  return { draft, ...(problem ? { problem } : {}) };
}

/** 올라온 일정(상세) → 여행방에 담을 예시 일정. 기점이 없으면 첫 장소를 기점으로 쓴다 */
export function toSampleTrip(item: SharedItinerary): SampleTrip | undefined {
  const days = item.days ?? [];
  const first = days.find((d) => d.places.length > 0)?.places[0];
  if (!first) return undefined;
  const base = item.base ?? { name: first.name, address: first.address, coord: first.coord };
  return {
    regionId: item.regionId,
    title: item.title,
    blurb: item.note,
    base: { id: `${item.id}-base`, name: base.name, address: base.address, coord: base.coord },
    days: days.map((d, i) => ({
      title: d.title || `${i + 1}일차`,
      blurb: '',
      places: d.places.map((p, j) => ({ id: `${item.id}-${i + 1}-${j + 1}`, name: p.name, category: p.category, kind: p.kind, address: p.address, coord: p.coord, note: p.note })),
    })),
  };
}

export const SORT_LABEL = { popular: '인기순', new: '최신순', views: '조회순' } as const;

/** 서버 오류 코드 → 화면 문장 */
export function itineraryFailText(code: string, detail?: string): string {
  if (detail) return detail;
  switch (code) {
    case 'loginRequired':
      return '로그인하면 일정을 공유할 수 있어요';
    case 'badItinerary':
      return '일정을 올리지 못했어요. 내용을 확인해 주세요';
    case 'tooMany':
      return '한 시간에 공유할 수 있는 일정을 넘었어요. 잠시 뒤 다시 시도해 주세요';
    case 'tooLarge':
      return '일정이 너무 커서 올리지 못했어요';
    case 'unreachable':
      return '서버에 닿지 못했어요. 잠시 뒤 다시 시도해 주세요';
    case 'notFound':
      return '일정을 찾지 못했어요';
    default:
      return '잠시 문제가 생겼어요. 다시 시도해 주세요';
  }
}

/** 숫자를 짧게(1200 → 1.2천은 어색하니 천 단위 쉼표만) */
export function countText(n: number): string {
  return n.toLocaleString('ko-KR');
}
