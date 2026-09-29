import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Member, Op, OpBody, Plan, Spot, Trip } from '../src/types';
import type { Region } from '../src/core/ports';
import { DEFAULT_STAY_MIN } from '../src/core/constants';
import { existingAddState, manualSpot, outsideConfirmText, planManualAdd } from '../src/core/extract/manual';
import { spotFromPlace } from '../src/core/extract/spot';
import * as chat from '../src/core/ops/chat';
import * as spots from '../src/core/ops/spots';
import { proposerIds } from '../src/core/spotUtil';
import { PLACES } from '../src/data/places';
import { regionById } from '../src/data/regions';
import { SCENARIO_PLACES } from '../src/data/scenario';
import { candidateView, daypart, headline } from '../src/features/candidates/rows';
import { bubbleSegments, extractionCard, senderName } from '../src/features/chat/view';
import { createPlaceProvider } from '../src/services/places';
import { fakeFetch } from './helpers/fakes';

/**
 * FR-402 후보 목록·FR-202 수동 등록(WP3). 리듀서는 WP3 파일만 쓴다.
 */

const region = regionById('gyeongju') as Region;
const place = (id: string) => PLACES.find((p) => p.placeId === id)!;

function trip(memberCount = 3): Trip {
  const members: Member[] = ['a', 'b', 'c'].slice(0, memberCount).map((k, i) => ({
    id: `m-${k}`,
    userId: `u-${k}`,
    nickname: k.toUpperCase(),
    role: i === 0 ? 'host' : 'member',
    isGuest: true,
    canInvite: false,
    joinedAt: 0,
  }));
  return {
    id: 't',
    title: '경주',
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
    createdAt: 0,
    createdBy: 'u-a',
    lastSeq: 0,
  };
}

let n = 0;
function apply(doc: Trip, actorId: string, body: OpBody, at = 1000 + n): Trip {
  n += 1;
  const op = { ...body, id: `op${n}`, tripId: doc.id, actorId, at, seq: n } as Op;
  const r = op.type.startsWith('chat/') ? chat : spots;
  const reason = r.validate(doc, op);
  assert.equal(reason, null, `${op.type}: ${reason}`);
  return r.reduce(doc, op);
}

function chatSpot(id: string, placeId: string, memberId: string, messageId: string, at: number): Spot {
  return spotFromPlace(place(placeId), {
    id,
    proposal: { memberId, source: 'chat', messageId, at },
    createdAt: at,
    sourceMessageId: messageId,
  });
}

/** 메시지 보내고 추출 op까지 */
function say(doc: Trip, actor: string, msgId: string, text: string, created: Spot[], merged: string[] = []): Trip {
  let d = apply(doc, actor, { type: 'chat/send', message: { id: msgId, text } });
  d = apply(d, actor, {
    type: 'spot/extracted',
    messageId: msgId,
    created,
    mergedSpotIds: merged,
    ambiguous: [],
    highlights: [],
  });
  return d;
}

test('같은 placeId는 하나로 합치고 제안을 중복 없이 누적한다', () => {
  let d = trip();
  d = say(d, 'm-a', 'x1', '불국사 가자', [chatSpot('s1', 'gj-bulguksa', 'm-a', 'x1', 1)]);
  d = say(d, 'm-b', 'x2', '불국사 찬성', [], ['s1']);
  // 다른 기기에서 같은 장소를 새로 잡아 온 경우(created로 왔지만 이미 있다) → 합쳐진다
  d = say(d, 'm-c', 'x3', '불국사!', [chatSpot('s9', 'gj-bulguksa', 'm-c', 'x3', 3)]);
  // 같은 op 재적용(같은 사람·메시지)은 제안이 늘지 않는다
  d = apply(d, 'm-c', { type: 'spot/extracted', messageId: 'x3', created: [], mergedSpotIds: ['s1'], ambiguous: [], highlights: [] });
  assert.equal(d.spots.length, 1);
  assert.deepEqual(proposerIds(d.spots[0]), ['m-a', 'm-b', 'm-c']);
  assert.equal(d.spots[0].proposals.length, 3);
  assert.deepEqual(d.messages.find((m) => m.id === 'x3')?.extraction?.mergedSpotIds, ['s1']);
});

