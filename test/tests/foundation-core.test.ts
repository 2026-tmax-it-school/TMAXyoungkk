import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import type { ChatMessage, Member, NotifyKind, NotifyPrefs, Spot, Trip } from '../src/types';
import { DEFAULT_NOTIFY_PREFS, NOTIFY_COOLDOWN_MS } from '../src/core/constants';
import { orderedMessages } from '../src/core/chatOrder';
import { activeMembers, canIssueInvite, isHost, memberById, tripMode } from '../src/core/group';
import { memoryKV } from '../src/core/kv';
import { recordNotify, shouldNotify } from '../src/core/notify';
import { sha256Hex } from '../src/core/sha256';
import { priorityCompare, proposerCount, proposerIds } from '../src/core/spotUtil';
import {
  daysUntil,
  isEnded,
  isRetentionExpired,
  isTrackExpired,
  retentionUntil,
  tripStatus,
} from '../src/core/tripStatus';
import {
  addDays,
  atKst,
  base32,
  base64url,
  dateRange,
  dayLabel,
  dayShort,
  haversineKm,
  humanMin,
  josa,
  kstDate,
  kstHHMM,
  makeIdGen,
  manualClock,
  offsetClock,
  toHHMM,
  toMin,
} from '../src/core/util';
import { seededRng } from './helpers/fakes';
import { scenarioTrip } from './helpers/fixtures';

/**
 * 공유 core 검사(기반 소유). 패키지는 이 로직을 고칠 수 없으니 여기서 한 번에 지킨다.
 */

const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;

function tripOf(start: string, end: string): Trip {
  return { ...scenarioTrip(), startDate: start, endDate: end };
}

describe('util (KST 날짜·시각)', () => {
  test('kstDate·kstHHMM·atKst는 기기 시간대와 무관하게 KST로 왕복한다', () => {
    const t = atKst('2026-10-17', '00:30');
    assert.equal(new Date(t).toISOString(), '2026-10-16T15:30:00.000Z');
    assert.equal(kstDate(t), '2026-10-17');
    assert.equal(kstHHMM(t), '00:30');
    assert.equal(kstDate(atKst('2026-10-17', '23:59')), '2026-10-17');
    assert.equal(kstDate(atKst('2026-10-17', '23:59') + 60 * SEC), '2026-10-18');
  });

  test('toMin·toHHMM·humanMin', () => {
    assert.equal(toMin('09:25'), 565);
    assert.equal(toHHMM(565), '09:25');
    assert.equal(toHHMM(24 * 60 + 30), '24:30');
    assert.equal(humanMin(70), '1시간 10분');
    assert.equal(humanMin(45), '45분');
    assert.equal(humanMin(120), '2시간');
  });

  test('날짜 계산과 표시', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.deepEqual(dateRange('2026-10-17', '2026-10-19'), ['2026-10-17', '2026-10-18', '2026-10-19']);
    assert.deepEqual(dateRange('2026-10-19', '2026-10-17'), []);
    assert.equal(dayShort('2026-10-18'), '10/18');
    // 2026-10-17은 토요일이다(HANDOFF의 '금'은 2025년 달력).
    assert.equal(dayLabel('2026-10-17'), '10/17 (토)');
  });

  test('josa는 받침과 숫자 읽기로 조사를 고른다', () => {
    assert.equal(josa('10/17', '이/가'), '10/17이');
    assert.equal(josa('10/18', '이/가'), '10/18이');
    assert.equal(josa('10/19', '이/가'), '10/19가');
    assert.equal(josa('10/18 저녁', '이/가'), '10/18 저녁이');
    assert.equal(josa('10/18 오후', '이/가'), '10/18 오후가');
    assert.equal(josa('동궁과 월지', '을/를'), '동궁과 월지를');
    assert.equal(josa('불국사', '은/는'), '불국사는');
    assert.equal(josa('서울', '으로/로'), '서울로');
    assert.equal(josa('부산', '으로/로'), '부산으로');
  });

  test('haversineKm', () => {
    const d = haversineKm({ latitude: 35.7901, longitude: 129.332 }, { latitude: 35.7948, longitude: 129.3491 });
    assert.ok(d > 1.4 && d < 1.8, `불국사-석굴암 ${d}km`);
  });
});

