# 이어하기 세션 2 인계 (2026-10-09 밤)

`HANDOFF.md`의 "지금 상태"에서 이어받아 끝낸 일과 남은 일이다. 다음 세션은 `HANDOFF.md`부터 읽고, 자세한 근거가 필요할 때 이 파일을 본다.

## 이어받았을 때 상태

- 워크플로 `wf_53f42247-d41`이 20:23~20:24에 사용량 한도로 끊겨 있었다. 한도는 다음 날 00:40(KST)에 풀린다.
- journal 결과(`~/.claude/projects/-Users-handong-gwan-IT--------------/6161f0d7-d0df-45fe-b698-e6fffc883ebd/subagents/workflows/wf_53f42247-d41/journal.jsonl`):

| 에이전트 | 결과 |
| --- | --- |
| ci:마지막수정 | 완료 |
| track:2차수정 | 완료 |
| api-proxy:수정 | 완료 |
| sim-road:구현 | 완료 |
| real-time:구현 | 완료 |
| sim-road 리뷰 3 · 수정 | 실패(한도) |
| real-time 리뷰 3 · 수정 | 실패(한도) |
| 문서·최종검사 | 실패(한도) |

- 실패한 에이전트 transcript에는 tool_use가 0건이었다. 파일을 하나도 건드리지 않았다는 뜻이다. 그래서 트리는 구현 2건이 끝난 상태 그대로였다.
- 이어받자마자 돌린 검사: `tsc` 오류 0, `npm test` 776개 중 775 통과·실패 0·건너뜀 1.

한도 때문에 에이전트를 다시 띄우지 않고, 남은 리뷰·수정·문서·최종 검사를 이 세션이 직접 했다.

## 한 일

### 1. 기능 5(시뮬레이터 길 따라가기) 리뷰

본 파일: `src/core/sim/track.ts`, `src/core/sim/legShapes.ts`, `src/components/map/useLegGeometry.ts`, `src/store/live.ts`(시작 대기, 늦게 온 모양 재생성, 계획 변경 시 이어 만들기).

결론: 막는 결함 없음. 확인한 점:

- 길이 아닌 경우의 샘플이 예전과 같다. 난수 호출 순서도 바뀌지 않았다.
- 끝점을 핀에 이어 도착 판정이 직선일 때와 같다.
- 이어서 만들기는 150m 스냅을 쓴다. 남은 길이가 1.5배를 넘지 않게 잘랐다.
- 옆 건물 프리셋은 마지막 점만 옆 건물로 바꾼다.
- 복귀 구간 키가 지도와 같다.
- 늦게 온 모양을 받았을 때 `rt !== run`을 확인한다.
- `useLegGeometry`는 provisional을 메모하지 않는다. api-proxy 리뷰가 지적한 문제가 여기서 풀렸다.

작은 관찰 두 개(고치지 않음):

- 계획이 바뀌어 이어 만들 때, 새 구간 모양이 이미 메모에 있어도 한 번 직선으로 만든 뒤 곧바로 다시 만든다. 결과는 같고 재구독만 한 번 늘어난다.
- 조정안 적용 뒤 이어 만들기 입력(`simInput`)에는 `closeMin`이 없다. HEAD 때부터 그랬다. '영업 종료' 프리셋은 조정안 뒤에 마감 대상을 다시 고르지 않는다.

### 2. 기능 3(실제 길 기준 이동 시간) 리뷰

본 파일: `src/services/routes/osm.ts`, `cache.ts`, `index.ts`, 화면 `NavigateScreen.tsx`·`LegTransportScreen.tsx`. 경로 호출 위치도 모두 찾았다(`grep routes.route|routes.matrix`).

결론: 막는 결함 없음. 확인한 점:

- 실패하면 행렬 전체를 provisional로 두고 캐시하지 않는다.
- 길 없음(null 칸, 400 NoRoute)은 캐시한다.
- 좌표 50개를 넘으면 출발지별로 나눈다.
- 호출 수는 구간 수로 센다.
- 행렬과 경로가 같은 분을 내도록 캐시가 맞춘다. 맞추는 것은 둘 다 실제 시간일 때만이다.
- **실시간 GPS가 경로 서버로 나가는 호출은 없다.** 모든 호출이 계획 좌표(기점·스팟)를 쓴다.

수정한 것(구현 에이전트가 남긴 FOUNDATION 미해결 2건):

