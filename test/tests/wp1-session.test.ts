import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { NotifyLogEntry } from '../src/types';
import { DEFAULT_NOTIFY_PREFS, NOTIFY_COOLDOWN_MS, SESSION_EXPIRY_NOTICE_MS, SESSION_TTL_MS } from '../src/core/constants';
import { recordNotify } from '../src/core/notify';
import type { AccountPublic } from '../src/core/ports';
import {
  accountSession,
  expiredNotice,
  isExpired,
  isExpirySoon,
  issueGuest,
  keepSession,
  newDeviceToken,
  restoreSession,
  saveSession,
  SESSION_KV_KEY,
  SESSION_TOUCH_GAP_MS,
  sessionExpiryKey,
  sessionExpiryNotice,
  tokenTail,
  touch,
  touchOrExpire,
} from '../src/core/session';
import { memoryKV, seededRng } from './helpers/fakes';

/**
 * WP1 세션(FR-105 게스트, FR-102 계정 세션 30일). src/core/session.ts 순수 함수를 주입 Rng·시각·memoryKV로 본다.
 */

const T0 = Date.UTC(2026, 9, 1, 1, 0, 0); // 2026-10-01 10:00 KST
const DAY = 24 * 60 * 60 * 1000;

describe('게스트 세션 발급(FR-105)', () => {
  test('기기 토큰은 주입 Rng의 16바이트(128비트) base64url이다', () => {
    const t = newDeviceToken(seededRng(7));
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    // 16바이트 → 패딩 없는 base64url 22자
    assert.equal(t.length, 22);
  });

  test('같은 시드면 같은 토큰, 다른 시드면 다른 토큰이다(주입 Rng만 쓴다)', () => {
    assert.equal(newDeviceToken(seededRng(3)), newDeviceToken(seededRng(3)));
    assert.notEqual(newDeviceToken(seededRng(3)), newDeviceToken(seededRng(4)));
  });

  test('발급 세션은 게스트이고 만료는 발급 + 30일이다', () => {
    const s = issueGuest({ nickname: '민지', rng: seededRng(1), now: T0 });
    assert.equal(s.kind, 'guest');
    assert.equal(s.nickname, '민지');
    assert.equal(s.issuedAt, T0);
    assert.equal(s.expiresAt, T0 + SESSION_TTL_MS);
    assert.equal(s.expiresAt - s.issuedAt, 30 * DAY);
    assert.match(s.userId, /^u_/);
    assert.equal(s.deviceToken.length, 22);
  });

  test('deviceToken을 넘기면 이 기기 토큰을 그대로 쓰고 userId만 새로 만든다', () => {
    const a = issueGuest({ nickname: '민지', rng: seededRng(1), now: T0 });
    const b = issueGuest({ nickname: '민지', rng: seededRng(2), now: T0, deviceToken: a.deviceToken });
    assert.equal(b.deviceToken, a.deviceToken);
    assert.notEqual(b.userId, a.userId);
  });

  test('토큰은 끝 4자리만 보인다', () => {
    const s = issueGuest({ nickname: '민지', rng: seededRng(1), now: T0 });
    const shown = tokenTail(s);
    assert.ok(shown.endsWith(s.deviceToken.slice(-4)));
    assert.ok(!shown.includes(s.deviceToken.slice(0, -4)));
    assert.equal(shown.replace(/[^A-Za-z0-9_-]/g, '').length, 4);
  });
});

describe('사용할 때마다 연장, 만료면 폐기', () => {
  const s = issueGuest({ nickname: '민지', rng: seededRng(1), now: T0 });

  test('touch는 now + 30일로 늘린다', () => {
    const later = T0 + 10 * DAY;
    assert.equal(touch(s, later).expiresAt, later + SESSION_TTL_MS);
  });

  test('만료 경계: expiresAt 그 시각까지는 살아 있고 1ms 뒤에 만료다', () => {
    assert.equal(isExpired(s, s.expiresAt), false);
    assert.equal(isExpired(s, s.expiresAt + 1), true);
  });

  test('이미 만료된 세션은 touch로 되살리지 않는다', () => {
    assert.equal(touch(s, s.expiresAt + 1).expiresAt, s.expiresAt);
  });

  test('touchOrExpire: 없음·만료·연장', () => {
    assert.deepEqual(touchOrExpire(undefined, T0), { state: 'none' });
    const expired = touchOrExpire(s, s.expiresAt + 1);
    assert.equal(expired.state, 'expired');
    const ok = touchOrExpire(s, T0 + DAY);
    assert.equal(ok.state, 'ok');
    if (ok.state === 'ok') assert.equal(ok.session.expiresAt, T0 + DAY + SESSION_TTL_MS);
  });

  test('만료 안내: 게스트는 복구 불가, 계정은 다시 로그인하면 여행방 유지', () => {
    assert.match(expiredNotice({ kind: 'guest' }), /복구할 수 없/);
    assert.match(expiredNotice({ kind: 'account' }), /다시 로그인/);
    assert.match(expiredNotice({ kind: 'account' }), /여행방/);
  });
});

