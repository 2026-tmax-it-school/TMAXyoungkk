import type { DayPlan, LatLng, NotifyLogEntry, Plan, Trip, Visit } from '../../types';
import { addDays, atKst, dayShort, kstDate, toHHMM, toMin, weekday } from '../util';
import type { ArrivalTracker, VisitStatus } from './arrival';
import { msOfMinute, type LiveDay } from './context';
import type { Timing } from './delay';
import type { EngineEffect } from './engine';
import { visitId } from './engine';

/**
 * 여행 진행 세션 도우미(WP5 소유, 순수). 스토어(store/live.ts)와 19·13 화면이 같이 쓰는 작은 판정들.
 * 스토어는 zustand라 node --test에서 불러오지 못하므로, 스토어가 하는 계산은 여기로 모아 테스트한다.
 */

/** 이 날짜·이 멤버의 방문 기록을 스팟별 마지막 상태로 편다(같은 id는 at 늦은 쪽). */
export function statusesFromVisits(trip: Pick<Trip, 'visits'>, date: string, memberId?: string): Record<string, VisitStatus> {
  const latest = new Map<string, Visit>();
  for (const v of trip.visits) {
    if (v.date !== date) continue;
    if (memberId && v.memberId !== memberId) continue;
    const prev = latest.get(v.spotId);
    if (!prev || v.at >= prev.at) latest.set(v.spotId, v);
  }
  const out: Record<string, VisitStatus> = {};
  for (const [spotId, v] of latest) out[spotId] = v.status;
  return out;
}

function dayWithItems(plan: Plan | undefined, date: string): DayPlan | undefined {
  return plan?.days.find((d) => d.date === date && d.items.length > 0);
}

/**
 * 여행 진행 날짜. 요청 날짜 → 오늘(앱 시계, 시뮬레이터 반영) → 스팟이 있는 첫 날짜 → 여행 시작일 순이다.
 */
export function pickLiveDate(trip: Pick<Trip, 'startDate'>, plan: Plan | undefined, now: number, requested?: string): string {
  if (requested && plan?.days.some((d) => d.date === requested)) return requested;
  const today = kstDate(now);
  if (dayWithItems(plan, today)) return today;
  const first = plan?.days.find((d) => d.items.length > 0);
  return first?.date ?? requested ?? trip.startDate;
}

/** journal/visit에 실을 방문 기록. 같은 날·스팟·멤버는 같은 id라 취소·재도착이 at LWW로 덮인다. */
export function visitRecord(input: {
  date: string;
  spotId: string;
  memberId: string;
  status: VisitStatus;
  source: Visit['source'];
  at: number;
  arrivedAt?: number;
}): Visit {
  const v: Visit = {
    id: visitId(input.date, input.spotId, input.memberId),
    spotId: input.spotId,
    date: input.date,
    memberId: input.memberId,
    status: input.status,
    source: input.source,
    at: input.at,
  };
  if (input.arrivedAt != null) v.arrivedAt = input.arrivedAt;
  return v;
}

/**
 * 방문 기록 시각. 같은 id의 기존 기록보다 늦게 찍어 at LWW에서 이긴다.
 * 시뮬레이터 프리셋을 다시 시작하면 가상 시각이 앞으로 돌아가므로, 새 결과가 옛 결과를 덮으려면 필요하다.
 */
export function nextVisitAt(trip: Pick<Trip, 'visits'>, id: string, t: number): number {
  let prev = -Infinity;
  for (const v of trip.visits) if (v.id === id && v.at > prev) prev = v.at;
  return t > prev ? t : prev + 1;
}

/**
 * 시뮬레이터를 다시 재생할 때 지울 옛 재생의 방문 기록. 이 날짜·이 멤버의 source 'sim' 기록 중 아직 취소되지 않은 것.
 * 새 재생이 도달하지 않는 스팟에 옛 'arrived'가 남아 기록 지도·일기에 섞이지 않게 한다.
 */
