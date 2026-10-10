import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { createHttpAuth } from '../src/services/auth/http';
import { OAUTH_STATE_TTL_MS, tokenHash, type OutboxMail } from '../server/auth.mjs';
import {
  createOAuthClient,
  DEFAULT_REDIRECT_URIS,
  GOOGLE_TOKEN_URL,
  GOOGLE_TOKENINFO_URL,
  KAKAO_ME_URL,
  KAKAO_TOKEN_URL,
  normalizeRedirectUri,
  oauthOptionsFromEnv,
  type OAuthFetch,
} from '../server/oauth.mjs';
import { createSyncStore, startSyncServer, type SyncStore } from '../server/sync-server.mjs';
import { migrate } from '../server/db/migrate.mjs';
import { createPostgresStore, sqlDb, type SqlDb } from '../server/db/postgres-store.mjs';
import { memoryKV } from './helpers/fakes';

/**
 * WP2 실제 소셜 로그인(구글·카카오 OAuth, server/oauth.mjs + server/auth.mjs /auth/oauth/…, 2026-10-10)과 아이디(닉네임) 로그인.
 * 제공자(구글 토큰·tokeninfo, 카카오 토큰·user/me)는 주입한 가짜 fetch다. 같은 시나리오를 메모리·PGlite·실제 PostgreSQL
 * (YT_TEST_DATABASE_URL이 있을 때, 임시 스키마)로 돈다.
 * 본다: 새 계정 / 기존 신원 / 같은 인증 이메일은 연결 확인 메일로만 / state(한 번·제공자·돌아올 주소) / 돌아올 주소 허용 목록 /
 * 코드 교환 실패 / 키 없음 503 / 닉네임 중복 / 로그에 코드·secret 없음 / 앱 HTTP 제공자와 맞물림.
 */

const T0 = Date.UTC(2026, 9, 10, 2, 0, 0);
const MIN = 60 * 1000;
const PW = 'trip2026ok';
const COST = 1024;
const REDIRECT = 'http://localhost:8090';
const OTHER_REDIRECT = 'http://localhost:19006';
const GID = '1234-web.apps.googleusercontent.com';
const GSECRET = 'g-secret-value-xyz';
const NATIVE_GID = '1234-ios.apps.googleusercontent.com';
const KID = 'kakaorestkey0123456789abcdef0123';
const KSECRET = 'k-secret-value-xyz';
const VERIFIER = 'v'.repeat(43);

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

