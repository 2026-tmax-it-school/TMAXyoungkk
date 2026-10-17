import type { DayPlan, LatLng, Place } from '../types';
import { haversineKm, toHHMM, toMin } from './util';

/**
 * 여행지 추천 점수와 대체 규칙(FR-404, WP3 소유, 순수).
 *
 * 점수 = 태그 겹침 × 3 + 근접도(기존 후보 무게중심에서 가까울수록, 0~1) + 인기도/100.
 * - 무게중심은 지역 안 기존 후보로만 잡는다(목적지 밖 수동 후보 하나가 기준점을 끌고 가지 않게).
 * - 기간(dates)이 오면 여행 날짜 전부가 휴무 요일인 곳은 뺀다. 그 밖의 기간 반영(계절, 행사)은 하지 않는다.
 * - 기존 후보(같은 placeId 또는 같은 이름)와 지역 밖, 기점용 장소(숙소·역)는 뺀다.
 * - 태그가 없거나, 태그가 맞는 곳이 min개보다 적으면 인기 장소로 채우고 fallback을 세운다('대체됨' 표시).
 * - 개수는 3~5곳(limit을 이 범위로 맞춘다). 후보 풀이 모자라면 있는 만큼만 낸다.
 * - 곳마다 추천 이유 한 줄을 붙인다.
 */

export const RECOMMEND_MIN = 3;
export const RECOMMEND_MAX = 5;
/** 23 화면에서 태그를 바꾼 뒤 추천을 부르기까지 기다리는 시간(ms). 빠른 연속 탭이 요청 여러 개가 되지 않게 */
export const RECOMMEND_TAG_DEBOUNCE_MS = 450;
/** 근접도가 0이 되는 거리(km) */
const PROXIMITY_KM = 15;

export function tagOverlap(place: Place, tags: readonly string[]): number {
  return (place.tags ?? []).filter((t) => tags.includes(t)).length;
}

export function clampLimit(limit: number): number {
  return Math.max(RECOMMEND_MIN, Math.min(RECOMMEND_MAX, Math.round(limit || RECOMMEND_MIN)));
}

export function centroid(coords: readonly LatLng[]): LatLng | undefined {
  if (coords.length === 0) return undefined;
  const lat = coords.reduce((s, c) => s + c.latitude, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.longitude, 0) / coords.length;
  return { latitude: lat, longitude: lng };
}

export function proximity(place: Place, anchor: LatLng | undefined): number {
  if (!anchor) return 0;
  return Math.max(0, 1 - haversineKm(anchor, place.coord) / PROXIMITY_KM);
}

export function scorePlace(place: Place, tags: readonly string[], anchor: LatLng | undefined): number {
  return tagOverlap(place, tags) * 3 + proximity(place, anchor) + (place.popularity ?? 0) / 100;
}

/** 추천 이유 한 줄 */
export function recommendReason(place: Place, tags: readonly string[], anchor?: LatLng): string {
  const hit = (place.tags ?? []).filter((t) => tags.includes(t));
  const near = anchor ? haversineKm(anchor, place.coord) : undefined;
  const where = near != null && near <= 3 ? ' · 후보들과 가까워요' : '';
  if (hit.length > 0) return `${hit.join('·')} 성향과 맞아요${where}`;
  return `많이 찾는 곳이에요${where}`;
}

/** 'YYYY-MM-DD'의 요일(0=일요일). 달력 계산만 하고 현재 시각은 쓰지 않는다. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 여행 날짜 전부가 휴무 요일이면 true. 날짜가 없거나 휴무 정보가 없으면 false. */
export function closedAllDates(place: Place, dates: readonly string[]): boolean {
  const closed = place.hours?.closedWeekdays ?? [];
  if (dates.length === 0 || closed.length === 0) return false;
  return dates.every((d) => closed.includes(weekdayOf(d)));
}

/**
 * 추천 후보로 쓸 수 있는지(로컬·AI 공용). 기존 후보(같은 placeId·같은 이름), 기점 장소, '기타', 지역 밖,
 * 여행 날짜 전부 휴무인 곳을 뺀다. 같은 placeId 중복은 seen으로 거른다.
 */
export function recommendable(
  p: Place,
  ctx: {
    existing: readonly Place[];
    inRegion: (p: Place) => boolean;
    skipPlaceIds?: ReadonlySet<string>;
    dates?: readonly string[];
    seen: Set<string>;
  },
): boolean {
  if (ctx.seen.has(p.placeId)) return false;
  ctx.seen.add(p.placeId);
  const name = p.name.replace(/\s+/g, '');
  if (ctx.existing.some((e) => e.placeId === p.placeId || e.name.replace(/\s+/g, '') === name)) return false;
  if (ctx.skipPlaceIds?.has(p.placeId)) return false;
  if (p.category === '기타') return false;
  if (closedAllDates(p, ctx.dates ?? [])) return false;
  return ctx.inRegion(p);
}

