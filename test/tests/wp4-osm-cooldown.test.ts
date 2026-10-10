import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import { buildPlan } from '../src/core/planner';
import { haversineKm } from '../src/core/util';
import {
  createLocalRoutes,
  createOsmRoutes,
  createRouteProvider,
  OSM_COOLDOWN_MS,
  OSM_TABLE_TIMEOUT_MS,
} from '../src/services/routes';
import { fakeFetch, fixedClock, memoryKV, type FakeFetchCall } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * 경로 서버 쉬는 시간(WP4, 2026-10-09 웹 실행 오류 1).
 * 공개 OSRM은 요청이 몰리면 429를 주다가 연결을 끊는다. 쉬지 않으면 계획이 구간마다 다시 두드려 100구간 계산이 90초 걸렸다.
 * netClock(실제 시계)을 주면 429·5xx·닿지 못함·시간 초과 뒤 OSM_COOLDOWN_MS 동안 묻지 않고 바로 대체(직선 추정, 캐시 안 함)한다.
 * 400(경로 없음)은 그 요청만의 문제라 쉬지 않는다. netClock이 없으면 예전처럼 매번 묻는다.
 */

// 예시 데이터 구간표에 없는 경주 시내 점들
const A: LatLng = { latitude: 35.8301, longitude: 129.2101 };
const B: LatLng = { latitude: 35.8352, longitude: 129.2203 };
const C: LatLng = { latitude: 35.8401, longitude: 129.2301 };

const isTable = (c: FakeFetchCall) => c.url.includes('/table/v1/');

/** 정상 OSRM table 응답(1×1) */
const okTable = () => ({ body: { code: 'Ok', durations: [[600]], distances: [[1000]] } });

test('429를 받으면 쉬는 동안 묻지 않고 바로 직선 추정(임시)이다. 쉬는 시간이 지나면 다시 묻는다', async () => {
  let mode: 'busy' | 'ok' = 'busy';
  const f = fakeFetch(() => (mode === 'busy' ? { status: 429, body: { message: 'Too Many Requests' } } : okTable()));
  const clock = fixedClock(1_000);
  const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes(), netClock: clock });

  const first = await osm.matrix([A], [B], 'car');
  assert.equal(f.calls.length, 1);
  assert.equal(first.estimated, true);
  assert.equal((first as { provisional?: boolean }).provisional, true, '대체 결과는 캐시하지 않는다');

  mode = 'ok';
  clock.advance(OSM_COOLDOWN_MS - 1);
  const resting = await osm.matrix([A], [C], 'walk');
  assert.equal(f.calls.length, 1, '쉬는 동안에는 다른 구간·다른 수단도 묻지 않는다');
  assert.equal((resting as { provisional?: boolean }).provisional, true);
  const leg = await osm.route(A, C, 'walk');
  assert.equal(f.calls.length, 1, '선 모양(route)도 묻지 않는다');
  assert.equal(leg?.provisional, true);

  clock.advance(1);
  const after = await osm.matrix([A], [B], 'car');
  assert.equal(f.calls.length, 2, '쉬는 시간이 끝나면 다시 묻는다');
  assert.equal(after.estimated, false);
});

test('5xx·닿지 못함·시간 초과도 쉰다. 400 경로 없음과 404는 쉬지 않는다', async () => {
  for (const kind of ['503', 'throw', 'timeout'] as const) {
    const f = fakeFetch(async (c) => {
      if (!isTable(c)) return okTable();
      if (kind === '503') return { status: 503, body: {} };
      if (kind === 'throw') throw new Error('connection refused');
      await new Promise((r) => setTimeout(r, 50));
      return okTable();
    });
    const clock = fixedClock(0);
    const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes(), netClock: clock, tableTimeoutMs: 10 });
    await osm.matrix([A], [B], 'car');
    await osm.matrix([A], [C], 'car');
    assert.equal(f.calls.length, 1, `${kind}: 두 번째는 쉬는 중이라 묻지 않는다`);
  }

  for (const status of [400, 404]) {
    const f = fakeFetch(() => ({ status, body: { code: status === 400 ? 'NoRoute' : 'NotFound' } }));
    const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes(), netClock: fixedClock(0) });
    await osm.matrix([A], [B], 'car');
    await osm.matrix([A], [C], 'car');
    assert.equal(f.calls.length, 2, `${status}: 그 요청만의 문제라 다음 요청은 그대로 묻는다`);
  }
});

test('netClock이 없으면 쉬지 않는다(예전 동작: 실패해도 다음 요청을 그대로 보낸다)', async () => {
  const f = fakeFetch(() => ({ status: 429, body: {} }));
  const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes() });
  await osm.matrix([A], [B], 'car');
  await osm.matrix([A], [C], 'car');
  assert.equal(f.calls.length, 2);
});

