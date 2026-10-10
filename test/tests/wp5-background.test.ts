import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

import type { GpsSample, LatLng, TrackPoint, Trip } from '../src/types';
import { DEFAULT_NOTIFY_PREFS, LOCATION_INTERVAL_MS, STATIONARY_RADIUS_M } from '../src/core/constants';
import { buildDayTrack, TRACK_GAP_MS } from '../src/core/journal/track';
import {
  acceptWhileForeground,
  BG_FAIL_LINE,
  BG_LINE,
  bgFailReason,
  bgRecordBlock,
  bgRecordEndsAt,
  bgRecordRuns,
  initialBackground,
  onAppPhase,
  setRecording,
  watchPlan,
} from '../src/core/live/background';
import type { LiveDay } from '../src/core/live/context';
import {
  engineAppPhase,
  engineRecording,
  ingestSample,
  initialEngine,
  tickAt,
  type EngineEffect,
  type EngineState,
} from '../src/core/live/engine';
import { LIVE_STOP_TEXT, liveStopReason } from '../src/core/live/session';
import { backgroundStillSilent, backgroundWatchRequest, flushPending, STILL_DEPART_MS, throttleBatch, throttleSample } from '../src/core/live/throttle';
import { appendTrack, clearSimTrackDay, noteLivePermission, pruneTracks, type DeniedStore, type TrackStore } from '../src/core/live/track';
import { offsetCoord } from '../src/core/sim/track';
import { atKst, toMin } from '../src/core/util';
import { scenarioPlace } from '../src/data/scenario';
import { BG_BLOCK_TEXT, BG_NOTICE_HIDDEN_TEXT, bgRecordSub } from '../src/features/live/bgRecordText';

/**
 * 백그라운드 동선 기록(WP5, 사용자가 켜는 옵션·기본 꺼짐)과 날짜별 권한 거부 기록(FR-704).
 * 켤 수 있는지 판정, 어느 받기를 돌릴지(watchPlan), 켜져 있을 때 공백 판정과 화면 밖 샘플 처리(위치 로그와 도착 기록,
 * 알림·조정안 없음), 묶음 스로틀과 멈춘 자리, 거부 기록, 진행을 끝내는 때, 앱 설정.
 * 실기기 동작(OS가 화면 밖에서 넘기는 간격, 권한 창, 안드로이드 알림)은 node에서 볼 수 없어 소스 규칙만 본다.
 */

const DATE = '2026-10-18';
const at = (hhmm: string) => atKst(DATE, hhmm);
const A = scenarioPlace('gj-bulguksa').coord;
const B = offsetCoord(A, 3000, 0);

const day: LiveDay = {
  tripId: 'trip-bg',
  date: DATE,
  dayStartMs: at('00:00'),
  startMin: toMin('09:00'),
  base: null,
  items: [
    { spotId: 'a', name: '불국사', coord: A, arriveMin: toMin('09:30'), departMin: toMin('10:30'), travelMin: 20, transport: 'car' },
    { spotId: 'b', name: '북쪽', coord: B, arriveMin: toMin('11:00'), departMin: toMin('12:00'), travelMin: 20, transport: 'car' },
  ],
};
const ctx = { tripId: day.tripId, day, prefs: DEFAULT_NOTIFY_PREFS, source: 'device' as const };

const s = (t: number, coord: LatLng, accuracyM: number | null = 10): GpsSample => ({ t, coord, accuracyM });

/** from에서 to로 30초 간격 직선 이동 */
function moving(from: LatLng, to: LatLng, t0: number, n: number): GpsSample[] {
  return Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 0 : i / (n - 1);
    return s(t0 + i * 30_000, { latitude: from.latitude + (to.latitude - from.latitude) * f, longitude: from.longitude + (to.longitude - from.longitude) * f });
  });
}

/** 샘플을 차례로 넣고 위치 로그 점과 효과를 모은다 */
function feed(st: EngineState, samples: GpsSample[]): { st: EngineState; points: TrackPoint[]; effects: EngineEffect[]; kinds: EngineEffect['kind'][] } {
  const points: TrackPoint[] = [];
  const effects: EngineEffect[] = [];
  for (const x of samples) {
    const r = ingestSample(st, x, ctx);
    st = r.state;
    for (const e of r.effects) {
      effects.push(e);
      if (e.kind === 'track') points.push(e.point);
    }
  }
  return { st, points, effects, kinds: effects.map((e) => e.kind) };
}

const tripOf = (startDate: string, endDate: string): Trip => ({ startDate, endDate }) as Trip;
const NO_NOTICE: EngineEffect['kind'][] = ['arrivalNotice', 'delay', 'freeTime', 'shadow', 'accuracyUnknown'];

/* ---------- 켤 수 있는지 ---------- */

test('웹과 Expo Go에서는 켤 수 없고, 작업 관리자가 있는 iOS·안드로이드 개발 빌드에서만 켠다', () => {
  assert.equal(bgRecordBlock({ platform: 'web', expoGo: false, taskManager: false }), 'web');
  assert.equal(bgRecordBlock({ platform: 'ios', expoGo: true, taskManager: true }), 'expoGo');
  assert.equal(bgRecordBlock({ platform: 'android', expoGo: true, taskManager: false }), 'expoGo');
  assert.equal(bgRecordBlock({ platform: 'ios', expoGo: false, taskManager: true }), undefined);
  assert.equal(bgRecordBlock({ platform: 'android', expoGo: false, taskManager: true }), undefined);
  assert.equal(bgRecordBlock({ platform: 'android', expoGo: false, taskManager: false }), 'notInBuild', '작업 관리자 네이티브 모듈이 없는 빌드');
  assert.equal(bgRecordBlock({ platform: 'windows', expoGo: false, taskManager: true }), 'notInBuild');
  // 권한을 보거나 받기를 시작하다 빌드 설정이 없다는 오류를 받았으면 그 뒤로 켤 수 없음이다
  assert.equal(bgRecordBlock({ platform: 'android', expoGo: false, taskManager: true, missingInBuild: true }), 'notInBuild');
  assert.equal(bgRecordBlock({ platform: 'ios', expoGo: false, taskManager: true, missingInBuild: false }), undefined);
});

