import React from 'react';
import { ScrollView } from 'react-native';

import type { Trip } from '../../../types';
import { dateRange, dayShort } from '../../../core/util';
import { Seg } from '../../../ui';

/** 여행 기간 날짜 Seg(20·21·22). all이면 맨 앞에 '전체'를 둔다. 기간이 길면 가로로 민다. */
export function DateSeg({
  trip,
  value,
  onChange,
  all,
  counts,
}: {
  trip: Trip;
  value: string;
  onChange: (date: string) => void;
  all?: boolean;
  counts?: Record<string, number>;
}) {
  const items = dateRange(trip.startDate, trip.endDate).map((d) => ({ key: d, label: dayShort(d), count: counts?.[d] }));
  if (all) items.unshift({ key: 'all', label: '전체', count: counts?.all });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Seg items={items} value={value} onChange={onChange} />
    </ScrollView>
  );
}

/** 처음 고를 날짜: 지정값 → 오늘이 기간 안이면 오늘 → 기록이 있는 첫날 → 시작일 */
export function initialDate(trip: Trip, today: string, requested?: string, withRecords: string[] = []): string {
  if (requested && requested >= trip.startDate && requested <= trip.endDate) return requested;
  if (today >= trip.startDate && today <= trip.endDate) return today;
  const first = withRecords.find((d) => d >= trip.startDate && d <= trip.endDate);
  return first ?? trip.startDate;
}
