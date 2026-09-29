import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DiaryEntry, Op, OpDraft, Photo, Trip } from '../src/types';
import { DELETED_MEMBER_NAME } from '../src/core/constants';
import { planAccountDeletion } from '../src/core/auth';
import { applyOp, isEditLocked, LOCKED_REASON, validateOp } from '../src/core/ops';
import { memberId, scenarioTrip, SCENARIO_T0 } from './helpers/fixtures';

/**
 * 계정 탈퇴 통합(plan.json qa.testTargets, 결정 22). WP1 planAccountDeletion 초안을
 * WP2 members·WP6 journal 실제 리듀서(applyOp)와 실제 검증(validateOp)으로 적용한다.
 * 방 하나짜리 기본 성질은 integration-cross가 본다. 여기서는 여러 방, 종료 잠금, 이미 나간 방, 일기 문단, 적용 순서를 본다.
 */

const kst = (iso: string) => Date.parse(`${iso}+09:00`);
/** 탈퇴 시각. 지난 여행(9/1~9/2)은 끝났고 경주 여행(10/17~10/19)은 아직이다 */
const NOW = kst('2026-10-05T12:00:00');
const T = SCENARIO_T0 + 3_600_000;

let n = 0;
function opOf(trip: Trip, draft: OpDraft, at: number, actorId: string): Op {
  n += 1;
  return { ...draft, id: `ad-op-${n}`, tripId: trip.id, actorId, at } as Op;
}

function dispatch(trip: Trip, draft: OpDraft, at: number, actorId: string): Trip {
  const op = opOf(trip, draft, at, actorId);
  const v = validateOp(trip, op);
  assert.ok(v.ok, `${draft.type} 거부: ${v.ok ? '' : v.reason}`);
  const next = applyOp(trip, op);
  assert.ok(next);
  return next;
}

function dispatchMany(trip: Trip, drafts: readonly OpDraft[], at: number, actorId: string): Trip {
  return drafts.reduce((t, d, i) => dispatch(t, d, at + i, actorId), trip);
}

function photo(id: string, owner: string, at: number): Photo {
  return {
    id,
    memberId: owner,
    sim: { label: id, tone: 1 },
    bytes: 1000,
    originalBytes: 1000,
    compressed: false,
    takenAt: at,
    source: 'estimated',
    uploadedAt: at,
  };
}

/** 같은 사람이 방마다 다른 memberId를 갖게 한다(멤버 행과 제안의 memberId를 함께 바꾼다) */
function renameMember(trip: Trip, from: string, to: string): Trip {
  return {
    ...trip,
    members: trip.members.map((m) => (m.id === from ? { ...m, id: to } : m)),
    spots: trip.spots.map((s) => ({
      ...s,
      proposals: s.proposals.map((p) => (p.memberId === from ? { ...p, memberId: to } : p)),
    })),
  };
}

const SUA_A = memberId('sua');
const SUA_B = 'm-sua-b';
const MINJI = memberId('minji');

/** 경주 여행(진행 전): 수아의 채팅 1개와 사진 2장, 민지 사진 1장 */
function tripA(): Trip {
  let t: Trip = { ...scenarioTrip(), id: 'trip-a' };
  t = dispatch(t, { type: 'chat/send', message: { id: 'msg-a-sua', text: '불국사 꼭 가자' } }, T, SUA_A);
  t = dispatch(t, { type: 'journal/photoAdded', photo: photo('pa-sua-1', SUA_A, T + 1) }, T + 1, SUA_A);
  t = dispatch(t, { type: 'journal/photoAdded', photo: photo('pa-sua-2', SUA_A, T + 2) }, T + 2, SUA_A);
  t = dispatch(t, { type: 'journal/photoAdded', photo: photo('pa-minji-1', MINJI, T + 3) }, T + 3, MINJI);
  return t;
}

/** 지난 여행(끝남): 수아는 사진 1장을 올린 뒤 이미 나갔다 */
function tripB(): Trip {
  const base = renameMember(scenarioTrip(), SUA_A, SUA_B);
  let t: Trip = { ...base, id: 'trip-b', title: '지난 여행', startDate: '2026-09-01', endDate: '2026-09-02', days: [] };
  const during = kst('2026-09-01T15:00:00');
  t = dispatch(t, { type: 'journal/photoAdded', photo: photo('pb-sua-1', SUA_B, during) }, during, SUA_B);
  t = dispatch(t, { type: 'journal/photoAdded', photo: photo('pb-minji-1', MINJI, during + 1) }, during + 1, MINJI);
  t = dispatch(t, { type: 'member/leave', memberId: SUA_B }, during + 2, SUA_B);
  return t;
}

