import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { parseOAuthClientId, pickOAuthClientId, type OAuthClientIds } from '../src/config';
import { nicknameProblem } from '../src/core/auth';
import { judgePrompt, OAUTH_DISCOVERY, OAUTH_SCOPES, oauthReadiness, stateNeedsRefresh } from '../src/features/account/oauth';
import { createHttpAuth } from '../src/services/auth/http';
import { createLocalAuth } from '../src/services/auth/local';
import { brandC, H, R, surfaceC, TEXT_ON_SURFACE_PAIRS, textC } from '../src/ui/tokens';
import { fakeFetch, fakeHasher, fixedClock, memoryKV, seededRng, type FakeFetchCall } from './helpers/fakes';

/**
 * WP1 실제 소셜 로그인(앱 쪽)과 아이디(닉네임) 로그인, 15 로그인 시안 개편(2026-10-10).
 * - 설정 값 고르기(config parseOAuthClientId, pickOAuthClientId), 쓸 수 있는지 판정(oauthReadiness), 로그인 창 결과 판정(judgePrompt)
 * - 계정 서버 제공자(http.ts)의 oauthState·oauthSignIn·confirmLink 경로와 본문(서버는 fakeFetch)
 * - 모의 인증(local.ts)의 닉네임 로그인, 닉네임 @ 금지, 실제 OAuth 없음
 * - 화면: 네이버 없음, 시안 문구, 브랜드 색은 ui 토큰에만
 */

const URL_ = 'http://auth.test';
const T0 = Date.UTC(2026, 9, 10, 3, 0, 0);
const PW = 'trip2026ok';
const bodyOf = (c: FakeFetchCall) => (c.init?.body ? JSON.parse(c.init.body) : undefined);
const pathOf = (c: FakeFetchCall) => c.url.slice(URL_.length);

const IDS: OAuthClientIds = {
  google: { web: 'web.apps.googleusercontent.com', android: '', ios: 'ios.apps.googleusercontent.com' },
  kakao: 'kakaorestkey',
};

describe('설정: OAuth 클라이언트 ID', () => {
  test('앞뒤 공백을 떼고, 영문·숫자·.·-·_ 밖의 글자가 있으면 없는 것으로 본다', () => {
    assert.equal(parseOAuthClientId(' 123-abc.apps.googleusercontent.com '), '123-abc.apps.googleusercontent.com');
    assert.equal(parseOAuthClientId('a1b2c3d4e5f6'), 'a1b2c3d4e5f6');
    assert.equal(parseOAuthClientId('has space'), '');
    assert.equal(parseOAuthClientId('https://x'), '');
    assert.equal(parseOAuthClientId(undefined), '');
  });

  test('플랫폼별 고르기: 구글은 웹·안드로이드·iOS 따로, 카카오는 REST 키 하나', () => {
    assert.equal(pickOAuthClientId('google', 'web', IDS), IDS.google.web);
    assert.equal(pickOAuthClientId('google', 'ios', IDS), IDS.google.ios);
    assert.equal(pickOAuthClientId('google', 'android', IDS), '');
    assert.equal(pickOAuthClientId('kakao', 'android', IDS), 'kakaorestkey');
    assert.equal(pickOAuthClientId('kakao', 'web', IDS), 'kakaorestkey');
  });
});

