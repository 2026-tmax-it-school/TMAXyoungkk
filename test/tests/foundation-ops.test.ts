import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Member, Op, OpBody, OpType, Spot, Trip } from '../src/types';
import {
  applyOp,
  foldOps,
  isEditLocked,
  lastOpAt,
  LOCK_EXEMPT,
  LOCKED_REASON,
  OP_OWNER,
  stampAt,
  validateOp,
} from '../src/core/ops';
import { lww, patchDay, patchSpot } from '../src/core/ops/lww';
import { atKst } from '../src/core/util';
import { scenarioTrip } from './helpers/fixtures';

/**
 * op 레지스트리와 공유 규칙(기반 소유). 패키지가 리듀서를 채워도 계속 참이어야 하는 것만 단언한다.
 * 그래서 방은 늘 활성 멤버 2명(그룹 모드)이고, op는 기간 안 시각에 방장·멤버가 보낸다.
 */

const T0 = atKst('2026-10-01', '10:00');

const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };
const guest: Member = { id: 'm-guest', userId: 'u-guest', nickname: '준호', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 };

function baseTrip(): Omit<Trip, 'lastSeq'> {
  const { lastSeq: _l, ...rest } = scenarioTrip();
  return { ...rest, id: 'trip-1', members: [host, guest], spots: [], messages: [] };
}

let n = 0;
function op(body: OpBody, meta: Partial<Pick<Op, 'id' | 'at' | 'seq' | 'actorId'>> = {}): Op {
  n += 1;
  return { id: meta.id ?? `op-${n}`, tripId: 'trip-1', actorId: meta.actorId ?? host.id, at: meta.at ?? T0 + n, seq: meta.seq, ...body } as Op;
}

const create = (seq?: number) => op({ type: 'trip/create', trip: baseTrip() }, { id: 'op-create', at: T0, seq });
const say = (id: string, text: string, meta: Partial<Pick<Op, 'at' | 'seq' | 'actorId'>> = {}) =>
  op({ type: 'chat/send', message: { id: `msg-${id}`, text } }, { id, actorId: guest.id, ...meta });

describe('OP_OWNER와 applyOp 라우팅', () => {
  test('모든 op 타입이 리듀서 파일 하나에 매핑된다', () => {
    const prefixToFile: Record<string, string> = {
      trip: 'trip',
      member: 'members',
      chat: 'chat',
      spot: 'spots',
      schedule: 'schedule',
      journal: 'journal',
    };
    const types = Object.keys(OP_OWNER) as OpType[];
    assert.equal(types.length, 34);
    for (const t of types) assert.equal(OP_OWNER[t], prefixToFile[t.split('/')[0]], t);
  });

  test('문서가 없으면 trip/create만 받는다', () => {
    assert.equal(applyOp(undefined, say('x', '안녕')), undefined);
    const doc = applyOp(undefined, create(1));
    assert.equal(doc?.id, 'trip-1');
    assert.equal(doc?.lastSeq, 1);
  });

  test('chat/send는 chat 리듀서로 가고, status는 op.seq 유무를 따른다', () => {
    let doc = applyOp(undefined, create(1));
    doc = applyOp(doc, say('a', '불국사 가자', { seq: 2 }));
    doc = applyOp(doc, say('b', '석굴암도'));
    const [a, b] = doc?.messages ?? [];
    assert.equal(a.status, 'sent');
    assert.equal(a.seq, 2);
    assert.equal(a.memberId, guest.id);
    assert.equal(b.status, 'pending');
    assert.equal(b.seq, undefined);
  });

  test('lastSeq는 max로만 오른다', () => {
    let doc = applyOp(undefined, create(1));
    doc = applyOp(doc, say('a', '1', { seq: 5 }));
    doc = applyOp(doc, say('b', '2', { seq: 3 }));
    doc = applyOp(doc, say('c', '3'));
    assert.equal(doc?.lastSeq, 5);
  });
});