test('여러 여행방: 방마다 그 방의 본인 멤버로 초안을 만들고, 끝난 방(편집 잠금)과 이미 나간 방에서도 적용된다', () => {
  const a = tripA();
  const b = tripB();
  const gone: Trip = { ...tripA(), id: 'trip-gone', deletedAt: T + 10 };
  assert.equal(isEditLocked(a, NOW), false);
  assert.equal(isEditLocked(b, NOW), true, '지난 여행은 편집 잠금 중이다');
  const pin = opOf(b, { type: 'spot/pin', spotId: b.spots[0].id, pinned: true }, NOW, MINJI);
  assert.deepEqual(validateOp(b, pin), { ok: false, reason: LOCKED_REASON }, '일반 편집은 잠금으로 거부된다');

  const plan = planAccountDeletion([a, b, gone], 'u-sua');
  assert.deepEqual(
    plan.map((p) => [p.tripId, p.actorId]),
    [
      ['trip-a', SUA_A],
      ['trip-b', SUA_B],
    ],
    '삭제된 방은 빼고, 방마다 그 방의 본인 멤버가 보낸다',
  );

  const leftAtBefore = b.members.find((m) => m.id === SUA_B)?.leftAt;
  const afterA = dispatchMany(a, plan[0].drafts, NOW, plan[0].actorId);
  const afterB = dispatchMany(b, plan[1].drafts, NOW, plan[1].actorId);

  assert.deepEqual(afterA.photos.map((p) => p.id), ['pa-minji-1'], '경주 여행: 본인 사진만 사라진다');
  assert.deepEqual(afterB.photos.map((p) => p.id), ['pb-minji-1'], '지난 여행: 나간 뒤에도 본인 사진은 지워진다');
  assert.equal(afterA.messages.find((m) => m.id === 'msg-a-sua')?.memberId, SUA_A, '채팅은 memberId를 유지한다');

  const ma = afterA.members.find((m) => m.id === SUA_A);
  const mb = afterB.members.find((m) => m.id === SUA_B);
  for (const m of [ma, mb]) {
    assert.equal(m?.nickname, DELETED_MEMBER_NAME);
    assert.equal(m?.anonymized, true);
    assert.equal(m?.leftReason, 'deleted', '나가기(left) 사유도 탈퇴로 바뀐다');
  }
  assert.equal(ma?.leftAt != null && ma.leftAt >= NOW, true, '참여 중이던 방은 탈퇴 시각에 나간다');
  assert.equal(mb?.leftAt, leftAtBefore, '이미 나간 방의 나간 시각은 그대로다');

  // 남은 멤버는 계속 쓴다(경주 여행은 수아가 빠져도 3명이라 그룹이다)
  dispatch(afterA, { type: 'chat/send', message: { id: 'msg-a-minji', text: '다음엔 같이 가자' } }, NOW + 100, MINJI);
  assert.deepEqual(planAccountDeletion([afterA, afterB], 'u-sua'), [], '다시 계획하면 남은 초안이 없다');
});

test('적용 순서: 익명 처리가 사진 삭제보다 먼저 닿아도 결과가 같다(나간 본인도 자기 사진을 지울 수 있다)', () => {
  const a = tripA();
  const [p] = planAccountDeletion([a], 'u-sua');
  assert.equal(p.drafts.at(-1)?.type, 'member/anonymize', '초안은 사진 삭제 뒤에 익명 처리다');
  const inOrder = dispatchMany(a, p.drafts, NOW, p.actorId);
  const reversed = dispatchMany(a, [...p.drafts].reverse(), NOW, p.actorId);
  // 나간 시각(leftAt)은 익명 처리 op 시각이라 순서에 따라 몇 ms 다를 수 있어 빼고 비교한다
  const strip = (t: Trip) => ({ ...t, members: t.members.map(({ leftAt: _leftAt, ...m }) => m) });
  assert.deepEqual(strip(reversed), strip(inOrder));
});

test('일기: 탈퇴한 사람 사진만 문단에서 빠지고, 사진이 빠진 자동 문장은 비우며, 고친 문장과 남은 사진은 그대로다', () => {
  let a = tripA();
  a = dispatch(a, { type: 'journal/photoAdded', photo: photo('pa-sua-3', SUA_A, T + 4) }, T + 4, SUA_A);
  const DATE = '2026-10-18';
  const entry: DiaryEntry = {
    date: DATE,
    status: 'auto',
    generatedAt: T + 5,
    blocks: [
      // 수아·민지 사진이 같이 있는 문단 → 민지 사진만 남고 자동 문장은 비운다
      { id: 'b1', time: '09:25', spotId: 's-gj-bulguksa', placeName: '불국사', photoIds: ['pa-sua-1', 'pa-minji-1'], text: '불국사에서 사진 2장' },
      // 수아 사진만 있고 도착 기록도 고친 적도 없는 문단 → 문단이 빠진다
      { id: 'b2', time: '11:07', spotId: 's-gj-seokguram', placeName: '석굴암', photoIds: ['pa-sua-2'], text: '석굴암에서 사진 1장' },
      // 수아 사진만 있지만 민지가 고친 문단 → 고친 문장은 남고 사진만 빠진다
      { id: 'b3', time: '12:57', spotId: 's-gj-gyochon-hanjeongsik', placeName: '교촌마을 한정식', photoIds: ['pa-sua-3'], text: '점심' },
    ],
  };
  a = dispatch(a, { type: 'journal/diaryGenerated', entry }, T + 5, MINJI);
  a = dispatch(a, { type: 'journal/diaryEdited', date: DATE, blockId: 'b3', text: '한정식 코스가 푸짐했다' }, T + 6, MINJI);

  const [p] = planAccountDeletion([a], 'u-sua');
  assert.deepEqual(
    p.drafts.filter((d) => d.type === 'journal/photoRemoved').map((d) => (d.type === 'journal/photoRemoved' ? d.photoId : '')),
    ['pa-sua-1', 'pa-sua-2', 'pa-sua-3'],
  );
  const after = dispatchMany(a, p.drafts, NOW, p.actorId);
  const blocks = after.diaries[DATE].blocks;
  assert.deepEqual(blocks.map((b) => b.id), ['b1', 'b3']);
  assert.deepEqual(blocks[0].photoIds, ['pa-minji-1']);
  assert.equal(blocks[0].text, '', '사진 수가 틀려진 자동 문장은 비운다');
  assert.deepEqual(blocks[1].photoIds, []);
  assert.equal(blocks[1].text, '한정식 코스가 푸짐했다', '사용자가 고친 문장은 남는다');
  assert.equal(
    after.diaries[DATE].blocks.some((b) => b.photoIds.some((id) => id.startsWith('pa-sua'))),
    false,
    '일기 어디에도 탈퇴한 사람 사진이 없다',
  );
});
