import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { pickAuthUrl } from '../src/config';
import type { AuthResult } from '../src/core/ports';
import { createAuthProvider } from '../src/services/auth';
import { createHttpAuth } from '../src/services/auth/http';
import { createLocalAuth } from '../src/services/auth/local';
import { fakeFetch, fakeHasher, fixedClock, memoryKV, seededRng, type FakeFetchCall } from './helpers/fakes';

/**
 * WP1 계정 서버 인증 제공자(src/services/auth/http.ts)와 고르기 규칙, 모의 인증 비밀번호 재설정.
 * 서버는 fakeFetch로 흉내 낸다(실제 서버와 맞물리는 시나리오는 tests/wp2-auth.test.ts).
 */

const URL_ = 'http://auth.test';
const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const PW = 'trip2026ok';

const account = (id = 'acc-1') => ({
  accountId: id,
  userId: 'u-1',
  email: 'minji@example.com',
  nickname: '민지',
  verified: true,
  providers: ['email'],
  profile: { nickname: '민지', tags: [] },
});

const bodyOf = (c: FakeFetchCall) => (c.init?.body ? JSON.parse(c.init.body) : undefined);
const path = (c: FakeFetchCall) => c.url.slice(URL_.length);

describe('계정 서버 고르기', () => {
  test('API_URL이 있으면 그 서버, 없으면 SYNC_URL(http 주소일 때), 둘 다 없으면 모의 인증(빈 값)', () => {
    assert.equal(pickAuthUrl('https://api.example', 'https://sync.example'), 'https://api.example');
    assert.equal(pickAuthUrl('', 'https://sync.example/'), 'https://sync.example');
    assert.equal(pickAuthUrl('', 'sync.example'), '');
    assert.equal(pickAuthUrl('', undefined), '');
  });

  test('팩토리: serverUrl과 fetch가 있으면 서버 제공자, 없으면 모의 인증', () => {
    const base = { clock: fixedClock(T0), rng: seededRng(3), hasher: fakeHasher, kv: memoryKV() };
    assert.equal(createAuthProvider({ ...base, serverUrl: URL_, fetch: fakeFetch() }).id, 'server');
    assert.equal(createAuthProvider(base).id, 'local');
    assert.equal(createAuthProvider({ ...base, serverUrl: '' , fetch: fakeFetch() }).id, 'local');
  });
});

