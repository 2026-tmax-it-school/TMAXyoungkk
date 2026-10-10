import type { AccountPublic, AuthAck, AuthFail, AuthProvider, AuthResult, FetchLike, KV, MockMail } from '../../core/ports';

/**
 * 계정 서버 인증(WP1 소유, 2026-10-10). server/auth.mjs(/auth/…)와 짝이다.
 * EXPO_PUBLIC_API_URL(없으면 EXPO_PUBLIC_SYNC_URL)이 있을 때 registry가 고른다. 없으면 이 기기 모의 인증(local)이다.
 *
 * - 세션 토큰(32바이트, Bearer)은 서버가 로그인·인증·소셜 성공 때 준다. 계정 id별로 이 기기 KV(AsyncStorage)에 둔다.
 *   expo-secure-store를 쓰지 않아 토큰이 암호화되지 않은 앱 저장소에 있다(웹은 localStorage). 추적표 한계 항목이다.
 *   서버는 토큰 해시만 두고 30일 동안 안 쓰면 끊는다(쓸 때마다 연장).
 * - 서버가 세션을 모르면(만료·다른 기기에서 비밀번호 재설정·탈퇴) 401 → invalidToken이다. 앱 시작 때 checkSession이 보고
 *   다시 로그인하라고 알린다(bootstrap).
 * - 서버에 닿지 못하면 providerFailed다. checkSession은 unreachable로 이 기기 세션을 그대로 둔다(오프라인에서도 앱을 쓴다).
 * - 메일은 서버가 보내지 않는다. 개발 서버(devOutbox)면 GET /auth/outbox를 앱 모의 메일함으로 보여 준다. 닫혀 있으면 빈 목록이다.
 * - 같은 이메일 소셜 연결은 서버가 연결 확인 메일로만 토큰을 준다. 개발 서버면 그 메일을 대신 열어 26 확인 화면으로 넘긴다.
 *   모의 소셜 자체가 개발 서버(AUTH_DEV_OUTBOX=1 등)에서만 열린다. 아니면 404 → providerFailed다.
 * - 게스트 승격 가입은 이 기기 토큰을 같이 보낸다(서버가 같은 게스트인지 본다). 토큰 원문은 서버에 해시로만 남는다.
 * - 비밀번호·토큰은 로그에 남기지 않는다.
 */

const UNREACHABLE = '계정 서버에 닿지 못했습니다. 잠시 뒤 다시 시도해 주세요';
const SESSION_GONE = '로그인이 만료됐습니다. 다시 로그인해 주세요';
const TOKENS_KEY = 'tokens';

const FAILS: readonly AuthFail[] = [
  'duplicateEmail',
  'weakPassword',
  'locked',
  'deviceLimited',
  'unverified',
  'badCredentials',
  'providerFailed',
  'linkRequired',
  'nicknameTaken',
  'invalidToken',
  'notFound',
];

type Reply = { status: number; body: Record<string, unknown> } | null;

function asFail(code: unknown): AuthFail {
  return FAILS.includes(code as AuthFail) ? (code as AuthFail) : 'providerFailed';
}

/** 서버 응답 본문 → AuthResult. 토큰은 빼고 돌려준다 */
function toResult(r: Reply): AuthResult {
  if (!r || typeof r.body.ok !== 'boolean') return { ok: false, code: 'providerFailed', detail: UNREACHABLE };
  const b = r.body;
  if (b.ok === true) {
    if (!b.account || typeof b.account !== 'object') return { ok: false, code: 'providerFailed', detail: UNREACHABLE };
    return { ok: true, account: b.account as AccountPublic };
  }
  return {
    ok: false,
    code: asFail(b.code),
    ...(typeof b.detail === 'string' ? { detail: b.detail } : {}),
    ...(typeof b.retryAt === 'number' ? { retryAt: b.retryAt } : {}),
    ...(typeof b.linkToken === 'string' ? { linkToken: b.linkToken } : {}),
    ...(Array.isArray(b.violations) ? { violations: b.violations.filter((v): v is string => typeof v === 'string') } : {}),
  };
}