describe('foldOps', () => {
  test('확정 로그는 seq 순, pending은 at 순으로 뒤에 붙는다', () => {
    const ops = [
      say('p2', '대기2', { at: T0 + 50 }),
      say('s3', '셋', { seq: 3, at: T0 + 100 }),
      create(1),
      say('p1', '대기1', { at: T0 + 1 }),
      say('s2', '둘', { seq: 2, at: T0 + 200 }),
    ];
    const doc = foldOps(ops);
    assert.deepEqual(
      doc?.messages.map((m) => m.text),
      ['둘', '셋', '대기1', '대기2'],
    );
    assert.equal(doc?.lastSeq, 3);
  });

  test('같은 id는 한 번만 반영하고, seq가 달린 쪽을 확정으로 본다', () => {
    const pending = say('dup', '한 번만', { at: T0 + 10 });
    const confirmed = { ...pending, seq: 2 };
    const doc = foldOps([create(1), pending, pending, confirmed, confirmed]);
    assert.equal(doc?.messages.length, 1);
    assert.equal(doc?.messages[0].status, 'sent');
    assert.equal(doc?.messages[0].seq, 2);
  });

  test('늦게 온 낮은 seq op도 다시 접으면 seq 자리에 들어간다', () => {
    const later = foldOps([create(1), say('s3', '셋', { seq: 3 })]);
    assert.deepEqual(later?.messages.map((m) => m.text), ['셋']);
    const refold = foldOps([create(1), say('s3', '셋', { seq: 3 }), say('s2', '둘', { seq: 2 })]);
    assert.deepEqual(refold?.messages.map((m) => m.text), ['둘', '셋']);
  });

  test('두 번째 trip/create는 무시된다', () => {
    const other = op({ type: 'trip/create', trip: { ...baseTrip(), title: '다른 제목' } }, { seq: 2 });
    const doc = foldOps([create(1), other]);
    assert.equal(doc?.title, baseTrip().title);
  });
});

describe('종료 잠금', () => {
  test('isEditLocked는 KST 종료일 다음 날부터 참이다', () => {
    const doc = { endDate: '2026-10-19' };
    assert.equal(isEditLocked(doc, atKst('2026-10-19', '23:59')), false);
    assert.equal(isEditLocked(doc, atKst('2026-10-20', '00:00')), true);
  });

  test('LOCK_EXEMPT는 journal/*, member/leave, member/anonymize, trip/delete다', () => {
    const journal = (Object.keys(OP_OWNER) as OpType[]).filter((t) => t.startsWith('journal/'));
    assert.deepEqual(
      [...LOCK_EXEMPT].sort(),
      [...journal, 'member/leave', 'member/anonymize', 'trip/delete'].sort(),
    );
  });

  test('종료 뒤 편집 op는 잠금 사유로 거부되고, 예외 op는 잠금 사유로 거부되지 않는다', () => {
    const doc = applyOp(undefined, create(1)) as Trip;
    const after = atKst('2026-10-21', '10:00');
    const edit = validateOp(doc, say('late', '늦은 편집', { at: after }));
    assert.deepEqual(edit, { ok: false, reason: LOCKED_REASON });
    const exempt: OpBody[] = [
      { type: 'journal/diaryShared', date: '2026-10-18' },
      { type: 'member/leave', memberId: guest.id },
      { type: 'member/anonymize', memberId: guest.id },
      { type: 'trip/delete' },
    ];
    for (const body of exempt) {
      const r = validateOp(doc, op(body, { at: after, actorId: body.type === 'trip/delete' ? host.id : guest.id }));
      if (!r.ok) assert.notEqual(r.reason, LOCKED_REASON, body.type);
    }
  });

  test('기간 안 편집은 잠금에 걸리지 않는다', () => {
    const doc = applyOp(undefined, create(1)) as Trip;
    const r = validateOp(doc, say('in', '기간 안', { at: atKst('2026-10-18', '12:00') }));
    if (!r.ok) assert.notEqual(r.reason, LOCKED_REASON);
  });
});

