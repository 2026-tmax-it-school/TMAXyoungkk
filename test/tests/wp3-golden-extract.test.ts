import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Member, Op, OpBody, Trip } from '../src/types';
import { extractForMessage } from '../src/core/extract';
import * as chat from '../src/core/ops/chat';
import * as spots from '../src/core/ops/spots';
import { proposerIds } from '../src/core/spotUtil';
import { regionById } from '../src/data/regions';
import { patchSpot } from '../src/core/ops/lww';
import {
  SCENARIO_CHAT,
  SCENARIO_EXPECTED,
  SCENARIO_LINE_MS,
  SCENARIO_MEMBERS,
  SCENARIO_T0,
  SCENARIO_USER_ACTIONS,
} from '../src/data/scenario';
import { createExtractionProvider } from '../src/services/extraction';
import { createPlaceProvider } from '../src/services/places';
import { fakeFetch, seqIds } from './helpers/fakes';

/**
 * 시나리오 골든 추출(WP3). 채팅 13줄을 규칙 기반 추출 + 로컬 장소 사전으로 돌리면
 * 후보 14곳의 이름·카테고리·제안자(첫 언급 순)가 부록 B 표와 정확히 같다. 황리단길 4, 불국사 3, 석굴암 2.
 * 다른 패키지 리듀서에 기대지 않도록 여행방은 멤버 4명이 이미 있는 상태로 만들고 WP3 리듀서만 쓴다.
 * 사용자 조작(SCENARIO_USER_ACTIONS)도 같은 줄 뒤에 적용한다. 고정은 spot/pin(WP3)이고, 날짜 지정은
 * schedule/setDate(WP4 리듀서)라 여기서는 그 리듀서가 쓰는 공유 patchSpot을 바로 부른다.
 */

const region = regionById('gyeongju');
const mid = (key: string) => `m-${key}`;

function baseTrip(): Trip {
  const members: Member[] = SCENARIO_MEMBERS.map((m, i) => ({
    id: mid(m.key),
    userId: `u-${m.key}`,
    nickname: m.nickname,
    role: m.role,
    isGuest: true,
    canInvite: false,
    joinedAt: SCENARIO_T0 + i,
  }));
  return {
    id: 't',
    title: '경주 2박 3일',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: [],
    legs: [],
    members,
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: SCENARIO_T0,
    createdBy: 'u-minji',
    lastSeq: 0,
  };
}

async function replay(): Promise<{ trip: Trip; opCount: number }> {
  assert.ok(region);
  const fetch = fakeFetch(() => ({ status: 500, body: '네트워크 금지' }));
  const places = createPlaceProvider({ fetch });
  const extraction = createExtractionProvider({ fetch });
  const ids = seqIds();
  let trip = baseTrip();
  let seq = 0;
  const apply = (actorId: string, at: number, body: OpBody) => {
    seq += 1;
    const op = { ...body, id: `op_${seq}`, tripId: trip.id, actorId, at, seq } as Op;
    const reducer = op.type.startsWith('chat/') ? chat : spots;
    const reason = reducer.validate(trip, op);
    assert.equal(reason, null, `${op.type} 거부: ${reason}`);
    trip = reducer.reduce(trip, op);
  };
  for (const line of SCENARIO_CHAT) {
    const at = SCENARIO_T0 + line.line * SCENARIO_LINE_MS;
    const actor = mid(line.from);
    const messageId = `msg_${line.line}`;
    apply(actor, at, { type: 'chat/send', message: { id: messageId, text: line.text } });
    const r = await extractForMessage(trip, { id: messageId, text: line.text, memberId: actor }, { extraction, places, region, ids, at });
    apply(actor, at, { type: 'spot/extracted', messageId, ...r });
    for (const a of SCENARIO_USER_ACTIONS.filter((x) => x.afterLine === line.line)) {
      const spot = trip.spots.find((s) => s.placeId === a.placeId);
      assert.ok(spot, `조작 대상 후보가 없다: ${a.placeId}`);
      if (a.kind === 'pin') apply(mid(a.by), at, { type: 'spot/pin', spotId: spot.id, pinned: true });
      else trip = { ...trip, spots: trip.spots.map((s) => (s.id === spot.id ? patchSpot(s, { fixedDate: a.date }, at) : s)) };
    }
  }
  assert.equal(fetch.calls.length, 0, '로컬 제공자는 네트워크를 쓰지 않는다');
  return { trip, opCount: seq };
}