describe('재부팅 복원(memoryKV)', () => {
  test('저장한 세션을 다시 읽으면 같은 사용자로 복원되고 연장된다', async () => {
    const kv = memoryKV();
    const s = issueGuest({ nickname: '민지', rng: seededRng(2), now: T0 });
    await saveSession(kv, s);
    const r = await restoreSession(kv, T0 + 5 * DAY);
    assert.equal(r.state, 'ok');
    if (r.state !== 'ok') return;
    assert.equal(r.session.userId, s.userId);
    assert.equal(r.session.deviceToken, s.deviceToken);
    assert.equal(r.session.expiresAt, T0 + 5 * DAY + SESSION_TTL_MS);
    // 연장된 값이 저장소에도 남는다
    const again = JSON.parse((await kv.get(SESSION_KV_KEY)) ?? '{}');
    assert.equal(again.expiresAt, T0 + 5 * DAY + SESSION_TTL_MS);
  });

  test('만료된 세션은 복원하지 않고 저장소에서도 지운다', async () => {
    const kv = memoryKV();
    const s = issueGuest({ nickname: '민지', rng: seededRng(2), now: T0 });
    await saveSession(kv, s);
    const r = await restoreSession(kv, s.expiresAt + 1);
    assert.equal(r.state, 'expired');
    assert.equal(await kv.get(SESSION_KV_KEY), null);
  });

  test('깨진 값은 세션 없음으로 본다', async () => {
    const kv = memoryKV();
    await kv.set(SESSION_KV_KEY, '{not json');
    assert.equal((await restoreSession(kv, T0)).state, 'none');
    await kv.set(SESSION_KV_KEY, JSON.stringify({ userId: 1 }));
    assert.equal((await restoreSession(kv, T0)).state, 'none');
  });
});

describe('계정 세션(FR-102 30일, 사용 시 갱신)', () => {
  const account: AccountPublic = {
    accountId: 'acc_1',
    userId: 'u_guest',
    email: 'minji@example.com',
    nickname: '민지',
    verified: true,
    providers: ['email'],
    profile: { nickname: '민지', tags: [] },
  };

  test('계정 userId를 쓰고 이 기기 토큰을 유지한다', () => {
    const s = accountSession({ account, deviceToken: 'device-token-abcd', rng: seededRng(1), now: T0 });
    assert.equal(s.kind, 'account');
    assert.equal(s.userId, 'u_guest');
    assert.equal(s.accountId, 'acc_1');
    assert.equal(s.deviceToken, 'device-token-abcd');
    assert.equal(s.expiresAt, T0 + SESSION_TTL_MS);
  });

  test('계정 세션도 만료 뒤에는 expired다', () => {
    const s = accountSession({ account, rng: seededRng(1), now: T0 });
    assert.equal(touchOrExpire(s, T0 + SESSION_TTL_MS + 1).state, 'expired');
  });
});

describe('sessionExpiry 알림(만료 3일 전, 공유 notify 규칙)', () => {
  const s = issueGuest({ nickname: '민지', rng: seededRng(5), now: T0 });
  const soon = s.expiresAt - SESSION_EXPIRY_NOTICE_MS;

  test('만료 3일 전부터 대상이고 그 전에는 아니다', () => {
    assert.equal(isExpirySoon(s, soon - 1), false);
    assert.equal(isExpirySoon(s, soon), true);
    assert.equal(isExpirySoon(s, s.expiresAt + 1), false);
  });

  test('계정 세션은 알리지 않는다', () => {
    const acc = { ...s, kind: 'account' as const };
    assert.equal(sessionExpiryNotice(acc, soon, [], DEFAULT_NOTIFY_PREFS), null);
  });

  test('한 번 띄우면 30분 안에는 다시 띄우지 않고, 30분 뒤에는 다시 띄운다', () => {
    const first = sessionExpiryNotice(s, soon, [], DEFAULT_NOTIFY_PREFS);
    assert.ok(first);
    assert.equal(first.entry.kind, 'sessionExpiry');
    assert.match(first.text, /3일 뒤 만료/);
    const log: NotifyLogEntry[] = recordNotify([], first.entry, soon);
    assert.equal(sessionExpiryNotice(s, soon + NOTIFY_COOLDOWN_MS - 1, log, DEFAULT_NOTIFY_PREFS), null);
    assert.ok(sessionExpiryNotice(s, soon + NOTIFY_COOLDOWN_MS, log, DEFAULT_NOTIFY_PREFS));
  });

  test('알림을 끄면 띄우지 않는다', () => {
    assert.equal(sessionExpiryNotice(s, soon, [], { ...DEFAULT_NOTIFY_PREFS, sessionExpiry: false }), null);
  });

  test('부팅 판정(extended)은 연장했다는 문구다', () => {
    const n = sessionExpiryNotice(s, soon, [], DEFAULT_NOTIFY_PREFS, { extended: true });
    assert.ok(n);
    assert.match(n.text, /30일 연장했습니다/);
  });
});

