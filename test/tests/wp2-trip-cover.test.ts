import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Member, Op, OpBody, Trip, TripCover } from '../src/types';
import { applyOp, foldOps, LOCKED_REASON, validateOp } from '../src/core/ops';
import { REASON } from '../src/core/ops/trip';
import { COVER_BYTES_MAX, coverProblem, coverUri } from '../src/core/trip/cover';
import { buildDays } from '../src/core/trip/create';
import { quickEditPatch } from '../src/core/trip/edit';
import { atKst } from '../src/core/util';

/**
 * 여행방 표지·빠른 수정(2026-10-10): 표지는 trip/update(방장만)로 넣고 빼며, 끝난 여행도 이름·표지는 바꾼다.
 */

const T0 = atKst('2026-10-01', '10:00');
const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };
const guest: Member = { id: 'm-g', userId: 'u-g', nickname: '준호', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 };
const COVER: TripCover = { mime: 'image/jpeg', data: 'AAAA' };

let n = 0;
function op(body: OpBody, actorId = host.id, at = T0 + ++n * 1000): Op {
  return { id: `cv-${n}-${actorId}`, tripId: 't1', actorId, at, ...body } as Op;
}
function create(extra: Partial<Trip> = {}): Op {
  return op({
    type: 'trip/create',
    trip: {
      id: 't1', title: '경주 2박 3일', region: 'gyeongju', startDate: '2026-10-17', endDate: '2026-10-19', transport: 'car',
      dayStart: '09:00', dayEnd: '21:00', days: buildDays('2026-10-17', '2026-10-19', null), legs: [], members: [host, guest],
      spots: [], messages: [], photos: [], visits: [], diaries: {}, createdAt: T0, createdBy: host.userId, ...extra,
    },
  });
}

test('표지 값 검사: 형식·base64·크기', () => {
  assert.equal(coverProblem(COVER), null);
  assert.ok(coverProblem({ mime: 'image/gif', data: 'AAAA' }));
  assert.ok(coverProblem({ mime: 'image/jpeg', data: '<svg>' }));
  assert.ok(coverProblem({ mime: 'image/jpeg', data: 'A'.repeat(Math.ceil((COVER_BYTES_MAX * 4) / 3) + 8) }));
  assert.ok(coverProblem(null));
  assert.equal(coverUri(COVER), 'data:image/jpeg;base64,AAAA');
  assert.equal(coverUri(undefined), undefined);
});

test('만들 때 표지를 넣고, 방장이 바꾸고 뺀다. 그룹원은 못 바꾼다', () => {
  const doc = foldOps([create({ cover: COVER })]);
  assert.deepEqual(doc?.cover, COVER);
  assert.equal(validateOp(undefined, create({ cover: { mime: 'image/gif', data: 'AAAA' } })).ok, false);

  const next: TripCover = { mime: 'image/png', data: 'BBBB' };
  const changed = applyOp(doc, op({ type: 'trip/update', patch: { cover: next } }));
  assert.deepEqual(changed?.cover, next);
  const removed = applyOp(changed, op({ type: 'trip/update', patch: { cover: null } }));
  assert.equal(removed?.cover, undefined);
  assert.ok(!('cover' in (removed ?? {})));

  const byGuest = validateOp(doc, op({ type: 'trip/update', patch: { cover: next } }, guest.id));
  assert.deepEqual(byGuest, { ok: false, reason: REASON.hostOnly });
  const bad = validateOp(doc, op({ type: 'trip/update', patch: { cover: { mime: 'image/jpeg', data: '' } } }));
  assert.equal(bad.ok, false);
});

test('끝난 여행: 이름·표지는 바꾸고, 날짜는 잠금이다', () => {
  const doc = foldOps([create()]);
  const late = atKst('2026-10-25', '10:00');
  assert.equal(validateOp(doc, op({ type: 'trip/update', patch: { title: '경주 추억', cover: COVER } }, host.id, late)).ok, true);
  assert.deepEqual(validateOp(doc, op({ type: 'trip/update', patch: { startDate: '2026-10-18' } }, host.id, late)), { ok: false, reason: LOCKED_REASON });
  assert.deepEqual(validateOp(doc, op({ type: 'trip/update', patch: { title: 'x', endDate: '2026-10-20' } }, host.id, late)), { ok: false, reason: LOCKED_REASON });
});

test('빠른 수정: 바뀐 값만 한 번에 담고, 끝난 여행은 날짜를 빼고 담는다', () => {
  const trip = { title: '경주 2박 3일', startDate: '2026-10-17', endDate: '2026-10-19', cover: COVER };
  assert.deepEqual(quickEditPatch(trip, { title: ' 경주 2박 3일 ', startDate: '2026-10-17', endDate: '2026-10-19' }), {});
  assert.deepEqual(quickEditPatch(trip, { title: '경주 가족 여행', cover: null, startDate: '2026-10-18', endDate: '2026-10-20' }), {
    title: '경주 가족 여행',
    cover: null,
    startDate: '2026-10-18',
    endDate: '2026-10-20',
  });
  assert.deepEqual(quickEditPatch(trip, { title: '경주', startDate: '2026-10-18', endDate: '2026-10-20' }, true), { title: '경주' });
  assert.deepEqual(quickEditPatch({ ...trip, cover: undefined }, { title: trip.title, cover: null }), {}, '없는 표지를 빼는 것은 바뀐 것이 아니다');
});
