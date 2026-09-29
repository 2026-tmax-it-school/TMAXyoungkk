import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Member, Op, OpBody, Trip } from '../src/types';
import { SESSION_TTL_MS } from '../src/core/constants';
import { foldOps } from '../src/core/ops';
import { isExpired, issueGuest, restoreSession, saveSession, SESSION_KV_KEY, touchOrExpire } from '../src/core/session';
import { buildDays } from '../src/core/trip/create';
import { ack, docOf, emptyOutbox, enqueue, flushable, lastSeqOf, receive, type OutboxState } from '../src/core/trip/outbox';
import { atKst } from '../src/core/util';
import { memoryKV, seededRng } from './helpers/fakes';

/**
 * QA(로직): 오프라인 큐와 중복 op(FR-304 예외, 비기능 오프라인), 게스트 세션 30일(FR-105).
 * - 오프라인 op는 대기(pending)로 바로 문서에 보이고, 재연결 때 저장 순서(at)대로 나간다.
 * - 같은 op는 몇 번을 받든, 확인 응답과 구독 수신이 어떤 순서로 오든 한 번만 반영된다.
 * - 게스트 세션은 마지막 사용부터 30일이다. 30일 정각까지는 살아 있고 1ms 뒤에 만료된다.
 */

const T0 = atKst('2026-10-01', '10:00');
const DAY = 24 * 60 * 60 * 1000;
const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };
const junho: Member = { id: 'm-junho', userId: 'u-junho', nickname: '준호', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 };

