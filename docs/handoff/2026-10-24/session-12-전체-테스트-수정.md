# 인수인계: 전체 기능 테스트, 오류, 수정, 남은 일 (2026-10-24)

## 1. 위치와 상태
- 코드: `/Users/handong-gwan/TMAXyoungkk-figma/test`, 브랜치 `feature/dh/figma-design`.
- **전부 아직 커밋하지 않았다.** 커밋은 사용자가 요청할 때만 한다. 작성자는 본인(`hanbg191919-eng`), Claude 공동 작성자 줄은 넣지 않는다. `test/node_modules`(심볼릭 링크)와 `.claude/launch.json`은 커밋하지 않는다.
- 검증: `npx tsc --noEmit` 통과, `npm test` 1439개 중 1438 통과(1개는 원래 건너뜀), `node scripts/gate-scope.mjs WP1..WP6` 모두 통과.
- 주간 사용량 93%(97%에 닿으면 멈추고 인수인계). 5시간 한도는 낮다.
- 원본 오류 목록(B1~B23)은 `docs/qa/2026-10-24-기능-테스트-오류-목록.md`에 있다. 이 문서는 그 요약과 상태다.

## 2. 이번에 한 일
1. 관리자 전용 시연 기능을 웹 8098에서 확인했다(관리자는 보이고 일반 계정은 숨음).
2. 공개 링크를 새로 만들었다(5번).
3. 앱을 직접 조작해 전체 기능을 테스트하고 오류 23개를 목록으로 만들었다(오류는 바로 고치지 않았다).
4. 사용자가 "전부 수정"을 요청해 고칠 수 있는 것을 고쳤다.
5. 자동차 경로 수정이 실제로 먹히는지 화면으로 확인했다.

## 3. 오류와 수정 상태

