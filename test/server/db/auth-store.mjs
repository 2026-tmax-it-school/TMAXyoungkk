/**
 * 계정·로그인 PostgreSQL 저장소(WP2 소유). server/auth.mjs createMemoryAuthStore와 메서드·결과가 같다.
 * 표는 마이그레이션 002_auth.sql의 auth_*와 003_oauth_states.sql의 auth_oauth_states다. db는 postgres-store.mjs sqlDb()로 감싼 pg.Pool 또는 PGlite다.
 * 고유 색인 충돌(23505)은 던지지 않고 'email' | 'nickname' | 'userId'로 돌려준다(동시에 같은 이메일로 가입한 경우 등).
 */

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const msOf = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(v));
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const ACCOUNT_COLS =
  'account_id, user_id, email, nickname, password_hash, email_verified_at, providers, profile, created_at, deleted_at, upgrade_proof';

function rowToAccount(r) {
  if (!r) return null;
  return {
    accountId: r.account_id,
    userId: r.user_id,
    email: r.email,
    nickname: r.nickname,
    passwordHash: r.password_hash,
    verifiedAt: msOf(r.email_verified_at),
    providers: json(r.providers) ?? [],
    profile: json(r.profile) ?? {},
    createdAt: msOf(r.created_at),
    deletedAt: msOf(r.deleted_at),
    upgradeProof: r.upgrade_proof ?? null,
  };
}

/** 계정 필드 → [열, 값 변환] */
const FIELD = {
  email: ['email', (v) => v],
  nickname: ['nickname', (v) => v],
  passwordHash: ['password_hash', (v) => v],
  verifiedAt: ['email_verified_at', iso],
  providers: ['providers', (v) => JSON.stringify(v ?? [])],
  profile: ['profile', (v) => JSON.stringify(v ?? {})],
  deletedAt: ['deleted_at', iso],
  upgradeProof: ['upgrade_proof', (v) => v ?? null],
};

function conflictOf(e) {
  if (e?.code !== '23505') throw e;
  const c = String(e.constraint ?? e.message ?? '');
  if (c.includes('email')) return 'email';
  if (c.includes('nickname')) return 'nickname';
  if (c.includes('user')) return 'userId';
  if (c.includes('identities')) return 'conflict';
  return 'email';
}