describe('HTTP 인증 제공자', () => {
  test('로그인 성공: 토큰은 결과에서 빼고 계정별로 KV에 둔다, 이후 요청은 Bearer', async () => {
    const kv = memoryKV();
    const f = fakeFetch((c) => {
      if (path(c) === '/auth/signin') return { body: { ok: true, account: account(), token: 'tok-abc', expiresAt: 1 } };
      if (path(c) === '/auth/profile') return { body: { ok: true, account: { ...account(), profile: { nickname: '민지', tags: ['바다'] } } } };
      return { status: 404, body: { error: 'notFound' } };
    });
    const auth = createHttpAuth({ url: `${URL_}/`, fetch: f, kv });
    const r = await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev' });
    assert.deepEqual(r, { ok: true, account: account() });
    assert.equal(f.calls[0].init?.method, 'POST');
    assert.deepEqual(bodyOf(f.calls[0]), { email: 'minji@example.com', password: PW, deviceToken: 'dev' });
    assert.equal(f.calls[0].init?.headers?.Authorization, undefined);
    assert.deepEqual(JSON.parse((await kv.get('tokens')) ?? '{}'), { 'acc-1': 'tok-abc' });

    const p = await auth.updateProfile('acc-1', { tags: ['바다'] });
    assert.ok(p.ok);
    assert.equal(f.calls[1].init?.headers?.Authorization, 'Bearer tok-abc');
    assert.deepEqual(bodyOf(f.calls[1]), { profile: { tags: ['바다'] } });
  });

  test('실패 응답은 AuthResult 그대로(code·detail·retryAt·violations·linkToken), 모르는 code는 providerFailed', async () => {
    const replies: Record<string, { status: number; body: unknown }> = {
      '/auth/signin': { status: 423, body: { ok: false, code: 'locked', detail: '잠김', retryAt: 99 } },
      '/auth/signup': { status: 400, body: { ok: false, code: 'weakPassword', violations: ['숫자 포함'] } },
      '/auth/social': { status: 409, body: { ok: false, code: 'linkRequired', linkToken: 'lt', detail: '연결할까요?' } },
      '/auth/verify': { status: 400, body: { ok: false, code: 'weird' } },
    };
    const auth = createHttpAuth({ url: URL_, fetch: fakeFetch((c) => replies[path(c)]), kv: memoryKV() });
    assert.deepEqual(await auth.signIn({ email: 'a@b.co', password: 'x', deviceToken: 'd' }), { ok: false, code: 'locked', detail: '잠김', retryAt: 99 });
    assert.deepEqual(await auth.signUp({ email: 'a@b.co', password: 'x', nickname: 'n' }), { ok: false, code: 'weakPassword', violations: ['숫자 포함'] });
    assert.deepEqual(await auth.social({ provider: 'kakao', scenario: 'sameEmail', deviceToken: 'd', providerEmail: 'a@b.co' }), {
      ok: false,
      code: 'linkRequired',
      linkToken: 'lt',
      detail: '연결할까요?',
    });
    assert.deepEqual(await auth.verifyEmail('t'), { ok: false, code: 'providerFailed' });
  });

  test('서버에 닿지 못하면 providerFailed, 시간 초과도 같다, 닉네임 확인은 막지 않는다(false)', async () => {
    const down = createHttpAuth({ url: URL_, fetch: async () => Promise.reject(new Error('ECONNREFUSED')), kv: memoryKV() });
    const r = await down.signIn({ email: 'a@b.co', password: PW, deviceToken: 'd' });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'providerFailed');
    assert.match(!r.ok ? (r.detail ?? '') : '', /계정 서버에 닿지 못했습니다/);
    assert.equal(await down.isNicknameTaken('민지'), false);
    assert.deepEqual(await down.outbox(), []);
    const slow = createHttpAuth({ url: URL_, fetch: () => new Promise(() => {}), kv: memoryKV(), timeoutMs: 20 });
    const s = await slow.resendVerification('a@b.co');
    assert.equal(s.ok, false);
  });

  test('세션 확인: 200이면 ok, 401이면 expired(토큰 지움), 닿지 못하면 unreachable, 토큰이 없으면 expired', async () => {
    const kv = memoryKV();
    await kv.set('tokens', JSON.stringify({ 'acc-1': 'tok-1', 'acc-2': 'tok-2' }));
    let mode: 'ok' | 'gone' | 'down' = 'ok';
    const f = fakeFetch((c) => {
      if (mode === 'down') throw new Error('offline');
      if (mode === 'gone') return { status: 401, body: { ok: false, code: 'invalidToken' } };
      const tok = c.init?.headers?.Authorization;
      return { body: { ok: true, account: account(tok === 'Bearer tok-2' ? 'acc-2' : 'acc-1'), expiresAt: 1 } };
    });
    const auth = createHttpAuth({ url: URL_, fetch: f, kv });
    assert.equal(await auth.checkSession!('acc-1'), 'ok');
    assert.equal(path(f.calls[0]), '/auth/session');
    assert.equal(f.calls[0].init?.method, 'GET');
    mode = 'down';
    assert.equal(await auth.checkSession!('acc-1'), 'unreachable');
    assert.deepEqual(Object.keys(JSON.parse((await kv.get('tokens')) ?? '{}')), ['acc-1', 'acc-2'], '닿지 못하면 토큰을 그대로 둔다');
    mode = 'gone';
    assert.equal(await auth.checkSession!('acc-1'), 'expired');
    assert.deepEqual(JSON.parse((await kv.get('tokens')) ?? '{}'), { 'acc-2': 'tok-2' });
    assert.equal(await auth.checkSession!('acc-9'), 'expired');
    const g = await auth.getAccount('acc-9');
    assert.equal(!g.ok && g.code, 'invalidToken');
  });

  test('로그아웃은 서버 세션을 끊고 토큰을 지운다, 탈퇴 성공도 토큰을 지운다, 시연 리셋은 토큰만 비운다', async () => {
    const kv = memoryKV();
    await kv.set('tokens', JSON.stringify({ 'acc-1': 'tok-1', 'acc-2': 'tok-2' }));
    const f = fakeFetch(() => ({ body: { ok: true } }));
    const auth = createHttpAuth({ url: URL_, fetch: f, kv });
    await auth.signOut!('acc-1');
    assert.equal(path(f.calls[0]), '/auth/signout');
    assert.equal(f.calls[0].init?.headers?.Authorization, 'Bearer tok-1');
    assert.deepEqual(JSON.parse((await kv.get('tokens')) ?? '{}'), { 'acc-2': 'tok-2' });
    assert.deepEqual(await auth.deleteAccount('acc-2'), { ok: true });
    assert.equal(path(f.calls[1]), '/auth/delete');
    assert.deepEqual(JSON.parse((await kv.get('tokens')) ?? '{}'), {});
    assert.deepEqual(await auth.deleteAccount('acc-2'), { ok: false, code: 'invalidToken' }, '토큰이 없으면 서버에 묻지 않는다');
    assert.equal(f.calls.length, 2);
    await auth.reset();
    assert.equal(await kv.get('tokens'), null);
  });

  test('소셜 연결은 지금 계정 토큰으로만 보낸다(토큰 없으면 notFound), 성공 응답의 토큰은 그 계정에 둔다', async () => {
    const kv = memoryKV();
    const f = fakeFetch((c) => {
      const b = bodyOf(c);
      if (b?.link) return { body: { ok: true, account: { ...account('acc-1'), providers: ['email', 'kakao'] } } };
      return { body: { ok: true, account: account('acc-k'), token: 'tok-k' } };
    });
    const auth = createHttpAuth({ url: URL_, fetch: f, kv });
    const none = await auth.social({ provider: 'kakao', scenario: 'ok', deviceToken: 'd', linkToAccountId: 'acc-1' });
    assert.equal(!none.ok && none.code, 'notFound');
    assert.equal(f.calls.length, 0);
    const k = await auth.social({ provider: 'kakao', scenario: 'ok', deviceToken: 'd' });
    assert.ok(k.ok);
    assert.deepEqual(bodyOf(f.calls[0]), { provider: 'kakao', scenario: 'ok', deviceToken: 'd' });
    await kv.set('tokens', JSON.stringify({ ...JSON.parse((await kv.get('tokens')) ?? '{}'), 'acc-1': 'tok-1' }));
    const fresh = createHttpAuth({ url: URL_, fetch: f, kv });
    const linked: AuthResult = await fresh.social({ provider: 'kakao', scenario: 'ok', deviceToken: 'd', linkToAccountId: 'acc-1' });
    assert.ok(linked.ok);
    assert.equal(f.calls[1].init?.headers?.Authorization, 'Bearer tok-1');
    assert.equal(bodyOf(f.calls[1]).link, true);
  });

  test('메일함: devOutbox 서버면 보낸편지함(kind 포함), 닫힌 서버(404)면 빈 목록', async () => {
    let open = true;
    const mail = { id: 'm1', kind: 'reset', to: 'a@b.co', subject: 'Young Trip 비밀번호 재설정', token: 't', sentAt: 5, invalidated: false };
    const auth = createHttpAuth({
      url: URL_,
      fetch: fakeFetch(() => (open ? { body: { mails: [mail] } } : { status: 404, body: { error: 'notFound' } })),
      kv: memoryKV(),
    });
    assert.deepEqual(await auth.outbox(), [mail]);
    open = false;
    assert.deepEqual(await auth.outbox(), []);
  });

  test('비밀번호 재설정 요청·확정은 /auth/password/…로 보내고 위반 항목을 돌려준다', async () => {
    const f = fakeFetch((c) =>
      path(c) === '/auth/password/confirm' ? { status: 400, body: { ok: false, code: 'weakPassword', violations: ['8자 이상'] } } : { body: { ok: true } },
    );
    const auth = createHttpAuth({ url: URL_, fetch: f, kv: memoryKV() });
    assert.deepEqual(await auth.requestPasswordReset!('a@b.co'), { ok: true });
    assert.deepEqual(await auth.confirmPasswordReset!({ token: 't', password: 'x' }), {
      ok: false,
      code: 'weakPassword',
      detail: undefined,
      violations: ['8자 이상'],
    });
    assert.deepEqual(bodyOf(f.calls[1]), { token: 't', password: 'x' });
  });

  test('같은 이메일 소셜: 응답에 토큰이 없으면 개발용 메일함의 최신 연결 확인 메일(kind link)을 열어 넘긴다, 메일이 없으면 서버 문구 그대로', async () => {
    let mails: unknown[] = [];
    const f = fakeFetch((c) => {
      if (path(c) === '/auth/social') return { status: 409, body: { ok: false, code: 'linkRequired', detail: '메일을 보냈습니다' } };
      if (path(c) === '/auth/outbox') return { body: { mails } };
      return { status: 404, body: { error: 'notFound' } };
    });
    const auth = createHttpAuth({ url: URL_, fetch: f, kv: memoryKV() });
    const input = { provider: 'kakao' as const, scenario: 'sameEmail' as const, deviceToken: 'dev', providerEmail: ' Minji@Example.com ' };
    assert.deepEqual(await auth.social(input), { ok: false, code: 'linkRequired', detail: '메일을 보냈습니다' });
    mails = [
      { id: 'm1', kind: 'link', to: 'minji@example.com', subject: 's', token: 'old', sentAt: 1, invalidated: false },
      { id: 'm2', kind: 'link', to: 'minji@example.com', subject: 's', token: 'new', sentAt: 2, invalidated: false },
      { id: 'm3', kind: 'verify', to: 'minji@example.com', subject: 's', token: 'verify', sentAt: 3, invalidated: false },
      { id: 'm4', kind: 'link', to: 'other@example.com', subject: 's', token: 'other', sentAt: 4, invalidated: false },
    ];
    const r = await auth.social(input);
    assert.ok(!r.ok && r.code === 'linkRequired' && r.linkToken === 'new', JSON.stringify(r));
    assert.deepEqual((await auth.outbox()).map((m) => m.kind), ['link', 'link', 'verify', 'link']);
  });

  test('게스트 승격 가입은 기기 토큰을 같이 보낸다(서버가 같은 게스트인지 확인)', async () => {
    const f = fakeFetch(() => ({ body: { ok: true, account: account() } }));
    const auth = createHttpAuth({ url: URL_, fetch: f, kv: memoryKV() });
    await auth.signUp({ email: 'a@b.co', password: PW, nickname: 'n', userId: 'u-guest', deviceToken: 'dev-guest' });
    assert.deepEqual(bodyOf(f.calls[0]), { email: 'a@b.co', password: PW, nickname: 'n', userId: 'u-guest', deviceToken: 'dev-guest' });
  });
});