### 수정함
| 번호 | 오류 | 고친 곳 |
|---|---|---|
| B1 | 카카오가 "경로 없음"(전주역 출발은 코드 105·106 교통 장애)을 주면 자동차를 도보로 계산함 | `src/services/routes/kakao.ts`: 경로 없음이면 대체 제공자(OSRM·로컬)로 한 번 더 묻는다(행렬은 칸마다, 경로는 `leg ?? fallback.route`) |
| B4 | 가입 인증 직후 "나가시겠습니까?" 글쓰기 임시저장 창이 뜸 | `src/screens/CommunityComposeScreen.tsx`: `beforeRemove`에서 `!navigation.isFocused()`면 묻지 않음 |
| B5 | 채팅에서 "풍남문 가자"가 후보로 안 담김 | `src/core/extract/text.ts`: 접미사에 성당·성곽·남문·북문·동문·서문 추가, 성문 접미사는 앞 한 글자만 있어도 허용 |
| B6 | 같은 초대 화면에서 코드가 바뀌어도 이전 결과가 남음 | `src/screens/InviteAcceptScreen.tsx`: `paramCode`가 바뀌면 `setCode` |
| B8 | 방장이 아닌 멤버가 방장이 담은 후보를 영구 삭제 | `src/core/ops/spots.ts`: `spot/delete`는 방장과 제안자만(`proposerIds`). 빼기(`spot/remove`)는 모두 가능 |
| B9 | 일반 계정 프로필에 "예시 사진으로 시연" 노출 | `src/screens/ProfileScreen.tsx`: `canUseDemoTools(session)`일 때만 |
| B12 | 내 공유 일정에 "다른 사람이 짠 일정이에요" | `src/screens/ItineraryDetailScreen.tsx`: `item.mine`이면 안 보임 |
| B14 | "개발용 메일함이 닫혀 있거나…" 문구가 사용자에게 보임 | `src/screens/SignupScreen.tsx`, `src/features/account/FindAccountSheet.tsx`: 문구 교체, 메일이 없으면 "모의 메일함" 라벨 숨김 |
| B16 | 채팅 빈 화면 예시가 늘 경주 | `src/screens/ChatScreen.tsx`: 한옥마을·남부시장 예시 |
| B17 | 삭제 버튼 "삭제"와 확인 버튼 "지우기" 불일치 | `src/screens/CommunityScreen.tsx`: 확인 버튼 "삭제" |
| B18 | 둘러보기를 마쳐도 홈의 "처음이세요?" 카드가 남음 | `src/screens/MoreScreen.tsx`: 시작할 때 `dismissGuide` |
| B7 | 방장이 내보낸 멤버에게 안내가 없음, 합류 화면에서 "합류하기"가 눌림 | `src/core/group.ts`(`wasRemoved`, `REMOVED_TITLE/TEXT`), `MembersScreen.tsx`("이 여행방에서 내보내졌어요" 안내), `InviteAcceptScreen.tsx`(내보낸 사람에게 안내 Notice, 합류 버튼 비활성) |
| B10 | 채팅 500자 제한 표시 없음 | `src/core/ops/chat.ts`(`messageLengthHint`, 450자부터), `ChatScreen.tsx`(입력줄 위에 "N / 500", 넘으면 "500자까지 보낼 수 있어요") |
| B3 | 공개 링크 커뮤니티에 팀원 `대장최윤재`의 글 3개가 보임 | `server/community.mjs`(`parseHiddenIds`, `withHiddenPosts`), `server/sync-server.mjs`: 환경변수 `COMMUNITY_HIDDEN_POST_IDS`(쉼표로 구분한 글 id)에 든 글은 목록·상세에서 빠진다. 글은 DB에 그대로 있고 id를 빼면 다시 보인다. **서버를 이 환경변수로 다시 켜야 적용된다**(값: `cmt-Gvcobk_tG38_kui-,cmt-yRLuB38AanChqxAy,cmt-Ba5leDKKvT687sXM`). 테스트 `tests/wp2-community-hidden.test.ts` |
| B11 | 지도에서 선택하면 근처 가게가 바로 후보로 담김 | `src/features/candidates/components/ManualAdd.tsx`: 지도로 찾은 한 곳은 "이 장소를 후보에 담을까요?" 확인 뒤에 담는다(여러 곳이면 원래 선택 시트) |
| B20 | AI 추천 "역사"에 막걸리·카페가 섞임 | `server/ai.mjs` `buildPrompt`: 성향태그가 있으면 모든 장소가 그 태그에 맞아야 하고 태그와 상관없는 카페·술집·맛집은 내지 말라고 한 줄 추가. 모델 답은 달라질 수 있어 실제 호출로는 확인 못 함(서버를 다시 켜야 적용) |
| B23 | 일기 "사진 추가"가 "고르는 중"에 갇힐 수 있음 | `src/screens/JournalScreen.tsx` `addPhotos`: `.catch().finally(setAdding(false))`. iOS 시뮬레이터에서는 정상 동작 확인, 웹 파일 창 닫기는 못 봄 |
| B2 일부 | 소셜 로그인 거부 문구에 서버 변수명 노출 | `server/auth.mjs`: 문구 교체(앞부분 "허용하지 않은 돌아올 주소"는 유지, 서버를 재시작했다) |

테스트: `tests/figma-design.test.ts` 끝에 QA 수정 테스트 2개를 더했다(소스 규칙, 추출 `findSuffixPhrases`).

### 오류가 아니었음
- B13: 빈 일기 저장 안내 없음 → 빈 내용이면 저장 버튼이 꺼져 있어 오류가 아니다.
- B7 재합류: 코어(`member/join` 검증)가 내보낸 같은 사람의 재합류를 이미 막는다(`duplicateId`). 코드로만 확인했고 화면에서 눌러 보지는 못했다.

### B1 확인 결과(화면)
- 8090에서 새 여행방을 만들고 경로 캐시(`young-trip/svc/routes/index`)를 지운 뒤 "다시 계산"을 두 번 눌렀다.
- 전주역 출발 도보 1시간 12분 → 자동차 14분, 복귀 도보 1시간 12분 → 자동차 13분, 스팟 사이도 자동차로 나오고 대체 경고가 사라졌다.
- **이미 만든 여행방은 "다시 계산"을 눌러야 새 값이 보인다.** 경로 캐시는 24시간이다.