export function createPgAuthStore(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  return {
    kind: 'postgres',

    async accountById(id) {
      return rowToAccount(await one(`SELECT ${ACCOUNT_COLS} FROM auth_accounts WHERE account_id = $1 AND deleted_at IS NULL`, [id]));
    },
    async accountByEmail(email) {
      return rowToAccount(
        await one(`SELECT ${ACCOUNT_COLS} FROM auth_accounts WHERE lower(email) = lower($1) AND deleted_at IS NULL`, [email]),
      );
    },
    /** 닉네임(앞뒤 공백 무시, 대소문자 무시)으로 찾는다. 아이디 로그인용 */
    async accountByNickname(nickname) {
      return rowToAccount(
        await one(
          `SELECT ${ACCOUNT_COLS} FROM auth_accounts WHERE lower(nickname) = lower(btrim($1)) AND deleted_at IS NULL LIMIT 1`,
          [String(nickname ?? '')],
        ),
      );
    },
    async accountByUserId(userId) {
      return rowToAccount(await one(`SELECT ${ACCOUNT_COLS} FROM auth_accounts WHERE user_id = $1 AND deleted_at IS NULL`, [userId]));
    },
    async nicknameTaken(nickname, exceptId) {
      const r = await one(
        `SELECT 1 AS hit FROM auth_accounts
          WHERE lower(nickname) = lower(btrim($1)) AND deleted_at IS NULL AND ($2::text IS NULL OR account_id <> $2)
          LIMIT 1`,
        [String(nickname ?? ''), exceptId ?? null],
      );
      return r != null;
    },
    async insertAccount(rec) {
      try {
        await db.query(
          `INSERT INTO auth_accounts (${ACCOUNT_COLS}) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
          [
            rec.accountId,
            rec.userId,
            rec.email,
            rec.nickname,
            rec.passwordHash,
            iso(rec.verifiedAt),
            JSON.stringify(rec.providers ?? []),
            JSON.stringify(rec.profile ?? {}),
            iso(rec.createdAt),
            iso(rec.deletedAt),
            rec.upgradeProof ?? null,
          ],
        );
        return 'ok';
      } catch (e) {
        return conflictOf(e);
      }
    },
    async updateAccount(id, patch) {
      const sets = [];
      const params = [id];
      for (const [k, v] of Object.entries(patch)) {
        const f = FIELD[k];
        if (!f) continue;
        params.push(f[1](v));
        sets.push(`${f[0]} = $${params.length}${k === 'providers' || k === 'profile' ? '::jsonb' : ''}`);
      }
      if (sets.length === 0) return 'ok';
      try {
        await db.query(`UPDATE auth_accounts SET ${sets.join(', ')} WHERE account_id = $1`, params);
        return 'ok';
      } catch (e) {
        return conflictOf(e);
      }
    },
    async removeAccount(id) {
      await db.query('DELETE FROM auth_accounts WHERE account_id = $1', [id]);
    },

    async identity(provider, subject) {
      return (await one('SELECT account_id FROM auth_identities WHERE provider = $1 AND subject = $2', [provider, subject]))?.account_id ?? null;
    },
    async putIdentity(provider, subject, accountId, now) {
      const r = await one(
        `INSERT INTO auth_identities (provider, subject, account_id, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, subject) DO UPDATE SET provider = EXCLUDED.provider
         RETURNING account_id`,
        [provider, subject, accountId, iso(now ?? Date.now())],
      );
      return r?.account_id === accountId ? 'ok' : 'conflict';
    },
    async dropIdentities(accountId) {
      await db.query('DELETE FROM auth_identities WHERE account_id = $1', [accountId]);
    },

    async putSession(s) {
      await db.query(
        `INSERT INTO auth_sessions (token_hash, account_id, device_token, created_at, last_used_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.tokenHash, s.accountId, s.deviceToken ?? null, iso(s.createdAt), iso(s.lastUsedAt), iso(s.expiresAt)],
      );
    },
    async session(hash) {
      const r = await one('SELECT token_hash, account_id, device_token, created_at, last_used_at, expires_at FROM auth_sessions WHERE token_hash = $1', [hash]);
      return r
        ? {
            tokenHash: r.token_hash,
            accountId: r.account_id,
            deviceToken: r.device_token,
            createdAt: msOf(r.created_at),
            lastUsedAt: msOf(r.last_used_at),
            expiresAt: msOf(r.expires_at),
          }
        : null;
    },
    async touchSession(hash, lastUsedAt, expiresAt) {
      await db.query('UPDATE auth_sessions SET last_used_at = $2, expires_at = $3 WHERE token_hash = $1', [hash, iso(lastUsedAt), iso(expiresAt)]);
    },
    async dropSession(hash) {
      await db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hash]);
    },
    async dropSessions(accountId) {
      await db.query('DELETE FROM auth_sessions WHERE account_id = $1', [accountId]);
    },

    async putToken(t) {
      await db.query(
        `INSERT INTO auth_tokens (token_hash, kind, account_id, data, created_at, expires_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [t.tokenHash, t.kind, t.accountId, JSON.stringify(t.data ?? {}), iso(t.createdAt), iso(t.expiresAt)],
      );
    },
    /** 한 번만 쓴다. 동시에 같은 토큰을 두 번 보내도 한쪽만 행을 받는다 */
    async useToken(hash, kind, now) {
      const r = await one(
        `UPDATE auth_tokens SET used_at = $3
          WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3
          RETURNING account_id, data`,
        [hash, kind, iso(now)],
      );
      return r ? { accountId: r.account_id, data: json(r.data) ?? {} } : null;
    },
    async dropTokens(accountId, kind) {
      if (kind == null) await db.query('DELETE FROM auth_tokens WHERE account_id = $1', [accountId]);
      else await db.query('DELETE FROM auth_tokens WHERE account_id = $1 AND kind = $2', [accountId, kind]);
    },

    async putOAuthState(st) {
      await db.query(
        `INSERT INTO auth_oauth_states (state_hash, provider, redirect_uri, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [st.stateHash, st.provider, st.redirectUri, iso(st.createdAt), iso(st.expiresAt)],
      );
    },
    /** 한 번만 쓴다. 제공자가 다르거나 만료·사용한 값이면 null */
    async useOAuthState(hash, provider, now) {
      const r = await one(
        `UPDATE auth_oauth_states SET used_at = $3
          WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > $3
          RETURNING redirect_uri`,
        [hash, provider, iso(now)],
      );
      return r ? { redirectUri: r.redirect_uri } : null;
    },

    /** 고정 창 카운터를 하나 올린다. 창이 지났으면 1부터 다시 */
    async hit(key, now, windowMs) {
      const r = await one(
        `INSERT INTO auth_attempts (key, count, window_start) VALUES ($1, 1, $2)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN auth_attempts.window_start <= $3 THEN 1 ELSE auth_attempts.count + 1 END,
           window_start = CASE WHEN auth_attempts.window_start <= $3 THEN EXCLUDED.window_start ELSE auth_attempts.window_start END
         RETURNING count, window_start`,
        [key, iso(now), iso(now - windowMs)],
      );
      return { count: Number(r.count), windowStart: msOf(r.window_start) };
    },
    /**
     * 연속 실패 예약(메모리 bumpFail과 같은 규칙). 한 문장으로 올리고 돌려받아 동시에 보낸 요청도 하나씩 센다.
     * 잠금 중이면 count만 올린다(max보다 커진다). count가 max가 되는 요청이 잠금을 건다. 잠금이 풀린 뒤엔 1부터
     */
    async bumpFail(key, now, max, lockMs) {
      const r = await one(
        `INSERT INTO auth_attempts AS a (key, count, window_start, locked_until)
           VALUES ($1, 1, $2, CASE WHEN 1 >= $3 THEN $4::timestamptz END)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN a.locked_until > $2 THEN a.count + 1
                        WHEN a.locked_until IS NOT NULL THEN 1
                        ELSE a.count + 1 END,
           window_start = CASE WHEN a.locked_until > $2 THEN a.window_start ELSE $2 END,
           locked_until = CASE WHEN a.locked_until > $2 THEN a.locked_until
                               WHEN (CASE WHEN a.locked_until IS NOT NULL THEN 1 ELSE a.count + 1 END) >= $3 THEN $4::timestamptz
                               ELSE NULL END
         RETURNING count, locked_until`,
        [key, iso(now), max, iso(now + lockMs)],
      );
      return { count: Number(r.count), lockedUntil: msOf(r.locked_until) };
    },
    async setLock(key, { fails, lockedUntil }, now) {
      await db.query(
        `INSERT INTO auth_attempts (key, count, window_start, locked_until) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET count = EXCLUDED.count, window_start = EXCLUDED.window_start, locked_until = EXCLUDED.locked_until`,
        [key, fails, iso(now), iso(lockedUntil)],
      );
    },

    async purge(now) {
      const at = iso(now);
      await db.query('DELETE FROM auth_sessions WHERE expires_at <= $1', [at]);
      await db.query('DELETE FROM auth_tokens WHERE expires_at <= $1 OR used_at IS NOT NULL', [at]);
      await db.query('DELETE FROM auth_oauth_states WHERE expires_at <= $1 OR used_at IS NOT NULL', [at]);
      await db.query(
        `DELETE FROM auth_attempts WHERE window_start <= $1 AND (locked_until IS NULL OR locked_until <= $2)`,
        [iso(now - 24 * 60 * 60 * 1000), at],
      );
    },
    async reset() {
      await db.query('TRUNCATE auth_attempts, auth_oauth_states, auth_tokens, auth_sessions, auth_identities, auth_accounts');
    },
  };
}