async function openRealPostgres(): Promise<Opened> {
  const { default: pg } = await import('pg');
  const schema = `yt_oauth_${process.pid}_${Date.now().toString(36)}`;
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

/** 가짜 제공자 신원 */
interface Ident {
  sub: string;
  email?: string;
  verified?: boolean;
  name?: string;
  /** tokeninfo가 돌려줄 aud(기본 GID) */
  aud?: string;
}

interface ProviderCall {
  url: string;
  method: string;
  form?: URLSearchParams;
  auth?: string;
}

/** 구글·카카오 흉내. codes에 넣은 인가 코드만 받는다 */
function fakeProviders(clock: () => number) {
  const google = new Map<string, Ident>();
  const kakao = new Map<string, Ident>();
  const calls: ProviderCall[] = [];
  let down = false;
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  const fetch: OAuthFetch = async (url, init) => {
    const form = init.body ? new URLSearchParams(init.body) : undefined;
    calls.push({ url, method: init.method, form, auth: init.headers.Authorization });
    if (down) return reply(500, { error: 'server_error' });
    if (url === GOOGLE_TOKEN_URL) {
      const id = google.get(form?.get('code') ?? '');
      if (!id) return reply(400, { error: 'invalid_grant' });
      return reply(200, { access_token: 'g-access', id_token: `idt.${form?.get('code')}`, token_type: 'Bearer' });
    }
    if (url.startsWith(`${GOOGLE_TOKENINFO_URL}?`)) {
      const t = new URL(url).searchParams.get('id_token') ?? '';
      const id = google.get(t.slice(4));
      if (!id) return reply(400, { error: 'invalid_token' });
      return reply(200, {
        aud: id.aud ?? GID,
        iss: 'https://accounts.google.com',
        exp: String(Math.floor(clock() / 1000) + 3600),
        sub: id.sub,
        ...(id.email ? { email: id.email, email_verified: id.verified ? 'true' : 'false' } : {}),
        ...(id.name ? { name: id.name } : {}),
      });
    }
    if (url === KAKAO_TOKEN_URL) {
      const code = form?.get('code') ?? '';
      if (!kakao.has(code)) return reply(400, { error: 'invalid_grant', error_code: 'KOE320' });
      return reply(200, { access_token: `kat-${code}`, token_type: 'bearer' });
    }
    if (url === KAKAO_ME_URL) {
      const code = (init.headers.Authorization ?? '').replace(/^Bearer kat-/, '');
      const id = kakao.get(code);
      if (!id) return reply(401, { code: -401 });
      return reply(200, {
        id: Number(id.sub),
        properties: { nickname: id.name },
        kakao_account: {
          profile: { nickname: id.name },
          ...(id.email ? { email: id.email, is_email_valid: true, is_email_verified: id.verified === true } : {}),
        },
      });
    }
    return reply(404, {});
  };
  return {
    fetch,
    google,
    kakao,
    calls,
    setDown(v: boolean) {
      down = v;
    },
  };
}

test('서버 변수 → OAuth 설정: 값 다듬기, 돌아올 주소 기본값, 네이티브 구글 ID 목록', () => {
  const o = oauthOptionsFromEnv({
    GOOGLE_OAUTH_CLIENT_ID: ` ${GID} `,
    GOOGLE_OAUTH_CLIENT_SECRET: ` ${GSECRET} `,
    GOOGLE_OAUTH_NATIVE_CLIENT_IDS: `${NATIVE_GID}, bad id ,`,
    KAKAO_OAUTH_CLIENT_ID: KID,
    OAUTH_REDIRECT_URIS: `${REDIRECT}/, https://app.example.com/auth , not a url`,
  });
  assert.equal(o.google.clientId, GID);
  assert.equal(o.google.clientSecret, GSECRET);
  assert.deepEqual(o.google.nativeClientIds, [NATIVE_GID]);
  assert.equal(o.kakao.clientId, KID);
  assert.equal(o.kakao.clientSecret, '');
  assert.deepEqual(o.redirectUris, [`${REDIRECT}/`, 'https://app.example.com/auth']);
  assert.deepEqual(oauthOptionsFromEnv({}).redirectUris, DEFAULT_REDIRECT_URIS);
  assert.equal(oauthOptionsFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'has space' }).google.clientId, '');
  assert.equal(normalizeRedirectUri(' http://localhost:8090/ '), 'http://localhost:8090');
});

