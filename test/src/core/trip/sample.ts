import type { SampleBase, SamplePlace, SampleTrip } from '../../data/sampleTrips';
import type { DayBase, OpDraft, Place, Spot } from '../../types';
import { manualSpot } from '../extract/manual';
import { addDays, dateRange, weekday } from '../util';

/**
 * 추천 여행지 예시 일정 → 여행방(WP2 소유, 2026-10-17). 순수 함수만 둔다.
 * 홈 '추천 여행지'를 누르면 예시 2박 3일을 보여 주고, '이 일정으로 여행방 만들기'를 누르면 만들기 화면이 열린다.
 * 방을 만든 직후 예시 장소가 후보로 담기고(spot/add), 일차마다 날짜가 정해지고(schedule/setDate), 그날 순서가 예시 순서로
 * 놓인다(schedule/reorder). 그러면 앱이 평소처럼 시간표를 계산한다. 사용자가 고른 기간이 3일보다 짧으면 남는 날 장소는
 * 날짜 없이 후보로만 담긴다.
 */

export const SAMPLE_PLACE_PREFIX = 'sample:';
export const SAMPLE_NIGHTS = 2;

/** 예시 장소 → 후보가 될 장소. placeId는 'sample:'로 시작해 카카오·사전 장소와 섞이지 않는다 */
export function samplePlace(p: SamplePlace): Place {
  return { placeId: `${SAMPLE_PLACE_PREFIX}${p.id}`, name: p.name, coord: p.coord, category: p.category, kind: p.kind, address: p.address };
}

export function sampleDayBase(b: SampleBase): DayBase {
  return { name: b.name, coord: b.coord, placeId: `${SAMPLE_PLACE_PREFIX}${b.id}` };
}

/** 예시 전체 장소 수 */
export function sampleSpotCount(s: SampleTrip): number {
  return s.days.reduce((n, d) => n + d.places.length, 0);
}

/** 기본 시작일: 오늘 기준 사흘 뒤부터 처음 오는 금요일(바로 코앞이 아니고 주말을 낀다) */
export function defaultSampleStart(today: string): string {
  for (let i = 3; i < 10; i += 1) {
    const d = addDays(today, i);
    if (weekday(d) === 5) return d;
  }
  return addDays(today, 7);
}

/** 일차 i(0부터) → 날짜. 고른 기간 밖이면 undefined */
export function sampleDateOf(dates: readonly string[], dayIndex: number): string | undefined {
  return dates[dayIndex];
}

export interface SampleOpsInput {
  /** 여행방 기간의 날짜들(시작~끝) */
  dates: readonly string[];
  memberId: string;
  at: number;
  /** 후보 id를 만든다(services ids.next('spot')) */
  newSpotId: () => string;
}

/**
 * 방을 만든 직후 보낼 op들. 순서: 후보 추가 전부 → 날짜 지정 → 날짜별 순서.
 * 같은 장소가 두 번 들어 있지 않다(데이터 테스트가 확인한다). 날짜가 없는 일차는 날짜·순서 op를 만들지 않는다.
 */
export function sampleOps(sample: SampleTrip, input: SampleOpsInput): { drafts: OpDraft[]; spots: Spot[] } {
  const spots: Spot[] = [];
  const adds: OpDraft[] = [];
  const dates: OpDraft[] = [];
  const orders: OpDraft[] = [];
  sample.days.forEach((day, i) => {
    const date = sampleDateOf(input.dates, i);
    const ids: string[] = [];
    for (const p of day.places) {
      const spot = manualSpot(samplePlace(p), { id: input.newSpotId(), memberId: input.memberId, at: input.at, outside: false });
      spots.push(spot);
      ids.push(spot.id);
      adds.push({ type: 'spot/add', spot });
      if (date) dates.push({ type: 'schedule/setDate', spotId: spot.id, date });
    }
    if (date && ids.length > 0) orders.push({ type: 'schedule/reorder', date, spotIds: ids });
  });
  return { drafts: [...adds, ...dates, ...orders], spots };
}

/** 고른 기간의 날짜 목록(시작·끝이 없으면 빈 목록) */
export function sampleDates(start?: string, end?: string): string[] {
  return start && end && end >= start ? dateRange(start, end) : [];
}

/** 기간이 예시(3일)와 다를 때 만들기 화면에 보일 안내. 같으면 undefined */
export function sampleFitNote(dayCount: number, days: number): string | undefined {
  if (dayCount === 0 || dayCount === days) return undefined;
  if (dayCount < days) return `기간이 ${days}일보다 짧아서 남는 날의 장소는 날짜 없이 후보로만 담겨요`;
  return `예시는 ${days}일이에요. 남는 날은 비워 두고 직접 채울 수 있어요`;
}
