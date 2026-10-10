# 세션 5 인계 — 디자인 브랜치와 기능 작업 합치기 (2026-10-10 밤)

사용자 요청: "이 폴더(`/Users/handong-gwan/TMAXyoungkk`)에 지금 구현된 디자인을 합쳐줄래? 기능은 지금 하고 있는 거고 디자인은 지금 주는 폴더야."
다음 세션은 `HANDOFF.md` "지금 상태"를 읽은 뒤 `session-4-길찾기.md`, 그다음 이 파일을 읽는다.
**아무것도 커밋하지 않았다.** 합친 결과는 TMAXyoungkk 작업 트리에 스테이지(`git add`)만 되어 있다.

## 두 폴더

| 폴더 | 무엇 | 상태 |
| --- | --- | --- |
| `/Users/handong-gwan/IT희망학교 여행계획 프로젝트` (원래 폴더) | 세션 1~4 기능 작업. 브랜치 develop, `68ccf76` 뒤 커밋 안 한 변경 72개 파일 | 그대로 둠(아무것도 지우거나 되돌리지 않았다) |
| `/Users/handong-gwan/TMAXyoungkk` (학교 레포 클론, origin = `2026-tmax-it-school/TMAXyoungkk`) | 디자인 작업이 있는 곳. **이제 여기서 이어서 작업한다** | 브랜치 `feature/dh/merge-design-features`(origin/develop 추적), 합친 변경 스테이지됨 |

## 어떻게 합쳤나

- 디자인은 학교 레포 `origin/develop`(= `origin/design`)에 있다. `e9d17d1` 위의 커밋 4개다.
  - `741349e` 레퍼런스 기반 리디자인 1차(연두 포인트색, 부가 설명 정리)
  - `2e5712a` Young Trip 디자인 시스템 초안
  - `8db8d84` 디자인 시스템을 앱에 적용
  - `9ae74cc` 2차·3차 단계 배지 제거
- `e9d17d1`과 원래 폴더의 `68ccf76`은 트리가 같다(`06d93a3`). 그래서 기준이 같은 3-way 병합이다.
- 원래 폴더의 커밋 안 한 변경을 임시 인덱스로 커밋 객체 `e57323b`로 만들었다. 원래 폴더의 인덱스·브랜치는 건드리지 않았다. 이 객체는 어느 브랜치에도 없다. `.env` 두 개는 gitignore라 들어가지 않았다.
- TMAXyoungkk에서 `git switch -c feature/dh/merge-design-features origin/develop` 뒤 `git cherry-pick -n e57323b`로 얹었다(커밋 없이).

## 충돌 8개를 푼 방법

원칙: 색·글꼴·모양은 디자인 쪽, 로직·새 화면·새 컴포넌트는 기능 쪽.

| 파일 | 처리 |
| --- | --- |
| `test/src/ui/tokens.ts` | 디자인 색(ink `#222222`, `accentTint`, `accentDeep`)을 두고 기능 쪽 `kakao`·`onKakao` 색, `R.auth`(6) 를 더했다. 대비 목록에 둘 다 남겼다 |
| `test/src/ui/Field.tsx` | 디자인 TextField(라벨이 칸 안, 오류 앰버 테두리, line-strong)를 기본으로 두고 `look="auth"`(15·16, 라벨을 칸 안에 그리지 않음, 높이 48·라운드 6)를 더했다 |
| `test/src/ui/Icon.tsx` | 디자인 아이콘(heart·compass·help)과 길찾기 `swap`을 모두 둔다 |
| `test/src/ui/index.ts` | `Auth`·`BrandLogo` 내보내기를 더하고, 디자인에서 지운 `ScopeBadge`는 빼둔다 |
| `test/src/screens/LoginScreen.tsx`·`SignupScreen.tsx` | 기능 쪽(로그인 시안, 실제 구글·카카오 로그인, 계정찾기). 색은 새 토큰을 따른다 |
| `test/src/screens/MoreScreen.tsx`(디자인에서 '프로필' 탭) | 디자인 ListRow 모양에 기능 쪽 결정(계정 메뉴는 로그인·로그아웃만)을 얹었다. 탈퇴 안내 문장은 디자인대로 뺐다 |
| `test/src/screens/MapScreen.tsx` | 주석만 합쳤다(accentDeep + 내 위치·길찾기 설명) |