test('OAuth 확인기: 구글은 secret까지 있어야 켜짐, 돌아올 주소는 끝 / 무시 정확 일치, 네이티브 ID는 secret 없이 교환', async () => {
  const p = fakeProviders(() => T0);
  const c = createOAuthClient({ google: { clientId: GID, nativeClientIds: [NATIVE_GID] }, kakao: { clientId: KID }, fetch: p.fetch, now: () => T0 });
  assert.equal(c.configured('google'), false, 'secret 없음');
  assert.equal(c.configured('kakao'), true);
  const full = createOAuthClient({
    google: { clientId: GID, clientSecret: GSECRET, nativeClientIds: [NATIVE_GID] },
    fetch: p.fetch,
    now: () => T0,
    redirectUris: [REDIRECT],
  });
  assert.equal(full.redirectAllowed(`${REDIRECT}/`), true);
  assert.equal(full.redirectAllowed(`${REDIRECT}/evil`), false);
  assert.equal(full.redirectAllowed('http://localhost:8091'), false);
  assert.equal(full.redirectAllowed(''), false);

  p.google.set('native-code', { sub: 'g-native', aud: NATIVE_GID });
  const id = await full.exchange('google', { code: 'native-code', redirectUri: 'youngtrip://', clientId: NATIVE_GID, codeVerifier: VERIFIER });
  assert.equal(id.subject, 'g-native');
  const form = p.calls[0].form!;
  assert.equal(form.get('client_id'), NATIVE_GID);
  assert.equal(form.get('client_secret'), null, '설치형 앱 클라이언트에는 secret을 보내지 않는다');
  // 모르는 클라이언트 ID를 보내면 웹 클라이언트로 교환한다
  p.google.set('web-code', { sub: 'g-web' });
  await full.exchange('google', { code: 'web-code', redirectUri: REDIRECT, clientId: 'attacker.apps.googleusercontent.com' });
  assert.equal(p.calls[2].form!.get('client_id'), GID);
  assert.equal(p.calls[2].form!.get('client_secret'), GSECRET);
  // aud가 우리 ID가 아니면 거부
  p.google.set('aud-code', { sub: 'g-aud', aud: 'other.apps.googleusercontent.com' });
  await assert.rejects(full.exchange('google', { code: 'aud-code', redirectUri: REDIRECT }), /identity/);
});

