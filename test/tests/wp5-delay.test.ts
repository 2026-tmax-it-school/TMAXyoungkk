import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type { Adjustment, LatLng } from '../src/types';
import { DEFAULT_NOTIFY_PREFS, DELAY_THRESHOLD_MIN } from '../src/core/constants';
import { initialTracker, manualArrive } from '../src/core/live/arrival';
import type { LiveDay } from '../src/core/live/context';
import {
  delayMinutes,
  evaluateTiming,
  isDelayed,
  PROPOSAL_KEEP,
  PROPOSAL_TITLE,
  proposalLead,
  proposeForDelay,
} from '../src/core/live/delay';
import { acknowledgeDelay, evaluateAt, initialEngine, type EngineState } from '../src/core/live/engine';
import { SIM_PRESETS } from '../src/core/sim/presets';
import { offsetCoord } from '../src/core/sim/track';
import { atKst } from '../src/core/util';

/**
 * FR-603 지연 감지(WP5). ETA가 15분 이상 늦으면 조정안, 14분이면 없음. 알림은 공유 core/notify(30분 1회, 끄기).
 * 조정안 내용(replanForDelay)은 WP4 몫이라 여기서는 주입한 가짜로 본다(적용 결과는 integration-cross).
 */

const A: LatLng = { latitude: 35.7901, longitude: 129.332 };
const B: LatLng = offsetCoord(A, 0, 2000);
const DAY0 = atKst('2026-10-18', '00:00');
const at = (hhmm: string) => atKst('2026-10-18', hhmm);

const day: LiveDay = {
  tripId: 't1',
  date: '2026-10-18',
  dayStartMs: DAY0,
  startMin: 540,
  base: offsetCoord(A, -3000, 0),
  items: [
    // 불국사 09:25–10:55, 석굴암 11:07 도착(이동 12분)
    { spotId: 'a', name: '불국사', coord: A, arriveMin: 565, departMin: 655, travelMin: 25, transport: 'car' },
    { spotId: 'b', name: '석굴암', coord: B, arriveMin: 667, departMin: 757, travelMin: 12, transport: 'car' },
  ],
};
const ctx = { tripId: 't1', day, prefs: DEFAULT_NOTIFY_PREFS, source: 'sim' as const };

/** 불국사에 도착해 머무는 중인 엔진 상태 */
function atA(): EngineState {
  const st = initialEngine();
  return { ...st, tracker: manualArrive(initialTracker(), day, 'a', at('09:25')).tracker };
}

test('지연 경계는 15분이다(15 조정안, 14 없음)', () => {
  assert.equal(DELAY_THRESHOLD_MIN, 15);
  assert.equal(isDelayed(delayMinutes(667, 682)), true);
  assert.equal(isDelayed(delayMinutes(667, 681)), false);
  assert.equal(delayMinutes(667, 650), 0, '앞서면 0');
});

test('스팟에 머무는 중이면 ETA = max(지금, 예정 출발) + 다음 구간 이동 시간', () => {
  const tr = atA().tracker;
  const early = evaluateTiming(day, tr, at('10:30'));
  assert.equal(early?.etaMin, 667, '예정 출발 전이면 지연이 아니다');
  const late = evaluateTiming(day, tr, at('11:10'));
  assert.equal(late?.phase, 'atSpot');
  assert.equal(late?.delayMin, 15);
});

test('ETA가 15분 늦으면 조정안 효과가 나오고 14분이면 없다', () => {
  const none = evaluateAt(atA(), at('11:09'), ctx);
  assert.equal(none.effects.length, 0);
  const r = evaluateAt(atA(), at('11:10'), ctx);
  const d = r.effects.find((e) => e.kind === 'delay');
  assert.ok(d && d.kind === 'delay');
  assert.equal(d.spotId, 'b');
  assert.equal(d.delayMin, 15);
});

test('proposeForDelay는 15분 이상일 때만 조정안 생성 함수를 부른다', async () => {
  const fake: Adjustment = { id: 'adj1', kind: 'reorder', label: '순서 바꾸기', savedMin: 15, ops: [] };
  let calls = 0;
  const make = async () => {
    calls += 1;
    return [fake];
  };
  assert.equal(await proposeForDelay(14, make), null);
  assert.equal(calls, 0);
  assert.deepEqual(await proposeForDelay(15, make), [fake]);
  assert.equal(calls, 1);
});

test('같은 상황의 조정안은 30분에 1회다(공유 notify)', () => {
  let st = atA();
  const r1 = evaluateAt(st, at('11:10'), ctx);
  st = r1.state;
  assert.equal(r1.effects.filter((e) => e.kind === 'delay').length, 1);
  // 29분 뒤에는 지연이 더 커져도 다시 알리지 않는다
  const r2 = evaluateAt(st, at('11:39'), ctx);
  assert.equal(r2.effects.filter((e) => e.kind === 'delay').length, 0);
  // 30분 뒤에는 다시 알린다(ack가 없으므로)
  const r3 = evaluateAt(r2.state, at('11:40'), ctx);
  assert.equal(r3.effects.filter((e) => e.kind === 'delay').length, 1);
});

