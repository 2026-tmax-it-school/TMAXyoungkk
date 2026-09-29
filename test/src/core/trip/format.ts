import { kstDate, kstHHMM } from '../util';

/**
 * 여행방 화면 공용 표시 문구(KST). 순수 함수다.
 */

/** 시점 → '10월 9일' */
export function dateLongShort(ms: number): string {
  const [, m, d] = kstDate(ms).split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** 시점 → '2027년 10월 20일' */
export function dateWithYear(ms: number): string {
  const [y, m, d] = kstDate(ms).split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** 시점 → '10월 22일 09:24' */
export function dateTime(ms: number): string {
  return `${dateLongShort(ms)} ${kstHHMM(ms)}`;
}
