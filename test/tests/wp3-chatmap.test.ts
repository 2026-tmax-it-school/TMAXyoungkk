import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSyncStore } from '../server/sync-server.mjs';
import { projectOps } from '../server/db/projection.mjs';
import { areaChipLabel, areaIndex, areaOf, ETC_AREA, groupAreas, MAX_AREAS, parseArea } from '../src/core/chatmap/areas';
import {
  CHAT_MAP_INITIAL,
  chatMapInput,
  chatMapLayout,
  chatMapStep,
  FIT_ALL_RESERVE,
  pinScaleFor,
  RAIL_MIN_H,
  RAIL_TOP,
  railLayout,
  voteLabel,
  WIDE_FREE_MIN,
  WIDE_SHEET_W,
  type ChatMapState,
} from '../src/core/chatmap/mapView';
import {
  barRatio,
  costsVote,
  hasVote,
  mentionsOf,
  railOrder,
  rankSpots,
  usedVotes,
  VOTE_BUDGET,
  VOTE_BUDGET_REASON,
  voteBlocked,
  voteCounts,
  voterIds,
  votesLeft,
} from '../src/core/chatmap/votes';
import { activeMembers } from '../src/core/group';
import { pinName } from '../src/core/map/engine';
import { fitAreaHeight, layoutMap, MIN_FIT_H } from '../src/core/map/layout';
import { foldOps, LOCKED_REASON, OP_OWNER, validateOp } from '../src/core/ops';
import { patchVote } from '../src/core/ops/lww';
import * as spots from '../src/core/ops/spots';
import { markDirty, needsRecompute } from '../src/core/trip/outbox';
import {
  budgetLine,
  budgetNote,
  rankA11y,
  rankMeta,
  rankTone,
  topLine,
  VOTE_REMOVED_REASON,
  whoCount,
  whoName,
  whoTitle,
} from '../src/features/chat/map/text';
import type { LatLng, Member, Op, OpBody, Spot, Trip } from '../src/types';
import { mapPinSvg } from '../src/ui/mapPinSvg';
import { H, SP, surfaceC } from '../src/ui/tokens';
import { listFiles, read, stripComments } from './setup/scan';

/**
 * 채팅방 지도 · 투표(FR-405, 명세 밖 추가, WP3). 지역 규칙, spot/vote op(멤버별 LWW, placeId 별칭),
 * 표 계산(순위·말한 장소·왼쪽 열), 지도 입력(라벨·흐림·크기·맞춤), 화면 상태 바뀜, 서버 저장, 소스 규칙.
 */

const GJ = { name: '경주', label: '경상북도 경주시' };
const JEJU = { name: '제주', label: '제주특별자치도' };
const SEOUL = { name: '서울', label: '서울특별시' };
const SUWON = { name: '수원', label: '경기도 수원시' };

const C: Record<string, LatLng> = {
  gyodong: { latitude: 35.8299, longitude: 129.2154 },
  gyochon: { latitude: 35.8298, longitude: 129.2145 },
  hwangnam: { latitude: 35.8371, longitude: 129.2104 },
  bomun1: { latitude: 35.8421, longitude: 129.2851 },
  bomun2: { latitude: 35.8398, longitude: 129.2869 },
  bulguk: { latitude: 35.7898, longitude: 129.3320 },
};

function member(k: string, i: number, extra: Partial<Member> = {}): Member {
  return {
    id: `m-${k}`,
    userId: `u-${k}`,
    nickname: k.toUpperCase(),
    role: i === 0 ? 'host' : 'member',
    isGuest: true,
    canInvite: false,
    joinedAt: 0,
    ...extra,
  };
}

function baseTrip(): Trip {
  return {
    id: 't1',
    title: '경주',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: [],
    legs: [],
    members: ['a', 'b', 'c'].map((k, i) => member(k, i)),
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 0,
    createdBy: 'u-a',
    lastSeq: 0,
  } as unknown as Trip;
}

type Said = [memberId: string, source: 'chat' | 'manual', messageId: string | undefined, at: number];

function spot(
  id: string,
  name: string,
  o: { placeId?: string; address?: string; coord?: LatLng; said?: Said[]; createdAt?: number; removed?: boolean; votes?: Spot['votes'] } = {},
): Spot {
  const s: Spot = {
    id,
    placeId: o.placeId ?? `p-${id}`,
    name,
    category: '관광지',
    coord: o.coord ?? C.gyodong,
    proposals: (o.said ?? [['m-a', 'manual', undefined, 1]]).map(([memberId, source, messageId, at]) =>
      messageId ? { memberId, source, messageId, at } : { memberId, source, at },
    ),
    pinned: false,
    stayMin: 60,
    createdAt: o.createdAt ?? 1,
    edited: {},
  } as Spot;
  if (o.address) s.address = o.address;
  if (o.removed) s.removedByUser = true;
  if (o.votes) s.votes = o.votes;
  return s;
}

let n = 0;
function op(actorId: string, body: OpBody, at: number, seq?: number): Op {
  n += 1;
  const o = { ...body, id: `op-${n}`, tripId: 't1', actorId, at } as Op;
  if (seq != null) o.seq = seq;
  return o;
}

function createOp(seq = 1): Op {
  const { lastSeq: _l, ...t } = baseTrip();
  return op('m-a', { type: 'trip/create', trip: t }, 10, seq);
}

/** 확정 로그: 방 만들기, m-a가 불국사를 말함(s1) */
function baseLog(): Op[] {
  const s1 = spot('s1', '불국사', { placeId: 'gj-bulguksa', said: [['m-a', 'chat', 'x1', 20]] });
  return [
    createOp(1),
    op('m-a', { type: 'chat/send', message: { id: 'x1', text: '불국사 가자' } }, 20, 2),
    op('m-a', { type: 'spot/extracted', messageId: 'x1', created: [s1], mergedSpotIds: [], ambiguous: [], highlights: [] }, 21, 3),
  ];
}

const vote = (actor: string, on: boolean, at: number, seq?: number, spotId = 's1', placeId = 'gj-bulguksa') =>
  op(actor, { type: 'spot/vote', spotId, placeId, on }, at, seq);

const s1Of = (d: Trip | undefined) => d?.spots.find((s) => s.placeId === 'gj-bulguksa') as Spot;

