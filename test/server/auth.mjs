/**
 * 계정·로그인 서버(WP2 소유, 2026-10-10). sync-server.mjs가 /auth/… 경로를 여기로 넘긴다.
 * 앱의 HTTP 인증 제공자(src/services/auth/http.ts)와 짝이고, 결과 모양은 앱 AuthProvider 계약(AuthResult)과 같다.
 *
 * 저장소는 둘이다. 메서드 이름과 결과가 같다.
 * - 메모리(createMemoryAuthStore): DATABASE_URL이 없을 때. 서버를 끄면 사라진다
 * - PostgreSQL(server/db/auth-store.mjs): 마이그레이션 002_auth.sql의 auth_* 표
 *
 * 규칙
 * - 비밀번호: node:crypto scrypt(사람마다 16바이트 salt), 비교는 timingSafeEqual. 규칙은 앱 core/auth와 같다(8자 이상·영문·숫자).
 *   없는 이메일로 로그인해도 같은 계산을 한 번 해서 응답 시간으로 가입 여부가 드러나지 않게 한다
 * - 세션: 32바이트 난수 토큰(Authorization: Bearer). 서버에는 SHA-256만 둔다. 쓸 때마다 30일 뒤로 민다(앱 SESSION_TTL_MS)
 * - 인증·재설정·연동 메일 토큰도 해시만 둔다. 재발송하면 이전 인증 토큰은 무효다. 한 번 쓰면 끝이다
 * - 시도 제한: 이메일 기준 5회 연속 실패면 10분 잠금(없는 이메일도 똑같이 센다), IP 기준 10분 20회, 이메일+IP 10분 10회.
 *   가입·재발송·재설정 메일은 IP 기준 10분 10통
 * - 오류 문구는 가입 여부를 드러내지 않는다. 예외는 앱 화면이 원래 쓰는 가입 때 '이미 가입한 이메일'뿐이다
 *   (재발송·재설정 요청은 없는 이메일이어도 ok)
 * - 게스트 승격: 받은 userId를 유지한다. 기기 토큰 해시(upgradeProof)를 같이 두고, 인증 전 가입은 같은 기기만 대체한다
 * - 탈퇴: 행은 남기고 이메일·닉네임·비밀번호·프로필을 비운다(익명화). 세션·토큰·소셜 신원은 지운다. userId는 남는다
 *   (여행방 로그의 member/anonymize는 앱이 따로 보낸다)
 * - 소셜(모의): 앱 26 동의 화면의 scenario(ok·fail·sameEmail)를 그대로 받는다. 제공자 신원은 기기 토큰의 해시로 흉내 낸다
 *   (기기 하나에 제공자 신원 하나). 같은 이메일은 늘 같은 linkRequired 응답이고, 연동 확인 토큰은 그 이메일로 보낸
 *   연결 확인 메일(보낸편지함)에만 있다 → /auth/social/confirm. 모의 소셜은 mockSocial(기본 devOutbox)일 때만 열고 아니면 404다
 * - 메일은 보내지 않는다(SMTP 없음). 개발용 보낸편지함에만 쌓고, devOutbox일 때만 GET /auth/outbox로 읽는다
 *   (앱 모의 메일함이 그대로 돈다). 실제 메일 발송은 추후 과제다
 * - 비밀번호·토큰·요청 본문은 로그에 남기지 않는다
 *
 *   POST /auth/signup            {email, password, nickname, userId?, deviceToken?(userId면 필수)} → AuthResult(토큰 없음, 인증 메일 발송)
 *   POST /auth/verify            {token}                                      → AuthResult + {token, expiresAt}
 *   POST /auth/resend            {email}                                      → {ok:true}
 *   POST /auth/signin            {email, password, deviceToken?}              → AuthResult + {token, expiresAt}
 *   POST /auth/signout           Bearer                                       → {ok:true}
 *   GET  /auth/session           Bearer                                       → AuthResult + {expiresAt} | 401
 *   GET  /auth/nickname?nickname=…  (Bearer면 자기 계정은 뺀다)              → {taken}
 *   POST /auth/profile           Bearer {profile}                             → AuthResult
 *   POST /auth/delete            Bearer                                       → {ok:true}
 *   POST /auth/password/reset    {email}                                      → {ok:true}
 *   POST /auth/password/confirm  {token, password}                            → {ok:true} | 실패
 *   POST /auth/social            {provider, scenario, deviceToken, providerEmail?, link?}(link면 Bearer) → AuthResult(+토큰)
 *   POST /auth/social/confirm    {linkToken(연결 확인 메일), accept}          → AuthResult(+토큰)
 *   GET  /auth/outbox                                                         → {mails} | 404(devOutbox 아님)
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/* ---------- 앱과 같은 값(src/core/constants.ts, tests/wp2-auth가 맞춰 본다) ---------- */

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const SESSION_TTL_MS = 30 * DAY;
export const PASSWORD_MIN_LENGTH = 8;
export const NICKNAME_MAX = 12;
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_LOCK_MS = 10 * MIN;
/** IP 기준 로그인 시도(앱의 기기 기준 10분 20회와 같은 값) */
export const IP_ATTEMPT_LIMIT = 20;
export const ATTEMPT_WINDOW_MS = 10 * MIN;
/** 이메일+IP 기준 로그인 시도 */
export const EMAIL_IP_ATTEMPT_LIMIT = 10;
/** IP 기준 메일 보내기(가입·재발송·재설정) */
export const MAIL_LIMIT = 10;
export const VERIFY_TTL_MS = DAY;
export const RESET_TTL_MS = 30 * MIN;
export const LINK_TTL_MS = 10 * MIN;
/** 개발용 보낸편지함에 두는 메일 수 */
export const OUTBOX_LIMIT = 200;