export function staleSimVisits(trip: Pick<Trip, 'visits'>, date: string, memberId: string): Visit[] {
  const latest = new Map<string, Visit>();
  for (const v of trip.visits) {
    if (v.date !== date || v.memberId !== memberId) continue;
    const prev = latest.get(v.id);
    if (!prev || v.at >= prev.at) latest.set(v.id, v);
  }
  return [...latest.values()].filter((v) => v.source === 'sim' && v.status !== 'cancelled');
}

/**
 * 이어받을 알림 기록. 지금보다 뒤 시각(시뮬레이터가 남긴 가상 미래)은 버린다.
 * 남겨 두면 차이가 음수라 30분 제한이 끝나지 않고 같은 알림이 계속 막힌다.
 */
export function freshNotifyLog(log: NotifyLogEntry[], now: number): NotifyLogEntry[] {
  return log.filter((l) => l.at <= now);
}

/** 그날 스팟별 영업 종료(분). 휴무일이거나 영업시간을 모르면 넣지 않는다('영업 종료' 프리셋 입력). */
export function closingMinutes(trip: Pick<Trip, 'spots'>, date: string): Record<string, number> {
  const out: Record<string, number> = {};
  const wd = weekday(date);
  for (const s of trip.spots) {
    const h = s.hours;
    if (!h || h.closedWeekdays?.includes(wd)) continue;
    out[s.id] = toMin(h.close);
  }
  return out;
}

/** 도착·건너뜀 처리가 끝난 스팟(조정안 입력, 궤적 이어 만들기) */
export function doneSpotIds(tr: Pick<ArrivalTracker, 'statuses'>, status?: 'arrived' | 'skipped'): string[] {
  return Object.entries(tr.statuses)
    .filter(([, s]) => (status ? s === status : s === 'arrived' || s === 'skipped'))
    .map(([id]) => id);
}

/**
 * 조정안 계산에 넘길 지금 위치. 마지막 샘플 → 머무는 스팟 → 마지막으로 도착한 스팟 → 기점 → 첫 스팟 순이다.
 * 수동 진행 모드(위치 없음)에서도 조정안을 낼 수 있어야 해서 늘 좌표 하나를 돌려준다.
 */
export function replanPosition(day: LiveDay, tr: Pick<ArrivalTracker, 'statuses' | 'current'>, last?: LatLng): LatLng {
  if (last) return last;
  const byId = new Map(day.items.map((i) => [i.spotId, i.coord]));
  if (tr.current) {
    const c = byId.get(tr.current.spotId);
    if (c) return c;
  }
  for (let i = day.items.length - 1; i >= 0; i -= 1) {
    if (tr.statuses[day.items[i].spotId] === 'arrived') return day.items[i].coord;
  }
  if (day.base) return day.base;
  return day.items[0]?.coord ?? { latitude: 35.8562, longitude: 129.2247 };
}

/** 계획이 다시 계산돼도 그날 순서·시각이 같으면 여행 진행 입력을 바꾸지 않는다(궤적을 다시 만들지 않는다). */
export function sameLiveDay(a: LiveDay, b: LiveDay): boolean {
  if (a.date !== b.date || a.items.length !== b.items.length) return false;
  return a.items.every((x, i) => {
    const y = b.items[i];
    return x.spotId === y.spotId && x.arriveMin === y.arriveMin && x.departMin === y.departMin && x.travelMin === y.travelMin;
  });
}

/* ---------- 시뮬레이터 점프 ---------- */

export interface JumpTarget {
  key: 'nextSpot' | 'afterTrip';
  label: string;
  t: number;
}

/**
 * 19 시뮬레이터의 시각 점프 버튼. '다음 일정 10분 전'과 '여행 종료 다음 날'(예: 10/20 → 완료 상태와 편집 잠금).
 * 지금보다 앞선 시각만 준다(가상 시각은 되돌리지 않는다).
 */
