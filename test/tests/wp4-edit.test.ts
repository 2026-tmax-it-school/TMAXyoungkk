import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Op, OpDraft, Trip } from '../src/types';
import { patchSpot } from '../src/core/ops/lww';
import { liveLegs, reduce, validate } from '../src/core/ops/schedule';
import { buildPlan, placedDateOf } from '../src/core/planner';
import { overflowAdjustments, overflowText } from '../src/core/planner/adjust';
import { applyDrafts, previewOps } from '../src/core/planner/preview';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * FR-503 일정 수동 편집. 값은 스팟과 날짜 설정에 저장되어 다른 op로 재계산해도 남는다(1단계 소실 결함 회귀).
 * spot/pin 리듀서는 WP3 소유라 여기서는 공유 patchSpot을 직접 불러 같은 효과를 낸다(계약 A11 테스트 경계).
 */

const routes = () => createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
let n = 0;
const op = (draft: OpDraft, at: number): Op => ({ ...draft, id: `op${(n += 1)}`, tripId: 'trip-scenario', actorId: 'm-minji', at });
const apply = (trip: Trip, draft: OpDraft, at: number) => reduce(trip, op(draft, at));
const T = SCENARIO_T0 + 3_600_000;
const pinVia = (trip: Trip, spotId: string, pinned: boolean, at: number): Trip => ({
  ...trip,
  spots: trip.spots.map((s) => (s.id === spotId ? patchSpot(s, { pinned }, at) : s)),
});

test('reorder·setStay·setArrive·setDate 뒤 다른 편집(고정)으로 재계산해도 사용자 순서와 값이 남는다', async () => {
  const base = await buildPlan(scenarioTrip(), { routes: routes(), now: 0 });
  const d18 = base.days.find((d) => d.date === '2026-10-18');
  assert.ok(d18);
  const want = [...d18.items.map((i) => i.spotId)].reverse();
  let t = scenarioTrip();
  t = apply(t, { type: 'schedule/reorder', date: '2026-10-18', spotIds: want }, T);
  t = apply(t, { type: 'schedule/setStay', spotId: 's-gj-museum', stayMin: 45 }, T + 1);
  t = apply(t, { type: 'schedule/setArrive', spotId: 's-gj-bulguksa', arrive: '15:30' }, T + 2);
  t = apply(t, { type: 'schedule/setDate', spotId: 's-gj-bomunho', date: '2026-10-19' }, T + 3);
  // 다른 사람이 다른 스팟을 고정한다(spot/pin 효과)
  t = pinVia(t, 's-gj-woljeonggyo', true, T + 4);

  const p = await buildPlan(t, { routes: routes(), now: 0 });
  const day = p.days.find((d) => d.date === '2026-10-18');
  assert.ok(day);
  assert.equal(day.orderMethod, 'manual');
  // 수동 순서 스팟은 사용자 순서 그대로다(자리가 난 곳에 다른 스팟이 끼어들 수는 있다)
  assert.deepEqual(
    day.items.map((i) => i.spotId).filter((id) => want.includes(id)),
    want.filter((id) => id !== 's-gj-bomunho'),
  );
  const museum = day.items.find((i) => i.spotId === 's-gj-museum');
  assert.equal(museum?.stayMin, 45);
  const bulguksa = day.items.find((i) => i.spotId === 's-gj-bulguksa');
  assert.ok(bulguksa && bulguksa.arrive >= '15:30');
  assert.equal(placedDateOf(p)['s-gj-bomunho'], '2026-10-19');
  // 재계산이 편집을 되돌리지 않는다: 문서 값 자체가 남아 있다
  const museumSpot = t.spots.find((s) => s.id === 's-gj-museum');
  assert.equal(museumSpot?.stayMin, 45);
  assert.equal(t.spots.find((s) => s.id === 's-gj-bulguksa')?.arriveOverride, '15:30');
});