- `src/services/registry.ts`: 더보기 '제공자 상태' 경로 문구 세 갈래를 실제 동작으로 고쳤다. 고치기 전에는 '시간은 예시 데이터 추정', '도보·대중교통은 로컬 모델 추정'이었다. 이제 도보·자동차 시간은 실제 길(OSRM)이고, 자동차는 교통 보정 1.3배, 시연 구간은 예시 구간표, 대중교통은 모의 모델 추정이라고 적는다. `OSRM_CAR_TIME_FACTOR`를 가져와 숫자를 한곳에만 둔다.
- `src/config.ts`: `EXPO_PUBLIC_ROAD_SHAPE` 주석을 고쳤다. 선 모양만이 아니라 시간도 받고, off면 외부 호출이 0이라고 적었다.

### 3. 문서

- `test/README.md`:
  - 2026-10 추가 기능 요약, 검증 상태(2026-10-09)
  - CI `check`·`db` 잡, 시뮬레이터 길 따라가기, 백그라운드 동선 기록 절
  - '프로토타입이라 다른 점' 갱신: 서버 선택·인증 없음, 경로 시간, 보관 정리
  - 환경 변수 표(`EXPO_PUBLIC_API_URL` 추가, 카카오·도로 모양 줄 고침), 카카오 절(서버 경유와 대체 동작), OSRM 절(계획 시간도 받음)
  - 4절을 '동기화·중계 서버'로 다시 썼다: 명령, 서버 변수 7개, 동기화·중계 규칙, 테스트
  - 구조 표
- `docs/FR-추적표.md`:
  - 맨 위에 '2026-10-09 갱신' 절: 검증 결과와 기능 6개의 FR·파일·테스트·남은 문제
  - 지금 사실과 틀린 셀 7곳을 고쳤다: FR-704, FR-804, 백그라운드 두 칸, 데이터 보존, 외부 API 비용, 서비스 지역
- env 대조: `test/.env.example` 7개 = `src/config.ts`가 읽는 7개. `test/server/.env.example` 7개 = 서버 코드가 읽는 7개. 고칠 것 없음.
- **루트 `README.md`는 일부러 안 고쳤다.** 작업 트리에는 develop의 한 줄 '# TMAXyoungkk'만 있다. 사용자가 쓴 92줄 설명은 `origin/main`(99e3905)에만 있다. 지금 고치면 main→develop 동기화 PR에서 충돌하고, main 설명이 덮일 수 있다. 동기화를 먼저 하고 고친다.
- `CONTRIBUTING.md`에는 서버·DB 메모를 더하지 않았다. CI 에이전트가 이미 GitFlow로 크게 고쳤다. 고정 규칙 문서라 yj 승인이 필요하다. 서버 변수 표는 `test/README.md` 4절에 있다.

### 4. 최종 검사 (2026-10-09, 이 세션 마지막)

| 명령 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 오류 0 |
| `npm test` | 776개 중 775 통과, 실패 0, 건너뜀 1(실 PostgreSQL) |
| `node scripts/gate-scope.mjs WP1`~`WP6` | 6개 모두 통과 |
| `npm run export:web` | 성공, ttf 4개 |

개발 서버·브라우저는 띄우지 않았다. 구글 Demo Key 사용량을 아끼려는 것이다.

## 남은 문제 (코드)

중요한 순서다.