test('빌드 설정이 빠진 것(이전 설정으로 만든 빌드 포함)은 권한을 보거나 받기를 시작할 때 난 오류로 가린다(bgFailReason)', () => {
  // iOS UIBackgroundModes 없음, 안드로이드 매니페스트에 포그라운드 서비스 권한 없음
  assert.equal(bgFailReason({ code: 'ERR_LOCATION_UPDATES_UNAVAILABLE' }), 'notInBuild');
  assert.equal(bgFailReason({ code: 'ERR_FOREGROUND_SERVICE_PERMISSIONS' }), 'notInBuild');
  assert.equal(bgFailReason(new Error('Background Location has not been configured. To enable it, add `location` to `UIBackgroundModes`')), 'notInBuild');
  assert.equal(bgFailReason({ message: 'Foreground service permissions were not found in the manifest' }), 'notInBuild');
  // 이전 설정으로 만든 빌드: 안드로이드 매니페스트에 ACCESS_BACKGROUND_LOCATION 없음(코드에 PERMISSION이 있어도 거부가 아니다),
  // iOS Info.plist에 '항상 허용' 문구 없음, 작업 관리자 없음. 설정에 '항상 허용' 항목이 없어 권한 안내로는 풀 수 없다
  const manifest = { code: 'ERR_NO_PERMISSION_IN_MANIFEST', message: 'You need to add `ACCESS_BACKGROUND_LOCATION` to the AndroidManifest' };
  assert.equal(bgFailReason(manifest), 'notInBuild');
  assert.equal(bgFailReason({ message: manifest.message }), 'notInBuild');
  assert.equal(
    bgFailReason({ code: 'ERR_LOCATION_INFO_PLIST', message: 'One of the `NSLocation*UsageDescription` keys must be present in Info.plist' }),
    'notInBuild',
  );
  assert.equal(bgFailReason({ code: 'E_LOCATION_INFO_PLIST' }), 'notInBuild');
  assert.equal(bgFailReason({ code: 'ERR_TASK_MANAGER_UNAVAILABLE' }), 'notInBuild');
  assert.equal(bgFailReason(new Error("'expo-task-manager' module is required to use background services")), 'notInBuild');
  assert.equal(bgFailReason({ code: 'ERR_LOCATION_SERVICES_DISABLED' }), 'servicesOff');
  assert.equal(bgFailReason(new Error('Location services are disabled')), 'servicesOff');
  assert.equal(bgFailReason({ code: 'ERR_LOCATION_BACKGROUND_UNAUTHORIZED' }), 'denied');
  assert.equal(bgFailReason(new Error('background permission')), 'denied', '어댑터가 항상 허용이 없을 때 던지는 오류');
  // 화면 밖에서 포그라운드 서비스를 띄우려다 막힌 것은 빌드 문제가 아니다
  assert.equal(bgFailReason({ code: 'ERR_FOREGROUND_SERVICE_START_NOT_ALLOWED' }), 'failed');
  assert.equal(bgFailReason(undefined), 'failed');
  assert.equal(bgFailReason('boom'), 'failed');
  for (const t of Object.values(BG_FAIL_LINE)) assert.match(t, /앱을 켜 둔 동안만 기록/);
  assert.equal(BG_FAIL_LINE.denied, BG_LINE.noAlways);
});

test('켤 수 없는 이유를 그대로 안내하고, 줄 설명은 옵션 값이 아니라 실제로 도는지·오늘인지를 말한다', () => {
  assert.match(BG_BLOCK_TEXT.web, /개발 빌드/);
  assert.match(BG_BLOCK_TEXT.expoGo, /Expo Go/);
  assert.match(BG_BLOCK_TEXT.expoGo, /개발 빌드/);
  assert.match(BG_BLOCK_TEXT.denied, /항상 허용/);
  const base = { on: true, active: false, block: undefined, running: true, today: true };
  assert.equal(bgRecordSub({ ...base, on: false, block: 'expoGo' }), BG_BLOCK_TEXT.expoGo);
  assert.match(bgRecordSub({ ...base, active: true }), /남기는 중/);
  assert.match(bgRecordSub({ ...base, today: false }), /오늘 날짜가 아니라 이번 진행에서는 쓰지 않습니다/);
  assert.match(bgRecordSub({ ...base, running: false, today: false }), /오늘 날짜를 기기 위치로 진행할 때만/);
  assert.match(bgRecordSub(base), /지금은 화면 밖 동선을 남기지 않습니다/, '켜져 있지만 돌지 않으면 기록한다고 말하지 않는다');
  assert.match(bgRecordSub({ ...base, running: false }), /진행하면 앱이 화면 밖에 있어도 동선을 남깁니다/);
  assert.match(bgRecordSub({ ...base, on: false, running: false }), /항상 허용/);
  assert.match(BG_NOTICE_HIDDEN_TEXT, /기록은 켜졌고/);
  for (const t of [...Object.values(BG_BLOCK_TEXT), BG_NOTICE_HIDDEN_TEXT, ...Object.values(BG_LINE)]) {
    assert.doesNotMatch(t, /늦었습니다|지연되었습니다|서두르세요/);
  }
});

test('기본은 꺼짐이고, 켜도 기기 위치로 오늘 날짜를 진행할 때만 돈다(시뮬레이터·수동에는 영향 없음)', () => {
  const base = { block: undefined, date: DATE, now: at('10:00') };
  assert.equal(bgRecordRuns({ ...base, pref: false, mode: 'device' }), false);
  assert.equal(bgRecordRuns({ ...base, pref: true, mode: 'device' }), true);
  assert.equal(bgRecordRuns({ ...base, pref: true, mode: 'sim' }), false);
  assert.equal(bgRecordRuns({ ...base, pref: true, mode: 'manual' }), false);
  assert.equal(bgRecordRuns({ ...base, pref: true, mode: 'off' }), false);
  assert.equal(bgRecordRuns({ ...base, pref: true, mode: 'device', block: 'web' }), false);
  assert.equal(initialBackground.recording, undefined);
  assert.equal(initialEngine().background.recording, undefined);
  // 오늘 날짜만: 진행 날짜 전날 밤·지난 날짜에는 쓰지 않고, 자정을 넘기면 멈춘다
  const on = { pref: true, mode: 'device' as const, block: undefined, date: DATE };
  assert.equal(bgRecordRuns({ ...on, now: at('00:00') }), true);
  assert.equal(bgRecordRuns({ ...on, now: at('23:59') }), true);
  assert.equal(bgRecordRuns({ ...on, now: atKst('2026-10-17', '22:00') }), false, '진행 날짜 전날 밤에는 아직 돌지 않는다');
  assert.equal(bgRecordRuns({ ...on, now: atKst('2026-10-19', '00:00') }), false);
  assert.equal(bgRecordEndsAt(DATE), atKst('2026-10-19', '00:00'));
});