export interface RecommendInput {
  pool: Place[];
  tags: readonly string[];
  existing: readonly Place[];
  limit: number;
  /** 지역 안 판정. 호출 쪽이 지역 반경을 넘긴다. */
  inRegion: (p: Place) => boolean;
  /** 기점용 장소 등 추천하지 않을 placeId */
  skipPlaceIds?: ReadonlySet<string>;
  /** 여행 날짜. 전부 휴무인 곳을 뺀다. */
  dates?: readonly string[];
  /** 근접도 기준점(확정 스팟 좌표). 없거나 비면 지역 안 기존 후보의 무게중심을 쓴다. */
  anchor?: readonly LatLng[];
}

export function pickRecommendations(input: RecommendInput): { items: { place: Place; reason: string }[]; fallback: boolean } {
  const limit = clampLimit(input.limit);
  const anchor = centroid(
    input.anchor?.length ? input.anchor : input.existing.filter((p) => input.inRegion(p)).map((p) => p.coord),
  );
  const seen = new Set<string>();
  const pool = input.pool.filter((p) =>
    recommendable(p, { existing: input.existing, inRegion: input.inRegion, skipPlaceIds: input.skipPlaceIds, dates: input.dates, seen }),
  );
  const byId = (a: Place, b: Place) => (a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0);
  const matched = input.tags.length
    ? pool
        .filter((p) => tagOverlap(p, input.tags) > 0)
        .sort((a, b) => scorePlace(b, input.tags, anchor) - scorePlace(a, input.tags, anchor) || byId(a, b))
    : [];
  const fallback = matched.length < RECOMMEND_MIN;
  const chosen = matched.slice(0, limit);
  if (chosen.length < limit) {
    const popular = pool
      .filter((p) => !chosen.includes(p))
      .sort(
        (a, b) =>
          (b.popularity ?? 0) - (a.popularity ?? 0) || proximity(b, anchor) - proximity(a, anchor) || byId(a, b),
      );
    // 태그가 맞는 곳이 충분하면 limit까지 채우지 않고 최소 개수까지만 인기로 채운다.
    const target = fallback ? limit : chosen.length;
    for (const p of popular) {
      if (chosen.length >= target) break;
      chosen.push(p);
    }
  }
  return {
    items: chosen.map((place) => ({ place, reason: recommendReason(place, input.tags, anchor) })),
    fallback,
  };
}

/* ---------- AI 추천 맥락(2026-10-17) ---------- */

/** 빈 시간으로 보는 최소 길이(분) */
export const FREE_SLOT_MIN = 60;
/** 추천 요청에 싣는 빈 시간 수 상한(서버 server/ai.mjs AI_LIMITS.freeSlots와 같다) */
export const FREE_SLOTS_MAX = 10;
/** 추천 요청에 싣는 기존 장소 이름 수 상한(서버 AI_LIMITS.candidates와 같다) */
export const CONTEXT_NAMES_MAX = 30;

/**
 * 계산된 일정의 빈 시간 → 'M/D HH:MM-HH:MM'(예: '10/17 18:00-21:00'). AI 추천 맥락으로만 쓴다.
 * 스팟이 없는 날은 활동 시작~끝 전체, 스팟 사이는 앞 스팟 출발~다음 스팟으로 떠나야 하는 시각(도착 - 이동),
 * 마지막 스팟 뒤는 출발~(활동 끝 - 복귀 이동)이다. minMin분보다 짧은 틈은 뺀다. 앞에서부터 max개.
 */
export function freeSlotsOfPlan(
  days: readonly Pick<DayPlan, 'date' | 'startMin' | 'endLimitMin' | 'items' | 'returnMin'>[],
  minMin = FREE_SLOT_MIN,
  max = FREE_SLOTS_MAX,
): string[] {
  const out: string[] = [];
  for (const d of days) {
    const [, mm, dd] = d.date.split('-');
    const label = `${Number(mm)}/${Number(dd)}`;
    const push = (a: number, b: number) => {
      if (b - a >= minMin && out.length < max) out.push(`${label} ${toHHMM(a)}-${toHHMM(b)}`);
    };
    if (d.items.length === 0) {
      push(d.startMin, d.endLimitMin);
      continue;
    }
    for (let i = 0; i + 1 < d.items.length; i += 1) {
      const next = d.items[i + 1];
      push(toMin(d.items[i].depart), toMin(next.arrive) - next.travelMin);
    }
    push(toMin(d.items[d.items.length - 1].depart), d.endLimitMin - d.returnMin);
  }
  return out;
}
