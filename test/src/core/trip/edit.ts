import type { DaySetting, Trip, TripCover, TripPatch } from '../../types';
import { dateRange } from '../util';

/**
 * 만든 뒤 여행방 기본 설정 바꾸기(25 여행방 설정, 방장만, WP2 소유).
 * 지역·날짜·주 이동수단은 trip/update 한 번으로 바꾼다(권한·값 검사는 core/ops/trip.validate).
 * 여기는 화면이 바꾸기 전에 확인을 물을지, 같이 비울 것이 무엇인지만 정한다.
 */

/** 새 기간에서 빠지는 날짜(오름차순). 그날의 기점·활동시간 설정은 trip/update가 버린다(fitDays) */
export function droppedDates(trip: Pick<Trip, 'startDate' | 'endDate'>, start: string, end: string): string[] {
  return dateRange(trip.startDate, trip.endDate).filter((d) => d < start || d > end);
}

/** 지역을 바꾸면 비울 기점이 있는 날짜. 장소로 정한 기점만 비운다('직전 날짜와 같음'·'기점 없음'은 그대로) */
export function basesToClear(days: readonly DaySetting[]): string[] {
  return days.filter((d) => d.base != null && d.base !== 'inherit').map((d) => d.date);
}

/** 기간 변경을 바로 적용할지. 빠지는 날짜가 있으면 확인을 묻는다 */
export function datesChangeNeedsConfirm(trip: Pick<Trip, 'startDate' | 'endDate'>, start: string, end: string): boolean {
  return droppedDates(trip, start, end).length > 0;
}

/** 확인 문구에 넣을 날짜 목록(M/D, 셋 넘으면 '외 N일') */
export function datesBrief(dates: readonly string[]): string {
  const md = dates.map((d) => {
    const [, m, day] = d.split('-').map(Number);
    return `${m}/${day}`;
  });
  return md.length > 3 ? `${md.slice(0, 3).join(', ')} 외 ${md.length - 3}일` : md.join(', ');
}

/** 빠른 수정(표지·이름·날짜) 입력. cover는 바꾸지 않았으면 undefined, 뺐으면 null */
export interface QuickEditDraft {
  title: string;
  cover?: TripCover | null;
  startDate?: string;
  endDate?: string;
}

/**
 * 빠른 수정 → trip/update 하나에 담을 바뀐 값만. 바뀐 것이 없으면 빈 객체다.
 * locked(여행이 끝남)면 이름·표지만 담는다(날짜는 잠금을 따른다, core/ops TRIP_PATCH_KEYS_AFTER_END).
 */
export function quickEditPatch(trip: Pick<Trip, 'title' | 'cover' | 'startDate' | 'endDate'>, d: QuickEditDraft, locked = false): TripPatch {
  const out: TripPatch = {};
  const title = d.title.trim();
  if (title && title !== trip.title) out.title = title;
  if (d.cover === null && trip.cover) out.cover = null;
  else if (d.cover && (d.cover.data !== trip.cover?.data || d.cover.mime !== trip.cover?.mime)) out.cover = d.cover;
  if (!locked && d.startDate && d.endDate && (d.startDate !== trip.startDate || d.endDate !== trip.endDate)) {
    out.startDate = d.startDate;
    out.endDate = d.endDate;
  }
  return out;
}
