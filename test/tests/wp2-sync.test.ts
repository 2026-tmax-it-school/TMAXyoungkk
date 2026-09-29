import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { Member, Op, OpBody, Trip } from '../src/types';
import type { FetchLike, SyncTransport } from '../src/core/ports';
import { INVITE_TTL_MS } from '../src/core/constants';
import { foldOps } from '../src/core/ops';
import { buildDays } from '../src/core/trip/create';
import { lookupInviteInLogs } from '../src/core/trip/lookup';
import {
  ack,
  docOf,
  droppedJoins,
  emptyOutbox,
  enqueue,
  flushable,
  lastSeqOf,
  markDirty,
  needsRecompute,
  receive,
  reconnectPlan,
  type OutboxState,
} from '../src/core/trip/outbox';
import { atKst } from '../src/core/util';
import { createHttpTransport } from '../src/services/sync/http';
import { createSyncTransport } from '../src/services/sync';
import { createLoopbackTransport, OFFLINE_ERROR } from '../src/services/sync/loopback';
import { createSyncStore, startSyncServer } from '../server/sync-server.mjs';
import { fixedClock, memoryKV } from './helpers/fakes';

/**
 * WP2 동기화(FR-304 전송·큐·순서, NFR 오프라인): 순수 outbox, 루프백 전송(KV 유지, reset, chaos),
 * HTTP 폴링 전송과 server/sync-server.mjs(포트 0, CORS).
 */

const T0 = atKst('2026-10-01', '10:00');
const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };
const junho: Member = { id: 'm-junho', userId: 'u-junho', nickname: '준호', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 };

function tripBody(id = 'trip-1'): Omit<Trip, 'lastSeq'> {
  return {
    id,
    title: '경주 2박 3일',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: buildDays('2026-10-17', '2026-10-19', null),
    legs: [],
    members: [host, junho],
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: T0,
    createdBy: host.userId,
  };
}

let n = 0;
function op(body: OpBody, actorId = host.id, at?: number, tripId = 'trip-1'): Op {
  n += 1;
  return { id: `op-${String(n).padStart(4, '0')}`, tripId, actorId, at: at ?? T0 + n * 1000, ...body } as Op;
}

const setDay = (date: string, noReturn: boolean, actor: string, at: number) =>
  op({ type: 'trip/setDay', date, patch: { noReturn } }, actor, at);

const dayOf = (doc: Trip | undefined, date: string) => doc?.days.find((d) => d.date === date);