test('되돌리기: 그 메시지로 새로 생긴 후보만 지우고, 병합된 후보에서는 그 메시지의 제안만 뺀다(회귀)', () => {
  let d = trip();
  d = say(d, 'm-a', 'x1', '불국사 가자', [chatSpot('s1', 'gj-bulguksa', 'm-a', 'x1', 1)]);
  d = say(d, 'm-b', 'x2', '불국사랑 석굴암', [chatSpot('s2', 'gj-seokguram', 'm-b', 'x2', 2)], ['s1']);
  assert.equal(d.spots.length, 2);
  d = apply(d, 'm-b', { type: 'spot/undoExtraction', messageId: 'x2' });
  assert.deepEqual(d.spots.map((s) => s.id), ['s1'], '석굴암(새로 생긴 후보)만 지워진다');
  assert.deepEqual(proposerIds(d.spots[0]), ['m-a'], '불국사에서는 x2 제안만 빠진다');
  assert.equal(d.messages.find((m) => m.id === 'x2')?.extraction, undefined);
  // 다른 메시지 추출은 그대로
  assert.ok(d.messages.find((m) => m.id === 'x1')?.extraction);
});

test('되돌리기: 새로 생긴 후보라도 다른 사람이 더한 제안은 남긴다', () => {
  let d = trip();
  d = say(d, 'm-a', 'x1', '석굴암', [chatSpot('s1', 'gj-seokguram', 'm-a', 'x1', 1)]);
  d = say(d, 'm-b', 'x2', '석굴암 좋아', [], ['s1']);
  d = apply(d, 'm-a', { type: 'spot/undoExtraction', messageId: 'x1' });
  assert.equal(d.spots.length, 1);
  assert.deepEqual(proposerIds(d.spots[0]), ['m-b']);
});

test('되돌리기 연달아: A 생성 → B 병합 → A 되돌리기 → B 되돌리기 → 후보 0곳(제안자 0명 후보가 남지 않는다, 회귀)', () => {
  let d = trip();
  d = say(d, 'm-a', 'x1', '불국사 가자', [chatSpot('s1', 'gj-bulguksa', 'm-a', 'x1', 1)]);
  d = say(d, 'm-b', 'x2', '불국사 좋아', [], ['s1']);
  d = apply(d, 'm-a', { type: 'spot/undoExtraction', messageId: 'x1' });
  assert.deepEqual(proposerIds(d.spots[0]), ['m-b']);
  d = apply(d, 'm-b', { type: 'spot/undoExtraction', messageId: 'x2' });
  assert.equal(d.spots.length, 0);
  assert.ok(d.spots.every((s) => s.proposals.length > 0));
});

test('되돌리기: 두 기기 동시 생성이 병합된 후보도 마지막 제안을 되돌리면 지우고 다른 추출 기록에서도 뺀다', () => {
  let d = trip();
  d = say(d, 'm-a', 'x1', '불국사', [chatSpot('s1', 'gj-bulguksa', 'm-a', 'x1', 1)]);
  // 다른 기기에서 같은 장소를 새로 잡았지만 upsertSpot이 s1에 병합한다 → x2에는 mergedSpotIds로 적힌다
  d = say(d, 'm-b', 'x2', '불국사!', [chatSpot('s9', 'gj-bulguksa', 'm-b', 'x2', 2)]);
  assert.deepEqual(d.messages.find((m) => m.id === 'x2')?.extraction?.mergedSpotIds, ['s1']);
  // 순서를 바꿔 B를 먼저 되돌려도, A를 먼저 되돌려도 결국 0곳
  d = apply(d, 'm-a', { type: 'spot/undoExtraction', messageId: 'x1' });
  d = apply(d, 'm-b', { type: 'spot/undoExtraction', messageId: 'x2' });
  assert.equal(d.spots.length, 0);

  // 남은 제안 0 → 지울 때 다른 메시지의 추출 기록에서도 id를 뺀다
  let e = trip();
  e = say(e, 'm-a', 'y1', '불국사', [chatSpot('s1', 'gj-bulguksa', 'm-a', 'y1', 1)]);
  e = say(e, 'm-b', 'y2', '불국사 좋아', [], ['s1']);
  e = {
    ...e,
    spots: e.spots.map((s) => ({ ...s, proposals: s.proposals.filter((p) => p.messageId === 'y2') })),
  };
  e = apply(e, 'm-b', { type: 'spot/undoExtraction', messageId: 'y2' });
  assert.equal(e.spots.length, 0);
  assert.deepEqual(e.messages.find((m) => m.id === 'y1')?.extraction?.createdSpotIds, []);
});

