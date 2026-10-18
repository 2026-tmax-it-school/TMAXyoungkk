import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Op, OpBody, Spot } from '../src/types';
import { activeMembers } from '../src/core/group';
import * as spotOps from '../src/core/ops/spots';
import { buildPlan, plannedSpots } from '../src/core/planner';
import { priorityCompare, spotVoterIds, voteCount, votePinned } from '../src/core/spotUtil';
import { footActions, HOST_PICKS, voteInfo } from '../src/features/candidates/detail';
import { candidateView, pinLabel } from '../src/features/candidates/rows';
import { tableRoutes } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * 투표로 제외·고정 정하기와 방장 결정(2026-10-17 사용자 요청).
 * - 우선순위(제외 순서)는 표 수(제안자 표 + 채팅방 지도에서 켠 표)로 센다.
 * - 활성 멤버 과반의 표를 받으면 고정 취급(계산할 때만, 저장된 pinned는 그대로).
 * - 방장 결정(spot/hostPick): keep 꼭 넣기, drop 빼기, null 투표대로. 방장만 쓴다.
 */

let n = 0;
function op(actorId: string, body: OpBody, at = 1000): Op {
  n += 1;
  return { ...body, id: `vp-${n}`, tripId: 't1', actorId, at } as Op;
}

function spot(id: string, proposers: string[], extra: Partial<Spot> = {}): Spot {
  return {
    id,
    placeId: `p-${id}`,
    name: id,
    category: '관광지',
    coord: { latitude: 35.8, longitude: 129.2 },
    proposals: proposers.map((memberId, i) => ({ memberId, source: 'chat' as const, at: 100 + i })),
    pinned: false,
    stayMin: 60,
    createdAt: 100,
    edited: {},
    ...extra,
  };
}

const members = (ids: string[]) => ids.map((id) => ({ id }));

describe('표 수와 과반 자동 고정', () => {
  test('제안자는 처음부터 한 표, 끄면 빠지고, 지도에서 켠 표가 더해진다', () => {
    const s = spot('a', ['m1', 'm2'], { votes: { m2: { on: false, at: 5 }, m3: { on: true, at: 6 } } });
    assert.deepEqual(spotVoterIds(s).sort(), ['m1', 'm3']);
    assert.equal(voteCount(s), 2);
    // 나간 멤버의 표는 활성 목록으로 거른다
    assert.deepEqual(spotVoterIds(s, members(['m1'])), ['m1']);
  });

  test('우선순위는 제안자 수가 아니라 표 수다', () => {
    const twoProposers = spot('b', ['m1', 'm2'], { createdAt: 100 });
    const voted = spot('a', ['m1'], { createdAt: 200, votes: { m2: { on: true, at: 1 }, m3: { on: true, at: 1 } } });
    assert.ok(priorityCompare(voted, twoProposers) < 0, '표 3이 표 2보다 앞선다');
    // 표가 같으면 등록이 이른 쪽이 앞선다(FR-403 그대로)
    const same = spot('c', ['m1', 'm2'], { createdAt: 300 });
    assert.ok(priorityCompare(twoProposers, same) < 0);
  });

  test('활성 멤버 과반이면 고정 취급, 혼자인 방과 방장 결정이 있는 후보는 아니다', () => {
    const three = members(['m1', 'm2', 'm3']);
    assert.equal(votePinned(spot('a', ['m1', 'm2']), three), true);
    assert.equal(votePinned(spot('a', ['m1']), three), false);
    assert.equal(votePinned(spot('a', ['m1', 'm2']), members(['m1', 'm2', 'm3', 'm4'])), false, '4명 중 2표는 과반이 아니다');
    assert.equal(votePinned(spot('a', ['m1']), members(['m1'])), false);
    assert.equal(votePinned(spot('a', ['m1', 'm2'], { hostPick: 'drop' }), three), false);
  });
});

