import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DayPlan, Plan, Visit } from '../src/types';
import { initialTracker } from '../src/core/live/arrival';
import type { LiveDay } from '../src/core/live/context';
import type { Timing } from '../src/core/live/delay';
import { visitId } from '../src/core/live/engine';
import {
  closingMinutes,
  doneSpotIds,
  etaView,
  freshNotifyLog,
  freeTimeLine,
  jumpTargets,
  logLine,
  nextVisitAt,
  photoLine,
  pickLiveDate,
  replanPosition,
  sameLiveDay,
  staleSimVisits,
  statusesFromVisits,
  visitRecord,
} from '../src/core/live/session';
import { atKst, toMin } from '../src/core/util';

/**
 * 여행 진행 세션 도우미(WP5, core/live/session.ts). 스토어(store/live.ts)가 쓰는 판정을 node에서 검증한다.
 * 방문 기록 펴기와 at LWW, 진행 날짜 고르기, 조정안 위치, 시각 점프, 화면 문구(금지 문구 없음).
 */

const DATE = '2026-10-18';
const at = (hhmm: string, date = DATE) => atKst(date, hhmm);

function visit(p: Partial<Visit> & Pick<Visit, 'spotId' | 'status' | 'at'>): Visit {
  return { id: visitId(p.date ?? DATE, p.spotId, p.memberId ?? 'm1'), date: DATE, memberId: 'm1', source: 'sim', ...p };
}

function liveDay(): LiveDay {
  return {
    tripId: 't',
    date: DATE,
    dayStartMs: at('00:00'),
    startMin: toMin('09:00'),
    base: { latitude: 35.84, longitude: 129.21 },
    items: [
      { spotId: 'a', name: '불국사', coord: { latitude: 35.79, longitude: 129.33 }, arriveMin: toMin('09:25'), departMin: toMin('10:55'), travelMin: 25, transport: 'car' },
      { spotId: 'b', name: '석굴암', coord: { latitude: 35.795, longitude: 129.35 }, arriveMin: toMin('11:07'), departMin: toMin('12:37'), travelMin: 12, transport: 'car' },
    ],
  };
}

function timing(p: Partial<Timing>): Timing {
  return {
    nextIdx: 1,
    spotId: 'b',
    name: '석굴암',
    phase: 'moving',
    plannedArriveMin: toMin('11:07'),
    etaMin: toMin('11:07'),
    delayMin: 0,
    gapMin: 0,
    betweenSpots: true,
    ...p,
  };
}

test('방문 기록은 이 날짜·이 멤버의 스팟별 마지막 상태로 편다', () => {
  const trip = {
    visits: [
      visit({ spotId: 'a', status: 'arrived', at: at('09:28') }),
      visit({ spotId: 'a', status: 'cancelled', at: at('09:40') }),
      visit({ spotId: 'b', status: 'skipped', at: at('11:30') }),
      visit({ spotId: 'b', status: 'arrived', at: at('11:30'), memberId: 'm2' }),
      visit({ spotId: 'c', status: 'arrived', at: at('10:00', '2026-10-17'), date: '2026-10-17' }),
    ],
  };
  assert.deepEqual(statusesFromVisits(trip, DATE, 'm1'), { a: 'cancelled', b: 'skipped' });
});

test('방문 기록 id는 날짜·스팟·멤버로 같고, 다시 기록하면 기존보다 늦은 at으로 찍어 LWW에서 이긴다', () => {
  const v = visitRecord({ date: DATE, spotId: 'a', memberId: 'm1', status: 'arrived', source: 'sim', at: at('09:28'), arrivedAt: at('09:25') });
  assert.equal(v.id, visitId(DATE, 'a', 'm1'));
  assert.equal(v.arrivedAt, at('09:25'));
  const trip = { visits: [{ ...v, at: at('15:00') }] };
  // 프리셋을 다시 시작해 가상 시각이 앞으로 돌아가도 새 기록이 옛 기록을 덮는다
  assert.equal(nextVisitAt(trip, v.id, at('09:28')), at('15:00') + 1);
  assert.equal(nextVisitAt(trip, v.id, at('16:00')), at('16:00'));
  assert.equal(nextVisitAt({ visits: [] }, v.id, at('09:28')), at('09:28'));
});