describe('실제 소셜 로그인 판정(순수)', () => {
  test('계정 서버가 없으면 noServer, 앱 키가 없으면 그 환경 변수 이름을 알린다, 둘 다 있으면 ready', () => {
    const base = { provider: 'google' as const, hasOAuth: true, clientId: 'x', platform: 'web' };
    assert.equal(oauthReadiness({ ...base, authId: 'local', hasOAuth: false }).kind, 'noServer');
    assert.equal(oauthReadiness({ ...base, authId: 'server', hasOAuth: false }).kind, 'noServer');
    const g = oauthReadiness({ ...base, authId: 'server', clientId: '' });
    assert.ok(g.kind === 'noClientId' && g.text.includes('EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID'));
    const a = oauthReadiness({ ...base, authId: 'server', clientId: '', platform: 'android' });
    assert.ok(a.kind === 'noClientId' && a.text.includes('EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID'));
    const k = oauthReadiness({ ...base, provider: 'kakao', authId: 'server', clientId: '' });
    assert.ok(k.kind === 'noClientId' && k.text.includes('EXPO_PUBLIC_KAKAO_OAUTH_CLIENT_ID') && k.text.startsWith('카카오'));
    assert.equal(oauthReadiness({ ...base, authId: 'server' }).kind, 'ready');
  });

  test('로그인 창 결과: 성공은 코드와 state, 닫기·거절은 cancel, state가 다르거나 코드가 없거나 오류면 fail', () => {
    assert.deepEqual(judgePrompt('kakao', { type: 'success', params: { code: 'c1', state: 's1' } }, 's1'), { kind: 'code', code: 'c1', state: 's1' });
    assert.deepEqual(judgePrompt('kakao', { type: 'dismiss' }, 's1'), { kind: 'cancel' });
    assert.deepEqual(judgePrompt('google', { type: 'cancel' }, 's1'), { kind: 'cancel' });
    assert.deepEqual(judgePrompt('google', { type: 'error', params: { error: 'access_denied' } }, 's1'), { kind: 'cancel' });
    assert.equal(judgePrompt('google', { type: 'success', params: { code: 'c1', state: 'other' } }, 's1').kind, 'fail');
    const noCode = judgePrompt('google', { type: 'success', params: { state: 's1' } }, 's1');
    assert.ok(noCode.kind === 'fail' && noCode.text.startsWith('구글이'));
    const err = judgePrompt('kakao', { type: 'error', params: { error: 'server_error', error_description: 'secret detail' } }, 's1');
    assert.ok(err.kind === 'fail' && !err.text.includes('secret detail'), '제공자 오류 문구를 그대로 보이지 않는다');
  });

  test('state는 만료 1분 전부터 새로 받는다, 제공자 주소·범위', () => {
    assert.equal(stateNeedsRefresh(null, T0), true);
    assert.equal(stateNeedsRefresh({ expiresAt: T0 + 61_000 }, T0), false);
    assert.equal(stateNeedsRefresh({ expiresAt: T0 + 59_000 }, T0), true);
    assert.equal(OAUTH_DISCOVERY.kakao.authorizationEndpoint, 'https://kauth.kakao.com/oauth/authorize');
    assert.equal(OAUTH_DISCOVERY.google.authorizationEndpoint, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.deepEqual(OAUTH_SCOPES.google, ['openid', 'email', 'profile']);
    assert.deepEqual(Object.keys(OAUTH_DISCOVERY).sort(), ['google', 'kakao'], '네이버 없음');
  });
});

describe('계정 서버 제공자(http.ts) 실제 소셜 로그인', () => {
  const account = { accountId: 'acc-g', userId: 'u-g', email: 'g@example.com', nickname: '구글', verified: true, providers: ['google'], profile: { nickname: '구글', tags: [] } };

  test('oauthState: POST /auth/oauth/state, 503이면 unconfigured, 닿지 못하면 providerFailed', async () => {
    let mode: 'ok' | 'off' | 'down' = 'ok';
    const f = fakeFetch(() => {
      if (mode === 'down') throw new Error('net');
      if (mode === 'off') return { status: 503, body: { ok: false, code: 'providerFailed', detail: '키 없음', unconfigured: true } };
      return { body: { ok: true, state: 'st-1', expiresAt: T0 + 600_000 } };
    });
    const auth = createHttpAuth({ url: URL_, fetch: f, kv: memoryKV() });
    assert.deepEqual(await auth.oauthState!({ provider: 'kakao', redirectUri: 'http://localhost:8090' }), { ok: true, state: 'st-1', expiresAt: T0 + 600_000 });
    assert.equal(pathOf(f.calls[0]), '/auth/oauth/state');
    assert.deepEqual(bodyOf(f.calls[0]), { provider: 'kakao', redirectUri: 'http://localhost:8090' });
    mode = 'off';
    assert.deepEqual(await auth.oauthState!({ provider: 'google', redirectUri: 'x' }), { ok: false, code: 'providerFailed', detail: '키 없음', unconfigured: true });
    mode = 'down';
    const down = await auth.oauthState!({ provider: 'google', redirectUri: 'x' });
    assert.equal(down.ok, false);
    assert.ok(!down.ok && down.code === 'providerFailed' && !down.unconfigured);
  });

  test('oauthSignIn: 제공자별 경로에 코드·PKCE·state·기기 토큰을 보내고, 받은 세션 토큰은 결과에서 빼고 KV에 둔다', async () => {
    const kv = memoryKV();
    const f = fakeFetch(() => ({ body: { ok: true, account, token: 'tok-g', expiresAt: 1 } }));
    const auth = createHttpAuth({ url: URL_, fetch: f, kv });
    const r = await auth.oauthSignIn!({ provider: 'google', code: 'c', codeVerifier: 'v'.repeat(43), redirectUri: 'http://localhost:8090', state: 's', deviceToken: 'dev' });
    assert.deepEqual(r, { ok: true, account });
    assert.equal(pathOf(f.calls[0]), '/auth/oauth/google');
    assert.deepEqual(bodyOf(f.calls[0]), { code: 'c', codeVerifier: 'v'.repeat(43), redirectUri: 'http://localhost:8090', state: 's', deviceToken: 'dev' });
    assert.deepEqual(JSON.parse((await kv.get('tokens')) ?? '{}'), { 'acc-g': 'tok-g' });
  });

  test('같은 이메일(linkRequired + providerEmail): 개발용 메일함의 연결 확인 메일을 열고, 확인은 /auth/oauth/confirm', async () => {
    const f = fakeFetch((c) => {
      if (pathOf(c) === '/auth/oauth/kakao') return { status: 409, body: { ok: false, code: 'linkRequired', detail: '메일 보냄', providerEmail: 'me@example.com' } };
      if (pathOf(c) === '/auth/outbox') {
        return { body: { mails: [{ id: 'm1', kind: 'link', to: 'me@example.com', subject: '연결', token: 'lt-1', sentAt: 5, invalidated: false }] } };
      }
      if (pathOf(c) === '/auth/oauth/confirm') return { body: { ok: true, account, token: 'tok-l', expiresAt: 1 } };
      return { status: 404, body: {} };
    });
    const auth = createHttpAuth({ url: URL_, fetch: f, kv: memoryKV() });
    const r = await auth.oauthSignIn!({ provider: 'kakao', code: 'c', redirectUri: 'r', state: 's', deviceToken: 'd' });
    assert.ok(!r.ok && r.code === 'linkRequired' && r.linkToken === 'lt-1');
    const c = await auth.confirmLink({ linkToken: 'lt-1', accept: true });
    assert.ok(c.ok);
    assert.equal(pathOf(f.calls.at(-1)!), '/auth/oauth/confirm');
    assert.deepEqual(bodyOf(f.calls.at(-1)!), { linkToken: 'lt-1', accept: true });
  });

  test('메일함이 닫혀 있으면(운영 서버) 서버 문구 그대로, 연결 토큰 없음', async () => {
    const f = fakeFetch((c) =>
      pathOf(c) === '/auth/outbox' ? { status: 404, body: { error: 'notFound' } } : { status: 409, body: { ok: false, code: 'linkRequired', detail: '메일 보냄', providerEmail: 'me@example.com' } },
    );
    const auth = createHttpAuth({ url: URL_, fetch: f, kv: memoryKV() });
    assert.deepEqual(await auth.oauthSignIn!({ provider: 'google', code: 'c', redirectUri: 'r', state: 's', deviceToken: 'd' }), {
      ok: false,
      code: 'linkRequired',
      detail: '메일 보냄',
    });
  });
});

describe('아이디(닉네임) 로그인 · 모의 인증', () => {
  async function verifiedLocal() {
    const auth = createLocalAuth({ clock: fixedClock(T0), rng: seededRng(9), hasher: fakeHasher, kv: memoryKV() });
    const up = await auth.signUp({ email: 'jiho@example.com', password: PW, nickname: 'Jiho' });
    assert.ok(up.ok);
    const mail = (await auth.outbox()).find((m) => m.to === 'jiho@example.com')!;
    assert.ok((await auth.verifyEmail(mail.token)).ok);
    return auth;
  }

  test('닉네임(공백·대소문자 무시)으로도 로그인하고, 없는 아이디와 틀린 비밀번호는 같은 문구다', async () => {
    const auth = await verifiedLocal();
    const r = await auth.signIn({ email: ' jiho ', password: PW, deviceToken: 'd' });
    assert.ok(r.ok && r.account.email === 'jiho@example.com');
    const wrong = await auth.signIn({ email: 'JIHO', password: 'nope2026x', deviceToken: 'd' });
    const none = await auth.signIn({ email: '아무도', password: 'nope2026x', deviceToken: 'd' });
    assert.ok(!wrong.ok && !none.ok);
    assert.equal(wrong.code, 'badCredentials');
    assert.equal(none.code, 'badCredentials');
    assert.equal(wrong.detail?.replace(/\(연속.*\)$/, ''), none.detail);
    assert.equal(none.detail, '아이디(이메일·닉네임)나 비밀번호가 맞지 않습니다');
  });

  test('닉네임과 이메일로 번갈아 틀려도 같은 계정 잠금(5회)', async () => {
    const auth = await verifiedLocal();
    for (let i = 0; i < 4; i += 1) await auth.signIn({ email: i % 2 ? 'jiho' : 'jiho@example.com', password: 'nope2026x', deviceToken: 'd' });
    const fifth = await auth.signIn({ email: 'Jiho', password: 'nope2026x', deviceToken: 'd' });
    assert.ok(!fifth.ok && fifth.code === 'locked');
  });

  test('닉네임에 @는 쓸 수 없다(앱 규칙과 모의 인증 가입)', async () => {
    assert.equal(nicknameProblem('a@b.co'), '닉네임에는 @를 쓸 수 없습니다');
    assert.equal(nicknameProblem('민지'), null);
    const auth = createLocalAuth({ clock: fixedClock(T0), rng: seededRng(2), hasher: fakeHasher, kv: memoryKV() });
    const r = await auth.signUp({ email: 'x@example.com', password: PW, nickname: 'x@y' });
    assert.ok(!r.ok && r.code === 'badCredentials');
  });

  test('모의 인증에는 실제 OAuth가 없다(화면이 시연용 동의 화면으로 안내한다)', () => {
    const auth = createLocalAuth({ clock: fixedClock(T0), rng: seededRng(2), hasher: fakeHasher, kv: memoryKV() });
    assert.equal(auth.oauthState, undefined);
    assert.equal(auth.oauthSignIn, undefined);
  });
});

describe('15 로그인 시안 · 디자인 규칙', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');
  const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((n) => {
      const rel = `${dir}/${n}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : [];
    });

  test('로그인 화면 순서: 제목 → 아이디 또는 이메일 → 비밀번호 → 로그인 → 회원가입 → 계정찾기 → 구분선 → 카카오 → 구글', () => {
    const src = read('src/screens/LoginScreen.tsx');
    const marks = ['<AuthTitle title="로그인"', '"아이디 또는 이메일"', 'placeholder="비밀번호"', "'로그인'}", 'title="회원가입"', 'title="계정찾기"', '<Divider', "'카카오 로그인'", "'구글 로그인'"];
    const at = marks.map((m) => src.indexOf(m));
    assert.ok(at.every((i) => i >= 0), JSON.stringify(marks.filter((_, i) => at[i] < 0)));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  });

  test('네이버 로그인은 어디에도 없다(화면·계정 흐름·인증 제공자·서버)', () => {
    const files = [...walk('src/screens'), ...walk('src/features/account'), ...walk('src/services/auth'), ...walk('src/ui'), 'server/auth.mjs', 'server/oauth.mjs'];
    const hits = files.filter((f) => /naver|네이버/i.test(read(f)));
    assert.deepEqual(hits, []);
  });

  test('브랜드 색은 ui 토큰에만 있고 카카오 글씨 대비는 4.5:1 이상으로 검사된다, 버튼은 높이 48·라운드 6', () => {
    assert.equal(surfaceC.kakao, '#FEE500');
    assert.equal(textC.onKakao, '#191919');
    assert.ok(TEXT_ON_SURFACE_PAIRS.some((p) => p.text === 'onKakao' && p.surface === 'kakao'));
    assert.deepEqual(Object.keys(brandC).sort(), ['googleBlue', 'googleGreen', 'googleLine', 'googleRed', 'googleYellow', 'kakaoSymbol']);
    assert.equal(H.auth, 48);
    assert.ok(R.auth <= 16);
    for (const f of ['src/screens/LoginScreen.tsx', 'src/screens/SignupScreen.tsx', 'src/features/account/FindAccountSheet.tsx', 'src/features/account/useOAuthLogin.ts']) {
      assert.doesNotMatch(read(f), /#[0-9a-fA-F]{3,8}\b|rgba?\(/, f);
    }
  });
});