test('watchPlan: 앱 안 감시는 화면에 떠 있을 때만, 백그라운드 받기는 화면 밖에서 새로 켜지 않고 날짜가 지나거나 끄면 멈춘다', () => {
  const base = { pref: true, mode: 'device' as const, block: undefined, date: DATE, now: at('10:00'), inBackground: false, bgActive: false };
  // 기기 위치·오늘: 앱이 떠 있으면 둘 다 켠다
  assert.deepEqual(watchPlan(base), { fg: true, bg: true });
  assert.deepEqual(watchPlan({ ...base, bgActive: true }), { fg: true, bg: true });
  // 화면 밖: 돌던 받기는 그대로 두고, 돌지 않던 받기는 새로 켜지 않는다(안드로이드 12+ 포그라운드 서비스 시작 금지)
  assert.deepEqual(watchPlan({ ...base, inBackground: true, bgActive: true }), { fg: false, bg: true });
  assert.deepEqual(watchPlan({ ...base, inBackground: true, bgActive: false }), { fg: false, bg: false });
  // 옵션을 끄면 off, 자정을 넘기면 dateOver로 멈춘다(화면 밖이어도)
  assert.deepEqual(watchPlan({ ...base, pref: false, bgActive: true }), { fg: true, bg: false, bgStop: 'off' });
  const nextDay = atKst('2026-10-19', '00:00') + 1000;
  assert.deepEqual(watchPlan({ ...base, now: nextDay, bgActive: true }), { fg: true, bg: false, bgStop: 'dateOver' });
  assert.deepEqual(watchPlan({ ...base, now: nextDay, bgActive: true, inBackground: true }), { fg: false, bg: false, bgStop: 'dateOver' });
  // 전날 밤에 시작한 진행: 자정 전에는 돌지 않고, 앱이 떠 있는 채 그날이 되면 켠다(시계 틱이 부른다)
  assert.deepEqual(watchPlan({ ...base, now: atKst('2026-10-17', '23:59') }), { fg: true, bg: false });
  assert.deepEqual(watchPlan({ ...base, now: at('00:00') }), { fg: true, bg: true });
  assert.deepEqual(watchPlan({ ...base, now: at('00:00'), inBackground: true }), { fg: false, bg: false }, '화면 밖이면 돌아와서 켠다');
  // 시뮬레이터·수동·꺼짐·켤 수 없는 환경에는 백그라운드 받기가 없다
  assert.deepEqual(watchPlan({ ...base, mode: 'sim' }), { fg: true, bg: false });
  assert.deepEqual(watchPlan({ ...base, mode: 'sim', inBackground: true }), { fg: false, bg: false });
  assert.deepEqual(watchPlan({ ...base, mode: 'manual' }), { fg: false, bg: false });
  assert.deepEqual(watchPlan({ ...base, mode: 'off' }), { fg: false, bg: false });
  assert.deepEqual(watchPlan({ ...base, block: 'expoGo' }), { fg: true, bg: false });
});

/* ---------- 공백 판정 ---------- */

test('기록이 켜져 있으면 화면 밖으로 가도 감시를 멈추지 않고, 돌아와도 그 구간을 공백으로 보지 않는다', () => {
  const on = setRecording(initialBackground, true, 0);
  const away = onAppPhase(on, 'background', 1000);
  assert.equal(away.stop, false);
  assert.equal(away.state.inBackground, true);
  const back = onAppPhase(away.state, 'active', 5000);
  assert.equal(back.resumed, true);
  assert.deepEqual(back.state.gaps, []);
  assert.equal(back.state.recording, true);
  assert.equal(acceptWhileForeground(back.state, 3000), true, '화면 밖 구간 샘플도 버리지 않는다');
  // 꺼져 있으면 지금처럼 멈추고 공백으로 남긴다
  const plain = onAppPhase(onAppPhase(initialBackground, 'background', 1000).state, 'active', 5000);
  assert.deepEqual(plain.state.gaps, [{ from: 1000, to: 5000 }]);
});

test('화면 밖에서 기록이 끊기거나 늦게 켜지면 그 시각이 공백의 경계다', () => {
  // 켜져 있다가 화면 밖에서 시작 실패로 꺼짐 → 꺼진 뒤부터 돌아올 때까지만 공백
  let st = onAppPhase(setRecording(initialBackground, true, 0), 'background', 1000).state;
  st = setRecording(st, false, 3000);
  st = onAppPhase(st, 'active', 8000).state;
  assert.deepEqual(st.gaps, [{ from: 3000, to: 8000 }]);
  // 꺼진 채 화면 밖에 있다가 켜짐 → 켜지기 전 구간만 공백
  let st2 = onAppPhase(initialBackground, 'background', 1000).state;
  st2 = setRecording(st2, true, 4000);
  assert.deepEqual(st2.gaps, [{ from: 1000, to: 4000 }]);
  st2 = onAppPhase(st2, 'active', 9000).state;
  assert.deepEqual(st2.gaps, [{ from: 1000, to: 4000 }]);
  assert.equal(setRecording(st2, true, 9500), st2, '같은 값이면 그대로');
  // 켤 때 시각과 받기 방식을 남기고, 돌아와도 유지하며, 끄면 지운다
  assert.equal(st2.recordingSince, 4000);
  assert.equal(st2.stillSilent, false);
  const ios = setRecording(initialBackground, true, 100, { stillSilent: true });
  assert.deepEqual(
    [ios.recording, ios.recordingSince, ios.stillSilent],
    [true, 100, true],
  );
  const offAgain = setRecording(ios, false, 200);
  assert.equal(offAgain.recordingSince, undefined);
  assert.equal(offAgain.stillSilent, undefined);
});

/* ---------- 엔진: 화면 밖 샘플 ---------- */

test('엔진: 기록 중 화면 밖 샘플은 위치 로그와 도착 기록(visit)까지만 가고 알림·지연·빈 시간은 내지 않는다', () => {
  let st = engineRecording(initialEngine(), true, at('09:00'));
  const south = offsetCoord(A, -1500, 0);
  const first = feed(st, [s(at('09:00'), south)]);
  st = engineAppPhase(first.st, 'background', at('09:01')).state;
  // 화면 밖: 남쪽에서 불국사로 10분 이동(30초 간격 21개, 사이에 10초 샘플도 섞임) 뒤 15분 머묾. OS가 한 묶음으로 넘긴다
  const move = moving(south, A, at('09:05'), 21);
  const extra = move.slice(0, 5).map((x) => ({ ...x, t: x.t + 10_000 }));
  const stay = Array.from({ length: 31 }, (_, i) => s(at('09:15') + 30_000 + i * 30_000, A));
  const batch = throttleBatch({}, [...move, ...extra, ...stay]);
  assert.equal(
    batch.out.some((x) => extra.some((e) => e.t === x.sample.t)),
    false,
    '10초 샘플은 어댑터의 30초 스로틀이 거른다',
  );
  const bg = feed(
    st,
    batch.out.map((x) => x.sample),
  );
  assert.deepEqual([...new Set(bg.kinds)].sort(), ['track', 'visit']);
  for (const k of NO_NOTICE) assert.equal(bg.kinds.includes(k), false, `화면 밖에서는 ${k}를 내지 않는다`);
  const visit = bg.effects.find((e) => e.kind === 'visit');
  assert.deepEqual(visit && { spotId: visit.spotId, status: visit.status, arrivedAt: visit.arrivedAt }, {
    spotId: 'a',
    status: 'arrived',
    arrivedAt: at('09:14') + 30_000,
  });
  assert.equal(bg.st.tracker.statuses.a, 'arrived', '돌아온 뒤 이미 다녀온 곳으로 지연 조정안이 뜨지 않게 도착은 판정한다');
  // 이동 첫 점(09:05)은 09:00 기록점과 같은 자리라 정지지만, 4분 넘게 머문 뒤 떠난 자리라 다음 점 앞에 남는다(departFrom).
  // 그래서 21개이고, 불국사에 멈춰 있는 동안은 기록하지 않는다
  assert.equal(bg.points.length, 21);
  assert.equal(bg.points[0].t, at('09:05'));
  assert.equal(tickAt(bg.st, at('09:40'), ctx).effects.length, 0, '화면 밖에서는 시계 판정도 쉰다');
  // 돌아오면 공백이 없고, 기록 지도는 화면 밖 구간을 실선으로 잇는다
  const back = engineAppPhase(bg.st, 'active', at('09:50'));
  assert.equal(back.resumed, true);
  assert.deepEqual(back.state.background.gaps, []);
  assert.equal(back.state.tracker.statuses.a, 'arrived');
  const trip = { spots: [], visits: [], photos: [] } as unknown as Trip;
  const track = buildDayTrack(trip, undefined, DATE, [...first.points, ...bg.points]);
  assert.equal(track.gaps.length, 0);
  assert.equal(track.segments.length, 1);
  // 정확도가 나쁜 화면 밖 샘플도 로그에는 남긴다(앱 안과 같은 규칙, 기록 지도가 정확도로 거른다). GPS 음영 안내도 없다
  const far = engineAppPhase(back.state, 'background', at('09:51')).state;
  const rough = ingestSample(far, s(at('09:52'), B, 500), ctx);
  // 불국사에 오래 머문 뒤라 떠난 자리가 먼저 남고, 그다음이 정확도 나쁜 샘플이다
  assert.deepEqual(rough.effects.map((e) => e.kind), ['track', 'track']);
  const lastPoint = rough.effects[1];
  assert.ok(lastPoint.kind === 'track' && lastPoint.point.accuracyM === 500);
});

