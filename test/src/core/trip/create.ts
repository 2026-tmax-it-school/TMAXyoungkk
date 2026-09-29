import type { DayBase, DaySetting } from '../../types';
import { MAX_TRIP_DAYS } from '../constants';
import { regionById } from '../../data/regions';
import { addDays, dateRange, daysBetween, toMin, weekday } from '../util';

/**
 * 여행방 만들기(FR-201·205 입력) 순수 판정. 04 화면과 wp2-trip 테스트가 쓴다.
 * - 종료일 < 시작일은 거부한다.
 * - 14일을 넘으면(15일 이상) 확인 창 뒤에만 허용한다.
 * - 지역은 국내 목록(data/regions)에서만 고른다.
 * - 기점은 선택 입력이다. 없으면(base null) 그날 첫 스팟이 기점이 된다(planner baseSource firstSpot).
 */

export interface TripForm {
  title: string;
  regionId: string;
  startDate?: string;
  endDate?: string;
  dayStart: string;
  dayEnd: string;
}

export type TripFormError = 'title' | 'region' | 'dates' | 'order' | 'hours';

export interface TripFormCheck {
  ok: boolean;
  errors: Partial<Record<TripFormError, string>>;
  /** 기간 일수(시작·종료 포함) */
  days: number;
  /** 15일 이상이라 확인 창이 필요한지 */
  needsLongConfirm: boolean;
}

export const TITLE_MAX = 30;

export function checkTripForm(f: TripForm): TripFormCheck {
  const errors: TripFormCheck['errors'] = {};
  const title = f.title.trim();
  if (title.length === 0) errors.title = '여행방 이름을 입력해 주세요';
  else if (title.length > TITLE_MAX) errors.title = `여행방 이름은 ${TITLE_MAX}자까지입니다`;
  if (!regionById(f.regionId)) errors.region = '국내 지역 목록에서 골라 주세요';
  let days = 0;
  if (!f.startDate || !f.endDate) errors.dates = '달력에서 시작일과 종료일을 골라 주세요';
  else if (f.endDate < f.startDate) errors.order = '종료일이 시작일보다 앞설 수 없습니다';
  else days = daysBetween(f.startDate, f.endDate) + 1;
  if (toMin(f.dayStart) >= toMin(f.dayEnd)) errors.hours = '활동 시작 시각이 끝 시각보다 앞서야 합니다';
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    days,
    needsLongConfirm: days > MAX_TRIP_DAYS,
  };
}

/** '2박 3일', 하루면 '당일' */
export function nightsLabel(startDate: string, endDate: string): string {
  const n = daysBetween(startDate, endDate);
  if (n < 0) return '';
  return n === 0 ? '당일' : `${n}박 ${n + 1}일`;
}

/** 지역 이름과 기간으로 여행방 이름을 제안한다. '경주 2박 3일' */
export function suggestTitle(regionId: string, startDate?: string, endDate?: string): string {
  const r = regionById(regionId);
  if (!r) return '';
  if (!startDate || !endDate || endDate < startDate) return `${r.name} 여행`;
  return `${r.name} ${nightsLabel(startDate, endDate)}`;
}

/**
 * 날짜별 설정 초안. 기점이 있으면 첫날 지정, 다음 날들은 직전 날짜 승계('inherit').
 * 기점이 없으면 모든 날 null(그날 첫 스팟이 기점). 복귀 있음, 활동시간은 여행방 기본값을 따른다.
 */
export function buildDays(startDate: string, endDate: string, base: DayBase | null): DaySetting[] {
  return dateRange(startDate, endDate).map((date, i) => ({
    date,
    base: base ? (i === 0 ? { ...base } : 'inherit') : null,
    noReturn: false,
  }));
}

/* ---------- 달력 범위 선택(의존성 없음) ---------- */

export interface DateRangeSel {
  start?: string;
  end?: string;
}

