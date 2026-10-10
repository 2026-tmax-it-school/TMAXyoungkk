-- 001 동기화 서버 첫 스키마(WP2). 서버 시작 때 server/db/migrate.mjs가 한 번만 적용한다.
--
-- 원천: trip_ops(여행방 이벤트 로그)와 invite_codes(초대 코드 색인).
-- 조회용 표: trips의 요약 열, trip_spots, trip_days, trip_legs. 로그에서 뽑으며 push와 같은 트랜잭션에서 갱신한다.
--   언제든 로그로 다시 만들 수 있다(server/db/projection.mjs). 정답은 앱이 로그를 접은 문서다.
-- 경로 캐시: route_cache(OSRM·카카오 응답 24시간).
-- 위치 표는 두지 않는다. 위치를 서버에 올리지 않는다(2026-10-09 결정).
--
-- 시각: 사람이 읽는 시각은 timestamptz, 나중 저장 우선 판정에 쓰는 op.at은 ms 그대로(bigint, jsonb 숫자) 둔다.
-- 날짜: KST 'YYYY-MM-DD'를 date로 둔다.

-- 여행방. 한 행이 seq 계수기이고(push가 이 행을 잠가 seq를 매긴다) 여행방 요약이다.
CREATE TABLE trips (
  trip_id           text PRIMARY KEY,
  room_no           bigint GENERATED ALWAYS AS IDENTITY,  -- 처음 받은 순서. 초대 조회가 이 순서로 훑는다
  last_seq          integer NOT NULL DEFAULT 0,
  first_received_at timestamptz NOT NULL,
  last_received_at  timestamptz NOT NULL,
  view_stale        boolean NOT NULL DEFAULT false,       -- 조회용 표 갱신이 실패했다. 다음 push나 보관 기한 정리 때 로그로 다시 만든다
  view_state        jsonb NOT NULL DEFAULT '{}',          -- 조회용 표 계산에만 쓰는 상태(방장 멤버 id, 모호 장소를 골랐는지)
  -- 요약(조회용)
  created           boolean NOT NULL DEFAULT false,       -- trip/create를 받았는지
  title             text,
  region            text,
  start_date        date,
  end_date          date,
  transport         text,
  day_start         text,
  day_end           text,
  created_by        text,
  created_at        timestamptz,
  deleted_at        timestamptz,
  invite_code       text,
  invite_issued_at  timestamptz,
  invite_expires_at timestamptz,
  invite_capacity   integer,
  invite_revoked_at timestamptz,
  retain_until      timestamptz                           -- 종료일 다음 날 00:00 KST + 365일. 이 시각부터 지운다
);
CREATE INDEX trips_retain_until_idx ON trips (retain_until) WHERE retain_until IS NOT NULL;
-- 생성 op를 받지 못한 방은 종료일을 몰라, 마지막으로 받은 뒤 365일이 지나면 지운다
CREATE INDEX trips_orphan_idx ON trips (last_received_at) WHERE NOT created;

-- 이벤트 로그. 여행방마다 받은 순서대로 seq를 매기고 같은 op id는 한 번만 받는다.
CREATE TABLE trip_ops (
  trip_id     text NOT NULL REFERENCES trips (trip_id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  op_id       text NOT NULL,
  type        text NOT NULL,
  received_at timestamptz NOT NULL,
  body        jsonb NOT NULL,                             -- 받은 op 그대로(seq 제외)
  PRIMARY KEY (trip_id, seq),
  UNIQUE (trip_id, op_id)
);

-- 초대 코드 색인. 발급된 적 있는 코드가 어느 방 것인지만 적는다. 판정은 그 방 로그로 한다.
CREATE TABLE invite_codes (
  code       text NOT NULL,
  trip_id    text NOT NULL REFERENCES trips (trip_id) ON DELETE CASCADE,
  issued_seq integer NOT NULL,
  PRIMARY KEY (code, trip_id)
);
CREATE INDEX invite_codes_trip_idx ON invite_codes (trip_id);  -- 방을 지울 때(CASCADE) 색인 전체를 훑지 않게

-- 장소(후보 스팟)와 스팟에 걸린 일정 편집(FR-503·505).
CREATE TABLE trip_spots (
  trip_id         text NOT NULL REFERENCES trips (trip_id) ON DELETE CASCADE,
  spot_id         text NOT NULL,
  place_id        text NOT NULL,
  name            text NOT NULL,
  category        text,
  kind            text,
  lat             double precision,
  lng             double precision,
  address         text,
  pinned          boolean NOT NULL DEFAULT false,
  stay_min        integer,
  fixed_date      date,                                   -- 날짜 지정
  manual_date     date,                                   -- 수동 순서: 그날 안의 자리
  manual_index    integer,
  arrive_override text,                                   -- 도착 시각 지정 'HH:MM'
  removed         boolean NOT NULL DEFAULT false,         -- 사용자가 뺀 후보(자동 제외는 기기 계산이라 없다)
  removed_reason  text,
  message_ids     text[] NOT NULL DEFAULT '{}',           -- 이 후보를 제안한 채팅 메시지(추출 되돌리기 판정)
  manual          boolean NOT NULL DEFAULT false,         -- 메시지에 묶이지 않은 제안(직접 추가)이 있는지
  created_at      timestamptz,
  edited          jsonb NOT NULL DEFAULT '{}',            -- 필드별 마지막 편집 op.at(ms)
  PRIMARY KEY (trip_id, spot_id)
);
CREATE INDEX trip_spots_place_idx ON trip_spots (trip_id, place_id);

-- 날짜별 일정 설정(FR-205): 기점, 복귀 없음, 활동시간, 그날 이동수단.
CREATE TABLE trip_days (
  trip_id       text NOT NULL REFERENCES trips (trip_id) ON DELETE CASCADE,
  trip_date     date NOT NULL,
  base_mode     text NOT NULL CHECK (base_mode IN ('set', 'firstSpot', 'inherit')),
  base_name     text,
  base_lat      double precision,
  base_lng      double precision,
  base_place_id text,
  no_return     boolean NOT NULL DEFAULT false,
  day_start     text,
  day_end       text,
  transport     text,
  edited        jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (trip_id, trip_date)
);

-- 경로: 구간별 이동수단 지정(FR-504). from_id·to_id는 spotId 또는 'base'.
CREATE TABLE trip_legs (
  trip_id   text NOT NULL REFERENCES trips (trip_id) ON DELETE CASCADE,
  trip_date date NOT NULL,
  from_id   text NOT NULL,
  to_id     text NOT NULL,
  transport text NOT NULL,
  cleared   boolean NOT NULL DEFAULT false,               -- 해제 묘비. 늦게 온 옛 지정이 나중 해제를 이기지 못하게 남긴다
  edited_at bigint,                                       -- 마지막 편집 op.at(ms)
  PRIMARY KEY (trip_id, trip_date, from_id, to_id)
);

-- 경로 응답 캐시(OSRM·카카오). 키는 부르는 쪽이 정한다. 24시간 지난 행은 보관 기한 정리 때 지운다.
CREATE TABLE route_cache (
  key        text PRIMARY KEY,
  response   jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX route_cache_created_at_idx ON route_cache (created_at);
