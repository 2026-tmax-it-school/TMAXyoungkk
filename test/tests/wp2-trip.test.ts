import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Member, Op, OpBody, Trip } from '../src/types';
import { DATA_RETENTION_MS, DELETED_MEMBER_NAME, MAX_TRIP_DAYS } from '../src/core/constants';
import { applyOp, foldOps, LOCKED_REASON, validateOp } from '../src/core/ops';
import { patchDay } from '../src/core/ops/lww';
import { MEMBER_REASON } from '../src/core/ops/members';
import { REASON } from '../src/core/ops/trip';
import { buildPlan } from '../src/core/planner';
import { REGIONS } from '../src/data/regions';
import {
  baseModeOf,
  buildDays,
  checkTripForm,
  dayHours,
  effectiveBase,
  monthGrid,
  nightsLabel,
  periodLabel,
  suggestTitle,
  tapRange,
  TITLE_MAX,
} from '../src/core/trip/create';
import { expiredTripIds, memberRows } from '../src/core/trip/members';
import { retentionUntil } from '../src/core/tripStatus';
import { addDays, atKst } from '../src/core/util';
import { tableRoutes } from './helpers/fakes';

/**
 * WP2 여행방: 만들기 판정(FR-201), 날짜별 기점 입력(FR-205), 권한 validate, 삭제·나가기(FR-204),
 * 계정 탈퇴 익명화(member/anonymize), 보관 기한 정리(데이터 보존).
 */

const T0 = atKst('2026-10-01', '10:00');
const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };
const junho: Member = { id: 'm-junho', userId: 'u-junho', nickname: '준호', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 };

