/**
 * 실제 소셜 로그인(구글·카카오 OAuth 2.0 인가 코드) 확인(WP2 소유, 2026-10-10). server/auth.mjs가 쓴다.
 *
 * 앱(expo-auth-session)이 제공자 로그인 창에서 받은 인가 코드를 서버로 보내면, 서버가 제공자 토큰 주소에서 직접 바꾸고
 * 신원(제공자 사용자 번호·이메일·닉네임)을 확인한다. 앱은 제공자 토큰을 보지 않는다. client secret은 서버에만 둔다.
 *
 * - 구글: https://oauth2.googleapis.com/token 에 code + code_verifier(PKCE) + client_id/secret을 보내 id_token을 받고,
 *   tokeninfo로 다시 확인한다(aud가 우리 클라이언트 ID, iss가 accounts.google.com, exp가 지나지 않았는지).
 *   앱 개발 빌드의 안드로이드·iOS 클라이언트 ID(GOOGLE_OAUTH_NATIVE_CLIENT_IDS)는 secret 없이 바꾼다(설치형 앱 규칙).
 * - 카카오: https://kauth.kakao.com/oauth/token 에 code(+ code_verifier, 켜 두었으면 client_secret)를 보내 access_token을 받고,
 *   https://kapi.kakao.com/v2/user/me 로 회원번호·이메일·닉네임을 읽는다. 이메일은 is_email_valid·is_email_verified가 모두 참일 때만 믿는다.
 * - 돌아올 주소(redirect_uri)는 허용 목록(OAUTH_REDIRECT_URIS, 기본 http://localhost:8090)에 있을 때만 받는다.
 *   남이 가로챈 코드를 다른 주소로 바꿔 쓰는 것(코드 주입)을 막는다. 비교는 끝 '/'만 무시한 정확한 일치다.
 * - fetch는 주입한다(테스트가 가짜 제공자를 넣는다). 토큰·코드·secret은 로그와 오류 메시지에 넣지 않는다(상태 코드만).
 */

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
export const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
export const KAKAO_ME_URL = 'https://kapi.kakao.com/v2/user/me';
/** 웹 개발 서버(npm run web, 포트 8090) 주소. OAUTH_REDIRECT_URIS를 비우면 이것만 허용한다 */
export const DEFAULT_REDIRECT_URIS = ['http://localhost:8090'];
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** 제공자 확인 실패. kind: exchange(코드 교환), identity(신원 확인), config(설정 없음). status는 제공자 HTTP 상태 */
export class OAuthError extends Error {
  constructor(kind, status) {
    super(`oauth ${kind}${status ? ` ${status}` : ''}`);
    this.kind = kind;
    this.status = status ?? null;
  }
}

/** 돌아올 주소 비교용. 앞뒤 공백과 끝 '/'를 뗀다 */
export function normalizeRedirectUri(uri) {
  return String(uri ?? '').trim().replace(/\/+$/, '');
}

const list = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const clean = (raw) => {
  const v = String(raw ?? '').trim();
  return /^[\w.-]+$/.test(v) ? v : '';
};

/**
 * 서버 변수 → OAuth 설정. 값은 로그에 남기지 않는다.
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_NATIVE_CLIENT_IDS(쉼표)
 *   KAKAO_OAUTH_CLIENT_ID(REST API 키), KAKAO_OAUTH_CLIENT_SECRET(콘솔에서 켰을 때만)
 *   OAUTH_REDIRECT_URIS(쉼표, 비우면 http://localhost:8090)
 */
