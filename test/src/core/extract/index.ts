import type { AmbiguousPick, ChatHighlight, Place, Spot, Trip } from '../../types';
import type { ExtractedPhrase, ExtractionProvider, IdGen, PlaceProvider, Region } from '../ports';
import { BASE_PLACE_IDS } from '../../data/places';
import { haversineKm } from '../util';
import { spotFromPlace } from './spot';
import { compactKey } from './text';

/**
 * 채팅 장소 추출(FR-401, WP3 소유, 순수). 표현 추출(ExtractionProvider) → 좌표 매칭(PlaceProvider) → 후보.
 *
 * - 인식 실패(표현 없음, 검색 결과 없음, 제공자 오류)면 후보도 안내도 없다. 빈 결과를 돌려준다.
 * - 목적지 반경 밖 장소는 버린다(자동 추출은 대부분 동명 지명 오인식이다). 수동 등록은 확인 뒤 허용한다.
 * - 같은 이름이 지역 안에 여러 곳이면 자동 등록하지 않고 ambiguous로 돌려 사용자가 고르게 한다.
 * - 이미 후보인 장소(같은 placeId)는 새로 만들지 않고 mergedSpotIds에 넣는다. 제안은 리듀서가 더한다.
 * - 기점 장소(숙소·역)는 후보로 만들지 않는다('라한호텔 체크인 먼저 하자'). 카카오의 '기타'(주차장 등)도 자동 추출에서 뺀다.
 * - 한 메시지에서 새 후보가 여러 개면 createdAt = at + 원문 등장 순서(ms)다(계약 A7, FR-403 동점 규칙).
 */
export interface ExtractDeps {
  extraction: ExtractionProvider;
  places: PlaceProvider;
  region: Region;
  ids: IdGen;
  at: number;
}

export interface ExtractResult {
  created: Spot[];
  mergedSpotIds: string[];
  ambiguous: AmbiguousPick[];
  highlights: ChatHighlight[];
}

export const EMPTY_EXTRACTION: ExtractResult = { created: [], mergedSpotIds: [], ambiguous: [], highlights: [] };

/** 지역 반경 안인지(Region 그대로, data/regions와 같은 판정) */
export function inRegion(region: Region, place: Pick<Place, 'coord'>): boolean {
  return haversineKm(region.center, place.coord) <= region.radiusKm;
}

/**
 * 기점 장소인지. 사전의 기점(숙소·역)과 이 여행방 날짜별 기점을 함께 본다.
 * 채팅 추출과 지도 선택은 기점을 후보로 만들지 않는다(플래너가 숙소를 관광 스팟으로 배치하고 수용량을 쓴다).
 */
export function isBasePlace(trip: Pick<Trip, 'days'>, place: Pick<Place, 'placeId' | 'name'>): boolean {
  if (BASE_PLACE_IDS.has(place.placeId)) return true;
  const name = compactKey(place.name);
  return (trip.days ?? []).some((d) => {
    const b = d.base;
    if (!b || b === 'inherit') return false;
    return b.placeId === place.placeId || compactKey(b.name) === name;
  });
}

/** 자동 추출에 쓸 수 있는 검색 결과인지. 기점과 '기타'(주차장·편의시설 등)는 뺀다. */
export function autoCandidate(trip: Pick<Trip, 'days'>, place: Place): boolean {
  return place.category !== '기타' && !isBasePlace(trip, place);
}

/** 검색 결과가 이 표현을 가리키는지. 이름이 표현을 품거나 표현이 이름을 품어야 한다. */
function related(phrase: string, place: Place): boolean {
  const q = compactKey(phrase);
  const n = compactKey(place.name);
  return n.includes(q) || q.includes(n);
}

export type PhraseMatch =
  | { kind: 'none' }
  | { kind: 'one'; place: Place }
  | { kind: 'many'; options: Place[] };

/**
 * 표현 하나를 장소로 맞춘다.
 * 1. 지역 밖 결과를 버린다.
 * 2. 이름이 표현과 관련된 결과만 남긴다. 하나도 없는데 결과가 딱 하나면 제공자의 별칭 판단을 믿는다('안압지').
 * 3. 가장 앞선 결과와 같은 이름끼리 묶는다. 서로 다른 장소가 둘 이상이면 동명 다수다.
 */
export function matchPhrase(phrase: string, results: Place[], region: Region): PhraseMatch {
  const inside = results.filter((p) => inRegion(region, p));
  if (inside.length === 0) return { kind: 'none' };
  let kept = inside.filter((p) => related(phrase, p));
  if (kept.length === 0) kept = inside.length === 1 ? inside : [];
  if (kept.length === 0) return { kind: 'none' };
  const q = compactKey(phrase);
  const best = kept.find((p) => compactKey(p.name) === q) ?? kept[0];
  const key = compactKey(best.name);
  const group: Place[] = [];
  for (const p of kept) {
    if (compactKey(p.name) === key && !group.some((g) => g.placeId === p.placeId)) group.push(p);
  }
  return group.length > 1 ? { kind: 'many', options: group } : { kind: 'one', place: best };
}

async function safePhrases(deps: ExtractDeps, text: string): Promise<ExtractedPhrase[]> {
  try {
    return await deps.extraction.phrases(text, { region: deps.region });
  } catch {
    return [];
  }
}

async function safeSearch(deps: ExtractDeps, phrase: string): Promise<Place[]> {
  try {
    return await deps.places.search(phrase, deps.region, deps.region.center);
  } catch {
    return [];
  }
}

export async function extractForMessage(
  trip: Trip,
  message: { id: string; text: string; memberId: string },
  deps: ExtractDeps,
): Promise<ExtractResult> {
  const phrases = await safePhrases(deps, message.text);
  if (phrases.length === 0) return { ...EMPTY_EXTRACTION };

  const created: Spot[] = [];
  const mergedSpotIds: string[] = [];
  const ambiguous: AmbiguousPick[] = [];
  const highlights: ChatHighlight[] = [];
  const seenPlace = new Set<string>();
  const seenAmbiguous = new Set<string>();
  const cache = new Map<string, Place[]>();

  for (const ph of phrases) {
    const key = compactKey(ph.phrase);
    let results = cache.get(key);
    if (!results) {
      results = await safeSearch(deps, ph.phrase);
      cache.set(key, results);
    }
    const m = matchPhrase(ph.phrase, results.filter((p) => autoCandidate(trip, p)), deps.region);
    if (m.kind === 'none') continue;
    if (m.kind === 'many') {
      // 이미 후보에 있는 동명 장소라도 어느 쪽인지 모르므로 사용자가 고른다.
      if (!seenAmbiguous.has(key)) {
        seenAmbiguous.add(key);
        ambiguous.push({ phrase: ph.phrase, options: m.options });
      }
      highlights.push({ start: ph.start, end: ph.end, placeId: m.options[0].placeId });
      continue;
    }
    const place = m.place;
    highlights.push({ start: ph.start, end: ph.end, placeId: place.placeId });
    if (seenPlace.has(place.placeId)) continue;
    seenPlace.add(place.placeId);
    const existing = trip.spots.find((s) => s.placeId === place.placeId);
    if (existing) {
      mergedSpotIds.push(existing.id);
      continue;
    }
    created.push(
      spotFromPlace(place, {
        id: deps.ids.next('spot'),
        proposal: { memberId: message.memberId, source: 'chat', messageId: message.id, at: deps.at },
        createdAt: deps.at + created.length,
        sourceText: message.text,
        sourceMessageId: message.id,
      }),
    );
  }
  return { created, mergedSpotIds, ambiguous, highlights };
}
