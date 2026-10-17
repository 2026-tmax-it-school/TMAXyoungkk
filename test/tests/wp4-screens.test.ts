import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Adjustment, DayPlan, LegOverride, Op, OpDraft, Plan, PlanDiff, PlanStep, Trip } from '../src/types';
import { liveLegs, reduce } from '../src/core/ops/schedule';
import { buildPlan } from '../src/core/planner';
import { josa, toHHMM } from '../src/core/util';
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
  adjustmentToast,
  arrivePinText,
  dayFill,
  daySummary,
  dayTransport,
  deltaChip,
  editHeaderSub,
  editOrderLabel,
  editOverflow,
  editToast,
  excludeTarget,
  legAppliedToast,
  legApplyLabels,
  legPreviewChips,
  newlyExcludedLines,
  overflowCause,
  planMeta,
  planningProgress,
  planningStepRows,
  previewSentence,
  scheduleOverflowText,
  SELECTION_RULES,
  stepRowA11y,
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

/* ---------- 일정 탭 UX 정리(09 요약 줄·10 상태 자리·12 미리보기 표) ---------- */

test('dayTransport: 날짜 설정 수단이 있으면 그것, 없으면 여행방 기본 수단(구간 지정은 보지 않는다)', () => {
  let t = scenarioTrip();
  const base = t.transport;
  const other = base === 'walk' ? 'transit' : 'walk';
  assert.equal(dayTransport(t, '2026-10-18'), base);
  assert.equal(dayTransport(t), base, '날짜가 없으면 기본 수단');
  t = applyAll(
    t,
    [
      { type: 'schedule/setDayTransport', date: '2026-10-18', transport: other },
      { type: 'schedule/setLegTransport', date: '2026-10-19', fromId: 'base', toId: 's-gj-bulguksa', transport: other },
    ],
    T,
  );
  assert.equal(dayTransport(t, '2026-10-18'), other);
  assert.equal(dayTransport(t, '2026-10-19'), base, '구간 지정만 있는 날은 기본 수단');
});

test('dayFill: 쓴 몫(0~1)과 막대 옆 한 줄. 넘치면 가득 차고 넘친 시간을 적는다', () => {
  assert.deepEqual(dayFill({ usedMin: 360, capacityMin: 720, overMin: 0 }), { value: 0.5, over: false, text: '6시간 남아요' });
  assert.deepEqual(dayFill({ usedMin: 720, capacityMin: 720, overMin: 0 }), { value: 1, over: false, text: '꽉 찼어요' });
  assert.deepEqual(dayFill({ usedMin: 800, capacityMin: 720, overMin: 80 }), { value: 1, over: true, text: '1시간 20분 넘어요' });
  assert.equal(dayFill({ usedMin: 0, capacityMin: 0, overMin: 0 }).value, 0, '수용량 0이면 0으로 나누지 않는다');
});

test('09 요약 줄은 곳 수와 시작–끝 시각만 적는다(넘친 시간은 채움 막대와 WarnCard가 말한다)', () => {
  const items = new Array(4).fill({}) as DayPlan['items'];
  assert.equal(daySummary({ items, startMin: 9 * 60, usedMin: 317 }), '4곳 · 09:00–14:17');
  // 넘친 날도 꼬리를 붙이지 않아 360px 한 줄에서 끝 시각이 잘리지 않는다
  assert.equal(daySummary({ items, startMin: 9 * 60, usedMin: 13 * 60 + 30 }), '4곳 · 09:00–22:30');
  assert.equal(daySummary({ items: [], startMin: 9 * 60, usedMin: 0 }), '확정 스팟 없음');
});

test('09 초과 WarnCard 문장은 ~요 톤이고 제목의 넘친 시간을 되풀이하지 않는다', () => {
  const text = scheduleOverflowText();
  assert.match(text, /요\.$/);
  assert.doesNotMatch(text, /니다/);
  assert.doesNotMatch(text, /\d/, '시간은 제목(활동시간을 1시간 넘어요)에만 있다');
});

test('10 도착 시각 링크는 계산된 도착 시각을 그대로 한 번에 지정한다', () => {
  assert.equal(arrivePinText('14:17'), '14:17 그대로 지정');
});

test('legPreviewChips: 시간 차이 → 초과 → 빠지는 곳 → 돌아오는 곳, 그대로면 그대로라고 적는다', () => {
  const trip = scenarioTrip();
  const [a, b] = trip.spots;
  const slower: PlanDiff = { newlyExcluded: [a.id], newlyConfirmed: [], dayDelta: [{ date: '2026-10-18', usedMinDelta: 58, overMin: 20 }] };
  assert.deepEqual(legPreviewChips(trip, '2026-10-18', slower), [
    { text: '+58분', tone: 'warn' },
    { text: '활동시간 20분 넘어요', tone: 'warn' },
    { text: `${a.name} 빠져요`, tone: 'warn' },
  ]);
  const faster: PlanDiff = { newlyExcluded: [], newlyConfirmed: [a.id, b.id], dayDelta: [{ date: '2026-10-18', usedMinDelta: -5, overMin: 0 }] };
  assert.deepEqual(legPreviewChips(trip, '2026-10-18', faster), [
    { text: '-5분', tone: 'ok' },
    { text: '2곳 돌아와요', tone: 'ok' },
  ]);
  const same: PlanDiff = { newlyExcluded: [], newlyConfirmed: [], dayDelta: [] };
  assert.deepEqual(legPreviewChips(trip, '2026-10-18', same), [
    { text: '시간 그대로', tone: 'soft' },
    { text: '확정·제외 그대로', tone: 'line' },
  ]);
});

