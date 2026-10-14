import React from 'react';

import type { Trip } from '../../../types';
import { dateRange, weekday } from '../../../core/util';
import { daySegLabel } from '../../schedule/view';
import { Seg, type SegItem } from '../../../ui';

const WEEKDAY_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** 스크린리더 이름 '10월 18일 토요일'(사진 수가 있으면 ', 사진 3장'). 날짜 숫자가 순번으로 읽히지 않게 쓴다 */
export function dateA11yLabel(date: string, photos?: number): string {
  const [, m, d] = date.split('-').map(Number);
  const day = `${m}월 ${d}일 ${WEEKDAY_FULL[weekday(date)]}`;
  return photos == null ? day : `${day}, 사진 ${photos}장`;
}

/**
 * 여행 기간 날짜 Seg(20·21·22). 라벨은 시간표와 같은 '10/18 토'(daySegLabel)다.
 * all이면 맨 앞에 '전체'를 둔다. 기간이 길면 Seg가 스스로 가로로 민다(바깥 ScrollView 없음).
 * photoCounts가 있으면 칸마다 스크린리더가 사진 수를 함께 읽고, showCount면 개수를 라벨 뒤에 보인다(사진 화면만).
 */
export function DateSeg({
  trip,
  value,
  onChange,
  all,
  photoCounts,
  showCount,
}: {
  trip: Trip;
  value: string;
  onChange: (date: string) => void;
  all?: boolean;
  photoCounts?: Record<string, number>;
  showCount?: boolean;
}) {
  const items: SegItem<string>[] = dateRange(trip.startDate, trip.endDate).map((d) => ({
    key: d,
    label: daySegLabel(d),
    count: showCount ? (photoCounts?.[d] ?? 0) : undefined,
    a11yLabel: dateA11yLabel(d, photoCounts ? (photoCounts[d] ?? 0) : undefined),
  }));
  if (all) {
    items.unshift({
      key: 'all',
      label: '전체',
      count: showCount ? (photoCounts?.all ?? 0) : undefined,
      a11yLabel: photoCounts ? `전체, 사진 ${photoCounts.all ?? 0}장` : '전체',
    });
  }
  return <Seg items={items} value={value} onChange={onChange} />;
}

/** 처음 고를 날짜: 지정값 → 오늘이 기간 안이면 오늘 → 기록이 있는 첫날 → 시작일 */
export function initialDate(trip: Trip, today: string, requested?: string, withRecords: string[] = []): string {
  if (requested && requested >= trip.startDate && requested <= trip.endDate) return requested;
  if (today >= trip.startDate && today <= trip.endDate) return today;
  const first = withRecords.find((d) => d >= trip.startDate && d <= trip.endDate);
  return first ?? trip.startDate;
}