describe('인코딩', () => {
  test('base64url은 node Buffer와 같다', () => {
    const rng = seededRng(7);
    for (const n of [0, 1, 2, 3, 15, 16, 17, 32]) {
      const bytes = rng.bytes(n);
      assert.equal(base64url(bytes), Buffer.from(bytes).toString('base64url'));
    }
    assert.equal(base64url(rng.bytes(16)).length, 22);
  });

  test('base32는 Crockford 알파벳으로 5바이트를 8자로 만든다', () => {
    assert.equal(base32(new Uint8Array([0, 0, 0, 0, 0])), '00000000');
    assert.equal(base32(new Uint8Array([255, 255, 255, 255, 255])), 'ZZZZZZZZ');
    // 0x08 0x42 0x10 0x84 0x21 = 00001 00001 00001 00001 00001 00001 00001 00001
    assert.equal(base32(new Uint8Array([0x08, 0x42, 0x10, 0x84, 0x21])), '11111111');
    const s = base32(seededRng(3).bytes(5));
    assert.match(s, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  test('makeIdGen은 주입 난수만 쓴다(같은 시드 → 같은 ID)', () => {
    const a = makeIdGen(seededRng(11));
    const b = makeIdGen(seededRng(11));
    assert.equal(a.next('op'), b.next('op'));
    assert.match(a.next('trip'), /^trip_[0-9a-z]{16}$/);
  });
});

describe('sha256Hex (순수 구현)', () => {
  test('알려진 벡터', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('한글·서로게이트·긴 입력이 node:crypto와 같다', () => {
    const inputs = [
      '한글',
      '경주 2박 3일 · 불국사',
      '\u{1F600} 이모지 서로게이트',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      '가'.repeat(1000),
    ];
    for (const s of inputs) {
      assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), s.slice(0, 10));
    }
  });
});

describe('memoryKV', () => {
  test('get·set·remove', async () => {
    const kv = memoryKV({ a: '1' });
    assert.equal(await kv.get('a'), '1');
    assert.equal(await kv.get('b'), null);
    await kv.set('b', '2');
    assert.equal(await kv.get('b'), '2');
    await kv.remove('a');
    assert.equal(await kv.get('a'), null);
  });
});

describe('tripStatus (FR-203, UTC 회귀)', () => {
  const trip = tripOf('2026-10-17', '2026-10-19');

  test('시작일 00:30 KST는 진행중이다(UTC로는 전날)', () => {
    assert.equal(tripStatus(trip, atKst('2026-10-17', '00:30')), 'ongoing');
  });

  test('경계: 전날 23:59 예정, 종료일 23:59 진행중, 다음 날 00:00 완료', () => {
    assert.equal(tripStatus(trip, atKst('2026-10-16', '23:59')), 'upcoming');
    assert.equal(tripStatus(trip, atKst('2026-10-19', '23:59')), 'ongoing');
    assert.equal(tripStatus(trip, atKst('2026-10-20', '00:00')), 'done');
    assert.equal(isEnded(trip, atKst('2026-10-19', '23:59')), false);
    assert.equal(isEnded(trip, atKst('2026-10-20', '00:00')), true);
  });

  test('daysUntil', () => {
    assert.equal(daysUntil(trip, atKst('2026-10-10', '08:00')), 7);
    assert.equal(daysUntil(trip, atKst('2026-10-17', '08:00')), 0);
    assert.equal(daysUntil(trip, atKst('2026-10-18', '08:00')), -1);
  });

  test('isTrackExpired: 종료일 다음 날 00:00 KST + 90일, 경계 ±1초', () => {
    const limit = atKst('2026-10-20', '00:00') + 90 * DAY;
    assert.equal(isTrackExpired(trip, limit - SEC), false);
    assert.equal(isTrackExpired(trip, limit + SEC), true);
  });

  test('retentionUntil·isRetentionExpired: 종료일 다음 날 00:00 KST + 365일, 경계 ±1초', () => {
    const limit = atKst('2026-10-20', '00:00') + 365 * DAY;
    assert.equal(retentionUntil(trip), limit);
    assert.equal(isRetentionExpired(trip, limit - SEC), false);
    assert.equal(isRetentionExpired(trip, limit + SEC), true);
  });
});

describe('notify (동일 유형 30분 1회, 유형별 끄기)', () => {
  const kinds: NotifyKind[] = ['delay', 'freeTime', 'arrival', 'sessionExpiry'];
  const t0 = atKst('2026-10-18', '10:00');

  for (const kind of kinds) {
    test(`${kind}: 30분 1회, 29분 59초 차단, 다른 키 허용, 끄면 없음`, () => {
      const first = { kind, key: 'k1', at: t0 };
      assert.equal(shouldNotify([], first, DEFAULT_NOTIFY_PREFS), true);
      const log = recordNotify([], first, t0);
      assert.equal(shouldNotify(log, { kind, key: 'k1', at: t0 + NOTIFY_COOLDOWN_MS - SEC }, DEFAULT_NOTIFY_PREFS), false);
      assert.equal(shouldNotify(log, { kind, key: 'k1', at: t0 + NOTIFY_COOLDOWN_MS }, DEFAULT_NOTIFY_PREFS), true);
      assert.equal(shouldNotify(log, { kind, key: 'k2', at: t0 + SEC }, DEFAULT_NOTIFY_PREFS), true);
      const off: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS, [kind]: false };
      assert.equal(shouldNotify([], first, off), false);
    });
  }

  test('유형이 다르면 서로 막지 않는다', () => {
    const log = recordNotify([], { kind: 'delay', key: 'k', at: t0 }, t0);
    assert.equal(shouldNotify(log, { kind: 'freeTime', key: 'k', at: t0 + SEC }, DEFAULT_NOTIFY_PREFS), true);
  });

  test('recordNotify는 30분 지난 항목을 정리한다', () => {
    let log = recordNotify([], { kind: 'delay', key: 'a', at: t0 }, t0);
    log = recordNotify(log, { kind: 'arrival', key: 'b', at: t0 + NOTIFY_COOLDOWN_MS }, t0 + NOTIFY_COOLDOWN_MS);
    assert.deepEqual(
      log.map((l) => l.key),
      ['b'],
    );
  });
});

describe('group (개인·그룹 모드, 초대 권한)', () => {
  const host: Member = { id: 'h', userId: 'uh', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: 1 };
  const mem: Member = { id: 'm', userId: 'um', nickname: '준호', role: 'member', isGuest: true, canInvite: false, joinedAt: 2 };

  test('활성 멤버 2명 이상이면 그룹, 전원 나가면 개인으로 돌아간다', () => {
    const base = scenarioTrip();
    assert.equal(tripMode({ ...base, members: [host] }), 'personal');
    assert.equal(tripMode({ ...base, members: [host, mem] }), 'group');
    const left = { ...base, members: [host, { ...mem, leftAt: 5, leftReason: 'left' as const }] };
    assert.equal(tripMode(left), 'personal');
    assert.deepEqual(
      activeMembers(left).map((m) => m.id),
      ['h'],
    );
  });

  test('isHost·memberById·canIssueInvite(기본 false)', () => {
    const t = { ...scenarioTrip(), members: [host, mem] };
    assert.equal(isHost(t, 'h'), true);
    assert.equal(isHost(t, 'm'), false);
    assert.equal(memberById(t, 'm')?.nickname, '준호');
    assert.equal(canIssueInvite(t, 'h'), true);
    assert.equal(canIssueInvite(t, 'm'), false);
    const allowed = { ...t, members: [host, { ...mem, canInvite: true }] };
    assert.equal(canIssueInvite(allowed, 'm'), true);
    const gone = { ...t, members: [host, { ...mem, canInvite: true, leftAt: 9 }] };
    assert.equal(canIssueInvite(gone, 'm'), false);
    assert.equal(canIssueInvite(t, 'nobody'), false);
  });
});

describe('chatOrder (FR-304 순서 보정)', () => {
  test('seq 순으로 두고 pending은 보낸 시각 순으로 뒤에 붙인다', () => {
    const msg = (id: string, sentAt: number, seq?: number): ChatMessage => ({
      id,
      memberId: 'm',
      text: id,
      sentAt,
      seq,
      status: seq == null ? 'pending' : 'sent',
    });
    const trip = { ...scenarioTrip(), messages: [msg('p2', 50), msg('s3', 10, 3), msg('p1', 5), msg('s1', 30, 1)] };
    assert.deepEqual(
      orderedMessages(trip).map((m) => m.id),
      ['s1', 's3', 'p1', 'p2'],
    );
  });
});

describe('spotUtil (FR-402·403)', () => {
  const spot = (id: string, createdAt: number, members: string[]): Spot => ({
    id,
    placeId: id,
    name: id,
    category: '관광지',
    coord: { latitude: 0, longitude: 0 },
    proposals: members.map((m, i) => ({ memberId: m, source: 'chat', at: createdAt + i })),
    pinned: false,
    stayMin: 90,
    createdAt,
    edited: {},
  });

  test('같은 사람의 여러 제안은 한 명으로 센다', () => {
    const s = spot('a', 1, ['x', 'y', 'x']);
    assert.deepEqual(proposerIds(s), ['x', 'y']);
    assert.equal(proposerCount(s), 2);
  });

  test('우선순위: 제안자 많은 순, 동점이면 먼저 등록한 순', () => {
    const list = [spot('late1', 30, ['x']), spot('many', 40, ['x', 'y', 'z']), spot('early1', 10, ['x']), spot('two', 20, ['x', 'y'])];
    assert.deepEqual(
      [...list].sort(priorityCompare).map((s) => s.id),
      ['many', 'two', 'early1', 'late1'],
    );
  });
});

describe('시계 도우미(offsetClock, manualClock)', () => {
  test('offsetClock은 시작 시각에서 기준 시계와 같은 속도로 간다', () => {
    const base = manualClock(1_000_000);
    const c = offsetClock(atKst('2026-10-01', '10:00'), base);
    assert.equal(c.now(), atKst('2026-10-01', '10:00'));
    base.advance(60_000);
    assert.equal(c.now(), atKst('2026-10-01', '10:01'));
  });

  test('manualClock은 set·advance로만 움직인다', () => {
    const c = manualClock(5);
    assert.equal(c.now(), 5);
    c.set(100);
    c.advance(1);
    assert.equal(c.now(), 101);
  });
});

describe('FR-403 동점 규칙 회귀(priorityCompare)', () => {
  const mk = (id: string, createdAt: number): Spot =>
    ({
      id,
      placeId: id,
      name: id,
      category: '관광지',
      coord: { latitude: 0, longitude: 0 },
      proposals: [{ memberId: 'm1', source: 'chat', at: createdAt }],
      pinned: false,
      stayMin: 60,
      createdAt,
      edited: {},
    }) as Spot;

  test('등록 시각이 다르면 id와 상관없이 먼저 등록한 쪽이 우선이다', () => {
    // seqIds는 'x_10' < 'x_9'로 사전순이 뒤집힌다. 등록 시각이 다르면 영향이 없어야 한다.
    const early = mk('x_10', atKst('2026-10-01', '10:01'));
    const late = mk('x_9', atKst('2026-10-01', '10:02'));
    assert.ok(priorityCompare(early, late) < 0);
    assert.ok(priorityCompare(late, early) > 0);
  });

  test('등록 시각까지 같으면 id 비교로 떨어진다(결과가 id 생성 방식에 달려 있다 — 시나리오는 같은 시각을 만들지 않는다)', () => {
    const same = atKst('2026-10-01', '10:00');
    const a = mk('x_10', same);
    const b = mk('x_9', same);
    assert.ok(priorityCompare(a, b) < 0, "사전순 'x_10' < 'x_9'");
  });
});
