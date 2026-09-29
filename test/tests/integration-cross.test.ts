import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Adjustment, Op, OpDraft, Photo, Plan, Trip } from '../src/types';
import { DELETED_MEMBER_NAME } from '../src/core/constants';
import { planAccountDeletion } from '../src/core/auth';
import { proposeForDelay } from '../src/core/live/delay';
import { applyOp, validateOp } from '../src/core/ops';
import { buildPlan, type PlanDeps } from '../src/core/planner';
import { overflowAdjustments } from '../src/core/planner/adjust';
import { diffPlans, previewOps } from '../src/core/planner/preview';
import { replanForDelay } from '../src/core/planner/replan';
import { toHHMM, toMin } from '../src/core/util';
import { scenarioPlace } from '../src/data/scenario';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { memberId, scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * 패키지 경계를 넘는 단언(통합 소유, 03 회의 결정). 병렬 작업 중에는 다른 패키지의 리듀서·함수가 스텁이라
 * 작업 중 게이트(자기 테스트)에 둘 수 없는 것을 여기로 옮겼다. 통합 때 todo를 풀고 본문을 썼다.
 * 패키지 테스트는 같은 성질을 공유 patchSpot·patchDay 직접 호출이나 주입 가짜로 자기 몫만 검사한다.
 * 여기서는 실제 리듀서(applyOp → 기능 파일 reduce)와 실제 검증(validateOp)을 거친다.
 */

const DATE = '2026-10-18';
/** 시나리오 시작(10/01) 한 시간 뒤. 여행 종료(10/19) 전이라 잠금이 없다 */
const T = SCENARIO_T0 + 3_600_000;

const deps = (): PlanDeps => ({
  routes: createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() }),
  now: SCENARIO_T0,
});

let n = 0;
function opOf(trip: Trip, draft: OpDraft, at: number, actorId = memberId('minji')): Op {
  n += 1;
  return { ...draft, id: `x-op-${n}`, tripId: trip.id, actorId, at } as Op;
}

/** 실제 앱 dispatch처럼 검증을 통과해야만 적용한다. 거부되면 이유와 함께 실패한다. */
function dispatch(trip: Trip, draft: OpDraft, at: number, actorId?: string): Trip {
  const op = opOf(trip, draft, at, actorId);
  const v = validateOp(trip, op);
  assert.ok(v.ok, `${draft.type} 거부: ${v.ok ? '' : v.reason}`);
  const next = applyOp(trip, op);
  assert.ok(next);
  return next;
}

function dispatchMany(trip: Trip, drafts: readonly OpDraft[], at: number, actorId?: string): Trip {
  return drafts.reduce((t, d, i) => dispatch(t, d, at + i, actorId), trip);
}

test('WP2×WP4: trip/setDay 뒤 schedule/setDayTransport 값이 남고, 반대 순서도 같다(applyOp)', () => {
  const setDay: OpDraft = { type: 'trip/setDay', date: DATE, patch: { noReturn: true, dayEnd: '20:00' } };
  const setTransport: OpDraft = { type: 'schedule/setDayTransport', date: DATE, transport: 'walk' };
  const base = scenarioTrip();
  const a = dispatch(dispatch(base, setDay, T), setTransport, T + 1);
  const b = dispatch(dispatch(base, setTransport, T + 1), setDay, T);
  const dayA = a.days.find((d) => d.date === DATE);
  const dayB = b.days.find((d) => d.date === DATE);
  assert.ok(dayA && dayB);
  assert.equal(dayA.noReturn, true);
  assert.equal(dayA.dayEnd, '20:00');
  assert.equal(dayA.transport, 'walk', 'setDay patch가 하루 수단을 지우지 않는다');
  assert.deepEqual(dayB, dayA, '적용 순서와 상관없이 같은 날짜 설정');
  // 수단을 해제해도 setDay 값은 남는다
  const c = dispatch(a, { type: 'schedule/setDayTransport', date: DATE, transport: null }, T + 2);
  const dayC = c.days.find((d) => d.date === DATE);
  assert.equal(dayC?.transport, undefined);
  assert.equal(dayC?.noReturn, true);
});

/**
 * 10/18 확정 스팟에 날짜를 지정하고(고정 취급) 교촌마을 한정식 체류를 늘려 고정만으로 넘치게 한다(wp4-edit와 같은 준비).
 * 10/19 활동 종료를 21:00으로 늘려 옮길 자리를 만든다(그래야 다음 날로 옮기기 조정안이 나온다).
 */