충돌 밖에서 고친 것: `test/src/screens/DirectionsScreen.tsx`의 `ScopeBadge`(디자인에서 없어진 컴포넌트)를 지웠다.

## 검사 (TMAXyoungkk/test, `npm ci` 뒤)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 오류 0 |
| `npm test` | 981개 중 980 통과, 실패 0, 건너뜀 1(실 Postgres) |
| `node scripts/gate-scope.mjs WP1`~`WP6` | 모두 통과 |
| 웹(375px) | 연두 디자인 홈·프로필 탭, 27 길찾기(출발·도착, 수단 비교, 내 위치 버튼) 정상. 콘솔 오류 0 |

웹은 원래 폴더 `.claude/launch.json`에 더한 미리보기 설정 **`tmax-web`**(`npm --prefix /Users/handong-gwan/TMAXyoungkk/test run web`, 8090)으로 띄웠다. 8090이라 카카오 도메인·OAuth 주소가 그대로 맞는다.
TMAXyoungkk에는 `.env`가 없어 SVG 기본 지도·모의 데이터로 돌았다. 브라우저 localStorage는 같은 주소라 원래 폴더 때 로그인(계정 · 투림)이 그대로 보였다.

## 남은 일

1. **키 파일 복사(사용자가 직접).** 내용은 AI가 보지 않는다.
   - `cp "/Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/.env" /Users/handong-gwan/TMAXyoungkk/test/.env`
   - `cp "/Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/server/.env" /Users/handong-gwan/TMAXyoungkk/test/server/.env`
   - 그다음 서버(`npm --prefix test run server`, 8787)와 `tmax-web`을 다시 띄워 카카오 지도·로그인 화면을 새 디자인으로 확인한다.
2. **화면으로 아직 못 본 것.** 15 로그인·16 회원가입(새 토큰 위의 시안 모양), 카카오 지도 위 내 위치 버튼, 지도 탭, 스팟 상세.
3. **결정 대기.**
   - 디자인 쪽 프로필 탭의 '그룹원 위치 공유 · 준비 중' 줄이 "위치 공유는 만들지 않는다" 결정과 맞지 않는다. 지울지 정한다.
   - 13 구간 내비 버튼 이름 '구간 안내', 따라가기 중 내 위치 버튼 동작(session-4 남은 일 3).
4. **커밋·PR.** 사용자가 요청할 때만. 학교 레포 쓰기 권한이 없으니 포크(`hanbg191919-eng/TMAXyoungkk-school`)를 remote로 더해 이 브랜치를 푸시하고 develop으로 PR을 연다. 커밋에 Claude 공동 작성자 줄을 넣지 않는다. 의존성(`package.json`·`package-lock.json`, expo-auth-session·web-browser·webview 등)은 협업 규칙대로 따로 묶을지 정한다.
5. 원래 폴더를 계속 쓸지, TMAXyoungkk로 옮길지 정한다. 옮기면 원래 폴더 변경은 이미 여기에 들어 있으니 원래 폴더에서 새로 고치지 않는다(두 곳이 갈라진다).
6. session-4 파일의 나머지 남은 일(카카오 실제 로그인, 코드 문제 7건, SMTP, 안드로이드, 앱 WebView 기기 확인)은 그대로다.

## 이어서 한 일 (세션 5 후반, 커밋 전)

| 일 | 상태 | 비고 |
| --- | --- | --- |
| 길찾기 커밋 가져오기 | 완료 | `origin/develop`의 `b8c91c0`(팀원 sezurchoe, ODsay 대중교통·길찾기 개선)만 `cherry-pick -n`으로 가져옴. 테스트 993개 중 992 통과 |
| 여행방 설정 수정(방장) | 완료 · 웹 확인 | TMAXyoungkk 정리 때 사라져 다시 만듦. 지역·날짜·주 이동수단을 방장이 만든 뒤에도 바꾼다. `src/core/trip/edit.ts`, `TripSettingsScreen.tsx`, `tests/wp2-trip-edit.test.ts` |
| 커뮤니티(사진·일기 글) | 완료 · 웹·실제 PostgreSQL 확인 | 아래 |