for (const backend of BACKENDS) {
  describe(`실제 소셜 로그인·아이디 로그인(${backend.name})`, { skip: backend.skip }, () => {
    let opened: Opened;
    let server: { url: string; close: () => Promise<void> };
    let bare: { url: string; close: () => Promise<void> };
    let now = T0;
    const logs: string[] = [];
    const p = fakeProviders(() => now);

    before(async () => {
      opened = await backend.open();
      server = await startSyncServer({
        store: opened.store,
        now: () => now,
        purgeEveryMs: 0,
        proxy: false,
        log: (m) => logs.push(m),
        auth: {
          devOutbox: true,
          passwordCost: COST,
          oauth: {
            fetch: p.fetch,
            google: { clientId: GID, clientSecret: GSECRET },
            kakao: { clientId: KID, clientSecret: KSECRET },
            redirectUris: [REDIRECT, OTHER_REDIRECT],
          },
        },
      });
      // 키가 없는 서버(모의 소셜·보낸편지함도 닫힘). 같은 저장소를 써도 상관없다
      bare = await startSyncServer({
        store: createSyncStore(),
        now: () => now,
        purgeEveryMs: 0,
        proxy: false,
        auth: { passwordCost: COST, oauth: { fetch: p.fetch } },
      });
    });
    after(async () => {
      await server?.close();
      await bare?.close();
      await opened?.close();
    });
    beforeEach(() => {
      now += 11 * MIN;
    });

    async function post(base: string, path: string, body?: unknown, token?: string): Promise<[number, Json]> {
      const res = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return [res.status, (await res.json()) as Json];
    }
    const call = (path: string, body?: unknown, token?: string) => post(server.url, path, body, token);

    async function mails(to?: string): Promise<OutboxMail[]> {
      const [, body] = await call('/auth/outbox');
      return (body.mails as OutboxMail[]).filter((m) => to == null || m.to === to);
    }

    async function state(provider: 'google' | 'kakao', redirectUri = REDIRECT): Promise<string> {
      const [s, r] = await call('/auth/oauth/state', { provider, redirectUri });
      assert.equal(s, 200, JSON.stringify(r));
      return r.state as string;
    }

    let seq = 0;
    /** 소셜 로그인 한 번(state부터) */
    async function login(provider: 'google' | 'kakao', ident: Ident, extra: Json = {}): Promise<[number, Json]> {
      seq += 1;
      const code = `code-${provider}-${seq}`;
      (provider === 'google' ? p.google : p.kakao).set(code, ident);
      const st = await state(provider);
      return call(`/auth/oauth/${provider}`, { code, codeVerifier: VERIFIER, redirectUri: REDIRECT, state: st, deviceToken: `dev-${seq}`, ...extra });
    }

    async function emailAccount(email: string, nickname: string) {
      const [s, r] = await call('/auth/signup', { email, password: PW, nickname });
      assert.equal(s, 200, JSON.stringify(r));
      const mail = (await mails(email)).find((m) => m.kind === 'verify' && !m.invalidated)!;
      const [vs, v] = await call('/auth/verify', { token: mail.token });
      assert.equal(vs, 200);
      return v.account as Json;
    }

    test('키가 없으면 state·로그인 모두 503(unconfigured), 연결 확인(/auth/oauth/confirm)은 모의 소셜이 닫혀도 열려 있다', async () => {
      for (const provider of ['google', 'kakao']) {
        const [s, r] = await post(bare.url, '/auth/oauth/state', { provider, redirectUri: REDIRECT });
        assert.deepEqual([s, r.code, r.unconfigured], [503, 'providerFailed', true], provider);
        assert.match(r.detail, /로그인 키가 설정되지 않았습니다/);
        const [ls] = await post(bare.url, `/auth/oauth/${provider}`, { code: 'x', redirectUri: REDIRECT, state: 'x' });
        assert.equal(ls, 503);
      }
      assert.equal((await post(bare.url, '/auth/social', { provider: 'kakao', scenario: 'ok', deviceToken: 'd' }))[0], 404);
      const [cs, c] = await post(bare.url, '/auth/oauth/confirm', { linkToken: 'guess-guess-guess-guess', accept: true });
      assert.deepEqual([cs, c.code], [400, 'invalidToken']);
    });

    test('state: 모르는 제공자·허용 밖 돌아올 주소는 거부, 발급한 값은 해시만 저장하고 10분 뒤 만료', async () => {
      assert.equal((await call('/auth/oauth/state', { provider: 'naver', redirectUri: REDIRECT }))[0], 400);
      const [bs, bad] = await call('/auth/oauth/state', { provider: 'google', redirectUri: 'https://evil.example' });
      assert.deepEqual([bs, bad.code], [400, 'providerFailed']);
      assert.match(bad.detail, /허용하지 않은 돌아올 주소/);
      const [s, r] = await call('/auth/oauth/state', { provider: 'google', redirectUri: `${REDIRECT}/` });
      assert.equal(s, 200);
      assert.match(r.state, /^[\w-]{43}$/);
      assert.equal(r.expiresAt, now + OAUTH_STATE_TTL_MS);
      if (opened.db) {
        const { rows } = await opened.db.query('SELECT state_hash, provider, redirect_uri FROM auth_oauth_states WHERE state_hash = $1', [tokenHash(r.state)]);
        assert.deepEqual(rows.map((x) => [x.provider, x.redirect_uri]), [['google', REDIRECT]]);
        const raw = await opened.db.query('SELECT count(*)::int AS c FROM auth_oauth_states WHERE state_hash = $1', [r.state]);
        assert.equal(raw.rows[0].c, 0, '원문은 두지 않는다');
      }
      // 만료된 state
      p.google.set('late-code', { sub: 'g-late' });
      now += OAUTH_STATE_TTL_MS + 1;
      const [ls, late] = await call('/auth/oauth/google', { code: 'late-code', redirectUri: REDIRECT, state: r.state, deviceToken: 'd' });
      assert.deepEqual([ls, late.code], [400, 'invalidToken']);
    });

    test('구글 새 계정: 서버가 코드·PKCE·secret으로 교환하고 세션을 준다, 같은 구글 신원은 다음에도 같은 계정', async () => {
      const before = p.calls.length;
      const [s, r] = await login('google', { sub: 'g-100', email: 'Traveler@Gmail.com', verified: true, name: '구글 민지' });
      assert.equal(s, 200, JSON.stringify(r));
      assert.match(r.token, /^[\w-]{43}$/);
      assert.deepEqual(r.account.providers, ['google']);
      assert.equal(r.account.email, 'traveler@gmail.com');
      assert.equal(r.account.verified, true);
      assert.equal(r.account.nickname, '구글 민지');
      const tokenCall = p.calls.slice(before).find((c) => c.url === GOOGLE_TOKEN_URL)!;
      assert.equal(tokenCall.form!.get('code_verifier'), VERIFIER);
      assert.equal(tokenCall.form!.get('client_secret'), GSECRET);
      assert.equal(tokenCall.form!.get('redirect_uri'), REDIRECT);
      assert.equal(tokenCall.form!.get('grant_type'), 'authorization_code');
      const [ms, me] = await call('/auth/session', undefined, r.token);
      assert.deepEqual([ms, me.account.accountId], [200, r.account.accountId]);

      const [s2, r2] = await login('google', { sub: 'g-100', email: 'traveler@gmail.com', verified: true, name: '다른 이름' });
      assert.equal(s2, 200);
      assert.equal(r2.account.accountId, r.account.accountId, '기존 신원');
      assert.notEqual(r2.token, r.token);
      // 소셜 전용 계정은 비밀번호 로그인이 안 된다(같은 일반 문구)
      const [ps, pw] = await call('/auth/signin', { email: 'traveler@gmail.com', password: PW });
      assert.deepEqual([ps, pw.code], [401, 'badCredentials']);
    });

    test('카카오 새 계정: user/me 회원번호가 신원, 인증 안 된 이메일은 믿지 않는다, 닉네임은 겹치면 숫자를 붙인다', async () => {
      await emailAccount('kakaonick@example.com', '바다여행');
      const before = p.calls.length;
      const [s, r] = await login('kakao', { sub: '4001', email: 'kakaonick@example.com', verified: false, name: '바다여행' });
      assert.equal(s, 200, JSON.stringify(r));
      assert.deepEqual(r.account.providers, ['kakao']);
      assert.equal(r.account.email, '', '인증 안 된 이메일은 계정에 두지 않고 기존 계정과 잇지도 않는다');
      assert.equal(r.account.nickname, '바다여행2');
      const used = p.calls.slice(before);
      const tokenCall = used.find((c) => c.url === KAKAO_TOKEN_URL)!;
      assert.equal(tokenCall.form!.get('client_id'), KID);
      assert.equal(tokenCall.form!.get('client_secret'), KSECRET);
      assert.equal(tokenCall.form!.get('code_verifier'), VERIFIER);
      assert.match(used.find((c) => c.url === KAKAO_ME_URL)!.auth ?? '', /^Bearer kat-/);

      const [s2, r2] = await login('kakao', { sub: '4002', name: '' });
      assert.equal(s2, 200);
      assert.match(r2.account.nickname, /^카카오여행자\d*$/);
      const [s3, r3] = await login('kakao', { sub: '4001', name: '바다여행' });
      assert.equal(r3.account.accountId, r.account.accountId);
      assert.equal(s3, 200);
    });

    test('같은 인증 이메일의 계정이 있으면 조용히 붙이지 않는다: linkRequired + 그 이메일로 연결 확인 메일, 확인해야 연결', async () => {
      const acc = await emailAccount('same@example.com', '같은메일');
      const [s, r] = await login('google', { sub: 'g-same', email: 'SAME@example.com', verified: true, name: '구글사람' });
      assert.deepEqual([s, r.code, r.providerEmail], [409, 'linkRequired', 'same@example.com']);
      assert.equal(r.token, undefined);
      assert.equal(r.linkToken, undefined, '연결 토큰은 응답에 싣지 않는다');
      const link = (await mails('same@example.com')).find((m) => m.kind === 'link' && !m.invalidated)!;
      assert.ok(link);
      const [ns] = await call('/auth/oauth/confirm', { linkToken: link.token, accept: false });
      assert.equal(ns, 409);
      // 다시 시도해서 새 메일로 연결
      await login('google', { sub: 'g-same', email: 'same@example.com', verified: true });
      const link2 = (await mails('same@example.com')).find((m) => m.kind === 'link' && m.id !== link.id)!;
      const [ys, yes] = await call('/auth/oauth/confirm', { linkToken: link2.token, accept: true });
      assert.equal(ys, 200, JSON.stringify(yes));
      assert.equal(yes.account.accountId, acc.accountId);
      assert.deepEqual(yes.account.providers, ['email', 'google']);
      assert.match(yes.token, /^[\w-]{43}$/);
      const [s3, r3] = await login('google', { sub: 'g-same', email: 'same@example.com', verified: true });
      assert.deepEqual([s3, r3.account.accountId], [200, acc.accountId], '연결 뒤에는 바로 로그인');
    });

    test('같은 이메일의 인증 전 가입(가입 선점)은 연결 메일이라고 속이지 않고 지운다: 제공자 계정이 새로 생기고 선점자 비밀번호로는 못 들어간다', async () => {
      // 남이 피해자 이메일로 가입만 해 두고 인증하지 않았다
      const [ss, squat] = await call('/auth/signup', { email: 'victim@example.com', password: PW, nickname: '선점자' });
      assert.equal(ss, 200, JSON.stringify(squat));
      const squatMail = (await mails('victim@example.com')).find((m) => m.kind === 'verify' && !m.invalidated)!;
      assert.ok(squatMail);
      // 피해자가 구글(이메일 인증됨)로 들어온다
      const [s, r] = await login('google', { sub: 'g-victim', email: 'Victim@example.com', verified: true, name: '진짜주인' });
      assert.equal(s, 200, JSON.stringify(r));
      assert.notEqual(r.account.accountId, squat.account.accountId);
      assert.deepEqual(r.account.providers, ['google']);
      assert.equal(r.account.email, 'victim@example.com');
      const after = await mails('victim@example.com');
      assert.equal(after.filter((m) => m.kind === 'link').length, 0, '보내지 않은 연결 메일을 보냈다고 하지 않는다');
      assert.ok(after.filter((m) => m.kind === 'verify').every((m) => m.invalidated), '선점 가입의 인증 메일은 무효');
      const [vs] = await call('/auth/verify', { token: squatMail.token });
      assert.equal(vs, 400, '선점 가입의 인증 링크는 더 쓸 수 없다');
      for (const ident of ['선점자', 'victim@example.com']) {
        const [ps, pw] = await call('/auth/signin', { email: ident, password: PW });
        assert.deepEqual([ps, pw.code], [401, 'badCredentials'], ident);
      }
      // 선점자 닉네임은 풀린다
      const [ns, nick] = await call('/auth/nickname?nickname=' + encodeURIComponent('선점자'), undefined);
      assert.deepEqual([ns, nick.taken], [200, false]);
      const [s2, r2] = await login('google', { sub: 'g-victim', email: 'victim@example.com', verified: true });
      assert.deepEqual([s2, r2.account.accountId], [200, r.account.accountId]);
    });

    test('state는 한 번만, 다른 제공자·다른 돌아올 주소로 쓰면 거부, 허용 밖 주소·코드 없음도 거부(제공자에 묻지 않는다)', async () => {
      p.google.set('reuse-code', { sub: 'g-reuse' });
      const st = await state('google');
      const ok = await call('/auth/oauth/google', { code: 'reuse-code', redirectUri: REDIRECT, state: st, deviceToken: 'd' });
      assert.equal(ok[0], 200);
      const [rs, again] = await call('/auth/oauth/google', { code: 'reuse-code', redirectUri: REDIRECT, state: st, deviceToken: 'd' });
      assert.deepEqual([rs, again.code], [400, 'invalidToken'], '같은 state 두 번');

      const before = p.calls.length;
      const kst = await state('kakao');
      assert.equal((await call('/auth/oauth/google', { code: 'reuse-code', redirectUri: REDIRECT, state: kst, deviceToken: 'd' }))[0], 400, '카카오 state로 구글');
      const other = await state('google', OTHER_REDIRECT);
      assert.equal((await call('/auth/oauth/google', { code: 'reuse-code', redirectUri: REDIRECT, state: other, deviceToken: 'd' }))[0], 400, '다른 주소로 시작한 state');
      const [es, evil] = await call('/auth/oauth/google', { code: 'reuse-code', redirectUri: 'https://evil.example', state: await state('google'), deviceToken: 'd' });
      assert.deepEqual([es, evil.code], [400, 'providerFailed']);
      assert.equal((await call('/auth/oauth/google', { redirectUri: REDIRECT, state: await state('google'), deviceToken: 'd' }))[0], 400);
      assert.equal((await call('/auth/oauth/google', { code: 'reuse-code', redirectUri: REDIRECT, deviceToken: 'd' }))[0], 400, 'state 없음');
      assert.equal(p.calls.length, before, '거부한 요청은 제공자에 묻지 않는다');
    });

    test('코드 교환 실패·신원 확인 실패는 502 providerFailed, 로그에 코드·secret·토큰이 없다', async () => {
      logs.length = 0;
      const [s, r] = await call('/auth/oauth/google', { code: 'unknown-code', redirectUri: REDIRECT, state: await state('google'), deviceToken: 'd' });
      assert.deepEqual([s, r.code], [502, 'providerFailed']);
      p.setDown(true);
      const [ks] = await login('kakao', { sub: '5001' });
      p.setDown(false);
      assert.equal(ks, 502);
      const [as, aud] = await login('google', { sub: 'g-aud', aud: 'someone-else.apps.googleusercontent.com' });
      assert.deepEqual([as, aud.code], [502, 'providerFailed']);
      assert.ok(logs.some((l) => /구글 로그인 확인 실패\(exchange 400\)/.test(l)), logs.join('\n'));
      const all = logs.join('\n');
      for (const secret of ['unknown-code', GSECRET, KSECRET, 'kat-', 'idt.']) assert.ok(!all.includes(secret), secret);
    });

    test('아이디 로그인: 닉네임(공백·대소문자 무시)으로도 로그인, 없는 아이디·틀린 비밀번호는 같은 문구, 잠금은 이메일과 따로(공개 닉네임으로 이메일 로그인을 잠그지 못한다)', async () => {
      await emailAccount('nicklogin@example.com', 'Minsu');
      const [s, r] = await call('/auth/signin', { email: ' minsu ', password: PW, deviceToken: 'dev-n' });
      assert.equal(s, 200, JSON.stringify(r));
      assert.equal(r.account.email, 'nicklogin@example.com');
      const [ws, wrong] = await call('/auth/signin', { email: 'Minsu', password: 'wrong2026x' });
      const [us, unknown] = await call('/auth/signin', { email: '없는아이디', password: 'wrong2026x' });
      assert.deepEqual([ws, wrong.code, us, unknown.code], [401, 'badCredentials', 401, 'badCredentials']);
      assert.equal(wrong.detail.replace(/\(연속.*\)$/, ''), unknown.detail.replace(/\(연속.*\)$/, ''), '같은 문구');
      assert.match(wrong.detail, /아이디\(이메일·닉네임\)나 비밀번호가 맞지 않습니다/);
      // 닉네임은 남에게 보인다. 닉네임으로 5번 틀리면 닉네임 로그인만 잠기고, 이메일 로그인은 그대로 된다
      // (위에서 닉네임으로 이미 1번 틀렸다. 연속 실패는 시간이 지나도 이어진다)
      now += 11 * MIN;
      for (let i = 1; i < 4; i += 1) {
        const [fs, f] = await call('/auth/signin', { email: 'minsu', password: 'wrong2026x' });
        assert.deepEqual([fs, f.code], [401, 'badCredentials'], `닉네임 ${i + 1}번째`);
      }
      const [ls, locked] = await call('/auth/signin', { email: 'MINSU', password: 'wrong2026x' });
      assert.deepEqual([ls, locked.code], [423, 'locked']);
      const [nl] = await call('/auth/signin', { email: 'minsu', password: PW });
      assert.equal(nl, 423, '잠긴 닉네임은 맞는 비밀번호도 거부');
      const [el, emailOk] = await call('/auth/signin', { email: 'nicklogin@example.com', password: PW });
      assert.equal(el, 200, `이메일 로그인은 닉네임 잠금과 따로다: ${JSON.stringify(emailOk)}`);
      // 없는 닉네임도 같은 규칙으로 잠긴다(가입 여부가 드러나지 않는다)
      for (let i = 0; i < 4; i += 1) await call('/auth/signin', { email: '없는닉네임', password: 'wrong2026x' });
      const [gs, ghost] = await call('/auth/signin', { email: '없는닉네임', password: 'wrong2026x' });
      assert.deepEqual([gs, ghost.code], [423, 'locked']);
      // 이메일 칸은 그대로 5번이면 잠긴다
      now += 11 * MIN;
      for (let i = 0; i < 4; i += 1) await call('/auth/signin', { email: 'nicklogin@example.com', password: 'wrong2026x' });
      const [es, eLocked] = await call('/auth/signin', { email: 'nicklogin@example.com', password: 'wrong2026x' });
      assert.deepEqual([es, eLocked.code], [423, 'locked']);
      // 닉네임에 @는 쓸 수 없다(이메일 아이디와 헷갈린다)
      const [as, at] = await call('/auth/signup', { email: 'at@example.com', password: PW, nickname: 'a@b.co' });
      assert.deepEqual([as, at.code], [400, 'badCredentials']);
    });

    test('앱 HTTP 제공자와 맞물린다: oauthState → oauthSignIn(토큰은 결과에서 빼고 KV에), 같은 이메일은 개발용 메일함에서 연결 토큰을 연다', async () => {
      const kv = memoryKV();
      const app = createHttpAuth({ url: server.url, fetch: (url, init) => fetch(url, init), kv });
      const st = await app.oauthState!({ provider: 'kakao', redirectUri: REDIRECT });
      assert.ok(st.ok);
      p.kakao.set('app-code', { sub: '7001', name: '앱사용자' });
      const r = await app.oauthSignIn!({ provider: 'kakao', code: 'app-code', codeVerifier: VERIFIER, redirectUri: REDIRECT, state: st.state, deviceToken: 'dev-app' });
      assert.ok(r.ok, JSON.stringify(r));
      assert.equal((r as any).token, undefined);
      assert.equal(await app.checkSession!(r.account.accountId), 'ok');

      const acc = await emailAccount('applink@example.com', '앱연결');
      const st2 = await app.oauthState!({ provider: 'google', redirectUri: REDIRECT });
      assert.ok(st2.ok);
      p.google.set('app-link', { sub: 'g-app', email: 'applink@example.com', verified: true });
      const l = await app.oauthSignIn!({ provider: 'google', code: 'app-link', redirectUri: REDIRECT, state: st2.state, deviceToken: 'dev-app' });
      assert.equal(l.ok, false);
      assert.ok(!l.ok && l.code === 'linkRequired' && typeof l.linkToken === 'string');
      const c = await app.confirmLink({ linkToken: (l as any).linkToken, accept: true });
      assert.ok(c.ok && c.account.accountId === acc.accountId && c.account.providers.includes('google'));

      const off = createHttpAuth({ url: bare.url, fetch: (url, init) => fetch(url, init), kv: memoryKV() });
      const none = await off.oauthState!({ provider: 'google', redirectUri: REDIRECT });
      assert.deepEqual([none.ok, !none.ok && none.unconfigured], [false, true]);
    });
  });
}