export function oauthOptionsFromEnv(env) {
  const redirects = list(env.OAUTH_REDIRECT_URIS).filter((u) => /^https?:\/\/[^\s/?#]+/.test(u) || /^[a-z][\w+.-]*:\/\//i.test(u));
  return {
    google: {
      clientId: clean(env.GOOGLE_OAUTH_CLIENT_ID),
      clientSecret: String(env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim(),
      nativeClientIds: list(env.GOOGLE_OAUTH_NATIVE_CLIENT_IDS).map(clean).filter(Boolean),
    },
    kakao: {
      clientId: clean(env.KAKAO_OAUTH_CLIENT_ID),
      clientSecret: String(env.KAKAO_OAUTH_CLIENT_SECRET ?? '').trim(),
    },
    redirectUris: redirects.length > 0 ? redirects : [...DEFAULT_REDIRECT_URIS],
  };
}

/** 시작 로그용 요약(값 없이 켜짐 여부만) */
export function describeOAuth(opts) {
  const c = createOAuthClient({ ...opts, fetch: async () => ({ ok: false, status: 0, text: async () => '' }) });
  return `구글 ${c.configured('google') ? '켜짐' : '꺼짐'}, 카카오 ${c.configured('kakao') ? '켜짐' : '꺼짐'}, 돌아올 주소 ${c.redirectUris.join(' ')}`;
}

/**
 * OAuth 확인기. fetch(url, {method, headers, body, signal}) → {ok, status, text()}. now는 id_token 만료 판정 시계.
 */
export function createOAuthClient({
  google = {},
  kakao = {},
  redirectUris = DEFAULT_REDIRECT_URIS,
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = 8000,
} = {}) {
  const g = {
    clientId: google.clientId ?? '',
    clientSecret: google.clientSecret ?? '',
    nativeClientIds: [...(google.nativeClientIds ?? [])],
  };
  const k = { clientId: kakao.clientId ?? '', clientSecret: kakao.clientSecret ?? '' };
  const allowed = new Set(redirectUris.map(normalizeRedirectUri).filter(Boolean));

  /** 요청 하나. 시간이 지나거나 닿지 못하면 OAuthError(kind) */
  async function request(kind, url, init) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) });
    } catch {
      throw new OAuthError(kind, 0);
    } finally {
      clearTimeout(timer);
    }
    let body = {};
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) throw new OAuthError(kind, res.status);
    return body && typeof body === 'object' ? body : {};
  }

  const form = (fields) =>
    Object.entries(fields)
      .filter(([, v]) => v != null && v !== '')
      .map(([key, v]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
      .join('&');

  const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' };

  async function google_({ code, codeVerifier, redirectUri, clientId }) {
    const native = clientId && clientId !== g.clientId && g.nativeClientIds.includes(clientId);
    const cid = native ? clientId : g.clientId;
    const tokens = await request('exchange', GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: form({
        grant_type: 'authorization_code',
        code,
        client_id: cid,
        client_secret: native ? undefined : g.clientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (typeof tokens.id_token !== 'string' || tokens.id_token.length === 0) throw new OAuthError('identity');
    const claims = await request('identity', `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(tokens.id_token)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const audOk = claims.aud === g.clientId || g.nativeClientIds.includes(claims.aud);
    const issOk = GOOGLE_ISSUERS.has(claims.iss);
    const exp = Number(claims.exp);
    if (!audOk || !issOk || !Number.isFinite(exp) || exp * 1000 <= now()) throw new OAuthError('identity');
    const subject = typeof claims.sub === 'string' ? claims.sub : '';
    if (!/^[\w-]{1,255}$/.test(subject)) throw new OAuthError('identity');
    return {
      subject,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      nickname: typeof claims.name === 'string' ? claims.name : typeof claims.given_name === 'string' ? claims.given_name : '',
    };
  }

  async function kakao_({ code, codeVerifier, redirectUri }) {
    const tokens = await request('exchange', KAKAO_TOKEN_URL, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: form({
        grant_type: 'authorization_code',
        client_id: k.clientId,
        client_secret: k.clientSecret || undefined,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });
    if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) throw new OAuthError('identity');
    const me = await request('identity', KAKAO_ME_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    const id = typeof me.id === 'number' || typeof me.id === 'string' ? String(me.id) : '';
    if (!/^\d{1,30}$/.test(id)) throw new OAuthError('identity');
    const acc = me.kakao_account && typeof me.kakao_account === 'object' ? me.kakao_account : {};
    const nickname = acc.profile?.nickname ?? me.properties?.nickname ?? '';
    return {
      subject: id,
      email: typeof acc.email === 'string' ? acc.email : null,
      emailVerified: acc.is_email_valid === true && acc.is_email_verified === true,
      nickname: typeof nickname === 'string' ? nickname : '',
    };
  }

  /** 이 제공자 키가 서버에 있는지. 구글 웹은 secret까지 있어야 한다 */
  function configured(provider) {
    if (provider === 'google') return g.clientId.length > 0 && g.clientSecret.length > 0;
    if (provider === 'kakao') return k.clientId.length > 0;
    return false;
  }

  return {
    redirectUris: [...allowed],
    configured,
    redirectAllowed(uri) {
      const n = normalizeRedirectUri(uri);
      return n.length > 0 && allowed.has(n);
    },
    /** 인가 코드 → 제공자 신원 {subject, email, emailVerified, nickname}. 실패하면 OAuthError */
    async exchange(provider, input) {
      if (!configured(provider)) throw new OAuthError('config');
      return provider === 'google' ? google_(input) : kakao_(input);
    },
  };
}