describe('outbox(순수)', () => {
  test('오프라인 op는 pending에 남고 docOf에 바로 보인다. 재연결 때 at 순으로 나간다', () => {
    const create = op({ type: 'trip/create', trip: tripBody() }, host.id, T0);
    let s = enqueue(emptyOutbox(), create);
    const late = setDay('2026-10-18', true, host.id, T0 + 30_000);
    const early = setDay('2026-10-19', true, host.id, T0 + 10_000);
    s = enqueue(enqueue(s, late), early);
    assert.equal(s.pending.length, 3);
    assert.equal(s.log.length, 0);
    assert.equal(dayOf(docOf(s), '2026-10-18')?.noReturn, true);
    assert.deepEqual(flushable(s).map((o) => o.id), [create.id, early.id, late.id]);
  });

  test('enqueue는 같은 id를 두 번 넣지 않고, 딸려 온 seq는 지운다', () => {
    const create = op({ type: 'trip/create', trip: tripBody() }, host.id, T0);
    let s = enqueue(emptyOutbox(), { ...create, seq: 9 });
    s = enqueue(s, create);
    assert.equal(s.pending.length, 1);
    assert.equal(s.pending[0].seq, undefined);
  });

  test('확인 응답이 오면 pending에서 log로 옮기고 seq 순으로 다시 접는다', () => {
    const create = op({ type: 'trip/create', trip: tripBody() }, host.id, T0);
    const a = setDay('2026-10-18', true, host.id, T0 + 1000);
    const b = setDay('2026-10-19', true, host.id, T0 + 2000);
    let s = [create, a, b].reduce(enqueue, emptyOutbox());
    s = ack(s, [{ opId: b.id, seq: 3 }, { opId: create.id, seq: 1 }]);
    assert.deepEqual(s.log.map((o) => [o.id, o.seq]), [[create.id, 1], [b.id, 3]]);
    assert.deepEqual(s.pending.map((o) => o.id), [a.id]);
    s = ack(s, [{ opId: a.id, seq: 2 }]);
    assert.deepEqual(s.log.map((o) => o.seq), [1, 2, 3]);
    assert.equal(s.pending.length, 0);
    assert.equal(lastSeqOf(s), 3);
    assert.equal(docOf(s)?.lastSeq, 3);
  });

  test('같은 id가 seq를 달고 다시 오면(receive) 확인 응답으로 본다', () => {
    const create = op({ type: 'trip/create', trip: tripBody() }, host.id, T0);
    const s0 = enqueue(emptyOutbox(), create);
    const r = receive(s0, [{ ...create, seq: 1 }]);
    assert.equal(r.changed, true);
    assert.equal(r.state.pending.length, 0);
    assert.deepEqual(r.state.log.map((o) => o.seq), [1]);
    // 뒤늦게 온 ack는 아무것도 바꾸지 않는다.
    assert.equal(ack(r.state, [{ opId: create.id, seq: 1 }]), r.state);
  });

  test('같은 op를 여러 번 받아도 1회만 반영된다. seq 없는 op는 받지 않는다', () => {
    const create = { ...op({ type: 'trip/create', trip: tripBody() }, host.id, T0), seq: 1 };
    const a = { ...setDay('2026-10-18', true, junho.id, T0 + 1000), seq: 2 };
    let r = receive(emptyOutbox(), [create, a, a, create]);
    assert.equal(r.state.log.length, 2);
    r = receive(r.state, [a]);
    assert.equal(r.changed, false);
    const unsequenced = setDay('2026-10-19', true, junho.id, T0 + 3000);
    assert.equal(receive(r.state, [unsequenced]).changed, false);
  });

  test('늦게 온 낮은 seq op는 로그 전체를 다시 접어 바로잡는다(필드 LWW는 op.at)', () => {
    const create = { ...op({ type: 'trip/create', trip: tripBody() }, host.id, T0), seq: 1 };
    // 준호가 오프라인에서 먼저 저장(at 작음)했지만 서버에는 늦게 도착(seq 큼)
    const minjiNew = { ...setDay('2026-10-18', true, host.id, T0 + 90_000), seq: 2 };
    const junhoOld = { ...setDay('2026-10-18', false, junho.id, T0 + 60_000), seq: 3 };
    const other = { ...setDay('2026-10-19', true, junho.id, T0 + 70_000), seq: 4 };
    let s = receive(emptyOutbox(), [create, other]).state;
    assert.equal(dayOf(docOf(s), '2026-10-19')?.noReturn, true);
    s = receive(s, [junhoOld, minjiNew]).state;
    assert.deepEqual(s.log.map((o) => o.seq), [1, 2, 3, 4]);
    assert.equal(dayOf(docOf(s), '2026-10-18')?.noReturn, true, '저장 시점이 늦은 민지 값이 남는다');
    assert.deepEqual(docOf(s), foldOps([create, minjiNew, junhoOld, other]));
  });

  test('pending은 확정 로그 뒤에 at 순으로 붙어 접힌다', () => {
    const create = { ...op({ type: 'trip/create', trip: tripBody() }, host.id, T0), seq: 1 };
    let s = receive(emptyOutbox(), [create]).state;
    s = enqueue(s, setDay('2026-10-18', false, host.id, T0 + 5000));
    s = enqueue(s, setDay('2026-10-18', true, host.id, T0 + 6000));
    assert.equal(dayOf(docOf(s), '2026-10-18')?.noReturn, true);
  });

  test('오프라인 편집은 dirty가 되고, 재연결 계획은 flush 뒤 재계산 대상을 준다', () => {
    const edit = setDay('2026-10-18', true, host.id, T0 + 1000);
    let dirty = markDirty({}, 'trip-1', edit, true);
    assert.deepEqual(dirty, {}, '온라인이면 바로 재계산하므로 표시하지 않는다');
    dirty = markDirty(dirty, 'trip-1', edit, false);
    assert.deepEqual(dirty, { 'trip-1': true });
    assert.deepEqual(markDirty({}, 'trip-2', { type: 'journal/diaryShared' }, false), {}, '재계산 대상이 아닌 op');
    const plan = reconnectPlan([edit, { ...edit, id: 'x', tripId: 'trip-3' }], dirty);
    assert.deepEqual(plan.flush, ['trip-1', 'trip-3']);
    assert.deepEqual(plan.recompute, ['trip-1']);
    assert.equal(needsRecompute('spot/pin'), true);
    assert.equal(needsRecompute('chat/send'), false);
    assert.equal(needsRecompute('member/join'), true);
  });
});

