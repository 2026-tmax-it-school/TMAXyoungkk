import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DayPlan, LegOverride, Op, OpDraft, Plan, PlanStep, Trip } from '../src/types';
import { liveLegs, reduce } from '../src/core/ops/schedule';
import { buildPlan } from '../src/core/planner';
import {
  canPinArrive,
  dayTransportDrafts,
  editOrder,
  initialScheduleDate,
  inverseDrafts,
  legDrafts,
  legIndexes,
  legPositionText,
  moveInOrder,
  stepArrive,
  stepStay,
} from '../src/features/schedule/edit';
import {
  deltaChip,
  newlyExcludedLines,
  overflowCause,
  planningProgress,
  planningStepRows,
  previewSentence,
  SELECTION_RULES,
} from '../src/features/schedule/view';
import { createRouteProvider } from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV } from './helpers/fakes';
import { scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * 08·10·12 화면의 순수 도우미(features/schedule/edit.ts, view.ts). 화면 파일에는 그리기와 dispatch만 남긴다.
 */

let n = 0;
const op = (draft: OpDraft, at: number): Op => ({ ...draft, id: `sc${(n += 1)}`, tripId: 'trip-scenario', actorId: 'm-minji', at });
const T = SCENARIO_T0 + 3_600_000;

function applyAll(trip: Trip, drafts: readonly OpDraft[], at: number): Trip {
  return drafts.reduce((t, d, i) => reduce(t, op(d, at + i)), trip);
}

const pick = (t: Trip) =>
  t.spots.map((s) => ({ id: s.id, stay: s.stayMin, arrive: s.arriveOverride, fixed: s.fixedDate, manual: s.manualOrder }));

test('moveInOrder는 한 칸씩만 옮기고 끝에서는 그대로다', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
});

test('stepStay는 15분씩 바꾸고 리듀서 범위(5~600분)를 넘지 않는다', () => {
  assert.equal(stepStay(90, -1), 75);
  assert.equal(stepStay(90, 1), 105);
  assert.equal(stepStay(10, -1), 5);
  assert.equal(stepStay(595, 1), 600);
});

test('되돌리기: 역 초안을 적용하면 체류·도착·날짜·수동 순서가 적용 전 값으로 돌아온다', () => {
  let t = scenarioTrip();
  // 먼저 10/18 수동 순서가 있는 상태를 만든다
  t = applyAll(t, [{ type: 'schedule/reorder', date: '2026-10-18', spotIds: ['s-gj-bulguksa', 's-gj-seokguram'] }], T);
  const before = pick(t);
  const drafts: OpDraft[] = [
    { type: 'schedule/setStay', spotId: 's-gj-museum', stayMin: 45 },
    { type: 'schedule/setArrive', spotId: 's-gj-bulguksa', arrive: '15:30' },
    { type: 'schedule/setDate', spotId: 's-gj-bulguksa', date: '2026-10-19' },
    { type: 'schedule/reorder', date: '2026-10-18', spotIds: ['s-gj-seokguram', 's-gj-museum'] },
  ];
  const inverse = inverseDrafts(t, drafts);
  assert.ok(inverse);
  const edited = applyAll(t, drafts, T + 10);
  assert.notDeepEqual(pick(edited), before);
  const restored = applyAll(edited, inverse, T + 100);
  assert.deepEqual(pick(restored), before);
});