### 발표 시나리오(새 기능, 시연 도구 안, 관리자 전용)
- 발표 슬라이드 "Young Trip 직접 써 보기" 4단계(채팅으로 담기, 자동 선별, 시간표와 루트, 여행 진행)를 순서대로 누르는 패널이다. 프로필 탭 > 시연 도구 > "발표 시나리오". `EXPO_PUBLIC_DEMO_TOOLS=1`이고 계정 이메일이 `EXPO_PUBLIC_ADMIN_EMAILS`에 있을 때만 보인다.
- 1단계: 경주 시나리오 방을 새로 만들고 대화 1~9줄을 보내 채팅 화면을 연다(후보 11곳). 2단계: 대화 10~13줄과 지우 합류를 이어서 돌려 후보 탭을 연다(후보 14곳, 확정 11, 제외 3, 골든 수치와 같음). 3단계: 시간표 탭. 4단계: 시뮬레이터를 켜고 재생하며 여행 진행 화면을 연다(첫날 10/17).
- 파일: `src/demo/presentation.ts`(단계 정의, 순수), `src/demo/PresentationPanel.tsx`(패널), `src/demo/scenarioSteps.ts`(`collect` 단계, `stepsAfter`), `src/demo/tools.ts`(`seedScenario(..., {after})`, `scenarioTripId`), `src/screens/MoreScreen.tsx`, `src/navigation/routes.ts`(Chat 라우트 `view`), `src/screens/ChatScreen.tsx`. 테스트 `tests/qa-presentation.test.ts`.
- 웹 8098(로컬 전용, 관리자 세션)에서 4단계를 모두 눌러 화면을 확인했다. 1단계를 다시 누르면 처음부터 한다. 어느 단계든 바로 누를 수 있다: 비어 있는 앞 단계는 알아서 채운다(`seedsNeeded`, 4단계만 눌러도 1~3단계가 채워지고 시뮬레이터가 재생됨, 웹 8098에서 확인). 4단계는 시뮬레이터를 켜기 전에 계획을 먼저 계산하고, 프리셋 '지연 25분'을 300배속으로 돌린다(`PRESENTATION_LIVE_PRESET/SPEED`). 4단계만 눌러도 약 30초 뒤 도착 기록과 "뒤 일정을 이렇게 바꿀까요" 조정안이 나온다(웹 8098에서 확인).

### 발표 4단계 점검 결과(2026-10-24, 웹 8098)
- 1단계: 후보 11곳, 불국사·석굴암·황리단길 등 추출, 중복은 "제안자 N명"으로 묶임. 정상.
- 2단계: 후보 14, 확정 11, 제외 3(대릉원 돌담길 10/17 꽉 참, 감은사지 왕복 1시간 10분, 동궁과 월지 10/18 저녁 꽉 참). 골든 수치와 같다.
- 3단계: 10/17 황리단길·첨성대 카페거리, 10/18 일곱 곳(불국사 고정, 교촌마을 점심 고정), 10/19 보문호·경주월드. 시간 순서와 이동 시간이 맞다.
- 4단계: 시뮬레이터 재생, 황리단길 도착 기록, 25분 지연 뒤 조정안(체류 40분에서 30분), 적용하면 시간표가 20:34에서 20:24 복귀로 줄어든다. 정상.
- 화면에 "투표로 고정"이 나오지만 슬라이드는 "좋아요가 모이면 고정"이다. 투표는 제품 용어(2026-10-17 결정)라 바꾸지 않았다. 발표 때 말만 맞추면 된다.
- 주의: 이 시나리오는 날짜가 10/17~19로 고정이라, 앱을 새로 고침하면 가상 시각이 풀려서 지도 화면에 "여행 끝"이 보인다. 새로 고친 뒤에는 단계를 다시 누르면(처음부터 채움) 된다.