test('restore는 고정으로 되돌리고, remove·pin은 필드별 LWW다', () => {
  let d = trip();
  d = say(d, 'm-a', 'x1', '감은사지', [chatSpot('s1', 'gj-gameunsaji', 'm-a', 'x1', 1)]);
  d = apply(d, 'm-a', { type: 'spot/remove', spotId: 's1' }, 5000);
  assert.equal(d.spots[0].removedByUser, true);
  assert.equal(d.spots[0].removedReason, 'user');
  d = apply(d, 'm-b', { type: 'spot/restore', spotId: 's1' }, 6000);
  assert.equal(d.spots[0].removedByUser, undefined);
  assert.equal(d.spots[0].pinned, true);
  // 늦게 도착한 옛 편집(at 5500)은 지지 않는다
  d = apply(d, 'm-c', { type: 'spot/pin', spotId: 's1', pinned: false }, 5500);
  assert.equal(d.spots[0].pinned, true);
});

test('spot/delete는 오인식 후보를 지우고 말풍선 강조·추출 카드에서도 뺀다', () => {
  let d = trip();
  let x = apply(d, 'm-a', { type: 'chat/send', message: { id: 'x1', text: '계림 가자' } });
  x = apply(x, 'm-a', {
    type: 'spot/extracted',
    messageId: 'x1',
    created: [chatSpot('s1', 'gj-gyerim', 'm-a', 'x1', 1)],
    mergedSpotIds: [],
    ambiguous: [],
    highlights: [{ start: 0, end: 2, placeId: 'gj-gyerim' }],
  });
  d = apply(x, 'm-a', { type: 'spot/delete', spotId: 's1' });
  assert.equal(d.spots.length, 0);
  const ex = d.messages[0].extraction!;
  assert.deepEqual(ex.createdSpotIds, []);
  assert.deepEqual(ex.highlights, []);
  assert.equal(extractionCard(d, d.messages[0]), undefined, '보여줄 것이 없으면 카드도 없다');
});

test('동명 장소 선택: resolveAmbiguous로 고르면 후보가 되고, 닫으면 dismissed', () => {
  const a = place('gj-hwangnam-bread-a');
  const b = place('gj-hwangnam-bread-b');
  let d = apply(trip(), 'm-a', { type: 'chat/send', message: { id: 'x1', text: '황남빵 사자' } });
  d = apply(d, 'm-a', {
    type: 'spot/extracted',
    messageId: 'x1',
    created: [],
    mergedSpotIds: [],
    ambiguous: [{ phrase: '황남빵', options: [a, b] }],
    highlights: [{ start: 0, end: 3, placeId: a.placeId }],
  });
  const card = extractionCard(d, d.messages[0])!;
  assert.equal(card.picks.length, 1);
  assert.equal(card.canUndo, false);
  const chosen = chatSpot('s1', 'gj-hwangnam-bread-b', 'm-a', 'x1', 2);
  // 다른 멤버가 골라 줘도 제안자는 말한 사람이다
  const d2 = apply(d, 'm-b', { type: 'spot/resolveAmbiguous', messageId: 'x1', phrase: '황남빵', spot: chosen });
  assert.deepEqual(d2.spots.map((s) => s.placeId), ['gj-hwangnam-bread-b']);
  assert.deepEqual(proposerIds(d2.spots[0]), ['m-a']);
  const ex = d2.messages[0].extraction!;
  assert.equal(ex.ambiguous[0].resolved, 'gj-hwangnam-bread-b');
  assert.deepEqual(ex.createdSpotIds, ['s1']);
  assert.equal(ex.highlights[0].placeId, 'gj-hwangnam-bread-b');
  // 이미 고른 것은 다시 고를 수 없다
  const op = { type: 'spot/resolveAmbiguous', messageId: 'x1', phrase: '황남빵', spot: null, id: 'o', tripId: 't', actorId: 'm-a', at: 1 } as Op;
  assert.ok(spots.validate(d2, op));
  const d3 = apply(d, 'm-a', { type: 'spot/resolveAmbiguous', messageId: 'x1', phrase: '황남빵', spot: null });
  assert.equal(d3.spots.length, 0);
  assert.equal(d3.messages[0].extraction!.ambiguous[0].resolved, 'dismissed');
});