function tripBody(members: Member[] = [host, junho]): Omit<Trip, 'lastSeq'> {
  return {
    id: 'trip-1',
    title: '경주 2박 3일',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: buildDays('2026-10-17', '2026-10-19', { name: '라한셀렉트 경주', coord: { latitude: 35.8404, longitude: 129.2833 } }),
    legs: [],
    members,
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
function op(body: OpBody, actorId = host.id, at?: number): Op {
  n += 1;
  return { id: `op-${n}`, tripId: 'trip-1', actorId, at: at ?? T0 + n * 1000, ...body } as Op;
}

function start(members?: Member[]): Trip {
  return applyOp(undefined, op({ type: 'trip/create', trip: tripBody(members) })) as Trip;
}

function run(doc: Trip, o: Op): Trip {
  const v = validateOp(doc, o);
  assert.equal(v.ok, true, v.ok ? '' : v.reason);
  return applyOp(doc, o) as Trip;
}

function reason(doc: Trip, o: Op): string | undefined {
  const v = validateOp(doc, o);
  return v.ok ? undefined : v.reason;
}

describe('FR-201 여행방 만들기 판정', () => {
  const ok = { title: '경주 2박 3일', regionId: 'gyeongju', startDate: '2026-10-17', endDate: '2026-10-19', dayStart: '09:00', dayEnd: '21:00' };

  test('정상 입력은 통과하고 기간은 3일, 확인 창은 필요 없다', () => {
    const r = checkTripForm(ok);
    assert.equal(r.ok, true);
    assert.equal(r.days, 3);
    assert.equal(r.needsLongConfirm, false);
  });

  test('종료일 < 시작일이면 거부한다', () => {
    const r = checkTripForm({ ...ok, startDate: '2026-10-19', endDate: '2026-10-17' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.order);
  });

  test('날짜를 고르지 않으면 거부한다', () => {
    assert.ok(checkTripForm({ ...ok, startDate: undefined }).errors.dates);
  });

  test('14일은 확인 없이, 15일부터 확인 창 뒤 허용한다', () => {
    const d14 = checkTripForm({ ...ok, startDate: '2026-10-01', endDate: addDays('2026-10-01', MAX_TRIP_DAYS - 1) });
    assert.equal(d14.days, 14);
    assert.equal(d14.needsLongConfirm, false);
    const d15 = checkTripForm({ ...ok, startDate: '2026-10-01', endDate: addDays('2026-10-01', MAX_TRIP_DAYS) });
    assert.equal(d15.days, 15);
    assert.equal(d15.ok, true, '거부가 아니라 확인 뒤 허용이다');
    assert.equal(d15.needsLongConfirm, true);
  });

  test('지역은 국내 목록에서만 고른다', () => {
    assert.ok(checkTripForm({ ...ok, regionId: 'tokyo' }).errors.region);
    for (const r of REGIONS) assert.equal(checkTripForm({ ...ok, regionId: r.id }).errors.region, undefined, r.id);
  });

  test('활동 시작이 끝보다 늦으면 거부한다', () => {
    assert.ok(checkTripForm({ ...ok, dayStart: '21:00', dayEnd: '09:00' }).errors.hours);
  });

  test('이름 제안과 기간 문구', () => {
    assert.equal(suggestTitle('gyeongju', '2026-10-17', '2026-10-19'), '경주 2박 3일');
    assert.equal(nightsLabel('2026-10-17', '2026-10-17'), '당일');
    assert.equal(periodLabel('2026-10-17', '2026-10-19'), '10월 17일 (토) – 19일 (월)');
  });

  test('달력 범위 선택으로는 종료일 < 시작일을 만들 수 없다', () => {
    let sel = tapRange({}, '2026-10-17');
    assert.deepEqual(sel, { start: '2026-10-17', end: '2026-10-17' });
    sel = tapRange(sel, '2026-10-15');
    assert.deepEqual(sel, { start: '2026-10-15', end: '2026-10-15' }, '앞 날짜를 누르면 거기서 새로 시작');
    sel = tapRange(sel, '2026-10-19');
    assert.deepEqual(sel, { start: '2026-10-15', end: '2026-10-19' });
    sel = tapRange(sel, '2026-10-20');
    assert.deepEqual(sel, { start: '2026-10-20', end: '2026-10-20' }, '범위가 있으면 새로 시작');
  });

  test('달력 칸은 일요일 시작 7칸 줄이다(2026-10-01은 목요일)', () => {
    const g = monthGrid('2026-10');
    assert.ok(g.every((row) => row.length === 7));
    assert.deepEqual(g[0].slice(0, 5), [null, null, null, null, '2026-10-01']);
    assert.equal(g.flat().filter(Boolean).length, 31);
  });

  test('기점 없이(base null) 만들면 모든 날의 plan이 baseSource firstSpot이다', async () => {
    const days = buildDays('2026-10-17', '2026-10-19', null);
    assert.ok(days.every((d) => d.base === null));
    const trip = applyOp(undefined, op({ type: 'trip/create', trip: { ...tripBody(), days } })) as Trip;
    const plan = await buildPlan(trip, { routes: tableRoutes(), now: T0 });
    assert.deepEqual(plan.days.map((d) => d.baseSource), ['firstSpot', 'firstSpot', 'firstSpot']);
  });

  test('기점을 고르면 첫날 지정, 다음 날은 직전 날짜 승계다', () => {
    const days = tripBody().days;
    assert.notEqual(days[0].base, null);
    assert.equal(days[1].base, 'inherit');
    assert.equal(baseModeOf(days[0], true), 'set');
    assert.equal(baseModeOf(days[1], false), 'inherit');
  });
});

describe('FR-205 날짜별 기점 입력(trip/setDay)', () => {
  test('그룹원도 기점을 바꿀 수 있다(전 멤버)', () => {
    let doc = start();
    doc = run(doc, op({ type: 'trip/setDay', date: '2026-10-19', patch: { noReturn: true, base: null } }, junho.id));
    const d = doc.days.find((x) => x.date === '2026-10-19');
    assert.equal(d?.noReturn, true);
    assert.equal(d?.base, null);
    assert.equal(baseModeOf(d, false), 'none');
  });

  test('날짜별 활동시간을 저장하고, 시작이 끝보다 늦으면 거부한다', () => {
    let doc = start();
    doc = run(doc, op({ type: 'trip/setDay', date: '2026-10-17', patch: { dayStart: '13:00' } }));
    assert.equal(doc.days[0].dayStart, '13:00');
    assert.equal(reason(doc, op({ type: 'trip/setDay', date: '2026-10-17', patch: { dayEnd: '12:00' } })), REASON.badHours);
  });

  test('25 표시: 직전 날짜와 같음은 앞 날의 기점을, 첫날의 inherit는 기점 없음을 보여준다', () => {
    let doc = start();
    const rahan = doc.days[0].base;
    assert.ok(rahan && rahan !== 'inherit');
    assert.deepEqual(effectiveBase(doc.days, '2026-10-19'), rahan);
    const station = { name: '경주역', coord: { latitude: 35.798, longitude: 129.139 } };
    doc = run(doc, op({ type: 'trip/setDay', date: '2026-10-18', patch: { base: station } }, junho.id));
    assert.deepEqual(effectiveBase(doc.days, '2026-10-19'), station);
    doc = run(doc, op({ type: 'trip/setDay', date: '2026-10-17', patch: { base: 'inherit' } }));
    assert.equal(effectiveBase(doc.days, '2026-10-17'), null);
    assert.equal(baseModeOf(doc.days[0], true), 'none');
  });

  test('날짜별 활동시간이 없으면 여행방 기본값이다', () => {
    let doc = start();
    assert.deepEqual(dayHours(doc, '2026-10-18'), { dayStart: '09:00', dayEnd: '21:00', custom: false });
    doc = run(doc, op({ type: 'trip/setDay', date: '2026-10-18', patch: { dayEnd: '18:00' } }));
    assert.deepEqual(dayHours(doc, '2026-10-18'), { dayStart: '09:00', dayEnd: '18:00', custom: true });
  });

  test('기간 밖 날짜는 거부한다', () => {
    assert.equal(reason(start(), op({ type: 'trip/setDay', date: '2026-10-20', patch: { noReturn: true } })), REASON.outOfPeriod);
  });

  test('setDay 리듀서는 patch에 없는 transport·edited.transport를 건드리지 않는다(patchDay 공유)', () => {
    let doc = start();
    // 하루 전체 이동수단은 schedule/setDayTransport(WP4)가 patchDay로 넣는다. 여기서는 공유 patchDay를 직접 부른다.
    doc = patchDay(doc, '2026-10-18', { transport: 'walk' }, T0 + 500);
    doc = run(doc, op({ type: 'trip/setDay', date: '2026-10-18', patch: { base: 'inherit', noReturn: true } }));
    const d = doc.days.find((x) => x.date === '2026-10-18');
    assert.equal(d?.transport, 'walk');
    assert.equal(d?.edited?.transport, T0 + 500);
    assert.equal(d?.noReturn, true);
  });

  test('필드별 LWW: 늦게 도착한 옛 편집은 새 편집을 덮지 않는다', () => {
    const base = start();
    const late = op({ type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: true } }, host.id, T0 + 90_000);
    const early = op({ type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: false } }, junho.id, T0 + 60_000);
    const create = op({ type: 'trip/create', trip: tripBody() }, host.id, T0);
    const doc = foldOps([
      { ...create, seq: 1 },
      { ...late, seq: 2 },
      { ...early, seq: 3 },
    ]) as Trip;
    assert.equal(doc.days.find((x) => x.date === '2026-10-18')?.noReturn, true);
    void base;
  });
});

describe('권한 validate', () => {
  test('trip/update는 방장만(그룹원 거부, 프로토타입 가정)', () => {
    const doc = start();
    assert.equal(reason(doc, op({ type: 'trip/update', patch: { title: '경주 여행' } }, junho.id)), REASON.hostOnly);
    const next = run(doc, op({ type: 'trip/update', patch: { title: '  경주 여행 ' } }));
    assert.equal(next.title, '경주 여행');
  });

  test('trip/update도 종료일 < 시작일과 국외 지역을 거부한다', () => {
    const doc = start();
    assert.equal(reason(doc, op({ type: 'trip/update', patch: { endDate: '2026-10-10' } })), REASON.badDates);
    assert.equal(reason(doc, op({ type: 'trip/update', patch: { region: 'paris' } })), REASON.badRegion);
  });

  test('trip/update는 TripPatch 키만 받는다. 다른 키·이동수단 값·긴 이름을 거부하고 리듀서도 한 번 더 고른다', () => {
    const doc = start();
    const sneaky = { title: '경주', members: [], deletedAt: 1 } as unknown as { title: string };
    assert.equal(reason(doc, op({ type: 'trip/update', patch: sneaky })), REASON.badPatch);
    assert.equal(reason(doc, op({ type: 'trip/update', patch: { transport: 'plane' as never } })), REASON.badTransport);
    assert.equal(reason(doc, op({ type: 'trip/update', patch: { title: '가'.repeat(TITLE_MAX + 1) } })), REASON.longTitle);
    // 검증 없이 적용되는 경우(applyOp 직접)에도 다른 키는 문서에 들어가지 않는다.
    const next = applyOp(doc, op({ type: 'trip/update', patch: sneaky })) as Trip;
    assert.equal(next.title, '경주');
    assert.equal(next.deletedAt, undefined);
    assert.equal(next.members.length, doc.members.length);
  });

  test('trip/update로 기간이 바뀌면 날짜별 설정을 새 기간에 맞춘다(남는 날은 유지, 새 날은 직전 날짜와 같음)', () => {
    let doc = start();
    doc = run(doc, op({ type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: true } }));
    doc = run(doc, op({ type: 'trip/update', patch: { startDate: '2026-10-18', endDate: '2026-10-20' } }));
    assert.deepEqual(doc.days.map((d) => d.date), ['2026-10-18', '2026-10-19', '2026-10-20']);
    assert.equal(doc.days[0].noReturn, true);
    assert.equal(doc.days[2].base, 'inherit');
  });

  test('trip/delete는 방장만. 방장 삭제 뒤에는 어떤 op도 받지 않는다', () => {
    const doc = start();
    assert.equal(reason(doc, op({ type: 'trip/delete' }, junho.id)), REASON.hostOnlyDelete);
    const gone = run(doc, op({ type: 'trip/delete' }));
    assert.ok(gone.deletedAt != null);
    assert.ok(reason(gone, op({ type: 'trip/setDay', date: '2026-10-17', patch: { noReturn: true } }, junho.id)));
  });

  test('member/setCanInvite는 방장만', () => {
    const doc = start();
    assert.equal(reason(doc, op({ type: 'member/setCanInvite', memberId: junho.id, canInvite: true }, junho.id)), MEMBER_REASON.hostOnly);
    const next = run(doc, op({ type: 'member/setCanInvite', memberId: junho.id, canInvite: true }));
    assert.equal(next.members.find((m) => m.id === junho.id)?.canInvite, true);
  });

  test('멤버가 아닌 사람의 op는 거부한다', () => {
    assert.equal(reason(start(), op({ type: 'trip/setDay', date: '2026-10-17', patch: { noReturn: true } }, 'm-stranger')), REASON.notMember);
  });

  test('종료일이 지난 방의 편집은 잠금 사유로 거부되고, 나가기·삭제는 된다', () => {
    const doc = start();
    const after = atKst('2026-10-20', '09:00');
    assert.equal(reason(doc, op({ type: 'trip/setDay', date: '2026-10-17', patch: { noReturn: true } }, host.id, after)), LOCKED_REASON);
    assert.equal(reason(doc, op({ type: 'member/leave', memberId: junho.id }, junho.id, after)), undefined);
    assert.equal(reason(doc, op({ type: 'trip/delete' }, host.id, after)), undefined);
  });
});

