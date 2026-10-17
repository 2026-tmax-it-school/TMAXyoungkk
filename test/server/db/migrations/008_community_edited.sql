-- 커뮤니티 글 고치기(WP2 소유, 2026-10-17). 고친 시각(ms, epoch). 고친 적이 없으면 NULL이다.
-- 005·006은 이미 개발 DB에 적용돼 있어 고치지 않고 열을 더한다. 표의 RLS는 007_enable_rls.sql에서 켰고 열을 더해도 그대로다.
-- 올린 시각(created_at)과 피드 순서는 고쳐도 바뀌지 않는다(server/community.mjs POST /community/posts/:id/update).

ALTER TABLE community_posts
  ADD COLUMN edited_at bigint NULL;