1. **빈 시간 추천(FR-604)이 지금 GPS로 장소를 묻는다.** 위치는 `src/core/live/freetime.ts`, `src/store/live.ts`다. `EXPO_PUBLIC_API_URL`이 있으면 이 좌표가 서버를 거쳐 카카오로 간다. 직접 키면 바로 카카오로 간다. '위치를 서버에 올리지 않는다' 결정과 맞지 않는다. 고칠 방법은 둘이다. 지난 도착 스팟이나 다음 스팟 좌표로 묻거나, 빈 시간 추천만 로컬 장소 사전을 쓰게 한다. WP5(dh)가 정한다.
2. **더보기 안내 문구(WP1 MoreScreen)가 틀린다.** 서버 경유로 카카오가 될 때도 '키가 앱에 들어가니 시연에만'이라고 나온다. `ServiceStatus.via === 'server'`일 때 문구를 나눠야 한다.
3. **시나리오 채우기가 `getServices().places`를 쓴다.** 서버에 카카오 키가 있으면 시연 수치(14·11·3)가 깨질 수 있다. 시연 도구는 로컬 장소 사전을 쓰게 하는 편이 낫다.
4. **iOS 백그라운드 기록 중에도 동기화 폴링이 돈다**(2.5초, 시간당 약 1,440번). 화면 밖에서 원격 op를 받으면 경로 재계산도 돈다. AppState가 active가 아니면 폴링을 멈추고, 재계산은 앱으로 돌아온 뒤로 미룬다(WP2).
5. 계획기(`core/planner/travel.ts`)가 구간을 하나씩 물어서 OSRM table 묶음 효과가 작다. 고치려면 `ports.ts` `TravelMatrix`에 칸별 추정 표시가 필요하다(FOUNDATION).
6. 자동차 OSRM 계수 1.3은 근거 없는 가정이다. 실제 카카오 키로 같은 구간을 재서 고친다.
7. 경로 캐시 키에 제공자 설정이 없다. 도로 경로 서버를 막 켜면 옛 직선 추정이 최대 24시간 남는다(시연 리셋으로 지운다).
8. 이동 중 예상 도착(`core/live/delay.remainingTravelMin`)은 남은 직선거리 비율로 잰다. 길이 돌아가는 구간에서는 지연이 크게 잡힐 수 있다.
9. 앱 `.env`에 `EXPO_PUBLIC_API_URL`과 `EXPO_PUBLIC_KAKAO_REST_KEY`가 둘 다 있으면 빌드를 경고하거나 멈추게 하는 점검이 없다. 지금은 더보기가 알리기만 한다.

## 남은 결정 (사람)

- 백그라운드 동선 기록:
  - 옵션 값을 저장해 다음 진행에서 자동으로 켤지, 진행마다 새로 켤지
  - 화면 밖 도착에 알림이 없는 정책으로 확정할지
  - 자정에 멈추는 규칙
  - '떠난 자리' 점 규칙(시뮬레이터에도 적용된다)
- CI: 브랜치 이름 `feature/<이니셜>/<타입>-<범위>`로 갈지, main README의 옛 이름(`feature/<기능>`)으로 갈지. release·hotfix 머지 방식과 릴리스 순서도 정한다. 고정 규칙 변경이라 yj 승인이 필요하다.
- 서버 인증(지금 없음), 역방향 프록시 뒤 IP 기준 속도 제한, 서버 전체 카카오 일일 상한
- 기존 미결정: 방장 위임, 게스트 승격 이관 범위, 초대 승인, 예산·정산, 사진 저장 정책, 경로 API 상용 업체(공개 OSRM은 시연 한정)

## 사람이 해야 할 일

1. **커밋.** 아직 아무것도 커밋하지 않았다(develop, 마지막 커밋 `d2a485e 테스트`, 바뀐 파일 85개 이상). CI 넣는 순서를 지키려면 PR을 나눠야 한다.
   - (1) ci.yml 트리거·check, CONTRIBUTING GitFlow(db 잡 부분 제외), 협업규칙, PR 템플릿, `tests/setup/workflow.ts`, `tests/foundation-ci.test.ts`
   - (2) WP2 서버 DB
   - (3) db 잡, `tests/foundation-ci-db.test.ts`, CONTRIBUTING db 부분

   나머지 기능은 기능별 `feature/dh/...` 브랜치로 나눈다.
2. **GitHub 설정**(체크리스트 2·3행):
   - main→develop 동기화 PR(`--merge`, squash 아님)
   - 기본 브랜치를 develop으로
   - develop·main ruleset(필수 검사는 처음에 check만)
   - 태그 ruleset `release-tags`
3. **루트 README.md**는 동기화 뒤 `git show origin/main:README.md`를 바탕으로 고친다. 브랜치 표는 새 이름으로 바꾼다.
4. **Docker Desktop을 켜고 `npm run db:up`.** 그다음 `YT_TEST_DATABASE_URL=... npm test`로 실 PostgreSQL 묶음을 확인한다.
5. **카카오 REST 키**를 `test/server/.env`의 `KAKAO_REST_KEY`에 직접 넣는다(채팅 금지). 그다음 `npm run server` → 앱 `.env`에 `EXPO_PUBLIC_API_URL` → 장소·자동차·도로 모양이 서버를 거치는지 본다.
6. **구글 키 제한**(웹사이트, Maps JavaScript API만, 하루 상한).
7. **실기기·개발 빌드:**
   - `npx expo run:android`·`run:ios`. app.config.js가 바뀌었으니 다시 빌드한다.
   - 백그라운드 기록(항상 허용, 알림, 앱 닫기, 자정)
   - 시뮬레이터 점이 실제 길을 따라가는지 본다. 웹도 된다.

