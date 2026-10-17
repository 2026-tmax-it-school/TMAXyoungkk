import type { ChatHighlight, ChatMessage, Member, Trip } from '../../types';
import { proposerCount } from '../../core/spotUtil';
import { dayShort, kstDate, kstHHMM, weekday } from '../../core/util';

/**
 * 05 채팅 화면의 계산(WP3 소유, 순수). 말풍선 강조 조각, 추출 묶음 카드 행, 보낸 사람 이름,
 * 메시지 묶음·날짜 구분(messageMeta), 메시지 한 줄의 스크린리더 이름(messageA11yLabel), 바닥 따라가기(nearEnd).
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
  /** 고를 장소가 있을 때 카드 안 안내 한 줄 */
  pickHint?: string;
  canUndo: boolean;
}

/** 카드 안에서 바로 고르는 최대 곳 수. 더 많으면 고르기 시트(PlacePickSheet)를 연다 */
export const INLINE_PICK_MAX = 3;

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
  const card: ExtractionCard = {
    title: rows.length > 0 ? `후보 ${rows.length}곳에 담았어요` : '어느 곳인지 골라 주세요',
    rows,
    picks,
    canUndo: rows.length > 0,
  };
  if (picks.length > 0) card.pickHint = '같은 이름의 장소가 여러 곳이에요. 맞는 곳을 골라 주세요';
  return card;
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

/* ------------------------------------------------------------------ */
/* 메시지 묶음과 날짜 구분                                              */
/* ------------------------------------------------------------------ */

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** KST 날짜 'YYYY-MM-DD' → '10/18 토' */
export function chatDayLabel(date: string): string {
  return `${dayShort(date)} ${WEEK[weekday(date)]}`;
}

export interface MessageMeta {
  id: string;
  /** 이 메시지 앞에 넣을 날짜 구분 줄(KST 날짜가 바뀔 때, 첫 메시지 포함) */
  dayLabel?: string;
  /** 묶음의 첫 메시지(남의 메시지면 이름을 보인다) */
  groupStart: boolean;
  /** 묶음의 끝(시각을 보이고, 남의 메시지면 아바타를 붙인다) */
  groupEnd: boolean;
  /** 'HH:MM'(KST) */
  time: string;
  mine: boolean;
}

/** 분 단위 KST 키(같은 분인지) */
function minuteKey(ms: number): string {
  return `${kstDate(ms)} ${kstHHMM(ms)}`;
}

/**
 * 같은 사람이 같은 분에 보낸 메시지를 한 묶음으로 본다(날짜가 바뀌거나 전송 대기 여부가 다르면 끊는다).
 * 시각은 묶음 끝에만 보인다. me는 이 기기에서 보내는 멤버다.
 */
export function messageMeta(messages: readonly ChatMessage[], me: string | undefined): MessageMeta[] {
  const out: MessageMeta[] = [];
  const same = (a: ChatMessage, b: ChatMessage) =>
    a.memberId === b.memberId && minuteKey(a.sentAt) === minuteKey(b.sentAt) && a.status === b.status;
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const day = kstDate(m.sentAt);
    const newDay = !prev || kstDate(prev.sentAt) !== day;
    const meta: MessageMeta = {
      id: m.id,
      groupStart: newDay || !same(prev, m),
      groupEnd: !next || kstDate(next.sentAt) !== day || !same(m, next),
      time: kstHHMM(m.sentAt),
      mine: !!me && m.memberId === me,
    };
    if (newDay) meta.dayLabel = chatDayLabel(day);
    out.push(meta);
  });
  return out;
}

/** 메시지 한 줄을 스크린리더가 한 번에 읽는 이름. 장소 강조는 따로 읽지 않는다 */
export function messageA11yLabel(msg: Pick<ChatMessage, 'text' | 'status'>, senderName: string, time: string): string {
  return `${senderName}, ${msg.text}, ${time}${msg.status === 'pending' ? ', 전송 대기' : ''}`;
}

/** 바닥에서 이만큼(px) 안에 있으면 새 메시지가 올 때 바닥을 따라간다 */
export const STICK_TO_END_PX = 80;

/** 스크롤 위치가 바닥 가까이인지(새 메시지가 오면 바닥으로 내릴지) */
export function nearEnd(contentH: number, offsetY: number, viewH: number, px = STICK_TO_END_PX): boolean {
  return contentH - (offsetY + viewH) <= px;
}
