-- 공유한 여행 일정(WP2 소유, 2026-10-17). server/itineraries.mjs와 server/db/itinerary-store.mjs가 쓴다.
-- 장소·날짜별 순서만 올린다(채팅·사진·멤버·위치 기록은 올리지 않는다). 계정과는 FK를 두지 않는다. 탈퇴하면 서버가 직접 지운다.
-- 조회수는 사람(계정 또는 IP)마다 하루에 한 번만 센다. 좋아요는 계정마다 하나다. 가져온 수는 '이 일정으로 여행방 만들기'를 끝낸 횟수다.

CREATE TABLE shared_itineraries (
  share_id        text PRIMARY KEY,
  account_id      text NOT NULL,
  user_id         text NOT NULL,
  author_nickname text NOT NULL,
  title           text NOT NULL,
  region_id       text NOT NULL,
  region_label    text NOT NULL DEFAULT '',
  note            text NOT NULL DEFAULT '',
  tags            text[] NOT NULL DEFAULT '{}',
  day_count       integer NOT NULL,
  place_count     integer NOT NULL,
  plan            jsonb NOT NULL,
  views           integer NOT NULL DEFAULT 0,
  likes           integer NOT NULL DEFAULT 0,
  imports         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL
);
CREATE INDEX shared_itineraries_new_idx ON shared_itineraries (created_at DESC, share_id DESC);
CREATE INDEX shared_itineraries_account_idx ON shared_itineraries (account_id, created_at DESC);
CREATE INDEX shared_itineraries_tags_idx ON shared_itineraries USING GIN (tags);

CREATE TABLE shared_itinerary_likes (
  share_id   text NOT NULL REFERENCES shared_itineraries (share_id) ON DELETE CASCADE,
  account_id text NOT NULL,
  PRIMARY KEY (share_id, account_id)
);

CREATE TABLE shared_itinerary_views (
  share_id   text NOT NULL REFERENCES shared_itineraries (share_id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  day        text NOT NULL,
  PRIMARY KEY (share_id, viewer_key, day)
);

ALTER TABLE shared_itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_itinerary_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_itinerary_views ENABLE ROW LEVEL SECURITY;
