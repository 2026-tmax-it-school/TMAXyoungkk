import type { ChatHighlight, ChatMessage, Member, Trip } from '../../types';
import { proposerCount } from '../../core/spotUtil';

/**
 * 05 채팅 화면의 계산(WP3 소유, 순수). 말풍선 강조 조각, 추출 묶음 카드 행, 보낸 사람 이름.
 */

export interface BubbleSegment {
  text: string;
  hl: boolean;
}

/** 강조 구간으로 원문을 자른다. 겹치거나 범위를 벗어난 구간은 버린다. 이어 붙이면 원문과 같다. */
export function bubbleSegments(text: string, highlights: readonly ChatHighlight[]): BubbleSegment[] {
  const hs = [...highlights]
    .filter((h) => h.start >= 0 && h.end <= text.length && h.start < h.end)
    .sort((a, b) => a.start - b.start);
  const out: BubbleSegment[] = [];
  let at = 0;
  for (const h of hs) {
    if (h.start < at) continue;
    if (h.start > at) out.push({ text: text.slice(at, h.start), hl: false });
    out.push({ text: text.slice(h.start, h.end), hl: true });
    at = h.end;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at), hl: false });
  return out;
}

export interface ExtractionRow {
  spotId: string;
  name: string;
  kind: string;
  proposerCount: number;
  pinned: boolean;
  /** 이 메시지로 새로 생긴 후보인지, 기존 후보에 제안만 더한 것인지 */
  status: 'created' | 'merged';
}

export interface ExtractionCard {
  title: string;
  rows: ExtractionRow[];
  /** 아직 고르지 않은 동명 장소 */
  picks: { phrase: string; options: { placeId: string; name: string; address?: string }[] }[];
  canUndo: boolean;
}

/** 메시지 하나의 추출 묶음 카드. 보여줄 것이 없으면 undefined(인식 실패 시 안내도 없다). */
export function extractionCard(trip: Trip, msg: ChatMessage): ExtractionCard | undefined {
  const ex = msg.extraction;
  if (!ex) return undefined;
  const rows: ExtractionRow[] = [];
  const push = (id: string, status: ExtractionRow['status']) => {
    const s = trip.spots.find((x) => x.id === id);
    if (!s || rows.some((r) => r.spotId === id)) return;
    rows.push({ spotId: id, name: s.name, kind: s.kind ?? s.category, proposerCount: proposerCount(s), pinned: s.pinned, status });
  };
  ex.createdSpotIds.forEach((id) => push(id, 'created'));
  ex.mergedSpotIds.forEach((id) => push(id, 'merged'));
  const picks = ex.ambiguous
    .filter((a) => a.resolved == null)
    .map((a) => ({
      phrase: a.phrase,
      options: a.options.map((o) => ({ placeId: o.placeId, name: o.name, address: o.address })),
    }));
  if (rows.length === 0 && picks.length === 0) return undefined;
  const n = rows.length + picks.length;
  return {
    title: `대화에서 장소 ${n}곳을 찾았습니다`,
    rows,
    picks,
    canUndo: rows.length > 0,
  };
}

/** 표시 이름. 나간 멤버는 '나간 멤버'를 붙인다(제안·채팅은 남는다, 정책 미결정). */
export function senderName(members: readonly Member[], memberId: string): string {
  const m = members.find((x) => x.id === memberId);
  if (!m) return '알 수 없는 멤버';
  if (m.anonymized) return m.nickname;
  return m.leftAt != null ? `${m.nickname} · 나간 멤버` : m.nickname;
}

/** 아바타 색 순서(멤버 등록 순) */
export function memberIndex(members: readonly Member[], memberId: string): number {
  const i = members.findIndex((m) => m.id === memberId);
  return i < 0 ? 3 : i;
}

/**
 * 되돌리기로 지워질 후보 가운데 누군가 손본 것(고정, 날짜 지정, 체류 등 편집 기록)의 이름.
 * 되돌리기는 그 메시지 제안만 빼고, 남은 제안이 없으면 편집 내용째 지운다. 이 목록이 있으면 05가 먼저 확인을 받는다.
 */
export function undoLosesEdits(trip: Trip, msg: ChatMessage): string[] {
  const ex = msg.extraction;
  if (!ex) return [];
  const touched = new Set([...ex.createdSpotIds, ...ex.mergedSpotIds]);
  const out: string[] = [];
  for (const s of trip.spots) {
    if (!touched.has(s.id)) continue;
    const rest = s.proposals.filter((p) => p.messageId !== msg.id);
    if (rest.length > 0) continue;
    const edited = s.pinned || !!s.fixedDate || Object.keys(s.edited ?? {}).length > 0;
    if (edited) out.push(s.name);
  }
  return out;
}