describe('lww·patchSpot·patchDay (FR-503·703 나중 저장 우선)', () => {
  test('lww 경계: 같은 at은 적용, 늦은 at 적용, 이른 at 무시', () => {
    assert.equal(lww(undefined, 1), true);
    assert.equal(lww(5, 5), true);
    assert.equal(lww(5, 6), true);
    assert.equal(lww(5, 4), false);
  });

  const spot: Spot = {
    id: 's1',
    placeId: 'p1',
    name: '불국사',
    category: '관광지',
    coord: { latitude: 35.79, longitude: 129.33 },
    proposals: [],
    pinned: false,
    stayMin: 90,
    createdAt: T0,
    edited: {},
  };

  test('patchSpot은 필드별로 edited를 갱신하고 늦은 at이 이긴다', () => {
    const a = patchSpot(spot, { stayMin: 120 }, 200);
    assert.equal(a.stayMin, 120);
    assert.equal(a.edited.stayMin, 200);
    const stale = patchSpot(a, { stayMin: 60, pinned: true }, 100);
    assert.equal(stale.stayMin, 120, '이른 저장은 무시');
    assert.equal(stale.pinned, true, '다른 필드는 따로 판정');
    assert.equal(stale.edited.pinned, 100);
    const later = patchSpot(stale, { stayMin: 45 }, 300);
    assert.equal(later.stayMin, 45);
    assert.equal(spot.stayMin, 90, '원본은 그대로');
  });

  test('patchSpot: undefined는 필드를 지우고, removedReason은 removedByUser와 같은 키다', () => {
    const d = patchSpot(spot, { fixedDate: '2026-10-18' }, 10);
    const cleared = patchSpot(d, { fixedDate: undefined }, 20);
    assert.equal('fixedDate' in cleared, false);
    assert.equal(cleared.edited.fixedDate, 20);
    const removed = patchSpot(spot, { removedByUser: true, removedReason: 'delay' }, 30);
    assert.equal(removed.removedReason, 'delay');
    assert.equal(removed.edited.removedByUser, 30);
  });

  test('patchDay는 없는 날짜를 만들고 필드별로 늦은 at이 이긴다', () => {
    const trip: Trip = { ...scenarioTrip(), days: [] };
    const a = patchDay(trip, '2026-10-18', { noReturn: true }, 100);
    const day = a.days.find((d) => d.date === '2026-10-18');
    assert.equal(day?.noReturn, true);
    assert.equal(day?.base, 'inherit');
    assert.equal(day?.edited?.noReturn, 100);
    const b = patchDay(a, '2026-10-18', { noReturn: false, transport: 'walk' }, 50);
    const day2 = b.days.find((d) => d.date === '2026-10-18');
    assert.equal(day2?.noReturn, true, '이른 저장은 무시');
    assert.equal(day2?.transport, 'walk', '다른 필드는 적용');
    const c = patchDay(b, '2026-10-17', { dayStart: '18:00' }, 10);
    assert.deepEqual(
      c.days.map((d) => d.date),
      ['2026-10-17', '2026-10-18'],
    );
  });

  test('patchDay: 바뀐 것이 없으면 같은 문서를 돌려준다', () => {
    const trip = patchDay({ ...scenarioTrip(), days: [] }, '2026-10-18', { noReturn: true }, 100);
    assert.equal(patchDay(trip, '2026-10-18', { noReturn: false }, 50), trip);
  });
});

describe('op 시각 도장(stampAt, 계약 A3 규칙 6)', () => {
  test('처음 op는 지금 시각 그대로다', () => {
    assert.equal(stampAt(T0, undefined), T0);
    assert.equal(lastOpAt([]), undefined);
  });

  test('가상 시각(10/18)에 편집한 뒤 기기 시각(9/23)으로 돌아가도 op.at은 뒤로 가지 않는다', () => {
    const virtual = atKst('2026-10-18', '15:00');
    const real = atKst('2026-09-23', '12:00');
    const last = lastOpAt([
      { id: 'a', tripId: 't', actorId: 'm', at: T0, type: 'trip/delete' },
      { id: 'b', tripId: 't', actorId: 'm', at: virtual, type: 'trip/delete' },
    ] as Op[]);
    assert.equal(last, virtual);
    const at = stampAt(real, last);
    assert.equal(at, virtual + 1);
    // 이렇게 찍힌 편집은 앞선 가상 시각 편집을 LWW로 이긴다
    assert.equal(lww(virtual, at), true);
  });

  test('시각이 앞으로 가면 지금 시각을 쓴다', () => {
    assert.equal(stampAt(T0 + 5000, T0), T0 + 5000);
  });
});