test('FR-202 수동 등록: 결과 없음 · 동명 여러 곳 · 목적지 밖 확인 · 기존 후보 병합', async () => {
  const places = createPlaceProvider({ fetch: fakeFetch() });
  const d = trip();
  assert.deepEqual(planManualAdd(await places.search('없는곳이름', region), region, d), { kind: 'none' });
  const many = planManualAdd(await places.search('황남빵', region), region, d);
  assert.equal(many.kind, 'many');
  const far = planManualAdd(await places.search('호미곶', region), region, d);
  assert.equal(far.kind, 'one');
  if (far.kind !== 'one') return;
  assert.equal(far.option.outside, true);
  assert.match(outsideConfirmText(far.option, region), /호미곶은 경주 중심에서 \d+(\.\d)?km 떨어져 있어 목적지 밖입니다/);
  // 확인 뒤 담으면 outsideRegion이 표시된다
  let d2 = apply(d, 'm-a', {
    type: 'spot/add',
    spot: manualSpot(far.option.place, { id: 's1', memberId: 'm-a', at: 10, outside: true }),
  });
  assert.equal(d2.spots[0].outsideRegion, true);
  assert.equal(d2.spots[0].proposals[0].source, 'manual');
  // 이미 있는 후보를 다시 담으면 제안자만 늘어난다
  const again = planManualAdd(await places.search('호미곶', region), region, d2);
  assert.equal(again.kind === 'one' && again.option.existingSpotId, 's1');
  d2 = apply(d2, 'm-b', {
    type: 'spot/add',
    spot: manualSpot(far.option.place, { id: 's2', memberId: 'm-b', at: 11, outside: true }),
  });
  assert.equal(d2.spots.length, 1);
  assert.deepEqual(proposerIds(d2.spots[0]), ['m-a', 'm-b']);
  // 이미 내가 수동으로 제안한 곳이면 already(아무것도 바꾸지 않고 알린다), 직접 뺀 후보면 removed
  if (again.kind !== 'one') return;
  assert.equal(existingAddState(d2, again.option, 'm-a'), 'already');
  assert.equal(existingAddState(d2, again.option, 'm-c'), 'merge');
  const d3 = { ...d2, spots: [{ ...d2.spots[0], removedByUser: true }] };
  assert.equal(existingAddState(d3, again.option, 'm-c'), 'removed');
  assert.equal(existingAddState(d2, { existingSpotId: undefined }, 'm-a'), 'new');
  // 기점 장소는 막지 않고 표시한다(24 시트의 '기점 장소' 칩)
  const hotel = planManualAdd(await places.search('라한셀렉트', region), region, d);
  assert.equal(hotel.kind === 'one' && hotel.option.base, true);
});

test('chat/send: 개인 모드면 거부하고, status는 seq 유무를 따른다', () => {
  const solo = trip(1);
  const op = { type: 'chat/send', message: { id: 'x', text: '안녕' }, id: 'o', tripId: 't', actorId: 'm-a', at: 1 } as Op;
  assert.equal(chat.validate(solo, op), chat.PERSONAL_MODE_REASON);
  const g = trip(2);
  assert.equal(chat.validate(g, op), null);
  assert.equal(chat.reduce(g, op).messages[0].status, 'pending');
  assert.equal(chat.reduce(g, { ...op, seq: 7 }).messages[0].status, 'sent');
  assert.equal(chat.reduce(g, { ...op, seq: 7 }).messages[0].seq, 7);
  assert.ok(chat.validate(g, { ...op, message: { id: 'y', text: '   ' } } as Op));
});