describe('루프백 전송', () => {
  test('받은 순서대로 seq를 매기고 같은 id는 처음 seq로 확인 응답만 한다', async () => {
    const t = createLoopbackTransport({ clock: fixedClock(T0), kv: memoryKV() });
    const create = op({ type: 'trip/create', trip: tripBody() }, host.id, T0);
    const a = setDay('2026-10-18', true, host.id, T0 + 1000);
    assert.deepEqual(await t.push([create, a]), [{ opId: create.id, seq: 1 }, { opId: a.id, seq: 2 }]);
    assert.deepEqual(await t.push([a]), [{ opId: a.id, seq: 2 }]);
    assert.deepEqual((await t.pull('trip-1', 0)).map((o) => o.seq), [1, 2]);
    assert.deepEqual((await t.pull('trip-1', 1)).map((o) => o.id), [a.id]);
  });

  test('구독자에게 새 op만 전달한다', async () => {
    const t = createLoopbackTransport({ clock: fixedClock(T0), kv: memoryKV() });
    const got: Op[][] = [];
    const off = t.subscribe('trip-1', (ops) => got.push(ops));
    const create = op({ type: 'trip/create', trip: tripBody() }, host.id, T0);
    await t.push([create]);
    await t.push([create]);
    off();
    await t.push([setDay('2026-10-18', true, host.id, T0 + 1000)]);
    assert.equal(got.length, 1);
    assert.equal(got[0][0].seq, 1);
  });

  test('오프라인이면 push·pull·lookupInvite가 던지고, 다시 켜면 된다', async () => {
    const t = createLoopbackTransport({ clock: fixedClock(T0), kv: memoryKV() });
    t.setOnline(false);
    assert.equal(t.online(), false);
    await assert.rejects(t.push([op({ type: 'trip/create', trip: tripBody() })]), { message: OFFLINE_ERROR });
    await assert.rejects(t.pull('trip-1', 0));
    await assert.rejects(t.lookupInvite('AB12-CD34'));
    t.setOnline(true);
    assert.equal((await t.push([op({ type: 'trip/create', trip: tripBody() })])).length, 1);
  });

  test('KV에 저장해 새로 만든 전송(새로고침)에서도 유지되고, reset()이 KV를 비운다', async () => {
    const kv = memoryKV();
    const first = createLoopbackTransport({ clock: fixedClock(T0), kv });
    await first.push([op({ type: 'trip/create', trip: tripBody() }, host.id, T0)]);
    const second = createLoopbackTransport({ clock: fixedClock(T0), kv });
    assert.equal((await second.pull('trip-1', 0)).length, 1);
    const next = await second.push([setDay('2026-10-18', true, host.id, T0 + 1000)]);
    assert.equal(next[0].seq, 2, 'seq도 이어진다');
    await second.reset();
    assert.equal(await kv.get('index'), null);
    const third = createLoopbackTransport({ clock: fixedClock(T0), kv });
    assert.deepEqual(await third.pull('trip-1', 0), []);
    assert.deepEqual(await second.pull('trip-1', 0), [], '리셋한 쪽 메모리도 비었다');
  });

  test('받은 op를 접어 초대를 판정한다(ok, 만료, 재발급 무효, 없음)', async () => {
    const clock = fixedClock(T0 + 10_000);
    const t = createLoopbackTransport({ clock, kv: memoryKV() });
    const inv = (code: string, at: number) =>
      op({ type: 'trip/issueInvite', invite: { code, issuedAt: at, expiresAt: at + INVITE_TTL_MS, capacity: 6 } }, host.id, at);
    await t.push([op({ type: 'trip/create', trip: tripBody() }, host.id, T0), inv('AAAA-1111', T0 + 1000), inv('BBBB-2222', T0 + 2000)]);
    const ok = await t.lookupInvite('BBBB-2222');
    assert.ok('trip' in ok);
    assert.deepEqual(await t.lookupInvite('AAAA-1111'), { error: 'revoked', tripId: 'trip-1' });
    assert.deepEqual(await t.lookupInvite('ZZZZ-0000'), { error: 'notFound' });
    clock.set(T0 + 2000 + INVITE_TTL_MS);
    assert.deepEqual(await t.lookupInvite('BBBB-2222'), { error: 'expired', tripId: 'trip-1' });
  });

  test('팩토리는 SYNC_URL이 없으면 루프백, 있으면 HTTP', () => {
    const fetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{}' });
    assert.equal(createSyncTransport({ fetch, clock: fixedClock(T0), kv: memoryKV() }).id, 'loopback');
    assert.equal(createSyncTransport({ syncUrl: 'http://127.0.0.1:1', fetch, clock: fixedClock(T0), kv: memoryKV() }).id, 'http');
  });
});

