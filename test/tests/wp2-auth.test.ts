import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import {
  DEVICE_ATTEMPT_LIMIT,
  DEVICE_ATTEMPT_WINDOW_MS,
  LOGIN_LOCK_MS,
  LOGIN_MAX_FAILS,
  NICKNAME_MAX as APP_NICKNAME_MAX,
  PASSWORD_MIN_LENGTH as APP_PASSWORD_MIN,
  SESSION_TTL_MS as APP_SESSION_TTL,
} from '../src/core/constants';
import { passwordViolations as appViolations } from '../src/core/auth';
import type { AuthResult, FetchLike } from '../src/core/ports';
import { createHttpAuth } from '../src/services/auth/http';
import {
  ATTEMPT_WINDOW_MS,
  createAuthService,
  createMemoryAuthStore,
  devOutboxFromEnv,
  EMAIL_IP_ATTEMPT_LIMIT,
  hashPassword,
  IP_ATTEMPT_LIMIT,
  LOGIN_LOCK_MS as SRV_LOCK_MS,
  LOGIN_MAX_FAILS as SRV_MAX_FAILS,
  NICKNAME_MAX,
  PASSWORD_MIN_LENGTH,
  passwordViolations,
  SESSION_TTL_MS,
  tokenHash,
  verifyPassword,
  type AuthStore,
  type OutboxMail,
} from '../server/auth.mjs';
import { createSyncStore, startSyncServer, type SyncStore } from '../server/sync-server.mjs';
import { migrate } from '../server/db/migrate.mjs';
import { createPostgresStore, sqlDb, type SqlDb } from '../server/db/postgres-store.mjs';
import { memoryKV } from './helpers/fakes';

/**
 * WP2 계정·로그인 서버(server/auth.mjs, 2026-10-10).
 * 같은 HTTP 시나리오를 메모리 저장소, PGlite(같은 SQL), 실제 PostgreSQL(YT_TEST_DATABASE_URL이 있을 때, 임시 스키마를 쓰고 지운다)로 돈다.
 * 가입·인증·재발송·로그인·세션(30일 연장, 만료)·시도 제한(동시 요청 포함)·재설정·탈퇴(익명화)·모의 소셜(메일로만 연결, 개발 서버만)·
 * 게스트 승격 userId 유지(기기 토큰 확인으로 가로채기 막기),
 * 저장 값에 비밀번호·토큰 원문이 없는지, 앱 HTTP 제공자(src/services/auth/http.ts)가 실제 서버와 맞물리는지 본다.
 * 시도 제한이 IP(127.0.0.1) 기준이라 테스트마다 시계를 11분 넘긴다.
 */

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const PW = 'trip2026ok';
/** 테스트용 scrypt 비용(기본 16384는 느리다) */
const COST = 1024;

type Json = Record<string, any>;

interface Opened {
  store: SyncStore;
  db?: SqlDb;
  close(): Promise<void>;
}

async function openMemory(): Promise<Opened> {
  return { store: createSyncStore(), close: async () => {} };
}

async function openPglite(): Promise<Opened> {
  const pg = new PGlite();
  await pg.waitReady;
  const db = sqlDb(pg);
  await migrate(db);
  return { store: createPostgresStore(db, { warn: () => {} }), db, close: () => pg.close() };
}

const PG_URL = process.env.YT_TEST_DATABASE_URL;

