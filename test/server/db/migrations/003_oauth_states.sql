-- 실제 소셜 로그인(구글·카카오 OAuth) 요청 확인값(WP2 소유, 2026-10-10). server/auth.mjs POST /auth/oauth/state가 만들고
-- POST /auth/oauth/google·kakao가 한 번만 쓴다. 원문은 앱의 로그인 요청(state 파라미터)에만 있고 여기에는 SHA-256만 둔다.
-- 어느 제공자·어느 돌아올 주소로 시작한 요청인지 같이 둔다(다른 주소로 바꿔치기한 코드는 받지 않는다). 10분 뒤 만료.

CREATE TABLE auth_oauth_states (
  state_hash   text PRIMARY KEY,
  provider     text NOT NULL CHECK (provider IN ('google', 'kakao')),
  redirect_uri text NOT NULL,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX auth_oauth_states_expires_idx ON auth_oauth_states (expires_at);
