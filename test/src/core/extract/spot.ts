import type { Place, Proposal, Spot } from '../../types';
import { DEFAULT_STAY_MIN } from '../constants';

/**
 * 장소 → 후보(Spot) 만들기(WP3 소유, 순수). 채팅 추출, 수동 등록(FR-202), 추천 담기(FR-404)가 같이 쓴다.
 * 체류 기본값은 카테고리 표(DEFAULT_STAY_MIN)다. 사용자가 바꾸면 schedule/setStay가 덮는다.
 */
export function spotFromPlace(
  place: Place,
  opts: {
    id: string;
    proposal: Proposal;
    createdAt: number;
    sourceText?: string;
    sourceMessageId?: string;
    outsideRegion?: boolean;
  },
): Spot {
  const spot: Spot = {
    id: opts.id,
    placeId: place.placeId,
    name: place.name,
    category: place.category,
    coord: place.coord,
    proposals: [opts.proposal],
    pinned: false,
    stayMin: DEFAULT_STAY_MIN[place.category],
    createdAt: opts.createdAt,
    edited: {},
  };
  if (place.kind) spot.kind = place.kind;
  if (place.address) spot.address = place.address;
  if (place.hours) spot.hours = place.hours;
  if (opts.sourceText != null) spot.sourceText = opts.sourceText;
  if (opts.sourceMessageId != null) spot.sourceMessageId = opts.sourceMessageId;
  if (opts.outsideRegion) spot.outsideRegion = true;
  return spot;
}

/** 후보를 장소로 되돌린다(추천 입력의 기존 스팟, 검색 비교용). */
export function placeOfSpot(spot: Spot): Place {
  const place: Place = { placeId: spot.placeId, name: spot.name, coord: spot.coord, category: spot.category };
  if (spot.kind) place.kind = spot.kind;
  if (spot.address) place.address = spot.address;
  if (spot.hours) place.hours = spot.hours;
  return place;
}

/** 같은 제안인지(같은 사람·같은 출처·같은 메시지). 누적할 때 중복을 거른다. */
export function sameProposal(a: Proposal, b: Proposal): boolean {
  return a.memberId === b.memberId && a.source === b.source && (a.messageId ?? '') === (b.messageId ?? '');
}

/** 제안을 중복 없이 더한다. */
export function addProposals(list: Proposal[], more: Proposal[]): Proposal[] {
  const out = [...list];
  for (const p of more) if (!out.some((q) => sameProposal(q, p))) out.push(p);
  return out;
}