test('엔진: 화면 밖에서 반경에 들어간 뒤 샘플 없이 머물다 떠나면 들어온 시각으로 도착을 남긴다(앞 샘플 자리로 머문 시간)', () => {
  // iOS: 멈춰 있으면 받기가 샘플을 보내지 않는다(stillSilent)
  let st = engineRecording(initialEngine(), true, at('09:00'), { stillSilent: true });
  st = feed(st, [s(at('09:20'), A)]).st;
  assert.equal(st.tracker.candidate?.spotId, 'a');
  st = engineAppPhase(st, 'background', at('09:21')).state;
  // iOS 20m 조건이라 머무는 동안 샘플이 없다. 09:40에 반경 밖으로 나간 샘플이 온다
  const r = feed(st, [s(at('09:40'), offsetCoord(A, 500, 0))]);
  assert.deepEqual(r.kinds, ['visit', 'track']);
  const v = r.effects[0];
  assert.ok(v.kind === 'visit' && v.spotId === 'a' && v.status === 'arrived' && v.arrivedAt === at('09:20'));
  // 안드로이드는 30초마다 샘플이 오므로 20분 끊긴 것은 신호가 없는 것이다. 그 사이 머물렀다고 보지 않는다
  let android = engineRecording(initialEngine(), true, at('09:00'), { stillSilent: false });
  android = feed(android, [s(at('09:20'), A)]).st;
  android = engineAppPhase(android, 'background', at('09:21')).state;
  assert.deepEqual(feed(android, [s(at('09:40'), offsetCoord(A, 500, 0))]).kinds, ['track']);
});

test('엔진: 기록 중(iOS)이면 돌아온 첫 시계 판정이 5분 넘은 마지막 샘플로 도착을 잡는다. 기록이 꺼져 있으면 믿지 않는다', () => {
  let st = engineRecording(initialEngine(), true, at('09:00'), { stillSilent: true });
  st = feed(st, [s(at('09:20'), A)]).st;
  st = engineAppPhase(st, 'background', at('09:21')).state;
  st = engineAppPhase(st, 'active', at('09:40')).state;
  assert.equal(st.tracker.candidate?.spotId, 'a', '기록이 끝까지 돌았으면 반경 진입 기록을 버리지 않는다');
  const r = tickAt(st, at('09:40'), ctx);
  const kinds = r.effects.map((e) => e.kind);
  assert.ok(kinds.includes('visit'));
  assert.ok(kinds.includes('arrivalNotice'), '앱이 떠 있으면 도착 알림을 낸다');
  // 기록이 꺼져 있으면 마지막 샘플은 5분까지만 믿는다
  const plain = feed(initialEngine(), [s(at('09:20'), A)]).st;
  assert.equal(tickAt(plain, at('09:24'), ctx).effects.some((e) => e.kind === 'visit'), true);
  assert.equal(tickAt(plain, at('09:40'), ctx).effects.some((e) => e.kind === 'visit'), false);
});

test('엔진: 기록 중에도 기록을 켜기 전(공백 전) 샘플이나 30초마다 오는 받기(안드로이드)에서 끊긴 샘플은 5분까지만 믿는다', () => {
  const visits = (st: EngineState, from: number, to: number) => {
    const out: EngineEffect['kind'][] = [];
    for (let t = from; t <= to; t += 5_000) {
      const r = tickAt(st, t, ctx);
      st = r.state;
      out.push(...r.effects.map((e) => e.kind));
    }
    return out;
  };
  // 기록이 꺼진 채 09:10 반경 안 샘플 하나, 화면 밖 공백 [09:11, 10:40), 돌아와 10:40에 기록을 켬. 새 샘플 없이 시계만 흐른다
  let st = feed(initialEngine(), [s(at('09:10'), offsetCoord(A, 50, 0))]).st;
  st = engineAppPhase(st, 'background', at('09:11')).state;
  st = engineAppPhase(st, 'active', at('10:40')).state;
  st = engineRecording(st, true, at('10:40'), { stillSilent: true });
  assert.equal(st.background.recordingSince, at('10:40'));
  const before = visits(st, at('10:40'), at('10:45'));
  assert.equal(before.includes('visit'), false, '공백 전 샘플로 도착을 만들지 않는다');
  assert.equal(before.includes('arrivalNotice'), false);
  // 안드로이드: 기록 중 09:00 샘플 뒤로 40분 끊김. 40분 전 위치로 예상 도착을 재지 않는다(꺼져 있을 때와 같은 지연)
  const south = offsetCoord(A, -1500, 0);
  const android = feed(engineRecording(initialEngine(), true, at('09:00'), { stillSilent: false }), [s(at('09:00'), south)]).st;
  const plain = feed(initialEngine(), [s(at('09:00'), south)]).st;
  assert.equal(tickAt(android, at('09:40'), ctx).state.timing?.delayMin, tickAt(plain, at('09:40'), ctx).state.timing?.delayMin);
  // iOS는 기록을 켠 뒤 받은 샘플이면 그 자리에 있다고 본다(20m 이동 조건이라 샘플이 없다)
  const ios = feed(engineRecording(initialEngine(), true, at('09:00'), { stillSilent: true }), [s(at('09:00'), south)]).st;
  assert.notEqual(tickAt(ios, at('09:40'), ctx).state.timing?.delayMin, tickAt(plain, at('09:40'), ctx).state.timing?.delayMin);
});

test('엔진: 기록이 꺼져 있으면 지금처럼 화면 밖 샘플을 버리고 기록 지도에 공백이 남는다', () => {
  const south = offsetCoord(A, -1500, 0);
  let st = feed(initialEngine(), [s(at('09:00'), south)]).st;
  st = engineAppPhase(st, 'background', at('09:01')).state;
  const bg = feed(st, moving(south, A, at('09:05'), 21));
  assert.deepEqual(bg.kinds, []);
  st = engineAppPhase(bg.st, 'active', at('09:50')).state;
  assert.deepEqual(st.background.gaps, [{ from: at('09:01'), to: at('09:50') }]);
  const after = feed(st, [s(at('09:51'), A)]);
  const trip = { spots: [], visits: [], photos: [] } as unknown as Trip;
  const track = buildDayTrack(trip, undefined, DATE, [{ ...s(at('09:00'), south), source: 'device' }, ...after.points]);
  assert.equal(track.gaps.length, 1, '꺼져 있던 구간은 점선이다');
});