describe('계획 입력(plannedSpots)과 buildPlan', () => {
  test('방장이 뺀 후보는 빠지고, 꼭 넣기와 과반 표는 고정으로 넘긴다(저장값은 그대로)', () => {
    const t = scenarioTrip();
    const active = activeMembers(t);
    const [a, b, c] = t.spots;
    t.spots = t.spots.map((s) => (s.id === a.id ? { ...s, hostPick: 'drop' as const } : s.id === b.id ? { ...s, hostPick: 'keep' as const } : s));
    const planned = plannedSpots(t);
    assert.ok(!planned.some((s) => s.id === a.id));
    assert.equal(planned.find((s) => s.id === b.id)?.pinned, true);
    assert.equal(planned.find((s) => s.id === c.id)?.pinned, c.pinned || votePinned(c, active));
    assert.equal(t.spots.find((s) => s.id === b.id)?.pinned, false, '문서의 pinned는 바뀌지 않는다');
  });

  test("방장이 뺀 후보는 제외 사유 '방장이 뺌'(hostDropped)으로 나오고 후보 행에 다시 넣기 대상이 아니다", async () => {
    const t = scenarioTrip();
    const target = t.spots[0];
    t.spots = t.spots.map((s) => (s.id === target.id ? { ...s, hostPick: 'drop' as const } : s));
    const plan = await buildPlan(t, { routes: tableRoutes(), now: 0 });
    const ex = plan.excluded.find((e) => e.spotId === target.id);
    assert.equal(ex?.reasonCode, 'hostDropped');
    assert.equal(ex?.reason, '방장이 뺌');
    assert.ok(!plan.days.some((d) => d.items.some((i) => i.spotId === target.id)));
    const view = candidateView(t, plan);
    assert.equal(view.excluded.find((r) => r.spotId === target.id)?.reasonCode, 'hostDropped');
  });
});

describe('spot/hostPick op', () => {
  test('방장만 쓸 수 있고, keep·drop·null만 받는다', () => {
    const trip = scenarioTrip();
    const host = trip.members.find((m) => m.role === 'host')!;
    const member = activeMembers(trip).find((m) => m.role !== 'host')!;
    const spotId = trip.spots[0].id;
    assert.equal(spotOps.validate(trip, op(member.id, { type: 'spot/hostPick', spotId, pick: 'keep' })), '방장만 정할 수 있어요');
    assert.equal(spotOps.validate(trip, op(host.id, { type: 'spot/hostPick', spotId, pick: 'keep' })), null);
    assert.equal(spotOps.validate(trip, op(host.id, { type: 'spot/hostPick', spotId: 'nope', pick: 'keep' })), '후보를 찾을 수 없습니다');
  });

  test('필드 LWW: 고르고, null이면 지우고, 늦게 온 옛 결정은 무시', () => {
    const trip = scenarioTrip();
    const host = trip.members.find((m) => m.role === 'host')!;
    const spotId = trip.spots[0].id;
    let d = spotOps.reduce(trip, op(host.id, { type: 'spot/hostPick', spotId, pick: 'drop' }, 100));
    assert.equal(d.spots[0].hostPick, 'drop');
    d = spotOps.reduce(d, op(host.id, { type: 'spot/hostPick', spotId, pick: null }, 200));
    assert.equal(d.spots[0].hostPick, undefined);
    d = spotOps.reduce(d, op(host.id, { type: 'spot/hostPick', spotId, pick: 'keep' }, 150));
    assert.equal(d.spots[0].hostPick, undefined, '옛 결정이 새 결정을 덮지 않는다');
  });
});

describe('화면 계산: 투표 카드, 고정 칩, 아래 버튼', () => {
  test('pinLabel: 방장 결정 > 직접 고정 > 투표 과반', () => {
    const three = members(['m1', 'm2', 'm3']);
    assert.equal(pinLabel(spot('a', ['m1'], { hostPick: 'keep', pinned: true }), three), '방장이 넣음');
    assert.equal(pinLabel(spot('a', ['m1'], { pinned: true }), three), '고정');
    assert.equal(pinLabel(spot('a', ['m1', 'm2']), three), '투표로 고정');
    assert.equal(pinLabel(spot('a', ['m1']), three), null);
  });

  test('voteInfo 문장과 방장 고르기 목록', () => {
    const trip = scenarioTrip();
    const active = activeMembers(trip).length;
    const one = spot('a', [activeMembers(trip)[0].id]);
    const info = voteInfo(trip, one);
    assert.equal(info.votes, 1);
    assert.equal(info.need, Math.floor(active / 2) + 1);
    assert.match(info.text, /표 1\//);
    assert.match(voteInfo(trip, { ...one, hostPick: 'drop' }).text, /^방장이 빼기로/);
    assert.match(voteInfo(trip, { ...one, hostPick: 'keep' }).text, /^방장이 꼭 넣기로/);
    assert.deepEqual(HOST_PICKS.map((p) => p.label), ['투표대로', '꼭 넣기', '빼기']);
  });

  test('방장이 뺀 후보는 아래 버튼이 없다(방장 결정으로만 돌아온다)', () => {
    assert.deepEqual(footActions({ status: 'excluded', pinned: false, hostDropped: true }, false), []);
    assert.equal(footActions({ status: 'excluded', pinned: false }, false)[0].key, 'restore');
  });
});