describe('지역 규칙(areaOf, groupAreas)', () => {
  test('경주: 동·읍·면은 그대로, 도로는 loose, 번길 꼬리를 떼고, 지역 밖·주소 없음은 기타', () => {
    assert.equal(areaOf('경상북도 경주시 황남동', GJ), '황남동');
    assert.equal(areaOf('경상북도 경주시 황남동 포석로 일대', GJ), '황남동');
    assert.equal(areaOf('경상북도 경주시 교동 (예시)', GJ), '교동');
    assert.equal(areaOf('경상북도 경주시 건천읍 신경주역로 80', GJ), '건천읍');
    assert.equal(areaOf('경상북도 경주시 문무대왕면 용당리', GJ), '문무대왕면');
    assert.equal(areaOf('경상북도 경주시 성건1동 12', GJ), '성건동', '동 앞 숫자는 지운다');
    assert.deepEqual(parseArea('경상북도 경주시 보문로 544', GJ), { name: '보문로', loose: true });
    assert.deepEqual(parseArea('경상북도 경주시 교촌길 39-2', GJ), { name: '교촌길', loose: true });
    assert.deepEqual(parseArea('경북 경주시 첨성로99번길 3', GJ), { name: '첨성로', loose: true }, '축약형 도 이름과 번길');
    assert.equal(areaOf('경상북도 포항시 남구 호미곶면 대보리', GJ), ETC_AREA);
    assert.equal(areaOf(undefined, GJ), ETC_AREA);
    assert.equal(areaOf('경상북도 경주시', GJ), ETC_AREA);
    assert.equal(areaOf('경상북도 경주시 황남동', undefined), ETC_AREA);
  });

  test('제주·서울·수원: 시 아래 읍면이 있으면 읍면, 없으면 시·구', () => {
    assert.equal(areaOf('제주특별자치도 제주시 애월읍 곽지리 1565', JEJU), '애월읍');
    assert.equal(areaOf('제주특별자치도 제주시 한림읍 협재리', JEJU), '한림읍');
    assert.equal(areaOf('제주특별자치도 서귀포시 성산읍 일출로 284', JEJU), '성산읍');
    assert.equal(areaOf('제주특별자치도 제주시 관덕로 14', JEJU), '제주시');
    assert.equal(areaOf('제주특별자치도 서귀포시 중문관광로 72', JEJU), '서귀포시');
    assert.equal(areaOf('제주 제주시 애월읍 곽지리', JEJU), '애월읍', '도 이름이 짧아도 지역 이름으로 시작하는 시를 받는다');
    assert.equal(areaOf('서울특별시 종로구 사직로 161', SEOUL), '종로구');
    assert.equal(areaOf('경기도 수원시 팔달구 정조로 825', SUWON), '팔달구');
  });

  test('카카오가 줄여 쓰는 광역시·특별시 주소(서울 종로구, 부산 해운대구)도 지역 안으로 본다', () => {
    const BUSAN = { name: '부산', label: '부산광역시' };
    assert.equal(areaOf('서울 종로구 사직로 161', SEOUL), '종로구');
    assert.equal(areaOf('부산 해운대구 해운대해변로 264', BUSAN), '해운대구');
    assert.equal(areaOf('대구 중구 동성로 1', { name: '대구', label: '대구광역시' }), '중구');
    assert.equal(areaOf('부산 해운대구 해운대해변로 264', SEOUL), ETC_AREA, '다른 광역시는 여전히 지역 밖');
    assert.equal(areaOf('제주 제주시 애월읍 곽지리', JEJU), '애월읍', '시 토큰이 있으면 그쪽이 먼저다');
    const seoul = [
      spot('k1', '경복궁', { address: '서울 종로구 사직로 161', said: [['m-a', 'chat', 'x1', 1]] }),
      spot('k2', '광장시장', { address: '서울 종로구 창경궁로 88', said: [['m-b', 'chat', 'x2', 2]] }),
      spot('k3', '남산타워', { address: '서울 용산구 남산공원길 105', said: [['m-b', 'chat', 'x3', 3]] }),
    ];
    assert.deepEqual(
      groupAreas(seoul, SEOUL, activeMembers(baseTrip())).map((a) => a.name),
      ['종로구', '용산구'],
      '기타 하나로 뭉치지 않는다',
    );
  });

  test('groupAreas: 2km 안 도로는 가까운 기준 지역에, 아니면 {도로} 일대. 정렬·기타 마지막·제외·활성 멤버만', () => {
    const leftC = member('c', 2, { leftAt: 5 });
    const members = [member('a', 0), member('b', 1), leftC];
    const active = members.filter((m) => m.leftAt == null);
    const list = [
      spot('g1', '교동 최씨 고택', { address: '경상북도 경주시 교동', coord: C.gyodong, said: [['m-a', 'chat', 'x1', 1]] }),
      spot('g2', '교촌마을', { address: '경상북도 경주시 교촌길 39-2', coord: C.gyochon, said: [['m-b', 'chat', 'x2', 2]] }),
      spot('h1', '황남동 카페', { address: '경상북도 경주시 황남동', coord: C.hwangnam, said: [['m-c', 'chat', 'x3', 3]] }),
      spot('b1', '보문 호수', { address: '경상북도 경주시 보문로 544', coord: C.bomun1, said: [['m-a', 'chat', 'x4', 4]] }),
      spot('b2', '보문 카페', { address: '경상북도 경주시 보문로 338', coord: C.bomun2, said: [['m-a', 'chat', 'x5', 5]] }),
      spot('e1', '어딘가', { said: [['m-b', 'manual', undefined, 6]] }),
      spot('r1', '뺀 곳', { address: '경상북도 경주시 교동', removed: true, said: [['m-b', 'chat', 'x7', 7]] }),
    ];
    const areas = groupAreas(list, GJ, active);
    assert.deepEqual(
      areas.map((a) => [a.name, a.spotIds, a.pickerIds]),
      [
        ['교동', ['g1', 'g2'], ['m-a', 'm-b']],
        ['보문로 일대', ['b1', 'b2'], ['m-a']],
        ['황남동', ['h1'], []],
        [ETC_AREA, ['e1'], ['m-b']],
      ],
    );
    assert.equal(areaChipLabel(areas[0]), '교동 2명');
    assert.equal(areaChipLabel(areas[2]), '황남동 0명', '나간 멤버만 말한 곳은 0명');
    const idx = areaIndex(areas);
    assert.equal(idx.g2, '교동');
    assert.equal(idx.r1, undefined, '제외된 스팟은 어디에도 없다');
    assert.deepEqual(groupAreas([], GJ, active), []);
  });

  test('groupAreas: 8개를 넘으면 뒤쪽을 기타로 접고, 기타는 늘 마지막이다', () => {
    const names = ['가동', '나동', '다동', '라동', '마동', '바동', '사동', '아동', '자동', '차동'];
    const list = names.map((d, i) =>
      spot(`d${i}`, d, { address: `경상북도 경주시 ${d}`, said: [['m-a', 'chat', `x${i}`, i + 1]], createdAt: i }),
    );
    const areas = groupAreas(list, GJ, [member('a', 0)]);
    assert.equal(areas.length, MAX_AREAS);
    assert.deepEqual(areas.slice(0, 7).map((a) => a.name), names.slice(0, 7));
    assert.equal(areas[7].name, ETC_AREA);
    assert.deepEqual(areas[7].spotIds, ['d7', 'd8', 'd9']);
  });
});

