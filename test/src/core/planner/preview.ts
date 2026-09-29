import type { Op, OpDraft, Plan, PlanDiff, Trip } from '../../types';
import { applyOp } from '../ops';
import { buildPlan, type PlanDeps } from './index';

/**
 * 편집 미리보기(WP4 소유, 순수). 문서를 바꾸지 않고 drafts를 적용했을 때 바뀔 결과만 알려준다.
 * 07 '체류를 N분으로 늘리면 X가 제외 스팟이 됩니다', 12 '바꾸면 이렇게 됩니다'에 쓴다.
 *
 * drafts를 임시 op로 만들어 applyOp로 차례로 접고(검증은 하지 않는다: 잠금·권한과 무관한 가정 계산),
 * buildPlan을 다시 돌려 base와 비교한다. 임시 op.at은 문서의 어떤 편집보다 늦게 찍어 LWW에서 이기게 한다.
 */

function latestEditAt(trip: Trip): number {
  let max = trip.createdAt;
  for (const s of trip.spots) for (const v of Object.values(s.edited)) if (v != null && v > max) max = v;
  for (const d of trip.days) for (const v of Object.values(d.edited ?? {})) if (v != null && v > max) max = v;
  for (const l of trip.legs) {
    const at = l.at;
    if (at != null && at > max) max = at;
  }
  return max;
}

/** drafts를 적용한 가상 문서. 원래 문서는 그대로다. */
export function applyDrafts(trip: Trip, drafts: readonly OpDraft[], now: number): Trip {
  const actorId = trip.members.find((m) => m.role === 'host')?.id ?? trip.members[0]?.id ?? 'preview';
  const at0 = Math.max(now, latestEditAt(trip) + 1);
  let doc: Trip | undefined = trip;
  drafts.forEach((d, i) => {
    const op = { ...d, id: `preview-${i}`, tripId: trip.id, actorId, at: at0 + i } as Op;
    doc = applyOp(doc, op) ?? doc;
  });
  return doc ?? trip;
}

export function diffPlans(base: Plan, after: Plan): PlanDiff {
  const exBase = new Set(base.excluded.map((e) => e.spotId));
  const exAfter = new Set(after.excluded.map((e) => e.spotId));
  const confirmedAfter = new Set(after.days.flatMap((d) => d.items.map((i) => i.spotId)));
  return {
    newlyExcluded: [...exAfter].filter((id) => !exBase.has(id)),
    newlyConfirmed: [...exBase].filter((id) => !exAfter.has(id) && confirmedAfter.has(id)),
    dayDelta: after.days.map((d) => {
      const before = base.days.find((b) => b.date === d.date);
      return { date: d.date, usedMinDelta: d.usedMin - (before?.usedMin ?? 0), overMin: d.overMin };
    }),
  };
}

export async function previewOps(
  trip: Trip,
  base: Plan,
  drafts: OpDraft[],
  deps: PlanDeps,
): Promise<PlanDiff> {
  const next = applyDrafts(trip, drafts, deps.now);
  const after = await buildPlan(next, { routes: deps.routes, now: deps.now });
  return diffPlans(base, after);
}