/** 실제 PostgreSQL. 임시 스키마를 만들어 search_path로 쓰고, 끝나면 지운다(테스트 행을 남기지 않는다). */
async function openRealPostgres(): Promise<Opened> {
  const { default: pg } = await import('pg');
  const schema = `yt_auth_${process.pid}_${Date.now().toString(36)}`;
  const admin = new pg.Pool({ connectionString: PG_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: PG_URL, max: 5, options: `-c search_path=${schema}` });
  const db = sqlDb(pool);
  await migrate(db);
  return {
    store: createPostgresStore(db, { warn: () => {} }),
    db,
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

const BACKENDS: { name: string; open: () => Promise<Opened>; skip: string | false }[] = [
  { name: '메모리', open: openMemory, skip: false },
  { name: 'PGlite', open: openPglite, skip: false },
  { name: '실제 PostgreSQL', open: openRealPostgres, skip: PG_URL ? false : 'YT_TEST_DATABASE_URL이 없어 건너뜀' },
];

test('서버 규칙 값은 앱 상수와 같다(비밀번호 규칙, 닉네임 길이, 세션 30일, 5회 10분 잠금, 10분 20회)', () => {
  assert.equal(PASSWORD_MIN_LENGTH, APP_PASSWORD_MIN);
  assert.equal(NICKNAME_MAX, APP_NICKNAME_MAX);
  assert.equal(SESSION_TTL_MS, APP_SESSION_TTL);
  assert.equal(SRV_MAX_FAILS, LOGIN_MAX_FAILS);
  assert.equal(SRV_LOCK_MS, LOGIN_LOCK_MS);
  assert.equal(IP_ATTEMPT_LIMIT, DEVICE_ATTEMPT_LIMIT);
  assert.equal(ATTEMPT_WINDOW_MS, DEVICE_ATTEMPT_WINDOW_MS);
  for (const p of ['', 'abcdefgh', '12345678', 'abc123', 'abcd1234', 'ＡＢＣ12345']) assert.deepEqual(passwordViolations(p), appViolations(p), p);
});

test('비밀번호 해시: scrypt + 사람마다 salt, 같은 비밀번호도 다른 값, 틀린 값·모양이 틀린 값은 거짓', async () => {
  const a = await hashPassword(PW, { cost: COST });
  const b = await hashPassword(PW, { cost: COST });
  assert.match(a, /^scrypt\$1024\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes(PW));
  assert.equal(await verifyPassword(PW, a), true);
  assert.equal(await verifyPassword('trip2026no', a), false);
  assert.equal(await verifyPassword(PW, 'sha256$x'), false);
  assert.equal(await verifyPassword(PW, null), false);
});

test('개발용 보낸편지함(과 모의 소셜)은 SYNC_ALLOW_RESET=1 또는 AUTH_DEV_OUTBOX=1일 때만 연다(저장소 종류와 상관없다)', () => {
  assert.equal(devOutboxFromEnv({}), false);
  assert.equal(devOutboxFromEnv({ SYNC_ALLOW_RESET: '1' }), true);
  assert.equal(devOutboxFromEnv({ AUTH_DEV_OUTBOX: '1' }), true);
  assert.equal(devOutboxFromEnv({ AUTH_DEV_OUTBOX: 'yes', SYNC_ALLOW_RESET: '0' }), false);
});

for (const backend of BACKENDS) {
  describe(`계정 서버(${backend.name})`, { skip: backend.skip }, () => {
    let opened: Opened;
    let server: { url: string; close: () => Promise<void> };
    let now = T0;
    const logs: string[] = [];

    before(async () => {
      opened = await backend.open();
      server = await startSyncServer({
        store: opened.store,
        now: () => now,
        purgeEveryMs: 0,
        proxy: false,
        log: (m) => logs.push(m),
        auth: { devOutbox: true, passwordCost: COST },
      });
    });
    after(async () => {
      await server?.close();
      await opened?.close();
    });
    beforeEach(() => {
      now += 11 * MIN;
    });

    async function call(path: string, body?: unknown, token?: string): Promise<[number, Json]> {
      const res = await fetch(`${server.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return [res.status, (await res.json()) as Json];
    }

    async function mails(to?: string): Promise<OutboxMail[]> {
      const [status, body] = await call('/auth/outbox');
      assert.equal(status, 200);
      return (body.mails as OutboxMail[]).filter((m) => to == null || m.to === to);
    }

    let seq = 0;
    /** 가입하고 인증까지 마친 계정. 인증 응답의 세션 토큰도 준다 */
    async function verified(prefix = 'user', extra: Json = {}) {
      seq += 1;
      const email = `${prefix}${seq}@example.com`;
      const [s, r] = await call('/auth/signup', { email, password: PW, nickname: `${prefix.slice(0, 6)}${seq}`, ...extra });
      assert.equal(s, 200, JSON.stringify(r));
      const mail = (await mails(email)).find((m) => m.kind === 'verify' && !m.invalidated);
      assert.ok(mail);
      const [vs, v] = await call('/auth/verify', { token: mail.token });
      assert.equal(vs, 200, JSON.stringify(v));
      return { email, account: v.account as Json, token: v.token as string };
    }

    test('가입: 이메일은 대소문자 무시로 하나, 비밀번호 규칙 위반 항목, 닉네임 중복(공백·대소문자 무시), 토큰은 주지 않는다', async () => {
      const [s, r] = await call('/auth/signup', { email: '  Minji@Example.com ', password: PW, nickname: 'Minji' });
      assert.equal(s, 200);
      assert.equal(r.ok, true);
      assert.equal(r.account.email, 'minji@example.com');
      assert.equal(r.account.verified, false);
      assert.deepEqual(r.account.providers, ['email']);
      assert.equal(r.token, undefined, '인증 전에는 세션을 열지 않는다');

      const [ds, dup] = await call('/auth/signup', { email: 'MINJI@example.com', password: PW, nickname: '다른사람' });
      assert.deepEqual([ds, dup.code], [409, 'duplicateEmail']);
      assert.match(dup.detail, /이미 가입한 이메일/);

      const [ws, weak] = await call('/auth/signup', { email: 'weak@example.com', password: 'abc', nickname: '약한' });
      assert.deepEqual([ws, weak.code, weak.violations], [400, 'weakPassword', ['8자 이상', '숫자 포함']]);

      const [ns, nick] = await call('/auth/signup', { email: 'nick@example.com', password: PW, nickname: ' minji ' });
      assert.deepEqual([ns, nick.code], [409, 'nicknameTaken']);
      const [ls, long] = await call('/auth/signup', { email: 'long@example.com', password: PW, nickname: '가'.repeat(NICKNAME_MAX + 1) });
      assert.deepEqual([ls, long.code], [400, 'badCredentials']);
      const [es, bad] = await call('/auth/signup', { email: 'not-an-email', password: PW, nickname: '형식' });
      assert.deepEqual([es, bad.code], [400, 'badCredentials']);

      const [, taken] = await call(`/auth/nickname?nickname=${encodeURIComponent('MINJI')}`);
      assert.equal(taken.taken, true);
      const [, free] = await call(`/auth/nickname?nickname=${encodeURIComponent('아무도')}`);
      assert.equal(free.taken, false);
    });

    test('인증: 미인증은 로그인 막힘, 재발송하면 이전 토큰은 무효, 최신 토큰으로 인증하면 세션 토큰, 같은 토큰은 한 번만', async () => {
      const email = 'verify@example.com';
      await call('/auth/signup', { email, password: PW, nickname: '인증' });
      const [us, un] = await call('/auth/signin', { email, password: PW });
      assert.deepEqual([us, un.code], [403, 'unverified']);
      const [first] = await mails(email);
      const [rs, re] = await call('/auth/resend', { email });
      assert.deepEqual([rs, re], [200, { ok: true }]);
      const list = await mails(email);
      assert.equal(list.length, 2);
      assert.equal(list.find((m) => m.id === first.id)?.invalidated, true);
      const [os, old] = await call('/auth/verify', { token: first.token });
      assert.deepEqual([os, old.code], [400, 'invalidToken']);
      const latest = list.find((m) => !m.invalidated)!;
      const [vs, v] = await call('/auth/verify', { token: latest.token });
      assert.equal(vs, 200);
      assert.equal(v.account.verified, true);
      assert.match(v.token, /^[\w-]{43}$/, '32바이트 base64url');
      assert.equal(v.expiresAt, now + SESSION_TTL_MS);
      const [again] = await call('/auth/verify', { token: latest.token });
      assert.equal(again, 400);
      // 없는 이메일·인증 마친 계정 재발송도 같은 응답(가입 여부를 드러내지 않는다), 메일은 늘지 않는다
      assert.deepEqual((await call('/auth/resend', { email: 'nobody@example.com' }))[1], { ok: true });
      assert.deepEqual((await call('/auth/resend', { email }))[1], { ok: true });
      assert.equal((await mails(email)).length, 2);
      assert.equal((await mails('nobody@example.com')).length, 0);
    });

    test('로그인·세션: 성공하면 Bearer 토큰, /auth/session은 쓸 때마다 30일 연장, 30일 안 쓰면 만료(401), 로그아웃하면 끝', async () => {
      const { email } = await verified('session');
      const [s, r] = await call('/auth/signin', { email: email.toUpperCase(), password: PW, deviceToken: 'dev-session' });
      assert.equal(s, 200);
      const token = r.token as string;
      for (let i = 0; i < 3; i += 1) {
        now += 29 * DAY;
        const [ss, me] = await call('/auth/session', undefined, token);
        assert.equal(ss, 200, `${i + 1}번째 29일 뒤에도 살아 있다`);
        assert.equal(me.account.email, email);
        assert.equal(me.expiresAt, now + SESSION_TTL_MS);
      }
      now += 30 * DAY + 1;
      const [xs, gone] = await call('/auth/session', undefined, token);
      assert.deepEqual([xs, gone.code], [401, 'invalidToken']);
      assert.equal((await call('/auth/session', undefined, 'not-a-real-token-0000000000'))[0], 401);
      assert.equal((await call('/auth/session'))[0], 401);

      const [, again] = await call('/auth/signin', { email, password: PW });
      assert.deepEqual(await call('/auth/signout', {}, again.token), [200, { ok: true }]);
      assert.equal((await call('/auth/session', undefined, again.token))[0], 401);
    });

    test('시도 제한: 이메일 기준 5회 연속 실패면 10분 잠금(없는 이메일도 같은 응답), 성공하면 0으로', async () => {
      const { email } = await verified('lock');
      for (let i = 1; i < LOGIN_MAX_FAILS; i += 1) {
        const [s, r] = await call('/auth/signin', { email, password: 'wrongpass1' });
        assert.deepEqual([s, r.code], [401, 'badCredentials']);
        assert.match(r.detail, new RegExp(`연속 ${i}회`));
      }
      const [ls, locked] = await call('/auth/signin', { email, password: 'wrongpass1' });
      assert.deepEqual([ls, locked.code, locked.retryAt], [423, 'locked', now + LOGIN_LOCK_MS]);
      const [ws] = await call('/auth/signin', { email, password: PW });
      assert.equal(ws, 423, '잠긴 동안은 맞는 비밀번호도 막는다');
      now += LOGIN_LOCK_MS;
      assert.equal((await call('/auth/signin', { email, password: PW }))[0], 200);

      // 없는 이메일도 같은 문구와 같은 잠금(가입 여부를 드러내지 않는다)
      const ghost = 'ghost@example.com';
      now += ATTEMPT_WINDOW_MS;
      const [gs, g] = await call('/auth/signin', { email: ghost, password: 'wrongpass1' });
      assert.deepEqual([gs, g.code, g.detail], [401, 'badCredentials', '이메일이나 비밀번호가 맞지 않습니다(연속 1회, 5회면 10분 잠금)']);
      for (let i = 2; i < LOGIN_MAX_FAILS; i += 1) await call('/auth/signin', { email: ghost, password: 'wrongpass1' });
      assert.equal((await call('/auth/signin', { email: ghost, password: 'wrongpass1' }))[1].code, 'locked');
    });

    test('시도 제한: 여러 IP에서 동시에 보낸 틀린 비밀번호도 5번까지만 확인하고 잠근다(카운터는 원자적으로 먼저 올린다)', async () => {
      // 같은 저장소를 쓰는 서비스를 직접 불러 IP를 바꾼다(HTTP 테스트는 모두 127.0.0.1)
      const svc = createAuthService({ store: (opened.store as SyncStore).authStore ?? createMemoryAuthStore(), now: () => now, passwordCost: COST });
      const email = `race-${backend.name.length}-${seq}@example.com`;
      const N = 40;
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          svc.handle({ method: 'POST', path: 'signin', url: new URL('http://x/auth/signin'), headers: {}, body: { email, password: `guess${i}abc` }, ip: `10.9.${i}.1` }),
        ),
      );
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 401).length, LOGIN_MAX_FAILS - 1, statuses.join(','));
      assert.equal(statuses.filter((s) => s === 423).length, N - (LOGIN_MAX_FAILS - 1));
      const next = await svc.handle({ method: 'POST', path: 'signin', url: new URL('http://x/auth/signin'), headers: {}, body: { email, password: 'guessXabc1' }, ip: '10.8.0.1' });
      assert.equal(next.status, 423, '잠긴 뒤에는 다른 IP도 막힌다');
      now += LOGIN_LOCK_MS;
      const after = await svc.handle({ method: 'POST', path: 'signin', url: new URL('http://x/auth/signin'), headers: {}, body: { email, password: 'guessYabc1' }, ip: '10.8.0.2' });
      assert.equal(after.status, 401, '10분 뒤엔 1회부터 다시 센다');
      assert.match(String((after.body as Json).detail), /연속 1회/);
    });

    test('시도 제한: 이메일+IP 10분 10회, IP 10분 20회를 넘으면 429 deviceLimited(창이 지나면 풀린다)', async () => {
      const { email } = await verified('rate');
      // 같은 이메일: 잠금(5회)에 먼저 걸리지 않게 성공·실패를 섞는다
      for (let i = 0; i < EMAIL_IP_ATTEMPT_LIMIT; i += 1) {
        const [s] = await call('/auth/signin', { email, password: i % 2 ? PW : 'wrongpass1' });
        assert.notEqual(s, 429, `${i + 1}번째`);
      }
      const [ps, pair] = await call('/auth/signin', { email, password: PW });
      assert.deepEqual([ps, pair.code], [429, 'deviceLimited']);
      assert.equal(typeof pair.retryAt, 'number');
      now += ATTEMPT_WINDOW_MS;
      for (let i = 0; i < IP_ATTEMPT_LIMIT; i += 1) {
        assert.notEqual((await call('/auth/signin', { email: `ip${i}@example.com`, password: 'wrongpass1' }))[0], 429, `${i + 1}번째`);
      }
      assert.equal((await call('/auth/signin', { email, password: PW }))[1].code, 'deviceLimited');
      now += ATTEMPT_WINDOW_MS;
      assert.equal((await call('/auth/signin', { email, password: PW }))[0], 200);
    });

    test('비밀번호 재설정: 없는 이메일도 같은 응답, 재설정하면 다른 세션은 끊기고 새 비밀번호만 통한다, 토큰은 한 번만', async () => {
      const { email, token: oldSession } = await verified('reset');
      assert.deepEqual(await call('/auth/password/reset', { email: 'nobody2@example.com' }), [200, { ok: true }]);
      assert.equal((await mails('nobody2@example.com')).length, 0);
      assert.deepEqual(await call('/auth/password/reset', { email }), [200, { ok: true }]);
      const mail = (await mails(email)).find((m) => m.kind === 'reset')!;
      assert.equal(mail.subject, 'Young Trip 비밀번호 재설정');
      const [vs] = await call('/auth/verify', { token: mail.token });
      assert.equal(vs, 400, '재설정 토큰으로 이메일 인증은 안 된다');
      const [ws, weak] = await call('/auth/password/confirm', { token: mail.token, password: 'short' });
      assert.deepEqual([ws, weak.code], [400, 'weakPassword']);
      const NEW = 'newpass2026';
      assert.deepEqual(await call('/auth/password/confirm', { token: mail.token, password: NEW }), [200, { ok: true }]);
      assert.equal((await call('/auth/password/confirm', { token: mail.token, password: NEW }))[1].code, 'invalidToken');
      assert.equal((await call('/auth/session', undefined, oldSession))[0], 401, '다른 기기 세션은 끊긴다');
      assert.equal((await call('/auth/signin', { email, password: PW }))[0], 401);
      assert.equal((await call('/auth/signin', { email, password: NEW }))[0], 200);
      // 30분이 지난 재설정 토큰은 못 쓴다
      await call('/auth/password/reset', { email });
      const late = (await mails(email)).filter((m) => m.kind === 'reset' && !m.invalidated).sort((a, b) => b.sentAt - a.sentAt)[0];
      now += 31 * MIN;
      assert.equal((await call('/auth/password/confirm', { token: late.token, password: 'later2026x' }))[1].code, 'invalidToken');
    });

    test('프로필: Bearer로 저장, 닉네임 중복 거부, 모르는 열은 버린다, 토큰 없으면 401', async () => {
      const a = await verified('prof');
      const b = await verified('other');
      const [s, r] = await call('/auth/profile', { profile: { tags: ['미식', '사진'], imageUri: 'file:///me.jpg', admin: true } }, a.token);
      assert.equal(s, 200);
      assert.deepEqual(r.account.profile.tags, ['미식', '사진']);
      assert.equal(r.account.profile.imageUri, 'file:///me.jpg');
      assert.equal(r.account.profile.admin, undefined);
      const [ns, nick] = await call('/auth/profile', { profile: { nickname: b.account.nickname.toUpperCase() } }, a.token);
      assert.deepEqual([ns, nick.code], [409, 'nicknameTaken']);
      const [, renamed] = await call('/auth/profile', { profile: { nickname: '새이름' } }, a.token);
      assert.equal(renamed.account.nickname, '새이름');
      const [, mine] = await call(`/auth/nickname?nickname=${encodeURIComponent('새이름')}`, undefined, a.token);
      assert.equal(mine.taken, false, 'Bearer면 자기 닉네임은 뺀다');
      assert.equal((await call('/auth/profile', { profile: { tags: [] } }))[0], 401);
    });

    test('탈퇴: 행은 남기고 익명화(이메일·닉네임·비밀번호·프로필 비움), 세션 끊김, 같은 이메일·닉네임으로 다시 가입할 수 있다', async () => {
      const { email, account, token } = await verified('bye');
      assert.deepEqual(await call('/auth/delete', {}, token), [200, { ok: true }]);
      assert.equal((await call('/auth/session', undefined, token))[0], 401);
      assert.equal((await call('/auth/signin', { email, password: PW }))[1].code, 'badCredentials');
      assert.equal((await call('/auth/delete', {}, token))[0], 401);
      if (opened.db) {
        const { rows } = await opened.db.query(
          'SELECT user_id, email, nickname, password_hash, profile, deleted_at FROM auth_accounts WHERE account_id = $1',
          [account.accountId],
        );
        assert.equal(rows.length, 1, '행은 남는다(소프트 삭제)');
        assert.equal(rows[0].user_id, account.userId);
        assert.deepEqual([rows[0].email, rows[0].nickname, rows[0].password_hash], [null, null, null]);
        assert.deepEqual(rows[0].profile, {});
        assert.ok(rows[0].deleted_at);
        const left = await opened.db.query('SELECT count(*)::int AS c FROM auth_sessions WHERE account_id = $1', [account.accountId]);
        assert.equal(left.rows[0].c, 0);
      }
      const [s] = await call('/auth/signup', { email, password: PW, nickname: account.nickname });
      assert.equal(s, 200, '이메일·닉네임이 풀린다');
    });

    test('게스트 승격: 준 userId를 그대로 쓴다, 인증 전 다시 가입하면 같은 기기만 대체, 인증한 뒤 같은 userId는 거부', async () => {
      const userId = `u-guest-${backend.name.length}-${seq}`;
      const dev = `guest-device-${backend.name}-000`;
      const [s1, r1] = await call('/auth/signup', { email: 'typo@exmaple.com', password: PW, nickname: '게스트', userId, deviceToken: dev });
      assert.equal(s1, 200);
      assert.equal(r1.account.userId, userId);
      assert.equal(r1.account.upgradeProof, undefined, '확인값은 응답에 싣지 않는다');
      const [first] = await mails('typo@exmaple.com');
      const [s2, r2] = await call('/auth/signup', { email: 'guest@example.com', password: PW, nickname: '게스트', userId, deviceToken: dev });
      assert.equal(s2, 200, JSON.stringify(r2));
      assert.equal(r2.account.userId, userId);
      assert.notEqual(r2.account.accountId, r1.account.accountId);
      assert.equal((await call('/auth/verify', { token: first.token }))[0], 400, '대체된 가입의 인증 메일은 못 쓴다');
      assert.equal((await call('/auth/signin', { email: 'typo@exmaple.com', password: PW }))[1].code, 'badCredentials');
      const mail = (await mails('guest@example.com')).find((m) => !m.invalidated)!;
      const [, v] = await call('/auth/verify', { token: mail.token });
      assert.equal(v.account.userId, userId);
      const [s3, r3] = await call('/auth/signup', { email: 'third@example.com', password: PW, nickname: '세번째', userId, deviceToken: dev });
      assert.deepEqual([s3, r3.code], [409, 'duplicateEmail']);
    });

    test('게스트 승격 가로채기 막기: 다른 기기는 남의 인증 전 가입을 지우지 못하고, 기기 토큰 없이 userId만 보내면 400', async () => {
      const userId = `u-victim-${backend.name.length}-${seq}`;
      const victimDev = `victim-device-${backend.name}`;
      const [vs] = await call('/auth/signup', { email: 'victim@example.com', password: PW, nickname: '피해자', userId, deviceToken: victimDev });
      assert.equal(vs, 200);
      const [as, a] = await call('/auth/signup', { email: 'attacker@example.com', password: PW, nickname: '공격자', userId, deviceToken: 'attacker-device-1' });
      assert.deepEqual([as, a.code], [409, 'duplicateEmail']);
      const [ns, n] = await call('/auth/signup', { email: 'attacker2@example.com', password: PW, nickname: '공격자2', userId });
      assert.deepEqual([ns, n.code], [400, 'badCredentials']);
      assert.equal((await mails('attacker@example.com')).length, 0);
      const mail = (await mails('victim@example.com')).find((m) => !m.invalidated)!;
      const [ok, v] = await call('/auth/verify', { token: mail.token });
      assert.equal(ok, 200, '피해자의 인증 링크는 그대로 쓴다');
      assert.equal(v.account.userId, userId);
      // 인증 기한(1일)이 지난 가입은 다른 기기가 대체할 수 있다(버려진 가입이 게스트를 영영 막지 않게)
      const stale = `u-stale-${backend.name.length}-${seq}`;
      await call('/auth/signup', { email: 'stale1@example.com', password: PW, nickname: '버림', userId: stale, deviceToken: 'stale-device-1' });
      now += DAY + 1;
      const [ss] = await call('/auth/signup', { email: 'stale2@example.com', password: PW, nickname: '새로', userId: stale, deviceToken: 'stale-device-2' });
      assert.equal(ss, 200);
    });

    test('모의 소셜: fail은 providerFailed, ok는 기기마다 계정 하나(다시 오면 같은 계정), 닉네임이 겹치면 숫자', async () => {
      const [fs, f] = await call('/auth/social', { provider: 'kakao', scenario: 'fail', deviceToken: 'dev-a' });
      assert.deepEqual([fs, f.code], [502, 'providerFailed']);
      const [s1, a1] = await call('/auth/social', { provider: 'kakao', scenario: 'ok', deviceToken: `dev-a-${backend.name}` });
      assert.equal(s1, 200);
      assert.deepEqual(a1.account.providers, ['kakao']);
      assert.equal(a1.account.verified, true);
      assert.ok(a1.token);
      const [, a2] = await call('/auth/social', { provider: 'kakao', scenario: 'ok', deviceToken: `dev-a-${backend.name}` });
      assert.equal(a2.account.accountId, a1.account.accountId);
      const [, b1] = await call('/auth/social', { provider: 'kakao', scenario: 'ok', deviceToken: `dev-b-${backend.name}` });
      assert.notEqual(b1.account.accountId, a1.account.accountId);
      assert.match(b1.account.nickname, /^카카오여행자\d+$/);
      // 소셜 전용 계정은 비밀번호 로그인이 안 된다(같은 문구)
      assert.equal((await call('/auth/signin', { email: a1.account.email, password: PW }))[1].code, 'badCredentials');
    });

    test('모의 소셜 같은 이메일: 응답은 늘 같은 linkRequired(토큰 없음), 확인 토큰은 그 이메일의 연결 확인 메일로만, 거절·수락·만료', async () => {
      const { email, account } = await verified('same');
      const dev = `dev-same-${backend.name}`;
      const [ls, link] = await call('/auth/social', { provider: 'google', scenario: 'sameEmail', deviceToken: dev, providerEmail: email.toUpperCase() });
      assert.deepEqual([ls, link.code], [409, 'linkRequired']);
      assert.equal(link.linkToken, undefined, '응답에는 연결 토큰이 없다(이메일만 알아서는 연결할 수 없다)');
      const linkMail = () => mails(email).then((l) => l.filter((m) => m.kind === 'link').sort((a, b) => b.sentAt - a.sentAt)[0]);
      const m1 = await linkMail();
      assert.ok(m1);
      assert.equal(m1.subject, 'Young Trip 소셜 로그인 연결 확인');
      const [ns, no] = await call('/auth/social/confirm', { linkToken: m1.token, accept: false });
      assert.deepEqual([ns, no.code], [409, 'linkRequired']);
      assert.equal((await call('/auth/social/confirm', { linkToken: m1.token, accept: true }))[1].code, 'invalidToken', '한 번 쓴 토큰');
      now += 1;
      await call('/auth/social', { provider: 'google', scenario: 'sameEmail', deviceToken: dev, providerEmail: email });
      const m2 = await linkMail();
      const [ys, yes] = await call('/auth/social/confirm', { linkToken: m2.token, accept: true });
      assert.equal(ys, 200);
      assert.equal(yes.account.accountId, account.accountId);
      assert.deepEqual(yes.account.providers, ['email', 'google']);
      assert.ok(yes.token);
      // 이제 같은 기기 구글 정상 로그인은 이 계정이다
      const [, again] = await call('/auth/social', { provider: 'google', scenario: 'ok', deviceToken: dev });
      assert.equal(again.account.accountId, account.accountId);
      // 미인증·없는 이메일·다른 기기도 같은 상태 코드와 같은 모양의 문구(가입 여부를 드러내지 않는다), 메일은 가지 않는다
      await call('/auth/signup', { email: 'pending@example.com', password: PW, nickname: '대기' });
      const [us, un] = await call('/auth/social', { provider: 'google', scenario: 'sameEmail', deviceToken: 'dev-x', providerEmail: 'pending@example.com' });
      const [xs, none] = await call('/auth/social', { provider: 'google', scenario: 'sameEmail', deviceToken: 'dev-x', providerEmail: 'none@example.com' });
      assert.deepEqual([us, un.code, xs, none.code], [409, 'linkRequired', 409, 'linkRequired']);
      assert.equal(un.detail.replace('pending@example.com', 'E'), none.detail.replace('none@example.com', 'E'));
      assert.equal(un.detail.replace('pending@example.com', 'E'), link.detail.replace(email, 'E'));
      assert.equal((await mails('pending@example.com')).filter((m) => m.kind === 'link').length, 0);
      assert.equal((await mails('none@example.com')).length, 0);
      // 10분이 지난 확인 토큰
      now += 1;
      await call('/auth/social', { provider: 'kakao', scenario: 'sameEmail', deviceToken: dev, providerEmail: email });
      const m3 = await linkMail();
      now += 11 * MIN;
      assert.equal((await call('/auth/social/confirm', { linkToken: m3.token, accept: true }))[1].code, 'invalidToken');
    });

    test('모의 소셜 가로채기 막기: 남의 이메일로 같은 이메일 연결을 시작해도 세션을 얻지 못한다', async () => {
      const victim = await verified('victim');
      const [s, r] = await call('/auth/social', { provider: 'kakao', scenario: 'sameEmail', deviceToken: 'attacker-dev', providerEmail: victim.email });
      assert.equal(s, 409);
      assert.equal(r.token, undefined);
      assert.equal(r.linkToken, undefined);
      assert.equal((await call('/auth/social/confirm', { linkToken: 'guess-guess-guess-guess-guess', accept: true }))[1].code, 'invalidToken');
      assert.equal((await call('/auth/social/confirm', { accept: true }))[1].code, 'invalidToken');
      const [, me] = await call('/auth/session', undefined, victim.token);
      assert.deepEqual(me.account.providers, ['email'], '피해자 계정에 아무것도 붙지 않았다');
    });

    test('모의 소셜 연결(17): Bearer 계정에만 붙인다, 다른 계정에 묶인 신원은 거부, 토큰 없으면 401', async () => {
      const a = await verified('linka');
      const b = await verified('linkb');
      const dev = `dev-link-${backend.name}`;
      const [s, r] = await call('/auth/social', { provider: 'kakao', scenario: 'ok', deviceToken: dev, link: true }, a.token);
      assert.equal(s, 200);
      assert.equal(r.account.accountId, a.account.accountId);
      assert.deepEqual(r.account.providers, ['email', 'kakao']);
      const [bs, bound] = await call('/auth/social', { provider: 'kakao', scenario: 'ok', deviceToken: dev, link: true }, b.token);
      assert.deepEqual([bs, bound.code], [409, 'duplicateEmail']);
      assert.match(bound.detail, /이미 다른 Young Trip 계정/);
      assert.equal((await call('/auth/social', { provider: 'kakao', scenario: 'ok', deviceToken: dev, link: true }))[0], 401);
    });

    test('저장 값에 비밀번호·세션 토큰 원문이 없고, 로그에도 남지 않는다', async () => {
      const { email, token } = await verified('secret');
      if (opened.db) {
        const acc = await opened.db.query('SELECT password_hash FROM auth_accounts WHERE lower(email) = $1', [email]);
        assert.match(acc.rows[0].password_hash, /^scrypt\$/);
        assert.ok(!acc.rows[0].password_hash.includes(PW));
        const ses = await opened.db.query('SELECT token_hash FROM auth_sessions WHERE token_hash = $1', [tokenHash(token)]);
        assert.equal(ses.rows.length, 1);
        assert.equal((await opened.db.query('SELECT 1 FROM auth_sessions WHERE token_hash = $1', [token])).rows.length, 0);
      }
      assert.ok(logs.every((l) => !l.includes(PW) && !l.includes(token)), logs.join('\n'));
    });

    test('잘못된 요청: JSON이 아니면 400, 모르는 경로 404, CORS 사전 요청은 Authorization 헤더를 허용한다', async () => {
      const res = await fetch(`${server.url}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
      assert.equal(res.status, 400);
      assert.equal((await call('/auth/nothing'))[0], 404);
      const pre = await fetch(`${server.url}/auth/session`, { method: 'OPTIONS' });
      assert.equal(pre.status, 204);
      assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    });

    test('앱 HTTP 제공자가 이 서버와 맞물린다: 가입 → 모의 메일함 인증 → 세션 확인 → 프로필 → 로그아웃 → 만료', async () => {
      const appFetch: FetchLike = async (url, init) => {
        const r = await fetch(url, init);
        return { ok: r.ok, status: r.status, text: () => r.text() };
      };
      const kv = memoryKV();
      const auth = createHttpAuth({ url: server.url, fetch: appFetch, kv });
      const email = `app-${backend.name.length}@example.com`;
      const up = await auth.signUp({ email, password: PW, nickname: `앱${backend.name.length}`, userId: `u-app-${backend.name.length}`, deviceToken: 'dev-app-guest' });
      assert.equal(up.ok, true);
      const mail = (await auth.outbox()).find((m) => m.to === email && !m.invalidated && m.kind === 'verify')!;
      const v: AuthResult = await auth.verifyEmail(mail.token);
      assert.ok(v.ok);
      if (!v.ok) return;
      assert.equal(v.account.userId, `u-app-${backend.name.length}`);
      assert.equal(await auth.checkSession!(v.account.accountId), 'ok');
      const p = await auth.updateProfile(v.account.accountId, { tags: ['바다'] });
      assert.ok(p.ok && p.account.profile.tags.includes('바다'));
      const g = await auth.getAccount(v.account.accountId);
      assert.ok(g.ok && g.account.email === email);
      // 같은 이메일 소셜: 서버는 토큰을 메일로만 주고, 앱은 개발용 메일함에서 그 메일을 열어 26 확인으로 넘긴다
      const sm = await auth.social({ provider: 'kakao', scenario: 'sameEmail', deviceToken: 'dev-app-social', providerEmail: email });
      assert.ok(!sm.ok && sm.code === 'linkRequired' && sm.linkToken, JSON.stringify(sm));
      if (!sm.ok && sm.linkToken) {
        const linked = await auth.confirmLink({ linkToken: sm.linkToken, accept: true });
        assert.ok(linked.ok && linked.account.accountId === v.account.accountId && linked.account.providers.includes('kakao'));
      }
      assert.ok((await auth.outbox()).some((m) => m.kind === 'link'), '연결 확인 메일은 kind link');
      await auth.signOut!(v.account.accountId);
      assert.equal(await auth.checkSession!(v.account.accountId), 'expired');
      const s = await auth.signIn({ email, password: PW, deviceToken: 'dev-app' });
      assert.ok(s.ok);
      if (!s.ok) return;
      now += SESSION_TTL_MS + 1;
      assert.equal(await auth.checkSession!(s.account.accountId), 'expired');
      const d = await auth.deleteAccount(s.account.accountId);
      assert.deepEqual(d, { ok: false, code: 'invalidToken' }, '만료 뒤에는 다시 로그인해야 탈퇴할 수 있다');
    });

    test('보관 정리(purge): 만료한 세션과 쓴 토큰을 지운다', async () => {
      await verified('purge');
      now += SESSION_TTL_MS + DAY;
      const svcStore: AuthStore = (opened.store as SyncStore).authStore ?? createMemoryAuthStore();
      await svcStore.purge(now);
      if (opened.db) {
        assert.equal((await opened.db.query('SELECT count(*)::int AS c FROM auth_sessions WHERE expires_at <= $1', [new Date(now).toISOString()])).rows[0].c, 0);
        assert.equal((await opened.db.query('SELECT count(*)::int AS c FROM auth_tokens WHERE used_at IS NOT NULL')).rows[0].c, 0);
      }
    });
  });
}

describe('계정 서버 설정', () => {
  test('devOutbox가 아니면 GET /auth/outbox는 404(PostgreSQL 기본: 시연 리셋을 막으면 보낸편지함도 닫힌다)', async () => {
    const pg = new PGlite();
    await pg.waitReady;
    const db = sqlDb(pg);
    await migrate(db);
    const store = createPostgresStore(db, { warn: () => {} });
    const server = await startSyncServer({ store, purgeEveryMs: 0, proxy: false, auth: { passwordCost: COST } });
    try {
      assert.equal((await fetch(`${server.url}/auth/outbox`)).status, 404);
      const social = await fetch(`${server.url}/auth/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'kakao', scenario: 'sameEmail', deviceToken: 'dev-pg', providerEmail: 'closed@example.com' }),
      });
      assert.equal(social.status, 404, '모의 소셜도 닫힌다');
      const res = await fetch(`${server.url}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'closed@example.com', password: PW, nickname: '닫힘' }),
      });
      assert.equal(res.status, 200, '가입은 되고 메일만 보이지 않는다');
    } finally {
      await server.close();
      await pg.close();
    }
  });

  test('auth: false면 /auth 경로도 404, 메모리 저장소여도 기본은 보낸편지함·모의 소셜이 닫힌다(devOutbox면 열린다)', async () => {
    const off = await startSyncServer({ purgeEveryMs: 0, proxy: false, auth: false });
    const closed = await startSyncServer({ purgeEveryMs: 0, proxy: false, auth: { passwordCost: COST } });
    const dev = await startSyncServer({ purgeEveryMs: 0, proxy: false, auth: { passwordCost: COST, devOutbox: true } });
    const post = (url: string, body: unknown) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      assert.equal((await fetch(`${off.url}/auth/session`)).status, 404);
      assert.equal((await fetch(`${closed.url}/auth/outbox`)).status, 404);
      assert.equal((await post(`${closed.url}/auth/social`, { provider: 'kakao', scenario: 'ok', deviceToken: 'dev-closed' })).status, 404);
      assert.equal((await post(`${closed.url}/auth/social/confirm`, { linkToken: 'x', accept: true })).status, 404);
      assert.equal((await post(`${closed.url}/auth/signup`, { email: 'm@example.com', password: PW, nickname: '메모리' })).status, 200);
      assert.equal((await fetch(`${dev.url}/auth/outbox`)).status, 200);
      assert.equal((await post(`${dev.url}/auth/social`, { provider: 'kakao', scenario: 'ok', deviceToken: 'dev-open' })).status, 200);
    } finally {
      await off.close();
      await closed.close();
      await dev.close();
    }
  });

  test('서비스 직접 호출: 요청 처리 중 저장소가 던지면 500이고 로그에는 경로와 오류 이름만 남는다', async () => {
    const logs: string[] = [];
    const store = createMemoryAuthStore();
    const broken: AuthStore = { ...store, accountByEmail: () => Promise.reject(new Error('db down')) };
    const svc = createAuthService({ store: broken, passwordCost: COST, log: (m) => logs.push(m) });
    const r = await svc.handle({
      method: 'POST',
      path: 'signin',
      url: new URL('http://x/auth/signin'),
      headers: {},
      body: { email: 'a@example.com', password: PW },
      ip: '10.0.0.1',
    });
    assert.equal(r.status, 500);
    assert.deepEqual(logs, ['인증 처리 실패(POST /auth/signin): db down']);
  });
});