test('되돌리기: 이동수단 초안의 역은 이전 구간·날짜 수단이다', () => {
  let t = scenarioTrip();
  t = applyAll(t, [{ type: 'schedule/setLegTransport', date: '2026-10-18', fromId: 'base', toId: 's-gj-bulguksa', transport: 'walk' }], T);
  const drafts = dayTransportDrafts(t, '2026-10-18', 'transit');
  // 하루 전체 적용은 날짜 수단을 바꾸고 그날 구간 지정을 푼다
  assert.deepEqual(drafts, [
    { type: 'schedule/setDayTransport', date: '2026-10-18', transport: 'transit' },
    { type: 'schedule/setLegTransport', date: '2026-10-18', fromId: 'base', toId: 's-gj-bulguksa', transport: null },
  ]);
  const inverse = inverseDrafts(t, drafts);
  assert.ok(inverse);
  const edited = applyAll(t, drafts, T + 10);
  assert.equal(liveLegs(edited.legs).length, 0);
  const restored = applyAll(edited, inverse, T + 100);
  const plain = (legs: LegOverride[]) => liveLegs(legs).map(({ date, fromId, toId, transport }) => ({ date, fromId, toId, transport }));
  assert.deepEqual(plain(restored.legs), plain(t.legs));
  assert.equal(restored.days.find((d) => d.date === '2026-10-18')?.transport, undefined);
});

test('stepArrive는 15분씩 바꾸고 00:00~23:45 안이다, 자정 뒤 계산 시각은 지정할 수 없다', () => {
  assert.equal(stepArrive('11:07', 1), '11:22');
  assert.equal(stepArrive('11:07', -1), '10:52');
  assert.equal(stepArrive('00:10', -1), '00:00');
  assert.equal(stepArrive('23:40', 1), '23:45');
  assert.equal(canPinArrive('23:59'), true);
  assert.equal(canPinArrive('24:10'), false);
});

test('계획이 낡아도(디바운스·오프라인) 10의 편집 기준은 문서 값이라 두 번 누르면 두 번 적용된다', async () => {
  const routes = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
  let t = scenarioTrip();
  const plan = await buildPlan(t, { routes, now: 0 });
  const day = plan.days.find((d) => d.date === '2026-10-18');
  assert.ok(day);
  const last = day.items[day.items.length - 1].spotId;
  // 순서: 마지막 스팟을 앞으로 두 번. 계획(day)은 그대로 두고 문서만 바뀐다
  for (let k = 0; k < 2; k += 1) {
    const ids = editOrder(t, day);
    t = applyAll(t, [{ type: 'schedule/reorder', date: day.date, spotIds: moveInOrder(ids, ids.indexOf(last), -1) }], T + k * 10);
  }
  const ids = editOrder(t, day);
  assert.equal(ids.indexOf(last), day.items.length - 3, '두 칸 움직였다');
  assert.deepEqual([...ids].sort(), day.items.map((i) => i.spotId).sort());
  // 체류: 문서 값에서 두 번 15분씩
  const id = day.items[0].spotId;
  const before = t.spots.find((s) => s.id === id)?.stayMin ?? 0;
  for (let k = 0; k < 2; k += 1) {
    const cur = t.spots.find((s) => s.id === id)?.stayMin ?? 0;
    t = applyAll(t, [{ type: 'schedule/setStay', spotId: id, stayMin: stepStay(cur, 1) }], T + 100 + k);
  }
  assert.equal(t.spots.find((s) => s.id === id)?.stayMin, before + 30);
});

test('12 이 구간만 초안은 그날 지금 순서를 수동 순서로 굳히고 구간 수단을 보낸다', async () => {
  const routes = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
  const t = scenarioTrip();
  const plan = await buildPlan(t, { routes, now: 0 });
  const day = plan.days.find((d) => d.date === '2026-10-18');
  assert.ok(day);
  const drafts = legDrafts(t, day, 's-gj-bulguksa', 's-gj-seokguram', 'walk');
  assert.deepEqual(drafts, [
    { type: 'schedule/reorder', date: day.date, spotIds: day.items.map((i) => i.spotId) },
    { type: 'schedule/setLegTransport', date: day.date, fromId: 's-gj-bulguksa', toId: 's-gj-seokguram', transport: 'walk' },
  ]);
  // 되돌리기는 수동 순서를 풀고 구간 지정도 푼다
  const inverse = inverseDrafts(t, drafts);
  assert.ok(inverse);
  const restored = applyAll(applyAll(t, drafts, T), inverse, T + 100);
  assert.equal(liveLegs(restored.legs).length, 0);
  assert.ok(restored.spots.every((s) => !s.manualOrder));
});

