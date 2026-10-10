# 끝난 기능 문서 메모
## 1. PostgreSQL 서버·DB
### 구현
요약: 동기화 서버(test/server)를 PostgreSQL로 영속화했다. 저장소는 메모리와 Postgres 두 가지이고 겉모양이 같다. DATABASE_URL이 없으면 기존 메모리 저장소(createSyncStore, 동기 메서드 그대로)를 쓴다. 있으면 server/db/postgres-store.mjs가 pg.Pool로 붙는다. 테스트는 같은 저장소를 PGlite로 돌린다. sqlDb()가 pg.Pool과 PGlite의 트랜잭션 방식을 {query, tx(fn → {query, exec})} 하나로 맞춘다.
스키마는 server/db/migrations/001_init.sql이고 migrate.mjs가 서버 시작 때 적용한다. 하나의 트랜잭션 안에서 pg_advisory_xact_lock을 먼저 잡고 schema_migrations를 확인하므로, 다시 돌려도 안전하고 서버 여러 대가 동시에 시작해도 한 번만 적용된다. 이미 적용한 파일이 바뀌면(체크섬 불일치) 시작을 멈춘다.
원천 데이터는 trip_ops(trip_id, seq, op_id는 방 안에서 유일, type, received_at, body jsonb)와 invite_codes(초대 코드 색인)다. 조회용 표는 trips 요약 열, trip_spots, trip_days, trip_legs이고 push와 같은 트랜잭션에서 갱신한다. 계산은 server/db/projection.mjs(순수 함수)가 op에 든 값만 옮긴다. 앱과 같은 op.at 나중 저장 우선, 구간 해제 묘비, placeId 병합, 메시지 단위 추출 되돌리기, 종료 잠금은 따르지만 권한 검증은 하지 않는다. 조회용 표 갱신은 SAVEPOINT 안에서 하므로, 실패해도 로그는 커밋되고 view_stale이 켜져 다음 push 때 로그 전체로 다시 만든다. route_cache 테이블도 만들었고 store.routeCache.get/put으로 24시간 캐시를 쓴다. 위치 테이블은 만들지 않았다.
seq는 trips 행을 INSERT … ON CONFLICT DO UPDATE로 잠근 뒤 매긴다. 같은 방에 동시에 push해도 seq가 겹치거나 비지 않는다. HTTP API의 응답 모양과 멱등 규칙은 그대로이고, GET /health → {ok, db}를 추가했다(DB에 못 닿으면 503). 요청 본문 오류는 400, 저장소 오류는 500이다. 보관 기한 정리는 서버 시작 때와 하루 한 번 돈다(종료일 다음 날 00:00 KST + 365일, 앱 retentionUntil과 같은 값). Postgres는 CASCADE로 로그·색인·표를 함께 지우고, 메모리 저장소도 같은 규칙으로 지운다. DATABASE_URL을 줬는데 붙지 못하면 서버는 오류 문구를 남기고 exit 1로 멈춘다(문구에 주소·비밀번호는 넣지 않는다). 직접 실행해서 이 실패 경로와 메모리 모드 /health를 확인했다.
초대 판정은 server/invites.mjs로 옮겼고 두 저장소가 같이 쓴다(sync-server.mjs에서 judgeInvite를 다시 내보낸다). 실행 스크립트(server, db:up, db:down), docker-compose(postgres:17-alpine), server/.env.example을 추가했다.
바꾼 파일: test/server/sync-server.mjs, test/server/sync-server.d.mts, test/server/invites.mjs, test/server/retention.mjs, test/server/retention.d.mts, test/server/db/projection.mjs, test/server/db/projection.d.mts, test/server/db/migrate.mjs, test/server/db/migrate.d.mts, test/server/db/postgres-store.mjs, test/server/db/postgres-store.d.mts, test/server/db/migrations/001_init.sql, test/server/docker-compose.yml, test/server/.env.example, test/package.json, test/tests/wp2-db.test.ts
게이트: npx tsc --noEmit: 오류 0건(작업 중 한때 tests/wp6-track.test.ts에 다른 에이전트 작업 중 오류 9건이 있었고, 다시 돌렸을 때 0건이 됐다). npm test: 676개 통과, 실패 0. wp2-*.test.ts는 113개(새 wp2-db 25개 포함)이고, 기존 wp2-sync 서버 테스트는 메모리 저장소로 바꾸지 않고 그대로 통과한다. '실제 PostgreSQL' 묶음은 YT_TEST_DATABASE_URL이 없어 건너뛰었다. node scripts/gate-scope.mjs WP2: 통과(tsc=ok, own-tests=ok, foundation-scoped=ok). 직접 실행 확인: DATABASE_URL=postgresql://…@127.0.0.1:1/… 이면 'sync-server 시작 실패: PostgreSQL에 연결하지 못했습니다(…): connect ECONNREFUSED' 문구와 함께 exit 1(비밀번호는 출력하지 않음). DATABASE_URL 없이 PORT=18787로 띄우면 GET /health → {"ok":true,"db":"memory"}이고, SIGTERM에 정상 종료한다.
doc_notes: [README 4. 그룹 동기화 서버를 교체할 내용]
- 메모리 모드(기존과 같음): npm run server. server/.env가 없거나 DATABASE_URL이 비어 있으면 메모리 저장이고 서버를 끄면 사라진다.
- PostgreSQL 모드: (1) npm run db:up (docker compose, postgres:17-alpine, 127.0.0.1:5432, 개발용 계정 youngtrip/youngtrip-dev/DB youngtrip, 볼륨 pgdata, --wait로 healthcheck까지 기다림) (2) cp server/.env.example server/.env (3) npm run server (= node --env-file-if-exists=server/.env server/sync-server.mjs). 끄기는 npm run db:down(데이터는 볼륨에 남는다). 시작 로그에 '저장: PostgreSQL|메모리'가 찍힌다.
- 서버 환경 변수(server/.env, 앱 번들과 무관): DATABASE_URL(있으면 Postgres, 붙지 못하면 시작 실패. 메모리로 바뀌지 않는다), PORT(기본 8787). 테스트 전용: YT_TEST_DATABASE_URL이 있으면 wp2-db 테스트가 실제 Postgres에서도 돈다(임시 스키마 yt_test_*를 만들고 끝나면 DROP하므로 기존 표는 건드리지 않는다). 예: YT_TEST_DATABASE_URL=postgresql://youngtrip:youngtrip-dev@127.0.0.1:5432/youngtrip npm test
- API 추가: GET /health → {ok, db:'postgres'|'memory'}(DB에 못 닿으면 503). 나머지 API의 모양, seq·멱등 규칙은 그대로다. 요청 본문 오류는 400, 저장소 오류는 500이다(앱은 둘 다 실패로 보고 다시 보낸다).
- 스키마: server/db/migrations/NNN_이름.sql. 서버 시작 때 schema_migrations를 보고 아직 안 한 번호만 적용한다(advisory 잠금과 트랜잭션 안이라 다시 돌려도, 동시에 시작해도 안전하다). 적용한 파일을 고치면 체크섬 불일치로 서버가 멈추므로, 스키마는 새 번호 파일을 더해 바꾼다.

[설계(추적표·README 설계 절)]
- 원천은 trip_ops(trip_id, seq, op_id는 (trip_id, op_id) 유일, type, received_at timestamptz, body jsonb)와 invite_codes(code, trip_id, issued_seq)다. 초대 조회는 색인으로 후보 방을 찾고, 판정은 그 방 로그로 한다(server/invites.mjs, 메모리와 같은 로직·순서). trips 행은 seq 계수기이면서 여행방 요약이다. push는 이 행을 INSERT … ON CONFLICT DO UPDATE로 잠그므로 같은 방 push는 차례로 처리된다.
- 조회용 표(역할분담 한동관 표: 여행방·장소·경로·일정): trips 요약(제목·지역·기간·수단·활동시간·생성자·삭제·현재 초대·retain_until), trip_spots(장소와 고정·체류·날짜 지정·수동 순서·도착 지정·제외, message_ids·manual), trip_days(기점 set/firstSpot/inherit, 복귀 없음, 활동시간, 그날 수단), trip_legs(구간 수단, cleared 묘비, edited_at). 시간표(plan)는 동기화하지 않고 기기마다 계산하므로 서버에 없다.
- 조회용 표는 server/db/projection.mjs가 op 값만 옮긴다. 리듀서를 복제하지 않는다. 따르는 규칙: 생성 전·삭제 뒤 op 무시, 종료일 지난 편집 무시, 필드별 op.at 나중 저장 우선(edited 맵), 구간 해제 묘비, placeId 병합, 추출 되돌리기는 메시지 단위. 하지 않는 것: 권한·멤버 여부·값 범위 검증, 제안자 목록, 채팅·멤버·사진·일기. 그래서 앱이 접을 때 버리는 op(권한 없는 편집, 경합으로 떨어진 op)도 이 표에는 들어갈 수 있다. 정답은 앱이 로그를 접은 문서이고 이 표는 조회·운영용이다. 정상 시나리오에서는 앱 foldOps 결과와 같은지 테스트로 맞춰 본다.
- 잘못된 값은 null로 바꿔 표에 넣는다. 표 갱신은 SAVEPOINT 안이라 실패해도 로그는 저장되고 trips.view_stale이 켜진다. 다음 push 또는 store.rebuildView(tripId)가 로그 전체로 다시 만든다.
- route_cache(key, response jsonb, created_at): 다음 기능(키 숨기는 서버)이 store.routeCache.get(key, now) / put(key, response, now)로 쓴다. 24시간이 지난 행은 get이 null을 주고, 보관 기한 정리 때 지운다. 메모리 저장소도 같은 API를 갖는다.
- 위치 표는 만들지 않았다(위치를 서버에 올리지 않는다는 결정).

[추적표 '데이터 보존' 행 갱신]
- 동기화 서버도 보관 기한 정리를 한다: 서버 시작 때와 하루 한 번, 종료일 다음 날 00:00 KST + 365일이 지난 여행방의 로그·초대 색인·조회용 표를 지운다(Postgres는 ON DELETE CASCADE, 메모리도 같은 규칙). 근거: server/retention.mjs(retentionUntil, 앱 tripStatus.retentionUntil과 같은 값을 테스트로 확인), server/sync-server.mjs(startSyncServer purge), tests/wp2-db.test.ts. README 한계 줄 '루프백 저장분과 동기화 서버는 정리하지 않는다'에서 동기화 서버를 빼고, 루프백 KV만 남긴다. README 4절의 '실서비스는 영속 저장과 인증, 보관 기한 정리를 갖춘 서버로' 문장은 '영속 저장·보관 정리는 있음, 인증은 없음'으로 바꾼다.