describe('chaos(순서 뒤섞기·중복 주입, 시드 고정)', () => {
  test('같은 시드면 같은 순서다', async () => {
    const order = async (seed: number) => {
      const t = createLoopbackTransport({ clock: fixedClock(T0), kv: memoryKV(), chaos: { shuffle: true, duplicate: true, seed } });
      const ops = [op({ type: 'trip/create', trip: tripBody() }, host.id, T0)];
      for (let i = 0; i < 8; i += 1) ops.push(setDay('2026-10-18', i % 2 === 0, host.id, T0 + 1000 * (i + 1)));
      await t.push(ops.map((o, i) => ({ ...o, id: `c-${i}` })));
      return (await t.pull('trip-1', 0)).map((o) => o.seq);
    };
    assert.deepEqual(await order(11), await order(11));
    const shuffled = await order(11);
    assert.notDeepEqual(shuffled, [...shuffled].sort((a, b) => (a ?? 0) - (b ?? 0)), '실제로 섞였다');
  });

  test('두 기기가 오프라인에서 편집한 뒤 뒤섞이고 중복된 전달을 받아도 같은 문서로 수렴한다', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const server = createLoopbackTransport({
        clock: fixedClock(T0),
        kv: memoryKV(),
        chaos: { shuffle: true, duplicate: true, seed },
      });
      const devices: Record<'A' | 'B', OutboxState> = { A: emptyOutbox(), B: emptyOutbox() };
      server.subscribe('trip-1', (ops) => {
        devices.A = receive(devices.A, ops).state;
        devices.B = receive(devices.B, ops).state;
      });
      const flush = async (k: 'A' | 'B') => {
        const acks = await server.push(flushable(devices[k]));
        devices[k] = ack(devices[k], acks);
      };

      devices.A = enqueue(devices.A, op({ type: 'trip/create', trip: tripBody() }, host.id, T0));
      await flush('A');
      assert.ok(docOf(devices.B), 'B도 방을 받았다');

      // 오프라인: 두 기기가 같은 필드를 번갈아 편집한다(저장 시각이 뒤섞임).
      server.setOnline(false);
      const edits: { k: 'A' | 'B'; o: Op }[] = [];
      for (let i = 0; i < 6; i += 1) {
        const k = i % 2 === 0 ? 'A' : 'B';
        const actor = k === 'A' ? host.id : junho.id;
        const at = T0 + 10_000 + ((i * 7919 + seed * 104729) % 50_000);
        const o = setDay(i % 3 === 0 ? '2026-10-18' : '2026-10-19', i % 2 === 1, actor, at);
        edits.push({ k, o });
        devices[k] = enqueue(devices[k], o);
      }
      await assert.rejects(flush('A'));
      assert.equal(devices.A.pending.length, 3, '보내지 못한 op는 pending에 남는다');

      server.setOnline(true);
      await flush('B');
      await flush('A');
      for (const k of ['A', 'B'] as const) {
        devices[k] = receive(devices[k], await server.pull('trip-1', lastSeqOf(devices[k]))).state;
      }

      assert.equal(devices.A.pending.length, 0);
      assert.equal(devices.B.pending.length, 0);
      assert.equal(new Set(devices.A.log.map((o) => o.id)).size, devices.A.log.length, '중복 없음');
      assert.deepEqual(docOf(devices.A), docOf(devices.B), `seed ${seed}`);
      // 날짜마다 저장 시각이 가장 늦은 편집이 남는다.
      for (const date of ['2026-10-18', '2026-10-19']) {
        const last = edits
          .map((e) => e.o)
          .filter((o) => o.type === 'trip/setDay' && o.date === date)
          .sort((a, b) => b.at - a.at)[0] as Extract<Op, { type: 'trip/setDay' }>;
        assert.equal(dayOf(docOf(devices.A), date)?.noReturn, last.patch.noReturn, `seed ${seed} ${date}`);
      }
    }
  });
});

