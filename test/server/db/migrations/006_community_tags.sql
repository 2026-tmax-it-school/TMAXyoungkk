-- 커뮤니티 태그(WP2 소유, 2026-10-11). 글당 태그 0~5개(앱과 서버가 같은 규칙으로 맞춘 값, server/community.mjs normalizeTag).
-- 005_community.sql은 이미 개발 DB에 적용돼 있어 고치지 않고 열을 더한다. 예전 글은 빈 배열이다.
-- 태그 거르기(GET /community/posts?tag=)는 tags @> ARRAY[태그]로 묻고 GIN 색인을 탄다.

ALTER TABLE community_posts
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 5);
CREATE INDEX community_posts_tags_idx ON community_posts USING GIN (tags);