test('planMeta: 경로 조회 건수 줄의 수단은 그날 수단이고 활동시간은 그날 계획 값이다', async () => {
  const routes = createRouteProvider({ fetch: fakeFetch(), clock: fixedClock(SCENARIO_T0), kv: memoryKV() });
  let t = scenarioTrip();
  const other = t.transport === 'walk' ? 'transit' : 'walk';
  t = applyAll(t, [{ type: 'schedule/setDayTransport', date: '2026-10-18', transport: other }], T);
  const plan = await buildPlan(t, { routes, now: 0 });
  const LABEL = { car: '자동차', walk: '도보', transit: '대중교통' } as const;
  const d18 = planMeta(t, plan, '2026-10-18');
  assert.match(d18[0], new RegExp(`^경로 조회 \\d+건.* · ${LABEL[other]} 기준$`));
  const day = plan.days.find((d) => d.date === '2026-10-18');
  assert.ok(day);
  assert.ok(d18[1].endsWith(`활동시간 ${toHHMM(day.startMin)}–${toHHMM(day.endLimitMin)}`));
  const d19 = planMeta(t, plan, '2026-10-19');
  assert.ok(d19[0].endsWith(`${LABEL[t.transport]} 기준`), '수단을 바꾸지 않은 날은 여행방 기본 수단');
  assert.deepEqual(planMeta(t, undefined), [], '계획이 없으면 줄이 없다');
});

test('10 머리말 보조 줄·순서 줄·초과 카드 문구', () => {
  const day = dayOf({ usedMin: 317 });
  assert.equal(editHeaderSub('2026-10-18', day, false), '10월 18일 (일) · 3곳 · 5시간 17분');
  assert.equal(editHeaderSub('2026-10-18', day, true), '10월 18일 (일) · 3곳 · 5시간 17분 · 계산 중');
  assert.equal(editOrderLabel(dayOf({ orderMethod: 'manual' })), '순서 · 직접 정함');
  assert.equal(editOrderLabel(dayOf({})), '순서 · 이동 짧은 순');
  const over = editOverflow('2026-10-18', dayOf({ usedMin: 780, overMin: 60 }));
  assert.equal(over.title, '10/18 수용량을 1시간 넘었어요');
  assert.match(over.text, /^이대로 두면 22:00에 끝나 활동시간\(21:00까지\)을 넘어요/);
});

test('10 토스트: 카드가 이 날에서 사라지는 편집(다른 날로 옮기기, 빼기)과 조정안만 한 문장으로 알린다', () => {
  const trip = scenarioTrip();
  const s = trip.spots.find((x) => x.id === 's-gj-bulguksa');
  assert.ok(s);
  assert.equal(
    editToast(trip, '2026-10-18', [{ type: 'schedule/setDate', spotId: s.id, date: '2026-10-19' }]),
    `${josa(s.name, '을/를')} 10/19로 옮겼어요`,
  );
  assert.equal(editToast(trip, '2026-10-18', [{ type: 'schedule/setDate', spotId: s.id, date: null }]), undefined, '자동 날짜는 남을 수 있다');
  assert.equal(editToast(trip, '2026-10-18', [{ type: 'schedule/setDate', spotId: s.id, date: '2026-10-18' }]), undefined);
  assert.equal(editToast(trip, '2026-10-18', [{ type: 'schedule/setStay', spotId: s.id, stayMin: 45 }]), undefined);
  assert.match(editToast(trip, '2026-10-18', [{ type: 'spot/remove', spotId: s.id, reason: 'user' }]) ?? '', /뺐어요/);
  const shorten: Adjustment = {
    id: 'x',
    kind: 'shortenStay',
    label: '대릉원 체류를 60분으로',
    savedMin: 30,
    ops: [{ type: 'schedule/setStay', spotId: s.id, stayMin: 60 }],
  };
  assert.equal(adjustmentToast(trip, '2026-10-18', shorten), '대릉원 체류를 60분으로 줄였어요');
  const exclude: Adjustment = { id: 'y', kind: 'exclude', label: `${s.name} 빼기`, savedMin: 90, ops: [{ type: 'spot/remove', spotId: s.id, reason: 'user' }] };
  assert.equal(excludeTarget(trip, exclude), s.name, '빼기 확인 시트 제목의 이름');
  assert.equal(excludeTarget(trip, shorten), undefined, '빼기가 아니면 확인을 거치지 않는다');
});

test('12 Foot 버튼과 토스트는 고른 수단 이름을 쓴다', () => {
  assert.deepEqual(legApplyLabels('walk'), { leg: '이 구간만 도보로 바꾸기', day: '이날 전체를 도보로' });
  assert.deepEqual(legApplyLabels('transit'), { leg: '이 구간만 대중교통으로 바꾸기', day: '이날 전체를 대중교통으로' });
  assert.equal(legAppliedToast('leg', 'car'), '이 구간을 자동차로 바꿨어요');
  assert.equal(legAppliedToast('day', 'transit'), '이날 전체를 대중교통으로 바꿨어요');
});

test('08 단계 행의 스크린리더 이름은 상태를 말로 읽는다', () => {
  const rows = planningStepRows([{ key: 'locate', label: '', done: 14, total: 14, ms: 400 }], true, 14, true);
  assert.deepEqual(rows.map(stepRowA11y), [
    '후보 14곳 위치 확인, 진행 중',
    '기점에서 이동시간 조회, 대기',
    '하루 수용량에 맞춰 배치, 대기',
    '제외 사유 정리, 대기',
  ]);
  assert.equal(stepRowA11y({ label: '후보 14곳 위치 확인', state: 'done' }), '후보 14곳 위치 확인, 완료');
});
