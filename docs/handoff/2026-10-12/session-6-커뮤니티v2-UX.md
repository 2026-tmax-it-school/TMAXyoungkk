# 세션 6 인계 — 커뮤니티 v2(진행 중 끊김)와 앱 전체 UX 점검 (2026-10-11~12)

다음 세션은 `HANDOFF.md` "지금 상태" → `docs/handoff/2026-10-10/session-5-디자인-병합.md` → 이 파일 순서로 읽는다.
작업 폴더는 **`/Users/handong-gwan/TMAXyoungkk`**, 브랜치 **`feature/dh/feat-community`**(PR #10). 아무것도 커밋하지 않았다.

## PR 상태

| PR | 내용 | CI | 상태 |
| --- | --- | --- | --- |
| [#9](https://github.com/2026-tmax-it-school/TMAXyoungkk/pull/9) `feature/dh/feat-trip-edit` | 방장 여행방 설정 수정, 채팅 메뉴(...)에서 열기 | check·db 통과 | sezurchoe 리뷰 요청, 병합 대기 |
| [#10](https://github.com/2026-tmax-it-school/TMAXyoungkk/pull/10) `feature/dh/feat-community` | 커뮤니티 v1(사진·일기 글, 서버 저장) | check·db 통과 | sezurchoe 리뷰 요청, 병합 대기. #9 먼저 |

- CONTRIBUTING: `feat` PR은 직접 병합하지 않는다(다른 개발자 승인 필요). 사용자도 리뷰 대기로 정했다.
- #9 병합 뒤 #10을 `origin/develop` 위로 rebase(`--force-with-lease`)하고 CI를 다시 돌린 뒤 병합한다.
- 포크 remote는 `fork`(hanbg191919-eng/TMAXyoungkk-school). 사용자 계정은 학교 레포 admin 권한도 있다(그래도 규칙상 직접 병합 안 함).
- 로컬 백업 브랜치 `backup/feat-community-local`(PR 브랜치를 새로 만들기 전 것, 트리 같음).

## 사용자 요청 (2026-10-11, 진행 중)

"커뮤니티 글 쓰기 기능을 일기와 사진을 합치자 하나만 할 수 있도록 그리고 태그 기능도 넣고 글을 중간에 나가도 저장하는 기능도 넣고 그냥 나가려고 하면 나가시겠습니까? 라고 물어보고 저장하고 나가기 버튼이랑 취소 버튼 눌르게 하고 그리고 모든 UI UX를 사용자 측면에서 어떻게 하면 더 편할지를 고민하고 다시 배치해줘"

워크플로 `wf_e2c1f6d8-466`(ultracode)로 두 갈래를 돌렸다. **사용량 한도로 두 에이전트가 끊겼다.**

| 갈래 | 결과 |
| --- | --- |
| A. 커뮤니티 v2 구현(`community:impl`) | **중간에 끊김(도구 58회 사용). 작업 트리에 반쯤 바뀐 파일이 남아 있다(아래).** 리뷰·수정·검증은 돌지 않았다 |
| B. UX 점검 7그룹 | **완료.** 결과 85건을 [`ux-audit.md`](ux-audit.md)에 옮겼다 |
| B. UX 계획(`ux:plan`)·계획 검토 | 실패(tool_use 0, 파일 손대지 않음). 다시 돌려야 한다 |

### A. 커뮤니티 v2 명세(구현할 것)
1. **글 하나로 통합**: 글쓰기에 사진/일기 선택 없음. 제목(선택)·본문·사진 0~4장·태그. 본문이나 사진 하나만 있으면 올림. 서버는 kind를 받지 않고 사진 유무로 저장(005의 CHECK 유지).
2. **태그**: 글당 5개, 12자, `#` 떼고 공백 없이 한글·영문·숫자·_ 만, 영문 소문자, 중복 제거. 앱·서버 같은 규칙. 마이그레이션 **`006_community_tags.sql`**(tags text[] + GIN). `GET /community/posts?tag=`. 피드는 전체 + 고른 태그 거르기(전체/사진/일기 Seg 대신). 카드 태그를 누르면 거름. 글쓰기 태그 입력(Enter·쉼표·공백으로 추가, 한글 조합 끊지 않기)과 추천(여행일기·맛집·카페·풍경·숙소 + 여행 지역 + 최근 쓴 태그).
3. **임시 저장**: 앱을 껐다 켜도 남게 KV에 사용자별 저장(제목·본문·태그·사진·출처·시각). 웹 localStorage 한도로 사진 저장이 실패해도 글은 잃지 않게(글 먼저, 사진 따로, 실패하면 '사진은 임시 저장하지 못했어요' 한 번). 앱이 뒤로 가면(AppState) 저장. 올리면 지움. 다시 열면 자동으로 불러오고 '새로 쓰기'(확인 뒤 지움). 일기에서 열었는데 다른 임시 글이 있으면 둘 중 고르기.
4. **나가기 확인**: 바뀐 내용이 있으면 `beforeRemove`로 막고 시트 '나가시겠습니까?'에 버튼 **'저장하고 나가기'·'취소' 두 개만**. 뒤로 버튼·안드로이드 뒤로·iOS 밀기·웹 뒤로 모두. 올린 직후·빈 글·안 바뀐 글은 묻지 않음.
5. **두 화면 재배치**: 피드 FlatList + 당겨서 새로 고침 + 끝에서 더 불러오기, 엄지 위치 '글쓰기' 떠 있는 버튼(게스트는 로그인 안내), 사진 전체 화면 보기, 태그 칩. 글쓰기는 사진 줄을 크게 맨 위, 본문·글자 수, 태그 줄, 제목은 가볍게, '올리기'는 늘 보이고(못 올리면 이유), 360px·a11y·iOS 키보드.
6. 테스트: wp2-community·wp6-community·wp2-db([1,2,3,5,6]) 갱신, 태그 규칙 앱=서버, 태그 거르기(메모리·PGlite), 임시 저장 순수 로직, 나가기 확인 소스 규칙. 문서 README·FR-705.

### A. 지금 작업 트리(반쯤 된 상태)
- 바뀐 파일: `server/community.mjs`·`community.d.mts`·`db/community-store.mjs`, `src/core/ports.ts`, `src/core/community/index.ts`, `src/services/community/(http, local, index).ts`, `src/store/community.ts`, **`src/ui/(Field, Icon, tokens).tsx·ts`**(공통 UI도 건드렸다)
- 새 파일: `server/db/migrations/006_community_tags.sql`, `src/core/community/(draft, limits, tags).ts`, `src/features/community/drafts.ts`, `src/features/community/components/PhotoViewer.tsx`, `src/services/community/drafts.ts`
- 화면(`CommunityScreen`, `CommunityComposeScreen`, `PostCard`)과 테스트는 아직 옛 모양이라 **`tsc` 오류 25개, `npm test` 1028개 중 실패 5**(2026-10-12 확인).
- 다음 세션: 이 트리를 이어서 끝내는 것이 빠르다(서버·코어·서비스·스토어는 거의 됨). 처음부터 하려면 `git stash -u`로 치운다. 이어서 할 때는 `src/ui` 변경이 필요한지 먼저 본다(UX 재배치와 겹친다).

### B. UX 재배치
- 점검 결과 85건: [`ux-audit.md`](ux-audit.md)(그룹: 진입·계정, 홈·여행방, 채팅·후보, 시간표·계산, 지도·길찾기·여행 진행, 기록·프로필 탭, 전체 구조·공통 UI). high 예: 입력 화면 키보드가 하단 버튼을 가림(KeyboardAvoidingView·Enter 제출 없음), 게스트 한계 안내가 리디자인 때 사라짐, 내 프로필 로그아웃 확인 없음.
- 다음: 이 파일을 입력으로 **계획(묶음마다 파일 안 겹치게, 공통 UI는 B0 한 묶음) → 비판 검토 → 묶음별 구현 → 통합 검증 → 웹 확인 한 번**. 점검은 다시 돌리지 않는다. 커뮤니티 파일과 DiaryScreen의 '커뮤니티에 올리기'는 A가 맡는다.
- 워크플로 스크립트(재사용): `~/.claude/projects/-Users-handong-gwan-TMAXyoungkk/619c1f9b-9a3e-4f75-9af3-e4db89e7ce6c/workflows/scripts/young-trip-community-v2-and-ux-audit-wf_e2c1f6d8-466.js`. **`resumeFromRunId`로 다시 돌리지 않는다**(병렬이라 캐시가 어긋난다). 남은 단계만 새 스크립트로.

## 실행 환경
- 웹 8090: 미리보기 설정 `tmax-web`, API 8787: `tmax-server`(원래 폴더 `/Users/handong-gwan/IT희망학교 여행계획 프로젝트/.claude/launch.json`에 있다. 로컬 PostgreSQL, AUTH_DEV_OUTBOX=1). 날이 바뀌면 꺼져 있을 수 있다.
- TMAXyoungkk의 `test/.env`·`test/server/.env`는 사용자가 원래 폴더에서 복사했다(카카오 키는 Stray-Cat-App). `ODSAY_API_KEY`는 아직 없다.
- 로컬 DB 마이그레이션: 1·2·3·**4(member_accounts, 저장소에 없는 다른 작업)**·5(community). 006은 서버를 다시 띄우면 적용된다.
- 사용자 규칙: `.env` 읽지 않기, 커밋은 요청할 때만, Claude 공동 작성자 줄 넣지 않기. 사용량 한도 전에 에이전트를 끝내기(에이전트 사이마다 `get_usage` 확인, 80% 넘으면 다음 에이전트 전에 멈춤).

## 업데이트 (2026-10-12, 세션 7): A. 커뮤니티 v2 끝남

워크플로 없이 직접 반쯤 된 트리를 이어서 끝냈다. 커밋하지 않았다(브랜치 `feature/dh/feat-community`).

- 화면 3개를 새로 썼다.
  - `CommunityScreen`: FlatList, 당겨서 새로 고침, 끝에서 이어 받기, 태그 줄(전체 + 많이 쓴 태그), 오른쪽 아래 '글쓰기' 버튼(게스트는 로그인 안내 시트).
  - `CommunityComposeScreen`: 사진 줄 맨 위, 본문, 태그 입력·추천, 가벼운 제목, 늘 보이는 '올리기'와 못 올리는 이유. 임시 저장(열 때 이어 쓰기·고르기·'새로 쓰기', AppState 저장, 웹 beforeunload). beforeRemove 나가기 확인('나가시겠습니까?' · 저장하고 나가기 · 취소). iOS KeyboardAvoidingView.
  - `PostCard`: 종류 칩 없앰, 아바타, 사진 누르면 PhotoViewer, 태그 누르면 거르기.
- `src/ui` 변경(Field의 keepFocusOnSubmit·returnKeyType·autoCapitalize·onBlur, Icon의 hash·pen, tokens의 photoScrim)은 화면에서 쓰므로 그대로 둔다.
- 테스트 갱신: wp2-community(본문이나 사진 하나, 태그 규칙, ?tag= 거르기), wp2-db(마이그레이션 [1,2,3,5,6]), wp6-community(태그 앱=서버, 태그 입력, 임시 저장 규칙·기록·KV 저장소, 나가기 확인 소스 규칙, 화면 규칙). 문서 README·FR-705.
- 검사: `tsc` 0, `npm test` 1039개 중 1038 통과·실패 0·건너뜀 1, gate WP1~WP6 통과.
- 웹 확인(8090 + 8787 로컬 PostgreSQL, 006 적용됨): 태그 넣기, 뒤로 → 나가기 시트 → 저장하고 나가기 → 다시 열면 이어 쓰기, 올리기 → 피드 카드, 태그 거르기, 지우기. 콘솔 오류 0. 시험 글은 지웠다.
- 확인 안 한 것: 사진 고르기(웹 파일 창), 일기에서 열 때 고르기 시트, 안드로이드·iOS 실기기.

### 다음 순서
1. B. UX 재배치: `ux-audit.md` → 계획(묶음마다 파일 안 겹치게, 공통 UI는 B0) → 비판 검토 → 묶음별 구현 → 통합 검증 → 웹 확인 한 번. 커뮤니티 파일은 이제 끝났으니 B에서 빼거나 작은 수정만.
2. 커밋·PR #10 갱신은 사용자가 요청할 때만.

## 진행 중 (2026-10-12, 세션 7): B. UX 재배치 + 채팅방 지도·투표(사용자 목업) 워크플로

- 사용자 요청: "워크플로로 UX 재배치 진행하고 내가 아까 했던 목업까지 구현해봐 여기에". 목업은 저장소 밖 `/Users/handong-gwan/test-chat-vote-mockup/index.html`(채팅방에서 지역 칩 → 고른 사람 강조, 왼쪽에 채팅방 사람 프로필 전부, 프로필 누르고 아래 바를 올리면 그 사람이 말한 장소 목록과 투표, 전체 투표 순위, 카카오 지도). 사용자 스케치와 목업 사본은 세션 scratchpad `wf-ux/`(sketch.png, mockup.html)에 있다.
- 워크플로 `wf_c599dcf9-4cc`(스크립트 `~/.claude/projects/-Users-handong-gwan-IT--------------/6161f0d7-d0df-45fe-b698-e6fffc883ebd/workflows/scripts/young-trip-ux-relayout-and-chat-map-wf_c599dcf9-4cc.js`): 설계(UX 계획 + 채팅 지도 설계) → 비판 검토 2 → 계획 확정 → B0 기반 → 묶음별 구현·리뷰·수정(M-chatmap은 리뷰 3렌즈) → 통합 → 최종 검증·문서.
- 끊기면: `resumeFromRunId`로 다시 돌리지 않는다. `subagents/workflows/wf_c599dcf9-4cc/journal.jsonl`의 result 줄에서 끝난 계획(plan:final)과 묶음 결과를 꺼내 남은 묶음만 새 스크립트로 돌린다. 먼저 `tsc`·`npm test`로 트리 상태를 본다.
- 2026-10-12 21:5x: `wf_c599dcf9-4cc`는 설계 두 에이전트가 세션 한도(5시간)와 컴퓨터 잠자기로 끊겨 결과 없이 끝났다(파일 변경 없음, 주간 사용량 56% → 70%). 사용량을 아끼려고 **계획만** 하는 가벼운 워크플로 `wf_dfb537fa-978`(설계 2 → 검토 1 → 확정 1)를 다시 돌렸다. 구현은 계획이 나온 뒤 사용량을 보고 묶음별로 따로 돌린다.
- 계획 완료(`wf_dfb537fa-978`): 최종 계획·설계·비판은 **`docs/handoff/2026-10-12/ux-chatmap-plan.json`**(plan.principles 10, batches 10: B0-foundation(wave 1), M-chatmap·B1~B8(wave 2), deferred 12, risks 19 / design.acceptance 19). 큰 변화: 하단 탭 5칸(홈·일정·지도·커뮤니티·프로필, 후보는 탭 라우트로 남김), TripBar(지금 여행방), PeekSheet(끌어 올리는 시트), 새 op `spot/vote`(FR-405, 명세 밖).
- 구현 스크립트(재사용): `~/.claude/projects/-Users-handong-gwan-IT--------------/6161f0d7-d0df-45fe-b698-e6fffc883ebd/workflows/scripts/young-trip-ux-batches-wf_342c4ac1-b7d.js`. args `{ids:[...], stages:['impl'|'review'|'fix'], parallel:[...동시에 도는 id], reports:{id: 구현 보고}}`. 에이전트가 계획 파일을 직접 읽는다.
- 진행: B0-foundation 구현(`wf_342c4ac1-b7d`, 주간 76%에서 시작). 다음: B0 리뷰·수정 → wave 2(M-chatmap, B1~B8 동시) → 통합 검증 → 웹 확인. 주간 사용량 80%가 넘으면 멈추고 다음 주기(매주 월 07:00 KST쯤 초기화)에 잇는다.
- **B0-foundation 구현 끝(`wf_342c4ac1-b7d`)**: UI 키트(Switch·PeekSheet·sheetSnap·MapPill·LeaveConfirmSheet·fieldKind, Seg compact/스스로 스크롤, Sheet KAV·닫기 X, ConfirmSheet cancelLabel, ListRow switch/value, Notice action, NotFound, Avatar lg, AvatarStack max, mapPinSvg scale/dim), 내비(하단 탭 5칸, useBack, toastDuration, OfflineBar), 현재 여행방(pickCurrentTrip·useActiveTrip·TripBar·PlanSwitch·summaryLine), 소유 글롭·디자인 규칙 테스트. 검사: tsc 0, npm test 1072 중 1071 통과·실패 0, gate WP1~6 통과. 웹 360px 홈·일정 탭 확인, 콘솔 오류 0. 구현 보고 전문은 `subagents/workflows/wf_342c4ac1-b7d/journal.jsonl`.
- B0 open_issues(다음 단계가 알아야 할 것): 화면 자체 오프라인 Notice가 OfflineBar와 겹침(wave 2가 지움), ScheduleScreen·DateSeg가 Seg를 또 ScrollView로 감쌈, 제목 있는 Sheet에 X가 생겨 자체 닫기 버튼이 있던 시트는 둘(wave 2 정리), PeekSheet snap 'mini'에서 mini 노드는 head와 children을 모두 대신함, store/trips.ts useCurrentTrip은 M-chatmap이 pickCurrentTrip으로 바꿈, OfflineBar 위치는 기기 확인 필요.
- **여기서 멈춤(주간 사용량 79%, 사용자 규칙 80%)**. 다음 순서:
  1. B0 리뷰·수정: 구현 스크립트 args `{"ids":["B0-foundation"],"stages":["review","fix"],"reports":{"B0-foundation":<journal의 impl 결과>}}`.
  2. wave 2 동시: args `{"ids":["M-chatmap","B1-home-profile","B2-trip-room","B3-entry","B4-records","B5-candidates","B6-schedule","B7-map-nav","B8-live"],"stages":["impl","review","fix"],"parallel":[같은 목록]}`. 사용량이 모자라면 M-chatmap부터 따로.
  3. 통합 검증(tsc·npm test·gate·export:web) → README·FR-추적표(FR-405 채팅방 지도·투표) → 웹 확인 한 번.
- 2026-10-12 23:00 사용자: "계획 끝나면 바로 구현까지 진행해줘"(80% 규칙보다 우선). 주간 80%·5시간 55%에서 **M-chatmap + B1-home-profile 구현** 시작(`wf_477b760e-f12`, impl만, 동시). 5시간 한도(02:50 초기화)나 주간 한도(07:00 초기화)에 걸려 에이전트가 중간에 끊길 수 있다: 끊긴 묶음은 transcript tool_use를 보고 반쯤 바뀐 파일을 확인한 뒤 같은 묶음을 다시 돌려 이어서 끝내게 한다.
- 이 세션에 예약 이어하기 2개(세션이 살아 있을 때만): 10/13 02:57(남은 wave 2 구현), 07:07(나머지 구현 → 전체 리뷰·수정 → 통합 검증 → 문서 → 웹 확인).
- **M-chatmap·B1-home-profile 구현 끝(`wf_477b760e-f12`)**: tsc 0, npm test 1127 중 1126 통과·실패 0, gate WP1~6 통과. 보고 전문은 `subagents/workflows/wf_477b760e-f12/journal.jsonl`.
  - M: op `spot/vote`(LWW, 꺼짐도 남김, placeId로 합쳐진 스팟 찾기, needsRecompute 제외), `src/core/chatmap/(areas, votes, mapView).ts`, `src/features/chat/map/**`(ChatMapView·MemberRail·AreaChips·MentionList·RankList·VoteToggle), ChatScreen 한 줄 헤더 '채팅 | 지도'·900px 이상 나란히·CandidateBar·메뉴 정리. 테스트 wp3-chatmap 25, wp3-chat-meta 5. README·FR-405.
  - 웹 360px 확인(로컬 서버): 채팅 → 지도 전환, 카카오 지도·지역 칩(황남동 4명 등)·왼쪽 4명 전부·칩 고르면 고른 사람과 장소 이름표·지도 이동, 프로필 누르면 시트, 펼치면 말한 장소+채팅 인용+투표 토글, 전체 투표 순위(공동 순위·투표한 사람)·핀 표 수 갱신. 새 오류 0(처음 보인 homeMenu·kstDate 오류는 에이전트 편집 중 남은 옛 번들 기록). 시험 투표는 원래대로 돌렸다.
  - 리뷰 때 볼 것: 홈 '선택한 여행방' 4칸 라벨이 360px에서 잘림('여행지 …', '여행방 …'), 감은사지 사리장엄구가 '교동'으로 묶임(지역 규칙 확인), `/Chat?tripId=` 주소로 바로 열면 홈으로 감(예전부터인지 확인), M open_issues(markersKey에 scale·dim 없음, 서버 op별 권한 검사 없음, README 검증 표 숫자).
- 사용량 5시간 87%·주간 85%라 여기서 멈춤. 남은 wave 2: B2-trip-room, B3-entry, B4-records, B5-candidates, B6-schedule, B7-map-nav, B8-live → 예약 이어하기(02:57, 07:07)가 잇는다.
- 10/13 03:05 예약 이어하기 1: 5시간 0%·주간 86%, tsc 0·테스트 1126 통과 확인. **B2-trip-room·B5-candidates·B6-schedule 구현** 동시 시작(`wf_936c00ba-622`). 남음: B3-entry, B4-records, B7-map-nav, B8-live.
- 10/13 03:05~06:xx: B2·B5·B6 구현 에이전트가 **주간 한도로 셋 다 끊김**(`wf_936c00ba-622`, 결과 없음). 반쯤 바뀐 파일: B6 `ScheduleScreen.tsx`·`features/schedule/components/Stepper.tsx` / B5 `CandidatesScreen.tsx`·`RecommendScreen.tsx`·`SpotDetailScreen.tsx` / B2 `features/trip/components/(DaySheet, TimeRange).tsx`·`features/trip/(dayRows, inviteShare).ts`·`tests/wp2-trip-ux.test.ts`. 그 상태로 tsc 0, npm test 1141 중 1139 통과·실패 1.
- 10/13 07:08 예약 이어하기 2: 주간 0%(초기화)지만 5시간 89%(08:00 초기화)라 바로 돌리지 않음. 구현 스크립트에 `notes`(묶음별 메모) 인자를 더했다. 08:04 예약 이어하기 3이 B2·B5·B6(이어서 끝내기) + B3를 돌린다.
  - 실패 1개는 B2가 먼저 써 둔 새 테스트 `tests/wp2-trip-ux.test.ts` '여행방 만들기: 나가기 확인…'(CreateTripScreen을 아직 안 고쳐서). B2를 이어서 끝내면 풀린다.
- 10/13 08:0x 예약 이어하기 3: 5시간 0%·주간 2%. **B2·B5·B6(이어서 끝내기 notes) + B3-entry 구현** 동시 시작(`wf_d61f8147-a2a`). 남음: B4-records, B7-map-nav, B8-live → 전체 리뷰·수정 → 통합 → 문서 → 웹.
- 10/13 09:30: `wf_d61f8147-a2a` 결과 **B2-trip-room·B5-candidates·B6-schedule 구현 끝**(각 gate 통과, 보고는 journal). **B3-entry는 컴퓨터 잠자기로 끊김**: 반쯤 바뀐 파일 `features/account/messages.ts`, `LoginScreen.tsx`, `OnboardingScreen.tsx`, `SignupScreen.tsx`, `tests/wp1-entry-keyboard.test.ts`(LoginScreen에 Text 직접 사용으로 foundation-design-rules 1개 실패). 사용량 5시간 54%·주간 10%.
- 10/13 09:3x: **B3-entry(이어서) + B4-records + B7-map-nav 구현** 동시 시작(`wf_1865e044-442`). keep_awake 다시 켬. 남음: B8-live → 전체 리뷰·수정 → 통합 → 문서 → 웹.
- 10/13 14:4x: `wf_1865e044-442` 결과 **B3-entry·B4-records·B7-map-nav 구현 끝**(각 gate 통과). 이로써 B0·M·B1~B7 구현 완료, 구현 보고는 scratchpad `wf-ux/reports/<id>.json`에 모아 둠.
- 10/13 14:5x: **B8-live 구현 + 전체 10묶음 리뷰(읽기 전용, M은 3렌즈)** 시작(`wf_9468f7d6-667`). 리뷰어는 결과를 scratchpad `wf-ux/reviews/<id>-<lens>.json`에도 쓴다. 다음: 수정(stages ['fix'], 리뷰 파일을 읽음, 묶음끼리 동시) → 통합 → 문서 → 웹. 사용량 5시간 28%·주간 16%에서 시작.
- 10/13 저녁: `wf_9468f7d6-667` 결과 **B8-live 구현 끝**(tsc 0, 1211 중 1210 통과, gate 통과). 리뷰는 M(3렌즈)·B0·B1·B2·B3 끝(결과 파일 scratchpad `wf-ux/reviews/`), B4~B8 리뷰는 5시간 한도로 실패(읽기 전용이라 트리 영향 없음). M 데이터 리뷰 주요 지적: 카카오 주소 '서울 종로구 …'(광역시 줄임)를 지역 규칙이 못 알아봐 6개 광역시가 전부 '기타'(major), 고른 지역이 데이터 변경으로 사라지면 핀이 모두 흐려짐, 제외 후 복원 때 투표 순서 의존(minor).
- 10/13 23:08: 5시간 0%·주간 28%. **M·B0·B1·B2·B3 수정(리뷰 파일 읽음) + B4~B8 리뷰** 동시 시작(`wf_130546d4-16e`). 구현 스크립트에 `stagesById`(묶음별 단계)를 더했다. 다음: B4~B8 수정 → 통합 검증 → 문서 → 웹.
- 10/13 23:2x: `wf_130546d4-16e` 결과 **M·B0·B1·B2·B3 수정 끝**(M 20건 반영: 광역시 줄인 주소 지역 인식, 사라진 지역 선택 처리, 제외·복원 투표 순서 문제는 보낼 때 막기로, 레일이 지도 터치를 먹던 문제 box-none, SVG 지도 맞춤 높이, 넓은 화면 시트 폭, 지도 전환 때 키보드 내리기·inert, 문구 순수 함수 text.ts 등. 테스트 1225 중 1224 통과) + **B4~B8 리뷰 끝**(지적 3·3·5·6·3건, 파일 `wf-ux/reviews/`). 5시간 56%·주간 37%.
- 10/13 23:2x: **B4~B8 수정** 시작(`wf_dd5c2062-cde`). 다음: 통합 검증(전체 gate·export:web) → 최종 점검·문서 → 웹 360px 확인.
- 10/13 23:2x: `wf_dd5c2062-cde` 결과 **B4~B8 수정 끝**(반영 4·2·6·7·6건, 각 gate 통과, 테스트 1232 중 1231 통과). 이로써 **10묶음 모두 구현·리뷰·수정 완료**. 모든 묶음의 남은 문제는 scratchpad `wf-ux/open-issues.json`(81줄).
- 10/13 23:3x: **통합 검증 + 최종 점검·문서** 시작(`wf_f3af8191-b5a`: integrate → verify). 5시간 71%·주간 40%. 다음: 웹 360px 확인 한 번(메인 세션).

## 끝남 (2026-10-14 새벽, 세션 7): B. UX 재배치 + 채팅방 지도·투표

- `wf_f3af8191-b5a`: 통합(남의 파일이라 묶음이 못 고친 것 처리: Btn a11yLabel, 인증·멤버 문구 '~요', markersKey scale·dim, 시트 닫기 버튼 겹침, ListRow·FeatureTile 읽기 이름, 지도 묶음 목록에서 고르기 onClusterPick, README 검증 표) → 최종 점검(계획 134항목 중 132 충족, 5건 바로 고침: PlanningScreen NotFound, tests/wp4-schedule-ux 새로, README 'UX 재배치 (2026-10-13)'·낡은 경로 43곳, FR-추적표 '2026-10-13 갱신'·낡은 칸 21곳).
- 최종 검사(메인 세션 직접): tsc 0, npm test 1238 중 1237 통과·실패 0·건너뜀 1, gate WP1~6 통과, export:web 통과(ttf 4).
- 웹 확인(360px·로컬 서버): 홈('내 여행' 제목·새 여행·여행방 4칸 라벨 안 잘림), 일정(TripBar·시간표|후보 N·날짜 Seg), 지도(TripBar 알약·길찾기·구간 안내|여행 진행), 채팅방 지도(칩·왼쪽 4명·프로필 → 말한 장소·투표), 넓은 화면 1200px(채팅 왼쪽·지도 오른쪽·시트 오른쪽), 여행 진행 시작 전(시뮬레이터·기기 위치·수동 ListRow, 지도 200·지도 크게 보기). 오류 0.
- 아직 안 한 것(최종 점검 remaining): '~니다' 문구 약 170개가 화면 밖 파일(core/ops 검증 이유, features/schedule/view 등)과 server/auth.mjs에 남음(테스트가 붙잡고 있어 따로 정리), 빈 시간 추천은 카카오 '도보 길' 링크 대신 목적지 링크(위치 보내지 않기 약속), RecommendScreen 로딩 Notice가 카드를 밀어냄(디자인 결정), '초대 거절' → '나중에 할게요'(사용자 확인 필요), 같은 기기 미인증 가입 닉네임 문제(서버·앱 같이 고쳐야 함), 서버 op별 권한 검사·투표 PostgreSQL 투영, 기기(iOS·안드로이드) 확인.
- 커밋 안 함. 바뀐 파일 167개(커뮤니티 v2 포함). 올릴 때는 커뮤니티 v2와 UX 재배치를 나눠 커밋하는 것을 권한다.
