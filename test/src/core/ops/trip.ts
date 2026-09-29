import type { DayPatch, DaySetting, Op, Trip, TripPatch } from '../../types';
import { regionById } from '../../data/regions';
import { canIssueInvite, isHost, memberById } from '../group';
import { TITLE_MAX } from '../trip/create';
import { dateRange, toMin } from '../util';
import { patchDay } from './lww';

/**
 * trip/* 리듀서(WP2 소유). 권한 규칙(계약 A3, 02 결정 '권한 규칙'):
 * - trip/setDay는 전 멤버(기점 등록·변경은 그룹원 O, 권한표)
 * - trip/update(제목·지역·날짜·수단·활동시간)는 방장만. 권한표에 없어 프로토타입 가정이다.
 *   TripPatch 키만 받는다(validate가 다른 키를 거부하고 리듀서도 한 번 더 고른다). 기간이 바뀌면 days를 새 기간에 맞춘다
 * - trip/delete는 방장만
 * - trip/issueInvite·revokeInvite는 방장 또는 초대 권한을 켠 그룹원(canInvite, 기본 false)
 * validate는 op와 doc만 본다. 시각이 필요하면 op.at을 쓴다(A11).
 */

export const REASON = {
  notMember: '이 여행방의 멤버가 아닙니다',
  hostOnly: '방장만 바꿀 수 있습니다 · 프로토타입 가정',
  hostOnlyDelete: '여행방 삭제는 방장만 할 수 있습니다',
  inviteDenied: '초대 링크는 방장 또는 초대 권한이 있는 멤버만 만들 수 있습니다',
  noInvite: '무효화할 초대 링크가 없습니다',
  badInvite: '초대 링크 값이 올바르지 않습니다',
  badDates: '종료일이 시작일보다 앞설 수 없습니다',
  badRegion: '국내 지역 목록에 없는 지역입니다',
  badTitle: '여행방 이름을 입력해 주세요',
  badHours: '활동 시작 시각이 끝 시각보다 앞서야 합니다',
  outOfPeriod: '여행 기간 밖의 날짜입니다',
  badDayPatch: '날짜별 설정은 기점, 복귀 없음, 활동시간만 바꿀 수 있습니다',
  badDayHours: '날짜별 활동시간과 맞지 않습니다. 시작 시각이 끝 시각보다 앞서야 합니다',
  badPatch: '여행방 설정은 이름, 지역, 날짜, 이동수단, 활동시간만 바꿀 수 있습니다',
  badTransport: '이동수단 값이 올바르지 않습니다',
  longTitle: `여행방 이름은 ${TITLE_MAX}자까지입니다`,
} as const;

/** trip/update가 바꿀 수 있는 필드(TripPatch). 원격 op에 members·invite·deletedAt 같은 키가 섞여 와도 거른다. */
export const TRIP_PATCH_KEYS: ReadonlySet<string> = new Set(['title', 'region', 'startDate', 'endDate', 'transport', 'dayStart', 'dayEnd']);
const TRANSPORTS: ReadonlySet<string> = new Set(['car', 'walk', 'transit']);

function pickTripPatch(patch: TripPatch): TripPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch ?? {})) if (TRIP_PATCH_KEYS.has(k) && v !== undefined) out[k] = v;
  return out as TripPatch;
}

/**
 * 기간이 바뀌면 날짜별 설정을 새 기간에 맞춘다. 남는 날짜는 설정을 그대로 두고, 기간 밖 날짜는 버린다.
 * 새로 생긴 날짜는 첫날이면 기점 없음(null), 아니면 직전 날짜와 같음('inherit')이다.
 */
function fitDays(days: DaySetting[], start: string, end: string): DaySetting[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return dateRange(start, end).map((date, i) => byDate.get(date) ?? { date, base: i === 0 ? null : 'inherit', noReturn: false });
}

/** trip/setDay가 바꿀 수 있는 필드. transport는 schedule/setDayTransport만 바꾼다(원격 op도 런타임에 거른다). */
export const DAY_PATCH_KEYS: ReadonlySet<string> = new Set(['base', 'noReturn', 'dayStart', 'dayEnd']);

const HHMM = /^\d{2}:\d{2}$/;

function pickDayPatch(patch: DayPatch): DayPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch ?? {})) if (DAY_PATCH_KEYS.has(k)) out[k] = v;
  return out as DayPatch;
}

export function reduceCreate(op: Op): Trip {
  if (op.type !== 'trip/create') throw new Error(`reduceCreate에 ${op.type}가 들어왔다`);
  return { ...op.trip, lastSeq: 0 };
}