test('엔진: 기록 중 늦게 온 OS 묶음의 옛 샘플은 버린다(위치 로그 뒤쪽이 잘리지 않는다)', () => {
  let st = engineRecording(initialEngine(), true, at('09:00'));
  const r1 = feed(st, moving(offsetCoord(A, -1500, 0), A, at('09:00'), 5));
  st = r1.st;
  assert.equal(r1.points.length, 5);
  const late = ingestSample(st, s(at('09:01'), offsetCoord(A, -900, 0)), ctx);
  assert.deepEqual(late.effects, []);
  assert.equal(late.state, st);
  // 같은 점을 위치 로그에 넣어도 뒤쪽이 그대로다
  let track: TrackStore = {};
  for (const p of r1.points) track = appendTrack(track, 't', DATE, p);
  assert.equal(track.t[DATE].length, 5);
});

/* ---------- 어댑터 규칙(묶음 스로틀) ---------- */

test('백그라운드 받기 요청: iOS는 20m 이동, 안드로이드는 30초 간격(화면 밖에서도 날짜 확인이 돌게)', () => {
  assert.deepEqual(backgroundWatchRequest(LOCATION_INTERVAL_MS, 'ios'), { timeIntervalMs: 30_000, distanceIntervalM: STATIONARY_RADIUS_M });
  assert.deepEqual(backgroundWatchRequest(LOCATION_INTERVAL_MS, 'android'), { timeIntervalMs: 30_000, distanceIntervalM: 0 });
  // 멈춰 있으면 샘플이 오지 않는 것은 거리 조건이 있는 iOS뿐이다(엔진이 오래된 마지막 샘플을 믿는 조건)
  assert.equal(backgroundStillSilent('ios'), true);
  assert.equal(backgroundStillSilent('android'), false);
});

test('몰아서 온 묶음은 시간순으로 30초 1개만 넘기고, 이미 넘긴 시각보다 이른 샘플은 버린다', () => {
  const t0 = at('10:00');
  const pts = moving(A, B, t0, 7); // 0, 30, …, 180초
  const shuffled = [pts[3], pts[0], pts[1], { ...pts[1], t: pts[1].t + 5_000 }, pts[2], pts[6], pts[5], pts[4]];
  const r = throttleBatch({}, shuffled);
  assert.deepEqual(r.out.map((x) => (x.sample.t - t0) / 1000), [0, 30, 60, 90, 120, 150, 180]);
  const next = throttleBatch(r.state, [pts[2], { ...pts[6], t: pts[6].t + 30_000 }]);
  assert.deepEqual(next.out.map((x) => (x.sample.t - t0) / 1000), [210]);
  // 정지 판정은 throttleSample과 같다
  const still = throttleBatch({}, [s(t0, A), s(t0 + 30_000, offsetCoord(A, 5, 0))]);
  assert.deepEqual(still.out.map((x) => x.decision.record), [true, false]);
  // 10초마다 계속 움직이면 들고 있던 샘플을 끼워 넣지 않아 30초 간격이 그대로다
  const walk = moving(A, B, t0, 19).map((x, i) => ({ ...x, t: t0 + i * 10_000 })); // 0~180초, 10초 간격
  const w = throttleBatch({}, walk);
  assert.deepEqual(w.out.map((x) => (x.sample.t - t0) / 1000), [0, 30, 60, 90, 120, 150, 180]);
});

test('멈춘 자리: 간격 안이라 들고 있던 샘플은 그 뒤로 간격만큼 샘플이 없을 때 넘긴다(같은 묶음·다음 묶음·타이머 모두)', () => {
  const t0 = at('10:00');
  const P0 = s(t0, A);
  const P1 = s(t0 + 10_000, offsetCoord(A, 150, 0)); // 150m 움직인 뒤 멈춤
  const P2 = s(t0 + 30 * 60_000, offsetCoord(A, 175, 0)); // 30분 뒤 25m 움직임
  const one = throttleBatch({}, [P0, P1, P2]);
  assert.deepEqual(one.out.map((x) => (x.sample.t - t0) / 1000), [0, 10, 1800], '같은 묶음 안에서도 멈춘 자리를 잃지 않는다');
  assert.equal(one.state.pending, undefined);
  const a1 = throttleBatch({}, [P0, P1]);
  assert.equal(a1.state.pending, P1);
  const two = throttleBatch(a1.state, [P2]);
  assert.deepEqual([...a1.out, ...two.out].map((x) => x.sample.t), one.out.map((x) => x.sample.t), '묶음을 나눠 받아도 같다');
  // 기록 지도: 멈춘 자리가 있으면 30분 정지 뒤 25m 이동은 공백이 아니다(켜져 있는 동안은 공백으로 보지 않는다)
  const trip = { spots: [], visits: [], photos: [] } as unknown as Trip;
  const pts = (out: { sample: GpsSample }[]) => out.map((x) => ({ ...x.sample, source: 'device' as const }));
  assert.equal(buildDayTrack(trip, undefined, DATE, pts(one.out)).gaps.length, 0);
  assert.equal(buildDayTrack(trip, undefined, DATE, pts([{ sample: P0 }, { sample: P2 }])).gaps.length, 1, '멈춘 자리를 잃으면 점선이 생긴다');
  // 타이머(flushPending): 들고 있던 샘플 뒤로 간격이 지나야만 넘긴다
  assert.deepEqual(flushPending(a1.state, t0 + 30_000).out, [], '마지막으로 넘긴 뒤 30초가 지났어도 멈춘 지 30초가 안 됐으면 기다린다');
  const f = flushPending(a1.state, t0 + 40_000);
  assert.deepEqual(f.out.map((x) => x.sample), [P1]);
  assert.equal(f.state.pending, undefined);
  assert.equal(f.state.lastEmitAt, P1.t);
  assert.equal(flushPending(f.state, t0 + 90_000).out.length, 0, '넘긴 뒤에는 다시 넘기지 않는다');
  // 이미 넘긴 시각보다 이른 pending은 버린다
  assert.deepEqual(flushPending({ lastEmitAt: t0 + 60_000, pending: P1 }, t0 + 120_000), { state: { lastEmitAt: t0 + 60_000, pending: undefined }, out: [] });
});