async function overflowTrip(): Promise<{ trip: Trip; plan: Plan }> {
  let trip = scenarioTrip();
  trip = dispatch(trip, { type: 'trip/setDay', date: '2026-10-19', patch: { dayEnd: '21:00' } }, T - 100);
  const first = await buildPlan(trip, deps());
  const ids = first.days.find((d) => d.date === DATE)?.items.map((i) => i.spotId) ?? [];
  ids.forEach((id, i) => {
    trip = dispatch(trip, { type: 'schedule/setDate', spotId: id, date: DATE }, T + i);
  });
  trip = dispatch(trip, { type: 'schedule/setStay', spotId: 's-gj-gyochon-hanjeongsik', stayMin: 180 }, T + 50);
  const plan = await buildPlan(trip, deps());
  return { trip, plan };
}

test('WP4×WP3: 조정안(exclude·shortenStay·moveToDate)을 dispatchMany 초안 그대로 applyOp하면 previewOps가 예고한 결과와 같다', async () => {
  const { trip, plan } = await overflowTrip();
  assert.ok((plan.days.find((d) => d.date === DATE)?.overMin ?? 0) > 0, '고정만으로 초과');
  const adjustments = overflowAdjustments(trip, plan, DATE);
  const kinds = new Set(adjustments.map((a) => a.kind));
  for (const k of ['shortenStay', 'moveToDate', 'exclude'] as const) assert.ok(kinds.has(k), `${k} 조정안이 있다`);
  for (const adj of adjustments) {
    const predicted = await previewOps(trip, plan, adj.ops, deps());
    // 실제 적용: 문서의 모든 편집보다 늦은 시각으로 보낸다(앱 dispatch의 stampAt과 같은 효과)
    const applied = dispatchMany(trip, adj.ops, T + 1000);
    const after = await buildPlan(applied, deps());
    assert.deepEqual(diffPlans(plan, after), predicted, `${adj.label}: 예고와 실제가 같다`);
  }
  // 빼기 조정안은 spot/remove(사용자가 직접 뺌)로 적용된다(WP3 리듀서)
  const ex = adjustments.find((a) => a.kind === 'exclude');
  assert.ok(ex);
  const exOp = ex.ops[0];
  assert.ok(exOp.type === 'spot/remove');
  const removed = dispatchMany(trip, ex.ops, T + 1000);
  const after = await buildPlan(removed, deps());
  const row = after.excluded.find((e) => e.spotId === exOp.spotId);
  assert.equal(row?.reasonCode, 'userRemoved');
  assert.equal(row?.reason, '사용자가 직접 뺌');
});

/** 박물관 영업 종료를 계획 도착 + 10분으로 당긴 여행방과 그 계획(wp4-replan과 같은 준비) */
async function delayTrip(): Promise<{ trip: Trip; plan: Plan }> {
  const base = scenarioTrip();
  const plan = await buildPlan(base, deps());
  const it = plan.days.find((d) => d.date === DATE)?.items.find((i) => i.spotId === 's-gj-museum');
  assert.ok(it, '10/18에 박물관이 있다');
  const close = toHHMM(toMin(it.arrive) + 10);
  const trip = {
    ...base,
    spots: base.spots.map((s) => (s.id === 's-gj-museum' ? { ...s, hours: { open: '09:00', close } } : s)),
  };
  return { trip, plan };
}

const replanInput = (trip: Trip, plan: Plan, delayMin: number) => ({
  trip,
  plan,
  date: DATE,
  now: SCENARIO_T0,
  position: scenarioPlace('gj-seokguram').coord,
  visitedSpotIds: ['s-gj-bulguksa', 's-gj-seokguram'],
  skippedSpotIds: [],
  delayMin,
});

test('WP4×WP3: 지연 exclude 조정안 적용 → spot/remove(reason delay) → 제외 사유 userRemoved(지연 조정안으로 뺌)', async () => {
  const { trip, plan } = await delayTrip();
  const { adjustments } = await replanForDelay(replanInput(trip, plan, 60), deps());
  const ex = adjustments.find((a) => a.kind === 'exclude');
  assert.ok(ex, '60분 지연이면 빼기 조정안이 있다');
  const exOp = ex.ops[0];
  assert.ok(exOp.type === 'spot/remove' && exOp.reason === 'delay');
  const applied = dispatchMany(trip, ex.ops, T);
  const spot = applied.spots.find((s) => s.id === exOp.spotId);
  assert.equal(spot?.removedByUser, true);
  assert.equal(spot?.removedReason, 'delay');
  const after = await buildPlan(applied, deps());
  const row = after.excluded.find((e) => e.spotId === exOp.spotId);
  assert.equal(row?.reasonCode, 'userRemoved');
  assert.equal(row?.reason, '지연 조정안으로 뺌');
  assert.ok(!after.days.some((d) => d.items.some((i) => i.spotId === exOp.spotId)), '확정 스팟에서 빠진다');
  // 되돌리면(spot/restore) 고정으로 돌아온다
  const restored = dispatch(applied, { type: 'spot/restore', spotId: exOp.spotId }, T + 100);
  const back = restored.spots.find((s) => s.id === exOp.spotId);
  assert.ok(!back?.removedByUser, '제외 표시가 풀린다');
  assert.equal(back?.pinned, true);
});