describe('FR-204 나가기', () => {
  test('그룹원은 나갈 수 있고 행은 나간 멤버로 남는다', () => {
    const doc = run(start(), op({ type: 'member/leave', memberId: junho.id }, junho.id));
    const m = doc.members.find((x) => x.id === junho.id);
    assert.ok(m?.leftAt != null);
    assert.equal(m?.leftReason, 'left');
    const rows = memberRows(doc, { meId: host.id });
    assert.equal(rows.at(-1)?.left, true);
    assert.match(rows.at(-1)?.sub ?? '', /나간 멤버/);
  });

  test('방장 나가기는 방장 위임 미결정 사유로 거부한다', () => {
    const r = reason(start(), op({ type: 'member/leave', memberId: host.id }));
    assert.equal(r, MEMBER_REASON.hostLeave);
    assert.match(r ?? '', /방장 위임 미결정/);
  });

  test('남을 대신 나가게 할 수 없다', () => {
    assert.equal(reason(start(), op({ type: 'member/leave', memberId: junho.id })), MEMBER_REASON.selfOnly);
  });
});

describe('member/anonymize(계정 탈퇴)', () => {
  function withChat(): Trip {
    let doc = start();
    doc = { ...doc, messages: [{ id: 'msg-1', memberId: junho.id, text: '불국사 가자', sentAt: T0, status: 'sent', seq: 3 }] };
    doc = {
      ...doc,
      spots: [
        {
          id: 's-1', placeId: 'p-1', name: '불국사', category: '관광지', coord: { latitude: 35.79, longitude: 129.33 },
          proposals: [{ memberId: junho.id, source: 'chat', messageId: 'msg-1', at: T0 }], pinned: false, stayMin: 90, createdAt: T0, edited: {},
        },
      ],
    };
    return doc;
  }

  test("닉네임 '탈퇴한 멤버', anonymized, leftReason deleted, leftAt. 채팅·제안 memberId는 그대로", () => {
    const doc = run(withChat(), op({ type: 'member/anonymize', memberId: junho.id }, junho.id));
    const m = doc.members.find((x) => x.id === junho.id);
    assert.equal(m?.nickname, DELETED_MEMBER_NAME);
    assert.equal(m?.anonymized, true);
    assert.equal(m?.leftReason, 'deleted');
    assert.ok(m?.leftAt != null);
    assert.equal(doc.messages[0].memberId, junho.id);
    assert.equal(doc.spots[0].proposals[0].memberId, junho.id);
  });

  test('본인만. 이미 나간 본인도 허용하고 leftAt은 처음 나간 시각을 유지한다', () => {
    let doc = withChat();
    assert.equal(reason(doc, op({ type: 'member/anonymize', memberId: junho.id })), MEMBER_REASON.selfOnly);
    doc = run(doc, op({ type: 'member/leave', memberId: junho.id }, junho.id));
    const leftAt = doc.members.find((x) => x.id === junho.id)?.leftAt;
    doc = run(doc, op({ type: 'member/anonymize', memberId: junho.id }, junho.id));
    assert.equal(doc.members.find((x) => x.id === junho.id)?.leftAt, leftAt);
  });

  test('방장 탈퇴도 인수 기준대로 leftReason deleted, leftAt을 둔다. 방장 나가기 거부는 그대로다(04 코드리뷰 결정)', () => {
    const doc = withChat();
    assert.equal(reason(doc, op({ type: 'member/leave', memberId: host.id })), MEMBER_REASON.hostLeave);
    const at = T0 + 5000;
    const next = run(doc, op({ type: 'member/anonymize', memberId: host.id }, host.id, at));
    const m = next.members.find((x) => x.id === host.id);
    assert.equal(m?.nickname, DELETED_MEMBER_NAME);
    assert.equal(m?.anonymized, true);
    assert.equal(m?.leftReason, 'deleted');
    assert.equal(m?.leftAt, at);
    assert.equal(m?.role, 'host', '역할은 남는다(방장 위임은 미결정)');
    assert.ok(reason(next, op({ type: 'trip/update', patch: { title: '새 이름' } }, host.id, at + 1000)), '탈퇴한 방장은 더 편집하지 못한다');
  });

  test('종료된 방에서도 적용된다(잠금 예외)', () => {
    const doc = withChat();
    const after = atKst('2027-01-05', '09:00');
    assert.equal(reason(doc, op({ type: 'member/anonymize', memberId: junho.id }, junho.id, after)), undefined);
  });
});

describe('데이터 보존: 보관 기한 정리(purgeExpired 판정)', () => {
  test('종료일 다음 날 00:00 KST + 365일부터 만료다(경계 전후 1초)', () => {
    const doc = start();
    const until = retentionUntil(doc);
    assert.equal(until, atKst('2026-10-20', '00:00') + DATA_RETENTION_MS);
    const other = { ...doc, id: 'trip-2', endDate: '2027-05-01' };
    const docs = { [doc.id]: doc, [other.id]: other };
    assert.deepEqual(expiredTripIds(docs, until - 1000), []);
    assert.deepEqual(expiredTripIds(docs, until), ['trip-1']);
    assert.deepEqual(expiredTripIds(docs, until + 1000), ['trip-1']);
  });
});