test('두 편집이 충돌하면 op.at이 늦은 쪽이 남는다(도착 순서와 무관)', () => {
  const a = { type: 'schedule/setStay' as const, spotId: 's-gj-museum', stayMin: 30 };
  const b = { type: 'schedule/setStay' as const, spotId: 's-gj-museum', stayMin: 120 };
  const t1 = apply(apply(scenarioTrip(), a, T), b, T + 10);
  const t2 = apply(apply(scenarioTrip(), b, T + 10), a, T);
  const stay = (t: Trip) => t.spots.find((s) => s.id === 's-gj-museum')?.stayMin;
  assert.equal(stay(t1), 120);
  assert.equal(stay(t2), 120);
  assert.equal(t2.spots.find((s) => s.id === 's-gj-museum')?.edited.stayMin, T + 10);
});

test('구간 수단도 나중 저장 우선: op.at 역순으로 접어도 늦은 쪽이 남고, 늦은 해제는 이른 지정을 이긴다', () => {
  const leg = { date: '2026-10-18', fromId: 's-gj-bulguksa', toId: 's-gj-seokguram' };
  const walk = { type: 'schedule/setLegTransport' as const, ...leg, transport: 'walk' as const };
  const transit = { type: 'schedule/setLegTransport' as const, ...leg, transport: 'transit' as const };
  const clear = { type: 'schedule/setLegTransport' as const, ...leg, transport: null };
  const live = (t: Trip) => liveLegs(t.legs).map((l) => l.transport);
  // 늦게 저장한 walk(at +200)가 먼저 접히고, 이르게 저장한 transit(at +100)이 나중에 접혀도 walk가 남는다
  assert.deepEqual(live(apply(apply(scenarioTrip(), walk, T + 200), transit, T + 100)), ['walk']);
  assert.deepEqual(live(apply(apply(scenarioTrip(), transit, T + 100), walk, T + 200)), ['walk']);
  // 해제(at +300)가 먼저 접히고 예전 지정(at +100)이 늦게 도착해도 해제가 남는다(묘비)
  const t1 = apply(apply(scenarioTrip(), clear, T + 300), transit, T + 100);
  assert.deepEqual(live(t1), []);
  assert.equal(t1.legs.length, 1, '같은 구간은 항목 하나(묘비)');
  // 해제보다 늦은 지정은 이긴다
  assert.deepEqual(live(apply(t1, walk, T + 400)), ['walk']);
  // 같은 조건에서 setStay도 at이 늦은 쪽이 남는다(같은 규칙)
  const a = { type: 'schedule/setStay' as const, spotId: 's-gj-museum', stayMin: 30 };
  const b = { type: 'schedule/setStay' as const, spotId: 's-gj-museum', stayMin: 100 };
  assert.equal(apply(apply(scenarioTrip(), a, T + 200), b, T + 100).spots.find((x) => x.id === 's-gj-museum')?.stayMin, 30);
});

test('setDate를 다른 날로 바꾸면 이전 날의 수동 순서를 풀고, null이면 지정을 푼다', () => {
  let t = apply(scenarioTrip(), { type: 'schedule/reorder', date: '2026-10-18', spotIds: ['s-gj-museum'] }, T);
  t = apply(t, { type: 'schedule/setDate', spotId: 's-gj-museum', date: '2026-10-19' }, T + 1);
  const s = t.spots.find((x) => x.id === 's-gj-museum');
  assert.equal(s?.fixedDate, '2026-10-19');
  assert.equal(s?.manualOrder, undefined);
  t = apply(t, { type: 'schedule/setDate', spotId: 's-gj-museum', date: null }, T + 2);
  assert.equal(t.spots.find((x) => x.id === 's-gj-museum')?.fixedDate, undefined);
});

test('validate: 기간 밖 날짜, 없는 스팟, 체류 범위, 도착 형식을 거부한다', () => {
  const t = scenarioTrip();
  assert.ok(validate(t, op({ type: 'schedule/setDate', spotId: 's-gj-museum', date: '2026-11-01' }, T)));
  assert.ok(validate(t, op({ type: 'schedule/setStay', spotId: 'nope', stayMin: 30 }, T)));
  assert.ok(validate(t, op({ type: 'schedule/setStay', spotId: 's-gj-museum', stayMin: 0 }, T)));
  assert.ok(validate(t, op({ type: 'schedule/setArrive', spotId: 's-gj-museum', arrive: '9시' }, T)));
  assert.ok(validate(t, op({ type: 'schedule/reorder', date: '2026-10-18', spotIds: ['s-gj-museum', 's-gj-museum'] }, T)));
  assert.equal(validate(t, op({ type: 'schedule/setArrive', spotId: 's-gj-museum', arrive: '10:30' }, T)), null);
});

