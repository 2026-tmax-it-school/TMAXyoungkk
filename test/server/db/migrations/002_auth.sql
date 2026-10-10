-- 계정·로그인(WP2 소유, 2026-10-10). server/auth.mjs와 server/db/auth-store.mjs가 쓴다.
-- 비밀번호는 scrypt(사람마다 salt) 결과만, 세션·메일 토큰은 SHA-256 해시만 둔다. 원문은 어디에도 남기지 않는다.
-- 탈퇴는 행을 지우지 않고 deleted_at을 찍은 뒤 이메일·닉네임·비밀번호·프로필을 비운다(익명화). 고유 색인은 탈퇴하지 않은 행만 본다.

CREATE TABLE auth_accounts (
  account_id        text PRIMARY KEY,
  user_id           text NOT NULL,
  email             text,
  nickname          text,
  password_hash     text,
  email_verified_at timestamptz,
  providers         jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL,
  deleted_at        timestamptz,
  -- 게스트 승격 확인값 SHA-256('guest:' || 기기 토큰). 같은 userId의 인증 전 가입은 이 값이 같을 때만 대체한다
  upgrade_proof     text
);

-- 이메일은 대소문자를 무시하고, 닉네임은 앞뒤 공백을 뺀 값을 대소문자 무시로 하나씩만
CREATE UNIQUE INDEX auth_accounts_email_uq ON auth_accounts (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX auth_accounts_nickname_uq ON auth_accounts (lower(nickname)) WHERE deleted_at IS NULL AND nickname IS NOT NULL;
-- 게스트 승격은 userId를 유지한다. 한 userId에 살아 있는 계정은 하나다
CREATE UNIQUE INDEX auth_accounts_user_uq ON auth_accounts (user_id) WHERE deleted_at IS NULL;

-- 소셜 신원(모의). 제공자 신원 하나에 계정 하나
CREATE TABLE auth_identities (
  provider   text NOT NULL,
  subject    text NOT NULL,
  account_id text NOT NULL REFERENCES auth_accounts (account_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX auth_identities_account_idx ON auth_identities (account_id);

-- 로그인 세션. token_hash = SHA-256(Bearer 토큰). 쓸 때마다 expires_at을 30일 뒤로 민다
CREATE TABLE auth_sessions (
  token_hash   text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES auth_accounts (account_id) ON DELETE CASCADE,
  device_token text,
  created_at   timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL
);
CREATE INDEX auth_sessions_account_idx ON auth_sessions (account_id);
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);

-- 이메일 인증·비밀번호 재설정·소셜 연동 확인 토큰. 한 번 쓰면 used_at을 찍는다
CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('verify', 'reset', 'link')),
  account_id text NOT NULL REFERENCES auth_accounts (account_id) ON DELETE CASCADE,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX auth_tokens_account_idx ON auth_tokens (account_id, kind);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);

-- 시도 제한 카운터. key는 'ip:…', 'email-ip:…', 'acct:…'(이메일 기준 연속 실패 잠금), 'mail:…'
CREATE TABLE auth_attempts (
  key          text PRIMARY KEY,
  count        integer NOT NULL,
  window_start timestamptz NOT NULL,
  locked_until timestamptz
);