### 지도 화면: 채팅방 패널과 핀으로 루트 추가(2026-10-24, 아직 커밋 안 함)
- 디자인 시안: 클로드 디자인 캔버스 https://claude.ai/artifact/HSEbRqewm6KeYxpV37HKPP (4장, 4번이 눌러 보는 시안).
- `src/screens/MapScreen.tsx`: 시트 맨 위에 '채팅방 · 멤버 N명 / 방 이름'(누르면 채팅방), 탭 이름을 '전체 루트 · N일차'로, 지도를 누르면 초록 핀(+), 핀을 누르면 같은 시트 안에 `PinCard`(어느 날 루트에 넣을까요 + N일차 루트에 추가 + 취소). 추가는 `addPlace`(후보에 담기) 뒤 `schedule/setDate`로 그 날짜에 정한다. 300m 안 장소가 없으면 '지도에서 고른 곳'으로 담는다. 날짜 탭에서는 그 날짜가 기본이고 그 탭에 머문다.
- 루트 목록은 전체 탭에서 모든 날짜를 날짜 머리글과 함께, 날짜 탭에서는 그 날짜만 보인다. 줄마다 휴지통(루트에서 빼기, `spot/remove`: 제외 스팟에서 되돌리기 가능)과 방금 추가한 줄의 '추가 완료' 표시가 있다. 시트 끝에 '여행 채팅에 메시지 보내기'(채팅방으로 이동).
- 웹 8098에서 확인: 핀 찍기, 핀 누르기, 2일차 추가, 목록 반영(추가 완료), 삭제(제외 스팟으로 이동), 전체 루트 탭 모두 정상. 하루가 꽉 찬 날에 추가하면 플래너가 우선순위가 낮은 기존 스팟을 제외로 밀어낸다(월정교가 밀림).
- 테스트: `tests/wp5-map-sheet.test.ts`(기존 3개를 새 구조에 맞추고 새 테스트 1개).
- 같은 날 추가 수정: (1) 홈의 여행방 카드를 누르면 그 방의 지도 화면으로 간다(`HomeScreen.openMap`). (2) 핀이 늘 가운데로 오던 버그: 핀 마커가 지도 맞춤 범위에 들어가 핀을 찍을 때마다 지도가 다시 맞춰졌다(빈 방은 핀 하나뿐이라 정중앙). 핀은 맞춤 범위(`fitBase`)에서 빼고, 핀이 있는 동안은 핀 없는 범위(없으면 여행 지역 중심)로 고정했다. (3) 누가 추가했는지: 목록 줄 아래 'OO님이 추가'(제안자 순서, 둘 이상이면 'OO 외 N명'), 선택 카드 한 줄, 추가 안내에 '추가한 사람'(`adderText` in `src/core/spotUtil.ts`). 빈 방에서 핀 두 번 찍어 위치가 따라가고, 추가하면 'admin1님이 추가'가 보이는 것을 웹 8098에서 확인했다.
- 같은 날 마무리 수정: (1) 핀 카드가 잘리던 것: 핀 카드가 열리면 시트의 날짜 머리 줄을 접고 날짜 선택을 한 줄 가로 스크롤로 바꿔(8일차까지 한 줄) 버튼이 접힌 시트 안에 다 보인다. (2) 찍은 핀을 물방울 마커 핀으로: 뾰족한 끝이 찍은 자리이고 위에 장소 이름(8글자까지) 알약이 뜬다. `MapMarkerInput.kind='drop'`, `PinSpec`의 `drop`(`src/ui/mapPinSvg.ts`), 카카오 오버레이(`overlayItems.ts`, 웹·앱), 기본 지도(`MapCanvas.tsx`)에 그렸다. 구글 지도(웹·앱)는 아직 'drop'을 모르고 일반 스팟 핀으로 보인다(구글 키가 없으면 안 쓰는 경로). 카카오 웹에서는 투명한 칸이 지도 누름을 막지 않게 몸통·이름표만 눌린다(`data-drop`). 디자인 시안 2번과 4번(눌러 보는 시안)도 물방울 핀과 위 이름으로 바꿨다.
- 마지막 추가: (1) 탭 줄(`src/ui/Seg.tsx` ScrollSeg)이 넘치면 양 끝에 좌우 화살표가 뜨고 누르면 옆으로 밀린다(마우스에는 옆으로 미는 손짓이 없어서). (2) 채팅방 지도(`src/features/chat/map/ChatMapView.tsx`)도 지도를 누르면 물방울 핀(이름 포함), 핀을 누르면 '후보에 담기' 카드가 뜨고 담으면 '추가한 사람'이 안내에 나온다(`addPlace`). 핀은 맞춤 범위에서 뺀다. 테스트: `tests/qa-ui-fixes.test.ts`. **화면에서 눌러 보지는 못했다(채팅방 지도 핀, 탭 화살표).**
- '안내하기'는 프로필의 '앱 둘러보기'(안내) 문구로 보고 지도 소개를 새 기능에 맞게 고쳤다(`tour.ts` tab-Map, `steps.ts` map). 다른 뜻이었다면 사용자에게 다시 묻는다.
- 못 한 것: 시트 안 채팅 입력(보내기)은 만들지 않았다. 지금은 입력 줄 대신 채팅방으로 가는 버튼이다. 폰 실기기·iOS는 확인 안 했다.

