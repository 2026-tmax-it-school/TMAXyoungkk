# FR 추적표 — Young Trip 전 기능 프로토타입

기준 문서는 기능명세서 v0.2다. 계획과 계약 전문은 `docs/plan.json`, 결정 근거는 `docs/meetings/` 회의록에 있다.
이 표는 기반 작업(F)이 처음 만들었고, 2026-09-29 QA(명세 추적)가 WP1~WP6 개발과 리뷰 반영이 끝난 코드를 직접 열어 다시 썼다. 개발 보고의 주장은 쓰지 않고 코드와 테스트 결과로만 판정했다. 같은 날 릴리스 점검에서 통합 반영(계약 A12) 뒤의 코드를 다시 열어, 풀린 남은 문제를 지우고 검증 결과를 최종값으로 바꿨다.

- 갱신: 2026-09-29, 통합 QA 명세 추적 → 같은 날 릴리스 점검(05 통합 QA 회의록)
- 파일 경로는 `test/` 기준이다. 테스트 이름은 `파일 › 테스트 제목` 형식이다.
- 화면 경로의 탭 이름은 하단 탭(홈 / 후보 / 시간표 / 지도 / 더보기)이다. 괄호 안 숫자는 목업 화면 번호다.

## 검증 결과(2026-09-29 실행)

| 명령 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 오류 0건 |
| `npm test` | 585개 전부 통과, 실패 0, todo 0. golden-e2e와 integration-cross의 todo 6건은 통합에서 풀었고, 릴리스 점검에서 integration-account-delete 3건을 더했다 |
| `npx expo export --platform web --output-dir /tmp/yt-export` | 성공. 웹 번들 1.5MB 1개, 폰트 ttf 4개 |
| `node scripts/gate-scope.mjs WP1`~`WP6` | 6개 모두 통과(tsc=ok, own-tests=ok, foundation-scoped=ok) |
| 추출 품질(wp3-extract-quality 출력) | 재현율 95.7%(45/47), 오탐율 0.0%(0/45). 놓친 2건은 기림사, 골굴사(장소 사전 밖) |

개발 서버를 띄우지 않았으므로 390×844 실제 렌더링, 네이티브 기기, 여러 기기 간 실시간 동기화는 릴리스 점검까지도 눈으로 확인하지 못했다. 이 항목은 표마다 '화면 확인 필요'로 적었다.

## 상태 정의

- 구현: 명세의 입력, 출력, 예외 처리가 앱 안에서 모두 동작하고 코드와 테스트로 확인했다. 외부 제공자가 없어서 모의 제공자로 동작하는 경우도 구현으로 치고, 실제 연동이 남은 사실은 '남은 문제'에 적는다.
- 부분: 명세의 입력·출력·예외 중 하나 이상이 판정이나 표시에만 그치거나 빠져 있다.
- 미구현: 명세 기능의 진입점이나 핵심 동작이 없다.

## 1단계 (MVP)

