import type {
  AccountPublic,
  AuthAck,
  AuthProvider,
  AuthProviderKind,
  AuthResult,
  Clock,
  Hasher,
  KV,
  MockMail,
  Profile,
  Rng,
} from '../../core/ports';
import {
  deviceAttemptCheck,
  isEmailLike,
  isLocked,
  normalizeEmail,
  passwordViolations,
  pruneAttempts,
  registerFailure,
  sameNickname,
  settleLock,
  type LockState,
} from '../../core/auth';
import { base64url, makeIdGen } from '../../core/util';

/**
 * 모의 인증(FR-101~104, WP1 소유). 서버가 없어 이 기기 KV에만 저장한다(프로토타입 · 단말 저장).
 * - 비밀번호는 salt(16바이트) + SHA-256(순수 구현, 주입 hasher)으로만 저장한다. 원문은 어디에도 두지 않는다.
 * - 인증 메일은 모의 메일함(outbox)에 쌓인다. 재발송하면 그 주소의 이전 메일 토큰이 무효가 된다.
 * - 로그인 제한: 계정 기준 5회 연속 실패 시 10분 잠금 + 기기 토큰 기준 10분 20회(IP 대신 기기 토큰, 가정).
 * - 소셜: 모의 동의 화면(26)의 scenario로 성공·실패·동일 이메일을 고른다. 동일 이메일은 모의 제공자가 돌려준
 *   이메일(providerEmail)과 정확히 같은 이메일 계정만 대상이고, linkRequired 뒤 confirmLink로 확인해야만 연결한다
 *   (자동 병합 없음). 미인증 계정에는 연결하지 않는다.
 * - 연결(17 '카카오 연결'): linkToAccountId로 받은 지금 계정에만 연결한다. 다른 계정으로 바뀌지 않는다.
 * - 게스트 승격 가입은 게스트 userId 하나에 계정 하나만 둔다. 같은 userId의 미인증 가입은 새 가입으로 대체한다.
 * - 비밀번호 재설정: 재설정 메일(kind 'reset', 30분)도 모의 메일함에 온다. 없는 이메일이어도 같은 응답이다(계정 서버와 같다).
 * 저장은 KV 색인 키 하나('index')에 전체 blob을 둔다(계약 A11, KV에 키 나열이 없다).
 * 모든 메서드는 한 줄로 차례 실행한다(serial). load → await → save 사이에 다른 호출이 끼면 뒤에 저장한 쪽이
 * 앞의 변경(잠금 실패 수, 기기 시도 기록)을 덮어써 5회 잠금·20회 제한을 우회할 수 있어서다.
 */

/**
 * social() 입력. linkToAccountId·providerEmail은 통합 때 ports의 AuthProvider.social 계약에 정식으로 들어갔다.
 * 실제 제공자가 이 값을 무시할 수 있으므로 flows(judgeSocial)가 결과 계정이 지금 계정인지 다시 확인한다.
 */
export type SocialInput = Parameters<AuthProvider['social']>[0];

interface AccountRecord {
  accountId: string;
  userId: string;
  email: string;
  nickname: string;
  verified: boolean;
  providers: AuthProviderKind[];
  profile: Profile;
  /** 이메일 가입만 있다. 소셜 전용 계정은 비밀번호가 없다 */
  salt?: string;
  hash?: string;
  lock: LockState;
  createdAt: number;
}

interface PendingLink {
  token: string;
  accountId: string;
  provider: 'kakao' | 'google';
  createdAt: number;
}

interface AuthDb {
  accounts: AccountRecord[];
  mails: MockMail[];
  links: PendingLink[];
  /** 기기 토큰 → 시도 시각(10분 창) */
  attempts: Record<string, number[]>;
  /** 소셜 제공자 → 그 제공자 신원이 묶인 계정 id(소셜 가입 또는 연결). 제공자 신원 하나에 계정 하나다 */
  socialAccounts: Partial<Record<'kakao' | 'google', string>>;
}