## 4. 수정해야 할 내용(남은 것)

### 결정이 필요한 것(사용자)
- **B3**: 사용자가 "숨기기"로 정했다. 코드는 끝났고, 실행 중인 백엔드(8787, 명령 `node --env-file-if-exists=server/.env server/sync-server.mjs`)는 아직 안 껐다(환경값을 몰라 함부로 다시 켜지 않았다). 다시 켤 때 `COMMUNITY_HIDDEN_POST_IDS=<위 id 3개>`를 넣거나 `test/server/.env`에 한 줄 추가한다.
- **B1 근본 설계(사용자가 "지금처럼 둔다"로 정했다, 바꾸지 않는다)**: 카카오가 경로 없음이고 OSRM도 안 닿는 경우. 지금은 로컬 추정(자동차 속도 기준)으로 떨어지고, 구간표가 경로 없음(null)을 주는 구간만 도보 대체(`src/core/planner/day.ts`의 `legNotice`, `fallbackTransport`)가 남는다. 이 정책을 유지할지 정한다.
- **B11**: 사용자가 "확인 단계를 넣는다"로 정했고 넣었다(위 표). 화면에서 눌러 보지는 못했다.

### 사용자가 해야 하는 것(내가 못 하는 것)
- **B2 근본 (높음)**: 공개 주소에서 구글·카카오 로그인이 안 된다. 서버 `OAUTH_REDIRECT_URIS`(`test/server/.env`, 읽지 않는 파일)에 새 공개 주소를 넣고, 구글·카카오 개발자 콘솔에도 등록해야 한다. 터널 주소가 켤 때마다 바뀌므로 이름 있는 고정 터널(Cloudflare 계정)이 필요하다.
- 공유 DB의 테스트 데이터 정리: 계정 `hanbg191919+test1`, `+test2`, `user@example.test`(있다면), 여행 `trip_sa6vwz0zwcbayhbd`, 이번 테스트 여행 "전주 테스트"(소유 계정은 탈퇴함). `test/server/.env`를 읽지 않는 규칙이라 DB는 사용자가 확인한다.

### 고칠 수 있는 것(코드)
- B7·B10은 고쳤다(위 표). 화면에서 직접 눌러 보지는 못했다(소스 규칙 테스트와 순수 함수 테스트만).
- **B15**: 시간표 편집 "앞으로"를 처음 눌렀을 때 다른 두 곳의 순서도 같이 바뀐 것을 한 번 봤다(재현 안 됨). 재현 조건 확인.
- **B19(확인함, 오류 아님)**: 칩은 "그 지역의 후보를 채팅에서 말한 멤버 수"다(`groupAreas`의 `pickerIds`, 담은 사람 기준). 멤버의 위치 정보가 아니다. 설명 문구가 없는 점만 남음(피그마 칩 글자 '{지역} {n}명'은 설계대로).
- **B21(결정 필요)**: 비밀번호 확인을 넣으려면 `AuthProvider.deleteAccount`(`src/core/ports.ts`), 서버 `POST /auth/delete`(`server/auth.mjs`), 모의 인증(`local.ts`), 설정 화면을 같이 고쳐야 한다. 소셜 전용 계정은 비밀번호가 없어 다른 확인 방법(메일 코드나 다시 로그인)이 필요하다. 사용자에게 방식을 묻는다.
- **B22(사용자가 "지금처럼 한 날에 모은다"로 정했다, 바꾸지 않는다)**: `src/core/planner/index.ts` `allocate`는 빈 날을 여는 비용(`OPEN_DAY_PENALTY_MIN` 60분)을 두고 가까운 곳끼리 한 날에 모은다. 하루 한도(9시간 39분은 한도 안)에 들어가면 첫날에 몰린다. 날마다 고르게 나누려면 정책을 바꿔야 한다.

