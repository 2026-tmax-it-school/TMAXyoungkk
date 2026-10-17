-- 커뮤니티 글 조회수·좋아요(WP2 소유, 2026-10-17). 글 행에 합계를 두고(피드가 한 번에 읽는다), 누가 눌렀는지는 따로 둔다.
-- 좋아요는 계정당 글 하나에 한 번. 조회는 같은 사람(로그인 계정 또는 접속 주소 해시)이 하루 한 번만 센다. 글 작성자 본인 조회는 세지 않는다.
-- 표의 RLS는 007과 같이 켠다(Data API로 읽히지 않게). 글을 지우면 눌린 기록도 함께 지워진다.

ALTER TABLE community_posts
  ADD COLUMN views integer NOT NULL DEFAULT 0,
  ADD COLUMN likes integer NOT NULL DEFAULT 0;

CREATE TABLE community_post_likes (
  post_id    text NOT NULL REFERENCES community_posts (post_id) ON DELETE CASCADE,
  account_id text NOT NULL,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX community_post_likes_account_idx ON community_post_likes (account_id);

CREATE TABLE community_post_views (
  post_id    text NOT NULL REFERENCES community_posts (post_id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  day        text NOT NULL,
  PRIMARY KEY (post_id, viewer_key, day)
);

ALTER TABLE community_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_post_views ENABLE ROW LEVEL SECURITY;