export function reduce(doc: Trip, op: Op): Trip {
  switch (op.type) {
    case 'trip/create':
      // 이미 있는 방에 다시 온 생성 op는 무시한다.
      return doc;
    case 'trip/update': {
      const patch = pickTripPatch(op.patch);
      if (patch.title != null) patch.title = patch.title.trim();
      const next = { ...doc, ...patch };
      if (next.startDate !== doc.startDate || next.endDate !== doc.endDate) {
        next.days = fitDays(doc.days, next.startDate, next.endDate);
      }
      return next;
    }
    case 'trip/setDay':
      // transport는 patch에 없다(schedule/setDayTransport만 바꾼다). patchDay가 필드별 LWW를 적용한다.
      // validate가 다른 키를 거부하지만, 검증 없이 적용되는 경우를 위해 한 번 더 고른다.
      return patchDay(doc, op.date, pickDayPatch(op.patch), op.at);
    case 'trip/delete':
      return doc.deletedAt != null ? doc : { ...doc, deletedAt: op.at };
    case 'trip/issueInvite':
      // 새 코드로 바꾸면 이전 코드는 문서에서 사라진다. 이전 코드 조회는 로그에서 revoked로 판정한다(invite.ts).
      return { ...doc, invite: { ...op.invite } };
    case 'trip/revokeInvite':
      if (!doc.invite || doc.invite.revokedAt != null) return doc;
      return { ...doc, invite: { ...doc.invite, revokedAt: op.at } };
    default:
      return doc;
  }
}

function activeActor(doc: Trip, op: Op): boolean {
  const m = memberById(doc, op.actorId);
  return !!m && m.leftAt == null;
}

function validHours(start?: string, end?: string): boolean {
  if (start != null && !HHMM.test(start)) return false;
  if (end != null && !HHMM.test(end)) return false;
  if (start != null && end != null) return toMin(start) < toMin(end);
  return true;
}

export function validate(doc: Trip, op: Op): string | null {
  if (op.type === 'trip/create') return null;
  if (!activeActor(doc, op)) return REASON.notMember;
  switch (op.type) {
    case 'trip/update': {
      if (!isHost(doc, op.actorId)) return REASON.hostOnly;
      const p = op.patch;
      if (!p || typeof p !== 'object') return REASON.badPatch;
      if (Object.keys(p).some((k) => !TRIP_PATCH_KEYS.has(k))) return REASON.badPatch;
      if (p.title != null && p.title.trim().length === 0) return REASON.badTitle;
      if (p.title != null && p.title.trim().length > TITLE_MAX) return REASON.longTitle;
      if (p.transport != null && !TRANSPORTS.has(p.transport)) return REASON.badTransport;
      if (p.region != null && !regionById(p.region)) return REASON.badRegion;
      const start = p.startDate ?? doc.startDate;
      const end = p.endDate ?? doc.endDate;
      if (end < start) return REASON.badDates;
      const nextStart = p.dayStart ?? doc.dayStart;
      const nextEnd = p.dayEnd ?? doc.dayEnd;
      if (!validHours(nextStart, nextEnd)) return REASON.badHours;
      // 기본 활동시간이 바뀌면, 날짜별로 한쪽만 정한 날의 실효 시간창도 맞아야 한다.
      if (p.dayStart != null || p.dayEnd != null) {
        for (const d of doc.days) {
          if (!validHours(d.dayStart ?? nextStart, d.dayEnd ?? nextEnd)) return REASON.badDayHours;
        }
      }
      return null;
    }
    case 'trip/setDay': {
      if (op.date < doc.startDate || op.date > doc.endDate) return REASON.outOfPeriod;
      if (!op.patch || typeof op.patch !== 'object') return REASON.badDayPatch;
      if (Object.keys(op.patch).some((k) => !DAY_PATCH_KEYS.has(k))) return REASON.badDayPatch;
      const cur = doc.days.find((d) => d.date === op.date);
      const start = op.patch.dayStart ?? cur?.dayStart ?? doc.dayStart;
      const end = op.patch.dayEnd ?? cur?.dayEnd ?? doc.dayEnd;
      if (!validHours(start, end)) return REASON.badHours;
      return null;
    }
    case 'trip/delete':
      return isHost(doc, op.actorId) ? null : REASON.hostOnlyDelete;
    case 'trip/issueInvite': {
      if (!canIssueInvite(doc, op.actorId)) return REASON.inviteDenied;
      const inv = op.invite;
      if (!inv.code || inv.expiresAt <= inv.issuedAt || inv.capacity < 2) return REASON.badInvite;
      return null;
    }
    case 'trip/revokeInvite':
      if (!canIssueInvite(doc, op.actorId)) return REASON.inviteDenied;
      return doc.invite && doc.invite.revokedAt == null ? null : REASON.noInvite;
    default:
      return null;
  }
}