test('여행 진행 날짜: 요청 → 오늘 → 스팟이 있는 첫 날짜 → 시작일', () => {
  const day = (date: string, n: number) => ({ date, items: Array.from({ length: n }, () => ({})) }) as unknown as DayPlan;
  const plan = { days: [day('2026-10-17', 0), day('2026-10-18', 3), day('2026-10-19', 2)] } as unknown as Plan;
  const trip = { startDate: '2026-10-17' };
  assert.equal(pickLiveDate(trip, plan, at('10:00', '2026-10-19'), '2026-10-17'), '2026-10-17');
  assert.equal(pickLiveDate(trip, plan, at('10:00', '2026-10-19')), '2026-10-19');
  assert.equal(pickLiveDate(trip, plan, at('10:00', '2026-09-26')), '2026-10-18');
  assert.equal(pickLiveDate(trip, undefined, at('10:00', '2026-09-26')), '2026-10-17');
});

test('조정안 위치: 마지막 샘플 → 머무는 스팟 → 마지막 도착 스팟 → 기점', () => {
  const day = liveDay();
  const last = { latitude: 35.8, longitude: 129.3 };
  assert.deepEqual(replanPosition(day, initialTracker(), last), last);
  const staying = { ...initialTracker({ a: 'arrived' }), current: { spotId: 'a', arrivedAt: at('09:25'), left: false } };
  assert.deepEqual(replanPosition(day, staying), day.items[0].coord);
  assert.deepEqual(replanPosition(day, initialTracker({ a: 'arrived' })), day.items[0].coord);
  assert.deepEqual(replanPosition(day, initialTracker()), day.base);
  assert.deepEqual(doneSpotIds(initialTracker({ a: 'arrived', b: 'skipped', c: 'cancelled' })).sort(), ['a', 'b']);
  assert.deepEqual(doneSpotIds(initialTracker({ a: 'arrived', b: 'skipped' }), 'skipped'), ['b']);
});

test('시각 점프: 다음 일정 10분 전과 여행 종료 다음 날(10/20), 지나간 시각은 주지 않는다', () => {
  const trip = { endDate: '2026-10-19' };
  const js = jumpTargets(trip, liveDay(), timing({}), at('10:00'));
  assert.deepEqual(
    js.map((j) => j.key),
    ['nextSpot', 'afterTrip'],
  );
  assert.equal(js[0].t, at('10:57'));
  assert.equal(js[1].label, '10/20 여행 종료 뒤');
  assert.equal(js[1].t, atKst('2026-10-20', '10:00'));
  assert.deepEqual(
    jumpTargets(trip, liveDay(), timing({}), at('11:00')).map((j) => j.key),
    ['afterTrip'],
  );
  assert.deepEqual(jumpTargets(trip, undefined, undefined, atKst('2026-10-21', '09:00')), []);
});

test('예정·예상 도착 문구는 사실만 적고 경고 문구가 없다', () => {
  const late = etaView(timing({ etaMin: toMin('11:32') }));
  // 늦어도 앰버로 칠하지 않는다. 지연은 조정안 시트 하나로만 알린다(04 리뷰)
  assert.deepEqual(late, { planned: '11:07', eta: '11:32', delta: '계획보다 25분 뒤', tone: 'muted' });
  assert.equal(etaView(timing({ etaMin: toMin('11:10') })).tone, 'muted');
  assert.equal(etaView(timing({ etaMin: toMin('10:50') })).delta, '17분 여유');
  assert.equal(etaView(timing({ etaMin: toMin('11:05') })).delta, '계획대로');
  const lines = [
    late.delta,
    logLine({ kind: 'delay', spotId: 'b', name: '석굴암', delayMin: 25, etaMin: 0, plannedArriveMin: 0, at: 0 }, () => '')?.text ?? '',
  ];
  for (const l of lines) assert.doesNotMatch(l, /늦었습니다|지연되었습니다|서두르세요/);
});