function toAck(r: Reply): AuthAck & { violations?: string[] } {
  if (!r || typeof r.body.ok !== 'boolean') return { ok: false, code: 'providerFailed', detail: UNREACHABLE };
  if (r.body.ok === true) return { ok: true };
  const res = toResult(r);
  return res.ok ? { ok: true } : { ok: false, code: res.code, detail: res.detail, ...(res.violations ? { violations: res.violations } : {}) };
}

export function createHttpAuth(opts: { url: string; fetch: FetchLike; kv: KV; timeoutMs?: number }): AuthProvider {
  const base = opts.url.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let cache: Record<string, string> | undefined;

  async function tokens(): Promise<Record<string, string>> {
    if (cache) return cache;
    try {
      const raw = await opts.kv.get(TOKENS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      cache = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      cache = {};
    }
    return cache;
  }

  async function saveTokens(next: Record<string, string>): Promise<void> {
    cache = next;
    await opts.kv.set(TOKENS_KEY, JSON.stringify(next));
  }

  async function tokenOf(accountId: string | undefined): Promise<string | undefined> {
    return accountId ? (await tokens())[accountId] : undefined;
  }

  async function dropToken(accountId?: string): Promise<void> {
    if (accountId == null) return saveTokens({});
    const { [accountId]: _gone, ...rest } = await tokens();
    await saveTokens(rest);
  }

  /** 서버 응답. 닿지 못했거나 JSON이 아니면 null */
  async function call(path: string, init: { method?: string; body?: unknown; token?: string; timeoutMs?: number } = {}): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        opts.fetch(`${base}${path}`, {
          method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
          headers,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), init.timeoutMs ?? timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      const text = await res.text();
      const body: unknown = text ? JSON.parse(text) : {};
      return { status: res.status, body: body && typeof body === 'object' ? (body as Record<string, unknown>) : {} };
    } catch {
      return null;
    }
  }

  /** 로그인 성공 응답이면 그 계정의 세션 토큰을 둔다 */
  async function keep(r: Reply): Promise<AuthResult> {
    const result = toResult(r);
    if (result.ok && typeof r?.body.token === 'string') {
      await saveTokens({ ...(await tokens()), [result.account.accountId]: r.body.token });
    }
    return result;
  }

  /** 개발용 보낸편지함(GET /auth/outbox). 닫혀 있거나 닿지 못하면 빈 목록 */
  async function readOutbox(): Promise<MockMail[]> {
    const r = await call('/auth/outbox');
    const mails = r?.status === 200 && Array.isArray(r.body.mails) ? (r.body.mails as MockMail[]) : [];
    return mails.map((m) => ({
      id: String(m.id),
      to: String(m.to),
      subject: String(m.subject),
      token: String(m.token),
      sentAt: Number(m.sentAt),
      invalidated: m.invalidated === true,
      kind: m.kind === 'reset' || m.kind === 'link' ? m.kind : 'verify',
    }));
  }

  const sessionGone = (): AuthResult => ({ ok: false, code: 'invalidToken', detail: SESSION_GONE });

  return {
    id: 'server',

    signUp: async (input) => toResult(await call('/auth/signup', { body: input })),

    resendVerification: async (email) => toAck(await call('/auth/resend', { body: { email } })),

    verifyEmail: async (token) => keep(await call('/auth/verify', { body: { token } })),

    signIn: async (input) => keep(await call('/auth/signin', { body: input })),

    async social(input) {
      const link = input.linkToAccountId != null;
      const token = link ? await tokenOf(input.linkToAccountId) : undefined;
      if (link && !token) return { ok: false, code: 'notFound', detail: '지금 계정을 찾지 못했습니다. 다시 로그인해 주세요' };
      const r = await call('/auth/social', {
        body: {
          provider: input.provider,
          scenario: input.scenario,
          deviceToken: input.deviceToken,
          ...(input.providerEmail != null ? { providerEmail: input.providerEmail } : {}),
          ...(link ? { link: true } : {}),
        },
        token,
      });
      const result = await keep(r);
      // 같은 이메일: 서버는 연결 확인 토큰을 응답에 싣지 않고 그 이메일로 메일만 보낸다(가입 여부를 숨긴다).
      // 개발 서버면 그 메일을 앱 모의 메일함(보낸편지함)에서 대신 열어 확인 단계로 넘긴다. 메일이 없으면 서버 문구 그대로다
      if (!result.ok && result.code === 'linkRequired' && !result.linkToken && input.scenario === 'sameEmail' && input.providerEmail) {
        const to = input.providerEmail.trim().toLowerCase();
        const mail = (await readOutbox())
          .filter((m) => m.kind === 'link' && !m.invalidated && m.to.toLowerCase() === to)
          .sort((a, b) => b.sentAt - a.sentAt)[0];
        if (mail) {
          return {
            ...result,
            linkToken: mail.token,
            detail: `${to} 계정으로 온 연결 확인 메일을 열었습니다(개발용 메일함). 이 계정에 소셜 로그인을 연결할까요?`,
          };
        }
      }
      return result;
    },

    confirmLink: async ({ linkToken, accept }) => keep(await call('/auth/social/confirm', { body: { linkToken, accept } })),

    async isNicknameTaken(nickname, exceptAccountId) {
      const r = await call(`/auth/nickname?nickname=${encodeURIComponent(nickname)}`, { token: await tokenOf(exceptAccountId) });
      // 닿지 못하면 막지 않는다. 저장할 때 서버가 다시 본다
      return r?.body.taken === true;
    },

    async updateProfile(accountId, profile) {
      const token = await tokenOf(accountId);
      if (!token) return sessionGone();
      return toResult(await call('/auth/profile', { body: { profile }, token }));
    },

    async getAccount(accountId) {
      const token = await tokenOf(accountId);
      if (!token) return sessionGone();
      const r = toResult(await call('/auth/session', { token }));
      if (r.ok && r.account.accountId !== accountId) return { ok: false, code: 'notFound' };
      return r;
    },

    async deleteAccount(accountId) {
      const token = await tokenOf(accountId);
      if (!token) return { ok: false, code: 'invalidToken' };
      const r = await call('/auth/delete', { body: {}, token });
      if (r?.body.ok === true) {
        await dropToken(accountId);
        return { ok: true };
      }
      return { ok: false, code: r ? asFail(r.body.code) : 'providerFailed' };
    },

    outbox: readOutbox,

    async reset() {
      // 시연 리셋은 이 기기만 비운다(서버 계정은 그대로). 세션 토큰을 지운다
      await saveTokens({});
      await opts.kv.remove(TOKENS_KEY);
    },

    async signOut(accountId) {
      const token = await tokenOf(accountId);
      await dropToken(accountId);
      if (token) await call('/auth/signout', { body: {}, token });
    },

    async checkSession(accountId) {
      const token = await tokenOf(accountId);
      if (!token) return 'expired';
      // 앱 시작을 오래 붙잡지 않게 짧게 기다린다
      const r = await call('/auth/session', { token, timeoutMs: Math.min(timeoutMs, 5000) });
      if (!r) return 'unreachable';
      if (r.status === 401) {
        await dropToken(accountId);
        return 'expired';
      }
      if (r.body.ok === true) {
        const acc = r.body.account as AccountPublic | undefined;
        if (acc?.accountId === accountId) return 'ok';
        await dropToken(accountId);
        return 'expired';
      }
      return 'unreachable';
    },

    requestPasswordReset: async (email) => toAck(await call('/auth/password/reset', { body: { email } })),

    confirmPasswordReset: async (input) => toAck(await call('/auth/password/confirm', { body: input })),
  };
}
