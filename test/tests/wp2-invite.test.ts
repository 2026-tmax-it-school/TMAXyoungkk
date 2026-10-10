import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Member, Op, OpBody, Spot, Trip } from '../src/types';
import { INVITE_TTL_MS, MEMBER_CAPACITY, NICKNAME_MAX } from '../src/core/constants';
import { canIssueInvite, tripMode } from '../src/core/group';
import { applyOp, foldOps, LOCKED_REASON, validateOp } from '../src/core/ops';
import { joinFailCode, MEMBER_REASON } from '../src/core/ops/members';
import { REASON } from '../src/core/ops/trip';
import { buildDays } from '../src/core/trip/create';
import {
  inviteStatus,
  inviteUrl,
  inviteUrlShort,
  pickInviteBase,
  makeInviteCode,
  newInvite,
  normalizeInviteCode,
  seatsLeft,
} from '../src/core/trip/invite';
import { cleanNickname, JOIN_ERROR_TEXT, joinFailure, joinStatus, planJoin } from '../src/core/trip/join';
import { lookupInviteInLogs } from '../src/core/trip/lookup';
import { memberLabel, memberRows } from '../src/core/trip/members';
import { atKst } from '../src/core/util';
import { seededRng, seqIds } from './helpers/fakes';

/**
 * WP2 초대·합류·멤버 관리: 코드 형식(FR-301), 만료·정원·재발급 무효, 초대 권한 기본 false,
 * 합류(FR-302: 이미 참여, 개인→그룹 전환과 스팟 유지), 멤버 관리(FR-303: 내보내기, 전원 탈퇴 → 개인 모드).
 */

const T0 = atKst('2026-10-01', '10:00');
const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };

let n = 0;
function op(body: OpBody, actorId = host.id, at?: number): Op {
  n += 1;
  return { id: `op-${n}`, tripId: 'trip-1', actorId, at: at ?? T0 + n * 1000, ...body } as Op;
}

const spot: Spot = {
  id: 's-1',
  placeId: 'p-1',
  name: '황리단길',
  category: '관광지',
  coord: { latitude: 35.8383, longitude: 129.2096 },
  proposals: [{ memberId: host.id, source: 'manual', at: T0 }],
  pinned: false,
  stayMin: 90,
  createdAt: T0,
  edited: {},
};