test('떠난 자리: 4분 넘게 머문 뒤 움직일 때만 정지로 건너뛴 마지막 샘플을 먼저 남긴다(짧은 멈춤·흔들림에는 점을 더하지 않는다)', () => {
  assert.ok(STILL_DEPART_MS < TRACK_GAP_MS, '기록 지도 공백 기준보다 짧아야 머문 시간이 공백이 되지 않는다');
  const t0 = at('10:00');
  const run = (stillSec: number[], moveSec: number) => {
    let st = throttleSample({}, s(t0, A)).state;
    for (const sec of stillSec) st = throttleSample(st, s(t0 + sec * 1000, offsetCoord(A, 5, 0))).state;
    const r = throttleSample(st, s(t0 + moveSec * 1000, offsetCoord(A, 300, 0)));
    const after = throttleSample(r.state, s(t0 + (moveSec + 30) * 1000, offsetCoord(A, 600, 0)));
    return { first: r.decision, second: after.decision };
  };
  // 2분 멈춘 뒤 출발: 떠난 자리 없음
  assert.equal(run([30, 60, 90, 120], 150).first.departFrom, undefined);
  // 5분 멈춘 뒤 출발: 마지막 정지 샘플(300초)을 먼저 남기고, 그다음 샘플에는 다시 내지 않는다
  const long = run([30, 60, 90, 120, 150, 180, 210, 240, 270, 300], 330);
  assert.equal(long.first.record, true);
  assert.equal(long.first.departFrom?.t, t0 + 300_000);
  assert.equal(long.second.departFrom, undefined);
  // 앱 안 감시(엔진 앱 안 경로)도 같은 규칙이다
  const fg = feed(initialEngine(), [
    s(t0, A),
    ...Array.from({ length: 10 }, (_, i) => s(t0 + (i + 1) * 30_000, offsetCoord(A, 5, 0))),
    s(t0 + 330_000, offsetCoord(A, 300, 0)),
  ]);
  assert.deepEqual(fg.points.map((p) => (p.t - t0) / 1000), [0, 300, 330]);
});

test('안드로이드 화면 밖(30초·거리 조건 없음): 오래 머문 뒤 차로 떠나도 기록 지도에 공백 점선이 생기지 않는다', () => {
  const trip = { spots: [], visits: [], photos: [] } as unknown as Trip;
  for (const stayMin of [10, 40]) {
    let st = engineRecording(initialEngine(), true, at('09:00'), { stillSilent: false });
    st = engineAppPhase(st, 'background', at('09:00')).state;
    const stopAt = at('09:00') + stayMin * 60_000;
    const samples: GpsSample[] = [];
    for (let t = at('09:00'); t <= stopAt; t += 30_000) samples.push(s(t, A));
    // 마지막 정지 샘플 5초 뒤 40km/h(11m/s)로 출발
    for (let i = 1; i <= 10; i += 1) samples.push(s(stopAt + i * 30_000, offsetCoord(A, (i * 30 - 5) * 11, 0)));
    const r = feed(
      st,
      throttleBatch({}, samples).out.map((x) => x.sample),
    );
    assert.equal(buildDayTrack(trip, undefined, DATE, r.points).gaps.length, 0, `${stayMin}분 머문 뒤 출발`);
    assert.deepEqual(r.st.background.gaps, []);
    assert.equal(r.points[1].t, stopAt, '떠난 자리(마지막 정지 샘플)가 출발 첫 점 앞에 있다');
    // 떠난 자리가 없으면 머문 시간이 '기록 없는 구간'이 된다(고치기 전 동작)
    assert.equal(buildDayTrack(trip, undefined, DATE, r.points.filter((p) => p.t !== stopAt)).gaps.length, 1);
  }
});

/* ---------- 날짜별 권한 거부 기록 ---------- */

test('위치를 쓰려다 권한이 없으면 그 날짜에 거부 기록을 남긴다. 수동 진행을 고른 것은 거부가 아니다', () => {
  const t1 = at('09:00');
  let st: DeniedStore = {};
  st = noteLivePermission(st, 'trip1', DATE, { requested: 'manual', permission: 'denied', at: t1 });
  assert.deepEqual(st, {});
  st = noteLivePermission(st, 'trip1', DATE, { requested: 'device', permission: 'denied', at: t1 });
  assert.deepEqual(st, { trip1: { [DATE]: { at: t1, source: 'device' } } });
  // 같은 날 다시 거부되면 처음 시각을 지키고, 다른 날은 따로 남는다
  st = noteLivePermission(st, 'trip1', DATE, { requested: 'device', permission: 'denied', at: t1 + 60_000 });
  assert.equal(st.trip1[DATE].at, t1);
  st = noteLivePermission(st, 'trip1', '2026-10-19', { requested: 'device', permission: 'denied', at: t1 + 86_400_000 });
  assert.deepEqual(Object.keys(st.trip1).sort(), [DATE, '2026-10-19']);
  // 나중에 허용하거나 수동으로 다시 진행해도 그날 기기 거부 기록은 지우지 않는다(로그가 생기면 기록 지도가 로그를 쓴다)
  assert.equal(noteLivePermission(st, 'trip1', DATE, { requested: 'device', permission: 'granted', at: t1 + 120_000 }), st);
  assert.equal(noteLivePermission(st, 'trip1', DATE, { requested: 'manual', permission: 'denied', at: t1 + 180_000 }), st);
});

test('기기 거부는 그날 실제로 진행할 때만 남긴다. 출발 전에 앞날을 미리 시작해 보다 거부한 것은 그날 기록이 아니다', () => {
  const before = atKst('2026-10-09', '21:00');
  assert.deepEqual(noteLivePermission({}, 'trip1', DATE, { requested: 'device', permission: 'denied', at: before }), {});
  // 이 규칙 전에 남은 다른 날 기기 기록은 그날 수동·허용 진행이나 그날 거부가 바꾼다
  const stale: DeniedStore = { trip1: { [DATE]: { at: before, source: 'device' } } };
  assert.deepEqual(noteLivePermission(stale, 'trip1', DATE, { requested: 'manual', permission: 'denied', at: at('09:00') }), { trip1: {} });
  assert.deepEqual(noteLivePermission(stale, 'trip1', DATE, { requested: 'device', permission: 'granted', at: at('09:00') }), { trip1: {} });
  assert.deepEqual(noteLivePermission(stale, 'trip1', DATE, { requested: 'device', permission: 'denied', at: at('09:00') }).trip1[DATE], {
    at: at('09:00'),
    source: 'device',
  });
  // 시뮬레이터는 가상 시각이 그 날짜라 그대로 남긴다
  assert.deepEqual(noteLivePermission({}, 'trip1', DATE, { requested: 'sim', permission: 'denied', at: at('08:00') }).trip1[DATE].source, 'sim');
});

test('시뮬레이터 권한 거부 프리셋은 sim으로 남기고, 그날을 다시 진행하면(시뮬레이터·수동·허용된 기기) 지우거나 덮는다', () => {
  const t1 = at('09:00');
  let st = noteLivePermission({}, 'trip1', DATE, { requested: 'sim', permission: 'denied', at: t1 });
  assert.deepEqual(st.trip1[DATE], { at: t1, source: 'sim' });
  assert.equal(noteLivePermission(st, 'trip1', DATE, { requested: 'manual', permission: 'denied', at: t1 + 500 }).trip1[DATE], undefined, '수동 진행');
  assert.equal(noteLivePermission(st, 'trip1', DATE, { requested: 'device', permission: 'granted', at: t1 + 500 }).trip1[DATE], undefined, '허용된 기기');
  st = noteLivePermission(st, 'trip1', DATE, { requested: 'sim', permission: 'granted', at: t1 + 1000 });
  assert.equal(st.trip1[DATE], undefined, '권한 있는 프리셋으로 다시 재생하면 지운다');
  st = noteLivePermission(st, 'trip1', DATE, { requested: 'sim', permission: 'denied', at: t1 + 2000 });
  st = noteLivePermission(st, 'trip1', DATE, { requested: 'device', permission: 'denied', at: t1 + 3000 });
  assert.deepEqual(st.trip1[DATE], { at: t1 + 3000, source: 'device' }, '기기 거부가 시뮬레이터 기록을 덮는다');
  assert.equal(noteLivePermission(st, 'trip1', DATE, { requested: 'sim', permission: 'granted', at: t1 + 4000 }), st);
  assert.equal(noteLivePermission(st, 'trip1', DATE, { requested: 'sim', permission: 'denied', at: t1 + 5000 }), st);
});