test('WP5×WP4: proposeForDelay(15, replanForDelay)는 조정안을 내고 14분이면 부르지 않는다, 거절하면 op 0개', async () => {
  const { trip, plan } = await delayTrip();
  const snapshot = JSON.stringify(trip);
  const calls: number[] = [];
  const make = async (delayMin: number): Promise<Adjustment[]> => {
    calls.push(delayMin);
    return (await replanForDelay(replanInput(trip, plan, delayMin), deps())).adjustments;
  };
  const at15 = await proposeForDelay(15, make);
  assert.deepEqual(calls, [15], '15분이면 받은 지연 그대로 조정안을 만든다');
  assert.ok(at15 && at15.length > 0, '15분 지연 조정안');
  for (const a of at15) assert.ok(a.ops.length > 0 && a.savedMin >= 0, a.label);
  const at14 = await proposeForDelay(14, make);
  assert.equal(at14, null);
  assert.deepEqual(calls, [15], '14분이면 조정안 생성을 부르지 않는다');
  // 거절: 조정안 초안을 보내지 않으면 문서는 그대로다(조정안 생성은 문서를 바꾸지 않는다)
  assert.equal(JSON.stringify(trip), snapshot);
  const rejected = dispatchMany(trip, [], T);
  assert.equal(rejected, trip, '보낸 op 0개');
});

function simPhoto(id: string, owner: string, at: number): Photo {
  return {
    id,
    memberId: owner,
    sim: { label: id, tone: 1 },
    bytes: 1000,
    originalBytes: 1000,
    compressed: false,
    takenAt: at,
    source: 'estimated',
    uploadedAt: at,
  };
}

test('WP1×WP2×WP6: planAccountDeletion 초안을 actorId(그 방의 본인 멤버)로 적용하면 본인 사진만 사라지고 채팅·제안은 남는다', () => {
  const sua = memberId('sua');
  const minji = memberId('minji');
  let trip = scenarioTrip();
  // 채팅과 사진을 실제 op로 쌓는다(chat/send는 그룹 모드, 사진은 본인 것만)
  trip = dispatch(trip, { type: 'chat/send', message: { id: 'msg-sua', text: '불국사 꼭 가자' } }, T, sua);
  trip = dispatch(trip, { type: 'chat/send', message: { id: 'msg-minji', text: '좋아' } }, T + 1, minji);
  trip = dispatch(trip, { type: 'journal/photoAdded', photo: simPhoto('p-sua-1', sua, T + 2) }, T + 2, sua);
  trip = dispatch(trip, { type: 'journal/photoAdded', photo: simPhoto('p-sua-2', sua, T + 3) }, T + 3, sua);
  trip = dispatch(trip, { type: 'journal/photoAdded', photo: simPhoto('p-minji-1', minji, T + 4) }, T + 4, minji);
  const proposalsBefore = trip.spots.flatMap((s) => s.proposals.filter((p) => p.memberId === sua)).length;
  assert.ok(proposalsBefore > 0, '수아의 제안이 있다');

  const plan = planAccountDeletion([trip], 'u-sua');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].actorId, sua, '보내는 멤버는 그 방의 본인 멤버다(actingAs 아님)');
  // 방장(민지)으로 보내면 사진 삭제·익명 처리가 거부된다(본인만)
  const asHost = opOf(trip, plan[0].drafts[0], T + 10, minji);
  assert.equal(validateOp(trip, asHost).ok, false);

  const after = dispatchMany(trip, plan[0].drafts, T + 10, plan[0].actorId);
  assert.deepEqual(
    after.photos.map((p) => p.id),
    ['p-minji-1'],
    '본인 사진만 사라진다',
  );
  assert.deepEqual(
    after.messages.map((m) => m.id).sort(),
    ['msg-minji', 'msg-sua'],
    '채팅은 남는다',
  );
  assert.equal(after.messages.find((m) => m.id === 'msg-sua')?.memberId, sua, '채팅은 memberId를 유지한다');
  assert.equal(
    after.spots.flatMap((s) => s.proposals.filter((p) => p.memberId === sua)).length,
    proposalsBefore,
    '제안 이력은 남는다',
  );
  const m = after.members.find((x) => x.id === sua);
  assert.equal(m?.nickname, DELETED_MEMBER_NAME);
  assert.equal(m?.anonymized, true);
  assert.equal(m?.leftReason, 'deleted');
  assert.ok(m?.leftAt != null);
  // 다시 계획하면 남은 초안이 없다(같은 탈퇴를 두 번 보내지 않는다)
  assert.deepEqual(planAccountDeletion([after], 'u-sua'), []);
});