test('notifyPrefs.delay가 꺼져 있으면 조정안을 내지 않는다', () => {
  const r = evaluateAt(atA(), at('11:30'), { ...ctx, prefs: { ...DEFAULT_NOTIFY_PREFS, delay: false } });
  assert.equal(r.effects.filter((e) => e.kind === 'delay').length, 0);
});

test('거절(또는 적용)한 지연으로는 다시 묻지 않고, 15분 더 늘어나야 다시 묻는다', () => {
  const r1 = evaluateAt(atA(), at('11:10'), ctx);
  const acked = acknowledgeDelay(r1.state, 15);
  // 30분 뒤 지연 44분: 알린 15분보다 29분 더 → 다시 묻는다
  const again = evaluateAt(acked, at('11:40'), ctx);
  assert.equal(again.effects.filter((e) => e.kind === 'delay').length, 1);
  // 알린 지연이 40분이면 45분 지연은 5분 더 늘어난 것이라 묻지 않는다
  const acked40 = acknowledgeDelay(r1.state, 40);
  const quiet = evaluateAt(acked40, at('11:40'), ctx);
  assert.equal(quiet.effects.filter((e) => e.kind === 'delay').length, 0);
  // 거절은 op를 만들지 않는다: 엔진 상태만 바뀌고 day(일정)는 그대로다
  assert.deepEqual(day.items.map((i) => i.arriveMin), [565, 667]);
});

test('따라잡으면 알린 지연도 줄어든다', () => {
  const st = acknowledgeDelay(atA(), 30);
  // 예정 출발 전이면 지연 0 → ack도 0으로
  const r = evaluateAt(st, at('10:40'), ctx);
  assert.equal(r.state.ackDelayMin, 0);
});

test('조정안 문구에 경고 문구가 없다', () => {
  const texts = [PROPOSAL_TITLE, PROPOSAL_KEEP, proposalLead('석굴암', '11:32', '11:07', 25), ...SIM_PRESETS.map((p) => p.text)];
  assert.equal(PROPOSAL_TITLE, '뒤 일정을 이렇게 바꿀까요');
  for (const t of texts) assert.doesNotMatch(t, /늦었습니다|지연되었습니다|서두르세요/);
  // WP5 화면·기능 파일 전체
  const roots = ['src/core/live', 'src/core/sim', 'src/features/live', 'src/components/map'];
  const files = ['src/screens/LiveTripScreen.tsx', 'src/screens/NavigateScreen.tsx', 'src/screens/MapScreen.tsx', 'src/store/live.ts'];
  const walk = (d: string) => {
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  roots.forEach(walk);
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /늦었습니다|지연되었습니다|서두르세요/, f);
});

/* ---------- 리뷰 반영(04 코드리뷰) ---------- */

test('지연은 내림이다: 14.9분은 14분이라 조정안이 없고, 15.0분은 15분이다', () => {
  assert.equal(delayMinutes(667, 667 + 14.9), 14);
  assert.equal(isDelayed(delayMinutes(667, 667 + 14.9)), false);
  assert.equal(delayMinutes(667, 667 + 15), 15);
  assert.equal(delayMinutes(667, 667 + 14.9999999), 15, '부동소수 오차는 경계를 놓치지 않는다');
});

test('다음 스팟이 바뀌어도 30분 안에는 두 번째 조정안이 없다(동일 유형 30분 1회)', () => {
  const three: LiveDay = {
    ...day,
    items: [
      day.items[0],
      { ...day.items[1], departMin: 680 },
      { spotId: 'c', name: '교촌마을 한정식', coord: offsetCoord(A, 0, 4000), arriveMin: 700, departMin: 760, travelMin: 20, transport: 'car' },
    ],
  };
  const c3 = { ...ctx, day: three };
  const st0 = { ...initialEngine(), tracker: manualArrive(initialTracker(), three, 'a', at('09:25')).tracker };
  const r1 = evaluateAt(st0, at('11:10'), c3);
  const first = r1.effects.find((e) => e.kind === 'delay');
  assert.ok(first && first.kind === 'delay' && first.spotId === 'b');
  // 석굴암에 도착해 이제 다음 스팟은 교촌마을 한정식이다. 26분 뒤 16분 늦어도 묻지 않는다
  const atB = { ...acknowledgeDelay(r1.state, 0), ackDelayMin: 0, tracker: manualArrive(r1.state.tracker, three, 'b', at('11:25')).tracker };
  const quiet = evaluateAt(atB, at('11:36'), c3);
  assert.equal(quiet.state.timing?.spotId, 'c');
  assert.equal(quiet.state.timing?.delayMin, 16);
  assert.equal(quiet.effects.filter((e) => e.kind === 'delay').length, 0);
  // 첫 조정안에서 30분이 지나면 다시 묻는다
  const later = evaluateAt(quiet.state, at('11:41'), c3);
  const second = later.effects.find((e) => e.kind === 'delay');
  assert.ok(second && second.kind === 'delay' && second.spotId === 'c');
});