test('시뮬레이터를 다시 재생하면 그날 시뮬레이터 점만 지우고 기기 점은 남긴다', () => {
  const sim: TrackPoint = { ...s(at('09:00'), A), source: 'sim' };
  const dev: TrackPoint = { ...s(at('09:30'), B), source: 'device' };
  const other: TrackStore = { trip1: { '2026-10-19': [sim] } };
  let track: TrackStore = { trip1: { [DATE]: [sim, dev], '2026-10-19': [sim] } };
  track = clearSimTrackDay(track, 'trip1', DATE);
  assert.deepEqual(track.trip1[DATE], [dev]);
  assert.deepEqual(track.trip1['2026-10-19'], [sim], '다른 날은 그대로');
  assert.deepEqual(clearSimTrackDay(other, 'trip1', '2026-10-19'), { trip1: {} }, '시뮬레이터 점만 있으면 그날을 지운다');
  const devOnly: TrackStore = { trip1: { [DATE]: [dev] } };
  assert.equal(clearSimTrackDay(devOnly, 'trip1', DATE), devOnly);
});

test('거부 기록도 위치 로그와 같이 종료 후 90일 뒤와 여행방이 없을 때 지운다(공유 isTrackExpired)', () => {
  const st: DeniedStore = { trip1: { [DATE]: { at: 1, source: 'device' } }, gone: { [DATE]: { at: 1, source: 'device' } } };
  const trips = { trip1: tripOf('2026-10-17', '2026-10-19') };
  const boundary = atKst('2026-10-20', '00:00') + 90 * 24 * 3600_000;
  assert.deepEqual(Object.keys(pruneTracks(st, trips, boundary - 1)), ['trip1']);
  assert.deepEqual(pruneTracks(st, trips, boundary), {});
});

/* ---------- 진행을 끝내는 때 ---------- */

test('로그아웃, 여행방 삭제·나가기, 기기 위치 진행 중 기기 위치 사용 끄기면 진행을 끝낸다(백그라운드 받기도 멈춘다)', () => {
  const ok = { signedIn: true, useDevice: true, mode: 'device' as const, tripExists: true, member: true };
  assert.equal(liveStopReason(ok), undefined);
  assert.equal(liveStopReason({ ...ok, mode: 'off', signedIn: false }), undefined, '진행 중이 아니면 볼 것이 없다');
  assert.equal(liveStopReason({ ...ok, signedIn: false }), 'signedOut');
  assert.equal(liveStopReason({ ...ok, tripExists: false, member: false }), 'tripGone');
  assert.equal(liveStopReason({ ...ok, member: false }), 'tripGone');
  assert.equal(liveStopReason({ ...ok, useDevice: false }), 'deviceOff');
  // 시뮬레이터·수동(권한이 없어 수동이 된 진행 포함)은 기기 위치를 쓰지 않아 그대로 둔다
  assert.equal(liveStopReason({ ...ok, mode: 'sim', useDevice: false }), undefined);
  assert.equal(liveStopReason({ ...ok, mode: 'manual', useDevice: false }), undefined);
  assert.equal(liveStopReason({ ...ok, mode: 'sim', signedIn: false }), 'signedOut');
  for (const t of Object.values(LIVE_STOP_TEXT)) {
    assert.match(t, /여행 진행을 끝냈습니다/);
    assert.doesNotMatch(t, /늦었습니다|지연되었습니다|서두르세요/);
  }
});

/* ---------- 앱 설정·어댑터·스토어 소스 ---------- */