function tripBody(): Omit<Trip, 'lastSeq'> {
  return {
    id: 'trip-qa',
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

const mk = (id: string, body: OpBody, at: number, actorId = host.id): Op => ({ id, tripId: 'trip-qa', actorId, at, ...body }) as Op;
const create = () => mk('op-create', { type: 'trip/create', trip: tripBody() }, T0);
const chat = (id: string, text: string, at: number, actor = host.id) => mk(id, { type: 'chat/send', message: { id: `msg-${id}`, text } }, at, actor);
const setDay = (id: string, date: string, noReturn: boolean, at: number, actor = host.id) =>
  mk(id, { type: 'trip/setDay', date, patch: { noReturn } }, at, actor);

describe('오프라인 큐', () => {
  test('오프라인에서 보낸 메시지는 대기로 바로 보이고, 재연결 때 저장 순서대로 나가며, 확인 응답 뒤 전송 완료가 된다', () => {
    let s = receive(emptyOutbox(), [{ ...create(), seq: 1 }]).state;
    // 저장 순서와 큐에 넣은 순서가 다르다(같은 시각이면 id 순)
    const m3 = chat('c3', '셋째', T0 + 3000);
    const m1 = chat('c1', '첫째', T0 + 1000);
    const m2b = chat('c2b', '둘째-나', T0 + 2000);
    const m2a = chat('c2a', '둘째-가', T0 + 2000);
    for (const o of [m3, m1, m2b, m2a]) s = enqueue(s, o);
    const doc = docOf(s);
    assert.deepEqual(doc?.messages.map((m) => [m.text, m.status]), [
      ['첫째', 'pending'],
      ['둘째-가', 'pending'],
      ['둘째-나', 'pending'],
      ['셋째', 'pending'],
    ]);
    const out = flushable(s);
    assert.deepEqual(out.map((o) => o.id), ['c1', 'c2a', 'c2b', 'c3']);
    s = ack(s, out.map((o, i) => ({ opId: o.id, seq: 2 + i })));
    assert.equal(s.pending.length, 0);
    assert.deepEqual(docOf(s)?.messages.map((m) => [m.text, m.status, m.seq]), [
      ['첫째', 'sent', 2],
      ['둘째-가', 'sent', 3],
      ['둘째-나', 'sent', 4],
      ['셋째', 'sent', 5],
    ]);
    assert.equal(lastSeqOf(s), 5);
  });

  test('확인 응답 뒤 같은 op를 다시 큐에 넣어도(재시도) 다시 보내지 않는다', () => {
    const m = chat('c1', '안녕', T0 + 1000);
    let s = receive(emptyOutbox(), [{ ...create(), seq: 1 }]).state;
    s = enqueue(s, m);
    s = ack(s, [{ opId: m.id, seq: 2 }]);
    s = enqueue(s, m);
    assert.deepEqual(flushable(s), []);
    assert.equal(docOf(s)?.messages.length, 1);
  });

  test('구독으로 내 op가 확인 응답보다 먼저 와도 로그에는 한 번만 있고, 뒤늦은 확인 응답은 아무것도 바꾸지 않는다', () => {
    const m = chat('c1', '먼저 옴', T0 + 1000);
    let s = receive(emptyOutbox(), [{ ...create(), seq: 1 }]).state;
    s = enqueue(s, m);
    s = receive(s, [{ ...m, seq: 2 }]).state;
    const late = ack(s, [{ opId: m.id, seq: 2 }]);
    assert.equal(late, s);
    assert.equal(s.log.filter((o) => o.id === m.id).length, 1);
    assert.equal(s.pending.length, 0);
    assert.equal(docOf(s)?.messages.length, 1);
    assert.equal(docOf(s)?.messages[0].status, 'sent');
  });
});

describe('중복 op', () => {
  test('같은 id가 다른 seq로 다시 와도 처음 받은 것만 남는다', () => {
    const m = chat('c1', '한 번', T0 + 1000, junho.id);
    let s = receive(emptyOutbox(), [{ ...create(), seq: 1 }, { ...m, seq: 2 }]).state;
    const r = receive(s, [{ ...m, seq: 7 }]);
    assert.equal(r.changed, false);
    s = r.state;
    assert.deepEqual(s.log.map((o) => o.seq), [1, 2]);
    assert.equal(docOf(s)?.messages.length, 1);
  });

  test('foldOps도 같은 id를 한 번만 반영한다(대기본과 확정본이 함께 있으면 확정본)', () => {
    const m = chat('c1', '한 번', T0 + 1000);
    const doc = foldOps([create(), m, { ...m, seq: 2 }, m, { ...create(), seq: 1 }]);
    assert.equal(doc?.messages.length, 1);
    assert.equal(doc?.messages[0].status, 'sent');
  });

  test('무작위 50회: 서버 로그를 뒤섞고 중복해 여러 묶음으로 받아도 seq 순으로 접은 문서와 같다', () => {
    const serverLog: Op[] = [{ ...create(), seq: 1 }];
    let seq = 1;
    for (let i = 0; i < 12; i += 1) {
      seq += 1;
      const actor = i % 2 === 0 ? host.id : junho.id;
      // 저장 시각(at)과 도착 순서(seq)가 어긋나게 섞는다(필드 LWW는 at)
      const at = T0 + 10_000 + ((i * 7) % 12) * 1000;
      serverLog.push(
        i % 3 === 0
          ? { ...chat(`s${i}`, `메시지 ${i}`, at, actor), seq }
          : { ...setDay(`s${i}`, i % 2 === 0 ? '2026-10-18' : '2026-10-19', i % 4 < 2, at, actor), seq },
      );
    }
    const want = foldOps(serverLog);
    for (let k = 1; k <= 50; k += 1) {
      const rng = seededRng(k);
      const r = () => rng.float();
      const deliveries = [...serverLog, ...serverLog.filter(() => r() < 0.4)];
      for (let i = deliveries.length - 1; i > 0; i -= 1) {
        const j = Math.floor(r() * (i + 1));
        [deliveries[i], deliveries[j]] = [deliveries[j], deliveries[i]];
      }
      let s: OutboxState = emptyOutbox();
      while (deliveries.length > 0) s = receive(s, deliveries.splice(0, 1 + Math.floor(r() * 4))).state;
      assert.deepEqual(s.log.map((o) => o.seq), serverLog.map((o) => o.seq), `시드 ${k}`);
      assert.deepEqual(docOf(s), want, `시드 ${k}`);
    }
  });
});

describe('게스트 세션 30일', () => {
  const issue = () => issueGuest({ nickname: '민지', rng: seededRng(3), now: T0 });

  test('발급 30일 정각까지는 살아 있고, 30일 + 1ms에 만료된다', () => {
    const g = issue();
    assert.equal(g.kind, 'guest');
    assert.equal(g.expiresAt - g.issuedAt, 30 * DAY);
    assert.equal(SESSION_TTL_MS, 30 * DAY);
    assert.equal(isExpired(g, T0 + 30 * DAY), false);
    assert.equal(isExpired(g, T0 + 30 * DAY + 1), true);
  });

  test('29일마다 쓰면 1년이 지나도 같은 게스트로 이어지고, 마지막 사용 뒤 30일 + 1ms 쓰지 않으면 만료된다', async () => {
    const kv = memoryKV();
    const g = issue();
    await saveSession(kv, g);
    let now = T0;
    for (let i = 0; i < 13; i += 1) {
      now += 29 * DAY;
      const r = await restoreSession(kv, now);
      assert.equal(r.state, 'ok', `${i + 1}번째 사용`);
      if (r.state === 'ok') {
        assert.equal(r.session.userId, g.userId);
        assert.equal(r.session.deviceToken, g.deviceToken);
        assert.equal(r.session.expiresAt, now + 30 * DAY);
      }
    }
    assert.ok(now - T0 > 365 * DAY);
    const gone = await restoreSession(kv, now + 30 * DAY + 1);
    assert.equal(gone.state, 'expired');
    assert.equal(await kv.get(SESSION_KV_KEY), null, '만료 세션은 저장소에서도 지운다');
    // 한 번 만료되면 되살리지 않는다
    assert.equal((await restoreSession(kv, now + 30 * DAY + 2)).state, 'none');
  });

  test('만료된 게스트는 touch로 연장되지 않는다', () => {
    const g = issue();
    const r = touchOrExpire(g, T0 + 30 * DAY + 1);
    assert.equal(r.state, 'expired');
    const ok = touchOrExpire(g, T0 + 30 * DAY);
    assert.equal(ok.state, 'ok');
    if (ok.state === 'ok') assert.equal(ok.session.expiresAt, T0 + 60 * DAY);
  });
});