function tripBody(): Omit<Trip, 'lastSeq'> {
  return {
    id: 'trip-1',
    title: '경주 2박 3일',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: buildDays('2026-10-17', '2026-10-19', null),
    legs: [],
    members: [host],
    spots: [spot],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: T0,
    createdBy: host.userId,
  };
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

function start(): Trip {
  return applyOp(undefined, op({ type: 'trip/create', trip: tripBody() })) as Trip;
}

function withInvite(code = 'AB12-CD34', at = T0 + 500): Trip {
  return run(start(), op({ type: 'trip/issueInvite', invite: { code, issuedAt: at, expiresAt: at + INVITE_TTL_MS, capacity: MEMBER_CAPACITY } }, host.id, at));
}

const ids = seqIds();
function joinOp(doc: Trip, userId: string, nickname: string, code: string, at?: number): { op: Op; memberId: string } {
  const plan = planJoin(doc, { userId, nickname, isGuest: true }, code, { ids, now: at ?? T0 });
  assert.equal(plan.already, false);
  if (plan.already) throw new Error('unreachable');
  return { op: op(plan.draft, plan.member.id, at), memberId: plan.member.id };
}

describe('FR-301 초대 코드', () => {
  test('주입 Rng로 Crockford base32 8자(XXXX-XXXX)를 만든다. 같은 시드면 같은 코드', () => {
    const a = makeInviteCode(seededRng(7));
    const b = makeInviteCode(seededRng(7));
    const c = makeInviteCode(seededRng(8));
    assert.match(a, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  test('코드 1000개에 헷갈리는 글자(I, L, O, U)가 없고 중복도 거의 없다(40비트)', () => {
    const rng = seededRng(42);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const code = makeInviteCode(rng);
      assert.doesNotMatch(code, /[ILOU]/);
      seen.add(code);
    }
    assert.equal(seen.size, 1000);
  });

  test('새 초대는 7일, 정원 6이다. 링크는 youngtrip.app/j/코드', () => {
    const inv = newInvite(seededRng(1), T0);
    assert.equal(inv.expiresAt - inv.issuedAt, INVITE_TTL_MS);
    assert.equal(inv.capacity, MEMBER_CAPACITY);
    assert.equal(inviteUrl('AB12-CD34'), 'https://youngtrip.app/j/AB12-CD34');
    assert.equal(inviteUrlShort('AB12-CD34'), 'youngtrip.app/j/AB12-CD34');
  });

  test('초대 링크 주소: 설정값 → 웹의 지금 앱 주소 → 예약 도메인. 링크는 그 주소의 /j/코드다', () => {
    assert.equal(pickInviteBase('http://192.168.0.10:8090/', 'http://localhost:8090'), 'http://192.168.0.10:8090');
    assert.equal(pickInviteBase(undefined, 'http://localhost:8090'), 'http://localhost:8090');
    assert.equal(pickInviteBase('youngtrip', 'null'), undefined, '주소가 아니면 쓰지 않는다');
    assert.equal(pickInviteBase('https://trip.example.com/app', undefined), 'https://trip.example.com');
    assert.equal(inviteUrl('AB12-CD34', 'http://localhost:8090/'), 'http://localhost:8090/j/AB12-CD34');
    assert.equal(inviteUrlShort('AB12-CD34', 'http://localhost:8090'), 'localhost:8090/j/AB12-CD34');
    assert.equal(normalizeInviteCode('http://localhost:8090/j/ab12-cd34'), 'AB12-CD34');
  });

  test('사람이 입력한 코드와 링크를 정규화한다', () => {
    assert.equal(normalizeInviteCode(' ab12cd34 '), 'AB12-CD34');
    assert.equal(normalizeInviteCode('https://youngtrip.app/j/ab12-cd34'), 'AB12-CD34');
    assert.equal(normalizeInviteCode('ABI2-CDO4'), 'AB12-CD04', 'I → 1, O → 0');
    assert.equal(normalizeInviteCode('AB12'), '');
  });

  test('7일 뒤 만료다(경계 1ms 전은 유효)', () => {
    const doc = withInvite('AB12-CD34', T0);
    assert.equal(inviteStatus(doc, 'AB12-CD34', T0 + INVITE_TTL_MS - 1), 'ok');
    assert.equal(inviteStatus(doc, 'AB12-CD34', T0 + INVITE_TTL_MS), 'expired');
    const late = joinOp(doc, 'u-late', '늦은이', 'AB12-CD34', T0 + INVITE_TTL_MS + 1);
    const r = reason(doc, late.op);
    assert.equal(r, MEMBER_REASON.inviteExpired);
    assert.equal(joinFailCode(r ?? ''), 'expired');
  });

  test('정원 6: 방장 포함 6명이면 7번째 합류는 정원 초과다', () => {
    let doc = withInvite();
    for (let i = 1; i <= MEMBER_CAPACITY - 1; i += 1) {
      doc = run(doc, joinOp(doc, `u-${i}`, `멤버${i}`, 'AB12-CD34').op);
    }
    assert.equal(doc.members.length, MEMBER_CAPACITY);
    assert.equal(seatsLeft(doc), 0);
    const seventh = joinOp(doc, 'u-7', '일곱째', 'AB12-CD34');
    const r = reason(doc, seventh.op);
    assert.equal(r, MEMBER_REASON.inviteFull);
    assert.equal(joinFailCode(r ?? ''), 'full');
    assert.equal(inviteStatus(doc, 'AB12-CD34', T0 + 60_000), 'full');
  });

  test('재발급하면 이전 코드는 revoked다(로그 판정)', () => {
    const create = op({ type: 'trip/create', trip: tripBody() });
    const first = op({ type: 'trip/issueInvite', invite: { code: 'AAAA-1111', issuedAt: T0, expiresAt: T0 + INVITE_TTL_MS, capacity: 6 } });
    const second = op({ type: 'trip/issueInvite', invite: { code: 'BBBB-2222', issuedAt: T0 + 5000, expiresAt: T0 + 5000 + INVITE_TTL_MS, capacity: 6 } });
    const log = [create, first, second].map((o, i) => ({ ...o, seq: i + 1 }));
    const now = T0 + 10_000;
    assert.deepEqual(lookupInviteInLogs([log], 'AAAA-1111', now), { error: 'revoked', tripId: 'trip-1' });
    const ok = lookupInviteInLogs([log], 'BBBB-2222', now);
    assert.ok('trip' in ok && ok.trip.id === 'trip-1');
    assert.deepEqual(lookupInviteInLogs([log], 'ZZZZ-9999', now), { error: 'notFound' });
    // 옛 코드로 합류하는 op도 거부된다.
    const doc = foldOps(log) as Trip;
    assert.equal(inviteStatus(doc, 'AAAA-1111', now), 'notFound');
  });

  test('링크 무효화(revokeInvite) 뒤에는 revoked, 삭제된 방은 notFound', () => {
    let doc = withInvite();
    doc = run(doc, op({ type: 'trip/revokeInvite' }));
    assert.equal(inviteStatus(doc, 'AB12-CD34', T0 + 60_000), 'revoked');
    assert.equal(reason(doc, op({ type: 'trip/revokeInvite' })), REASON.noInvite);
    const gone = run(withInvite(), op({ type: 'trip/delete' }));
    assert.equal(inviteStatus(gone, 'AB12-CD34', T0 + 60_000), 'notFound');
  });

  test('canInvite 기본값은 false이고 기본 그룹원의 발급을 거부한다. 방장이 켜면 발급할 수 있다', () => {
    let doc = withInvite();
    const j = joinOp(doc, 'u-junho', '준호', 'AB12-CD34');
    doc = run(doc, j.op);
    const junho = doc.members.find((m) => m.id === j.memberId);
    assert.equal(junho?.canInvite, false);
    assert.equal(canIssueInvite(doc, j.memberId), false);
    const issue = (actor: string) =>
      op({ type: 'trip/issueInvite', invite: newInvite(seededRng(3), T0 + 20_000) }, actor);
    assert.equal(reason(doc, issue(j.memberId)), REASON.inviteDenied);
    doc = run(doc, op({ type: 'member/setCanInvite', memberId: j.memberId, canInvite: true }));
    assert.equal(reason(doc, issue(j.memberId)), undefined);
  });

  test('합류 op가 스스로 canInvite true나 방장 역할을 달고 와도 그룹원·false로 들어간다', () => {
    const doc = withInvite();
    const j = joinOp(doc, 'u-x', '엑스', 'AB12-CD34');
    const body = j.op as Extract<Op, { type: 'member/join' }>;
    const sneaky = { ...body, member: { ...body.member, canInvite: true } } as Op;
    const next = run(doc, sneaky);
    assert.equal(next.members.find((m) => m.id === j.memberId)?.canInvite, false);
    const asHost = { ...body, id: 'op-host-claim', member: { ...body.member, role: 'host' } } as Op;
    assert.equal(reason(doc, asHost), MEMBER_REASON.joinRole);
  });
});

describe('FR-302 초대 수락과 그룹 전환', () => {
  test('첫 합류 때 개인 → 그룹으로 바뀌고 기존 스팟은 유지된다', () => {
    let doc = withInvite();
    assert.equal(tripMode(doc), 'personal');
    doc = run(doc, joinOp(doc, 'u-junho', '준호', 'AB12-CD34').op);
    assert.equal(tripMode(doc), 'group');
    assert.deepEqual(doc.spots.map((s) => s.id), ['s-1']);
    assert.equal(doc.spots[0].proposals.length, 1);
  });

  test('이미 참여한 userId는 op 없이 already다(중복 멤버 없음)', () => {
    let doc = withInvite();
    const j = joinOp(doc, 'u-junho', '준호', 'AB12-CD34');
    doc = run(doc, j.op);
    const again = planJoin(doc, { userId: 'u-junho', nickname: '준호', isGuest: true }, 'AB12-CD34', { ids, now: T0 });
    assert.deepEqual(again, { already: true, memberId: j.memberId });
    const hostAgain = planJoin(doc, { userId: host.userId, nickname: '민지', isGuest: true }, 'AB12-CD34', { ids, now: T0 });
    assert.equal(hostAgain.already, true);
    // 같은 userId로 새 멤버 id를 만들어 보내도 validate가 거부한다.
    const dup: Op = op({
      type: 'member/join',
      member: { id: 'm-dup', userId: 'u-junho', nickname: '준호2', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 },
      inviteCode: 'AB12-CD34',
    }, 'm-dup');
    assert.equal(reason(doc, dup), MEMBER_REASON.already);
    assert.equal(doc.members.filter((m) => m.userId === 'u-junho').length, 1);
  });

  test('같은 기기 다른 사람으로 합류(시연): 다른 userId면 새 멤버다', () => {
    let doc = withInvite();
    doc = run(doc, joinOp(doc, 'u-junho', '준호', 'AB12-CD34').op);
    doc = run(doc, joinOp(doc, 'u-sua', '수아', 'AB12-CD34').op);
    assert.deepEqual(doc.members.map((m) => m.nickname), ['민지', '준호', '수아']);
  });

  test('닉네임은 방마다 1~12자다', () => {
    assert.equal(cleanNickname('  지우  '), '지우');
    assert.equal(cleanNickname('가'.repeat(20)).length, NICKNAME_MAX);
    const doc = withInvite();
    const blank = op({
      type: 'member/join',
      member: { id: 'm-b', userId: 'u-b', nickname: '  ', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 },
      inviteCode: 'AB12-CD34',
    }, 'm-b');
    assert.equal(reason(doc, blank), MEMBER_REASON.badNickname);
  });

  test('스스로 나간 사람이 다시 합류하면 같은 멤버 id로 되살아나 제안 이력이 이어진다', () => {
    let doc = withInvite();
    const j = joinOp(doc, 'u-junho', '준호', 'AB12-CD34');
    doc = run(doc, j.op);
    doc = run(doc, op({ type: 'member/leave', memberId: j.memberId }, j.memberId));
    const back = planJoin(doc, { userId: 'u-junho', nickname: '준호', isGuest: true }, 'AB12-CD34', { ids, now: T0 + 90_000 });
    assert.equal(back.already, false);
    if (back.already) return;
    assert.equal(back.member.id, j.memberId);
    doc = run(doc, op(back.draft, back.member.id));
    const m = doc.members.find((x) => x.id === j.memberId);
    assert.equal(m?.leftAt, undefined);
    assert.equal(doc.members.length, 2);
  });

  test('내보낸 멤버는 같은 멤버 id로 되살아나지 않고 새 멤버로만 들어온다', () => {
    let doc = withInvite();
    const j = joinOp(doc, 'u-junho', '준호', 'AB12-CD34');
    doc = run(doc, j.op);
    doc = run(doc, op({ type: 'member/remove', memberId: j.memberId }));
    const back = planJoin(doc, { userId: 'u-junho', nickname: '준호', isGuest: true }, 'AB12-CD34', { ids, now: T0 + 90_000 });
    assert.equal(back.already, false);
    if (back.already) return;
    assert.notEqual(back.member.id, j.memberId);
  });
});

describe('FR-303 멤버 관리', () => {
  function group(): { doc: Trip; junho: string; sua: string } {
    let doc = withInvite();
    const a = joinOp(doc, 'u-junho', '준호', 'AB12-CD34');
    doc = run(doc, a.op);
    const b = joinOp(doc, 'u-sua', '수아', 'AB12-CD34');
    doc = run(doc, b.op);
    return { doc, junho: a.memberId, sua: b.memberId };
  }

  test('방장만 내보낼 수 있고 방장 본인은 불가다', () => {
    const { doc, junho, sua } = group();
    assert.equal(reason(doc, op({ type: 'member/remove', memberId: sua }, junho)), MEMBER_REASON.hostOnly);
    assert.equal(reason(doc, op({ type: 'member/remove', memberId: host.id })), MEMBER_REASON.removeSelf);
    const next = run(doc, op({ type: 'member/remove', memberId: sua }));
    const m = next.members.find((x) => x.id === sua);
    assert.equal(m?.leftReason, 'removed');
    assert.equal(reason(next, op({ type: 'member/remove', memberId: sua })), MEMBER_REASON.targetGone);
  });

  test('내보낸 멤버는 op를 보낼 수 없다', () => {
    const { doc, sua } = group();
    const next = run(doc, op({ type: 'member/remove', memberId: sua }));
    assert.ok(reason(next, op({ type: 'trip/setDay', date: '2026-10-17', patch: { noReturn: true } }, sua)));
  });

  test('방장 외 전원이 나가면 개인 모드로 돌아가고 채팅·스팟은 유지된다', () => {
    let { doc, junho, sua } = group();
    doc = { ...doc, messages: [{ id: 'msg-1', memberId: junho, text: '황리단길 가자', sentAt: T0, status: 'sent', seq: 5 }] };
    assert.equal(tripMode(doc), 'group');
    doc = run(doc, op({ type: 'member/leave', memberId: junho }, junho));
    assert.equal(tripMode(doc), 'group');
    doc = run(doc, op({ type: 'member/remove', memberId: sua }));
    assert.equal(tripMode(doc), 'personal');
    assert.equal(doc.messages.length, 1);
    assert.equal(doc.spots.length, 1);
    assert.equal(memberLabel(doc, junho), '준호(나간 멤버)');
  });

  test('멤버 행: 방장 먼저, 나간 멤버는 뒤에. 후보 수와 전송 대기 칩', () => {
    let { doc, junho, sua } = group();
    doc = {
      ...doc,
      spots: [
        ...doc.spots,
        { ...spot, id: 's-2', placeId: 'p-2', name: '불국사', proposals: [{ memberId: junho, source: 'chat', at: T0 }] },
        { ...spot, id: 's-3', placeId: 'p-3', name: '석굴암', proposals: [{ memberId: junho, source: 'chat', at: T0 }, { memberId: sua, source: 'chat', at: T0 }] },
      ],
    };
    doc = run(doc, op({ type: 'member/leave', memberId: sua }, sua));
    const pendingJoin = { id: 'op-p', tripId: 'trip-1', actorId: junho, at: T0, type: 'member/join' } as unknown as Op;
    const rows = memberRows(doc, { meId: host.id, pending: [pendingJoin] });
    assert.deepEqual(rows.map((r) => r.nickname), ['민지', '준호', '수아']);
    assert.equal(rows[0].sub, '방장 · 이 기기');
    assert.equal(rows[1].candidates, 2);
    assert.equal(rows[1].waiting, true);
    assert.equal(rows[2].left, true);
    assert.equal(rows[2].candidates, 1);
  });

  test('초대 권한 토글은 방장만, 방장 자신에게는 쓸 수 없다', () => {
    const { doc, junho, sua } = group();
    assert.equal(reason(doc, op({ type: 'member/setCanInvite', memberId: sua, canInvite: true }, junho)), MEMBER_REASON.hostOnly);
    assert.equal(reason(doc, op({ type: 'member/setCanInvite', memberId: host.id, canInvite: true })), MEMBER_REASON.targetHost);
  });

  test('이름 바꾸기는 본인만', () => {
    const { doc, junho, sua } = group();
    assert.equal(reason(doc, op({ type: 'member/rename', memberId: sua, nickname: '수수' }, junho)), MEMBER_REASON.selfOnly);
    const next = run(doc, op({ type: 'member/rename', memberId: junho, nickname: ' 준호형 ' }, junho));
    assert.equal(next.members.find((m) => m.id === junho)?.nickname, '준호형');
  });

  test('게스트 승격(accountLinked)은 행동한 본인 멤버만 계정으로 바꾸고 memberId를 유지한다', () => {
    const { doc, junho } = group();
    const next = run(doc, op({ type: 'member/accountLinked', userId: 'u-junho' }, junho));
    const m = next.members.find((x) => x.id === junho);
    assert.equal(m?.isGuest, false);
    assert.equal(m?.id, junho);
  });
});

describe('합류 실패 사유(04 코드리뷰 반영)', () => {
  test('종료된 방은 초대가 유효해도 ended다. validate 잠금 사유도 ended로 바뀐다', () => {
    // 여행 마지막 날(10-19)에 발급한 링크는 다음 날에도 7일 안이지만, 종료 잠금이 먼저다.
    const issued = atKst('2026-10-19', '12:00');
    const doc = withInvite('EN01-0001', issued);
    const after = atKst('2026-10-20', '12:00');
    assert.equal(inviteStatus(doc, 'EN01-0001', after), 'ok');
    assert.equal(joinStatus(doc, 'EN01-0001', after), 'ended');
    const plan = planJoin(doc, { userId: 'u-late', nickname: '늦은', isGuest: true }, 'EN01-0001', { ids, now: after });
    if (plan.already) throw new Error('unreachable');
    const v = validateOp(doc, op(plan.draft, plan.member.id, after));
    assert.equal(v.ok ? undefined : v.reason, LOCKED_REASON);
    assert.equal(joinFailure(LOCKED_REASON), 'ended');
    assert.equal(joinFailure(MEMBER_REASON.inviteFull), 'full');
  });

  test('미리보기와 합류의 판정 순서가 같다: 만료되고 종료된 방은 ended, 삭제된 방은 notFound', () => {
    const doc = withInvite();
    const late = atKst('2026-10-25', '12:00');
    assert.equal(inviteStatus(doc, 'AB12-CD34', late), 'expired');
    assert.equal(joinStatus(doc, 'AB12-CD34', late), 'ended');
    const gone = run(withInvite(), op({ type: 'trip/delete' }));
    assert.equal(joinStatus(gone, 'AB12-CD34', T0 + 60_000), 'notFound');
    assert.equal(joinStatus(withInvite(), 'AB12-CD34', T0 + 60_000), 'ok');
  });

  test('모든 실패 사유에 화면 문구가 있다(ended, offline 포함)', () => {
    for (const k of ['notFound', 'expired', 'revoked', 'full', 'ended', 'offline'] as const) {
      assert.ok(JOIN_ERROR_TEXT[k] && JOIN_ERROR_TEXT[k].length > 0, k);
    }
  });

  test('합류할 수 없는 코드도 tripId를 싣는다(이미 참여한 사람을 원격에서 확인하는 근거)', () => {
    const create = op({ type: 'trip/create', trip: tripBody() });
    const inv = op({ type: 'trip/issueInvite', invite: { code: 'TT11-2222', issuedAt: T0, expiresAt: T0 + INVITE_TTL_MS, capacity: 6 } });
    const log = [create, inv].map((o, i) => ({ ...o, seq: i + 1 }));
    assert.deepEqual(lookupInviteInLogs([log], 'TT11-2222', T0 + INVITE_TTL_MS), { error: 'expired', tripId: 'trip-1' });
    const gone = [...log, { ...op({ type: 'trip/delete' }), seq: 3 }];
    assert.deepEqual(lookupInviteInLogs([gone], 'TT11-2222', T0 + 1000), { error: 'notFound' }, '삭제된 방은 tripId도 주지 않는다');
  });

  test('멤버 행: 합류 전송 대기면 보조 줄이 전송 대기이고, 초대 권한은 칩 대신 보조 줄에 붙는다', () => {
    let doc = withInvite();
    const j = joinOp(doc, 'u-junho', '준호', 'AB12-CD34');
    doc = run(doc, j.op);
    doc = run(doc, op({ type: 'member/setCanInvite', memberId: j.memberId, canInvite: true }));
    const rows = memberRows(doc, { meId: host.id });
    assert.match(rows[1].sub, / · 초대 가능$/);
    assert.equal(rows[0].candidates, 1);
    const waiting = memberRows(doc, { meId: host.id, pending: [j.op] });
    assert.equal(waiting[1].waiting, true);
    assert.equal(waiting[1].sub, '합류 전송 대기 · 연결되면 반영');
  });
});