const INDEX_KEY = 'index';
const PROVIDER_LABEL = { kakao: '카카오', google: '구글' } as const;
const PROVIDER_SUBJECT = { kakao: '카카오가', google: '구글이' } as const;
/** 연동 확인 토큰 유효 시간(모의). 동의 화면을 벗어나면 다시 시작한다 */
const LINK_TTL_MS = 10 * 60 * 1000;
/** 비밀번호 재설정 메일 유효 시간(계정 서버 RESET_TTL_MS와 같다) */
const RESET_TTL_MS = 30 * 60 * 1000;
const isReset = (m: MockMail) => m.kind === 'reset';

function emptyDb(): AuthDb {
  return { accounts: [], mails: [], links: [], attempts: {}, socialAccounts: {} };
}

function toPublic(a: AccountRecord): AccountPublic {
  return {
    accountId: a.accountId,
    userId: a.userId,
    email: a.email,
    nickname: a.nickname,
    verified: a.verified,
    providers: [...a.providers],
    profile: { ...a.profile, tags: [...a.profile.tags] },
  };
}

/** 모의 인증. AuthProvider 계약 그대로다 */
export type LocalAuthProvider = AuthProvider;

export function createLocalAuth(opts: { clock: Clock; rng: Rng; hasher: Hasher; kv: KV }): LocalAuthProvider {
  const { clock, rng, hasher, kv } = opts;
  const ids = makeIdGen(rng);
  const token = () => base64url(rng.bytes(16));

  async function load(): Promise<AuthDb> {
    const raw = await kv.get(INDEX_KEY);
    if (!raw) return emptyDb();
    try {
      // 이전 판의 lastByDevice(기기별 마지막 로그인 계정)는 더 쓰지 않는다.
      const { lastByDevice: _old, ...rest } = JSON.parse(raw) as Partial<AuthDb> & { lastByDevice?: unknown };
      return { ...emptyDb(), ...rest };
    } catch {
      return emptyDb();
    }
  }

  async function save(db: AuthDb): Promise<void> {
    await kv.set(INDEX_KEY, JSON.stringify(db));
  }

  const hashOf = (salt: string, password: string) => hasher.sha256(`${salt}:${password}`);

  // 한 줄 실행. 앞 호출이 실패해도 다음 호출은 돈다.
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  function sendVerification(db: AuthDb, email: string): MockMail {
    const now = clock.now();
    for (const m of db.mails) if (m.to === email && !isReset(m)) m.invalidated = true;
    const mail: MockMail = {
      id: ids.next('mail'),
      to: email,
      subject: 'Young Trip 이메일 인증',
      token: token(),
      sentAt: now,
      invalidated: false,
      kind: 'verify',
    };
    db.mails.push(mail);
    return mail;
  }

  function nicknameTaken(db: AuthDb, nickname: string, exceptAccountId?: string): boolean {
    return db.accounts.some((a) => a.accountId !== exceptAccountId && sameNickname(a.nickname, nickname));
  }

  /** 이 제공자 신원이 다른 계정에 이미 묶여 있으면 그 계정 */
  function boundElsewhere(db: AuthDb, provider: 'kakao' | 'google', accountId: string): AccountRecord | undefined {
    const id = db.socialAccounts[provider];
    if (!id || id === accountId) return undefined;
    return db.accounts.find((a) => a.accountId === id);
  }

  function boundFail(provider: 'kakao' | 'google', other: AccountRecord): AuthResult {
    return {
      ok: false,
      code: 'duplicateEmail',
      detail: `이 ${PROVIDER_LABEL[provider]} 계정은 이미 다른 Young Trip 계정(${other.nickname})에 묶여 있어 연결할 수 없습니다`,
    };
  }

  /** 소셜 가입 닉네임. 겹치면 숫자를 붙인다 */
  function freeNickname(db: AuthDb, base: string): string {
    if (!nicknameTaken(db, base)) return base;
    for (let i = 2; ; i += 1) if (!nicknameTaken(db, `${base}${i}`)) return `${base}${i}`;
  }

  const impl: LocalAuthProvider = {
    async signUp({ email, password, nickname, userId }): Promise<AuthResult> {
      const db = await load();
      const e = normalizeEmail(email);
      if (!isEmailLike(e)) return { ok: false, code: 'badCredentials', detail: '이메일 형식이 아닙니다' };
      // 게스트 승격은 userId를 유지하므로 게스트 하나에 계정 하나다. 인증을 마친 계정이 있으면 거부하고,
      // 아직 인증하지 않은 가입(오타 이메일 등)은 이번 가입으로 대체한다(그 주소의 인증 메일도 무효).
      const prior = userId ? db.accounts.find((a) => a.userId === userId) : undefined;
      if (prior?.verified) {
        return {
          ok: false,
          code: 'duplicateEmail',
          detail: `이 게스트는 이미 ${prior.email} 계정으로 승격했습니다. 그 계정으로 로그인해 주세요`,
        };
      }
      const others = db.accounts.filter((a) => a !== prior);
      if (others.some((a) => a.email === e)) {
        return { ok: false, code: 'duplicateEmail', detail: '이미 가입한 이메일입니다. 로그인하거나 인증 메일을 다시 받아 주세요' };
      }
      const violations = passwordViolations(password);
      if (violations.length > 0) {
        return { ok: false, code: 'weakPassword', detail: '비밀번호 규칙을 지켜 주세요', violations };
      }
      if (nicknameTaken(db, nickname, prior?.accountId)) {
        return { ok: false, code: 'nicknameTaken', detail: '이미 쓰는 닉네임입니다' };
      }
      if (prior) {
        for (const m of db.mails) if (m.to === prior.email) m.invalidated = true;
        db.accounts = others;
      }
      const salt = token();
      const now = clock.now();
      const rec: AccountRecord = {
        accountId: ids.next('acc'),
        userId: userId ?? ids.next('u'),
        email: e,
        nickname: nickname.trim(),
        verified: false,
        providers: ['email'],
        profile: { nickname: nickname.trim(), tags: [] },
        salt,
        hash: await hashOf(salt, password),
        lock: { fails: 0 },
        createdAt: now,
      };
      db.accounts.push(rec);
      sendVerification(db, e);
      await save(db);
      return { ok: true, account: toPublic(rec) };
    },

    async resendVerification(email): Promise<AuthAck> {
      const db = await load();
      const e = normalizeEmail(email);
      const acc = db.accounts.find((a) => a.email === e);
      if (!acc) return { ok: false, code: 'notFound', detail: '가입한 이메일이 아닙니다' };
      if (acc.verified) return { ok: false, code: 'invalidToken', detail: '이미 인증을 마친 계정입니다' };
      sendVerification(db, e);
      await save(db);
      return { ok: true };
    },

    async verifyEmail(t): Promise<AuthResult> {
      const db = await load();
      const mail = db.mails.find((m) => m.token === t && !isReset(m));
      if (!mail || mail.invalidated) {
        return { ok: false, code: 'invalidToken', detail: '쓸 수 없는 인증 링크입니다. 가장 최근 메일로 인증해 주세요' };
      }
      const acc = db.accounts.find((a) => a.email === mail.to);
      if (!acc) return { ok: false, code: 'notFound' };
      acc.verified = true;
      mail.invalidated = true;
      await save(db);
      return { ok: true, account: toPublic(acc) };
    },

    async signIn({ email, password, deviceToken }): Promise<AuthResult> {
      const db = await load();
      const now = clock.now();
      const device = deviceAttemptCheck(db.attempts[deviceToken] ?? [], now);
      if (!device.ok) {
        return {
          ok: false,
          code: 'deviceLimited',
          retryAt: device.retryAt,
          detail: '이 기기에서 10분 안에 로그인을 20번 넘게 시도했습니다',
        };
      }
      db.attempts[deviceToken] = [...pruneAttempts(db.attempts[deviceToken] ?? [], now), now];

      const acc = db.accounts.find((a) => a.email === normalizeEmail(email));
      if (!acc) {
        await save(db);
        return { ok: false, code: 'badCredentials', detail: '이메일이나 비밀번호가 맞지 않습니다' };
      }
      acc.lock = settleLock(acc.lock, now);
      if (isLocked(acc.lock, now)) {
        await save(db);
        return { ok: false, code: 'locked', retryAt: acc.lock.lockedUntil, detail: '5회 연속 틀려 10분 동안 잠겼습니다' };
      }
      if (!acc.salt || !acc.hash) {
        await save(db);
        return { ok: false, code: 'badCredentials', detail: '소셜 로그인으로 만든 계정입니다. 카카오·구글로 로그인해 주세요' };
      }
      if ((await hashOf(acc.salt, password)) !== acc.hash) {
        acc.lock = registerFailure(acc.lock, now);
        await save(db);
        if (isLocked(acc.lock, now)) {
          return { ok: false, code: 'locked', retryAt: acc.lock.lockedUntil, detail: '5회 연속 틀려 10분 동안 잠겼습니다' };
        }
        return {
          ok: false,
          code: 'badCredentials',
          detail: `이메일이나 비밀번호가 맞지 않습니다(연속 ${acc.lock.fails}회, 5회면 10분 잠금)`,
        };
      }
      acc.lock = { fails: 0 };
      if (!acc.verified) {
        await save(db);
        return { ok: false, code: 'unverified', detail: '이메일 인증을 마쳐야 로그인할 수 있습니다' };
      }
      await save(db);
      return { ok: true, account: toPublic(acc) };
    },

    async social(input: SocialInput): Promise<AuthResult> {
      const { provider, scenario } = input;
      const label = PROVIDER_LABEL[provider];
      if (scenario === 'fail') {
        return { ok: false, code: 'providerFailed', detail: `${label} 응답을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요` };
      }
      const db = await load();
      const now = clock.now();

      // 17 연결: 지금 계정에만 붙인다. 동의 화면 자체가 확인이라 linkRequired를 한 번 더 거치지 않는다.
      if (input.linkToAccountId != null) {
        const target = db.accounts.find((a) => a.accountId === input.linkToAccountId);
        if (!target) return { ok: false, code: 'notFound', detail: '지금 계정을 찾지 못했습니다. 다시 로그인해 주세요' };
        const other = boundElsewhere(db, provider, target.accountId);
        if (other) return boundFail(provider, other);
        if (!target.providers.includes(provider)) target.providers.push(provider);
        db.socialAccounts[provider] = target.accountId;
        await save(db);
        return { ok: true, account: toPublic(target) };
      }

      if (scenario === 'sameEmail') {
        // 모의 제공자가 돌려준 이메일이 이미 이메일로 가입한 계정과 같다는 상황. 그 이메일과 정확히 같은 계정만 대상이다.
        const e = normalizeEmail(input.providerEmail ?? '');
        if (!isEmailLike(e)) {
          return { ok: false, code: 'notFound', detail: `${PROVIDER_SUBJECT[provider]} 돌려줄 이메일을 입력해 주세요(모의)` };
        }
        const target = db.accounts.find((a) => a.email === e && a.providers.includes('email'));
        if (!target) {
          return { ok: false, code: 'notFound', detail: `${e}로 가입한 이메일 계정이 없습니다. 정상을 고르면 새 소셜 계정을 만듭니다` };
        }
        if (target.providers.includes(provider) && db.socialAccounts[provider] === target.accountId) {
          return { ok: true, account: toPublic(target) };
        }
        if (!target.verified) {
          return { ok: false, code: 'unverified', detail: `${e} 계정은 아직 이메일 인증 전입니다. 인증을 마친 뒤 연결할 수 있습니다` };
        }
        const other = boundElsewhere(db, provider, target.accountId);
        if (other) return boundFail(provider, other);
        const link: PendingLink = { token: token(), accountId: target.accountId, provider, createdAt: now };
        db.links = [...db.links.filter((l) => now - l.createdAt < LINK_TTL_MS), link];
        await save(db);
        return {
          ok: false,
          code: 'linkRequired',
          linkToken: link.token,
          detail: `${target.email}으로 가입한 계정이 있습니다. ${label} 로그인을 이 계정에 연결할까요?`,
        };
      }
      const existingId = db.socialAccounts[provider];
      const existing = existingId ? db.accounts.find((a) => a.accountId === existingId) : undefined;
      if (existing) return { ok: true, account: toPublic(existing) };
      const nickname = freeNickname(db, `${label}여행자`);
      const rec: AccountRecord = {
        accountId: ids.next('acc'),
        userId: ids.next('u'),
        email: `${provider}.user@${provider}.example`,
        nickname,
        verified: true,
        providers: [provider],
        profile: { nickname, tags: [] },
        lock: { fails: 0 },
        createdAt: now,
      };
      db.accounts.push(rec);
      db.socialAccounts[provider] = rec.accountId;
      await save(db);
      return { ok: true, account: toPublic(rec) };
    },

    async confirmLink({ linkToken, accept }): Promise<AuthResult> {
      const db = await load();
      const now = clock.now();
      const link = db.links.find((l) => l.token === linkToken && now - l.createdAt < LINK_TTL_MS);
      db.links = db.links.filter((l) => l.token !== linkToken);
      if (!link) {
        await save(db);
        return { ok: false, code: 'invalidToken', detail: '연동 확인 시간이 지났습니다. 소셜 로그인을 다시 시작해 주세요' };
      }
      const acc = db.accounts.find((a) => a.accountId === link.accountId);
      if (!acc) {
        await save(db);
        return { ok: false, code: 'notFound' };
      }
      if (!accept) {
        await save(db);
        return { ok: false, code: 'linkRequired', detail: '연결하지 않았습니다. 기존 계정은 이메일로 로그인할 수 있습니다' };
      }
      // 미인증 계정은 연결하지 않는다(이메일 인증을 소셜 연결로 건너뛰지 않는다).
      if (!acc.verified) {
        await save(db);
        return { ok: false, code: 'unverified', detail: '이 이메일 계정은 아직 인증 전입니다. 인증을 마친 뒤 연결해 주세요' };
      }
      const other = boundElsewhere(db, link.provider, acc.accountId);
      if (other) {
        await save(db);
        return boundFail(link.provider, other);
      }
      if (!acc.providers.includes(link.provider)) acc.providers.push(link.provider);
      db.socialAccounts[link.provider] = acc.accountId;
      await save(db);
      return { ok: true, account: toPublic(acc) };
    },

    async isNicknameTaken(nickname, exceptAccountId): Promise<boolean> {
      return nicknameTaken(await load(), nickname, exceptAccountId);
    },

    async updateProfile(accountId, patch): Promise<AuthResult> {
      const db = await load();
      const acc = db.accounts.find((a) => a.accountId === accountId);
      if (!acc) return { ok: false, code: 'notFound' };
      if (patch.nickname != null && nicknameTaken(db, patch.nickname, accountId)) {
        return { ok: false, code: 'nicknameTaken', detail: '이미 쓰는 닉네임입니다' };
      }
      acc.profile = { ...acc.profile, ...patch, tags: [...(patch.tags ?? acc.profile.tags)] };
      if (patch.nickname != null) acc.nickname = patch.nickname.trim();
      await save(db);
      return { ok: true, account: toPublic(acc) };
    },

    async getAccount(accountId): Promise<AuthResult> {
      const acc = (await load()).accounts.find((a) => a.accountId === accountId);
      return acc ? { ok: true, account: toPublic(acc) } : { ok: false, code: 'notFound' };
    },

    async deleteAccount(accountId) {
      const db = await load();
      const acc = db.accounts.find((a) => a.accountId === accountId);
      if (!acc) return { ok: false, code: 'notFound' };
      db.accounts = db.accounts.filter((a) => a.accountId !== accountId);
      db.mails = db.mails.filter((m) => m.to !== acc.email);
      db.links = db.links.filter((l) => l.accountId !== accountId);
      for (const k of Object.keys(db.socialAccounts) as ('kakao' | 'google')[]) {
        if (db.socialAccounts[k] === accountId) delete db.socialAccounts[k];
      }
      await save(db);
      return { ok: true };
    },

    async requestPasswordReset(email): Promise<AuthAck> {
      const db = await load();
      const e = normalizeEmail(email);
      if (!isEmailLike(e)) return { ok: false, code: 'badCredentials', detail: '이메일 형식이 아닙니다' };
      const acc = db.accounts.find((a) => a.email === e);
      if (acc?.salt && acc.hash) {
        for (const m of db.mails) if (m.to === e && isReset(m)) m.invalidated = true;
        db.mails.push({
          id: ids.next('mail'),
          to: e,
          subject: 'Young Trip 비밀번호 재설정',
          token: token(),
          sentAt: clock.now(),
          invalidated: false,
          kind: 'reset',
        });
        await save(db);
      }
      return { ok: true };
    },

    async confirmPasswordReset({ token: t, password }) {
      const violations = passwordViolations(password);
      if (violations.length > 0) return { ok: false, code: 'weakPassword', detail: '비밀번호 규칙을 지켜 주세요', violations };
      const db = await load();
      const now = clock.now();
      const mail = db.mails.find((m) => m.token === t && isReset(m) && !m.invalidated && now - m.sentAt < RESET_TTL_MS);
      const acc = mail ? db.accounts.find((a) => a.email === mail.to) : undefined;
      if (!mail || !acc) {
        return { ok: false, code: 'invalidToken', detail: '쓸 수 없는 재설정 링크입니다. 재설정 메일을 다시 받아 주세요' };
      }
      mail.invalidated = true;
      acc.salt = token();
      acc.hash = await hashOf(acc.salt, password);
      acc.lock = { fails: 0 };
      acc.verified = true;
      await save(db);
      return { ok: true };
    },

    async outbox(): Promise<MockMail[]> {
      const db = await load();
      return [...db.mails].sort((a, b) => b.sentAt - a.sentAt);
    },

    async reset(): Promise<void> {
      await kv.remove(INDEX_KEY);
    },
  };

  return {
    id: 'local',
    signUp: (input) => serial(() => impl.signUp(input)),
    resendVerification: (email) => serial(() => impl.resendVerification(email)),
    verifyEmail: (t) => serial(() => impl.verifyEmail(t)),
    signIn: (input) => serial(() => impl.signIn(input)),
    social: (input) => serial(() => impl.social(input)),
    confirmLink: (input) => serial(() => impl.confirmLink(input)),
    isNicknameTaken: (nickname, exceptAccountId) => serial(() => impl.isNicknameTaken(nickname, exceptAccountId)),
    updateProfile: (accountId, patch) => serial(() => impl.updateProfile(accountId, patch)),
    getAccount: (accountId) => serial(() => impl.getAccount(accountId)),
    deleteAccount: (accountId) => serial(() => impl.deleteAccount(accountId)),
    outbox: () => serial(() => impl.outbox()),
    reset: () => serial(() => impl.reset()),
    requestPasswordReset: (email) => serial(() => impl.requestPasswordReset!(email)),
    confirmPasswordReset: (input) => serial(() => impl.confirmPasswordReset!(input)),
  };
}