test('10 편집 뒤 새로 자동 제외된 스팟은 이유와 함께 알린다(사용자가 뺀 것은 알리지 않는다)', () => {
  const plan = {
    excluded: [
      { spotId: 'a', name: '동궁과 월지', reasonCode: 'dayFull', reason: '10/18 저녁이 꽉 차서', proposerCount: 1 },
      { spotId: 'b', name: '감은사지', reasonCode: 'tooFar', reason: '왕복 1시간 10분', proposerCount: 1 },
      { spotId: 'c', name: '보문호', reasonCode: 'userRemoved', reason: '사용자가 직접 뺌', proposerCount: 1 },
    ],
  } as unknown as Plan;
  assert.deepEqual(newlyExcludedLines(['b'], plan), ['동궁과 월지가 제외 스팟이 됐습니다 · 10/18 저녁이 꽉 차서']);
  assert.deepEqual(newlyExcludedLines(['a', 'b'], plan), []);
});

test('선별 규칙과 초과 문장은 고정·날짜 지정만 빠지지 않는다는 실제 동작과 같다', () => {
  assert.ok(SELECTION_RULES.some((r) => r.includes('제외 스팟에는 이유를 붙입니다')));
  assert.ok(SELECTION_RULES.some((r) => r.includes('순서만 바꾼 곳은 넘치면 같은 규칙으로 빠집니다')));
  assert.equal(overflowCause(30), '고정하거나 날짜를 지정한 곳만으로 활동시간을 30분 넘깁니다');
});

test('되돌리기: 고정은 이전 값으로, 빼기는 되돌릴 수 없어 null', () => {
  const t = scenarioTrip();
  const s = t.spots[0];
  assert.deepEqual(inverseDrafts(t, [{ type: 'spot/pin', spotId: s.id, pinned: !s.pinned }]), [
    { type: 'spot/pin', spotId: s.id, pinned: s.pinned },
  ]);
  assert.equal(inverseDrafts(t, [{ type: 'spot/remove', spotId: s.id, reason: 'user' }]), null);
});

function dayOf(p: Partial<DayPlan>): DayPlan {
  return {
    date: '2026-10-18',
    base: { name: '기점', coord: { latitude: 35.8, longitude: 129.2 } },
    baseSource: 'set',
    noReturn: false,
    startMin: 540,
    endLimitMin: 1260,
    items: [1, 2, 3].map((i) => ({
      spotId: `s${i}`,
      name: `스팟${i}`,
      travelMin: 10,
      legTransport: 'car',
      legEstimated: false,
      arrive: '10:00',
      depart: '11:00',
      stayMin: 60,
      pinned: false,
      proposerCount: 1,
      manual: false,
      notices: [],
    })),
    returnMin: 10,
    usedMin: 200,
    capacityMin: 720,
    overMin: 0,
    carryOver: [],
    orderMethod: 'exact',
    ...p,
  };
}

test('legIndexes: 기점 있으면 0과 복귀, 기점 없는 날은 0이 없고, 복귀 없음 날은 복귀가 없다', () => {
  assert.deepEqual(legIndexes(dayOf({})), [0, 1, 2, 3]);
  assert.equal(legPositionText(dayOf({}), 1), '구간 2 / 4');
  assert.deepEqual(legIndexes(dayOf({ baseSource: 'firstSpot', base: null })), [1, 2]);
  assert.deepEqual(legIndexes(dayOf({ noReturn: true })), [0, 1, 2]);
  assert.deepEqual(legIndexes(dayOf({ items: [] })), []);
});

test('initialScheduleDate: 요청 날짜 → 오늘(기간 안) → 첫날', () => {
  const trip = { startDate: '2026-10-17', endDate: '2026-10-19' };
  const oct18 = Date.parse('2026-10-18T03:00:00Z'); // KST 12:00
  assert.equal(initialScheduleDate(trip, oct18, '2026-10-19'), '2026-10-19');
  assert.equal(initialScheduleDate(trip, oct18), '2026-10-18');
  assert.equal(initialScheduleDate(trip, oct18, '2026-12-01'), '2026-10-18');
  assert.equal(initialScheduleDate(trip, Date.parse('2026-09-01T00:00:00Z')), '2026-10-17');
});

