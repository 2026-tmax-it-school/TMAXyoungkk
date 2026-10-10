import type { DaySetting, Trip } from '../../types';
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
