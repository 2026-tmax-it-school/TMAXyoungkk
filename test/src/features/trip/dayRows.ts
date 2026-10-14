import type { DayBase, Trip } from '../../types';
import { baseModeOf, effectiveBase } from '../../core/trip/create';

/**
 * 25 여행방 설정 · 날짜별 기점 줄의 보조 줄(순수, WP2). 줄 제목은 dateLong('10월 17일 (금)')이고 이 함수는 그 아래 한 줄이다.
 * 형식은 셋이다.
 * - 지정: 기점 이름('황리단 스테이')
 * - 직전과 같음: '직전 날짜와 같음 · 황리단 스테이'(거슬러 올라가도 기점이 없으면 '직전 날짜와 같음 · 첫 스팟 사용')
 * - 기점 없음: '기점 없음 · 첫 스팟 사용'
 * 복귀 없음이 켜져 있으면 뒤에 ' · 복귀 없음'을 붙인다. 첫날의 '직전과 같음'은 기점 없음으로 본다(baseModeOf).
 * 그날만 바꾼 활동시간은 여기 적지 않고 화면의 '이날만' 칩으로 보인다.
 */
export const DAY_SUB = {
  inherit: '직전 날짜와 같음',
  none: '기점 없음 · 첫 스팟 사용',
  firstSpot: '첫 스팟 사용',
  noReturn: '복귀 없음',
} as const;

export function dayRowSub(trip: Pick<Trip, 'startDate' | 'days'>, date: string): string {
  const day = trip.days.find((d) => d.date === date);
  const mode = baseModeOf(day, date === trip.startDate);
  let text: string;
  if (mode === 'set') {
    text = (day?.base as DayBase).name;
  } else if (mode === 'inherit') {
    const b = effectiveBase(trip.days, date);
    text = `${DAY_SUB.inherit} · ${b ? b.name : DAY_SUB.firstSpot}`;
  } else {
    text = DAY_SUB.none;
  }
  return day?.noReturn ? `${text} · ${DAY_SUB.noReturn}` : text;
}
