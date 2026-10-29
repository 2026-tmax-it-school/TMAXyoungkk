# 인수인계: 시연 기능을 관리자 계정 전용으로 (2026-10-24)

## 위치와 상태
- 코드: `/Users/handong-gwan/TMAXyoungkk-figma/test`, 브랜치 `feature/dh/figma-design`
- `develop`에는 앞선 작업(iOS 키보드 수정, 메일 코드 입력 칸 등)이 이미 올라가 있다(`1315c99`).
- 이번 수정은 **아직 커밋하지 않았다.** 사용자가 "커밋은 나중에"라고 했다. 커밋할 때는 작성자를 사용자 본인으로 하고 Claude 공동 작성자 줄은 넣지 않는다.
- 검증: `tsc` 통과, 테스트 1420개 중 1419 통과(1개는 원래 건너뛰는 테스트), `node scripts/gate-scope.mjs WP1..WP6` 모두 통과.

## 이번에 바꾼 것
- 시연 기능을 `EXPO_PUBLIC_DEMO_TOOLS`가 켜져 있고 **로그인한 계정의 이메일이 `EXPO_PUBLIC_ADMIN_EMAILS`(쉼표 구분)에 들어 있을 때만** 보이게 했다. 게스트와 일반 계정에는 안 보인다. 목록이 비면 아무도 못 본다.
- `src/config.ts`: `ADMIN_EMAILS`, `parseEmailList`, `canUseDemoTools(session, admins, on)`.
- 막은 화면:
  - `MoreScreen.tsx`: 프로필 탭의 "시연 도구"(시나리오 채우기, 시연 리셋)
  - `LiveTripScreen.tsx`: 여행 진행의 "시뮬레이터로 재생"
  - `MembersScreen.tsx`: 멤버 화면의 "시연" 구역(다른 사람으로 합류해 보기)
  - `InviteAcceptScreen.tsx`: "다른 사람으로 합류(시연)" 링크
  - `JournalScreen.tsx`: 일기 메뉴의 "시연"(예시 사진 3장 넣기)
- 훅은 조기 반환보다 위에 둬야 한다(`LiveTripScreen`에서 한 번 어겼다가 고쳤다).
- 테스트: `tests/qa-ui-fixes.test.ts`(관리자·일반·게스트 판정, 소스 규칙), `tests/wp5-live-layout.test.ts` 수정.
- `.env.example`에 `EXPO_PUBLIC_ADMIN_EMAILS=` 추가.
- `test/.env.local`(커밋 안 함)에 `EXPO_PUBLIC_ADMIN_EMAILS=hanbg191919@gmail.com`을 넣었다. 8090 서버는 재시작하지 않았다.

## 화면 확인 결과
- iOS 시뮬레이터(iPhone 17, 일반 계정): 새 여행 만들기, 후보 담기, 좋아요 켜기·끄기, 일정 편집, 되돌리기, 구간 안내, 수동 진행(도착 기록), 일기에 사진 올리기까지 정상. 시뮬레이터 여행 "부산 당일"이 남아 있다.
- 웹 8098(로컬 전용, 일반 계정): 프로필 탭에 "시연 도구"가 **없다.** 확인됨.
- 아직 안 한 것:
  - 웹 8098에서 **관리자 계정**으로 시연 도구가 보이는지.
  - 멤버 화면, 초대 수락 화면, 일기 메뉴의 시연 항목이 일반 계정에서 숨고 관리자에서 보이는지.
  - 오프라인 확인(시뮬레이터로 끌 방법이 없다), 일기 글 입력(시뮬레이터 `text`가 한글 입력을 못 한다).

## 8098 확인을 이어가는 방법
- 실행 설정 `figma-demo-admin-8098`이 세션 폴더와 `/Users/handong-gwan/TMAXyoungkk-figma/.claude/launch.json`에 있다. 환경값: `EXPO_NO_DOTENV=1`, `RN_PORT=8098`, `EXPO_PUBLIC_DEMO_TOOLS=1`, `EXPO_PUBLIC_ADMIN_EMAILS=admin@example.test`, `--clear`.
- `EXPO_NO_DOTENV=1`이 꼭 필요하다. 없으면 `.env`의 `localhost:8787`이나 `.env.local`의 터널 주소가 번들에 들어가서 계정 서버를 쓴다. 번들에서 `localhost:8787`과 `trycloudflare` 주소가 0개인지 `curl`로 확인한다.
- 서버 없이 계정 로그인이 안 된다(가입은 메일 발송에서 멈춘다). 그래서 브라우저에서 같은 출처의 이미지 주소(`/assets/?unstable_path=.%2Fassets/splash.png`)를 연 뒤 `localStorage`의 `young-trip/session`에 세션을 직접 넣고 `/`로 이동한다. 세션 형태: `state.session = {userId, deviceToken, nickname, kind:'account', accountId, email, issuedAt, expiresAt}`, `state.profile`, `version: 2`. 앱을 연 채로 넣으면 앱이 덮어쓴다.
- 일반 계정은 `user@example.test`, 관리자는 `admin@example.test`로 넣으면 된다.
- 끝나면 `preview_stop`으로 8098을 끈다.

## 주의
- 이번 세션에서 `.env.local`을 잠깐 치웠다가 되돌렸다. 내용이 이전과 같은지(터널 주소 3줄 + 관리자 이메일 1줄) 확인한다. 백업은 스크래치패드의 `env.local.bak`.
- 확인하다가 **공유 서버(터널)에 요청이 갔다.** `user@example.test` 이메일 가입 요청 1번(메일 발송에서 멈춤)과 가짜 토큰으로 `/auth/session` 호출 몇 번이다. 서버 DB에 `user@example.test` 계정이 남았는지 사용자에게 알리고, 정리할지 묻는다.
- 정리 대기(이전부터): 공유 DB의 테스트 계정 `hanbg191919+test1`, `+test2`, 여행 `trip_sa6vwz0zwcbayhbd`.
- 채팅 메뉴의 "시연"은 코드에서 찾지 못했다(이미 없는 듯). 샘플 여행(`sampleTrips`)은 "추천 여행 일정"이라는 사용자 기능이라 막지 않았다.
- 커밋하지 않은 로컬 전용 파일: `docs/handoff/2026-10-24/`, `.claude/launch.json`, `test/node_modules`(심볼릭 링크, 커밋 금지).
- 규칙은 `docs/handoff/2026-10-24/session-10-피그마-디자인-적용.md`의 "지켜야 할 규칙"을 따른다. 사용량이 97%에 닿으면 인수인계를 쓰고 멈춘다.

## 다음 대화에서 첫 순서
1. 위 "8098 확인을 이어가는 방법"으로 관리자 계정 화면을 확인한다.
2. 사용자에게 커밋 여부와 `user@example.test` 정리를 묻는다.