[한계(README 한계 절)]
- 서버에 인증이 없다(CORS *). 누구나 방 로그를 읽을 수 있고, POST /reset은 Postgres 모드에서도 여행방 표 전체를 비운다(시연 리셋. 경로 캐시는 남김). 공유 DB에서 시연 리셋을 쓰면 모두의 데이터가 지워진다.
- jsonb가 받지 못하는 NUL 문자와 짝 없는 서로게이트는 U+FFFD로 바꿔 저장한다(이 경우에만 받은 그대로 돌려주지 않는다).
- trip/create가 없는 방은 종료일을 몰라 정리하지 않는다. 정리된 방에 옛 기기가 op를 다시 보내면 생성 op 없는 방이 새로 생긴다.
- 실제 PostgreSQL로는 아직 돌려 보지 않았다(PGlite로 같은 SQL만 확인).
남은 문제: 실제 PostgreSQL에서는 테스트하지 않았다. 이 컴퓨터에는 실행 중인 Postgres가 없고, 규칙에 따라 docker도 띄우지 않았다. 같은 SQL은 PGlite로 확인했고, 실제 pg 드라이버 경로(Pool 트랜잭션, 연결 실패)는 가짜 풀로만 확인했다. 확인 방법: npm run db:up 후 YT_TEST_DATABASE_URL=postgresql://youngtrip:youngtrip-dev@127.0.0.1:5432/youngtrip npm test 와 server/.env를 둔 npm run server. / CI(.github/workflows/ci.yml)에 postgres 서비스를 붙여 YT_TEST_DATABASE_URL로 실제 Postgres 테스트를 돌릴지는 CI 묶음이 결정한다. 지금 CI에서는 PGlite만 돈다. / 서버 인증이 없다. POST /reset이 Postgres에서도 TRUNCATE를 하므로 공유 DB 운영 전에 막거나 인증을 붙여야 한다(API를 그대로 두라는 요구라 남겨 둠). / 조회용 표는 권한·멤버 검증을 하지 않는다. 앱이 버리는 op도 들어갈 수 있으며 정답은 앱 foldOps다(설계상 한계). / 보관 정리 뒤 옛 기기가 같은 방에 op를 다시 보내면 생성 op 없는 방이 생기고, 이 방은 종료일을 몰라 정리되지 않는다. 삭제한 방의 묘비가 필요한지는 결정이 필요하다. / package.json은 FOUNDATION 소유이고, 과업에 적힌 scripts 세 줄(server, db:up, db:down)만 더했다. db:up은 docker compose v2의 --wait를 쓴다. / README와 docs/FR-추적표.md는 고치지 않았다. 반영할 내용은 doc_notes에 적었다(추적표 '데이터 보존' 행, README 4절과 한계 줄 259·377).