const PASSWORD_MAX = 256;
const EMAIL_MAX = 254;
const IMAGE_URI_MAX = 4096;
const TAGS_MAX = 30;

const PROVIDER_LABEL = { kakao: '카카오', google: '구글' };
const MAIL_SUBJECT = { verify: 'Young Trip 이메일 인증', reset: 'Young Trip 비밀번호 재설정', link: 'Young Trip 소셜 로그인 연결 확인' };
/** 같은 이메일 연결 요청에는 계정이 있든 없든 이 응답 하나만 준다(가입 여부를 드러내지 않는다) */
const LINK_SENT = (email) =>
  `${email}로 가입한 계정이 있으면 연결 확인 메일을 보냈습니다. 메일에서 확인해야 연결됩니다. 계정이 없으면 정상을 골라 새 소셜 계정을 만들어 주세요`;
const PROVIDER_SUBJECT = { kakao: '카카오가', google: '구글이' };

/* ---------- 순수 규칙(앱 core/auth와 같다) ---------- */

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isEmailLike(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

export function passwordViolations(password) {
  const p = String(password ?? '');
  const out = [];
  if (p.length < PASSWORD_MIN_LENGTH) out.push(`${PASSWORD_MIN_LENGTH}자 이상`);
  if (!/[A-Za-z]/.test(p)) out.push('영문 포함');
  if (!/[0-9]/.test(p)) out.push('숫자 포함');
  return out;
}

export function nicknameProblem(nickname) {
  const n = String(nickname ?? '').trim();
  if (n.length === 0) return '닉네임을 입력해 주세요';
  if (n.length > NICKNAME_MAX) return `닉네임은 ${NICKNAME_MAX}자까지입니다`;
  return null;
}

const nickKey = (n) => String(n ?? '').trim().toLowerCase();

/* ---------- 비밀번호·토큰 ---------- */

const scryptAsync = (password, salt, keylen, opts) =>
  new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (e, key) => (e ? reject(e) : resolve(key))));

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** 'scrypt$N$r$p$salt$hash'. cost는 테스트가 줄여 쓴다(기본 16384) */
export async function hashPassword(password, { cost = 16384 } = {}) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, 64, { N: cost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${cost}$8$1$${b64(salt)}$${b64(key)}`;
}

/** 저장한 값과 비교한다. 모양이 틀리면 거짓 */
export async function verifyPassword(password, stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(String(stored ?? ''));
  if (!m) return false;
  const [, n, r, p, saltB64, hashB64] = m;
  const want = Buffer.from(hashB64, 'base64url');
  const got = await scryptAsync(String(password), Buffer.from(saltB64, 'base64url'), want.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

const newId = (prefix) => `${prefix}-${randomBytes(12).toString('base64url')}`;

/* ---------- 메모리 저장소 ---------- */

/**
 * 메모리 저장소. PostgreSQL 저장소(server/db/auth-store.mjs)와 같은 메서드다. 동기로 돌려주고 서비스가 await한다.
 * 계정 rec: {accountId, userId, email, nickname, passwordHash, verifiedAt, providers, profile, createdAt, deletedAt, upgradeProof}
 */
export function createMemoryAuthStore() {
  let accounts = new Map();
  let identities = new Map();
  let sessions = new Map();
  let tokens = new Map();
  let attempts = new Map();
  const live = () => [...accounts.values()].filter((a) => a.deletedAt == null);
  const copy = (a) => (a ? structuredClone(a) : null);
  const conflictOf = (rec, exceptId) => {
    for (const a of live()) {
      if (a.accountId === exceptId) continue;
      if (rec.email != null && a.email != null && a.email.toLowerCase() === rec.email.toLowerCase()) return 'email';
      if (rec.nickname != null && a.nickname != null && nickKey(a.nickname) === nickKey(rec.nickname)) return 'nickname';
      if (rec.userId != null && a.userId === rec.userId) return 'userId';
    }
    return null;
  };
  return {
    kind: 'memory',
    accountById: (id) => copy(live().find((a) => a.accountId === id)),
    accountByEmail: (email) => copy(live().find((a) => a.email != null && a.email.toLowerCase() === email.toLowerCase())),
    accountByUserId: (userId) => copy(live().find((a) => a.userId === userId)),
    nicknameTaken: (nickname, exceptId) => live().some((a) => a.accountId !== exceptId && a.nickname != null && nickKey(a.nickname) === nickKey(nickname)),
    insertAccount(rec) {
      const c = conflictOf(rec);
      if (c) return c;
      accounts.set(rec.accountId, structuredClone({ deletedAt: null, ...rec }));
      return 'ok';
    },
    updateAccount(id, patch) {
      const cur = accounts.get(id);
      if (!cur) return 'ok';
      const next = { ...cur, ...structuredClone(patch) };
      if (next.deletedAt == null) {
        const c = conflictOf({ email: patch.email, nickname: patch.nickname }, id);
        if (c) return c;
      }
      accounts.set(id, next);
      return 'ok';
    },
    removeAccount(id) {
      accounts.delete(id);
      for (const [k, v] of identities) if (v === id) identities.delete(k);
      for (const [k, v] of sessions) if (v.accountId === id) sessions.delete(k);
      for (const [k, v] of tokens) if (v.accountId === id) tokens.delete(k);
    },
    identity: (provider, subject) => identities.get(`${provider}\u0000${subject}`) ?? null,
    putIdentity(provider, subject, accountId) {
      const k = `${provider}\u0000${subject}`;
      if (identities.has(k) && identities.get(k) !== accountId) return 'conflict';
      identities.set(k, accountId);
      return 'ok';
    },
    dropIdentities(accountId) {
      for (const [k, v] of identities) if (v === accountId) identities.delete(k);
    },
    putSession(s) {
      sessions.set(s.tokenHash, { ...s });
    },
    session: (hash) => (sessions.has(hash) ? { ...sessions.get(hash) } : null),
    touchSession(hash, lastUsedAt, expiresAt) {
      const s = sessions.get(hash);
      if (s) sessions.set(hash, { ...s, lastUsedAt, expiresAt });
    },
    dropSession(hash) {
      sessions.delete(hash);
    },
    dropSessions(accountId) {
      for (const [k, v] of sessions) if (v.accountId === accountId) sessions.delete(k);
    },
    putToken(t) {
      tokens.set(t.tokenHash, { ...t, usedAt: null });
    },
    useToken(hash, kind, now) {
      const t = tokens.get(hash);
      if (!t || t.kind !== kind || t.usedAt != null || t.expiresAt <= now) return null;
      t.usedAt = now;
      return { accountId: t.accountId, data: structuredClone(t.data ?? {}) };
    },
    dropTokens(accountId, kind) {
      for (const [k, v] of tokens) if (v.accountId === accountId && (kind == null || v.kind === kind)) tokens.delete(k);
    },
    hit(key, now, windowMs) {
      const cur = attempts.get(key);
      const fresh = !cur || cur.windowStart <= now - windowMs;
      const next = fresh ? { count: 1, windowStart: now, lockedUntil: cur?.lockedUntil ?? null } : { ...cur, count: cur.count + 1 };
      attempts.set(key, next);
      return { count: next.count, windowStart: next.windowStart };
    },
    /**
     * 연속 실패 카운터를 비밀번호 확인 전에 먼저 올린다(예약). 동기로 한 번에 올리므로 동시에 보낸 요청도 하나씩 센다.
     * 잠금 중이면 count만 더 올라간다(max보다 커진다). count가 max가 되는 요청이 잠금을 건다. 잠금이 풀린 뒤엔 1부터 다시
     */
    bumpFail(key, now, max, lockMs) {
      const v = attempts.get(key);
      let next;
      if (v && v.lockedUntil != null && v.lockedUntil > now) next = { ...v, count: v.count + 1 };
      else {
        const count = v && v.lockedUntil == null ? v.count + 1 : 1;
        next = { count, windowStart: now, lockedUntil: count >= max ? now + lockMs : null };
      }
      attempts.set(key, next);
      return { count: next.count, lockedUntil: next.lockedUntil };
    },
    setLock(key, { fails, lockedUntil }, now) {
      attempts.set(key, { count: fails, windowStart: now, lockedUntil: lockedUntil ?? null });
    },
    purge(now) {
      for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k);
      for (const [k, v] of tokens) if (v.expiresAt <= now || v.usedAt != null) tokens.delete(k);
      for (const [k, v] of attempts) {
        if (v.windowStart <= now - DAY && (v.lockedUntil == null || v.lockedUntil <= now)) attempts.delete(k);
      }
    },
    reset() {
      accounts = new Map();
      identities = new Map();
      sessions = new Map();
      tokens = new Map();
      attempts = new Map();
    },
  };
}

/* ---------- 서비스 ---------- */

function toPublic(a) {
  const profile = a.profile ?? {};
  return {
    accountId: a.accountId,
    userId: a.userId,
    email: a.email ?? '',
    nickname: a.nickname ?? '',
    verified: a.verifiedAt != null,
    providers: [...(a.providers ?? [])],
    profile: { ...profile, nickname: profile.nickname ?? a.nickname ?? '', tags: [...(Array.isArray(profile.tags) ? profile.tags : [])] },
  };
}

/** 받은 프로필 조각에서 아는 열만 남긴다. 너무 긴 이미지 주소(웹 data: 등)는 서버에 두지 않는다 */
function cleanProfilePatch(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  if (typeof p.nickname === 'string') out.nickname = p.nickname.trim();
  if (typeof p.imageUri === 'string' && p.imageUri.length <= IMAGE_URI_MAX) out.imageUri = p.imageUri;
  if (typeof p.imageBytes === 'number' && Number.isFinite(p.imageBytes)) out.imageBytes = p.imageBytes;
  if (typeof p.imageCompressed === 'boolean') out.imageCompressed = p.imageCompressed;
  if (Array.isArray(p.tags)) out.tags = p.tags.filter((t) => typeof t === 'string' && t.length <= 40).slice(0, TAGS_MAX);
  return out;
}

const fail = (status, code, detail, extra = {}) => ({ status, body: { ok: false, code, ...(detail ? { detail } : {}), ...extra } });
const okBody = (body = {}) => ({ status: 200, body: { ok: true, ...body } });
const BAD_LOGIN = '이메일이나 비밀번호가 맞지 않습니다';
const SESSION_GONE = '로그인이 만료됐습니다. 다시 로그인해 주세요';

/**
 * 인증 서비스. store는 메모리 또는 PostgreSQL 저장소, now는 시계(테스트 주입), devOutbox면 GET /auth/outbox를 연다.
 * mockSocial(기본 devOutbox와 같다)이면 모의 소셜 경로를 연다. 아니면 /auth/social…은 404다(실제 제공자 검증이 없기 때문).
 * passwordCost는 scrypt N(테스트만 줄인다).
 */
export function createAuthService({
  store = createMemoryAuthStore(),
  now = () => Date.now(),
  devOutbox = false,
  mockSocial = devOutbox,
  passwordCost = 16384,
  log = () => {},
} = {}) {
  /** 개발용 보낸편지함(메모리). 토큰 원문은 여기에만 있고 DB에는 해시만 간다 */
  let outbox = [];
  const dummyHash = hashPassword('dummy-password-0', { cost: passwordCost });

  function sendMail(kind, to, token) {
    if (kind === 'verify') for (const m of outbox) if (m.to === to && m.kind === 'verify') m.invalidated = true;
    outbox.push({
      id: newId('mail'),
      kind,
      to,
      subject: MAIL_SUBJECT[kind],
      token,
      sentAt: now(),
      invalidated: false,
    });
    if (outbox.length > OUTBOX_LIMIT) outbox = outbox.slice(-OUTBOX_LIMIT);
  }

  async function issueMailToken(kind, acc) {
    const t = newToken();
    if (kind === 'verify') await store.dropTokens(acc.accountId, 'verify');
    await store.putToken({
      tokenHash: tokenHash(t),
      kind,
      accountId: acc.accountId,
      data: {},
      createdAt: now(),
      expiresAt: now() + (kind === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS),
    });
    sendMail(kind, acc.email, t);
  }

  async function openSession(acc, deviceToken) {
    const token = newToken();
    const at = now();
    const expiresAt = at + SESSION_TTL_MS;
    await store.putSession({
      tokenHash: tokenHash(token),
      accountId: acc.accountId,
      deviceToken: typeof deviceToken === 'string' ? deviceToken.slice(0, 64) : null,
      createdAt: at,
      lastUsedAt: at,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Bearer 토큰 → {account, hash, expiresAt}. 만료면 지우고 null. 쓸 때마다 30일 뒤로 민다 */
  async function authed(headers) {
    const m = /^Bearer ([\w-]{20,100})$/.exec(String(headers?.authorization ?? ''));
    if (!m) return null;
    const hash = tokenHash(m[1]);
    const s = await store.session(hash);
    if (!s) return null;
    const at = now();
    if (s.expiresAt <= at) {
      await store.dropSession(hash);
      return null;
    }
    const acc = await store.accountById(s.accountId);
    if (!acc) {
      await store.dropSession(hash);
      return null;
    }
    const expiresAt = at + SESSION_TTL_MS;
    await store.touchSession(hash, at, expiresAt);
    return { account: acc, hash, expiresAt };
  }

  /** 시도 제한 한 칸. 넘으면 풀리는 시각 */
  async function limited(key, limit) {
    const r = await store.hit(key, now(), ATTEMPT_WINDOW_MS);
    return r.count > limit ? r.windowStart + ATTEMPT_WINDOW_MS : null;
  }

  async function freeNickname(base) {
    if (!(await store.nicknameTaken(base))) return base;
    for (let i = 2; i < 10_000; i += 1) if (!(await store.nicknameTaken(`${base}${i}`))) return `${base}${i}`;
    return `${base}${randomBytes(3).toString('hex')}`;
  }

  async function boundFail(provider, otherId) {
    const other = await store.accountById(otherId);
    return fail(409, 'duplicateEmail', `이 ${PROVIDER_LABEL[provider]} 계정은 이미 다른 Young Trip 계정(${other?.nickname ?? '알 수 없음'})에 묶여 있어 연결할 수 없습니다`);
  }

  async function addProvider(acc, provider, subject) {
    const put = await store.putIdentity(provider, subject, acc.accountId, now());
    if (put !== 'ok') return boundFail(provider, await store.identity(provider, subject));
    const providers = acc.providers.includes(provider) ? acc.providers : [...acc.providers, provider];
    await store.updateAccount(acc.accountId, { providers });
    return null;
  }

  const routes = {
    async 'POST signup'({ body, ip }) {
      const email = normalizeEmail(body.email);
      if (!isEmailLike(email) || email.length > EMAIL_MAX) return fail(400, 'badCredentials', '이메일 형식이 아닙니다');
      const password = String(body.password ?? '');
      const violations = passwordViolations(password);
      if (violations.length > 0 || password.length > PASSWORD_MAX) {
        return fail(400, 'weakPassword', '비밀번호 규칙을 지켜 주세요', { violations: violations.length > 0 ? violations : [`${PASSWORD_MAX}자 이하`] });
      }
      const nickname = String(body.nickname ?? '').trim();
      const nickProblem = nicknameProblem(nickname);
      if (nickProblem) return fail(400, 'badCredentials', nickProblem);
      const userId = typeof body.userId === 'string' && /^[\w-]{1,100}$/.test(body.userId) ? body.userId : undefined;
      // 게스트 승격 확인값. 게스트 userId는 여행방 로그로 남에게 보이므로, 기기 토큰(이 기기에만 있다)의 해시로 같은 게스트인지 본다
      const device = typeof body.deviceToken === 'string' && body.deviceToken.length >= 8 && body.deviceToken.length <= 200 ? body.deviceToken : null;
      if (userId && !device) return fail(400, 'badCredentials', '게스트 확인 정보가 없습니다. 앱을 다시 열어 주세요');
      const upgradeProof = userId ? tokenHash(`guest:${device}`) : null;
      const retryAt = await limited(`mail:${ip}`, MAIL_LIMIT);
      if (retryAt) return fail(429, 'deviceLimited', '잠시 뒤 다시 시도해 주세요', { retryAt });

      // 게스트 승격은 userId를 유지한다(게스트 하나에 계정 하나). 인증을 마친 계정이 있으면 거부하고,
      // 아직 인증하지 않은 가입은 같은 기기(확인값이 같다)일 때만 이번 가입으로 대체한다(앱 모의 인증과 같은 규칙).
      // 다른 기기에서 같은 userId로 온 가입은 남의 가입을 지우지 않고 거부한다. 인증 기한(1일)이 지난 가입은 누구든 대체한다
      const prior = userId ? await store.accountByUserId(userId) : null;
      if (prior && (prior.verifiedAt != null || prior.passwordHash == null)) {
        return fail(409, 'duplicateEmail', '이 게스트는 이미 계정으로 승격했습니다. 그 계정으로 로그인해 주세요');
      }
      if (prior && prior.upgradeProof !== upgradeProof && now() - prior.createdAt < VERIFY_TTL_MS) {
        return fail(409, 'duplicateEmail', '이 게스트로 진행 중인 가입이 있습니다. 처음 가입한 기기에서 인증을 마쳐 주세요');
      }
      const same = await store.accountByEmail(email);
      if (same && same.accountId !== prior?.accountId) {
        return fail(409, 'duplicateEmail', '이미 가입한 이메일입니다. 로그인하거나 인증 메일을 다시 받아 주세요');
      }
      if (await store.nicknameTaken(nickname, prior?.accountId)) return fail(409, 'nicknameTaken', '이미 쓰는 닉네임입니다');
      if (prior) {
        await store.removeAccount(prior.accountId);
        for (const m of outbox) if (m.to === prior.email) m.invalidated = true;
      }
      const rec = {
        accountId: newId('acc'),
        userId: userId ?? newId('u'),
        email,
        nickname,
        passwordHash: await hashPassword(password, { cost: passwordCost }),
        verifiedAt: null,
        providers: ['email'],
        profile: { nickname, tags: [] },
        createdAt: now(),
        deletedAt: null,
        upgradeProof,
      };
      const ins = await store.insertAccount(rec);
      if (ins === 'email') return fail(409, 'duplicateEmail', '이미 가입한 이메일입니다. 로그인하거나 인증 메일을 다시 받아 주세요');
      if (ins === 'nickname') return fail(409, 'nicknameTaken', '이미 쓰는 닉네임입니다');
      if (ins !== 'ok') return fail(409, 'duplicateEmail', '이 게스트는 이미 계정으로 승격했습니다. 그 계정으로 로그인해 주세요');
      await issueMailToken('verify', rec);
      return okBody({ account: toPublic(rec) });
    },

    async 'POST resend'({ body, ip }) {
      const email = normalizeEmail(body.email);
      if (!isEmailLike(email)) return fail(400, 'badCredentials', '이메일 형식이 아닙니다');
      const retryAt = await limited(`mail:${ip}`, MAIL_LIMIT);
      if (retryAt) return fail(429, 'deviceLimited', '잠시 뒤 다시 시도해 주세요', { retryAt });
      const acc = await store.accountByEmail(email);
      // 없는 이메일·인증을 마친 계정이어도 같은 응답이다(가입 여부를 드러내지 않는다)
      if (acc && acc.verifiedAt == null && acc.passwordHash != null) await issueMailToken('verify', acc);
      return okBody();
    },

    async 'POST verify'({ body }) {
      const used = await store.useToken(tokenHash(String(body.token ?? '')), 'verify', now());
      if (!used) return fail(400, 'invalidToken', '쓸 수 없는 인증 링크입니다. 가장 최근 메일로 인증해 주세요');
      const acc = await store.accountById(used.accountId);
      if (!acc) return fail(400, 'invalidToken', '쓸 수 없는 인증 링크입니다. 가장 최근 메일로 인증해 주세요');
      await store.updateAccount(acc.accountId, { verifiedAt: now() });
      for (const m of outbox) if (m.to === acc.email && m.kind === 'verify') m.invalidated = true;
      const fresh = await store.accountById(acc.accountId);
      const s = await openSession(fresh, body.deviceToken);
      return okBody({ account: toPublic(fresh), ...s });
    },

    async 'POST signin'({ body, ip }) {
      const email = normalizeEmail(body.email);
      const password = String(body.password ?? '').slice(0, PASSWORD_MAX + 1);
      const at = now();
      const ipRetry = await limited(`ip:${ip}`, IP_ATTEMPT_LIMIT);
      const pairRetry = await limited(`email-ip:${email}|${ip}`, EMAIL_IP_ATTEMPT_LIMIT);
      if (ipRetry || pairRetry) {
        return fail(429, 'deviceLimited', '10분 안에 로그인을 너무 많이 시도했습니다. 잠시 뒤 다시 시도해 주세요', {
          retryAt: Math.max(ipRetry ?? 0, pairRetry ?? 0),
        });
      }
      // 연속 실패는 비밀번호를 확인하기 전에 한 칸 먼저 올린다(원자적). 동시에 여러 IP에서 보내도 5번까지만 확인한다.
      // 맞으면 아래에서 0으로 되돌린다
      const lockKey = `acct:${email}`;
      const r = await store.bumpFail(lockKey, at, LOGIN_MAX_FAILS, LOGIN_LOCK_MS);
      if (r.count > LOGIN_MAX_FAILS) {
        return fail(423, 'locked', '5회 연속 틀려 10분 동안 잠겼습니다', { retryAt: r.lockedUntil ?? at + LOGIN_LOCK_MS });
      }
      const acc = isEmailLike(email) ? await store.accountByEmail(email) : null;
      // 없는 계정·소셜 전용 계정도 같은 계산을 한다(응답 시간으로 가입 여부가 드러나지 않게)
      const good = acc?.passwordHash ? await verifyPassword(password, acc.passwordHash) : (await verifyPassword(password, await dummyHash), false);
      if (!good) {
        if (r.lockedUntil != null) return fail(423, 'locked', '5회 연속 틀려 10분 동안 잠겼습니다', { retryAt: r.lockedUntil });
        return fail(401, 'badCredentials', `${BAD_LOGIN}(연속 ${r.count}회, 5회면 10분 잠금)`);
      }
      await store.setLock(lockKey, { fails: 0, lockedUntil: null }, at);
      if (acc.verifiedAt == null) return fail(403, 'unverified', '이메일 인증을 마쳐야 로그인할 수 있습니다');
      const s = await openSession(acc, body.deviceToken);
      return okBody({ account: toPublic(acc), ...s });
    },

    async 'POST signout'({ auth }) {
      if (auth) await store.dropSession(auth.hash);
      return okBody();
    },

    async 'GET session'({ auth }) {
      if (!auth) return fail(401, 'invalidToken', SESSION_GONE);
      return okBody({ account: toPublic(auth.account), expiresAt: auth.expiresAt });
    },

    async 'GET nickname'({ url, auth }) {
      const nickname = String(url.searchParams.get('nickname') ?? '');
      return { status: 200, body: { taken: await store.nicknameTaken(nickname, auth?.account.accountId) } };
    },

    async 'POST profile'({ body, auth }) {
      if (!auth) return fail(401, 'invalidToken', SESSION_GONE);
      const patch = cleanProfilePatch(body.profile);
      if (patch.nickname != null) {
        const problem = nicknameProblem(patch.nickname);
        if (problem) return fail(400, 'badCredentials', problem);
        if (await store.nicknameTaken(patch.nickname, auth.account.accountId)) return fail(409, 'nicknameTaken', '이미 쓰는 닉네임입니다');
      }
      const profile = { ...auth.account.profile, ...patch, tags: patch.tags ?? auth.account.profile?.tags ?? [] };
      const r = await store.updateAccount(auth.account.accountId, { profile, ...(patch.nickname != null ? { nickname: patch.nickname } : {}) });
      if (r === 'nickname') return fail(409, 'nicknameTaken', '이미 쓰는 닉네임입니다');
      return okBody({ account: toPublic(await store.accountById(auth.account.accountId)) });
    },

    async 'POST delete'({ auth }) {
      if (!auth) return fail(401, 'invalidToken', SESSION_GONE);
      const id = auth.account.accountId;
      await store.dropSessions(id);
      await store.dropTokens(id);
      await store.dropIdentities(id);
      await store.updateAccount(id, { email: null, nickname: null, passwordHash: null, profile: {}, providers: [], upgradeProof: null, deletedAt: now() });
      outbox = outbox.filter((m) => m.to !== auth.account.email);
      return okBody();
    },

    async 'POST password/reset'({ body, ip }) {
      const email = normalizeEmail(body.email);
      if (!isEmailLike(email)) return fail(400, 'badCredentials', '이메일 형식이 아닙니다');
      const retryAt = await limited(`mail:${ip}`, MAIL_LIMIT);
      if (retryAt) return fail(429, 'deviceLimited', '잠시 뒤 다시 시도해 주세요', { retryAt });
      const acc = await store.accountByEmail(email);
      if (acc && acc.passwordHash != null) await issueMailToken('reset', acc);
      return okBody();
    },

    async 'POST password/confirm'({ body }) {
      const password = String(body.password ?? '');
      const violations = passwordViolations(password);
      if (violations.length > 0 || password.length > PASSWORD_MAX) {
        return fail(400, 'weakPassword', '비밀번호 규칙을 지켜 주세요', { violations: violations.length > 0 ? violations : [`${PASSWORD_MAX}자 이하`] });
      }
      const used = await store.useToken(tokenHash(String(body.token ?? '')), 'reset', now());
      const acc = used ? await store.accountById(used.accountId) : null;
      if (!acc) return fail(400, 'invalidToken', '쓸 수 없는 재설정 링크입니다. 재설정 메일을 다시 받아 주세요');
      // 메일을 받았으니 이메일 소유도 확인된 것이다. 다른 기기의 세션은 모두 끊는다
      await store.updateAccount(acc.accountId, { passwordHash: await hashPassword(password, { cost: passwordCost }), verifiedAt: acc.verifiedAt ?? now() });
      await store.dropSessions(acc.accountId);
      await store.dropTokens(acc.accountId, 'reset');
      await store.setLock(`acct:${acc.email}`, { fails: 0, lockedUntil: null }, now());
      for (const m of outbox) if (m.to === acc.email && m.kind === 'reset') m.invalidated = true;
      return okBody();
    },

    async 'POST social'({ body, auth, ip }) {
      const provider = body.provider === 'kakao' || body.provider === 'google' ? body.provider : null;
      if (!provider) return fail(400, 'providerFailed', '모르는 제공자입니다');
      const label = PROVIDER_LABEL[provider];
      if (body.scenario === 'fail') return fail(502, 'providerFailed', `${label} 응답을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요`);
      const device = typeof body.deviceToken === 'string' && body.deviceToken.length > 0 ? body.deviceToken : null;
      if (!device) return fail(400, 'providerFailed', `${label} 응답을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요`);
      // 모의 제공자 신원: 기기 토큰의 해시(기기 하나에 제공자 신원 하나)
      const subject = tokenHash(`${provider}:${device}`).slice(0, 32);

      // 17 연결: 지금 로그인한 계정에만 붙인다
      if (body.link) {
        if (!auth) return fail(401, 'notFound', '지금 계정을 찾지 못했습니다. 다시 로그인해 주세요');
        const owner = await store.identity(provider, subject);
        if (owner && owner !== auth.account.accountId) return boundFail(provider, owner);
        const bad = await addProvider(auth.account, provider, subject);
        if (bad) return bad;
        return okBody({ account: toPublic(await store.accountById(auth.account.accountId)) });
      }

      if (body.scenario === 'sameEmail') {
        // 클라이언트가 보낸 이메일만 믿고 연결하지 않는다. 연결 확인 토큰은 그 이메일의 메일함(개발용 보낸편지함)으로만 보내고,
        // 응답은 계정이 있든 없든·인증 전이든·다른 신원에 묶였든 하나다(가입 여부를 드러내지 않는다)
        const email = normalizeEmail(body.providerEmail);
        if (!isEmailLike(email)) return fail(400, 'notFound', `${PROVIDER_SUBJECT[provider]} 돌려줄 이메일을 입력해 주세요(모의)`);
        const retryAt = await limited(`mail:${ip}`, MAIL_LIMIT);
        if (retryAt) return fail(429, 'deviceLimited', '잠시 뒤 다시 시도해 주세요', { retryAt });
        const target = await store.accountByEmail(email);
        const owner = await store.identity(provider, subject);
        if (target && target.providers.includes('email') && target.verifiedAt != null && (!owner || owner === target.accountId)) {
          const linkToken = newToken();
          await store.putToken({
            tokenHash: tokenHash(linkToken),
            kind: 'link',
            accountId: target.accountId,
            data: { provider, subject, deviceToken: device.slice(0, 64) },
            createdAt: now(),
            expiresAt: now() + LINK_TTL_MS,
          });
          sendMail('link', target.email, linkToken);
        }
        return fail(409, 'linkRequired', LINK_SENT(email));
      }

      const existing = await store.identity(provider, subject);
      if (existing) {
        const acc = await store.accountById(existing);
        if (acc) {
          const s = await openSession(acc, device);
          return okBody({ account: toPublic(acc), ...s });
        }
      }
      const nickname = await freeNickname(`${label}여행자`);
      const rec = {
        accountId: newId('acc'),
        userId: newId('u'),
        email: `${provider}.${subject.slice(0, 12)}@${provider}.example`,
        nickname,
        passwordHash: null,
        verifiedAt: now(),
        providers: [provider],
        profile: { nickname, tags: [] },
        createdAt: now(),
        deletedAt: null,
      };
      const ins = await store.insertAccount(rec);
      if (ins !== 'ok') return fail(409, 'providerFailed', `${label} 계정을 만들지 못했습니다. 다시 시도해 주세요`);
      if ((await store.putIdentity(provider, subject, rec.accountId, now())) !== 'ok') {
        await store.removeAccount(rec.accountId);
        return fail(409, 'providerFailed', `${label} 계정을 만들지 못했습니다. 다시 시도해 주세요`);
      }
      const s = await openSession(rec, device);
      return okBody({ account: toPublic(rec), ...s });
    },

    /** 연결 확인 메일의 토큰으로만 연결한다(메일을 받을 수 있어야 그 계정에 소셜 로그인을 붙인다) */
    async 'POST social/confirm'({ body }) {
      const used = await store.useToken(tokenHash(String(body.linkToken ?? '')), 'link', now());
      if (!used) return fail(400, 'invalidToken', '연동 확인 시간이 지났습니다. 소셜 로그인을 다시 시작해 주세요');
      if (!body.accept) return fail(409, 'linkRequired', '연결하지 않았습니다. 기존 계정은 이메일로 로그인할 수 있습니다');
      const acc = await store.accountById(used.accountId);
      if (!acc) return fail(404, 'notFound', '계정을 찾지 못했습니다');
      if (acc.verifiedAt == null) return fail(403, 'unverified', '이 이메일 계정은 아직 인증 전입니다. 인증을 마친 뒤 연결해 주세요');
      const { provider, subject, deviceToken } = used.data;
      const bad = await addProvider(acc, provider, subject);
      if (bad) return bad;
      const fresh = await store.accountById(acc.accountId);
      const s = await openSession(fresh, deviceToken);
      return okBody({ account: toPublic(fresh), ...s });
    },

    async 'GET outbox'() {
      if (!devOutbox) return { status: 404, body: { error: 'notFound' } };
      return { status: 200, body: { mails: [...outbox].sort((a, b) => b.sentAt - a.sentAt) } };
    },
  };

  return {
    /**
     * /auth/… 요청 하나. path는 '/auth/' 뒤(예: 'password/reset'). body는 JSON을 푼 값(GET은 {}).
     * 돌려주는 {status, body}를 서버가 그대로 보낸다.
     */
    async handle({ method, path, url, headers, body, ip }) {
      const route = routes[`${method} ${path}`];
      if (!route) return { status: 404, body: { error: 'notFound' } };
      // 모의 소셜은 제공자 검증이 없어 개발 서버에서만 연다
      if (!mockSocial && (path === 'social' || path === 'social/confirm')) return { status: 404, body: { error: 'notFound' } };
      const auth = await authed(headers);
      try {
        return await route({ body: body && typeof body === 'object' ? body : {}, url, ip: String(ip ?? ''), auth, headers });
      } catch (e) {
        // 본문(비밀번호·토큰)은 남기지 않는다. 경로와 오류 이름만
        log(`인증 처리 실패(${method} /auth/${path}): ${e?.message ?? e}`);
        return { status: 500, body: { ok: false, code: 'providerFailed', detail: '서버 오류입니다. 잠시 뒤 다시 시도해 주세요' } };
      }
    },
    async purge() {
      await store.purge(now());
    },
    /** 테스트용 */
    outbox: () => [...outbox],
  };
}

export function isAuthPath(pathname) {
  return pathname === '/auth' || pathname.startsWith('/auth/');
}

/**
 * 개발용 보낸편지함(과 모의 소셜)을 열지. 서버 변수 SYNC_ALLOW_RESET=1(시연 리셋 허용) 또는 AUTH_DEV_OUTBOX=1일 때만이다.
 * 메모리 저장소라고 저절로 열리지 않는다(보낸편지함에는 살아 있는 인증·재설정 토큰이 있다)
 */
export function devOutboxFromEnv(env) {
  return (env.SYNC_ALLOW_RESET ?? '').trim() === '1' || (env.AUTH_DEV_OUTBOX ?? '').trim() === '1';
}