## 다음 세션 시작 프롬프트

```
/Users/handong-gwan/IT희망학교 여행계획 프로젝트/HANDOFF.md 의 "지금 상태"를 읽고 이어서 작업해줘.
기능 6개는 끝났다. docs/handoff/2026-10-09/session-2-이어하기.md 의 "남은 문제 (코드)"부터 처리한다.
test/.env, test/server/.env 는 읽지 않는다. 커밋은 내가 요청할 때만 한다.
```

---

## 세션 2 이어서: 웹 실행 테스트와 오류 1·2 수정 (완료)

오류 1·2를 고치고 웹에서 다시 확인했다(아래 '결과'). 처음에는 작업 중 메모로 적었던 절이다.

### 웹 실행 테스트에서 찾은 오류 (2026-10-09 밤)

- **오류 1.** 서버 없는 기본 설정에서 루트 계산이 100구간에 **90.5초** 걸렸다.
  - 공개 OSRM(`routing.openstreetmap.de`)에 구간마다 table 요청을 하나씩 보낸다.
  - 서버가 429를 돌려주더니, 그 뒤로는 연결을 거부했다(IP 일시 차단으로 보임).
  - 실패 결과는 캐시하지 않아서, 재계산할 때마다 같은 요청을 다시 보낸다.
- **오류 2.** 시뮬레이터 300배속에서 조정안 감지는 11:10에 제때 났다. 그런데 선택지 시트는 13:20 이후에 떴다.
  - `store/live.ts`의 `makeProposal`이 `await replanForDelay`(경로 서버 대기)를 마친 **뒤에** 시계를 멈추기 때문이다.

### 고치는 방법 (사용자 승인)

- 오류 1(`src/services/routes/osm.ts`):
  - 차단기. 429·5xx·연결 실패·시간 초과가 나면 60초(실제 시각) 동안 묻지 않고 바로 대체한다(직선 추정, 캐시 안 함).
  - 공개 서버 직접 table 요청의 시간 제한을 4초로 줄인다.
  - `netClock`을 넘길 때만 켠다(기존 테스트 동작 유지). `registry.ts`가 `systemClock`을 넘긴다.
- 오류 2(`src/store/live.ts` `makeProposal`): 시뮬레이터면 조정안을 계산하기 **전에** 멈춘다. 조정안이 없으면 다시 재생한다.

### 결과

- 고친 파일:
  - `test/src/services/routes/osm.ts`: 쉬는 시간 `OSM_COOLDOWN_MS`, 직접 table 시간 제한 `OSM_TABLE_TIMEOUT_MS`, `netClock` 주입
  - `test/src/services/routes/index.ts`, `test/src/services/registry.ts`(`netClock: systemClock`)
  - `test/src/store/live.ts`(`makeProposal`)
- 새 테스트: `tests/wp4-osm-cooldown.test.ts`(5개), `tests/wp5-proposal-pause.test.ts`(2개, 소스 규칙)
- 문서: `test/README.md`(경로 절, 시뮬레이터 7번), `docs/FR-추적표.md`(갱신 표에 두 줄)
- 검사: `tsc` 오류 0, `npm test` 783개 중 782 통과·실패 0·건너뜀 1, 게이트 WP1~WP6 통과
- 웹 재확인:
  - 시나리오 채우기 직후 홈에 '확정 11 · 제외 3'이 바로 나온다(전에는 '계산 전')
  - 공개 서버 요청은 4번이었다(성공 2, 429 2). 그 뒤로는 쉬는 중이라 묻지 않았다. 다음 계산의 이동시간 조회 단계는 4ms였다
  - 300배속 10/18 종합에서 11:10 감지 직후 조정안 시트가 떴다. '원래대로' 뒤 재생이 이어져 11:32 석굴암에 도착했다. JS 오류는 0이다
- 남은 것:
  - 공개 서버가 정상일 때의 첫 계산 시간(3초 기준)은 재지 못했다. 시험 중에 이 컴퓨터가 429·연결 거부를 받는 상태였다. 서버 중계(`npm run server` + `EXPO_PUBLIC_API_URL`)로 다시 잰다
  - 진행 화면의 구간 수는 여전히 단계가 끝나야 채워진다

### 그 밖에 찾은 작은 문제 (안 고침)