test('진행 기록 줄: 빈 시간은 찾은 뒤에만 적고(결과 없으면 표시 없음), 사진은 촬영 정보 없는 장수를 적는다', () => {
  const name = (id: string) => (id === 'a' ? '불국사' : '석굴암');
  assert.equal(logLine({ kind: 'visit', spotId: 'a', status: 'arrived', at: 1 }, name)?.text, '불국사 도착');
  assert.equal(logLine({ kind: 'visit', spotId: 'a', status: 'skipped', at: 1 }, name)?.text, '불국사 건너뜀');
  assert.equal(logLine({ kind: 'freeTime', spotId: 'b', gapMin: 40, until: 0, position: { latitude: 0, longitude: 0 }, at: 1 }, name), null);
  assert.equal(logLine({ kind: 'track', point: { t: 1, coord: { latitude: 0, longitude: 0 }, accuracyM: 10, source: 'sim' } }, name), null);
  assert.match(freeTimeLine(1, 40, 3).text, /40분 · 걸어서 갈 만한 곳 3곳/);
  assert.equal(photoLine(1, 3, 1).text, '사진 3장 올림 · 촬영 정보 없음 1장(추정)');
  assert.equal(photoLine(1, 1, 0).text, '사진 1장 올림');
});

test('계획이 다시 계산돼도 순서·시각이 같으면 같은 날로 본다(궤적을 다시 만들지 않는다)', () => {
  const a = liveDay();
  assert.equal(sameLiveDay(a, liveDay()), true);
  const reordered = { ...a, items: [a.items[1], a.items[0]] };
  assert.equal(sameLiveDay(a, reordered), false);
  const shifted = { ...a, items: [a.items[0], { ...a.items[1], arriveMin: a.items[1].arriveMin + 5 }] };
  assert.equal(sameLiveDay(a, shifted), false);
});

/* ---------- 리뷰 반영(04 코드리뷰) ---------- */

test('이어받는 알림 기록에서 지금보다 뒤(시뮬레이터가 남긴 가상 미래)는 버린다', () => {
  const log = [
    { kind: 'delay' as const, key: 't:2026-10-18', at: at('11:10') },
    { kind: 'arrival' as const, key: 't:2026-10-18:a', at: at('09:00') },
  ];
  assert.deepEqual(freshNotifyLog(log, at('10:00')).map((l) => l.kind), ['arrival']);
});

test('시뮬레이터를 다시 재생할 때 지울 옛 방문 기록: 이 날짜·이 멤버의 sim 기록 중 취소되지 않은 것', () => {
  const trip = {
    visits: [
      visit({ spotId: 'a', status: 'arrived', at: at('09:30') }),
      visit({ spotId: 'b', status: 'arrived', at: at('11:30') }),
      visit({ spotId: 'b', status: 'cancelled', at: at('11:40') }),
      visit({ spotId: 'c', status: 'arrived', at: at('13:00'), source: 'gps' }),
      visit({ spotId: 'd', status: 'skipped', at: at('14:00'), memberId: 'm2' }),
    ],
  };
  assert.deepEqual(staleSimVisits(trip, DATE, 'm1').map((v) => v.spotId), ['a']);
});

test('영업 종료(분)는 휴무일과 영업시간 없는 스팟을 빼고 편다', () => {
  const spots = [
    { id: 's1', hours: { open: '09:00', close: '17:30' } },
    { id: 's2', hours: { open: '10:00', close: '18:00', closedWeekdays: [0] } },
    { id: 's3' },
  ] as unknown as Parameters<typeof closingMinutes>[0]['spots'];
  // 2026-10-18은 일요일(0)
  assert.deepEqual(closingMinutes({ spots }, DATE), { s1: toMin('17:30') });
});

test('정확도 모름 안내는 진행 기록 한 줄로 남는다', () => {
  const on = logLine({ kind: 'accuracyUnknown', on: true, at: at('10:00') }, () => '');
  assert.equal(on?.text, '위치 정확도를 알 수 없어 도착은 버튼으로 기록');
});