### 수정
반영: 
- [정확성 major·규칙 minor·통합 minor] 시각·날짜 범위: projection ms()의 상한을 MAX_TIME_MS(KST 9999-12-31 23:59:59.999)로 낮췄다. retentionUntil은 기한이 상한을 넘으면 null을 준다. isDate는 1000년 이전을 받지 않는다. 범위 밖 시각은 표에 null로 넣고, 그런 시각의 op는 표에 옮기지 않는다. 이제 createdAt 1e15, at 8.64e15, endDate 9999-12-31이 와도 view_stale이 생기지 않고 retain_until도 남는다(PGlite·메모리 테스트)
- [정확성 major·규칙 minor·통합 minor] 보관 기한을 조회용 표 성공 여부와 떼어 놓았다: Postgres purgeExpired는 지우기 전에 같은 트랜잭션에서 view_stale인 방을 로그로 다시 만든다(SAVEPOINT). 다시 만들지 못하면 지난 표 값으로 판정하고 경고만 남긴다(테스트)
- [정확성 minor·통합 minor] 메모리 purgeExpired를 방마다 try/catch로 감쌌다. 실패한 방만 건너뛰고 warn으로 알린다. 경로 캐시 정리는 방 정리보다 먼저 따로 돈다(테스트)
- [정확성 minor·규칙 minor] server/ids.mjs storableId를 추가했다(문자열 1~200자, NUL·짝 없는 서로게이트 없음). 두 저장소 push가 이 규칙에 맞지 않는 tripId·op.id의 op를 건너뛰고, 그런 초대 코드는 색인에 적지 않는다. HTTP 경로의 tripId는 400, 초대 코드는 notFound로 끊는다(테스트)
- [규칙 minor] jsonText가 객체 키의 NUL·짝 없는 서로게이트도 U+FFFD로 바꾼다. 키가 잘못된 op가 섞여도 같은 배치의 정상 op는 저장된다(테스트)
- [정확성 minor] spot/resolveAmbiguous는 추출 기록에 있고 아직 고르지 않은 (messageId, phrase)만 한 번 받는다. 상태는 trips.view_state.picks에 둔다. 둘이 동시에 골라도 먼저 온 것만 남고, 앱 foldOps 결과와 같다(테스트)
- [정확성 minor] 001_init.sql에 invite_codes_trip_idx(trip_id)를 넣었다. 001은 아직 어디에도 적용되지 않아 001에 넣었다
- [정확성 minor·규칙 minor] 생성 op가 없는 방은 마지막으로 받은 뒤 365일이 지나면 지운다. 두 저장소 모두 적용했고 trips_orphan_idx와 ORPHAN_RETENTION_MS를 더했다(테스트)
- [규칙 major·통합 major] POST /reset 잠금: PostgreSQL 저장소는 기본으로 403 {error:'resetDisabled'}이고 아무것도 지우지 않는다. SYNC_ALLOW_RESET=1(startSyncServer({allowReset}), allowResetFromEnv)일 때만 허용하고, 메모리 모드는 그대로 허용한다. server/.env.example에 변수를 적었고 시작 로그에 리셋 허용 여부가 찍힌다(테스트: 기본 403·앱 reset 뒤에도 데이터 남음, allowReset이면 204)
- [규칙 minor] trip/update와 trip/delete는 방장이 보낸 것만 표와 보관 기한에 반영한다. 방장은 생성 때 role이 host였고 탈퇴하지 않은 멤버이며, view_state.hosts에 둔다. 멤버가 아닌 사람의 op 하나로 방이 일찍 지워지지 않는다(메모리·Postgres 테스트)
- [규칙 minor] 생성 op의 날짜 행은 기간 안에서 366개(MAX_VIEW_DAYS)까지만 옮긴다
- [규칙 minor·통합 minor] 계정 탈퇴 가리기를 추가했다(server/redact.mjs, 두 저장소). 본인이 보낸 member/anonymize가 있으면 그 멤버 닉네임을 로그 어디서든 '탈퇴한 멤버'로 바꾼다. 대상은 trip/create members, member/join, member/rename이고 탈퇴 뒤 늦게 온 op도 포함한다. journal/photoRemoved가 가리키는 앞선 photoAdded에서는 uri·coord·spotId·sim을 뺀다. op 유효성은 바꾸지 않는다. 앱이 가린 로그를 접은 문서가 가리기 전과 같은지, 남의 탈퇴·사진 삭제는 가리지 않는지 테스트로 확인했다
- [통합 minor] 실제 PostgreSQL 백엔드에 openPostgresStore 테스트를 더했다. 실제 pg 드라이버를 쓰고 search_path를 담은 연결 문자열로 마이그레이션·push·pull·health·close까지 본다. HTTP 묶음도 BACKENDS를 돌아 실제 DB에서 앱 HTTP 전송 흐름을 지난다(YT_TEST_DATABASE_URL이 있을 때만)
- [통합 minor] doc_notes를 보충했다: README 245~247·259·377·407, CONTRIBUTING 537~539, 추적표 '데이터 보존'·'탈퇴' 행, 처음 옮길 때와 DB를 비운 뒤의 시연 리셋, db:down과 down -v의 차이, pg 설치 방식
건너뜀: 
- [규칙 major의 추가 제안] POST를 Content-Type: application/json일 때만 받기: CORS가 모든 출처(*)와 Content-Type 헤더를 허용해서, 사전 요청을 거친 JSON POST가 그대로 통과한다. 그래서 다른 사이트 요청을 막는 효과가 없다. /reset은 PostgreSQL에서 기본 잠금으로 이미 막았다. 앱 http.ts는 이미 헤더를 보낸다
- [규칙 minor] tripId·op.id를 /^[A-Za-z0-9_-]{1,64}$/로 좁히기: 실제 실패 원인(NUL, 짝 없는 서로게이트, btree 행 상한)은 storableId(200자 상한)가 막는다. 더 좁히면 근거 없이 기존 id 모양을 거부하게 된다
- [규칙 minor] 원격 주소별 토큰 버킷(429): 인증이 없으면 속도 제한을 둬도 DB가 커지는 것을 막지 못한다(분당 120회 × 2MB). 같은 공유기 뒤 기기가 같은 주소로 보일 수 있다. 명세가 API를 그대로 두라고 했다. 인증과 함께 정할 일이라 한계와 open_issues에 남겼다
- [통합 minor] pg를 dependencies로 옮기기: package.json은 FOUNDATION 소유이고, 이 기능에서 허용된 변경은 scripts 세 줄뿐이다. open_issues와 doc_notes(서버 컴퓨터는 --omit=dev 없이 npm ci)에 남겼다
- [통합 major의 부수 지적] MoreScreen 시연 리셋 확인 문구: 화면은 내 범위 밖이다. PostgreSQL은 이제 기본으로 리셋을 막으므로 문구가 사실과 맞는다. 메모리 서버와 HTTP 동기화를 함께 쓸 때만 서버의 여행방도 지워진다. open_issues에 남겼다
- [통합 minor] README·CONTRIBUTING·docs/FR-추적표.md 직접 수정: 규칙상 마지막 문서 단계가 한다. 바꿀 내용은 doc_notes에 적었다
바꾼 파일: /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/redact.mjs (새 파일), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/redact.d.mts (새 파일), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/ids.mjs (새 파일), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/sync-server.mjs, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/sync-server.d.mts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/retention.mjs, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/retention.d.mts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/db/projection.mjs, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/db/projection.d.mts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/db/postgres-store.mjs, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/db/migrations/001_init.sql, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/.env.example, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/docker-compose.yml (주석만), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/wp2-db.test.ts
게이트: WP2 범위의 게이트는 모두 통과했다. 전체 tsc와 npm test에 남은 실패는 모두 범위 밖 파일 tests/wp5-background.test.ts에서 나온다. 30초 넘게 간격을 두고 세 번 돌렸는데 결과가 같았다. 위치·시뮬레이터 묶음이 작업 중인 파일이라 고치지 않았다.
- npx tsc --noEmit: 오류 5건, 모두 tests/wp5-background.test.ts다(BgRecordEnv에 backgroundMode가 없다, 인자에 running·today가 없다). WP2 파일 오류는 0건이다.
- npm test: 695개 중 689개 통과, 실패 5, 건너뜀 1이다. 실패 5개는 모두 tests/wp5-background.test.ts에 있다(그 파일만 돌려도 16개 중 5개 실패). 건너뛴 1개는 openPostgresStore 실제 드라이버 테스트로, YT_TEST_DATABASE_URL이 없으면 돌지 않는다. '실제 PostgreSQL' 묶음 두 개도 같은 이유로 건너뛴다.
- tests/wp2-*.test.ts: 126개 중 125개 통과, 건너뜀 1이다(wp2-db 38개).
- node scripts/gate-scope.mjs WP2: 통과(tsc=ok, own-tests=ok, foundation-scoped=ok).
- 새 파일 server/redact.mjs·redact.d.mts는 server/** 글롭 하나에만 걸려 WP2 소유다.
doc_notes: [README 4. 그룹 동기화 서버를 교체할 내용]
- 메모리 모드(기존과 같다): npm run server로 띄운다. server/.env가 없거나 DATABASE_URL이 비어 있으면 메모리에 저장하고, 서버를 끄면 사라진다. 이 모드의 시연 리셋은 서버의 여행방도 모두 지운다.
- PostgreSQL 모드 순서:
  (1) cp server/.env.example server/.env
  (2) npm run db:up. docker compose v2이고 postgres:17-alpine을 127.0.0.1:5432에 띄운다. 개발용 계정은 youngtrip/youngtrip-dev, DB는 youngtrip, 볼륨은 pgdata다. --wait로 healthcheck가 통과할 때까지 기다린다.
  (3) npm run server. node --env-file-if-exists=server/.env server/sync-server.mjs와 같다.
  (4) 앱 test/.env에 EXPO_PUBLIC_SYNC_URL=http://<이 컴퓨터 IP>:8787을 넣는다.
  시작 로그에 '저장: PostgreSQL|메모리, 시연 리셋: 허용|막음'이 찍힌다. 끌 때는 npm run db:down을 쓴다(데이터는 볼륨에 남는다). 데이터까지 비우려면 docker compose -f server/docker-compose.yml down -v를 쓴다.
- 처음 PostgreSQL로 옮겼거나 DB를 비운 뒤(down -v, 시연 리셋 허용, 메모리 서버 재시작)에는 기기마다 시연 리셋을 하거나 새 여행방을 만들어야 한다. 기기는 이미 확정된 op를 다시 보내지 않는다. 그래서 서버에 생성 op 없는 방이 생겨 초대 조회가 notFound가 되고, seq가 1부터 다시 매겨져 기기 로그와 겹친다.
- 서버 환경 변수(server/.env. 앱 번들과는 상관없다):
  - DATABASE_URL: 있으면 PostgreSQL이다. 붙지 못하거나 마이그레이션이 실패하면 시작하지 않고, 메모리로 바뀌지 않는다. 오류 문구에는 주소와 비밀번호를 넣지 않는다.
  - PORT: 기본 8787.
  - SYNC_ALLOW_RESET: PostgreSQL에서는 1일 때만 POST /reset을 허용한다. 기본은 막고 403을 준다. 앱 시연 리셋은 실패를 무시하고 이 기기만 비운다. 켜면 같은 DB를 쓰는 모든 사람의 여행방이 지워지므로 혼자 쓰는 DB에서만 켠다.
  - 테스트 전용 YT_TEST_DATABASE_URL: 있으면 wp2-db 테스트가 실제 PostgreSQL에서도 돈다. 저장소, 실제 드라이버로 연 openPostgresStore, HTTP 흐름까지 본다. 임시 스키마 yt_test_*를 만들어 쓰고 끝나면 DROP한다. 예: YT_TEST_DATABASE_URL=postgresql://youngtrip:youngtrip-dev@127.0.0.1:5432/youngtrip npm test
- pg는 devDependencies에 있다. 서버를 PostgreSQL로 돌릴 컴퓨터는 --omit=dev 없이 npm ci로 설치한다.
- API:
  - GET /health → {ok, db:'postgres'|'memory'}. DB에 닿지 못하면 503이다.
  - POST /reset → 204 또는 403 {error:'resetDisabled'}.
  - 나머지 API의 응답 모양과 seq·멱등 규칙은 그대로다.
  - 요청 본문이 잘못됐거나 경로의 tripId를 키로 쓸 수 없으면(NUL, 짝 없는 서로게이트, 200자 초과) 400이다. 저장소 오류는 500이다. 앱은 둘 다 실패로 보고 다시 보낸다. 키로 쓸 수 없는 초대 코드는 {error:'notFound'}다.
- 스키마는 server/db/migrations/NNN_이름.sql이다. 서버가 시작할 때 schema_migrations를 보고 아직 적용하지 않은 번호만 적용한다. advisory 잠금과 한 트랜잭션 안에서 돌아서, 다시 돌려도 동시에 시작해도 안전하다. 적용한 파일을 고치면 체크섬 불일치로 서버가 멈춘다. 스키마를 바꿀 때는 새 번호 파일을 더한다.
- 문장 교체: '저장은 메모리뿐이라 … 실서비스는 영속 저장과 인증, 보관 기한 정리를 갖춘 서버로 바꿔야 한다'를 'DATABASE_URL이 있으면 PostgreSQL에 영속 저장하고, 보관 기한 정리와 계정 탈퇴 가리기를 한다. 인증은 없어 실서비스 전에 붙여야 한다'로 바꾼다.

[README 다른 곳]
- 245~247 '서버가 없다' 항목: '기기 간 동기화는 메모리 전용 폴링 서버로만 되고'를 '기기 간 동기화는 선택 사항인 폴링 서버(server/sync-server.mjs. DATABASE_URL이 있으면 PostgreSQL 영속, 없으면 메모리)로 되고'로 바꾼다. 기기 간으로 확인하지 못했다는 문장은 그대로 둔다. 실제 PostgreSQL에서도 아직 돌려 보지 않았다.
- 259 한계 줄: '루프백 저장분과 동기화 서버는 정리하지 않는다'를 '루프백 KV 저장분은 정리하지 않는다'로 바꾼다. 동기화 서버는 이제 정리한다.
- 407 파일 트리:
  - server/sync-server.mjs의 설명을 '선택 사항인 그룹 동기화 폴링 서버(node:http, 저장은 메모리 또는 PostgreSQL)'로 바꾼다.
  - 새로 넣을 항목: server/db/(migrations/, migrate.mjs, postgres-store.mjs, projection.mjs), server/ids.mjs·invites.mjs·retention.mjs·redact.mjs, server/docker-compose.yml(개발용 PostgreSQL), server/.env.example.
- CONTRIBUTING.md 537~539(동기화 서버 우회 명령): 직접 실행 판정(isDirectRun)이 이제 공백과 한글이 든 경로를 처리한다. 우회 명령 대신 'npm run server'를 안내한다(server/.env를 읽고, PORT=로 포트를 바꾼다). 지금 우회 명령은 server/.env와 DATABASE_URL을 읽지 않아서 늘 메모리로 뜬다.

[설계(추적표·README 설계 절)]
- 원천 데이터:
  - trip_ops: trip_id, seq, op_id, type, received_at(timestamptz), body(jsonb). (trip_id, op_id)가 유일하다.
  - invite_codes: code, trip_id, issued_seq. trip_id에 인덱스가 있다.
  - 초대 조회는 색인으로 후보 방을 찾고, 판정은 그 방 로그로 한다(server/invites.mjs. 메모리와 같은 로직·같은 순서).
  - trips 행은 seq 계수기이면서 여행방 요약이다. push가 이 행을 INSERT … ON CONFLICT DO UPDATE로 잠그므로 같은 방 push는 차례로 처리된다.
- 키로 쓰는 값(tripId, op.id, 초대 코드, 스팟 id)은 server/ids.mjs storableId에 맞을 때만 받는다(문자열 1~200자, NUL과 짝 없는 서로게이트 없음). 맞지 않는 op와 색인은 건너뛴다. id 없는 op와 같은 처리이고, 두 저장소가 같다. 본문의 NUL과 짝 없는 서로게이트는 값이든 객체 키든 U+FFFD로 바꿔 저장한다.
- 조회용 표(역할분담의 한동관 표: 여행방·장소·경로·일정):
  - trips 요약 열: 제목·지역·기간·수단·활동시간·생성자·삭제·현재 초대·retain_until.
  - trip_spots: 고정·체류·날짜 지정·수동 순서·도착 지정·제외, message_ids·manual.
  - trip_days: 기점(set/firstSpot/inherit), 복귀 없음, 활동시간, 그날 수단.
  - trip_legs: 구간 수단, cleared 묘비, edited_at.
  - 계산에만 쓰는 상태(방장 멤버 id, 모호 장소를 골랐는지)는 trips.view_state(jsonb)에 둔다. 시간표(plan)는 기기마다 계산하므로 서버에 없다.
- 조회용 표는 server/db/projection.mjs가 op에 든 값만 옮긴다. 리듀서를 복제하지 않는다.
  - 따르는 규칙:
    - 생성 전 op와 삭제 뒤 op는 무시한다.
    - 종료일이 지난 편집은 무시한다. 방 삭제와 탈퇴는 예외다.
    - 필드마다 op.at 나중 저장 우선이다.
    - 구간 해제는 묘비로 남긴다.
    - 같은 placeId는 하나로 합친다.
    - 추출 되돌리기는 메시지 단위로 한다.
    - 모호 장소 고르기는 추출 기록에 있고 아직 고르지 않은 항목만 한 번 받는다. 둘이 동시에 고르면 먼저 온 것만 남는다.
    - 기간을 바꾸는 trip/update와 방 삭제는 방장(생성 때 role host, 탈퇴하지 않음)이 보낸 것만 받는다.
  - 하지 않는 것: 나머지 권한·멤버 여부·값 범위 검증, 제안자 목록, 채팅·멤버·사진·일기.
  - 그래서 앱이 버리는 op가 이 표에 들어갈 수 있다. 정답은 앱 foldOps 문서다. 정상 시나리오에서는 둘이 같은지 테스트로 맞춘다.
- 잘못된 값은 null로 넣는다: 문자열이 아닌 값, 없는 날짜, 1000년 이전 날짜, 서버가 다루는 시각 범위(0 ~ KST 9999-12-31 23:59:59.999) 밖의 시각. 범위 밖 시각의 op는 표에 옮기지 않는다. 생성 op의 날짜 행은 기간 안에서 366개까지만 옮긴다.
- 표 갱신은 SAVEPOINT 안에서 한다. 실패해도 로그는 저장되고 trips.view_stale이 켜진다. 다음 push, 보관 기한 정리, store.rebuildView(tripId)가 로그 전체로 표를 다시 만든다.
- route_cache(key, response jsonb, created_at): store.routeCache.get(key, now)와 put(key, response, now)로 쓴다. 24시간이 지난 행은 get이 null을 주고, 보관 기한 정리 때 지운다. 메모리 저장소도 같은 API다.
- 계정 탈퇴 가리기(server/redact.mjs, 두 저장소):
  - 본인이 보낸 member/anonymize가 있는 멤버는 로그 어디서든 닉네임을 '탈퇴한 멤버'로 바꾼다. 대상은 trip/create members, member/join, member/rename이고, 탈퇴 뒤 늦게 도착한 op는 받을 때 가린다.
  - 올린 본인이 보낸 journal/photoRemoved가 가리키는 앞선 photoAdded에서 uri·coord·spotId·sim을 뺀다.
  - op 유효성은 바꾸지 않는다. 무효인 닉네임은 ''로 바꾸고, 앱이 거부하는 blob:·data: 주소는 'data:,'로 바꾼다. 그래서 앱이 가린 로그를 접은 문서는 가리기 전과 같다(테스트).
  - 가리지 않는 것: 채팅 본문, userId(무작위 id), takenAt 같은 필수 필드. 삭제된 방도 가린다.
- 위치 표는 만들지 않았다(위치를 서버에 올리지 않는다는 결정).

[추적표 '데이터 보존' 행 갱신]
- 근거 파일 추가: server/retention.mjs(retentionUntil. 앱 tripStatus.retentionUntil과 같은 값인지 테스트로 확인), server/sync-server.mjs(startSyncServer purge, createSyncStore.purgeExpired), server/db/postgres-store.mjs(purgeExpired), server/redact.mjs.
- 테스트 추가(wp2-db):
  - 보관 기한 정리: 종료일 다음 날 00:00 KST + 365일부터 방과 로그·색인·표를 지운다
  - 생성 op 없는 방은 마지막으로 받은 뒤 365일이 지나면 지운다
  - 조회용 표가 밀린 방은 보관 기한 정리 전에 로그로 다시 만든다
  - 방장이 아닌 사람의 기간 변경·방 삭제는 … 보관 기한에 옮기지 않는다
  - 계정 탈퇴: 그 멤버 닉네임과 지운 사진의 주소·위치를 로그에서 가린다
- 남은 문제 교체: '동기화 서버(메모리 전용)는 보관 기한 정리를 하지 않는다'를 아래 내용으로 바꾼다.
  - 동기화 서버는 시작할 때와 하루 한 번, 종료일 다음 날 00:00 KST + 365일이 지난 방을 지운다(로그·초대 색인·조회용 표. Postgres는 ON DELETE CASCADE, 메모리도 같은 규칙). 생성 op 없이 마지막으로 받은 뒤 365일이 지난 방도 지운다.
  - 보관 기한은 방장의 기간 변경만 따른다.
  - 정리하지 않는 것은 루프백 KV 저장분뿐이다.
  - 정리된 방에 옛 기기가 op를 다시 보내면 생성 op 없는 방이 새로 생기고, 365일 뒤에 지운다(삭제 묘비는 없다).
- README 한계 줄 259와 4절 문장은 위 README 항목대로 바꾼다.

[추적표 '탈퇴' 행 갱신]
- 근거 파일 server/redact.mjs를 더한다. 테스트: wp2-db › 계정 탈퇴: … 앱이 접은 문서는 가리기 전과 같다, › 계정 탈퇴 가리기는 앱과 같은 상수를 쓰고, 이미 가린 로그는 더 바꾸지 않는다.
- 남은 문제 추가: 동기화 서버는 로그 본문에서 탈퇴한 멤버의 닉네임과 지운 사진의 주소·위치를 가린다. 다만 기기에 이미 내려받은 로그, 가리기 전에 다른 기기가 받아 간 값, 채팅 본문은 그대로 남는다.

[한계(README 한계 절)]
- 서버에 인증과 속도 제한이 없다(CORS *). 누구나 방 로그를 읽고 아무 tripId로 push할 수 있어서, PostgreSQL이 계속 커질 수 있다(제한은 요청 본문 2MB 상한뿐이다). 실서비스 전에 인증이 필요하다.
- 시연 리셋: 메모리 서버에서는 서버의 여행방을 모두 지운다. PostgreSQL은 기본으로 막는다(403). SYNC_ALLOW_RESET=1이면 여행방 표 전체를 비운다(경로 캐시는 남긴다).
- 받은 그대로 돌려주지 않는 경우가 둘 있다. jsonb가 받지 못하는 NUL 문자와 짝 없는 서로게이트는 U+FFFD로 바꿔 저장하고, 계정 탈퇴 가리기는 본문을 고친다.
- 서버가 다루는 시각 범위 밖 값(KST 10000년 이후)과 1000년 이전 날짜는 조회용 표에서 없는 값으로 둔다.
- 실제 PostgreSQL로는 아직 돌려 보지 않았다. PGlite로 같은 SQL만 확인했다.
남은 문제: 실제 PostgreSQL로는 아직 돌려 보지 않았다. 이 컴퓨터에 실행 중인 Postgres가 없고, 규칙에 따라 docker도 띄우지 않았다. 같은 SQL은 PGlite로 확인했고, 실제 pg 드라이버 경로는 테스트(openPostgresStore 실제 드라이버, HTTP 묶음)만 만들어 두었다. 확인 방법: npm run db:up 뒤 YT_TEST_DATABASE_URL=postgresql://youngtrip:youngtrip-dev@127.0.0.1:5432/youngtrip npm test를 돌리고, server/.env를 둔 채 npm run server를 실행한다 / CI(.github/workflows/ci.yml)에 postgres 서비스를 붙여 YT_TEST_DATABASE_URL로 실제 Postgres 테스트를 돌릴지는 CI 묶음이 정한다. 지금 CI에서는 PGlite만 돈다 / 서버에 인증과 속도 제한이 없다(CORS *). 누구나 로그를 읽고 아무 방에 push할 수 있다. 공유 DB로 운영하기 전에 인증(또는 최소한 방별 비밀)과 속도 제한을 정해야 한다 / pg가 devDependencies에 있어 npm ci --omit=dev로 설치한 서버는 DATABASE_URL을 주면 'Cannot find package pg'로 멈춘다. package.json은 FOUNDATION 소유라 옮기지 않았다. dependencies로 옮기자고 제안한다(Metro는 import하지 않는 패키지를 번들에 넣지 않는다) / MoreScreen 시연 리셋 확인 문구는 '이 기기의 …'다. 메모리 동기화 서버와 HTTP 동기화를 함께 쓰면 서버의 모든 여행방도 지워지는데, 문구에 이 점이 없다. 화면 소유 쪽에서 문구를 보완할지 정해야 한다. PostgreSQL은 기본으로 리셋을 막으므로 문구가 사실과 맞다 / 정리된 방의 삭제 묘비(purged_trips)가 필요한지 결정이 필요하다. 지금은 생성 op 없는 방을 마지막으로 받은 뒤 365일이 지나면 지우는 규칙으로만 처리한다 / 조회용 표는 방장 기간 변경을 뺀 나머지 권한·멤버 검증을 하지 않는다. 앱이 버리는 op도 표에 들어갈 수 있다(설계상 한계, 정답은 앱 foldOps) / 001_init.sql을 이번 단계에서 고쳤다(view_state, invite_codes_trip_idx, trips_orphan_idx). 아직 어디에도 적용하지 않았다고 보고 001에 넣었다. 누군가 이전 001을 로컬 Postgres에 이미 적용했다면 체크섬 불일치로 서버가 멈추므로, docker compose -f server/docker-compose.yml down -v로 비워야 한다 / 범위 밖 실패: tests/wp5-background.test.ts에서 tsc 오류 5건과 테스트 실패 5건이 난다(BgRecordEnv.backgroundMode, running·today 인자). 위치·시뮬레이터 묶음이 작업 중인 것으로 보여 고치지 않았다. 간격을 두고 세 번 다시 돌려도 같았다 / 이 수정 단계는 사용량 한도로 한 번 끊겼다가 이어서 했다. 끊기기 전에 반영된 수정(ids, 시각 범위, 리셋 잠금, 방장 규칙, 모호 고르기, 생성 op 없는 방 정리, 실제 드라이버 테스트)은 코드를 열어 확인하고 테스트를 다시 돌렸다. 이번에 이어서 계정 탈퇴 가리기를 더했다. files_changed는 두 부분을 합친 이번 단계 전체 목록이다

## 4. 동선 기록 1차 수정
반영: 
- [blocker, 리뷰 3건 공통] tests/wp5-background.test.ts를 지금 설계에 맞게 다시 썼다(17개에서 24개). backgroundMode를 지웠고, bgRecordSub에 running·today를 넘기며, '전날 밤'은 false(오늘 날짜만)로 바꿨다. 화면 밖 샘플은 track·visit만 내고 arrivalNotice·delay·freeTime·shadow는 내지 않는다고 단언한다. 정규식은 target·startBg·syncWatch·watchPlan 기준으로 바꿨다. 지금 tsc 0건이고 테스트는 모두 통과한다.
- [major, 정확성·통합] 화면 밖 도착 판정은 지금 코드대로 둔다(ingestAway의 stepArrival 유지). 도착은 방문 op와 진행 기록 줄로 남고, 도착 알림은 화면 밖에서도 돌아와서도 띄우지 않는다. 지연 조정안과 빈 시간 추천은 앱으로 돌아온 뒤 계산한다. 이유: 이렇게 해야 화면 밖에서 들른 곳이 돌아온 뒤 '건너뜀'이나 지연 조정안 대상이 되지 않고, 화면 문구('동선과 도착을 남김')와도 맞는다. 이에 맞춰 core/live/background·engine 주석, store 머리 주석, doc_notes, 결정 항목을 고쳤다.
- [major] LiveTripScreen 하단 설명의 '도착 알림과 지연 조정안은 앱으로 돌아와서 봅니다'를 '화면 밖 도착은 알림 없이 진행 기록에 남고, 지연 조정안은 앱으로 돌아와서 봅니다'로 고쳤다.
- [major, 규칙·통합] 순수 로직 테스트를 더했다. watchPlan 표(device·sim·manual·off × 화면 밖 × bgActive × 오늘·자정 넘김·전날 밤, block), bgFailReason 코드·메시지 매핑과 BG_FAIL_LINE, bgRecordEndsAt, throttleBatch의 pending과 flushPending, ingestAway 화면 밖 도착(정확한 arrivedAt, 머문 뒤 떠날 때 들어온 시각으로 도착), 기록 중 tickAt이 5분 넘은 샘플을 믿는 규칙과 꺼져 있을 때 믿지 않는 대조, noteLivePermission이 수동·허용된 기기 진행에서 sim 기록을 지우는 규칙, clearSimTrackDay가 기기 점을 남기는 것, liveStopReason과 LIVE_STOP_TEXT.
- [major, 통합] 안드로이드 자정 정지 문제를 고쳤다. backgroundWatchRequest(intervalMs, platform)로 바꿔 안드로이드는 30초 간격에 거리 조건 0, iOS는 20m로 받는다. 안드로이드는 화면 밖에서 JS 타이머가 멈추지만 30초마다 샘플이 와서, onSample의 날짜 확인이 자정 뒤 첫 샘플에서 받기를 멈춘다.
- [minor, 규칙] throttleBatch가 같은 묶음 안에서 멈춘 자리를 잃던 문제를 고쳤다. 샘플마다 '들고 있던 샘플 뒤로 30초 동안 샘플이 없었으면 먼저 넘긴다'로 바꿨다. flushPending도 같은 기준(now - pending.t >= 30초)으로 맞췄고, 어댑터 타이머는 pending 시각 + 30초에 돈다. 계속 움직이면 30초 간격이 그대로 유지된다(테스트 있음). 리뷰 프로브 [0초, 10초, 1800초]는 이제 공백 0이다.
- [minor, 규칙] onSample에서 엔진이 받은 샘플이거나 지금 last보다 늦은 샘플일 때만 last를 바꾼다. 뒤늦게 넘어온 멈춘 자리 때문에 지도 점과 조정안 위치가 뒤로 튀지 않는다.
- [minor, 규칙] 진행 날짜 전날 밤에 시작한 진행 문제를 고쳤다. onTick의 시계 판정에서 기기 모드면 늘 syncWatch를 부르므로, 앱이 떠 있는 채 자정이 지나면 그때 백그라운드 받기를 켠다. 화면 밖이었으면 돌아올 때 켠다.
- [minor, 정확성·통합] 권한 창 문제를 고쳤다. setBgRecord(true)가 enable()을 기다리는 동안 모듈 플래그 askingBg를 세우고, onAppState는 그동안 오는 inactive·background를 무시한다. 응답과 active 이벤트의 순서가 정해져 있지 않으므로 끝난 직후 AppState.currentState로 다시 맞추지 않는다(소스 규칙 테스트).
- [minor, 정확성·통합] '켜짐' 진행 기록 줄은 이제 startBg 안에서만, 받기를 실제로 켤 때 한 번 남긴다(진행 시작, 옵션 켜기, 자정 넘김, 앱 복귀). notToday 줄은 kstDate(now)가 진행 날짜와 다를 때만 남긴다.
- [minor, 정확성] noteLivePermission은 기기 거부를 진행 날짜가 오늘일 때만 남긴다. 다른 날짜에 남은 옛 기기 기록은 그날 수동 진행, 허용된 진행, 거부 진행 때 지우거나 덮는다. wp6-record-map에 '출발 전 앞날 거부, 그날 수동 진행이면 noLog' 테스트를 더했다.
- [minor, 통합] onTripsChange는 화면 밖에서 그날 입력(ctx)만 바꾸고 evaluateAt·applyEffects를 건너뛴다. 화면 밖에서 경로 요청이나 주변 조회가 생기지 않는다.
- [minor, 통합] applyEffects가 last·track·log·freeTime·엔진 값을 set 한 번으로 묶어 바꾼다. 그래서 샘플 하나에 persist 쓰기가 한 번만 일어난다(소스 규칙 테스트: applyEffects 안 set 1개, pushLog·syncEngine 호출 없음).
- [minor, 통합] 안드로이드 13 이상 알림 권한을 처리했다. app.config.js android.permissions에 POST_NOTIFICATIONS를 넣었다. enable()은 항상 허용 다음에 PermissionsAndroid로 알림 권한을 묻는다. 거부해도 기록은 켜지고, noticeHidden으로 토스트(BG_NOTICE_HIDDEN_TEXT)를 띄운다. 새 의존성은 없다.
- [minor, 정확성] 바꾼 파일 목록에 test/src/core/live/session.ts(liveStopReason, LIVE_STOP_TEXT)를 넣었고 테스트를 더했다.
건너뜀: 
- [minor, 통합] src/services/sync/http.ts 동기화 폴링이 화면 밖에서도 도는 문제: WP2 범위(server·sync 묶음)라 고치지 않았다. open_issues에 WP2 요청으로 적었다.
- [major 대안, 정확성] '화면 밖 판정을 하지 않으려면 ingestAway에서 stepArrival을 뺀다'는 방안은 쓰지 않았다. 리뷰가 둘 중 하나를 고르라고 했고, 위 반영 항목 이유대로 화면 밖 도착 기록을 유지했다. 대신 테스트·주석·doc_notes를 그 동작에 맞췄다.
- [minor 일부, 정확성] '권한 창이 끝난 뒤 그 구간을 따로 처리' 방안은 쓰지 않았다. 권한 응답과 active 이벤트의 순서가 정해져 있지 않아, 끝난 직후 맞추면 같은 문제가 다시 생긴다. 묻는 동안 무시하는 플래그만 쓴다. 그래서 묻는 중에 사용자가 설정 화면에서 홈으로 나가 있던 구간은 화면 밖으로 처리하지 않는다(open_issues에 적음).
바꾼 파일: /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/core/live/background.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/core/live/engine.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/core/live/throttle.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/core/live/track.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/core/live/session.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/core/journal/recordMap.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/store/live.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/services/location/background.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/services/location/device.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/services/location/index.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/screens/LiveTripScreen.tsx, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/screens/RecordMapScreen.tsx, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/features/live/bgRecordText.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/src/features/live/components/BgRecordCard.tsx, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/app.config.js, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/index.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/wp5-background.test.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/wp6-record-map.test.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/wp6-track.test.ts
게이트: test/ 에서 돌린 결과다. npx tsc --noEmit은 0건이다. npm test는 706개 중 705개 통과, 0개 실패, 1개 건너뜀이다. 건너뛴 1개는 실 Postgres 테스트로, YT_TEST_DATABASE_URL이 없으면 건너뛰고 수정 전부터 그랬다. 수정 전에는 695개 중 5개가 실패했고 모두 wp5-background였다. 이제 wp5-background 24개, wp6-record-map 1개(새로 추가)를 포함해 모두 통과한다. node scripts/gate-scope.mjs WP5는 통과다(tsc=ok, own-tests=ok 8개 파일, foundation-scoped=ok). WP6도 통과다(tsc=ok, own-tests=ok 4개 파일, foundation-scoped=ok). foundation 테스트 105개(디자인 규칙, 소유권, process.env 포함)도 통과한다. 회귀를 잡는지 보려고 throttleBatch의 묶음 안 멈춘 자리 처리와 watchPlan의 '화면 밖에서는 새로 켜지 않음' 조건을 일부러 빼 보았다. 두 경우 모두 새 테스트가 실패했고, 원래 소스로 되돌렸다. 개발 서버, 브라우저, export는 규칙대로 띄우지 않았다.
doc_notes: [사용법]
- 여행 진행(19)에 '백그라운드 동선 기록' 줄이 보인다.
  - 더보기(18) '기기 위치 사용'이 켜져 있어야 보인다(기본 꺼짐).
  - 시작 전에는 진행 방식 카드 아래, 기기 위치로 진행하는 중에는 진행 기록 위에 있다.
  - 시뮬레이터·수동 진행 중에는 보이지 않는다.
  - 받기가 돌고 있으면 기기 위치 설정과 상관없이 보여서 언제든 끌 수 있다.
- 기본은 꺼짐이다. 켤 때만 권한을 묻는다.
  - 순서는 앱 사용 중 허용, 항상 허용, 그다음 알림(안드로이드 13 이상)이다.
  - 알림을 거부해도 기록은 켜진다. '동선 기록 중' 알림이 알림창에 보이지 않는다는 토스트가 뜬다.
- 웹, Expo Go, 작업 관리자가 없는 빌드에서는 누를 수 없고 '개발 빌드 필요' 같은 이유를 보여준다.
  - 빌드에 백그라운드 위치 설정이 빠진 것은 받기를 시작할 때 오류로 알게 된다. 그때 옵션을 끄고 진행 기록에 이유를 남긴다.
- 확인은 개발 빌드로 한다: npx expo run:ios, npx expo run:android, 또는 EAS development build.
  - app.config.js를 바꿨으므로 개발 빌드를 다시 만들어야 반영된다.

[동작]
- 오늘 날짜를 기기 위치로 진행할 때만 돈다(core/live/background bgRecordRuns).
  - 지난 날짜나 앞날로 진행하면 쓰지 않는다. 진행 기록에 '오늘 날짜가 아니라 백그라운드 기록은 쓰지 않음'을 남긴다.
  - 진행 날짜 전날 밤에 시작해 앱을 켜 둔 채 자정이 지나면 시계 틱이 그때 켠다. 화면 밖에 있었으면 앱으로 돌아올 때 켠다.
- 어느 받기를 돌릴지는 core/live/background watchPlan이 정하고, 스토어(syncWatch)는 그 결과를 따르기만 한다.
  - 앱 안 감시는 앱이 떠 있을 때만 돈다.
  - 백그라운드 받기는 화면 밖에서 새로 켜지 않는다(안드로이드 12부터 화면 밖에서 포그라운드 서비스를 띄울 수 없다).
  - 앱이 떠 있는 동안은 두 받기가 함께 돈다.
- 받기는 Location.startLocationUpdatesAsync 하나로 한다(작업 이름 young-trip-bg-location).
  - 요청 값(core/live/throttle backgroundWatchRequest): iOS는 20m 이동마다, 안드로이드는 거리 조건 없이 30초 간격이다.
  - 몰아서 온 샘플은 throttleBatch가 시간순으로 30초에 1개만 넘긴다.
  - 30초 간격 안이라 넘기지 않은 마지막 샘플이 있으면, 그 뒤로 30초 동안 샘플이 없을 때 멈춘 자리로 넘긴다. 같은 묶음, 다음 묶음, 타이머(flushPending) 어느 경우든 같다.
  - iOS는 상태 막대에 위치 사용 표시가 뜬다.
  - 안드로이드는 포그라운드 서비스 알림 'Young Trip 동선 기록 중'이 뜨고, 앱을 닫으면 서비스도 닫힌다(killServiceOnDestroy).
- 화면 밖 샘플 처리:
  - 위치 로그(useLive.track)에 들어간다. 정지 건너뜀 규칙은 앱 안과 같다.
  - 도착도 판정한다. 스팟 반경 100m 안에 3분 넘게 머물면 반경에 들어온 시각으로 도착을 남긴다. 방문 기록(journal/visit op)은 앱 안 도착처럼 여행방에 동기화되며 좌표는 없다. 진행 기록에는 '○○ 도착' 줄이 남는다. 그 앞의 남은 스팟은 건너뜀이 된다.
  - 도착 알림(토스트)은 화면 밖에서도, 돌아와서도 띄우지 않는다.
  - 지연 조정안과 빈 시간 추천은 화면 밖에서 내지 않는다. 앱으로 돌아온 뒤 첫 시계 판정이 계산한다.
  - 화면 밖에서 다른 멤버가 일정을 바꿔도 다시 계산하지 않는다(경로 요청·주변 조회 없음).
  - 기록 중에는 마지막 샘플이 5분 넘게 지났어도 믿는다. 화면 밖에서 스팟에 들어가 멈춰 있었다면 돌아온 첫 틱에 도착이 잡힌다.
- 공백 판정:
  - 켜져 있는 동안 화면 밖에 있던 구간은 공백이 아니다. 기록 지도에서 실선으로 이어진다.
  - 화면 밖에서 기록이 끊기거나 늦게 켜지면 그 시각이 공백의 경계가 된다(setRecording).
  - 꺼져 있으면 예전처럼 공백(점선)으로 남는다.
- 옵션을 켤 때 권한 창 때문에 바뀌는 앱 상태(iOS inactive, 안드로이드 설정 화면의 background)는 화면 밖으로 보지 않는다.
- 받기가 멈추는 때:
  - 여행 진행 끝내기·리셋
  - 옵션 끄기
  - 진행 날짜가 지남. iOS는 자정 타이머로, 안드로이드는 자정 뒤 첫 샘플(30초 안)에서 멈춘다.
  - 앱 닫기
  - 로그아웃·탈퇴, 기기 위치 진행 중 '기기 위치 사용' 끄기, 여행방 삭제·나가기. 이때는 진행 자체를 끝내고 토스트로 알린다(core/live/session liveStopReason).
  - 받기 오류: '항상 허용' 회수, 기기 위치 꺼짐, 빌드 설정 없음. 옵션을 끄고 진행 기록에 이유를 남긴다.
- 진행을 시작할 때 '항상 허용'이 거둬져 있으면 묻지 않고 옵션을 끈 뒤 진행 기록에 한 줄 남긴다.
- '켜짐' 진행 기록 줄은 받기를 실제로 켤 때 한 번만 남긴다.
- 위치는 서버로 보내지 않는다. 90일 보관 규칙은 그대로다.

[저장]
- useLive persist에 두 필드를 추가했다. 추가만 했으므로 STORAGE_VERSION은 그대로다.
  - denied: tripId → date → { at, source: 'device' | 'sim' }
  - bgRecord: 옵션 값
- bgActive(지금 받기가 도는지)는 저장하지 않는다.
- 데모 리셋을 하면 둘 다 초기화된다.
- 샘플 하나를 처리할 때 set을 한 번만 불러 저장 쓰기도 한 번이다.

[날짜별 권한 거부(FR-704 S9 해소)]
- 시뮬레이터나 기기로 시작하려다 권한이 없어 수동 진행이 되면 그 날짜에 남긴다(core/live/track noteLivePermission).
  - 사용자가 수동 진행을 고른 것은 거부가 아니다.
  - 기기 거부는 진행 날짜가 오늘일 때만 남긴다. 출발 전에 앞날 일정을 미리 시작해 보다 거부한 것은 남기지 않는다.
  - 그날 남은 기기 거부 기록은 처음 시각을 지키고 지우지 않는다.
  - 시뮬레이터 거부 기록은 그날을 다시 진행하면(시뮬레이터, 수동, 허용된 기기) 지우거나 덮는다. 기기 거부를 시뮬레이터가 덮지는 않는다.
  - 시뮬레이터를 다시 재생하면 그날 시뮬레이터 위치 점만 지우고 기기 점은 남긴다(clearSimTrackDay).
- 기록 지도(22)는 지금 권한 상태가 아니라 이 기록을 읽는다.
  - 지난 날짜에도 '이 날은 위치 권한이 없어 도착 지점만 순서대로 이었습니다'라고 안내한다.
  - 시뮬레이터 프리셋 거부면 시뮬레이터 안내도 함께 뜬다.
  - 거부한 날이라도 나중에 허용해 위치 로그가 생기면 로그를 쓰고 거부 안내는 띄우지 않는다.
- 거부 기록은 위치 로그와 같은 규칙(pruneTracks, isTrackExpired)으로 90일 뒤 지운다.

[기록 지도 색(FR-804 D5 해소)]
- 계획 선은 공유 dayColor를 쓴다: 1일 잉크, 2일 청회색, 3일 초록, 4일부터 앰버.
- 실제 이동 점은 파랑(mapC.user)이라 어느 날짜 선과도 겹치지 않는다.
  - 9월 29일 모노톤 개편 뒤로 '넷째 날부터 같은 색'은 이미 재현되지 않았다. 추적표 메모가 낡은 것이었다.
- 남아 있던 진짜 겹침을 고쳤다.
  - 1일째 잉크 계획 선 위에 잉크 공백 점선이 겹쳐 점선이 보이지 않았다.
  - 계획 선이 잉크인 날은 점선을 청회색으로 그린다(gapLineColor).
  - 범례도 모델 색(plannedColor, gapColor)을 그대로 쓴다.

[앱 설정]
- app.config.js의 expo-location 설정:
  - isIosBackgroundLocationEnabled, isAndroidBackgroundLocationEnabled, isAndroidForegroundServiceEnabled를 true로 켰다.
  - locationAlwaysAndWhenInUsePermission, locationAlwaysPermission에 한국어 문구를 넣었다.
- android.permissions에 POST_NOTIFICATIONS를 넣었다.
- index.ts가 앱 등록 전에 src/services/location/background를 불러와 작업을 정의한다.
  - Expo Go·웹에서는 expo-task-manager를 불러오지 않는다.
- 새 환경 변수는 없다.

[FR-추적표 갱신 제안]
- FR-704: 남은 문제를 '없음'으로 바꾼다. 파일에 src/services/location/background.ts를 추가한다.
- FR-804: 결정 대기 메모를 위 색 설명으로 바꾼다.
- 백그라운드 행: '옵션(기본 꺼짐)으로 오늘 날짜 기기 위치 진행 중 화면 밖 동선과 도착 기록(알림 없음, 조정안은 앱에서). 꺼져 있으면 지금처럼 공백'으로 바꾼다.
- 테스트 이름에 tests/wp5-background.test.ts와 tests/wp6-record-map.test.ts를 추가한다.

[한계]
- 화면 밖 도착은 알림이 없다. 지연 조정안과 빈 시간 추천은 앱으로 돌아와야 본다.
- 오늘 날짜만 기록하고, 자정을 넘기면 멈춘다. 전날 밤에 미리 켰다면 자정에 앱이 떠 있거나 앱으로 돌아와야 켜진다.
- 앱을 닫으면 기록도 끝난다.
- 권한을 묻는 중에 사용자가 앱을 떠나 있던 구간(안드로이드 설정 화면에서 홈으로 나감)은 화면 밖으로 처리하지 않는다.
남은 문제: 실기기 확인이 필요하다(app.config.js를 바꿨으니 개발 빌드부터 다시 만든다). iOS: '항상 허용' 요청, 화면 밖 위치 수신, 상태 막대 위치 표시, 권한 창이 떠 있는 동안 진행 기록이 정상인지(공백·'앱으로 돌아옴' 줄이 안 생기는지). 안드로이드: '항상 허용' 설정 화면 흐름, 13 이상 알림 권한 요청과 '동선 기록 중' 알림, 앱을 닫으면 서비스가 닫히는지(killServiceOnDestroy), 14 위치 유형 포그라운드 서비스, 화면 밖 30초 샘플 전달, 자정 뒤 첫 샘플에서 멈추는지, 배터리. 규칙상 개발 서버·시뮬레이터·export를 띄우지 않아 런타임에서는 한 번도 돌려 보지 않았다. / Expo Go와 웹에서 import만으로 앱이 깨지지 않는지는 코드 구조와 소스 규칙 테스트로만 확인했다. Expo Go·웹에서는 require 자체를 하지 않는다. 실제 실행 확인은 남아 있다. / store/live.ts 연결부(startBg, syncWatch, onTick의 syncWatch, askingBg, onAppState, setBgRecord, onTripsChange의 화면 밖 처리, applyEffects를 set 한 번으로 묶은 것)는 zustand·RN에 의존해 node 테스트가 없다. 소스 정규식으로만 본다. 실기기에서 켜기, 끄기, 화면 밖에 다녀오기, 자정 넘기기, 진행 끝내기 흐름을 확인해야 한다. / 결정이 필요한 것: (1) 옵션 값(bgRecord)을 저장하므로, 다음 기기 진행 때 '항상 허용'이 남아 있으면 다시 묻지 않고 자동으로 켜진다. 진행마다 새로 켜게 할지 정해야 한다. (2) 화면 밖 도착은 방문 op로 기록되고 여행방에 동기화되지만 알림은 없다. 이 정책을 확정해야 한다. 화면 밖 도착 알림이 필요하면 로컬 알림 정책과 의존성이 함께 필요하다. (3) 오늘 날짜만 쓰고 자정을 넘기면 멈춘다. 전날 밤에 미리 켠 진행은 자정에 앱이 떠 있거나 앱으로 돌아와야 켜진다. / WP2 요청: iOS에서 백그라운드 기록이 켜져 있으면 앱이 화면 밖에서도 살아 있다. 그동안 src/services/sync/http.ts 동기화 폴링(pollMs 2500, SYNC_URL이 있을 때)이 시간당 약 1,440번 돈다. AppState가 active가 아닐 때는 폴링을 멈추거나 간격을 크게 늘리고, 돌아오면 바로 한 번 당기도록 WP2에서 고쳐야 한다. / 출시 전 할 일: App Store 백그라운드 위치 사용 사유, Google Play 백그라운드 위치 권한 신고. 안드로이드 포그라운드 서비스 알림 아이콘(androidForegroundServiceIcon)은 정하지 않아 기본 아이콘이 쓰인다. / 더보기(18, WP1 MoreScreen)의 위치 설정 영역에는 백그라운드 기록 상태가 보이지 않는다(내 범위 밖). 필요하면 WP1에서 상태 줄을 추가한다. / 버려지는 샘플 정도를 실기기에서 봐야 한다. iOS가 여러 위치를 한 번에 늦게 넘기면 이미 받은 시각보다 이른 샘플은 버린다. 앱을 다시 켤 때 넘어오는, 시작 60초 전보다 오래된 위치도 버린다. 멈춘 자리 한 점만 30초보다 촘촘할 수 있다. / 참고: 이번 기능은 서버·DB를 건드리지 않는다. 위치를 서버에 올리지 않는다는 결정에 따라 동선과 거부 기록은 이 기기의 AsyncStorage에만 있다. 방문 op에는 좌표가 없다. git diff로는 내 변경만 골라낼 수 없다. files_changed는 기능 4 전체 목록이고, 이번 수정 단계에서 손댄 파일은 throttle.ts, background.ts(core·services), engine.ts, track.ts, store/live.ts, LiveTripScreen.tsx, bgRecordText.ts, app.config.js, wp5-background.test.ts, wp6-record-map.test.ts다. session.ts는 앞 단계에서 바뀌었는데 목록에서 빠져 있어 이번에 넣었다.

## 6. CI 마지막 수정
반영: 
- [blocker, 3건 공통] db 잡의 '건너뛴 서버 DB 테스트가 없는지' 단계가 이제 모든 '# SKIP'을 잡지 않는다. 두 경우만 걸린다. (1) 이름에 '실제 PostgreSQL'이 든 묶음 안의 SKIP(묶음 자체, 하위 테스트, before 실패 뒤의 'not ok … # SKIP' 포함) (2) 사유에 YT_TEST_DATABASE_URL이 들어간 SKIP. 판정은 TAP 들여쓰기를 따라가는 awk 한 줄로 한다. 그래서 wp2-db.test.ts의 PGlite 전용 openPostgresStore 건너뜀으로는 더 이상 빨강이 되지 않는다. 다른 팀 파일인 wp2-db.test.ts를 고치지 않고 CI 쪽을 좁혔다(리뷰 1·3의 2번 방안). 빈 TAP이나 TAP이 없는 경우는 그대로 실패한다.
- [major, 리뷰 2] foundation-ci.test.ts에 실제 tests/wp2-*.test.ts를 쓰는 회귀 테스트를 더했다. 잡의 테스트 명령을 그대로 두 번 돌리는데, 한 번은 연결이 바로 거절되는 YT_TEST_DATABASE_URL(127.0.0.1:1)을 넘기고 한 번은 주소 없이 돌린다. 주소가 있으면 건너뜀 검사가 0이고 걸린 줄도 없어야 한다. 주소가 없으면 1이고 걸린 줄이 하나 이상 있어야 한다. 옛 엄격 가드로 되돌려 보니 이 테스트가 실패하는 것을 확인했다. 이제 db 잡을 빨강으로 만들 SKIP은 check 잡과 로컬 npm test에서 먼저 잡힌다.
- [major, 리뷰 2] 합성 픽스처 테스트를 새 의미에 맞춰 다시 썼다. 통과해야 하는 경우는 PGlite 전용 SKIP이다. 실패해야 하는 경우는 다음과 같다: 실 DB 묶음 SKIP, 안쪽 테스트 SKIP, before 실패 뒤 SKIP, 사유에 변수 이름이 든 SKIP, TAP 없음, 빈 TAP. '결과 검사' 체인에는 PGlite 묶음 안 드라이버 전용 SKIP이 [0,0,0]으로 통과하는 경우를 더했다. 가드를 고의로 4가지로 망가뜨려 보니 각각 테스트가 잡았다. 실험 뒤 파일은 바이트 단위로 원래대로 되돌렸다.
- [minor, 리뷰 3] CONTRIBUTING의 'Reproduce locally' 블록을 잡과 같은 명령 세 개로 바꿨다. TAP 기록 옵션이 붙은 테스트 명령, 건너뜀 검사, 실 DB 묶음 통과 검사다. 두 검사는 exit가 개발자 셸을 닫지 않게 ( ) 하위 셸로 감쌌다. foundation-ci에 '재현 블록 = 잡 명령' 비교 테스트를 더했고, 블록을 일부러 어긋나게 바꾸면 이 테스트가 실패하는 것을 확인했다.
- [blocker 부속] CONTRIBUTING 'What CI runs'의 db 표 2행과 설명 문단을 새 가드에 맞췄다. 실 DB 묶음 두 개의 이름을 적었다. 다른 테스트·묶음 이름에는 '실제 PostgreSQL'을 쓰지 않는다는 규칙과, PGlite 묶음 안의 드라이버 전용 건너뜀은 무시한다는 점을 적었다. npm test가 이 검사를 미리 돌린다는 한 줄도 더했다.
- [major, 리뷰 3] 필수 검사 적용 순서를 적었다. Repository settings에는 '`db`는 develop에서 한 번 통과한 뒤에만 필수'를 넣었다. 체크리스트 2행 표 칸은 'rulesets requiring `check`; `db` joins after it passes on develop'로 바꿨다. 2행 아래에는 순서 문단을 더했다: (1) GitFlow 트리거와 check만 있는 ci.yml PR (2) server/db/와 tests/wp2-db.test.ts가 든 WP2 PR (3) db 잡을 더하는 ci.yml PR. 그 뒤 db가 develop push에서 초록이 되면 필수 검사에 더한다. 협업규칙.md '처음 한 번'에도 같은 순서를 한 줄로 요약했다.
- [minor, 리뷰 1] 백머지 앞에 분기를 넣었다. 6. Merging 블록에 `git fetch origin && git rev-list --count origin/develop..origin/release/v0.1.0` 줄과 주석을 더했다(0이면 GitHub가 PR을 거절하므로 브랜치를 지우고 멈춘다). Tags and phases 문단에도 같은 조건을 적었다: fix 커밋이 없고 merge origin/main이 Already up to date였던 릴리스는 develop PR 대신 브랜치를 지운다. 'so main and develop share history'는 사실에 맞게 고쳤다: main은 develop과 같은 커밋을 갖고, main의 머지 커밋은 다음 release의 git merge origin/main으로 develop에 들어온다.
- [minor, 리뷰 1] 핫픽스 명령 블록에서 push와 gh pr create 사이에 `git add <paths> && git commit -m "fix(<scope>): <설명>"   # after fixing` 줄을 넣었다. GitHub는 커밋이 없는 PR을 거절한다는 주석도 달았다. 머지 커밋으로 main 이력에 남기 때문에 빈 커밋으로 초안을 여는 방식은 쓰지 않았다.
- [minor, 리뷰 3] 보고와 doc_notes를 지금 상태에 맞게 새로 썼다. foundation-ci 테스트는 16개이고 가드는 TAP 기반 두 단계다. wp2-db.test.ts는 이미 있다. 루트 One-time setup 문단, 65행, 협업규칙 '처음 한 번'은 이미 고쳐져 있다. test/README 73행과 루트 README 브랜치 표를 어떻게 고칠지는 doc_notes에 넣었다.
건너뜀: 
- 리뷰 1·2·3의 1번 방안(wp2-db.test.ts에서 openPostgresStore를 `if (backend.real) test(...)`로 실 DB에서만 등록)은 쓰지 않았다. 이 파일은 WP2 범위이고 서버 묶음 에이전트가 동시에 고치고 있어 내 범위 밖이다. CI 쪽 가드를 좁히는 방안을 골랐다. WP2가 나중에 그렇게 바꿔도 새 가드와 테스트는 그대로 통과한다.
- 리뷰 2가 제안한 단언('주소 없이 돌린 TAP의 모든 SKIP 사유에 YT_TEST_DATABASE_URL이 든다')은 그대로 넣지 않았다. 새 가드에서는 PGlite 전용 SKIP의 사유에 변수 이름이 없어도 정상이라 이 단언은 맞지 않는다. 대신 더 직접적인 검사를 넣었다. 연결이 바로 거절되는 주소를 넘겨 실 DB 묶음을 실제로 돌리고, 건너뜀 검사가 0이고 걸린 줄이 없는지 본다. 주소가 없을 때는 가드가 실 DB 묶음을 잡는지 본다.
- 리뷰 1이 예로 든 백머지 한 줄 `[ ... -gt 0 ] || { echo; git push origin --delete ...; }`는 쓰지 않았다. 터미널에 붙여 넣으면 브랜치를 지운 뒤에도 다음 줄 gh pr create가 그대로 실행된다. 그래서 개수만 출력하고, 0이면 브랜치를 지우고 멈추라는 주석을 단 형태로 넣었다. 지적한 내용 자체는 반영했다.
- 리뷰 3이 언급한 test/README.md 73행과 루트 README.md 브랜치 표는 고치지 않았다. 작업 규칙상 README는 마지막 문서 단계가 고친다. 고칠 내용은 doc_notes에 넣었다.
바꾼 파일: /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/workflows/ci.yml, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/CONTRIBUTING.md, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/협업규칙.md, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/foundation-ci.test.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/pull_request_template.md (구현 단계에서만 바뀜, 이번 수정 단계에서는 그대로)
게이트: - npx tsc --noEmit: 오류 5건이고 모두 tests/wp5-background.test.ts에 있다(위치·시뮬레이터 묶음이 작업 중인 다른 팀 파일). 내 파일은 0건이다. 시간을 두고 다시 돌려도 결과가 같았다.
- npm test: 697개 중 691개 통과, 5개 실패, 1개 건너뜀. 실패 5개는 모두 wp5-background.test.ts의 '스토어/어댑터/엔진/웹과 Expo Go/진행 날짜' 테스트다. 다시 돌려도 같았다. 건너뜀 1개는 wp2-db의 PGlite 전용 openPostgresStore 테스트다.
- tests/foundation-ci.test.ts: 16개 모두 통과, 약 2.8초. 이 가운데 실제 wp2 파일을 돌리는 테스트가 약 2초다.
- 다른 foundation-* 테스트(디자인 규칙, 소유권 포함)도 모두 통과했다.
- node scripts/gate-scope.mjs WP2: 통과(tsc는 WP2 파일 0건, wp2 테스트 파일 4개 통과, YT_SCOPE=WP2 foundation 7개 통과).
- YAML은 PyYAML로 파싱했다. db 잡의 run 4개가 그대로 읽히고 on.push와 on.pull_request도 맞다. 새 가드에는 YAML 주석 시작(` #`)도 `: `도 없다.
- 새 awk 가드를 돌려 본 결과:
  - 주소 없는 TAP: exit 1. 실 DB 묶음 두 줄만 걸렸다.
  - 거절되는 주소를 넘긴 TAP: exit 0.
  - 실 DB 묶음 안에서 before가 실패한 합성 TAP: 하위 SKIP 3줄이 걸려 exit 1.
- 변형 검사: 옛 엄격 가드 1번, 묶음 범위 제거, 사유 변수 제거, 'not ok' 제거, 재현 블록 어긋남을 만들어 보니 각각 테스트가 실패했다. 실험한 파일은 cmp로 원래대로 돌아온 것을 확인했다.
- actionlint는 설치되어 있지 않아 돌리지 못했다. awk는 macOS BSD awk(20200816)로만 실행해 봤다.
doc_notes: 브랜치 규칙(GitFlow) 요약
- main: 배포용이다. release와 hotfix 머지만 받고, 머지할 때마다 main의 머지 커밋에 annotated 태그(v0.1.0 등)를 단다. 태그는 main에만 단다.
- develop: 통합용이고 기본 브랜치가 된다. 체크리스트 2행에서 main을 한 번 머지 커밋으로 합친 뒤에 바꾼다.
- 둘 다 직접 push하지 않는다. PR로만 넣고, 상대 개발자 승인 1개와 초록 CI가 있어야 한다.
- 기능: feature/<이니셜>/<타입>-<범위>. 예: feature/dh/feat-route-finding. 타입은 feat·fix·refactor·chore·docs다. develop에서 따서 develop으로 PR을 열고 Squash로만 머지한다(gh pr merge --squash --delete-branch).
- 릴리스: release/vX.Y.Z. 마일스톤 마감일에 dh가 develop에서 따고, git merge origin/main을 한 번 한다. 릴리스 브랜치에는 fix·docs 커밋만 넣는다. 제목 'chore(app): vX.Y.Z 릴리스'로 main에 PR을 열어 머지 커밋(--merge)으로 머지하고, main에 태그를 단다. 그다음 같은 브랜치를 develop으로 PR해 머지 커밋으로 머지한다. 단 develop에 없는 커밋이 있을 때만 그렇게 한다. git rev-list --count origin/develop..origin/<브랜치>가 0이면 GitHub가 PR을 거절하므로 브랜치만 지운다. 릴리스 PR은 400줄 제한과 이슈 규칙에서 빠진다.
- 핫픽스: hotfix/vX.Y.Z. main의 최신 태그에서 따고, 고친 커밋 하나를 만든 뒤에 PR을 연다. 마무리는 릴리스와 같다(main에 머지 커밋, 태그, 같은 브랜치를 develop으로). 이슈는 develop PR만 닫으므로 그 PR에 'Closes #'를 쓴다.
- 되돌림: feature/<이니셜>/fix-revert-<범위>로 develop에 PR한다. 이미 main에 나간 변경이면 hotfix로 되돌린다.
- 바뀐 이름: 예전 <이니셜>/<타입>-<범위>는 이제 feature/<이니셜>/<타입>-<범위>다. release·hotfix 이름에는 v가 붙은 버전을 쓴다.

CI(.github/workflows/ci.yml)
- 트리거: main, develop, feature/**, release/**, hotfix/**로의 push와, main·develop으로 가는 PR. permissions는 contents: read이고 키나 저장소 secret은 쓰지 않는다.
- 잡 check: npm ci, tsc, npm test, 웹 번들 빌드, ttf 4개. 단계는 바뀌지 않았다.
- 잡 db: postgres:17-alpine 서비스를 띄우고 YT_TEST_DATABASE_URL=postgres://yt:yt@localhost:5432/yt_test를 넘긴다. 이 계정은 잡 안에서만 쓰고 버린다. tests/wp2-*.test.ts를 파일 하나씩(--test-concurrency=1) 돌리고 TAP을 /tmp/yt-db.tap에 남긴다. 결과 검사는 두 가지다.
  (1) 건너뜀 검사. TAP이 없거나 비면 실패한다. 이름에 '실제 PostgreSQL'이 든 묶음 안에서 무엇이든 건너뛰었거나, 사유에 YT_TEST_DATABASE_URL이 든 건너뜀이 있으면 실패한다. PGlite 묶음 안의 실제 드라이버 전용 건너뜀(openPostgresStore)은 보지 않는다.
  (2) '실제 PostgreSQL' 묶음 가운데 SKIP 없이 통과한 줄이 있어야 한다.
  그래서 실 DB 묶음 이름에만 '실제 PostgreSQL'을 쓴다. 지금은 wp2-db.test.ts의 'PostgreSQL 저장소(실제 PostgreSQL)'와 'HTTP 서버 + PostgreSQL 저장소(실제 PostgreSQL)'다.
- 잡 이름 check와 db는 필수 검사 이름이므로 바꾸지 않는다.
- 로컬 재현(test/에서): npm run db:up을 한 뒤, CONTRIBUTING 'Reproduce locally' 블록의 명령 세 개를 그대로 돌린다. 첫 줄은 TAP 기록 옵션이 붙은 테스트 명령이고, 두 검사는 하위 셸에서 돈다.
- npm test(foundation-ci)는 연결이 바로 거절되는 주소로 실제 wp2 파일에 건너뜀 검사를 미리 돌린다. 그래서 db를 빨강으로 만들 건너뜀은 check 잡에서 먼저 드러난다.

저장소 설정(사람이 할 일, CONTRIBUTING Repository settings와 체크리스트 2행)
- 기본 브랜치는 develop. 머지 커밋 on, squash on(둘 다 PR 제목), rebase off, 자동 브랜치 삭제 off.
- develop과 main에 ruleset을 하나씩 둔다. 허용 머지 방식은 develop이 Squash와 Merge, main이 Merge만이다.
- 필수 검사는 처음에 check만 건다. develop에 다음 순서로 넣는다: (1) GitFlow 트리거와 check만 있는 ci.yml PR (2) server/db/와 tests/wp2-db.test.ts가 든 WP2 PR (3) db 잡을 더하는 ci.yml PR. db가 develop push에서 한 번 초록이 된 뒤 두 ruleset의 필수 검사에 db를 더한다. 그보다 먼저 걸면 모든 PR이 막힌다.

커밋 범위: db(WP2: sync, server/)는 범위 표와 훅의 scopes= 양쪽에 이미 있어서 더하지 않았다.

문서 단계에서 고칠 것
- test/README.md 73행 'CI도 같은 세 단계와 ttf 4개 검사를 돈다'를 바꾼다. check 잡은 같은 세 단계와 ttf 4개를 돌고, db 잡은 실 PostgreSQL(postgres:17-alpine)로 tests/wp2-*.test.ts를 돈다는 내용으로 쓴다. 트리거(main·develop·feature/**·release/**·hotfix/** push, main·develop PR)와 로컬 재현 위치(CONTRIBUTING 'Reproduce locally')도 넣는다.
- 루트 README.md의 '브랜치 전략 (Git Flow)' 표(feature/<기능>, release/<버전>, hotfix/<내용>)는 지금 origin/main(99e3905)에만 있다. 체크리스트 2행의 main→develop 동기화가 끝난 뒤, main 쪽 내용을 바탕으로 새 이름 feature/<이니셜>/<타입>-<범위>, release/vX.Y.Z, hotfix/vX.Y.Z로 고친다. 동기화 전에 develop에서 루트 README를 고치면 첫 릴리스의 git merge origin/main에서 충돌하므로 그 전에는 건드리지 않는다.
- 새 테스트: tests/foundation-ci.test.ts(FOUNDATION, 16개). 워크플로 구조, 트리거와 동시 실행 그룹, db 잡 명령과 두 결과 검사(합성 픽스처와 실제 wp2 파일 양쪽), 로컬 재현 블록, PR 템플릿, 커밋 범위, 브랜치 이름 정규식, 커밋 제목 검사, 직접 push 검사가 CONTRIBUTING.md와 맞는지 본다.
남은 문제: tsc 오류 5건과 npm test 실패 5건은 모두 tests/wp5-background.test.ts에 있다. 위치·시뮬레이터 묶음이 작업 중인 다른 팀 파일이라 고치지 않았고, 다시 돌려도 결과가 같았다. / 새 db 건너뜀 가드(awk)는 macOS BSD awk로만 돌려 봤다. ubuntu-latest의 awk(mawk 또는 gawk)에서는 돌려 보지 않았다. POSIX 기능(match, index, substr, ERE)만 썼다. actionlint가 없고 GitHub에서도 아직 돌려 보지 않았다. / 필수 검사 적용 순서를 지키려면 지금 작업 트리의 ci.yml을 사람이 두 PR로 나눠야 한다. 먼저 트리거·permissions·concurrency와 check 잡만 담은 PR, WP2 DB PR 뒤에 db 잡을 더하는 PR이다. ruleset·기본 브랜치·머지 방식 설정도 사람이 해야 한다. 설정 화면 이름은 GitHub에서 확인하지 않았다. / WP2(서버 묶음)에 알릴 제약이 있다. 실 DB 묶음 이름에만 '실제 PostgreSQL'을 쓰고, PGlite 묶음의 테스트 이름에는 이 글자를 넣지 않는다. 넣으면 그 테스트를 PGlite에서 건너뛸 때 db 잡이 빨강이 된다. 실 DB에서만 의미 있는 테스트는 `if (backend.real) test(...)`로 등록하는 편이 더 깔끔하지만 지금 상태로도 통과한다. / foundation-ci의 실제 wp2 파일 테스트는 127.0.0.1의 1번 포트가 연결을 바로 거절한다는 것을 전제로 한다. 이 테스트 때문에 npm test가 약 2초 늘어난다. / 브랜치 이름이 feature/<이니셜>/... 형식으로 바뀌었고, release·hotfix PR은 머지 커밋으로 머지한다. GitFlow를 맞추려고 내린 결정이니 dh가 확인해야 한다. / .githooks/commit-msg가 아직 없다(체크리스트 4행). GitFlow 전에 직접 push한 커밋(develop d2a485e, main 99e3905)은 직접 push 검사의 시작점 뒤로 빼 두었다. / README 두 개(루트, test)는 문서 단계 몫이라 고치지 않았다. 고칠 내용은 doc_notes에 있다.