describe('spot/vote op(멤버별 LWW, 툼스톤, placeId 별칭)', () => {
  test('OP_OWNER와 재계산: spots가 맡고, 표가 바뀌면 계획을 다시 계산한다(오프라인이면 dirty, 2026-10-17)', () => {
    assert.equal(OP_OWNER['spot/vote'], 'spots');
    assert.equal(needsRecompute('spot/vote'), true);
    assert.equal(needsRecompute('spot/pin'), true);
    assert.equal(needsRecompute('spot/hostPick'), true);
    const dirty = {};
    assert.deepEqual(markDirty(dirty, 't1', { type: 'spot/vote' }, false), { t1: true });
    assert.deepEqual(markDirty(dirty, 't1', { type: 'spot/pin' }, false), { t1: true });
  });

  test('켜기 → 끄기 → 켜기, 늦게 온 옛 표는 무시(툼스톤이 이긴다), 같은 at은 뒤에 접힌 쪽', () => {
    let d = foldOps([...baseLog(), vote('m-b', true, 100, 4), vote('m-b', false, 200, 5), vote('m-b', true, 300, 6)]);
    assert.deepEqual(s1Of(d).votes?.['m-b'], { on: true, at: 300 });
    // 끈 뒤에 그보다 오래된 켜기가 늦게 도착한다
    d = foldOps([...baseLog(), vote('m-b', false, 500, 4), vote('m-b', true, 400, 5)]);
    assert.deepEqual(s1Of(d).votes?.['m-b'], { on: false, at: 500 });
    assert.equal(hasVote(s1Of(d), 'm-b'), false);
    // 같은 at이면 뒤에 접힌 op가 이긴다(lww 규칙)
    const s = s1Of(foldOps(baseLog()));
    assert.equal(patchVote(patchVote(s, 'm-b', true, 50), 'm-b', false, 50).votes?.['m-b']?.on, false);
    assert.equal(patchVote(patchVote(s, 'm-b', false, 50), 'm-b', true, 49).votes?.['m-b']?.on, false);
  });

  test('두 멤버는 서로 영향이 없고, 같은 op를 다시 적용해도 그대로다', () => {
    const d = foldOps([...baseLog(), vote('m-b', true, 100, 4), vote('m-c', true, 90, 5), vote('m-c', false, 95, 6)]);
    assert.equal(hasVote(s1Of(d), 'm-b'), true);
    assert.equal(hasVote(s1Of(d), 'm-c'), false);
    const again = vote('m-b', false, 120, 7);
    const once = spots.reduce(d as Trip, again);
    assert.deepEqual(spots.reduce(once, again), once);
    // foldOps는 같은 id를 한 번만 접는다
    assert.deepEqual(foldOps([...baseLog(), again, { ...again, seq: undefined }]), foldOps([...baseLog(), again]));
  });

  test('확정 op와 대기 op를 어떤 순서로 접어도 표가 같다', () => {
    const confirmed = [...baseLog(), vote('m-b', true, 300, 4), vote('m-c', true, 100, 5)];
    const pending = [vote('m-b', false, 250), vote('m-c', false, 150), vote('m-a', false, 400)];
    const want = s1Of(foldOps([...confirmed, ...pending])).votes;
    const orders = [
      [...pending, ...confirmed],
      [...confirmed].reverse().concat([...pending].reverse()),
      [pending[2], confirmed[4], pending[0], ...confirmed.slice(0, 4), pending[1]],
    ];
    for (const o of orders) assert.deepEqual(s1Of(foldOps(o)).votes, want);
    assert.deepEqual(want, {
      'm-b': { on: true, at: 300 },
      'm-c': { on: false, at: 150 },
      'm-a': { on: false, at: 400 },
    });
  });

  test('다른 기기에서 같은 장소가 b1으로 합쳐져도 a1에 낸 표가 b1에 남는다(placeId 별칭)', () => {
    const b1 = spot('b1', '불국사', { placeId: 'gj-bulguksa', said: [['m-b', 'chat', 'y1', 30]] });
    const a1 = spot('a1', '불국사', { placeId: 'gj-bulguksa', said: [['m-c', 'chat', 'z1', 40]] });
    const confirmed = [
      createOp(1),
      op('m-b', { type: 'chat/send', message: { id: 'y1', text: '불국사!' } }, 30, 2),
      op('m-b', { type: 'spot/extracted', messageId: 'y1', created: [b1], mergedSpotIds: [], ambiguous: [], highlights: [] }, 31, 3),
    ];
    // 기기 C(오프라인): 같은 장소를 a1로 새로 잡고 a1에 표를 끈다(말한 사람의 처음 표를 끈다)
    const pendingC = [
      op('m-c', { type: 'chat/send', message: { id: 'z1', text: '불국사 가자' } }, 40),
      op('m-c', { type: 'spot/extracted', messageId: 'z1', created: [a1], mergedSpotIds: [], ambiguous: [], highlights: [] }, 41),
      vote('m-c', false, 42, undefined, 'a1'),
      vote('m-a', true, 43, undefined, 'a1'),
    ];
    const d = foldOps([...confirmed, ...pendingC]) as Trip;
    assert.deepEqual(d.spots.map((s) => s.id), ['b1']);
    assert.deepEqual(d.spots[0].votes, { 'm-c': { on: false, at: 42 }, 'm-a': { on: true, at: 43 } });
    assert.deepEqual(voterIds(d.spots[0], activeMembers(d)), ['m-a', 'm-b']);
  });

  test('옛 문서(votes 없음)는 말한 사람의 표로, 명시적 off가 처음 표를 덮고, 나간 멤버 표는 세지 않는다', () => {
    const old = spot('s1', '불국사', { said: [['m-a', 'chat', 'x1', 1], ['m-c', 'manual', undefined, 2]] });
    assert.equal(old.votes, undefined);
    const active = [member('a', 0), member('b', 1), member('c', 2)];
    assert.deepEqual(voterIds(old, active), ['m-a', 'm-c']);
    const off = patchVote(old, 'm-a', false, 5);
    assert.deepEqual(voterIds(off, active), ['m-c']);
    const withB = patchVote(off, 'm-b', true, 6);
    const left = [member('a', 0), member('b', 1)];
    assert.deepEqual(voterIds(withB, left), ['m-b'], '나간 m-c의 표는 문서에 남지만 세지 않는다');
    assert.deepEqual(voteCounts([withB, spot('r', '뺀 곳', { removed: true })], left), { s1: 1 });
  });

  test('validate: 비멤버, 없는 스팟, on이 boolean이 아님, 종료 뒤 잠금(제외 여부는 접을 때 보지 않는다)', () => {
    const d = foldOps(baseLog()) as Trip;
    assert.equal(spots.validate(d, vote('m-x', true, 100)), '이 여행방의 멤버가 아닙니다');
    assert.equal(spots.validate(d, vote('m-a', true, 100, undefined, 'nope', 'nope')), '후보를 찾을 수 없습니다');
    assert.equal(spots.validate(d, vote('m-a', true, 100, undefined, 'nope')), null, 'id가 없어도 placeId로 찾는다');
    const bad = { ...vote('m-a', true, 100), on: 'yes' } as unknown as Op;
    assert.equal(spots.validate(d, bad), '잘못된 요청이에요');
    const removed = foldOps([...baseLog(), op('m-a', { type: 'spot/remove', spotId: 's1' }, 50, 4)]) as Trip;
    assert.equal(spots.validate(removed, vote('m-a', true, 100)), null, '제외 스팟은 보낼 때 화면(actions.toggleVote)이 막는다');
    const afterEnd = Date.UTC(2026, 9, 20, 3);
    assert.deepEqual(validateOp(d, vote('m-a', true, afterEnd)), { ok: false, reason: LOCKED_REASON });
    assert.ok(!'잘못된 요청이에요'.includes('투표'), 'core 문구에는 투표를 쓰지 않는다');
  });

  test('제외·복원과 겹친 표는 도착 순서(seq)가 아니라 op.at을 따른다', () => {
    // m-a(말한 사람)가 오프라인에서 t=100에 표를 끔. m-b가 t=90에 제외, t=110에 복원
    const off = (seq: number) => vote('m-a', false, 100, seq);
    const remove = (seq: number) => op('m-b', { type: 'spot/remove', spotId: 's1' }, 90, seq);
    const restore = (seq: number) => op('m-b', { type: 'spot/restore', spotId: 's1' }, 110, seq);
    const a = s1Of(foldOps([...baseLog(), off(4), remove(5), restore(6)]));
    const b = s1Of(foldOps([...baseLog(), remove(4), off(5), restore(6)]));
    assert.deepEqual(a.votes, { 'm-a': { on: false, at: 100 } });
    assert.deepEqual(b.votes, a.votes, '제외 뒤에 도착한 표도 버려지지 않는다');
    assert.equal(hasVote(b, 'm-a'), false, '말한 사람의 처음 표가 되살아나지 않는다');
    const removedNow = s1Of(foldOps([...baseLog(), remove(4), off(5)]));
    assert.deepEqual(voteCounts([removedNow], activeMembers(baseTrip())), {}, '제외된 동안은 세지 않는다');
    const actions = stripComments(read('src/features/chat/map/actions.ts'));
    assert.match(actions, /if \(cur\.removedByUser\) \{\s*useUi\.getState\(\)\.showToast\(VOTE_REMOVED_REASON, 'warn'\);/);
    assert.equal(VOTE_REMOVED_REASON, '제외된 후보는 투표할 수 없어요');
  });

  test('새로 만들 때는 페이로드 votes를 버리고, 합칠 때는 남긴다. spot/delete는 votes째 지운다', () => {
    const forged = spot('s1', '불국사', {
      placeId: 'gj-bulguksa',
      said: [['m-a', 'manual', undefined, 20]],
      votes: { 'm-b': { on: true, at: 1 } },
    });
    let d = foldOps([createOp(1), op('m-a', { type: 'spot/add', spot: forged }, 20, 2)]) as Trip;
    assert.equal(d.spots[0].votes, undefined, '새 스팟의 votes는 op로만 생긴다');
    d = foldOps([
      createOp(1),
      op('m-a', { type: 'spot/add', spot: forged }, 20, 2),
      vote('m-c', true, 30, 3),
      op('m-b', { type: 'spot/add', spot: { ...forged, id: 's9', votes: { 'm-b': { on: false, at: 99 } } } }, 40, 4),
    ]) as Trip;
    assert.deepEqual(d.spots.map((s) => s.id), ['s1']);
    assert.deepEqual(d.spots[0].votes, { 'm-c': { on: true, at: 30 } }, '합칠 때 기존 votes를 그대로 둔다');
    d = foldOps([
      createOp(1),
      op('m-a', { type: 'spot/add', spot: forged }, 20, 2),
      vote('m-c', true, 30, 3),
      op('m-a', { type: 'spot/delete', spotId: 's1' }, 40, 4),
      op('m-a', { type: 'spot/add', spot: forged }, 50, 5),
    ]) as Trip;
    assert.equal(d.spots[0].votes, undefined, '지웠다 다시 담으면 표가 없다');
    // pin·restore는 votes를 건드리지 않는다
    d = foldOps([
      ...baseLog(),
      vote('m-b', true, 30, 4),
      op('m-a', { type: 'spot/pin', spotId: 's1', pinned: true }, 40, 5),
      op('m-a', { type: 'spot/remove', spotId: 's1' }, 41, 6),
      op('m-a', { type: 'spot/restore', spotId: 's1' }, 42, 7),
    ]) as Trip;
    assert.deepEqual(s1Of(d).votes, { 'm-b': { on: true, at: 30 } });
  });
});

describe('표 예산(한 사람 3표, 제안자 표 제외)', () => {
  /** baseLog + m-a가 직접 추가한 s2~s6(모두 m-a가 말함). m-b·m-c는 아무 데도 말하지 않았다 */
  function budgetLog(): Op[] {
    const log = baseLog();
    ['s2', 's3', 's4', 's5', 's6'].forEach((id, i) => {
      const sp = spot(id, `장소${id}`, { placeId: `p-${id}`, said: [['m-a', 'manual', undefined, 30 + i]], createdAt: 30 + i });
      log.push(op('m-a', { type: 'spot/add', spot: sp }, 30 + i, 4 + i));
    });
    return log; // 마지막 seq 8
  }
  const v = (actor: string, id: string, on: boolean, at: number, seq?: number) =>
    vote(actor, on, at, seq, id, id === 's1' ? 'gj-bulguksa' : `p-${id}`);
  const onOf = (d: Trip | undefined, id: string, m: string) => {
    const sp = d?.spots.find((x) => x.id === id) as Spot;
    return hasVote(sp, m);
  };

  test('상수·문구: 3표, core 이유에는 투표를 쓰지 않는다', () => {
    assert.equal(VOTE_BUDGET, 3);
    assert.equal(VOTE_BUDGET_REASON, '표는 한 사람당 3표까지예요. 다른 표를 빼고 다시 눌러 주세요');
    assert.ok(!VOTE_BUDGET_REASON.includes('투표'));
    assert.equal(votesLeft(foldOps(budgetLog()) as Trip, 'm-b'), 3);
  });

  test('seq 순으로 앞선 3표가 이기고 4번째 켜기는 버려진다. 끄기는 언제나 되고, 뺀 뒤에는 다시 켤 수 있다', () => {
    const log = [...budgetLog(), v('m-b', 's1', true, 100, 9), v('m-b', 's2', true, 101, 10), v('m-b', 's3', true, 102, 11)];
    const d3 = foldOps(log) as Trip;
    assert.equal(votesLeft(d3, 'm-b'), 0);
    assert.equal(spots.validate(d3, v('m-b', 's4', true, 103)), VOTE_BUDGET_REASON);
    assert.deepEqual(validateOp(d3, v('m-b', 's4', true, 103)), { ok: false, reason: VOTE_BUDGET_REASON });
    assert.equal(spots.validate(d3, v('m-b', 's1', true, 103)), null, '이미 켠 곳을 다시 켜는 것은 표를 더 쓰지 않는다');
    assert.equal(spots.validate(d3, v('m-b', 's1', false, 103)), null, '끄기는 언제나 된다');
    const over = foldOps([...log, v('m-b', 's4', true, 103, 12)]) as Trip;
    assert.equal(onOf(over, 's4', 'm-b'), false, '접을 때도 4번째 표는 버려진다');
    assert.equal(over.spots.find((x) => x.id === 's4')?.votes, undefined);
    assert.equal(voteBlocked(over.spots, over.spots.find((x) => x.id === 's4') as Spot, 'm-b'), true);
    assert.equal(voteBlocked(over.spots, s1Of(over), 'm-b'), false, '켜진 곳은 막히지 않는다(끌 수 있다)');
    // 끄고 → 다른 곳 켜기
    const swapped = foldOps([...log, v('m-b', 's1', false, 104, 12), v('m-b', 's4', true, 105, 13)]) as Trip;
    assert.equal(onOf(swapped, 's1', 'm-b'), false);
    assert.equal(onOf(swapped, 's4', 'm-b'), true);
    assert.equal(votesLeft(swapped, 'm-b'), 0);
    const freed = foldOps([...log, v('m-b', 's1', false, 104, 12)]) as Trip;
    assert.equal(votesLeft(freed, 'm-b'), 1);
    // 끄고 다시 같은 곳 켜기
    const back = foldOps([...log, v('m-b', 's1', false, 104, 12), v('m-b', 's1', true, 105, 13)]) as Trip;
    assert.equal(onOf(back, 's1', 'm-b'), true);
    assert.equal(votesLeft(back, 'm-b'), 0);
  });

  test('두 기기에서 오프라인으로 낸 표: 확정 순서(seq)로 앞선 3표가 이기고, 대기 op는 at 순이며 입력 순서와 무관하다', () => {
    const phone = [v('m-b', 's1', true, 200), v('m-b', 's2', true, 201)];
    const tablet = [v('m-b', 's3', true, 150), v('m-b', 's4', true, 151)];
    // 서버가 tablet을 먼저 받음
    const conf = (ops: Op[], from: number) => ops.map((o, i) => ({ ...o, seq: from + i }) as Op);
    const a = foldOps([...budgetLog(), ...conf(tablet, 9), ...conf(phone, 11)]) as Trip;
    assert.deepEqual(['s1', 's2', 's3', 's4'].map((id) => onOf(a, id, 'm-b')), [true, false, true, true], '늦게 확정된 s2가 버려진다');
    const b = foldOps([...budgetLog(), ...conf(phone, 9), ...conf(tablet, 11)]) as Trip;
    assert.deepEqual(['s1', 's2', 's3', 's4'].map((id) => onOf(b, id, 'm-b')), [true, true, true, false]);
    // 아직 확정 전(대기)이면 at 순: tablet(150,151) → phone(200 통과, 201 버림)
    const p1 = foldOps([...budgetLog(), ...phone, ...tablet]) as Trip;
    const p2 = foldOps([...budgetLog(), ...tablet.reverse(), ...phone.reverse()]) as Trip;
    assert.deepEqual(['s1', 's2', 's3', 's4'].map((id) => onOf(p1, id, 'm-b')), [true, false, true, true]);
    assert.deepEqual(p2.spots, p1.spots, '대기 op 입력 순서가 달라도 같은 문서');
    for (const d of [a, b, p1]) assert.equal(usedVotes(d.spots, 'm-b'), 3, '어느 경우에도 3표를 넘지 않는다');
  });

  test('제안자 표는 예산 밖이다(처음 표, 껐다 다시 켠 표 모두). 말하지 않은 곳만 예산을 쓴다', () => {
    const d = foldOps(budgetLog()) as Trip;
    assert.equal(costsVote(s1Of(d), 'm-a'), false);
    assert.equal(costsVote(s1Of(d), 'm-b'), true);
    assert.equal(votesLeft(d, 'm-a'), 3, 'm-a는 6곳에 처음 표가 있어도 3표가 남는다');
    const re = foldOps([...budgetLog(), v('m-a', 's1', false, 100, 9), v('m-a', 's1', true, 101, 10)]) as Trip;
    assert.equal(onOf(re, 's1', 'm-a'), true);
    assert.equal(votesLeft(re, 'm-a'), 3, '다시 켠 제안자 표도 예산 밖');
    // m-a가 말하지 않은 곳(m-c가 말한 s7)에는 예산을 쓴다
    const s7 = spot('s7', '첨성대', { placeId: 'p-s7', said: [['m-c', 'manual', undefined, 40]], createdAt: 40 });
    const withS7 = foldOps([...budgetLog(), op('m-c', { type: 'spot/add', spot: s7 }, 40, 9), v('m-a', 's7', true, 100, 10)]) as Trip;
    assert.equal(votesLeft(withS7, 'm-a'), 2);
    assert.equal(votesLeft(withS7, 'm-c'), 3);
  });

  test('제외된 스팟의 표는 세지 않고(한 표가 풀린다), 복원으로 넘치면 복원된 스팟의 표가 꺼진다', () => {
    const three = [...budgetLog(), v('m-b', 's1', true, 100, 9), v('m-b', 's2', true, 101, 10), v('m-b', 's3', true, 102, 11)];
    const removed = foldOps([...three, op('m-a', { type: 'spot/remove', spotId: 's1' }, 110, 12)]) as Trip;
    assert.equal(votesLeft(removed, 'm-b'), 1, '제외된 s1의 표가 풀린다');
    const used = [...three, op('m-a', { type: 'spot/remove', spotId: 's1' }, 110, 12), v('m-b', 's4', true, 111, 13)];
    const d = foldOps(used) as Trip;
    assert.equal(onOf(d, 's4', 'm-b'), true);
    const restored = foldOps([...used, op('m-a', { type: 'spot/restore', spotId: 's1' }, 120, 14)]) as Trip;
    assert.equal(s1Of(restored).removedByUser, undefined);
    assert.deepEqual(s1Of(restored).votes?.['m-b'], { on: false, at: 120 }, '제외된 동안 다른 곳에 쓴 표가 이긴다');
    assert.equal(onOf(restored, 's4', 'm-b'), true);
    assert.equal(usedVotes(restored.spots, 'm-b'), 3);
    // 늦게 도착한 옛 켜기(at 115)는 꺼진 기록(at 120)을 덮지 못한다
    const late = foldOps([...used, op('m-a', { type: 'spot/restore', spotId: 's1' }, 120, 14), v('m-b', 's4', false, 121, 15), v('m-b', 's1', true, 115, 16)]) as Trip;
    assert.equal(onOf(late, 's1', 'm-b'), false);
    // 자리가 있으면 복원해도 표가 그대로다
    const room = foldOps([...three, op('m-a', { type: 'spot/remove', spotId: 's1' }, 110, 12), op('m-a', { type: 'spot/restore', spotId: 's1' }, 120, 13)]) as Trip;
    assert.deepEqual(s1Of(room).votes?.['m-b'], { on: true, at: 100 });
    assert.equal(votesLeft(room, 'm-b'), 0);
    // 지운 스팟은 표와 함께 사라져 한 표가 풀린다
    const deleted = foldOps([...three, op('m-a', { type: 'spot/delete', spotId: 's2' }, 110, 12)]) as Trip;
    assert.equal(votesLeft(deleted, 'm-b'), 1);
  });

  test('나간 멤버는 남은 표 0이고 켜기를 못 하며, 그 표가 남은 사람의 예산에 영향을 주지 않는다', () => {
    const log = [
      ...budgetLog(),
      v('m-c', 's1', true, 100, 9),
      v('m-c', 's2', true, 101, 10),
      v('m-c', 's3', true, 102, 11),
      op('m-c', { type: 'member/leave', memberId: 'm-c' }, 103, 12),
    ];
    const d = foldOps(log) as Trip;
    assert.equal(votesLeft(d, 'm-c'), 0);
    assert.equal(votesLeft(d, 'm-x'), 0, '모르는 멤버도 0');
    assert.equal(votesLeft(d, 'm-b'), 3);
    assert.notEqual(spots.validate(d, v('m-c', 's4', true, 104)), null);
    assert.equal(voteCounts(d.spots, activeMembers(d)).s2, 1, '나간 m-c의 표는 세지 않는다(m-a 제안자 표만)');
  });

  test('옛 문서: votes가 없으면 모두 3표, 이미 3표를 넘게 켠 문서는 0으로 보이고 새 켜기만 막힌다', () => {
    const old = { ...baseTrip(), spots: [spot('s1', '불국사'), spot('s2', '첨성대'), spot('s3', '교촌'), spot('s4', '대릉원'), spot('s5', '보문')] } as Trip;
    for (const m of ['m-a', 'm-b', 'm-c']) assert.equal(votesLeft(old, m), 3);
    const on = { on: true, at: 5 };
    const over = { ...old, spots: old.spots.map((s, i) => (i < 4 ? { ...s, votes: { 'm-b': on } } : s)) } as Trip;
    assert.equal(usedVotes(over.spots, 'm-b'), 4);
    assert.equal(votesLeft(over, 'm-b'), 0, '음수가 되지 않는다');
    assert.equal(spots.validate(over, v('m-b', 's5', true, 10)), VOTE_BUDGET_REASON);
    assert.equal(spots.validate(over, v('m-b', 's1', false, 10)), null, '끄기는 된다');
    assert.equal(spots.validate(over, v('m-b', 's1', true, 10)), null, '이미 켠 곳은 그대로 둘 수 있다');
  });

  test('화면: 남은 표 줄, 다 쓴 토글은 옅지만 눌리고 누르면 이유 토스트', () => {
    assert.equal(budgetLine(2, 3), '남은 표 2/3');
    assert.equal(budgetLine(0, 3), '표를 다 썼어요 · 하나를 빼면 다시 줄 수 있어요');
    assert.match(budgetNote(3), /3표까지/);
    const actions = stripComments(read('src/features/chat/map/actions.ts'));
    assert.match(actions, /if \(voteBlocked\(trip\.spots, cur, me\)\) \{\s*useUi\.getState\(\)\.showToast\(VOTE_BUDGET_REASON, 'warn'\);/);
    const toggle = stripComments(read('src/features/chat/map/VoteToggle.tsx'));
    assert.match(toggle, /const dim = !!disabled \|\| \(!!full && !on\);/);
    assert.match(toggle, /disabled=\{disabled\}/, 'full은 누르는 것을 막지 않는다');
    const sheet = stripComments(read('src/features/chat/map/SheetBody.tsx'));
    assert.match(sheet, /\{budgetLine\(left, budget\)\}/);
    for (const f of ['RankList', 'MentionList']) {
      assert.match(stripComments(read(`src/features/chat/map/${f}.tsx`)), /full=\{isFull\(r\.spotId\)\}/, f);
    }
    const view = stripComments(read('src/features/chat/map/ChatMapView.tsx'));
    assert.match(view, /const left = me \? votesLeft\(trip, me\) : 0;/);
  });
});

describe('표 계산(순위, 말한 장소, 왼쪽 열)', () => {
  const active = [member('a', 0), member('b', 1), member('c', 2)];

  test('rankSpots: 표 내림차순 → 먼저 생긴 순 → 이름. 동점은 같은 순위(1,1,3), 투표자는 멤버 순서, mine, 막대 비율', () => {
    const list = [
      spot('s1', '첨성대', { createdAt: 3, said: [['m-c', 'chat', 'x1', 1]], votes: { 'm-a': { on: true, at: 2 } } }),
      spot('s2', '불국사', { createdAt: 1, said: [['m-b', 'chat', 'x2', 1]], votes: { 'm-a': { on: true, at: 2 } } }),
      spot('s3', '대릉원', { createdAt: 2, said: [['m-b', 'chat', 'x3', 1]] }),
      spot('s4', '가나다', { createdAt: 2, said: [['m-c', 'chat', 'x4', 1]], votes: { 'm-c': { on: false, at: 3 } } }),
      spot('s5', '뺀 곳', { removed: true }),
    ];
    const rows = rankSpots(list, { s1: '인왕동', s2: '진현동' }, active, 'm-a');
    assert.deepEqual(
      rows.map((r) => [r.spotId, r.count, r.rank, r.mine, r.areaName]),
      [
        ['s2', 2, 1, true, '진현동'],
        ['s1', 2, 1, true, '인왕동'],
        ['s3', 1, 3, false, ''],
        ['s4', 0, 4, false, ''],
      ],
    );
    assert.deepEqual(rows[1].voterIds, ['m-a', 'm-c']);
    assert.equal(barRatio(1, 2), 0.5);
    assert.equal(barRatio(0, 0), 0);
    // 이름 순(같은 표, 같은 createdAt)
    const tie = rankSpots([spot('x', '하', { createdAt: 1 }), spot('y', '가', { createdAt: 1 })], {}, active, undefined);
    assert.deepEqual(tie.map((r) => r.name), ['가', '하']);
    assert.ok(tie.every((r) => !r.mine));
  });

  test('mentionsOf: 한 스팟에 한 줄, 가장 이른 채팅 인용, 직접 추가는 인용 없음, 고른 지역 먼저', () => {
    const t = baseTrip();
    t.messages = [
      { id: 'x1', memberId: 'm-b', text: '불국사 가자', sentAt: 10, status: 'sent' },
      { id: 'x2', memberId: 'm-b', text: '불국사 꼭!', sentAt: 5, status: 'sent' },
      { id: 'x3', memberId: 'm-b', text: '첨성대도', sentAt: 30, status: 'sent' },
    ];
    t.spots = [
      spot('s1', '불국사', { said: [['m-b', 'chat', 'x1', 10], ['m-b', 'chat', 'x2', 5], ['m-a', 'chat', 'x9', 1]] }),
      spot('s2', '첨성대', { said: [['m-b', 'chat', 'x3', 30]] }),
      spot('s3', '황리단길', { said: [['m-b', 'manual', undefined, 20]] }),
      spot('s4', '뺀 곳', { removed: true, said: [['m-b', 'manual', undefined, 1]] }),
    ];
    const area = { s1: '진현동', s2: '인왕동', s3: '황남동' };
    const rows = mentionsOf(t, 'm-b', area, null, 'm-a');
    assert.deepEqual(
      rows.map((r) => [r.spotId, r.source, r.quote, r.firstAt]),
      [
        ['s1', 'chat', '불국사 꼭!', 5],
        ['s3', 'manual', undefined, 20],
        ['s2', 'chat', '첨성대도', 30],
      ],
    );
    assert.deepEqual(rows.map((r) => r.mine), [true, false, false], '나(m-a)는 s1을 말해 처음부터 한 표');
    assert.equal(rows[0].count, 2);
    const inArea = mentionsOf(t, 'm-b', area, '인왕동', 'm-a');
    assert.deepEqual(inArea.map((r) => r.spotId), ['s2', 's1', 's3']);
  });

  test('railOrder: 지역을 고르지 않으면 멤버 순서, 고르면 고른 사람 먼저', () => {
    assert.deepEqual(railOrder(active, null).map((m) => m.id), ['m-a', 'm-b', 'm-c']);
    assert.deepEqual(railOrder(active, ['m-c']).map((m) => m.id), ['m-c', 'm-a', 'm-b']);
    assert.deepEqual(railOrder(active, []).map((m) => m.id), ['m-a', 'm-b', 'm-c']);
  });
});

describe('지도 입력과 화면 상태', () => {
  const list = [
    spot('s1', '불국사', { coord: C.bulguk, said: [['m-a', 'chat', 'x1', 1]] }),
    spot('s2', '교촌마을', { coord: C.gyochon, said: [['m-b', 'chat', 'x2', 1]] }),
    spot('s3', '교동 고택', { coord: C.gyodong, said: [['m-b', 'chat', 'x3', 1]] }),
    spot('s4', '뺀 곳', { removed: true }),
  ];
  const area = { s1: '진현동', s2: '교동', s3: '교동' };
  const counts = { s1: 3, s2: 1, s3: 0 };

  test("라벨은 '{n}표'(0이면 없음), 핀 이름은 '3표 불국사'(순번 아님), 크기는 표 수 단계", () => {
    const { markers, fitTo } = chatMapInput(list, area, counts, {});
    assert.deepEqual(
      markers.map((m) => [m.id, m.kind, m.label, m.color, m.scale, m.dim]),
      [
        ['s1', 'spot', '3표', 'ink', 1.3, undefined],
        ['s2', 'spot', '1표', 'ink', 1, undefined],
        ['s3', 'spot', undefined, 'ink', 1, undefined],
      ],
    );
    assert.equal(pinName(markers[0]), '3표 불국사');
    assert.ok(!pinName(markers[0]).includes('번'));
    assert.equal(fitTo.length, 3);
    assert.equal(voteLabel(120), '99표');
    assert.equal(pinScaleFor(2, 4), 1.15);
    assert.equal(pinScaleFor(1, 4), 1);
    assert.equal(pinScaleFor(0, 0), 1);
  });

  test('표가 있는 핀은 표를 준 사람의 프로필(머리글자·멤버 순서 색)로 그리고, 라벨은 스크린리더 이름에 남는다', () => {
    const avatars = { s1: { text: '민', index: 0 }, s2: { text: '준', index: 1 }, s3: { text: '수', index: 2 } };
    const { markers } = chatMapInput(list, area, counts, {}, avatars);
    assert.deepEqual(
      markers.map((m) => [m.id, m.label, m.avatar]),
      [
        ['s1', '3표', { text: '민', index: 0 }],
        ['s2', '1표', { text: '준', index: 1 }],
        ['s3', undefined, undefined],
      ],
      '표가 없는 핀(s3)은 프로필 없이 작은 점',
    );
    assert.equal(pinName(markers[0]), '3표 불국사');
    // 구글·카카오 핀 그림도 아바타 면 색과 머리글자다('3표' 글자는 그리지 않는다)
    const svg = mapPinSvg({ kind: 'spot', label: '3표', avatar: { text: '민지', index: 1 } }).xml;
    assert.ok(svg.includes(surfaceC.amber) && svg.includes('>민<') && !svg.includes('3표'));
    for (const f of ['src/components/map/overlayItems.ts', 'src/components/map/GoogleMapView.tsx', 'src/components/map/GoogleMapView.web.tsx']) {
      assert.match(read(f), /\.\.\.\(m\.avatar \? \{ avatar: m\.avatar \} : \{\}\)/, f);
    }
    assert.match(stripComments(read('src/components/map/MapCanvas.tsx')), /if \(m\.avatar\) \{/);
  });

  test('흐림은 slate + dim(지역 밖, 고른 멤버가 말하지 않은 곳), 맞춤은 포커스 > 멤버 > 지역 > 전체', () => {
    const byArea = chatMapInput(list, area, counts, { area: '교동' });
    assert.deepEqual(byArea.markers.map((m) => [m.id, m.color, !!m.dim]), [
      ['s1', 'slate', true],
      ['s2', 'ink', false],
      ['s3', 'ink', false],
    ]);
    assert.deepEqual(byArea.fitTo, [C.gyochon, C.gyodong]);
    const byMember = chatMapInput(list, area, counts, { member: 'm-a' });
    assert.deepEqual(byMember.markers.filter((m) => m.dim).map((m) => m.id), ['s2', 's3']);
    assert.deepEqual(byMember.fitTo, [C.bulguk]);
    const both = chatMapInput(list, area, counts, { area: '교동', member: 'm-b' });
    assert.deepEqual(both.fitTo, [C.gyochon, C.gyodong]);
    const focus = chatMapInput(list, area, counts, { area: '교동', member: 'm-b', focusSpotId: 's1' });
    assert.deepEqual(focus.fitTo, [C.bulguk]);
    const empty = chatMapInput(list, area, counts, { member: 'm-c' });
    assert.equal(empty.fitTo.length, 3, '고른 사람이 말한 곳이 없으면 전체');
  });

  test('고른 지역 키가 지금 데이터에 없으면(다시 묶임·마지막 장소 빠짐) 아무 핀도 흐리지 않고 전체에 맞춘다', () => {
    const stale = chatMapInput(list, area, counts, { area: '보문로 일대' });
    assert.deepEqual(stale.markers.filter((m) => m.dim).map((m) => m.id), []);
    assert.equal(stale.fitTo.length, 3);
    const staleWithMember = chatMapInput(list, area, counts, { area: '보문로 일대', member: 'm-b' });
    assert.deepEqual(staleWithMember.markers.filter((m) => m.dim).map((m) => m.id), ['s1'], '멤버 흐림은 그대로');
    // 실제로 지역이 다시 묶이는 경우: 보문로 일대를 고른 뒤 2km 안에 동 주소가 생기면 그 키가 사라진다
    const before = [
      spot('b1', '보문 호수', { address: '경상북도 경주시 보문로 544', coord: C.bomun1 }),
      spot('b2', '보문 카페', { address: '경상북도 경주시 보문로 338', coord: C.bomun2 }),
    ];
    const key = groupAreas(before, GJ, activeMembers(baseTrip()))[0].key;
    assert.equal(key, '보문로 일대');
    const after = [...before, spot('n1', '신평동 식당', { address: '경상북도 경주시 신평동 719', coord: C.bomun2 })];
    const idx = areaIndex(groupAreas(after, GJ, activeMembers(baseTrip())));
    assert.ok(!Object.values(idx).includes(key));
    const out = chatMapInput(after, idx, {}, { area: key });
    assert.deepEqual(out.markers.filter((m) => m.dim).map((m) => m.id), [], '모든 핀이 흐려지지 않는다');
    const chat = stripComments(read('src/screens/ChatScreen.tsx'));
    assert.match(chat, /const selArea = sel\.selArea && areas\.some\(\(a\) => a\.key === sel\.selArea\) \? sel\.selArea : null;/);
    assert.ok(!chat.includes('selected={sel.selArea}'), '칩은 지금 목록에서 찾은 키만 켠다');
    const view = stripComments(read('src/features/chat/map/ChatMapView.tsx'));
    assert.match(view, /const areaKey = area\?\.key \?\? null;/);
    assert.match(view, /chatMapInput\(trip\.spots, areaBySpot, solo \? NO_COUNTS : counts, \{ area: areaKey,/);
    assert.match(view, /mentionsOf\(trip, member\.id, areaBySpot, areaKey, me\)/);
  });

  test('railLayout: 360폭에서 이름표가 지도 안에 들어가고, 열 전체(제목+목록)가 시트와 전체 보기 위에서 끝난다', () => {
    const r = railLayout(360, 660, 277);
    assert.ok(r.tagMaxWidth + 60 <= 360 - SP.l);
    assert.equal(r.tagMaxWidth, 200);
    assert.equal(r.railMaxHeight, 660 - RAIL_TOP - 277 - FIT_ALL_RESERVE);
    assert.ok(railLayout(200, 100, 300).railMaxHeight >= RAIL_MIN_H, '아주 낮아도 제목과 한 줄은 남긴다');
    // 360x640 휴대폰(지도 530, peek 223): 열 아래 끝이 '전체 보기'(카카오: 아래 SP.xl + 시트 + 로고 줄 24) 위에 있다
    const mapH = 530;
    const peek = 223;
    const p = railLayout(360, mapH, peek);
    const railBottom = RAIL_TOP + p.railMaxHeight;
    const fitAllTop = mapH - (SP.xl + peek + 24) - H.btnSm;
    assert.ok(railBottom <= fitAllTop - SP.m, `${railBottom} <= ${fitAllTop - SP.m}`);
    assert.ok(railBottom < mapH - peek, '시트 위에서 끝난다');
    const rail = stripComments(read('src/features/chat/map/MemberRail.tsx'));
    assert.match(rail, /<View style=\{\[styles\.rail, \{ maxHeight \}\]\}>/, 'maxHeight는 제목을 포함한 열 전체에 준다');
    assert.match(rail, /<ScrollView style=\{styles\.scroll\}/);
    assert.match(rail, /scroll: \{[^}]*flexShrink: 1,[^}]*pointerEvents: 'box-none',/, '목록이 줄어 스크롤하고 빈 곳은 지도가 받는다');
    assert.match(rail, /list: \{[^}]*pointerEvents: 'box-none',/);
  });

  test('chatMapLayout: 좁은 화면은 시트가 아래를 덮고, 넓은 화면은 오른쪽 440 이하로 왼쪽 열·전체 보기를 가리지 않는다', () => {
    const narrow = chatMapLayout(360, 530, 223, false);
    assert.deepEqual([narrow.sheetW, narrow.sheetLeft, narrow.overlayBottom], [360, 0, 223]);
    assert.deepEqual([narrow.tagMaxWidth, narrow.railMaxHeight], [railLayout(360, 530, 223).tagMaxWidth, railLayout(360, 530, 223).railMaxHeight]);
    const railRight = (l: { tagMaxWidth: number }) => SP.m + H.avatarLg + 4 + SP.m + l.tagMaxWidth;
    // 900 창: 지도 열 499. 시트는 오른쪽에 붙고 왼쪽에 WIDE_FREE_MIN을 남긴다
    for (const sheetH of [64, 223, 514]) {
      const w = chatMapLayout(499, 530, sheetH, true);
      assert.ok(w.sheetW <= WIDE_SHEET_W);
      assert.equal(w.sheetLeft, 499 - w.sheetW);
      assert.ok(w.sheetLeft >= WIDE_FREE_MIN);
      assert.ok(railRight(w) <= w.sheetLeft, `이름표가 시트 앞에서 끝난다 ${railRight(w)} <= ${w.sheetLeft}`);
      assert.ok(w.tagMaxWidth > 0);
      assert.equal(w.overlayBottom, 0, '시트가 왼쪽 아래(전체 보기·로고)를 덮지 않는다');
      assert.equal(w.railMaxHeight, railLayout(w.sheetLeft, 530, 0).railMaxHeight, 'full이어도 열 높이를 줄이지 않는다');
    }
    const roomy = chatMapLayout(800, 600, 580, true);
    assert.deepEqual([roomy.sheetW, roomy.sheetLeft, roomy.tagMaxWidth], [WIDE_SHEET_W, 360, 200]);
    assert.equal(WIDE_SHEET_W, 440);
    const view = stripComments(read('src/features/chat/map/ChatMapView.tsx'));
    assert.match(view, /const lay = chatMapLayout\(size\.w, size\.h, sheetH, wide\);/);
    assert.match(view, /style=\{wide \? \{ left: lay\.sheetLeft \} : undefined\}/);
    assert.match(view, /overlayBottom=\{lay\.overlayBottom\}/);
  });

  test('SVG 기본 지도는 시트가 덮는 높이를 빼고 맞춘다(맞출 핀이 시트 밑에 놓이지 않게)', () => {
    assert.equal(fitAreaHeight(530, 223), 307);
    assert.equal(fitAreaHeight(530), 530);
    assert.equal(fitAreaHeight(530, 514), MIN_FIT_H, '시트를 끝까지 올려도 투영이 무너지지 않는다');
    assert.equal(fitAreaHeight(100, 50), 100, '지도 높이보다 크지 않다');
    const pts = [C.bulguk, C.gyochon, C.bomun1];
    const out = layoutMap({
      markers: pts.map((coord, i) => ({ id: `p${i}`, coord, kind: 'spot' as const, title: `p${i}` })),
      polylines: [],
      size: { width: 360, height: fitAreaHeight(530, 223) },
      fitTo: pts,
    });
    for (const m of out.projected) assert.ok(m.y <= 530 - 223, `${m.y} <= ${530 - 223}`);
    const canvas = stripComments(read('src/components/map/MapCanvas.tsx'));
    assert.match(canvas, /const fitH = fitAreaHeight\(height, props\.overlayBottom\);/);
    assert.match(canvas, /size: \{ width, height: fitH \}/);
  });

  test('chatMapStep: 칩·프로필·스냅·탭·포커스·닫기·채팅으로', () => {
    let s: ChatMapState = CHAT_MAP_INITIAL;
    assert.equal(s.snap, 'mini');
    s = chatMapStep(s, { t: 'member', id: 'm-b' });
    assert.deepEqual([s.selMember, s.tab, s.snap], ['m-b', 'mentions', 'peek']);
    s = chatMapStep(s, { t: 'focus', spotId: 's2' });
    assert.deepEqual([s.focusSpotId, s.snap], ['s2', 'peek']);
    s = chatMapStep(s, { t: 'area', key: '교동' });
    assert.deepEqual([s.selArea, s.selMember, s.snap, s.focusSpotId], ['교동', null, 'mini', null]);
    s = chatMapStep(s, { t: 'area', key: '교동' });
    assert.equal(s.selArea, null, '고른 칩을 다시 누르면 풀린다');
    s = chatMapStep(chatMapStep(s, { t: 'member', id: 'm-a' }), { t: 'member', id: 'm-a' });
    assert.deepEqual([s.selMember, s.snap], [null, 'mini'], '같은 프로필을 다시 누르면 닫힌다');
    s = chatMapStep(chatMapStep(s, { t: 'member', id: 'm-a' }), { t: 'tab', tab: 'rank' });
    assert.deepEqual([s.tab, s.snap], ['rank', 'full'], 'peek에서 전체 탭을 고르면 full');
    s = chatMapStep(s, { t: 'snap', snap: 'mini' });
    assert.deepEqual([s.snap, s.selMember], ['mini', null], 'mini로 끌어내리면 멤버도 비운다');
    s = chatMapStep(chatMapStep(s, { t: 'focus', spotId: 's1' }), { t: 'snap', snap: 'mini' });
    assert.deepEqual([s.snap, s.focusSpotId], ['mini', null], '멤버 없이 포커스만 있어도 mini로 내리면 포커스를 푼다(한 핀에 갇히지 않게)');
    s = chatMapStep(chatMapStep({ ...s, selArea: '교동' }, { t: 'member', id: 'm-b' }), { t: 'toChat' });
    assert.deepEqual([s.selArea, s.selMember, s.snap], ['교동', null, 'mini'], '채팅으로 바꿔도 지역은 남는다');
    s = chatMapStep(chatMapStep(s, { t: 'member', id: 'm-b' }), { t: 'close' });
    assert.deepEqual([s.selMember, s.snap], [null, 'mini']);
  });
});

describe('서버 저장과 소스 규칙', () => {
  test('서버는 spot/vote를 그대로 저장·반환하고, PG 투영은 무시한다', async () => {
    const store = createSyncStore({ warn: () => {} });
    const log = [...baseLog(), vote('m-b', true, 100)];
    const acks = await store.push('t1', log, 1);
    assert.equal(acks.length, log.length);
    const back = await store.pull('t1', 0);
    const { seq: _s, ...stored } = back[back.length - 1];
    const { seq: _n, ...sent } = log[log.length - 1] as Op & { seq?: number };
    assert.deepEqual(stored, sent);
    assert.deepEqual(projectOps(back), projectOps(back.slice(0, -1)));
  });

  test('서버가 받은 비멤버 actorId의 표는 접을 때 버려진다(서버 op ACL은 범위 밖)', () => {
    const d = foldOps([...baseLog(), vote('m-x', false, 100, 4), vote('m-a', false, 101, 5)]) as Trip;
    assert.deepEqual(s1Of(d).votes, { 'm-a': { on: false, at: 101 } });
  });

  const src = (f: string) => stripComments(read(f));

  test('ChatScreen: 채팅|지도 나누기(혼자 여행도), 칩은 그룹만, 넓은 화면은 나란히', () => {
    const chat = src('src/screens/ChatScreen.tsx');
    assert.match(chat, /!wide \? \(\s*<Seg<ChatView>\s*compact/);
    assert.match(chat, /solo=\{!group\}/, '혼자 여행은 투표 없는 지도');
    assert.match(chat, /group \? <AreaChips/);
    assert.match(chat, /\{ key: 'chat', label: '채팅' \}/);
    assert.match(chat, /\{ key: 'map', label: '지도' \}/);
    assert.match(chat, /WIDE_MIN = 900/);
    assert.match(chat, /<Header\s+size="row"/);
    assert.ok(!/function ChatHeader/.test(chat), '손수 만든 머리말은 없다');
  });

  test('ChatMapView: MapCanvas만 쓰고 지도 SDK를 직접 부르지 않으며, PeekSheet에 mini 스냅이 있다', () => {
    const v = src('src/features/chat/map/ChatMapView.tsx');
    assert.match(v, /import \{ MapCanvas \} from '\.\.\/\.\.\/\.\.\/components\/map\/MapCanvas'/);
    assert.doesNotMatch(v, /kakao|dapi\.kakao|google\.maps|react-native-maps/i);
    assert.match(v, /<PeekSheet/);
    assert.match(v, /SNAPS: readonly SheetSnap\[\] = \['mini', 'peek', 'full'\]/);
    assert.match(v, /BackHandler\.addEventListener\('hardwareBackPress'/);
    assert.match(v, /railOrder\(active,/, '왼쪽 열은 활성 멤버 전부다');
    assert.match(v, /m\.id === me \? '나'/);
  });

  test('VoteToggle·MemberRail·시트: 체크박스 역할, 장소 이름 라벨, 끌지 않는 길', () => {
    const t = src('src/features/chat/map/VoteToggle.tsx');
    assert.match(t, /accessibilityRole="checkbox"/);
    assert.match(t, /accessibilityState=\{\{ checked: on/);
    assert.match(t, /accessibilityLabel=\{`\$\{name\} 투표`\}/);
    const rail = src('src/features/chat/map/MemberRail.tsx');
    assert.match(rail, /accessibilityLabel=\{`\$\{m\.label\}, 말한 장소 \$\{m\.count\}곳 보기`\}/);
    assert.match(rail, /pointerEvents: 'box-none'/);
    assert.doesNotMatch(rail, /style=\{\{[^}]*pointerEvents/);
    const sheet = src('src/features/chat/map/SheetBody.tsx');
    assert.match(sheet, /accessibilityLabel="투표 목록 열기"/);
    assert.match(sheet, /label="목록 펼치기"/);
    assert.match(sheet, /label="목록 접기"/);
    assert.match(sheet, /label="닫기"/);
  });

  test('시트·순위 글자: mini·머리 제목, 1위 줄, 순위 메타, 읽는 이름, 1~3위 강조', () => {
    const row = (rank: number, name: string, count: number, areaName = '진현동') =>
      ({ spotId: name, name, areaName, count, voterIds: [], rank, mine: false });
    assert.equal(topLine([row(1, '불국사', 3), row(2, '교촌마을', 1)]), '1위 불국사 3표');
    assert.equal(topLine([row(1, '불국사', 0)]), '아직 투표가 없어요');
    assert.equal(topLine([]), '아직 투표가 없어요');
    assert.equal(whoTitle({ nickname: '민지', mine: false, count: 3 }), '민지님이 말한 장소 3곳');
    assert.equal(whoTitle({ nickname: '민지', mine: true, count: 2 }), '내가 말한 장소 2곳');
    assert.equal(`${whoName({ nickname: '김민지', mine: false })} ${whoCount({ count: 4 })}`, '김민지님이 말한 장소 4곳');
    assert.equal(rankMeta(row(1, '불국사', 3), 4), '진현동 · 3/4표');
    assert.equal(rankMeta(row(1, '불국사', 3, ''), 4), '3/4표');
    const a11y = rankA11y(row(1, '불국사', 3), 4);
    assert.equal(a11y, '1위 불국사, 진현동, 4명 중 3표, 지도에서 보기');
    assert.ok(!/\d\/\d/.test(a11y), "읽는 이름에는 '3/4'(날짜·분수로 읽힘)를 쓰지 않는다");
    assert.deepEqual([1, 2, 3, 4].map(rankTone), ['accentStrong', 'accentStrong', 'accentStrong', 'muted']);
    const sheet = stripComments(read('src/features/chat/map/SheetBody.tsx'));
    assert.match(sheet, /\{whoName\(who\)\}[\s\S]*<Txt v="nm">\{whoCount\(who\)\}<\/Txt>/, '머리 제목의 수는 줄지 않는 따로 된 글자다');
    const list = stripComments(read('src/features/chat/map/RankList.tsx'));
    assert.match(list, /accessibilityLabel=\{rankA11y\(r, total\)\}/);
    assert.match(list, /c=\{rankTone\(r\.rank\)\}/);
    assert.match(list, /<Avatar key=\{.*?\} name=\{v\.nickname\} index=\{v\.index\}/, '투표자 색은 멤버 순서');
    assert.doesNotMatch(list, /AvatarStack/, '줄 안 자리 순 색(AvatarStack)을 쓰지 않는다');
  });

  test('채팅방 지도 화면 동작: 핀·키보드·숨은 채팅 층·다시 그리기·투표 토글', () => {
    const view = stripComments(read('src/features/chat/map/ChatMapView.tsx'));
    assert.match(view, /if \(key === areaKey\) send\(\{ t: 'focus', spotId \}\);\s*else send\(\{ t: 'area', key \}\);/, '고른 지역 안의 핀은 지역을 풀지 않고 맞춘다');
    assert.match(view, /export const ChatMapView = memo\(function ChatMapView/);
    assert.match(view, /useUi\(\(s\) => s\.actingAs\[trip\.id\]\)/, 'memo여도 보내는 사람이 바뀌면 나(표·왼쪽 열)를 다시 계산한다');
    assert.match(view, /polylines=\{NO_LINES\}/);
    assert.doesNotMatch(view, /polylines=\{\[\]\}/);
    assert.match(view, /const canVote = canVoteNow\(trip, now\);/, 'actions.canVote 한 곳의 규칙을 쓴다');
    const chat = stripComments(read('src/screens/ChatScreen.tsx'));
    assert.match(chat, /const leaveComposer = \(\) => \{\s*if \(!wide\) Keyboard\.dismiss\(\);/);
    assert.match(chat, /if \(v === 'map'\) \{\s*leaveComposer\(\);/);
    assert.match(chat, /const pickArea = \(key: string\) => \{\s*leaveComposer\(\);/);
    assert.match(chat, /const INERT = \{ inert: true \} as object;/);
    assert.match(chat, /\{\.\.\.\(IS_WEB && mapOn \? INERT : null\)\}/, '숨은 채팅 층은 웹에서 Tab 포커스가 들어가지 않는다');
    const bar = stripComments(read('src/features/chat/components/CandidateBar.tsx'));
    assert.match(bar, /useMemo\(\(\) => summaryLine\(candidateView\(trip, plan\)\), \[trip, plan\]\)/);
    const toggle = stripComments(read('src/features/chat/map/VoteToggle.tsx'));
    assert.match(toggle, /\{on \? '투표함' : '투표'\}/, '누를 수 없어도 내 표가 보인다');
    assert.doesNotMatch(toggle, /on && !disabled/);
    const chips = stripComments(read('src/features/chat/map/AreaChips.tsx'));
    assert.match(chips, /const SLOP = \(H\.touch - H\.btnSm\) \/ 2;/);
    assert.match(chips, /hitSlop=\{\{ top: SLOP, bottom: SLOP \}\}/, '지역 칩은 누르는 높이 44');
  });

  test("'투표'는 src/features/chat/map과 투표 결과를 보이는 후보 행·후보 카드·스팟 상세·앱 둘러보기에만 있다", () => {
    // 2026-10-17: 표가 제외 순서와 자동 고정을 정하면서 후보 행('투표로 고정')과 스팟 상세 투표 카드도 쓴다
    // 2026-10-24: 후보 카드의 좋아요를 이름 투표로 바꿨다. 앱 둘러보기도 같은 말을 쓴다
    const shows = [
      'src/features/candidates/rows.ts',
      'src/features/candidates/detail.ts',
      'src/screens/SpotDetailScreen.tsx',
      'src/features/candidates/components/CandidateCard.tsx',
      'src/features/guide/tour.ts',
    ];
    const outside = listFiles('src', ['.ts', '.tsx']).filter((f) => !f.startsWith('src/features/chat/map/') && !shows.includes(f));
    const bad = outside.filter((f) => src(f).includes('투표'));
    assert.deepEqual(bad, []);
  });
});