- 더보기 안내 '장소와 경로를 예시 데이터로'(경로는 이제 실제 길)
- 리셋 토스트가 '게스트로 시작하기'를 가림
- 여행방 만들기 첫 화면 '2 / 3 단계'
- 기점 검색 엔터 안 됨
- 일기 '민지와 함께'(본인)
- 웹 React 응답자 props 경고
- expo 패키지 4개 패치 버전 뒤처짐
- 진행 화면 구간 수는 단계가 끝나야 채워진다(대기 중 0)

## 작은 문제 8건 수정 (완료, 사용자 요청 2026-10-09 밤)

아래 목록을 모두 고쳤다. 결과는 이 절 끝의 표와 '웹 확인'에 있다.

1. 더보기 안내 '장소와 경로를 예시 데이터로'
2. 리셋 토스트가 '게스트로 시작하기'를 가림
3. 여행방 만들기 첫 화면 '2 / 3 단계'
4. 기점 검색 엔터
5. 일기 '민지와 함께'(본인)
6. 웹 React 응답자 props 경고
7. expo 패키지 패치 4개
8. 계산 화면 구간 수가 대기 중 0

### 작은 문제 8건 — 고친 곳

| # | 고친 곳 | 내용 |
| --- | --- | --- |
| 1 | `src/features/account/settings.ts` `providerNotice`, `MoreScreen.tsx` | 안내를 실제 상태대로 보여 준다: 카카오 직접 / 서버 경유 / 서버가 카카오 못 씀 / 장소만 예시(경로는 실제 길) / 둘 다 예시 |
| 2 | `src/ui/Toast.tsx` | 토스트를 위쪽(안전 영역 아래)으로 옮기고 `pointerEvents: 'none'`. 아래 주 버튼을 가리지도, 터치를 막지도 않는다 |
| 3 | `CreateTripScreen.tsx` | '2 / 3 단계' → '1 / 2 단계' |
| 4 | `BaseSearchSheet.tsx`, `ManualAdd.tsx` | 엔터·검색 키로도 검색한다 |
| 5 | `src/services/diary/template.ts` | 멤버를 주어로 쓴다. 한 명이면 '민지가', 여럿이면 '민지, 준호가 함께' |
| 6 | `src/components/map/MapCanvas.tsx` | 웹은 SVG에 onPress 대신 onClick을 준다. 지도 누르기는 svg 기준 클릭 좌표로 바꿔 쓴다 |
| 7 | `package.json`, `package-lock.json` | `npx expo install --fix`: expo ~57.0.27, expo-image-picker·expo-location ~57.0.20(expo-constants는 잠금 파일만) |
| 8 | `core/planner/travel.ts` `ensure(onProgress)`, `core/planner/index.ts`, `features/schedule/view.ts` | 구간마다 진행 숫자가 오르고, 진행 중이면 '37 / 100구간'. 진행 막대에도 넣는다 |

- 테스트:
  - `wp6-diary` 템플릿 테스트: 주어 규칙에 맞게 고치고 경우 4개로 늘렸다
  - `wp4-screens`에 진행 테스트 1개를 더했다
  - `wp4-osm-cooldown`에 계획 진행 알림 테스트 1개를 더했다
- 검사: `tsc` 0, `npm test` 785개 중 784 통과·실패 0·건너뜀 1, 게이트 WP1~WP6 통과, `export:web` 성공·ttf 4

### 작은 문제 8건 — 웹 확인

- #1: 더보기 안내가 '카카오 키가 없어서 장소는 예시 데이터로 찾아요. 이동 시간과 길은 OpenStreetMap 실제 길에서 받아요.'로 나온다
- #2: 시연 리셋 토스트가 화면 위쪽에 뜬다. '게스트로 시작하기' 버튼은 가리지 않는다
- #3: 여행방 만들기 첫 화면이 '1 / 2 단계'다
- #4: 기점 검색 칸에서 엔터를 치면 결과가 나온다
- #5: 템플릿 일기 문장은 단위 테스트로 확인했다(웹에서 일기를 다시 만들지는 않았다)
- #6: 마커가 있는 지도 탭을 새로 띄워도 'Unknown event handler property' 경고가 늘지 않는다. 콘솔에 남은 3건은 모두 수정 전 로드의 것이다
- #7: `npx expo install --check`가 'Dependencies are up to date'를 낸다. 웹 빌드 성공, ttf 4
- #8: 단위 테스트로 확인했다. 이번 웹 시험은 캐시와 쉬는 시간 덕에 계산이 곧바로 끝나 화면에서 볼 틈이 없었다