test('채팅 13줄 → 후보 14곳, 이름·카테고리·제안자가 부록 B와 같다', async () => {
  const { trip } = await replay();
  assert.equal(trip.spots.length, SCENARIO_EXPECTED.totals.candidates);
  const byCreated = [...trip.spots].sort((a, b) => a.createdAt - b.createdAt);
  assert.deepEqual(
    byCreated.map((s) => ({ placeId: s.placeId, name: s.name, category: s.category, proposers: proposerIds(s) })),
    SCENARIO_EXPECTED.candidates.map((c) => ({
      placeId: c.placeId,
      name: c.name,
      category: c.category,
      proposers: c.proposers.map(mid),
    })),
  );
});

test('제안자 수 황리단길 4 · 불국사 3 · 석굴암 2, 체류는 카테고리 기본값', async () => {
  const { trip } = await replay();
  const count = (name: string) => proposerIds(trip.spots.find((s) => s.name === name)!).length;
  assert.equal(count('황리단길'), 4);
  assert.equal(count('불국사'), 3);
  assert.equal(count('석굴암'), 2);
  for (const c of SCENARIO_EXPECTED.candidates) {
    assert.equal(trip.spots.find((s) => s.placeId === c.placeId)?.stayMin, c.stayMin, c.name);
  }
});

test('등록 시각이 모두 다르다(FR-403 동점이 id 비교로 가지 않는다)', async () => {
  const { trip } = await replay();
  assert.equal(new Set(trip.spots.map((s) => s.createdAt)).size, trip.spots.length);
  // 1번 줄의 두 곳은 at + 등장 순서(ms)다
  const t1 = SCENARIO_T0 + SCENARIO_LINE_MS;
  assert.equal(trip.spots.find((s) => s.name === '불국사')?.createdAt, t1);
  assert.equal(trip.spots.find((s) => s.name === '석굴암')?.createdAt, t1 + 1);
});

test('말풍선 강조 구간은 원문 부분 문자열이다(9번 줄 숙소는 잡지 않는다)', async () => {
  const { trip } = await replay();
  for (const m of trip.messages) {
    for (const h of m.extraction?.highlights ?? []) {
      const phrase = m.text.slice(h.start, h.end);
      assert.ok(phrase.length >= 2 && !/\s$/.test(phrase), `${m.text} → ${phrase}`);
    }
  }
  const line9 = trip.messages.find((m) => m.id === 'msg_9');
  assert.deepEqual(
    line9?.extraction?.highlights.map((h) => line9.text.slice(h.start, h.end)),
    ['보문호', '경주월드'],
  );
});

test('사용자 조작: 수아가 교촌마을 한정식을 고정하고 10/18로 지정한다(추출은 고정을 추론하지 않는다)', async () => {
  const { trip } = await replay();
  const g = trip.spots.find((s) => s.placeId === 'gj-gyochon-hanjeongsik');
  assert.equal(g?.pinned, true);
  assert.equal(g?.fixedDate, '2026-10-18');
  assert.equal(trip.spots.filter((s) => s.pinned).length, 1);
});

test('두 번 돌려도 같다', async () => {
  const a = await replay();
  const b = await replay();
  assert.deepEqual(
    a.trip.spots.map((s) => [s.name, proposerIds(s)]),
    b.trip.spots.map((s) => [s.name, proposerIds(s)]),
  );
});