### 확인하지 못한 것
실제 GPS 도착 기록, 사진 선택·올리기, 알림이 실제로 울리는지, 실제 폰, iOS 시뮬레이터(Xcode 런타임 미설치로 막힘), 오프라인 전환(관리자 시연 도구), 구글·카카오 로그인 성공 경로, 동시 편집 충돌.

## 5. 공개 링크 상태
- 웹: https://james-regulations-montreal-shorter.trycloudflare.com (cloudflared → 8090)
- API: https://notices-harris-technology-device.trycloudflare.com (cloudflared → 8787)
- 이 컴퓨터와 프로세스(8090 `figma-web`, 8787 `figma-server`, cloudflared 2개)가 켜져 있을 때만 열린다. 옛 주소 `stolen-immigration-plot-specs`와 `promises-falls-don-deck`은 죽었다.
- 다시 켜면 주소가 바뀌므로 `test/.env.local`의 `EXPO_PUBLIC_INVITE_BASE_URL`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SYNC_URL` 세 줄을 바꾸고 `figma-web`을 다시 시작한다. 백업은 스크래치패드의 `env.local.bak3`.
- 공개 전 주의: B3 글, 실제 Gmail 발송이 켜져 있어 누구나 인증 메일을 보낼 수 있다(주소당 하루 5통, 기기당 10분 10통 제한만).
- 이 컴퓨터에서 OSRM 공개 서버(`routing.openstreetmap.de`)가 안 닿는다(서버 로그 `osrm-table/route fetch failed`, 시간 초과).

## 6. 개발 환경
| 포트 | 내용 |
|---|---|
| 8090 | 서버 연결 웹(공개 링크의 원본), `figma-web` |
| 8787 | 백엔드 `figma-server`(`MAIL_LIMIT_EXEMPT=hanbg191919@gmail.com`) |
| 8094, 8095 | 로컬 전용·서버 연결 확인 앱(옛) |
| 8098 | 관리자 시연 확인용(끔) |

- 실행 설정은 세션 폴더 `.claude/launch.json`에 있다(`figma-demo-admin-8098`은 서버 주소 변수 4개를 비우도록 고쳤다).
- 브라우저 도우미는 페이지 안에서 `window.__ytNav`(내비게이션)와 클릭·입력 함수를 직접 만들어 쓴다. 새로고침하면 사라진다.
- 8098처럼 서버 없이 띄울 때는 `test/.env.local`을 잠깐 치워야 한다(`EXPO_NO_DOTENV=1`만으로는 터널 주소가 번들에 들어간다). 끝나면 되돌리고 체크섬을 비교한다.

## 7. 규칙
`test/.env`, `test/server/.env`는 읽지 않는다. `SMTP_PASS`는 읽거나 출력하지 않는다. 서브 에이전트는 쓰지 않는다. 사용량이 97%에 닿으면 인수인계를 쓰고 멈춘다. 사용자에게는 한국어 caveman 말투로 답한다. 금지 용어(확정 장소, 제외 장소, 투표(채팅·지도·후보 상세 밖), 출발지), 글자 화살표, `E.float` 그림자, tsx를 테스트가 가져오지 않는 규칙은 `session-10-피그마-디자인-적용.md`의 "지켜야 할 규칙"을 따른다.

## 8. 다음 대화에서 첫 순서
1. 사용량을 확인한다(`get_usage`). 주간이 높으면 짧은 일만 한다.
2. 사용자에게 B3, B1 근본, B11 결정과 커밋 여부를 묻는다.
3. B15(앱을 돌려 재현)와 B21(탈퇴 확인 방식 결정 뒤)을 고친다. B11·B20·B23은 화면에서 눌러 보지 못했으니 확인한다. 고칠 때마다 `tsc`, `npm test`, 게이트를 돌린다.
4. 공개 링크가 열려 있는지 확인한다(`curl`로 웹과 API `/health`).