describe('HTTP 폴링 전송 + server/sync-server.mjs', () => {
  let server: { url: string; close: () => Promise<void> };
  let now = T0 + 10_000;
  const fetchLike: FetchLike = (url, init) => fetch(url, init);
  let t: SyncTransport;

  before(async () => {
    server = await startSyncServer({ port: 0, now: () => now });
    t = createHttpTransport({ url: server.url, fetch: fetchLike, clock: { now: () => now }, pollMs: 20 });
  });
  after(async () => {
    await server.close();
  });

  test('push는 seq 확인 응답, 같은 id는 같은 seq. pull은 after 뒤만', async () => {
    const create = op({ type: 'trip/create', trip: tripBody('trip-h') }, host.id, T0, 'trip-h');
    const a = op({ type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: true } }, host.id, T0 + 1000, 'trip-h');
    assert.deepEqual(await t.push([create, a]), [{ opId: create.id, seq: 1 }, { opId: a.id, seq: 2 }]);
    assert.deepEqual(await t.push([a]), [{ opId: a.id, seq: 2 }]);
    assert.deepEqual((await t.pull('trip-h', 1)).map((o) => o.id), [a.id]);
    const doc = foldOps(await t.pull('trip-h', 0));
    assert.equal(dayOf(doc, '2026-10-18')?.noReturn, true);
  });

  test('구독은 폴링으로 새 op를 받는다', async () => {
    const got: Op[] = [];
    const off = t.subscribe('trip-h', (ops) => got.push(...ops));
    await new Promise((r) => setTimeout(r, 60));
    await t.push([op({ type: 'trip/setDay', date: '2026-10-19', patch: { noReturn: true } }, host.id, T0 + 2000, 'trip-h')]);
    await new Promise((r) => setTimeout(r, 80));
    off();
    assert.deepEqual([...new Set(got.map((o) => o.seq))].sort(), [1, 2, 3]);
  });

  test('초대 조회: ok는 방을, 재발급 전 코드는 revoked, 만료는 expired, 없으면 notFound', async () => {
    const inv = (code: string, at: number) =>
      op({ type: 'trip/issueInvite', invite: { code, issuedAt: at, expiresAt: at + INVITE_TTL_MS, capacity: 6 } }, host.id, at, 'trip-h');
    await t.push([inv('HHHH-1111', T0 + 3000), inv('HHHH-2222', T0 + 4000)]);
    const ok = await t.lookupInvite('HHHH-2222');
    assert.ok('trip' in ok && ok.trip.id === 'trip-h');
    assert.deepEqual(await t.lookupInvite('HHHH-1111'), { error: 'revoked', tripId: 'trip-h' });
    assert.deepEqual(await t.lookupInvite('NONE-0000'), { error: 'notFound' });
    now = T0 + 4000 + INVITE_TTL_MS;
    assert.deepEqual(await t.lookupInvite('HHHH-2222'), { error: 'expired', tripId: 'trip-h' });
    now = T0 + 10_000;
  });

  test('CORS: OPTIONS 사전 요청은 204와 허용 헤더, 일반 응답에도 Allow-Origin', async () => {
    const pre = await fetch(`${server.url}/trips/trip-h/ops`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Content-Type/);
    const get = await fetch(`${server.url}/trips/trip-h/ops?after=0`);
    assert.equal(get.headers.get('access-control-allow-origin'), '*');
    const bad = await fetch(`${server.url}/trips/trip-h/ops`, { method: 'POST', body: '{"ops":1}' });
    assert.equal(bad.status, 400);
    const missing = await fetch(`${server.url}/nowhere`);
    assert.equal(missing.status, 404);
  });

  test('오프라인이면 던지고, reset은 서버를 비운다', async () => {
    t.setOnline(false);
    await assert.rejects(t.pull('trip-h', 0), { message: OFFLINE_ERROR });
    t.setOnline(true);
    await t.reset();
    assert.deepEqual(await t.pull('trip-h', 0), []);
  });
});