test('앱 설정: iOS UIBackgroundModes location과 항상 허용 문구, 안드로이드 백그라운드 위치·포그라운드 서비스·알림 권한', () => {
  const req = createRequire(import.meta.url);
  const file = path.resolve('app.config.js');
  delete req.cache[file];
  const cfg = req(file)({ config: {} }) as { plugins: unknown[]; android: { permissions?: string[] } };
  delete req.cache[file];
  const loc = (cfg.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location') as [string, Record<string, unknown>])[1];
  assert.equal(loc.isIosBackgroundLocationEnabled, true);
  assert.equal(loc.isAndroidBackgroundLocationEnabled, true);
  assert.equal(loc.isAndroidForegroundServiceEnabled, true);
  for (const k of ['locationWhenInUsePermission', 'locationAlwaysAndWhenInUsePermission', 'locationAlwaysPermission']) {
    assert.match(String(loc[k]), /[가-힣]/, `${k}는 한국어 문구`);
  }
  assert.match(String(loc.locationAlwaysAndWhenInUsePermission), /백그라운드 동선 기록을 켜면/);
  // 화면 밖 위치는 동선(이 기기에만)과 스팟 도착(여행방 방문 기록)에 쓴다. 권한 문구·알림·줄 설명이 같은 말을 한다
  for (const k of ['locationAlwaysAndWhenInUsePermission', 'locationAlwaysPermission']) {
    assert.match(String(loc[k]), /이 기기에만/);
    assert.match(String(loc[k]), /여행방 방문 기록/);
  }
  assert.match(bgRecordSub({ on: false, active: false, block: undefined, running: false, today: true }), /여행방 방문 기록/);
  // 안드로이드 13부터 포그라운드 서비스 알림도 알림 권한이 있어야 알림창에 보인다
  assert.ok(cfg.android.permissions?.includes('android.permission.POST_NOTIFICATIONS'));
});

test('어댑터: 작업은 모듈 최상위에서 한 번 정의하고, Expo Go·웹에서는 작업 관리자를 불러오지 않으며 서버로 보내지 않는다', () => {
  const src = readFileSync('src/services/location/background.ts', 'utf8');
  assert.doesNotMatch(src, /from ['"]expo-task-manager['"]/, '정적 import면 네이티브 모듈이 없는 곳에서 불러오는 순간 깨진다');
  assert.match(src, /if \(Platform\.OS === 'web' \|\| IN_EXPO_GO\) return null;\n {2}try \{[\s\S]*?require\('expo-task-manager'\)/);
  assert.match(src, /^if \(TM && !TM\.isTaskDefined\(BG_LOCATION_TASK\)\) \{\n {2}TM\.defineTask/m);
  assert.match(src, /killServiceOnDestroy: true/);
  assert.match(src, /const target = current;\n\s+if \(!target\) \{\n\s+await enqueue\(stopUpdates\);/, '받을 곳이 없으면(진행이 끝남) 받기를 멈춘다');
  assert.match(src, /^if \(TM\) void enqueue\(stopUpdates\);/m, '앱을 새로 켜면 이전 실행이 남긴 받기를 멈춘다');
  assert.match(src, /backgroundWatchRequest\(opts\.intervalMs, Platform\.OS\)/);
  assert.match(src, /flushPending\(throttle, Date\.now\(\)/);
  assert.match(src, /Math\.max\(0, p\.t \+ opts\.intervalMs - Date\.now\(\)\)/, '멈춘 자리 타이머는 들고 있던 샘플 시각에서 잰다');
  assert.match(src, /PermissionsAndroid\.PERMISSIONS\.POST_NOTIFICATIONS/);
  assert.match(src, /\(e: unknown\) => fail\(failReason\(e\)\)/);
  assert.match(src, /notificationBody: '[^']*이 기기에만[^']*여행방 방문 기록/);
  // 이전 설정으로 만든 빌드의 권한 오류는 거부가 아니라 빌드 문제로 알린다(권한 확인·켜기 모두)
  assert.match(src, /\} catch \(e\) \{\n[^}]*return failReason\(e\) === 'notInBuild' \? 'notInBuild' : 'denied';/);
  assert.match(src, /const r = failReason\(e\);\n\s+return \{ ok: false, reason: r === 'notInBuild' \|\| r === 'servicesOff' \? r : 'denied' \};/);
  assert.match(src, /stillSilent: backgroundStillSilent\(Platform\.OS\)/);
  assert.doesNotMatch(src, /\bfetch\(/);
  const index = readFileSync('index.ts', 'utf8');
  const bgAt = index.indexOf("import './src/services/location/background';");
  assert.ok(bgAt >= 0 && bgAt < index.indexOf("import App from './App';"), 'index.ts가 앱 등록 전에 작업을 정의한다');
});

test('스토어: 옵션과 거부 기록만 저장하고, 받기 켜고 끄기는 받기 제어(watchControl)에 맡기며, 진행을 끝내면 모두 멈춘다', () => {
  // 켜고 끄기·실패·자정 동작은 tests/wp5-watch-control.test.ts가 가짜 어댑터로 본다. 여기서는 스토어 연결만 본다.
  const src = readFileSync('src/store/live.ts', 'utf8');
  const partialize = /partialize: \(s\) => \(\{([\s\S]*?)\}\),\n/.exec(src)?.[1] ?? '';
  assert.match(partialize, /denied: s\.denied/);
  assert.match(partialize, /bgRecord: s\.bgRecord/);
  assert.doesNotMatch(partialize, /bgActive/);
  assert.match(src, /bgRecord: false,\n\s+bgActive: false,/, '기본은 꺼짐');
  // 진행마다 받기 제어 하나. teardown(진행 끝·리셋·다시 시작)이 모두 푼다
  assert.match(src, /rt\.watch = watchControlFor\(rt\);\n\s+syncWatch\(\);/);
  assert.match(src, /function teardown\(\) \{\n\s+if \(!rt\) return;\n[^\n]*\n\s+rt\.watch\?\.dispose\(\);/);
  assert.doesNotMatch(src, /\bwatchPlan\(|startLocationUpdatesAsync|bgRecordEndsAt/, '받기 판정·자정 타이머는 받기 제어에만 있다');
  // 받기 제어의 결과 옮기기: 기록 상태는 엔진(받기 방식 포함)과 bgActive에, 실패는 옵션 끄기에, 줄은 진행 기록에
  assert.match(src, /run\.engine = engineRecording\(run\.engine, on, at, \{ stillSilent \}\);\n\s+set\(\{ bgActive: on \}\);/);
  assert.match(src, /onFail: \(\) => \{\n\s+if \(rt === run\) set\(\{ bgRecord: false \}\);/);
  // 자정: 샘플마다·시계 틱마다 맞춘다(전날 밤에 시작한 진행은 그날이 되면 켠다)
  assert.match(src, /if \(run\.watch\?\.bgActive\(\)\) syncWatch\(\);\n\s+if \(rt !== run\) return;\n\s+const r = ingestSample/);
  assert.match(src, /if \(st\.mode === 'device'\) syncWatch\(\);\n\s+const prevTracker/);
  // 이전 설정 빌드라 권한을 볼 수 없으면 '항상 허용' 대신 빌드가 이유라고 남긴다
  assert.match(src, /bgLine = bgPermission === 'notInBuild' \? BG_FAIL_LINE\.notInBuild : BG_LINE\.noAlways;/);
  // 권한 창 때문에 바뀌는 앱 상태는 화면 밖으로 보지 않고, '오늘이 아니라'는 정말 오늘이 아닐 때만 남긴다
  assert.match(src, /if \(askingBg && status !== 'active'\) return;/);
  assert.match(src, /askingBg = true;\n\s+let r: BgEnableResult;\n\s+try \{\n\s+r = await bgLocation\.enable\(\);\n\s+\} finally \{\n\s+askingBg = false;/);
  assert.doesNotMatch(src, /onAppState\(AppState\.currentState\)/, '응답과 active 이벤트 순서가 정해져 있지 않아 끝난 직후 맞추지 않는다');
  assert.match(src, /kstDate\(appClock\(\)\.now\(\)\) !== run\.date\) \{\n\s+pushLog\(\[\{ t: appClock\(\)\.now\(\), text: BG_LINE\.notToday/);
  // 화면 밖에서는 계획이 바뀌어도 조정안·주변 조회를 하지 않는다
  assert.match(src, /if \(run\.engine\.background\.inBackground\) return;\n\s+\/\/ 바뀐 계획으로/);
  // 화면 밖에서 효과 없는 샘플은 저장 쓰기를 하지 않고(돌아올 때 현재 위치를 넣는다), 샘플 하나에 set은 한 번이다
  assert.match(src, /if \(r\.effects\.length === 0 && run\.engine\.background\.inBackground\) \{[\s\S]*?if \(current\) run\.awayLast = sample;\n\s+return;\n\s+\}/);
  assert.match(src, /set\(\{ background: false, \.\.\.\(awayLast \? \{ last: awayLast \} : \{\}\), \.\.\.engineView\(run\) \}\);/);
  assert.match(src, /const current = r\.state\.last === sample \|\| prev == null \|\| sample\.t > prev\.t;/);
  const apply = /const applyEffects = [\s\S]*?\n {6}\};\n/.exec(src)?.[0] ?? '';
  assert.equal(apply.match(/\bset\(/g)?.length, 1);
  assert.doesNotMatch(apply, /pushLog\(|syncEngine\(\)/);
  // 그날을 다시 진행하면(시뮬레이터·기기·수동) 앞 시뮬레이터 점을 지운다. 시뮬레이터 분기 안에만 있지 않다
  const startLive = /const startLive = async[\s\S]*?\n {6}\};\n/.exec(src)?.[0] ?? '';
  const simBranch = /if \(requested === 'sim'\) \{[\s\S]*?\} else if \(requested === 'device'\)/.exec(startLive)?.[0] ?? '';
  assert.match(startLive, /const cleared = clearSimTrackDay\(get\(\)\.track, tripId, date\);/);
  assert.doesNotMatch(simBranch, /clearSimTrackDay/);
});