### 커뮤니티
- 사용자 결정: 앱 사용자 전체가 보고 서버에 저장한다. 하단 탭 「커뮤니티」(지도와 프로필 사이). 요약은 `test/README.md` "커뮤니티 · 사진과 일기".
- 서버: `server/community.mjs`(서비스·메모리 저장소), `server/db/community-store.mjs`(PostgreSQL), 마이그레이션 **`005_community.sql`**. `sync-server.mjs`가 `/community/…`를 넘기고 사진 글은 본문 한도 10MB(`readBody`의 drain 모드로 413). `auth.mjs`에 `authenticate(headers)`와 `onAccountRemoved`(탈퇴하면 글 삭제)를 더함.
- **마이그레이션 번호 주의:** 로컬 개발 DB(`youngtrip`)에는 두 폴더 어디에도 없는 `004_member_accounts.sql`(trip_member_accounts 표)이 이미 적용돼 있다(오늘 15:29, 다른 작업). 그래서 내 마이그레이션을 004가 아닌 005로 했다. 그 004가 저장소에 들어오면 번호가 1~5로 이어진다. 테스트(`wp2-db`)는 지금 [1,2,3,5]를 기대한다. 그때 004가 들어오면 [1,2,3,4,5]로 고친다.
- 앱: `src/core/community`(규칙·서버와 같은 한도), `src/services/community`(http·local·picker), `src/store/community.ts`, `CommunityScreen`, `CommunityComposeScreen`, `features/community/components/PostCard`. `AuthProvider.bearer()`로 세션 토큰을 꺼내 서버에 보낸다. 서버 주소(AUTH_URL)가 없으면 이 기기 모의로 돌아간다.
- 웹 확인(8090 + 새 API 서버 8787, 실제 PostgreSQL): 일기 글을 올려 피드에 보임, 사진 글은 서버에서 받아 보임, 내 글 삭제(확인 창) 뒤 목록·DB에서 사라지고 사진 행도 같이 지워짐. 테스트 글은 모두 지웠다.
- **화면으로 못 본 것:** 사진 고르기·업로드(앱 안 브라우저에서 파일 창을 열 수 없다), 기기에서의 화질 줄이기 결과(1.5MB 넘으면 올리기 전에 막는다), 360px 폭. 일기 → 커뮤니티 연결 버튼(DiaryScreen)은 아직 없다(글쓰기 화면은 `tripId`·`date`로 열면 그날 일기를 채운다).
- 서버 프로세스: 8787은 `tmax-server`(미리보기 설정, 원래 폴더 `.claude/launch.json`)로 새로 띄웠다. 예전 서버(16:20 시작, 커뮤니티 경로 없음)는 껐다.
- 검사: `tsc` 오류 0, `npm test` 1027개 중 1026 통과(실패 0, 건너뜀 1), WP1~WP6 통과.

### 연결 정리 (같은 날 마지막)
- **여행방 설정은 채팅 화면 위 `...`(채팅 메뉴) 맨 위 「여행방 설정」에서 연다.** 프로필 탭의 여행방 목록에서는 뺐다(웹 확인: 프로필에 없고, 채팅 메뉴에서 열린다).
- **일기 화면(Diary) 아래 「커뮤니티에 올리기」**: 그날 일기가 있으면 보인다. 글쓰기 화면이 `tripId`·`date`로 열려 제목(여행방 이름 · 날짜)과 본문을 일기로 채운다. 화면으로는 못 봤고 `wp6-community` 소스 규칙 테스트로만 확인했다.
- 검사: `tsc` 0, 테스트 1028개 중 1027 통과(실패 0, 건너뜀 1), WP1~WP6 통과.