describe('동시 합류 정원 경합(04 코드리뷰 반영)', () => {
  const CODE = 'RACE-0001';
  const guest = (id: string): Member => ({ id, userId: `u-${id}`, nickname: id, role: 'member', isGuest: true, canInvite: false, joinedAt: T0 });
  const joinOf = (m: Member, at: number, tripId = 'trip-1') =>
    op({ type: 'member/join', member: m, inviteCode: CODE }, m.id, at, tripId);
  // 방장·준호 2명, 정원 3. 두 기기가 각자 보기에는 자리가 하나 남아 있다.
  const base = (tripId = 'trip-1') => [
    op({ type: 'trip/create', trip: tripBody(tripId) }, host.id, T0, tripId),
    op({ type: 'trip/issueInvite', invite: { code: CODE, issuedAt: T0, expiresAt: T0 + INVITE_TTL_MS, capacity: 3 } }, host.id, T0 + 100, tripId),
  ];

  test('seq 순으로 다시 접으면 늦게 도착한 합류가 빠지고, droppedJoins가 그 op를 돌려준다', () => {
    const [create, inv] = base().map((o, i) => ({ ...o, seq: i + 1 }) as Op);
    const a = joinOf(guest('m-a'), T0 + 1000);
    const b = joinOf(guest('m-b'), T0 + 900);
    // 기기 B: 자기 합류를 pending에 둔 채 A의 합류(seq 3)를 먼저 받고, 자기 합류는 seq 4로 확인 응답을 받는다.
    let devB: OutboxState = enqueue({ log: [create, inv], pending: [] }, b);
    assert.equal(docOf(devB)?.members.some((m) => m.id === 'm-b'), true, '확인 응답 전에는 이 기기에서 보인다');
    devB = receive(devB, [{ ...a, seq: 3 } as Op]).state;
    const prev = devB.pending;
    const next = ack(devB, [{ opId: b.id, seq: 4 }]);
    const doc = docOf(next);
    assert.equal(doc?.members.some((m) => m.id === 'm-b'), false, '정원이 차 validate에서 떨어진다');
    assert.deepEqual(droppedJoins(prev, next, doc).map((o) => o.id), [b.id]);
    // 기기 A는 빠지지 않았다.
    let devA: OutboxState = enqueue({ log: [create, inv], pending: [] }, a);
    const prevA = devA.pending;
    devA = ack(devA, [{ opId: a.id, seq: 3 }]);
    assert.deepEqual(droppedJoins(prevA, devA, docOf(devA)), []);
  });

  test('직전 재발급으로 옛 코드 합류가 떨어져도 droppedJoins가 잡는다. 문서를 못 접으면 판정하지 않는다', () => {
    const [create, inv] = base().map((o, i) => ({ ...o, seq: i + 1 }) as Op);
    const reissue = {
      ...op({ type: 'trip/issueInvite', invite: { code: 'RACE-0002', issuedAt: T0 + 500, expiresAt: T0 + 500 + INVITE_TTL_MS, capacity: 3 } }, host.id, T0 + 500),
      seq: 3,
    } as Op;
    const c = joinOf(guest('m-c'), T0 + 800);
    let dev: OutboxState = enqueue({ log: [create, inv], pending: [] }, c);
    dev = receive(dev, [reissue]).state;
    const prev = dev.pending;
    const next = ack(dev, [{ opId: c.id, seq: 4 }]);
    assert.deepEqual(droppedJoins(prev, next, docOf(next)).map((o) => o.id), [c.id]);
    assert.deepEqual(droppedJoins(prev, next, undefined), []);
  });

  test('서버 간이 판정도 떨어진 합류를 세지 않는다: 한 명을 내보내면 다시 ok이고 앱 판정과 같다', () => {
    const store = createSyncStore();
    const now = T0 + 10_000;
    const a = joinOf(guest('m-a'), T0 + 1000, 'trip-r');
    const b = joinOf(guest('m-b'), T0 + 1100, 'trip-r');
    store.push('trip-r', [...base('trip-r'), a, b]);
    const client = () => lookupInviteInLogs([store.pull('trip-r', 0) as unknown as Op[]], CODE, now);
    assert.deepEqual(store.lookup(CODE, now), { tripId: 'trip-r', status: 'full' });
    assert.deepEqual(client(), { error: 'full', tripId: 'trip-r' });
    store.push('trip-r', [op({ type: 'member/remove', memberId: 'm-a' }, host.id, T0 + 2000, 'trip-r')]);
    assert.deepEqual(store.lookup(CODE, now), { tripId: 'trip-r', status: 'ok' }, 'm-b 합류는 활성으로 세지 않았다');
    const ok = client();
    assert.ok('trip' in ok && ok.trip.members.filter((m) => m.leftAt == null).length === 2);
  });

  test('서버 판정: 방장 탈퇴(anonymize)도 리듀서처럼 활성에서 뺀다', () => {
    const store = createSyncStore();
    const now = T0 + 10_000;
    store.push('trip-x', [...base('trip-x'), joinOf(guest('m-a'), T0 + 1000, 'trip-x')]);
    assert.equal((store.lookup(CODE, now) as { status: string }).status, 'full');
    store.push('trip-x', [op({ type: 'member/anonymize', memberId: host.id }, host.id, T0 + 2000, 'trip-x')]);
    assert.equal((store.lookup(CODE, now) as { status: string }).status, 'ok');
    const ok = lookupInviteInLogs([store.pull('trip-x', 0) as unknown as Op[]], CODE, now);
    assert.ok('trip' in ok, '앱 판정도 같은 결론이다');
  });
});

describe('HTTP 전송 시간 제한', () => {
  test('응답이 오지 않는 요청은 timeoutMs 뒤 실패한다(재연결 흐름이 붙잡히지 않는다)', async () => {
    const hang: FetchLike = () => new Promise(() => {});
    const t = createHttpTransport({ url: 'http://127.0.0.1:1', fetch: hang, clock: fixedClock(T0), timeoutMs: 20 });
    await assert.rejects(t.pull('trip-1', 0), /시간 초과/);
  });
});
