import type { Plan, Spot, Trip } from '../../types';
import { FAR_ROUNDTRIP_MIN } from '../constants';
import type { RouteProvider } from '../ports';
import { activeSpots, priorityCompare } from '../spotUtil';
import { dayContexts, dayPairs, legTransport } from './day';
import { createEvaluator, isForced } from './index';
import { createTravelBook } from './travel';

/**
 * 선별 불변식 검사(WP4 소유, 순수). 테스트와 시연 도구가 같은 판정을 쓴다(FR-403, 비기능 선별 품질).
 * 모든 구간을 조회한 장부로 plan을 다시 따져 본다. 제공자 값이 직선거리 추정과 다르면(구간표) 계획이 조회하지 않은
 * 구간 때문에 판정이 달라질 수 있으므로, 속성 테스트는 추정과 같은 값을 주는 로컬 제공자(빈 구간표)로 돌린다.
 *
 * 1. 분할: 모든 후보는 확정이나 제외 중 정확히 하나에 속한다. 제외 사유는 비어 있지 않다
 * 2. 고정 불가침: 고정과 기간 안 날짜 지정 스팟은 자동 제외되지 않는다
 * 3. 삽입: 사용자가 빼지 않은 제외 스팟은 어느 날에도 그대로 끼워 넣을 수 없다
 * 4. 교환: 제외 스팟보다 우선순위가 낮은 비고정 확정 스팟과 바꿔 넣어 수용량 안에 드는 교환이 없다
 * 5. 초과: 고정 없이 수용량을 넘긴 날은 없고, 넘긴 날은 overCapacity에 있다
 * 6. 사유: tooFar는 기점 왕복 60분 이상일 때만 나온다(문장만 고르고 제외 여부는 바꾸지 않는다)
 */
export async function planViolations(trip: Trip, plan: Plan, routes: RouteProvider): Promise<string[]> {
  const out: string[] = [];
  const ctxs = dayContexts(trip);
  const dates = ctxs.map((c) => c.date);
  const byId = new Map(trip.spots.map((s) => [s.id, s]));

  // 1. 분할
  const seen = new Map<string, number>();
  const days: Spot[][] = plan.days.map((d) =>
    d.items.map((it) => {
      seen.set(it.spotId, (seen.get(it.spotId) ?? 0) + 1);
      return byId.get(it.spotId) as Spot;
    }),
  );
  for (const e of plan.excluded) {
    seen.set(e.spotId, (seen.get(e.spotId) ?? 0) + 1);
    if (!e.reason.trim()) out.push(`${e.name}: 제외 사유가 비었다`);
  }
  for (const s of trip.spots) {
    const n = seen.get(s.id) ?? 0;
    if (n !== 1) out.push(`${s.name}: 확정·제외에 ${n}번 나온다`);
  }

  const cands = activeSpots(trip).filter((s) => !(s.fixedDate && !dates.includes(s.fixedDate)));
  const book = createTravelBook(routes);
  await book.ensure(ctxs.flatMap((c) => dayPairs(c, cands)));
  const ev = createEvaluator(ctxs, book);
  const autoEx = plan.excluded
    .filter((e) => e.reasonCode === 'dayFull' || e.reasonCode === 'tooFar')
    .map((e) => ({ e, s: byId.get(e.spotId) as Spot }));

  for (const { e, s } of autoEx) {
    // 2. 고정 불가침
    if (isForced(s, dates)) out.push(`${s.name}: 고정 취급인데 자동 제외됐다`);
    // 3. 삽입
    days.forEach((list, i) => {
      if (ev.fits(i, [...list, s])) out.push(`${s.name}: ${dates[i]}에 그대로 들어가는데 제외됐다`);
    });
    // 4. 교환
    days.forEach((list, i) => {
      for (const c of list) {
        if (isForced(c, dates) || priorityCompare(s, c) >= 0) continue;
        if (ev.fits(i, [...list.filter((x) => x.id !== c.id), s])) {
          out.push(`${s.name}: 우선순위가 낮은 ${c.name}(${dates[i]})과 바꿔 넣을 수 있다`);
        }
      }
    });
    // 6. 사유: tooFar면 어느 기점에서든 왕복이 60분 이상이어야 한다
    if (e.reasonCode === 'tooFar') {
      const far = ctxs.some((c) => {
        if (!c.base) return false;
        const b = c.base.coord;
        const rt =
          book.get(b, s.coord, legTransport(c, 'base', s.id)).minutes +
          book.get(s.coord, b, legTransport(c, s.id, 'base')).minutes;
        return rt >= FAR_ROUNDTRIP_MIN;
      });
      if (!far) out.push(`${s.name}: 기점 왕복이 ${FAR_ROUNDTRIP_MIN}분 미만인데 tooFar다`);
    }
  }

  // 5. 초과
  plan.days.forEach((d, i) => {
    if (d.overMin <= 0) return;
    if (!days[i].some((s) => isForced(s, dates))) out.push(`${d.date}: 고정 없이 ${d.overMin}분 넘는다`);
    if (!plan.overCapacity.some((o) => o.date === d.date && o.overMin === d.overMin)) {
      out.push(`${d.date}: overCapacity에 초과분이 없다`);
    }
  });
  return out;
}