describe('앱 사용 중 세션 유지(keepSession, 시뮬레이터 시각 포함)', () => {
  const s = issueGuest({ nickname: '민지', rng: seededRng(8), now: T0 });

  test('마지막 갱신 1시간 안에는 idle, 1시간이 지나면 now + 30일로 연장한다', () => {
    assert.deepEqual(keepSession(s, T0 + SESSION_TOUCH_GAP_MS - 1, [], DEFAULT_NOTIFY_PREFS), { state: 'idle' });
    const r = keepSession(s, T0 + SESSION_TOUCH_GAP_MS, [], DEFAULT_NOTIFY_PREFS);
    assert.equal(r.state, 'touched');
    if (r.state === 'touched') {
      assert.equal(r.session.expiresAt, T0 + SESSION_TOUCH_GAP_MS + SESSION_TTL_MS);
      assert.equal(r.notice, undefined);
    }
  });

  test('시뮬레이터로 30일을 넘기면 앱을 쓰는 중에도 폐기하고 안내한다(게스트 복구 불가, 계정 재로그인)', () => {
    const r = keepSession(s, s.expiresAt + 1, [], DEFAULT_NOTIFY_PREFS);
    assert.equal(r.state, 'expired');
    if (r.state === 'expired') assert.match(r.text, /복구할 수 없/);
    const acc = accountSession({
      account: { accountId: 'a', userId: 'u', email: 'm@example.com', nickname: '민지', verified: true, providers: ['email'], profile: { nickname: '민지', tags: [] } },
      rng: seededRng(1),
      now: T0,
    });
    const r2 = keepSession(acc, acc.expiresAt + 1, [], DEFAULT_NOTIFY_PREFS);
    assert.equal(r2.state, 'expired');
    if (r2.state === 'expired') assert.match(r2.text, /다시 로그인/);
    // 경계: expiresAt 그 시각에는 아직 살아 있어 연장된다
    assert.equal(keepSession(s, s.expiresAt, [], DEFAULT_NOTIFY_PREFS).state, 'touched');
  });

  test('연장 전 세션이 만료 3일 창 안이면 알림을 싣고, 같은 세션 창은 한 번만 알린다', () => {
    const soon = s.expiresAt - SESSION_EXPIRY_NOTICE_MS;
    const r = keepSession(s, soon, [], DEFAULT_NOTIFY_PREFS);
    assert.equal(r.state, 'touched');
    if (r.state !== 'touched') return;
    assert.ok(r.notice);
    assert.match(r.notice.text, /30일 연장했습니다/);
    assert.equal(r.notice.entry.key, sessionExpiryKey(s));
    // 30분이 지나 notify 기록이 정리돼도 같은 key를 이미 띄웠으면 다시 띄우지 않는다('3일 전에 한 번')
    assert.equal(sessionExpiryNotice(s, soon + NOTIFY_COOLDOWN_MS * 10, [], DEFAULT_NOTIFY_PREFS, { notifiedKey: r.notice.entry.key }), null);
    // 알림을 끄면 연장만 하고 알리지 않는다
    const off = keepSession(s, soon, [], { ...DEFAULT_NOTIFY_PREFS, sessionExpiry: false });
    assert.equal(off.state === 'touched' ? off.notice : 'x', undefined);
  });

  test('세션이 없으면 none', () => {
    assert.deepEqual(keepSession(undefined, T0, [], DEFAULT_NOTIFY_PREFS), { state: 'none' });
  });
});
