-- 커뮤니티(사진·일기 글, WP2 소유, 2026-10-10). 번호가 005인 이유: 같은 개발 DB에 다른 작업의 004(member_accounts)가 이미 적용돼 있어 겹치지 않게 했다. server/community.mjs와 server/db/community-store.mjs가 쓴다.
-- 계정과는 FK를 두지 않는다(auth 표 초기화가 이 표에 막히지 않게). 계정 탈퇴는 서버가 글을 직접 지운다(removeByAccount).
-- 사진 원본은 bytea로 둔다(프로토타입). 앱이 줄여서 올리고 서버는 개수·크기·파일 머리글을 본다.

CREATE TABLE community_posts (
  post_id         text PRIMARY KEY,
  account_id      text NOT NULL,
  user_id         text NOT NULL,
  author_nickname text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('photo', 'diary')),
  title           text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL
);
CREATE INDEX community_posts_feed_idx ON community_posts (created_at DESC, post_id DESC);
CREATE INDEX community_posts_account_idx ON community_posts (account_id, created_at DESC);

CREATE TABLE community_photos (
  photo_id   text PRIMARY KEY,
  post_id    text NOT NULL REFERENCES community_posts (post_id) ON DELETE CASCADE,
  idx        integer NOT NULL,
  mime       text NOT NULL,
  bytes      bytea NOT NULL,
  UNIQUE (post_id, idx)
);