test('수용량 초과 조정안: 체류 줄이기 → 다음 날로 옮기기 → 빼기, 숫자와 초안(OpDraft)', async () => {
  let t = scenarioTrip();
  // 10/18 스팟에 날짜를 지정하면(고정 취급) 자동 제외되지 않으므로, 체류를 늘리면 초과가 된다.
  // 수동 순서는 고정 취급이 아니다(04 코드 리뷰): 순서만 바꾼 날은 넘치면 FR-403 순서로 제외된다
  const base = await buildPlan(t, { routes: routes(), now: 0 });
  const ids = base.days.find((d) => d.date === '2026-10-18')?.items.map((i) => i.spotId) ?? [];
  ids.forEach((id, i) => {
    t = apply(t, { type: 'schedule/setDate', spotId: id, date: '2026-10-18' }, T - 20 + i);
  });
  t = apply(t, { type: 'schedule/setStay', spotId: 's-gj-gyochon-hanjeongsik', stayMin: 180 }, T);
  const p = await buildPlan(t, { routes: routes(), now: 0 });
  const day = p.days.find((d) => d.date === '2026-10-18');
  assert.ok(day && day.overMin > 0, '고정 취급 스팟만으로 초과');
  assert.ok(p.overCapacity.some((o) => o.date === '2026-10-18'));
  assert.match(overflowText(day), /넘습니다$/);
  const adj = overflowAdjustments(t, p, '2026-10-18');
  const kinds = adj.map((a) => a.kind);
  assert.equal(kinds[0], 'shortenStay');
  assert.ok(kinds.includes('exclude'));
  assert.ok(kinds.indexOf('shortenStay') < kinds.indexOf('exclude'));
  for (const a of adj) {
    assert.ok(a.savedMin > 0, a.label);
    assert.ok(a.ops.length > 0);
  }
  // 빼기 조정안은 고정 스팟을 고르지 않는다
  const ex = adj.find((a) => a.kind === 'exclude');
  const exOp = ex?.ops[0];
  assert.ok(exOp && exOp.type === 'spot/remove' && exOp.spotId !== 's-gj-gyochon-hanjeongsik');
  // 체류 줄이기 초안을 patchSpot으로 적용하면 초과가 줄어든다
  const stay = adj.find((a) => a.kind === 'shortenStay');
  const stayOp = stay?.ops[0];
  assert.ok(stayOp && stayOp.type === 'schedule/setStay');
  const after = await buildPlan(apply(t, stayOp, T + 5), { routes: routes(), now: 0 });
  const day2 = after.days.find((d) => d.date === '2026-10-18');
  assert.ok(day2 && day2.overMin < day.overMin);
});

test('previewOps는 문서를 바꾸지 않고 바뀔 결과만 알려준다', async () => {
  const t = scenarioTrip();
  const snapshot = JSON.stringify(t);
  const base = await buildPlan(t, { routes: routes(), now: 0 });
  const drafts: OpDraft[] = [{ type: 'schedule/setStay', spotId: 's-gj-bulguksa', stayMin: 240 }];
  const diff = await previewOps(t, base, drafts, { routes: routes(), now: 0 });
  assert.equal(JSON.stringify(t), snapshot);
  assert.ok(diff.newlyExcluded.length > 0, '체류를 늘리면 제외가 생긴다');
  const d18 = diff.dayDelta.find((d) => d.date === '2026-10-18');
  assert.ok(d18);
  // 가상 문서는 원래보다 늦은 at으로 이긴다
  const virt = applyDrafts(t, drafts, 0);
  assert.equal(virt.spots.find((s) => s.id === 's-gj-bulguksa')?.stayMin, 240);
});