export function jumpTargets(trip: Pick<Trip, 'endDate'>, day: LiveDay | undefined, timing: Timing | null | undefined, now: number): JumpTarget[] {
  const out: JumpTarget[] = [];
  if (day && timing) {
    const t = msOfMinute(day, timing.plannedArriveMin - 10);
    if (t > now) out.push({ key: 'nextSpot', label: `${timing.name} 10분 전`, t });
  }
  const after = addDays(trip.endDate, 1);
  const t = atKst(after, '10:00');
  if (t > now) out.push({ key: 'afterTrip', label: `${dayShort(after)} 여행 종료 뒤`, t });
  return out;
}

/* ---------- 화면 문구 ---------- */

export interface EtaView {
  planned: string;
  eta: string;
  /** '계획대로', 'N분 여유', '계획보다 N분 뒤' */
  delta: string;
  tone: 'ok' | 'muted';
}

/**
 * 다음 스팟 예정·예상 도착. 경고가 아니라 사실만 적는다(금지 문구 없음).
 * 늦어도 앰버(warn)로 칠하지 않는다. 지연은 조정안 시트 하나로만 알린다(FR-600).
 */
export function etaView(t: Timing): EtaView {
  const planned = toHHMM(Math.round(t.plannedArriveMin));
  const eta = toHHMM(Math.round(t.etaMin));
  const diff = Math.round(t.etaMin - t.plannedArriveMin);
  if (diff >= 1) return { planned, eta, delta: `계획보다 ${diff}분 뒤`, tone: 'muted' };
  if (diff <= -5) return { planned, eta, delta: `${-diff}분 여유`, tone: 'ok' };
  return { planned, eta, delta: '계획대로', tone: 'ok' };
}

export interface LiveLogLine {
  t: number;
  text: string;
  icon: 'check' | 'right' | 'clock' | 'pin' | 'locate' | 'camera' | 'x' | 'undo';
}

/** 엔진 효과 → 19 화면 진행 기록 한 줄. 위치 로그(track)와 도착 알림은 기록 줄을 만들지 않는다. */
export function logLine(e: EngineEffect, nameOf: (spotId: string) => string): LiveLogLine | null {
  switch (e.kind) {
    case 'visit':
      return e.status === 'arrived'
        ? { t: e.at, text: `${nameOf(e.spotId)} 도착`, icon: 'check' }
        : { t: e.at, text: `${nameOf(e.spotId)} 건너뜀`, icon: 'right' };
    case 'delay':
      return { t: e.at, text: `${e.name} 예상 도착이 계획보다 ${e.delayMin}분 뒤 · 조정안`, icon: 'clock' };
    case 'freeTime':
      // 주변 결과가 없으면 아무것도 보이지 않아야 해서(FR-604) 찾은 뒤에 freeTimeLine으로 적는다.
      return null;
    case 'shadow':
      return e.on
        ? { t: e.at, text: 'GPS 신호가 약해 위치 판정을 잠시 멈춤', icon: 'locate' }
        : { t: e.at, text: 'GPS 신호 회복', icon: 'locate' };
    case 'accuracyUnknown':
      return e.on
        ? { t: e.at, text: '위치 정확도를 알 수 없어 도착은 버튼으로 기록', icon: 'locate' }
        : { t: e.at, text: '위치 정확도 확인됨 · 도착을 다시 자동으로 봄', icon: 'locate' };
    default:
      return null;
  }
}

/** 빈 시간 추천을 찾았을 때 기록 줄 */
export function freeTimeLine(t: number, gapMin: number, count: number): LiveLogLine {
  return { t, text: `다음 일정까지 ${gapMin}분 · 걸어서 갈 만한 곳 ${count}곳`, icon: 'pin' };
}

/** 사진 이벤트 기록 줄 */
export function photoLine(t: number, count: number, withoutExif: number): LiveLogLine {
  const tail = withoutExif > 0 ? ` · 촬영 정보 없음 ${withoutExif}장(추정)` : '';
  return { t, text: `사진 ${count}장 올림${tail}`, icon: 'camera' };
}