describe('모의 인증 비밀번호 재설정', () => {
  test('재설정 메일(kind reset)로 새 비밀번호, 이전 비밀번호는 안 통하고 토큰은 한 번만, 없는 이메일도 ok', async () => {
    const clock = fixedClock(T0);
    const auth = createLocalAuth({ clock, rng: seededRng(5), hasher: fakeHasher, kv: memoryKV() });
    const up = await auth.signUp({ email: 'reset@example.com', password: PW, nickname: '재설정' });
    assert.ok(up.ok);
    const verify = (await auth.outbox()).find((m) => m.kind === 'verify')!;
    assert.ok((await auth.verifyEmail(verify.token)).ok);
    assert.deepEqual(await auth.requestPasswordReset!('nobody@example.com'), { ok: true });
    assert.deepEqual(await auth.requestPasswordReset!('reset@example.com'), { ok: true });
    const mail = (await auth.outbox()).find((m) => m.kind === 'reset')!;
    assert.equal((await auth.verifyEmail(mail.token)).ok, false, '재설정 토큰으로 인증하지 않는다');
    assert.equal((await auth.confirmPasswordReset!({ token: mail.token, password: 'short' })).ok, false);
    assert.deepEqual(await auth.confirmPasswordReset!({ token: mail.token, password: 'newpass2026' }), { ok: true });
    assert.equal((await auth.confirmPasswordReset!({ token: mail.token, password: 'newpass2027' })).ok, false);
    assert.equal((await auth.signIn({ email: 'reset@example.com', password: PW, deviceToken: 'd' })).ok, false);
    assert.equal((await auth.signIn({ email: 'reset@example.com', password: 'newpass2026', deviceToken: 'd' })).ok, true);
    assert.equal((await auth.outbox()).filter((m) => m.to === 'nobody@example.com').length, 0);
  });
});