test('계획 전체: 길 서버가 429만 주면 쉬는 시간 덕에 몇 번만 묻고 끝난다. 쉬지 않으면 구간마다 다시 묻는다', async () => {
  const busy = () => fakeFetch(() => ({ status: 429, body: {} }));
  const trip = scenarioTrip();

  const withRest = busy();
  const rested = createRouteProvider({ fetch: withRest, clock: fixedClock(0), kv: memoryKV(), roadShapes: {}, netClock: fixedClock(0) });
  const p1 = await buildPlan(trip, { routes: rested, now: 0 });
  assert.ok(p1.days.some((d) => d.items.length > 0), '계획은 직선 추정으로 끝난다');
  assert.equal(p1.estimated, true);

  const noRest = busy();
  const unrested = createRouteProvider({ fetch: noRest, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  await buildPlan(trip, { routes: unrested, now: 0 });

  // 계획기가 동시에 묻는 만큼(첫 물결)만 나가고 그 뒤는 쉰다
  assert.ok(withRest.calls.length <= 8, `쉬는 쪽 ${withRest.calls.length}번`);
  assert.ok(noRest.calls.length > withRest.calls.length * 3, `쉬지 않는 쪽 ${noRest.calls.length}번`);
});

test('공개 서버에 직접 묻는 table은 4초에서 끊는다(경로 선 8초보다 짧게). 서버 중계는 그보다 길다', () => {
  assert.equal(OSM_TABLE_TIMEOUT_MS, 4000);
  assert.ok(OSM_COOLDOWN_MS >= 30_000);
  // 같은 구간 표가 아니라는 확인용(이 테스트 파일의 점들은 구간표 밖이다)
  assert.ok(haversineKm(A, B) > 0.5);
});

test('계획: 이동시간 조회 단계는 구간이 끝날 때마다 진행 숫자를 올린다(onStep matrix done이 0에서 total까지 오른다)', async () => {
  const f = fakeFetch(() => okTable());
  const routes = createRouteProvider({ fetch: f, clock: fixedClock(0), kv: memoryKV(), roadShapes: {} });
  const seen: number[] = [];
  await buildPlan(scenarioTrip(), { routes, now: 0, onStep: (s) => (s.key === 'matrix' ? seen.push(s.done) : undefined) });
  assert.ok(seen.length > 2, `matrix 알림 ${seen.length}번`);
  assert.equal(seen[0], 0);
  const mid = seen.slice(1, -1);
  assert.ok(mid.some((d) => d > 0 && d < seen[seen.length - 1]), '중간 숫자가 있다');
});

test('시간 제한은 본문을 다 받을 때까지다: 머리만 오고 본문이 멈추면 시간 초과로 대체하고 쉰다', { timeout: 5000 }, async () => {
  const stalled = Object.assign(
    async (url: string) => {
      stalled.calls.push(url);
      return { ok: true, status: 200, text: () => new Promise<string>(() => {}) };
    },
    { calls: [] as string[] },
  );
  const clock = fixedClock(0);
  const osm = createOsmRoutes({ fetch: stalled, fallback: createLocalRoutes(), netClock: clock, tableTimeoutMs: 20, timeoutMs: 20 });
  const m = await osm.matrix([A], [B], 'walk');
  assert.equal((m as { provisional?: boolean }).provisional, true, '본문이 멈춰도 끝난다(직선 추정 임시)');
  assert.equal(stalled.calls.length, 1);
  const leg = await osm.route(A, C, 'walk');
  assert.equal(leg?.provisional, true);
  assert.equal(stalled.calls.length, 1, '쉬는 중이라 묻지 않는다');

  // 쉬지 않는 제공자에서도 경로가 멈추지 않는다
  const plain = createOsmRoutes({ fetch: stalled, fallback: createLocalRoutes(), timeoutMs: 20 });
  assert.equal((await plain.route(A, C, 'walk'))?.provisional, true);

  // 본문 읽기가 실패해도 다른 실패처럼 쉰다
  const broken = fakeFetch(() => okTable());
  const brokenFetch = Object.assign(
    async (url: string) => {
      await broken(url, { method: 'GET' });
      return { ok: true, status: 200, text: () => Promise.reject(new Error('connection reset')) };
    },
    { calls: broken.calls },
  );
  const r = createOsmRoutes({ fetch: brokenFetch, fallback: createLocalRoutes(), netClock: fixedClock(0) });
  await r.matrix([A], [B], 'walk');
  await r.matrix([A], [C], 'walk');
  assert.equal(broken.calls.length, 1);
});

test('성공(200)인데 본문을 JSON으로 읽지 못하거나 표가 요청과 다르면 실패로 보고 쉰다(중간 장비의 HTML 등)', async () => {
  const bodies: [string, unknown][] = [
    ['HTML', '<html>login</html>'],
    ['표 크기가 다름', { code: 'Ok', durations: [[1, 2, 3]] }],
    ['code가 Ok가 아님', { code: 'TooBig' }],
  ];
  for (const [why, body] of bodies) {
    const f = fakeFetch(() => ({ body }));
    const osm = createOsmRoutes({ fetch: f, fallback: createLocalRoutes(), netClock: fixedClock(0) });
    const m = await osm.matrix([A], [B], 'walk');
    assert.equal((m as { provisional?: boolean }).provisional, true, why);
    await osm.matrix([A], [C], 'walk');
    assert.equal(f.calls.length, 1, `${why}: 두 번째는 쉬는 중이라 묻지 않는다`);
  }
  const html = fakeFetch(() => ({ body: '<html>login</html>' }));
  const osm = createOsmRoutes({ fetch: html, fallback: createLocalRoutes(), netClock: fixedClock(0) });
  assert.equal((await osm.route(A, B, 'walk'))?.provisional, true);
  await osm.route(A, C, 'walk');
  assert.equal(html.calls.length, 1, '경로도 같다');
});