test('06 행 계산: 확정·제외·배치 전, 사유 100%, 시간대와 고정 시각', () => {
  let d = trip();
  d = say(d, 'm-a', 'x1', '불국사 석굴암 감은사지', [
    chatSpot('s1', 'gj-bulguksa', 'm-a', 'x1', 1),
    chatSpot('s2', 'gj-seokguram', 'm-a', 'x1', 2),
    chatSpot('s3', 'gj-gameunsaji', 'm-a', 'x1', 3),
    chatSpot('s4', 'gj-gyerim', 'm-a', 'x1', 4),
  ]);
  d = say(d, 'm-b', 'x2', '불국사', [], ['s1']);
  d = apply(d, 'm-a', { type: 'spot/pin', spotId: 's2', pinned: true });
  d = apply(d, 'm-a', { type: 'spot/remove', spotId: 's4' });
  const item = (spotId: string, arrive: string) => ({
    spotId,
    name: spotId,
    travelMin: 10,
    legTransport: 'car' as const,
    legEstimated: false,
    arrive,
    depart: arrive,
    stayMin: 90,
    pinned: false,
    proposerCount: 1,
    manual: false,
    notices: [],
  });
  const plan = {
    tripId: 't',
    days: [{ date: '2026-10-18', items: [item('s1', '09:25'), item('s2', '12:57')] }],
    excluded: [{ spotId: 's3', name: '감은사지 삼층석탑', reasonCode: 'tooFar', reason: '왕복 1시간 10분', proposerCount: 1 }],
    overCapacity: [{ date: '2026-10-18', overMin: 70 }],
  } as unknown as Plan;
  const v = candidateView(d, plan);
  assert.deepEqual(v.confirmed.map((r) => [r.name, r.sub]), [
    ['불국사', '사찰 · 체류 90분 · 10/18 오전'],
    ['석굴암', '사찰 · 체류 90분 · 10/18 12:57'],
  ]);
  assert.deepEqual(v.excluded.map((r) => [r.name, r.reasonCode, r.sub]), [
    ['감은사지 삼층석탑', 'tooFar', '왕복 1시간 10분 · 제안자 1'],
    ['계림', 'userRemoved', '사용자가 직접 뺌 · 제안자 1'],
  ]);
  for (const e of v.excluded) assert.ok(e.reason.length > 0);
  assert.equal(v.autoExcluded, 1);
  // tooFar는 수용량 초과가 아니다(사유를 틀리게 적지 않는다)
  assert.equal(v.capacityExcluded, 0);
  assert.equal(v.otherExcluded, 1);
  assert.equal(headline(v), '거리·기간 때문에 1곳이 자동으로 빠졌습니다.');
  assert.equal(headline({ ...v, capacityExcluded: 2, otherExcluded: 0 }), '하루 수용량을 넘는 2곳만 자동으로 빠졌습니다.');
  assert.equal(
    headline({ ...v, capacityExcluded: 2, otherExcluded: 1 }),
    '하루 수용량을 넘는 2곳, 거리·기간 때문에 1곳이 자동으로 빠졌습니다.',
  );
  assert.equal(v.overCapacity[0].title, '10/18 수용량 초과');
  assert.equal(v.overCapacity[0].text, '10/18 고정 스팟만으로 수용량을 1시간 10분 넘습니다');
  // 계획 전에는 확정·제외 대신 배치 전
  const none = candidateView(d, undefined);
  assert.equal(none.confirmed.length, 0);
  assert.equal(none.pending.length, 3);
  assert.equal(none.excluded.length, 1, '사용자가 뺀 후보는 계획 전에도 제외 구역에 사유와 함께 보인다');
  assert.deepEqual([daypart('11:59'), daypart('12:00'), daypart('18:00')], ['오전', '오후', '저녁']);
});

test('05 말풍선 조각과 보낸 사람 이름', () => {
  const text = '둘째 날 오전은 불국사 갔다가 석굴암 올라가자';
  const segs = bubbleSegments(text, [
    { start: 17, end: 20, placeId: 'b' },
    { start: 9, end: 12, placeId: 'a' },
  ]);
  assert.equal(segs.map((s) => s.text).join(''), text);
  assert.deepEqual(segs.filter((s) => s.hl).map((s) => s.text), ['불국사', '석굴암']);
  assert.deepEqual(bubbleSegments('안녕', []), [{ text: '안녕', hl: false }]);
  const d = trip();
  d.members[1] = { ...d.members[1], leftAt: 5, leftReason: 'left' };
  assert.equal(senderName(d.members, 'm-b'), 'B · 나간 멤버');
  assert.equal(senderName(d.members, 'm-a'), 'A');
});

test('data/places.ts는 동결 SCENARIO_PLACES의 값을 바꾸지 않는다', () => {
  for (const sp of SCENARIO_PLACES) {
    const p = PLACES.find((x) => x.placeId === sp.placeId);
    assert.ok(p, sp.name);
    const { stayMin: _s, role: _r, ...frozen } = sp;
    for (const [k, v] of Object.entries(frozen)) {
      assert.deepEqual((p as unknown as Record<string, unknown>)[k], v, `${sp.name}.${k}`);
    }
  }
  // 체류: 사전은 stayMin을 들고 있지 않고 후보의 체류는 spotFromPlace가 카테고리 기본값으로 정한다.
  // 그래서 시나리오 스팟의 체류가 카테고리 기본값과 같다는 것을 명시적으로 지킨다(달라지면 여기서 실패한다).
  for (const sp of SCENARIO_PLACES.filter((x) => x.role === 'spot')) {
    assert.equal(sp.stayMin, DEFAULT_STAY_MIN[sp.category], `${sp.name}.stayMin = DEFAULT_STAY_MIN[${sp.category}]`);
    assert.equal(spotFromPlace(place(sp.placeId), { id: 'x', proposal: { memberId: 'm', source: 'manual', at: 0 }, createdAt: 0 }).stayMin, sp.stayMin);
  }
  const ids = PLACES.map((p) => p.placeId);
  assert.equal(new Set(ids).size, ids.length, 'placeId가 겹치지 않는다');
  assert.equal(PLACES.filter((p) => p.name === '황남빵').length, 2);
  assert.ok(PLACES.some((p) => p.name === '호미곶' && p.region === 'pohang'));
});