| FR | 기능명 | 차수 | 구현 파일 | 확인 방법 | 상태 | 남은 문제 |
| --- | --- | --- | --- | --- | --- | --- |
| FR-105 | 게스트 세션 | MVP | src/core/session.ts, src/store/session.ts, src/features/account/bootstrap.ts, src/features/account/useSessionKeepAlive.ts, src/screens/OnboardingScreen.tsx, src/services/random.ts | 화면: 첫 실행 → 게스트로 시작(02). 테스트: wp1-session › 기기 토큰은 주입 Rng의 16바이트(128비트) base64url이다, › 발급 세션은 게스트이고 만료는 발급 + 30일이다, › touch는 now + 30일로 늘린다, › 저장한 세션을 다시 읽으면 같은 사용자로 복원되고 연장된다, › 만료 안내: 게스트는 복구 불가, 계정은 다시 로그인하면 여행방 유지 | 구현 | 없음. 복구 불가 안내는 02 시작 버튼 앞과 만료 토스트 두 곳에 있다 |
| FR-201 | 여행방 생성 | MVP | src/screens/CreateTripScreen.tsx, src/core/trip/create.ts, src/core/ops/trip.ts, src/features/trip/components/(RegionSheet, CalendarRange, BaseSearchSheet, TimeRange), src/data/regions.ts | 화면: 홈 → 여행방 만들기(04). 테스트: wp2-trip › 종료일 < 시작일이면 거부한다, › 14일은 확인 없이, 15일부터 확인 창 뒤 허용한다, › 지역은 국내 목록에서만 고른다, › 기점 없이(base null) 만들면 모든 날의 plan이 baseSource firstSpot이다 | 구현 | 없음. 04 '2 / 3 단계' 라벨은 공용 Header step으로 뒤로 버튼 옆 왼쪽에 둔다(통합 A12) |
| FR-202 | 스팟 수동 등록 | MVP | src/features/candidates/components/ManualAdd.tsx, src/features/candidates/components/PlacePickSheet.tsx, src/features/candidates/actions.ts, src/core/extract/manual.ts, src/core/ops/spots.ts, src/services/places/(local, kakao, index).ts | 화면: 후보 탭(06) → 목록 끝 검색 칸 또는 '지도에서 선택' → 동명 선택 시트(24) → 목적지 밖 확인. 테스트: wp3-candidates › FR-202 수동 등록: 결과 없음 · 동명 여러 곳 · 목적지 밖 확인 · 기존 후보 병합, wp3-providers › 카카오 키워드 검색: 반경 안이 0건이면 반경 없이 한 번 더 찾는다(목적지 밖 확인용) | 구현 | 카카오 로컬 실키와 웹 CORS는 fakeFetch로만 확인했다. 지역 반경 20km 안에 동명이 있으면 20~30km 거리의 찾던 곳은 나오지 않는다(04 회의록 K-1) |
| FR-203 | 여행방 목록 | MVP | src/screens/HomeScreen.tsx, src/features/account/home.ts, src/core/tripStatus.ts | 화면: 홈(03) 예정·진행중·완료 세그먼트, 방이 없으면 생성 유도 Empty. 테스트: wp1-home › 예정·진행중·완료 개수를 센다. 삭제된 방은 빠진다, › 여행방이 0개면 모든 칸이 비어 있다(화면은 생성 유도 Empty), foundation-core › 경계: 전날 23:59 예정, 종료일 23:59 진행중, 다음 날 00:00 완료 | 구현 | 없음 |
| FR-204 | 여행방 삭제·나가기 | MVP | src/screens/TripSettingsScreen.tsx, src/core/ops/trip.ts, src/core/ops/members.ts, src/store/trips.ts(removeLocal) | 화면: 더보기 → 여행방 설정 · 날짜별 기점(25) → 삭제(방장) 또는 나가기(그룹원), 확인 시트 1회. 테스트: wp2-trip › trip/delete는 방장만. 방장 삭제 뒤에는 어떤 op도 받지 않는다, › 그룹원은 나갈 수 있고 행은 나간 멤버로 남는다, › 방장 나가기는 방장 위임 미결정 사유로 거부한다 | 구현 | 방장 위임은 명세 미결정이라 방장은 나가기 대신 안내만 본다 |
| FR-205 | 기점 등록 | MVP | src/screens/TripSettingsScreen.tsx, src/core/ops/trip.ts(trip/setDay), src/core/ops/lww.ts(patchDay), src/core/trip/create.ts(effectiveBase), src/core/planner/index.ts(resolveBases) | 화면: 더보기 → 여행방 설정(25) 날짜별 지정·직전과 같음·기점 없음·복귀 없음. 테스트: wp2-trip › 그룹원도 기점을 바꿀 수 있다(전 멤버), wp4-timetable › FR-205: 'inherit'는 직전 기점, 첫날부터 null이면 첫 스팟 기점(firstSpot), noReturn이면 returnMin 0, › FR-205: 직전 날짜가 첫 스팟 기점(null)이면 다음 날의 inherit도 첫 스팟 기점이다 | 구현 | 25 기점 선택지 라벨을 '직전과 같음' 등으로 줄였다. 설명 줄에 명세 용어를 쓴다(WP2 편차 4) |
| FR-301 | 초대 링크 발급 | MVP | src/screens/MembersScreen.tsx, src/core/trip/invite.ts, src/features/trip/actions.ts, src/core/ops/trip.ts, src/services/share.ts, src/services/random.ts | 화면: 홈 → 멤버 초대(14) → 링크 만들기·복사·공유, 만료일과 남은 자리 표시. 테스트: wp2-invite › 새 초대는 7일, 정원 6이다. 링크는 youngtrip.app/j/코드, › 7일 뒤 만료다(경계 1ms 전은 유효), › 정원 6: 방장 포함 6명이면 7번째 합류는 정원 초과다, › 재발급하면 이전 코드는 revoked다(로그 판정) | 구현 | 링크를 무효화만 하는 버튼은 화면에 없다. trip/revokeInvite op는 있으나 화면은 재발급(이전 코드 무효)으로만 무효화한다. 웹 공유 시트가 없으면 클립보드 복사로 대체한다 |
| FR-302 | 초대 수락 및 그룹 전환 | MVP | src/screens/InviteAcceptScreen.tsx, src/core/trip/join.ts, src/core/trip/lookup.ts, src/store/trips.ts(acceptInvite, previewInvite), src/services/sync/(loopback, http).ts, server/sync-server.mjs | 화면: 링크 youngtrip.app/j/코드 또는 더보기 → 시연 도구 → 02 초대 수락. 테스트: wp2-invite › 첫 합류 때 개인 → 그룹으로 바뀌고 기존 스팟은 유지된다, › 이미 참여한 userId는 op 없이 already다(중복 멤버 없음), › 모든 실패 사유에 화면 문구가 있다(ended, offline 포함), wp2-sync › 동시 합류 정원 경합 2건 | 구현 | 세션이 없으면 초대를 다시 확인한 뒤 게스트 세션을 만들고, 합류가 실패하면 signOut으로 되돌린다. createGuest(userId) 순서 변경은 스토어의 멤버 판정과 부딪혀 통합에서 받지 않았다(결정 38). 방장 승인 단계는 명세 미결정 |
| FR-304 | 그룹 채팅 | MVP | src/screens/ChatScreen.tsx, src/features/chat/(send, view).ts, src/core/ops/chat.ts, src/core/chatOrder.ts, src/core/trip/outbox.ts, src/store/trips.ts, src/services/sync/** | 화면: 홈 → 그룹 채팅(05). 개인 모드면 입력이 막히고 이유를 적는다. 오프라인이면 '전송 대기' 칩. 테스트: wp2-sync › 오프라인 op는 pending에 남고 docOf에 바로 보인다. 재연결 때 at 순으로 나간다, › 두 기기가 오프라인에서 편집한 뒤 뒤섞이고 중복된 전달을 받아도 같은 문서로 수렴한다, foundation-core › seq 순으로 두고 pending은 보낸 시각 순으로 뒤에 붙인다 | 구현 | 기본 전송은 이 기기 안 루프백이다. 여러 기기 실시간은 EXPO_PUBLIC_SYNC_URL과 메모리 전용 폴링 서버가 있어야 하고 이번에 기기 간으로 확인하지 못했다(화면 확인 필요). 실제 네트워크 끊김을 감지하는 장치가 없다. 오프라인 전환은 더보기 시연 도구 토글이고, 전송 실패는 재시도 큐가 처리한다 |
| FR-401 | 채팅 장소 추출 | MVP | src/core/extract/(index, text, spot).ts, src/services/extraction/(rules, ai, index).ts, src/features/chat/send.ts, src/features/chat/components/(Bubble, ExtractionCardView).tsx, src/data/places.ts | 화면: 그룹 채팅(05) 말풍선 강조와 추출 카드, 동명이면 선택 시트(24). 테스트: wp3-extract › '거기 그 카페' 같은 지시 표현은 0건이다, › 인식 실패면 후보도 안내도 없다(빈 결과), › 동명 다수면 자동 등록하지 않고 ambiguous로 돌려준다(황남빵 2곳), › 목적지 반경 밖 장소는 버린다(포항 호미곶), wp3-golden-extract › 채팅 13줄 → 후보 14곳, 이름·카테고리·제안자가 부록 B와 같다 | 구현 | 오인식 후보 삭제는 스팟 상세(07)에 있다. 카카오 키가 있을 때 네트워크 오류로 추출에 실패한 메시지는 재연결 뒤 다시 추출하지 않는다(WP3 S3, 로컬 제공자에서는 생기지 않음, 미룸). 말풍선 강조는 굵은 글씨(bubbleBold)이고 내 말풍선은 onRoseHl 면이다(통합 A12) |
| FR-402 | 후보 목록 | MVP | src/screens/CandidatesScreen.tsx, src/features/candidates/rows.ts, src/core/ops/spots.ts, src/core/spotUtil.ts | 화면: 후보 탭(06) 확정·제외 Seg, 제안자 수 칩, 제외 카드의 사유와 되돌리기(고정). 테스트: wp3-candidates › 같은 placeId는 하나로 합치고 제안을 중복 없이 누적한다, › restore는 고정으로 되돌리고, remove·pin은 필드별 LWW다, › 06 행 계산: 확정·제외·배치 전, 사유 100%, 시간대와 고정 시각, foundation-core › 같은 사람의 여러 제안은 한 명으로 센다 | 구현 | 없음 |
| FR-403 | 후보 자동 선별 | MVP | src/core/planner/(index, day, invariants).ts, src/core/spotUtil.ts(priorityCompare), src/features/candidates/rows.ts | 화면: 후보 탭(06)에 확정 버튼 없음 칩, 고정만으로 넘치면 WarnCard. 테스트: wp4-golden-plan › 후보 14 · 확정 11 · 제외 3, › 제외 3곳의 이름·사유 코드·문장·가장 가까운 날짜, wp4-invariants › 무작위 100회: 분할·사유·고정 불가침·삽입·교환·초과 불변식, › 고정만으로 넘치면 제외하지 않고 overCapacity에 날짜와 초과분을 낸다, foundation-core › 등록 시각이 다르면 id와 상관없이 먼저 등록한 쪽이 우선이다 | 구현 | 없음. golden-e2e todo를 통합에서 풀었고 그대로 통과한다(14 · 11 · 3, 10/18 앞 세 곳, 두 번 같음) |
| FR-505 | 스팟 날짜 배분 | MVP | src/core/planner/(index, day, estimate).ts | 화면: 시간표 탭(09) 날짜 Seg, 계산 단계(08). 테스트: wp4-invariants › FR-505 근접도: 떨어진 세 군집이면 같은 날 스팟 사이 평균 이동이 다른 날 사이보다 짧다, › FR-505: 하루 수용량을 넘으면 다음 날로 이월하고, 날짜 지정 스팟은 그 날에만 둔다, wp4-golden-plan › 확정 스팟과 배치 날짜가 부록 B와 같다 | 구현 | 경로 API 제공자와 월 예산은 명세 미결정이다. 지금 상한은 비기능 100구간 기준이다 |
| FR-501 | 루트 순서 최적화 | MVP | src/core/planner/(order, legs, travel).ts, src/services/routes/** | 화면: 시간표 탭(09), 지도 탭(11). 테스트: wp4-optimize › 8개 이하 무작위 100회: Held-Karp가 완전탐색 최적값과 같다, › 10개 이하는 exact, 11개 이상은 approx이고 근사도 모든 스팟을 한 번씩 돈다, › 경로 제공자가 던지면 직선거리로 대체하고 estimated를 세운다 | 구현 | 명세는 '10개 초과 시 근사'라 10개까지 정확해다(코드와 일치). 경로 제공자 응답 규칙: null은 경로 없음 → 대체 수단(자동차는 도보) + fallbackTransport, 던짐은 요청 실패 → 같은 수단 직선거리 추정 + estimated(WP4 요청 기록). 카카오 실키 동시 요청 한도는 확인하지 못했다 |
| FR-502 | 시간표 생성 | MVP | src/core/planner/day.ts, src/features/schedule/(timeline, view).ts, src/features/schedule/components/DayTimeline.tsx, src/screens/ScheduleScreen.tsx | 화면: 시간표 탭(09) 도착·체류·출발·이동 줄, 영업시간 밖·다음 날 이월 제안 칩. 테스트: wp4-timetable › 모든 항목에서 arrive = 직전 depart + travel, depart = arrive + stay, › 카테고리 기본 체류가 명세 표와 같고, 사용자 값이 우선한다, › 영업시간 밖 도착이면 outsideHours notice를 단다, › 활동시간을 넘으면 carryOver(다음 날 이월 제안)가 나온다, wp4-golden-plan › 10/18 타임라인 | 구현 | 없음. 시각 숫자는 tabular-nums 변형으로 그린다(통합 A12) |
| FR-503 | 일정 수동 편집 | MVP | src/screens/ScheduleEditScreen.tsx, src/features/schedule/edit.ts, src/core/ops/schedule.ts, src/core/ops/lww.ts(patchSpot), src/core/planner/(adjust, preview).ts | 화면: 시간표 탭(09) → 편집(10) 순서 한 칸 이동·도착 시각·체류 ±15분·배정 날짜, 되돌리기. 테스트: wp4-edit › reorder·setStay·setArrive·setDate 뒤 다른 편집(고정)으로 재계산해도 사용자 순서와 값이 남는다, › 두 편집이 충돌하면 op.at이 늦은 쪽이 남는다(도착 순서와 무관), wp4-screens › 되돌리기: 역 초안을 적용하면 체류·도착·날짜·수동 순서가 적용 전 값으로 돌아온다 | 구현 | 수동 순서는 고정 취급이 아니다(04 회의 결정 W4-1). 명세 FR-505의 '날짜 직접 지정은 고정 취급'은 지켜진다 |
| FR-504 | 이동수단 선택(도보·자동차) | MVP | src/screens/LegTransportScreen.tsx, src/screens/CreateTripScreen.tsx, src/core/ops/schedule.ts(setDayTransport, setLegTransport), src/services/routes/(local, kakao, cache, index).ts | 화면: 여행방 만들기(04) 기본 수단, 시간표(09) 이동 줄 → 이동수단 · 경로 비교(12) '이 구간만'. 테스트: wp4-transport › setDayTransport는 그날 수단을, null은 여행방 기본 수단으로 되돌린다, › compareLeg: 자동차·도보·대중교통 비교, 경로 없는 수단은 대체 안내, wp4-optimize › 자동차 경로가 없으면(null) 도보로 대체 계산하고 fallbackTransport를 단다, wp4-golden-plan › 도보로 바꾸면 제외가 늘어난다 | 구현 | 도보는 로컬 모델이고 자동차는 카카오모빌리티(키가 있을 때, 실키 미확인)다 |
| FR-801 | 스팟 마커 표시 | MVP | src/components/map/MapCanvas.tsx, src/core/map/(layout, model).ts, src/screens/MapScreen.tsx | 화면: 지도 탭(11) 순번 핀, 제외 스팟 흰 핀, 밀집 시 숫자 원을 눌러 확대. 테스트: wp5-map › 마커 분류: 확정은 그날 순번, 기점은 base, 제외는 흰 핀에 제외 글자, › 밀집 마커는 숫자 원 하나로 묶고, 기점은 묶지 않는다, › 클러스터를 눌러 확대하면(focusOptions) 29~77m 붙은 스팟도 풀린다 | 구현 | 지도는 react-native-svg 모의 지도 한 벌이다. 국내 지도 SDK(카카오맵 또는 네이버지도) 선정과 붙이기는 남아 있다. 순번 글자는 목업 11과 같은 13px(SvgLabel pinLg)이다 |
| FR-802 | 루트 라인 표시 | MVP | src/components/map/(MapCanvas.tsx, useLegGeometry.ts), src/core/map/model.ts, src/core/constants.ts(DAY_COLORS) | 화면: 지도 탭(11) 전체·날짜 Seg. 테스트: wp5-map › 날짜별 선 색은 로즈, 초록, 앰버, 잉크 순서다, › estimated 구간과 모양이 없는 구간은 직선이고, 경로 모양이 있으면 그대로 쓴다, foundation-contrast › 날짜별 선 색은 로즈·초록·앰버·잉크 순이고 지도 바탕 위 3:1 이상이다 | 구현 | 없음. 날짜 색을 core/constants로 옮겨 core/map이 ui를 import하지 않는다(통합 A12, ui/tokens는 다시 내보내기만 한다) |
| FR-803 | 스팟 상세 | MVP | src/screens/SpotDetailScreen.tsx, src/features/candidates/detail.ts | 화면: 지도 탭(11) 핀 누르기, 또는 후보 탭(06) 행 → 스팟 상세(07) 이름·종류·주소·체류·기점에서·배치 시각·제안자. 테스트: wp3-candidates › 06 행 계산(상세 행 계산 공유). 정보 없는 항목 생략은 화면 구성이라 코드 확인(detail.ts의 filter(Boolean), SpotDetailScreen 조건부 렌더) | 구현 | 정보 없는 항목 생략은 테스트가 아니라 코드로만 확인했다(화면 확인 필요) |

## 2단계

| FR | 기능명 | 차수 | 구현 파일 | 확인 방법 | 상태 | 남은 문제 |
| --- | --- | --- | --- | --- | --- | --- |
| FR-101 | 이메일 회원가입 | 2차 | src/screens/SignupScreen.tsx, src/services/auth/local.ts, src/core/auth.ts, src/features/account/flows.ts | 화면: 더보기 → 회원가입으로 승격(16) → 아래 모의 메일함 '인증하기'. 테스트: wp1-auth › 비밀번호 규칙 위반 항목을 모두 돌려준다, › 중복 이메일은 거부한다(대소문자·공백 무시), › 가입 직후는 미인증이고 모의 메일함에 인증 메일이 온다, › 재발송하면 이전 인증 토큰은 무효가 된다 | 구현 | 서버가 없어 인증 메일은 앱 안 모의 메일함으로만 온다 |
| FR-102 | 로그인·로그아웃 | 2차 | src/screens/LoginScreen.tsx, src/screens/ProfileScreen.tsx(로그아웃), src/services/auth/local.ts, src/core/auth.ts, src/core/session.ts(accountSession) | 화면: 더보기 → 다른 계정으로 로그인(15), 프로필(17) → 로그아웃. 테스트: wp1-auth › 미인증 계정은 로그인할 수 없다, › 5회 연속 틀리면 10분 잠금, 9분 59초에는 잠김, 10분 1초 뒤 해제, › 기기 토큰 기준 10분 20회 제한은 계정과 따로 센다(IP 대체 가정), › 계정 세션은 30일이고 사용할 때 갱신, 지나면 만료(재로그인 안내) | 구현 | IP 대신 기기 토큰 기준으로 센다(서버 없음, 프로토타입 가정, 15 화면에 표시) |
| FR-103 | 소셜 로그인 | 2차 | src/screens/SocialConsentScreen.tsx, src/screens/LoginScreen.tsx, src/services/auth/local.ts(social, confirmLink), src/features/account/social.ts | 화면: 로그인(15) → 카카오·구글 → 모의 동의(26). 프로필(17)에서 연결. 테스트: wp1-auth › 정상: 소셜 계정을 만들고 다시 오면 같은 계정이다, › 제공자 실패는 providerFailed다, › 같은 이메일은 linkRequired를 거쳐 확인해야만 연결한다(자동 병합 없음) | 구현 | 실제 카카오·구글 OAuth가 없다. 모의 동의 화면에 제공자 이메일을 직접 넣는다. AuthProvider 포트의 linkToAccountId·providerEmail·getAccount는 통합에서 정식으로 넣었다(A12) |
| FR-104 | 프로필 관리 | 2차 | src/screens/ProfileScreen.tsx, src/features/account/profile.ts, src/store/session.ts, src/core/auth.ts | 화면: 홈 오른쪽 위 프로필 또는 더보기 → 프로필 · 성향 태그(17). 테스트: wp1-auth › 닉네임 중복을 거부한다(본인 계정은 예외), › 성향 태그를 저장하면 로그인 때 그대로 돌아온다, › 5MB 초과 이미지는 압축 대상이고 압축 뒤 한도 안이다 | 부분 | 이미지 5MB 초과 압축은 판정과 전후 크기 표시만 한다. 실제로 줄인 파일을 만드는 코드가 없다(core/auth.ts compressedImageBytes는 예상 크기 계산이다). 닉네임 중복 검사는 모의 인증에 있는 계정 닉네임과만 비교한다 |
| 승격 | 게스트 → 정식 계정 승격 | 2차 | src/store/session.ts(applyAuth), src/features/account/(flows, profile).ts, src/core/auth.ts, src/core/ops/members.ts(member/accountLinked) | 화면: 더보기 → 회원가입으로 승격(16). 테스트: wp1-auth › 게스트 userId로 가입하면 계정 userId가 같다, › 참여 중인 방마다 member/accountLinked 하나를 본인 멤버로 보낸다, wp2-invite › 게스트 승격(accountLinked)은 행동한 본인 멤버만 계정으로 바꾸고 memberId를 유지한다 | 구현 | 이관 범위는 명세 미결정이다. 지금은 이 기기 데이터를 그대로 두고 userId를 유지한다 |
| FR-303 | 멤버 관리 | 2차 | src/screens/MembersScreen.tsx, src/core/ops/members.ts, src/core/trip/members.ts, src/core/group.ts | 화면: 멤버 초대(14) → 멤버 행 메뉴(방장) → 초대 권한 토글, 내보내기. 테스트: wp2-invite › 방장만 내보낼 수 있고 방장 본인은 불가다, › 내보낸 멤버는 op를 보낼 수 없다, › 방장 외 전원이 나가면 개인 모드로 돌아가고 채팅·스팟은 유지된다, › 초대 권한 토글은 방장만, 방장 자신에게는 쓸 수 없다 | 구현 | '권한 조정'은 초대 권한(canInvite) 하나다. 내보낸 멤버의 스팟과 채팅은 그대로 남긴다(명세가 정하지 않은 부분, 프로토타입 가정) |
| FR-404 | 여행지 추천 | 2차 | src/screens/RecommendScreen.tsx, src/core/recommend.ts, src/services/recommend/(local, ai, index).ts | 화면: 후보 탭(06) 목록 끝 '여행지 추천' 또는 더보기 → 여행지 추천(23). 오프라인이면 비활성. 테스트: wp3-recommend › 3~5곳, 기존 후보와 겹치지 않고 지역 안이며 기점용 장소는 빠진다, › 태그가 없거나 부족하면 인기 장소로 대체하고 fallback을 세운다, › 여행 날짜 전부가 휴무 요일인 곳은 빼고, 무게중심은 지역 안 후보로만 잡는다, wp3-providers › AI 프록시 추천: 기존 후보·지역 밖·형식 오류를 걸러 내고, 3곳 미만이면 로컬로 대체한다 | 구현 | 근접도 기준점은 확정 스팟 좌표(RecommendRequest.anchor)이고, 계산 결과가 없으면 지역 안 후보로 잡는다. 결과 출처는 RecommendResult.source로 알린다(통합 A12). AI 프록시 요청에는 기준점을 싣지 않는다. 기간은 여행 날짜 전부 휴무인 곳을 빼는 데만 쓴다 |
| FR-504 확장 | 대중교통 | 2차 | src/services/routes/transit.ts, src/data/scenario-tuning.ts(SCENARIO_TRANSIT), src/screens/LegTransportScreen.tsx | 화면: 이동수단 · 경로 비교(12) 대중교통 칸. 테스트: wp4-transport › 대중교통 모의 = 도보 접근 + 배차 간격 절반 대기 + 승차 + 환승 벌점, › 대중교통 route는 단계와 estimated를 주고, 구간표 null이면 경로 없음(null) | 부분 | 실제 환승·배차 시간표가 없고 모의 모델만 있다. 대중교통 API는 정하지 않았다 |
| FR-601 | 현재 위치 표시 | 2차 | src/screens/(LiveTripScreen, MapScreen, NavigateScreen).tsx, src/services/location/(sim, device, index).ts, src/store/live.ts, src/core/map/layout.ts | 화면: 더보기 → 여행 진행 · 시뮬레이터(19), 지도 탭(11)과 길찾기(13)에 로즈 점. 권한 거부면 수동 진행 모드, 정확도 초과가 이어지면 GPS 음영 안내. 테스트: wp5-map › 현재 위치: 정확도 50m 초과(또는 모름)는 흐린 원이다, wp5-sim › 권한 거부: 샘플이 없고 수동 진행 모드가 된다, wp5-arrival › 정확도 초과가 연속 3샘플이면 GPS 음영 안내, 정확한 샘플이 오면 끈다 | 구현 | 기기 모드(expo-location)는 실제 기기와 웹 보안 출처에서 확인하지 못했다(화면 확인 필요). 웹 LAN http에서는 위치 권한이 막혀 시뮬레이터를 쓴다. 가상 시각이 켜져 있으면 기기 모드를 막는다 |
| FR-602 | 도착 감지 | 2차 | src/core/live/(arrival, engine, context).ts, src/store/live.ts, src/screens/LiveTripScreen.tsx | 화면: 여행 진행(19) 도착 표시, '도착 취소', '수동 진행'. 테스트: wp5-arrival › 반경 100m 안에 3분 머물면 도착이고, 도착 시각은 반경에 들어온 시각이다, › 2분 59초는 도착이 아니다, › 정확도 50m 초과 샘플(80m)은 판정에서 빠진다, › 수동 취소하면 cancelled가 되고 그 스팟이 다시 남은 일정이 된다, › 지나친 뒤 다음 스팟에 도착하면 앞 스팟은 건너뜀이다 | 구현 | 이미 떠난 스팟의 도착을 취소할 때 건너뜀으로 바꾸는 화면 동작이 정해지지 않았다(WP5 S10, 통합 QA 결정 대기). 도착 토스트는 알림이 아니라 화면 안 상태 표시로 두고 prefs.arrival로 끈다(결정 W5-7) |
| FR-603 | 지연 감지 및 일정 재계산 | 2차 | src/core/live/delay.ts, src/core/planner/replan.ts, src/features/live/components/ProposalSheet.tsx, src/store/live.ts | 화면: 여행 진행(19) → 시뮬레이터 '지연 25분'·'영업 종료' 프리셋 → 조정안 시트(적용·거절). 테스트: wp5-delay › 지연 경계는 15분이다(15 조정안, 14 없음), › 같은 상황의 조정안은 30분에 1회다(공유 notify), › 조정안 문구에 경고 문구가 없다, wp4-replan › 빼기 조정안은 영업 종료로 못 가는 스팟이 1순위, 그다음 FR-403 순서, 고정은 빼지 않는다, › 조정안은 초안일 뿐이다: 거절하면 문서와 계획이 그대로다, wp5-sim › 영업 종료(실제 10/18 계획): 도착 예정이 마감을 넘기면 그 스팟 빼기(영업 종료)가 조정안 1순위다 | 구현 | 명세는 순서 변경 또는 스팟 제외인데, 체류 줄이기 조정안이 하나 더 있다(04 회의 결정 W4-3, 편차). WP5×WP4 연결은 integration-cross › WP5×WP4와 qa-live가 실제 함수로 확인한다 |
| 탈퇴 | 계정 탈퇴(비기능 데이터 보존) | 2차 | src/core/auth.ts(planAccountDeletion), src/core/ops/members.ts(member/anonymize), src/core/ops/journal.ts(photoRemoved), src/features/account/flows.ts, src/screens/ProfileScreen.tsx | 화면: 프로필(17) → 계정 탈퇴(확인 1회). 테스트: wp1-auth › 방마다 본인 사진의 photoRemoved와 본인 멤버의 anonymize를 만든다, › 남의 사진·채팅·제안은 건드리지 않는다(초안에 없다), wp2-trip › 닉네임 '탈퇴한 멤버', anonymized, leftReason deleted, leftAt. 채팅·제안 memberId는 그대로, wp6-photo › 사진을 지우고 일기 블록 photoIds에서도 뺀다, integration-cross › WP1×WP2×WP6, integration-account-delete › 여러 여행방: 방마다 그 방의 본인 멤버로 초안을 만들고, 끝난 방(편집 잠금)과 이미 나간 방에서도 적용된다, › 적용 순서: 익명 처리가 사진 삭제보다 먼저 닿아도 결과가 같다, › 일기: 탈퇴한 사람 사진만 문단에서 빠지고, 사진이 빠진 자동 문장은 비우며, 고친 문장과 남은 사진은 그대로다 | 부분 | 이미 만든 일기 문장에 들어간 탈퇴 멤버 닉네임(함께한 멤버)은 그대로 남는다(WP6 S5, 결정 33 정책 미결정). 로그아웃·탈퇴·시연 리셋은 clearSessionPhotos()로 웹 세션 사진을 비운다(통합) |

## 3단계

| FR | 기능명 | 차수 | 구현 파일 | 확인 방법 | 상태 | 남은 문제 |
| --- | --- | --- | --- | --- | --- | --- |
| FR-604 | 빈 시간 추천 | 3차 | src/core/live/freetime.ts, src/features/live/components/FreeTimeCard.tsx, src/services/places/**(nearby) | 화면: 여행 진행(19) → 시뮬레이터 '빈 시간' 프리셋 → 빈 시간 카드. 테스트: wp5-freetime › 30분이면 2~3곳, 29분이면 없다, › 주변 결과가 없거나 1곳뿐이면 추천을 생략한다, › findFreeTime은 도보 반경 800m로 nearby를 부르고 기존 후보를 뺀다, › notifyPrefs.freeTime이 꺼져 있으면 없다 | 구현 | 카카오 카테고리 검색 실키는 확인하지 못했다 |
| FR-701 | 사진 업로드 | 3차 | src/screens/PhotosScreen.tsx, src/features/journal/api.ts, src/core/journal/(photo, exif).ts, src/services/photos/(device, sim, index).ts, src/core/ops/journal.ts | 화면: 더보기 → 사진(20), 여행 진행(19)과 기록 지도(22)에서도 진입. 테스트: wp6-photo › EXIF가 있으면 촬영 시각과 위치를 그대로 쓰고, 위치로 스팟을 고른다, › EXIF가 없으면 업로드 시각과 그 시각 계획 스팟으로 추정한다, › 10MB 이하는 그대로, 넘으면 압축 대상이고 원본·압축 크기를 남긴다, › blob:·data: 주소는 문서에 넣지 않고 sessionOnly로 메모리에만 둔다 | 부분 | 10MB 초과 압축은 판정과 '압축' 칩 표시만 한다. image-picker를 quality 1로 열고 파일을 줄이는 코드가 없다. 웹은 EXIF와 파일 크기를 받지 못해 항상 추정으로 가고, 사진은 이 세션에서만 보인다. 사진 저장 위치와 용량 정책은 명세 미결정이다 |
| FR-702 | 자동 일기 생성 | 3차 | src/screens/DiaryScreen.tsx, src/features/journal/api.ts, src/core/journal/diary.ts, src/services/diary/(template, ai, index).ts | 화면: 더보기 → 일기(21) → 날짜 고르기 → 만들기. 테스트: wp6-diary › 사진·도착 기록·장소를 스팟 단위 시간순 블록으로 묶는다, › 사진 0장이면 방문 기록만으로 만든다, › 작성기가 던지면 status empty인 빈 일기를 주고 죽지 않는다, › 템플릿 문장은 카테고리와 함께한 멤버, 사진 수를 담는다 | 구현 | AI 프록시 문장은 EXPO_PUBLIC_AI_PROXY_URL이 있을 때만 쓰고 실제 프록시로 확인하지 못했다 |
| FR-703 | 일기 편집·공유 | 3차 | src/screens/DiaryScreen.tsx, src/core/ops/journal.ts(diaryEdited), src/features/journal/api.ts(shareDiary), src/services/share.ts | 화면: 일기(21) → 문단 편집·저장, 공유(공유 시트가 없으면 복사). 테스트: wp6-diary › diaryEdited는 op.at 나중 저장 우선이고, 순서가 뒤바뀌어 도착해도 같다, › 다시 만들어도 사용자가 고친 문장과 공유 시각은 남는다, › 공유 문장에는 여행방 제목, 날짜, 블록 시각·장소·문장이 들어간다, › 나간 멤버의 사진은 일기에 그대로 남는다 | 구현 | 문단 편집은 여러 줄 입력이다(Field multiline). 공유 시트를 닫으면 share.ts가 dismissed를 돌려주고 공유 시각을 남기지 않는다(통합 A12). 탈퇴 멤버 사진은 지우고 나간 멤버 사진은 남긴다 |
| FR-704 | 이동 경로 기록 | 3차 | src/core/journal/track.ts, src/core/live/(track, throttle, background).ts, src/store/live.ts | 화면: 여행 진행(19)에서 기록 → 기록 지도(22). 테스트: wp6-track › 도착 기록과 위치 로그를 시간순으로 잇는다, › 위치 권한이 거부돼 로그가 없으면 도착 지점만 순서대로 잇고 그 사이는 기록 없는 구간이다, › 정확도가 나쁜 샘플과 다른 날 샘플은 쓰지 않고, EXIF 사진 위치는 점으로 더한다 | 구현 | 권한 거부 기록을 날짜별로 남기지 않아 '권한 거부' 안내는 오늘 날짜에만 뜬다(WP6 S9) |
| FR-804 | 실제 이동 경로 표시 | 3차 | src/screens/RecordMapScreen.tsx, src/core/journal/recordMap.ts, src/components/map/MapCanvas.tsx(dots, dashed) | 화면: 더보기 → 기록 지도(22) 실제 경로 점, 계획 선, 공백 점선, 범례. 테스트: wp6-track › 기록이 끊긴 구간(백그라운드 공백)은 dashed 대상이고 채워 넣지 않는다, › 실선 구간은 공백을 건너 잇지 않고, 공백은 잉크 점선이다, › 권한 거부면 도착 지점만 잇고 안내한다. 실선 없이 전부 점선이다 | 구현 | 실제 이동 점은 목업과 같은 r 3.5·흰 테두리이고 사진 위치 점은 r 2.4다(통합). 넷째 날부터 계획 선(잉크)과 실제 경로 점(잉크) 색이 겹친다(WP6 D5, 시나리오는 3일이라 드러나지 않음, 결정 대기) |

## 비기능 요구사항

| 항목 | 요구 | 차수 | 구현 파일 | 확인 방법 | 상태 | 남은 문제 |
| --- | --- | --- | --- | --- | --- | --- |
| 성능(재계산) | 루트 재계산 3초 이내 | MVP | src/core/planner/**, src/core/constants.ts(RECOMPUTE_MS) | wp4-budget › 스팟 14곳 재계산은 RECOMPUTE_MS(3초) 안에 끝난다 | 구현 | 로컬 경로 제공자 기준이다. 카카오 실제 응답 지연을 넣은 측정은 없다 |
| 성능(지도) | 지도 초기 로딩 2초 이내 | MVP | src/core/map/layout.ts, src/core/constants.ts(MAP_LAYOUT_BUDGET_MS) | wp5-map › 성능: 14곳·3일 선·위치 점 300개 layoutMap이 100ms 안에 끝난다 | 부분 | 순수 계산 100ms만 테스트로 확인했다. 렌더를 포함한 2초는 화면 확인이 필요한데 이번에 하지 못했다 |
| 추출 품질 | 재현율 80% 이상, 오탐율 10% 이하 | MVP | src/core/extract/**, src/services/extraction/** | wp3-extract-quality › 재현율 80% 이상, 오탐율 10% 이하(실행값 95.7%, 0.0%) | 구현 | 팀이 만든 문장 집합과 로컬 장소 사전 기준이다. 카카오 실키와 실제 사용자 대화로는 재지 않았다 |
| 선별 품질 | 자동 제외 스팟 100% 이유 표시 | MVP | src/core/planner/invariants.ts, src/features/candidates/rows.ts, src/screens/(CandidatesScreen, MapScreen, ScheduleEditScreen).tsx | wp4-invariants › 무작위 100회: 분할·사유·고정 불가침…, wp3-candidates › 06 행 계산: … 사유 100% …, wp4-screens › 10 편집 뒤 새로 자동 제외된 스팟은 이유와 함께 알린다 | 구현 | 표시 위치(06 제외 카드, 11 지도 목록, 10 토스트)는 코드로 확인했다 |
| 외부 API 비용 | 재계산 1회 경로 100회 이하, 동일 구간 24시간 캐시 | MVP | src/core/planner/index.ts(ROUTE_CALL_BUDGET 상한), src/services/routes/cache.ts, src/services/routes/index.ts | wp4-budget › 시나리오 첫 계산은 100구간 이하, 같은 입력을 24시간 안에 다시 계산하면 0구간, › 캐시는 구간을 받은 시각부터 24시간이고, 1초 지나면 다시 조회한다 | 구현 | 지도가 선 모양을 얻으려 부르는 route()는 캐시를 거치고 100구간 셈에 넣지 않는다(03 결정) |
| 위치 정확도 | 50m 이하 샘플만, 반경 100m | 2차 | src/core/constants.ts(ARRIVAL_ACCURACY_M, ARRIVAL_RADIUS_M), src/core/live/arrival.ts | wp5-arrival › 정확도 50m 초과 샘플(80m)은 판정에서 빠진다, › 옆 건물(120m)에 5분 머물러도 도착이 아니다 | 구현 | 없음 |
| 배터리 | 위치 갱신 30초, 정지 시 중단 | 2차 | src/core/live/throttle.ts, src/services/location/device.ts, src/core/constants.ts(LOCATION_INTERVAL_MS) | wp5-sim › 스로틀: 30초에 1개만 넘기고, 20m 안에서 멈춰 있으면 위치 로그를 갱신하지 않는다, › 정지가 2분(4샘플) 이어지면 기기 감시를 20m 이동 때만 받는 방식으로 바꾸고, 움직이면 되돌린다 | 구현 | 정지 뒤 distanceInterval 20m 재구독은 웹에서 무시된다고 가정했다. 실기기 배터리 측정은 없다 |
| 백그라운드 | 상시 추적 없음, 꺼진 동안 경로 복원 안 함 | 2차 | src/core/live/background.ts, src/store/live.ts | wp5-sim › 백그라운드가 되면 멈추고, 돌아와도 그 사이 경로를 채우지 않는다, wp5-arrival › 앱으로 돌아오면 꺼지기 전 반경 진입 기록을 버린다 | 구현 | 없음 |
| 오프라인 | 확정 일정·좌표 오프라인 열람, 재계산·추천은 온라인 | MVP | src/store/trips.ts(persist: docs·log·pending·plans·dirty, online), src/screens/(PlanningScreen, RecommendScreen).tsx | wp2-sync › 오프라인 편집은 dirty가 되고, 재연결 계획은 flush 뒤 재계산 대상을 준다. 화면: 더보기 → 시연 도구 오프라인 토글 → 08 '재계산을 멈췄습니다', 23 비활성 | 구현 | 오프라인은 시연 토글로만 들어간다. 실제 네트워크 상태 감지가 없다. 앱을 다시 열면 online이 true로 돌아온다 |
| 개인정보 | 위치 이력 종료 후 90일 삭제, 위치 공유 기본 꺼짐 | 3차 | src/core/tripStatus.ts(isTrackExpired), src/core/live/track.ts(pruneTracks), src/store/live.ts, src/screens/MoreScreen.tsx | wp5-sim › 위치 로그는 시간순이고, 공유 isTrackExpired로 90일 뒤 지운다, foundation-core › isTrackExpired: … 경계 ±1초. 화면: 더보기 설정 '그룹원 위치 공유 꺼짐 · 미결정' | 구현 | 위치 공유 기능 자체는 만들지 않았다(명세 미결정) |
| 데이터 보존 | 종료 후 1년 보관, 탈퇴 시 본인 사진 삭제·이력 익명화 | 2차 | src/core/tripStatus.ts(retentionUntil), src/store/trips.ts(purgeExpired, 부팅과 복원 뒤 호출), 탈퇴 행의 파일 | wp2-trip › 종료일 다음 날 00:00 KST + 365일부터 만료다(경계 전후 1초), foundation-core › retentionUntil·isRetentionExpired…, 탈퇴 행 테스트 | 부분 | 기기 안 여행방만 지운다. 루프백 KV 저장분과 동기화 서버(메모리 전용)는 보관 기한 정리를 하지 않는다(WP2 S9). 탈퇴 쪽 남은 문제는 '탈퇴' 행과 같다 |
| 알림 | 동일 유형 30분 1회, 유형별 끄기 | 2차 | src/core/notify.ts, src/store/session.ts(notifyPrefs), src/screens/MoreScreen.tsx | foundation-core › notify 4종 30분 1회·끄기, wp5-delay › 같은 상황의 조정안은 30분에 1회다(공유 notify), wp1-home › 알림 4종 전부 끌 수 있는 줄이 있다 | 구현 | 푸시 알림은 없고 앱 안 토스트와 시트만 있다 |
| 보안(1단계) | 추측 불가 기기 토큰, 30일, 난수 초대 링크 | MVP | src/services/random.ts(expo-crypto getRandomBytes), src/core/session.ts, src/core/trip/invite.ts, src/core/util.ts | wp1-session › 기기 토큰은 주입 Rng의 16바이트(128비트) base64url이다, wp2-invite › 코드 1000개에 헷갈리는 글자(I, L, O, U)가 없고 중복도 거의 없다(40비트) | 구현 | 초대 코드는 40비트다. 링크를 가진 사람은 누구나 합류한다(방장 승인 미결정) |
| 보안(2단계) | 비밀번호 해시, 토큰 만료, 계정·IP 이중 시도 제한 | 2차 | src/core/sha256.ts, src/services/auth/local.ts, src/core/auth.ts | wp1-auth › 비밀번호 원문은 저장하지 않고 salt + SHA-256만 둔다, › 5회 연속 틀리면 10분 잠금…, › 기기 토큰 기준 10분 20회 제한은 계정과 따로 센다(IP 대체 가정) | 부분 | 해시는 salt + SHA-256 한 번이라 느린 해시가 아니다(프로토타입 한정). IP 대신 기기 토큰으로 센다. 서버가 없어 모든 판정이 기기 안에서 일어난다 |
| 서비스 지역 | 국내 전용, 지도 SDK 1종, SDK 중립 인터페이스 | MVP | src/core/ports.ts, src/services/registry.ts, src/data/regions.ts, src/components/map/MapCanvas.tsx | foundation-design-rules › react-native-maps를 쓰지 않는다(지도는 MapCanvas 한 벌), foundation-core-boundary 7건, wp2-trip › 지역은 국내 목록에서만 고른다 | 구현 | 국내 지도 SDK는 아직 고르지 않았고 모의 지도만 있다 |
| 지원 환경 | 모바일 웹 우선, iOS·안드로이드 최신 2개 버전 | MVP | app.config.js, 웹 export | `npx expo export --platform web` 성공(2026-09-29) | 부분 | 네이티브 빌드와 실기기, 390×844 웹 렌더링은 이번에 확인하지 못했다 |

## 편차와 판단 기록

패키지가 추적표에 적어 달라고 요청한 것이다. 명세를 되돌리는 결정은 없다.

1. 14 멤버 행의 '대기' 칩은 전송 대기 뜻이다. 목업의 '링크 열람 · 아직 합류 전'은 열람 기록이 op로 남지 않아 표현하지 않는다(WP2 D-5).
2. 14 멤버 초대는 탭바 없는 스택 화면이다(WP2 D-4).
3. 14 게스트 안내는 '본인에게 알립니다'다. 방장 알림은 만들지 않았다(WP2 S10).
4. 25 기점 선택지 라벨은 줄여 쓰고 설명 줄에 명세 용어를 쓴다.
5. 경로 제공자 응답 규칙: null은 경로 없음이라 대체 수단(자동차는 도보)과 fallbackTransport, 던짐은 요청 실패라 같은 수단 직선거리 추정과 estimated다(WP4).
6. FR-603 조정안에 체류 줄이기가 있다. 순서 변경과 제외 뒤에 하나만 나온다(W4-3).
7. 수동 순서는 고정 취급이 아니고, 12 '이 구간만'은 그날 순서를 수동 순서로 굳힌다(W4-1, W4-2).
8. 도착 토스트는 화면 안 상태 표시로 두고 prefs.arrival로 끈다(W5-7).
9. 샘플이 끊겨도 마지막 정확한 샘플이 5분 안이면 시계로 도착을 판정한다. 가상 시각이 켜져 있으면 기기 위치 모드를 막는다. 90일 정리는 앱 시작 하이드레이션 뒤에 한다(WP5).
10. '영업 종료' 시뮬레이터 프리셋은 마감 여유가 가장 적은 스팟 앞에서 여유 + 40분을 머문다(WP5).

## 공통 남은 문제

- 통합 게이트는 통과했다. todo 0건, tsc 0건, 웹 export 성공, ttf 4개, '여정'·'yeojeong' 0건, legacy-v1 import 0건이다.
- 공유 변경 요청은 통합에서 계약 A12로 반영했다. 받지 않은 것은 WP2의 createGuest(userId) 순서 변경 하나다(결정 38).
  미룬 것은 WP3 재연결 재추출 훅, WP4 D6 12 미리보기 문장 굵은 강조(토큰만 있음), WP6 21이 09 시간표 틀 공유(선택), 기반 C13 테스트 전용 tsconfig다.
- 사용자 화면 문구에서 내부 화면 번호를 없앴다(팀 규칙, 18 시연 도구 화면 목록만 예외).
- 화면 동작으로 정할 것이 남아 있다: FR-602 이미 떠난 스팟의 도착 취소 처리(WP5 S10), 탈퇴 멤버 닉네임이 든 일기 문장(WP6 S5),
  넷째 날부터 계획 선과 실제 이동 점의 색 겹침(WP6 D5).
- 외부 실키 미확인: 카카오 로컬·카카오모빌리티·AI 프록시는 fakeFetch로만 검증했다. 키가 번들에 들어가므로 시연 한정이다.
- 명세 미결정 7건(경로 API 제공자와 예산, 승격 이관 범위, 초대 승인, 위치 공유, 방장 위임, 예산·정산, 사진 저장 정책)은 코드가 안내 문구나 보수적 기본값으로 비워 두었다. 예산·정산과 환율 같은 명세 밖 기능은 만들지 않았다.

## 릴리스 점검(2026-09-29)에서 달라진 점

- 통합 반영 뒤 코드를 다시 열어 풀린 남은 문제를 지웠다: FR-201 단계 라벨, FR-302 createGuest 결정, FR-401 말풍선 강조, FR-403 골든 todo, FR-502 tabular-nums,
  FR-801 순번 글자, FR-802 날짜 색 위치, FR-103 포트 필드, FR-404 기준점과 출처, FR-603 통합 테스트, 탈퇴 통합 테스트와 세션 사진 비우기,
  FR-703 여러 줄 편집과 dismissed, FR-804 이동 점 크기.
- 계획 qa.testTargets에 있던 tests/integration-account-delete.test.ts를 만들었다(3건: 여러 방·종료 잠금·이미 나간 방, 적용 순서, 일기 문단).
- 상태 판정은 바뀌지 않았다. 기능 38행 구현 34·부분 4, 비기능 16행 구현 12·부분 4다. 탈퇴 행은 통합 테스트와 사진 비우기가 풀렸지만
  일기 문장 속 닉네임이 남아 부분으로 둔다.

## 이전 표(2026-09-23)와 달라진 점

- 열을 FR, 기능명, 차수, 구현 파일, 확인 방법, 상태, 남은 문제로 바꿨다. 모의·실제 제공자 정보는 남은 문제로 옮겼다.
- 스텁·공유 완료였던 행을 코드와 테스트 결과로 다시 판정했다. 기능 38행(FR 35개와 승격, 대중교통 확장, 탈퇴) 가운데 구현 34, 부분 4(FR-104, FR-504 대중교통, 탈퇴, FR-701)이고, 비기능 16행 가운데 구현 12, 부분 4(성능 지도, 데이터 보존, 보안 2단계, 지원 환경)다. 미구현은 없다. MVP 20행은 모두 구현이다.
- FR-602, FR-604, FR-704의 '미착수·예정' 파일 경로를 실제 파일(src/core/live/**, src/core/journal/track.ts)로 바꿨다.