/**
 * 날짜를 눌렀을 때의 범위. 처음 누르면 시작, 다음에 누르면 종료(시작보다 앞이면 거기서 새로 시작),
 * 범위가 이미 있으면 새로 시작한다. 그래서 달력으로는 종료일 < 시작일을 만들 수 없다.
 */
export function tapRange(sel: DateRangeSel, date: string): DateRangeSel {
  if (!sel.start || (sel.start && sel.end && sel.end !== sel.start)) return { start: date, end: date };
  if (date < sel.start) return { start: date, end: date };
  return { start: sel.start, end: date };
}

export function inRange(sel: DateRangeSel, date: string): boolean {
  return !!sel.start && !!sel.end && date >= sel.start && date <= sel.end;
}

/** 'YYYY-MM'의 달력 칸. 일요일 시작, 앞뒤 빈칸은 null. 한 줄 7칸 */
export function monthGrid(yearMonth: string): (string | null)[][] {
  const first = `${yearMonth}-01`;
  const lead = weekday(first);
  const days: string[] = [];
  for (let d = first; d.startsWith(yearMonth); d = addDays(d, 1)) days.push(d);
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** 'YYYY-MM'에서 n달 옮긴 달 */
export function shiftMonth(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** '2026-10' → '2026년 10월' */
export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return `${y}년 ${m}월`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-10-17' → '10월 17일 (토)' */
export function dateLong(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEK[weekday(date)]})`;
}

/** 기간 표시 '10월 17일 (토) – 19일 (월)'. 달이 다르면 뒤에도 달을 적는다. */
export function periodLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return dateLong(startDate);
  const [, sm] = startDate.split('-').map(Number);
  const [, em, ed] = endDate.split('-').map(Number);
  const tail = sm === em ? `${ed}일 (${WEEK[weekday(endDate)]})` : dateLong(endDate);
  return `${dateLong(startDate)} – ${tail}`;
}

/* ---------- 활동시간 ---------- */

/** 30분 단위로 'HH:MM'을 옮긴다. 05:00 ~ 24:00 안으로 자른다. */
export function stepTime(hhmm: string, deltaMin: number): string {
  const v = Math.min(24 * 60, Math.max(5 * 60, toMin(hhmm) + deltaMin));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** '하루 12시간' */
export function hoursLabel(dayStart: string, dayEnd: string): string {
  const m = toMin(dayEnd) - toMin(dayStart);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `하루 ${h}시간` : `하루 ${h}시간 ${r}분`;
}

/* ---------- 날짜별 기점 표시(25) ---------- */

export type BaseMode = 'set' | 'inherit' | 'none';

export function baseModeOf(day: DaySetting | undefined, isFirst: boolean): BaseMode {
  if (!day) return isFirst ? 'none' : 'inherit';
  if (day.base === 'inherit') return isFirst ? 'none' : 'inherit';
  if (day.base === null) return 'none';
  return 'set';
}

/**
 * 그날 실제로 쓰는 기점. 'inherit'는 직전 날짜를 거슬러 올라가고, 첫날의 'inherit'는 null과 같다.
 * null이면 그날 첫 스팟이 기점이다(계산은 planner). 25 화면의 '직전 날짜와 같음' 안내에 쓴다.
 */
export function effectiveBase(days: readonly DaySetting[], date: string): DayBase | null {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let cur: DayBase | null = null;
  for (const d of sorted) {
    if (d.date > date) break;
    if (d.base === 'inherit') continue;
    cur = d.base;
  }
  return cur;
}

/** 그날 활동시간. 날짜별 값이 없으면 여행방 기본값이다. */
export function dayHours(
  trip: { dayStart: string; dayEnd: string; days: readonly DaySetting[] },
  date: string,
): { dayStart: string; dayEnd: string; custom: boolean } {
  const d = trip.days.find((x) => x.date === date);
  const dayStart = d?.dayStart ?? trip.dayStart;
  const dayEnd = d?.dayEnd ?? trip.dayEnd;
  return { dayStart, dayEnd, custom: d?.dayStart != null || d?.dayEnd != null };
}