test('08 단계 행은 받은 onStep만으로 만든다(가짜 진행률 없음)', () => {
  const none = planningStepRows([], true, 14, true);
  assert.deepEqual(
    none.map((r) => r.state),
    ['wait', 'wait', 'wait', 'wait'],
  );
  assert.equal(planningProgress(none, []), 0);
  const steps: PlanStep[] = [
    { key: 'locate', label: '위치 확인', done: 14, total: 14, ms: 400 },
    { key: 'matrix', label: '이동시간 조회', done: 60, total: 60, ms: 1100 },
    { key: 'allocate', label: '배치 11/14', done: 11, total: 14, ms: 0 },
  ];
  const rows = planningStepRows(steps, true, 14, true);
  assert.deepEqual(
    rows.map((r) => r.state),
    ['done', 'done', 'active', 'wait'],
  );
  assert.equal(rows[0].label, '후보 14곳 위치 확인');
  assert.equal(rows[0].time, '0.4초');
  assert.equal(rows[2].count, '11 / 14');
  const v = planningProgress(rows, steps);
  assert.ok(Math.abs(v - (2 + 11 / 14) / 4) < 1e-9);
  // 끝나면 받은 단계는 전부 done
  assert.ok(planningStepRows([...steps, { key: 'reasons', label: '', done: 3, total: 3, ms: 0 }], false, 14, true).every((r) => r.state === 'done'));
});

test('08 이동시간 조회가 진행 중이면 끝난 구간 수가 보이고 진행 막대에도 들어간다(대기 중 0구간으로 멈춰 보이지 않게)', () => {
  const steps: PlanStep[] = [
    { key: 'locate', label: '위치 확인', done: 14, total: 14, ms: 400 },
    { key: 'matrix', label: '이동시간 조회', done: 37, total: 100, ms: 0 },
  ];
  const rows = planningStepRows(steps, true, 14, true);
  assert.equal(rows[1].state, 'active');
  assert.equal(rows[1].count, '37 / 100구간');
  assert.ok(Math.abs(planningProgress(rows, steps) - (1 + 0.37) / 4) < 1e-9);
  const done = planningStepRows([{ ...steps[0] }, { ...steps[1], done: 100, ms: 1200 }, { key: 'allocate', label: '', done: 14, total: 14, ms: 0 }], true, 14, true);
  assert.equal(done[1].count, '100구간', '끝난 단계는 전처럼 구간 수만');
});

test('12 차이 칩: 느리면 +분 warn, 빠르면 ok, 경로 없으면 없음', () => {
  assert.deepEqual(deltaChip(58), { text: '+58분', tone: 'warn' });
  assert.deepEqual(deltaChip(-5), { text: '-5분', tone: 'ok' });
  assert.equal(deltaChip(null), undefined);
});

test('12 미리보기 문장: 도보로 바꾸면 늘어나는 시간과 새로 빠지는 스팟을 적는다', async () => {
  const routes = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
  const trip = scenarioTrip();
  const plan = await buildPlan(trip, { routes, now: 0 });
  const walkTrip = applyAll(trip, dayTransportDrafts(trip, '2026-10-18', 'walk'), T);
  const after = await buildPlan(walkTrip, { routes, now: 0 });
  const { diffPlans } = await import('../src/core/planner/preview');
  const diff = diffPlans(plan, after);
  const text = previewSentence(trip, '2026-10-18', 'walk', diff);
  assert.match(text, /^도보로 바꾸/);
  if (diff.newlyExcluded.length > 0) assert.match(text, /제외 스팟이 됩니다/);
  assert.doesNotMatch(text, /늦었습니다|지연되었습니다|서두르세요/);
});
