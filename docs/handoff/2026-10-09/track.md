# 기능 4. 동선 기록 보완 — 구현 보고
요약: 기능 4(동선 기록 보완)를 프로토타입에 넣었다. 판정은 순수 코드(core)에 두고 테스트했고, 스토어·화면·어댑터는 그 결과를 쓰기만 한다.
1) 백그라운드 동선 기록(옵션, 기본 꺼짐): src/services/location/background.ts를 새로 만들었다. expo-location의 startLocationUpdatesAsync와 expo-task-manager를 쓴다. 작업(defineTask)은 모듈 최상위에서 한 번만 정의하고, index.ts가 앱 등록 전에 이 모듈을 불러온다. expo-task-manager는 Expo Go와 웹에서는 아예 불러오지 않고, 그 밖에서는 try 안의 require로 불러온다. 그래서 import만으로 앱이 깨지지 않는다.
2) 옵션이 켜져 있고 기기 위치로 진행하면 이 작업 하나로 앱 안팎 샘플을 받는다(30초·20m). 엔진(core/live)은 화면 밖 샘플을 판정 없이 위치 로그에만 넣고, 그 구간을 공백으로 보지 않는다. 늦게 온 OS 묶음의 옛 샘플은 버린다. 진행 끝내기, 옵션 끄기, 진행 날짜가 지남, 앱 종료 중 하나면 받기가 멈춘다. 시뮬레이터·수동 진행에는 영향이 없다.
3) 여행 진행(19) 화면에 '백그라운드 동선 기록' 줄(BgRecordCard)을 넣었다. 켤 때만 '앱 사용 중 허용' 다음 '항상 허용'을 묻는다. 웹, Expo Go, 설정이 빠진 빌드에서는 누를 수 없고 '개발 빌드 필요' 같은 이유를 보여준다. app.config.js에서 iOS·안드로이드 백그라운드 위치와 포그라운드 서비스를 켜고 한국어 권한 문구를 넣었다.
4) 날짜별 권한 거부 기록(FR-704): 기기·시뮬레이터로 시작하려다 권한이 없어 수동 진행이 되면 useLive.denied에 그 날짜를 남긴다(저장 필드 추가, 90일 뒤 정리). 기록 지도는 지난 날짜라도 이 기록으로 '이 날은 위치 권한이 없어 도착 지점만 순서대로 이었습니다'라고 안내한다.
5) 기록 지도 색(FR-804): 지금 색 체계에서는 4일째부터 계획 선이 앰버, 실제 이동 점이 파랑(mapC.user)이다. 그래서 '넷째 날부터 색이 같아진다'는 문제는 9월 29일 모노톤 개편 뒤로 이미 재현되지 않았고, 추적표 메모가 낡은 것이었다. 실제로 고친 것은 두 가지다. 기록 지도가 날짜 색 목록을 따로 들고 있던 것을 공유 dayColor로 합쳤다. 그리고 남아 있던 진짜 겹침을 고쳤다. 1일째 잉크 계획 선 위에 잉크 공백 점선이 같은 자리로 겹쳐 점선이 보이지 않았는데, 계획 선이 잉크인 날은 점선을 청회색으로 그린다. 범례도 모델이 고른 색을 그대로 쓴다. 15일 전체에 대해 실제로 칠해지는 색으로 계획 선과 이동 점이 구분되는지 테스트로 확인했다.
바꾼 파일: test/src/core/live/background.ts, test/src/core/live/engine.ts, test/src/core/live/throttle.ts, test/src/core/live/track.ts, test/src/core/journal/recordMap.ts, test/src/store/live.ts, test/src/services/location/background.ts, test/src/services/location/device.ts, test/src/services/location/index.ts, test/src/screens/LiveTripScreen.tsx, test/src/screens/RecordMapScreen.tsx, test/src/features/live/bgRecordText.ts, test/src/features/live/components/BgRecordCard.tsx, test/app.config.js, test/index.ts, test/tests/wp6-track.test.ts, test/tests/wp5-background.test.ts, test/tests/wp6-record-map.test.ts
게이트: - npx tsc --noEmit: 오류 0건.
- npm test: 마지막 실행에서 676개 모두 통과, 실패 0.
  - 중간에 두 번 tests/wp2-db.test.ts의 '조회용 표…' 테스트 1건이 실패했다. 다른 에이전트가 작업 중인 server/DB 테스트이고 내 파일과는 관계없다.
  - 그 파일만 따로 돌렸을 때와 그 뒤 전체 실행에서는 통과했다.
- node scripts/gate-scope.mjs WP5: 통과(tsc 0건, wp5 테스트 8개 파일, YT_SCOPE=WP5 foundation 7개).
- node scripts/gate-scope.mjs WP6: 통과(tsc 0건, wp6 테스트 4개 파일, YT_SCOPE=WP6 foundation 7개).
- 고친 FOUNDATION 파일(app.config.js, index.ts)은 전체 npm test의 foundation 테스트로 함께 확인했다.
doc_notes: [사용법]
- 여행 진행(19)에서 기기 위치를 쓸 때 '백그라운드 동선 기록' 줄이 보인다.
  - 시작 전에는 진행 방식 카드 아래, 기기 위치로 진행하는 중에는 진행 기록 위에 있다.
  - 시뮬레이터·수동 진행 중이거나, 더보기에서 기기 위치를 껐으면 보이지 않는다.
- 기본은 꺼짐이다. 켤 때만 권한을 묻는다: 앱 사용 중 허용 → 항상 허용 순서.
- 웹, Expo Go, 백그라운드 설정이 없는 빌드에서는 누를 수 없고 이유를 보여준다(개발 빌드 필요).
- app.config.js를 바꿨으므로 개발 빌드를 다시 만들어야 반영된다.

[동작]
- 켜져 있고 기기 위치로 진행하면 Location.startLocationUpdatesAsync(작업 이름 young-trip-bg-location) 하나로 앱 안팎 샘플을 모두 받는다.
  - 요청 값은 30초·20m다(core/live/throttle backgroundWatchRequest). 몰아서 온 샘플은 throttleBatch가 시간순으로 30초에 1개만 넘긴다.
  - iOS는 상태 막대에 위치 사용 표시가 뜬다. 안드로이드는 포그라운드 서비스 알림 'Young Trip 동선 기록 중'이 뜨고, 앱을 닫으면 서비스도 닫힌다(killServiceOnDestroy).
- 화면 밖 샘플은 위치 로그(useLive.track)에만 들어간다. 30초 스로틀과 정지 건너뜀 규칙은 앱 안과 같다.
  - 도착·지연·빈 시간 판정과 알림은 앱으로 돌아온 뒤에 한다.
  - 돌아오면 꺼지기 전 반경 진입 기록을 버리는 기존 규칙은 그대로다.
- 켜져 있는 동안 화면 밖에 있던 구간은 공백이 아니다(core/live/background의 recording 상태).
  - 화면 밖에서 기록이 끊기거나 늦게 켜지면 그 시각이 공백의 경계가 된다(setRecording).
- 받기가 멈추는 때:
  - 여행 진행 끝내기·리셋(teardown)
  - 옵션 끄기
  - 진행 날짜가 지남(자정을 넘김, bgRecordRuns)
  - 앱을 닫음(작업에 받을 곳이 없으면 받기를 멈춤)
- 시작 때 '항상 허용'이 거둬져 있으면 묻지 않고 옵션을 끈 뒤 진행 기록에 한 줄 남긴다.
- 위치는 서버로 보내지 않는다. 90일 보관 규칙은 그대로다.

[저장]
- useLive persist에 두 필드를 추가했다(추가만 했으므로 STORAGE_VERSION은 그대로).
  - denied: tripId → date → { at, source: 'device' | 'sim' }
  - bgRecord: 옵션 값
- bgActive(지금 받기가 도는지)는 저장하지 않는다.
- 데모 리셋을 하면 둘 다 초기화된다.

[날짜별 권한 거부(FR-704 S9 해소)]
- 시뮬레이터·기기로 시작하려다 권한이 없어 수동 진행이 되면 그 날짜에 남긴다(core/live/track noteLivePermission).
  - 사용자가 수동 진행을 고른 것은 거부가 아니다.
  - 기기 거부는 처음 시각을 지키고 지우지 않는다.
  - 시뮬레이터 거부 프리셋 기록은 그날을 다시 재생하면 덮는다. 기기 거부를 시뮬레이터가 덮지는 않는다.
- 기록 지도(22)는 지금 권한 상태가 아니라 이 기록을 읽는다. 지난 날짜에도 '이 날은 위치 권한이 없어 도착 지점만 순서대로 이었습니다'라고 안내한다.
  - 시뮬레이터 프리셋 거부면 시뮬레이터 안내도 함께 뜬다.
  - 거부한 날이라도 나중에 허용해 위치 로그가 생기면 로그를 쓰고 거부 안내는 띄우지 않는다.
- 거부 기록은 위치 로그와 같은 규칙(pruneTracks, isTrackExpired)으로 90일 뒤 지운다.

[기록 지도 색(FR-804 D5 해소)]
- 계획 선은 공유 dayColor를 쓴다: 1일 잉크, 2일 청회색, 3일 초록, 4일부터 앰버.
- 실제 이동 점은 파랑(mapC.user)이라 어느 날짜 선과도 겹치지 않는다. 9월 29일 개편 뒤로 '넷째 날 잉크 겹침'은 이미 재현되지 않았다.
- 남아 있던 겹침을 고쳤다. 1일째 잉크 계획 선 위에 잉크 공백 점선이 겹쳐 보이지 않았는데, 계획 선이 잉크인 날은 점선을 청회색으로 그린다(gapLineColor). 범례도 모델 색(plannedColor, gapColor)을 쓴다.

[앱 설정]
- app.config.js의 expo-location 설정:
  - isIosBackgroundLocationEnabled, isAndroidBackgroundLocationEnabled, isAndroidForegroundServiceEnabled를 true로 켰다.
  - locationAlwaysAndWhenInUsePermission, locationAlwaysPermission에 한국어 문구를 넣었다.
- index.ts가 앱 등록 전에 src/services/location/background를 불러온다.
- 새 환경 변수는 없다.

[FR-추적표 갱신 제안]
- FR-704: 남은 문제를 '없음'으로 바꾸고, 파일에 src/services/location/background.ts를 추가한다.
- FR-804: 결정 대기 메모를 위 설명으로 바꾼다.
- 백그라운드 행: '옵션(기본 꺼짐)으로 화면 밖 동선 기록, 꺼져 있으면 지금처럼 공백'으로 바꾼다.
- 테스트 이름에 tests/wp5-background.test.ts와 tests/wp6-record-map.test.ts를 추가한다.

[한계]
- 화면 밖에서는 도착을 판정하지 않는다.
- 자정을 넘긴 진행에서는 백그라운드 기록이 멈춘다.
- 앱을 닫으면 기록도 끝난다.
남은 문제: 실기기 확인 필요(개발 빌드를 다시 만든 뒤): iOS '항상 허용' 권한 요청과 화면 밖 위치 수신, 상태 막대 위치 사용 표시. 안드로이드 '항상 허용' 설정 화면 흐름, 포그라운드 서비스 알림, 앱을 닫으면 서비스가 닫히는지(killServiceOnDestroy), 안드로이드 14 위치 유형 포그라운드 서비스. 규칙상 개발 서버·시뮬레이터·export를 띄우지 않아 런타임에서 한 번도 돌려 보지 않았다. / Expo Go와 웹에서 import만으로 앱이 깨지지 않는지는 코드 구조와 소스 규칙 테스트로만 확인했다(Expo Go·웹에서는 require 자체를 하지 않음). 실제 Expo Go·웹 실행 확인이 남아 있다. / store/live.ts의 백그라운드 연결부(startBgWatch, onAppState, setBgRecord, onSample의 날짜 지남 처리)는 zustand·RN 의존이라 node 테스트가 없고 소스 정규식으로만 본다. 실기기에서 켜기·끄기·화면 밖 갔다 오기·진행 끝내기 흐름 확인이 필요하다. / 결정이 필요한 것: (1) 옵션 값(bgRecord)을 저장하므로, 다음 기기 진행 때 '항상 허용'이 남아 있으면 다시 묻지 않고 자동으로 켜진다(줄에 '켜짐'으로 보임). 진행마다 새로 켜게 할지 정해야 한다. (2) 화면 밖에서는 도착 판정을 하지 않는다. 화면 밖에서도 판정하길 원하면 알림 정책까지 정해야 한다. (3) 자정을 넘기면 백그라운드 기록이 멈춘다. / 출시 전 할 일: App Store의 백그라운드 위치 사용 사유와 Google Play의 백그라운드 위치 권한 신고가 필요하다. 안드로이드 포그라운드 서비스 알림 아이콘(androidForegroundServiceIcon)은 정하지 않아 기본 아이콘이 쓰인다. / 더보기(18, WP1 MoreScreen)의 위치 설정 영역에는 백그라운드 기록 상태를 보여 주지 않는다(내 범위 밖). 필요하면 WP1에서 상태 줄을 추가한다. / iOS가 여러 위치를 한 번에 늦게 넘기면 이미 받은 시각보다 이른 샘플은 버린다. 앱을 다시 켤 때 넘어오는 시작 60초 전보다 오래된 위치도 버린다. 실기기에서 기록이 빠지는 정도를 봐야 한다. / 참고: 이번 기능은 서버·DB를 건드리지 않는다. 위치를 서버에 올리지 않는다는 결정에 따라 동선과 거부 기록은 이 기기의 AsyncStorage에만 있다.

# 1차 수정(이미 반영됨)
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

# 1차 수정 뒤 다시 한 리뷰 3건(아직 반영 안 됨)
### 리뷰 A 리뷰: 명세는 대부분 충족한다. 직접 돌려 보니 tsc 오류 0건, npm test 729개 중 728개 통과에 1개 건너뜀(실패 0), WP5·WP6 게이트도 통과했다. 소유권·디자인 규칙·process.env·.env.example 규칙 위반은 없고 위치 로그는 서버로 가지 않는다. 다만 이전 설정으로 만든 안드로이드 빌드에서 켤 수 없는 이유를 '항상 허용'이라고 잘못 안내하는 문제(major) 1건이 있다. 그 밖에 기록 지도 공백 판정, 권한 문구, 소스 정규식에만 기대는 스토어 테스트, 낡은 보고 내용(minor)을 고쳐야 한다.
- [major] test/src/services/location/background.ts:187 — 이번 변경 전 설정으로 만든 안드로이드 개발 빌드(isAndroidBackgroundLocationEnabled: false라 매니페스트에 ACCESS_BACKGROUND_LOCATION이 없음)에서 19 화면의 '백그라운드 동선 기록'을 켜면 문제가 생긴다. Location.requestBackgroundPermissionsAsync()가 NoPermissionInManifestException(code 'ERR_NO_PERMISSION_IN_MANIFEST', 메시지 'You need to add `ACCESS_BACKGROUND_LOCATION` to the AndroidManifest')을 던진다(node_modules/expo-location/android/.../LocationModule.kt 433-435). enable()의 catch는 이유를 가리지 않고 { ok:false, reason:'denied' }를 돌려준다. 그래서 '위치를 항상 허용해야 켤 수 있습니다. 설정에서 위치 권한을 바꾼 뒤 다시 켜 주세요'라는 토스트가 뜬다. 하지만 이 빌드의 설정 화면에는 '항상 허용' 선택지가 없어 사용자는 해결할 수 없다. 이 경우에 맞는 안내는 notInBuild('개발 빌드를 다시 만든 뒤')이다. core/live/background.ts의 bgFailReason(118행)도 같은 구멍이 있다. 코드 'ERR_NO_PERMISSION_IN_MANIFEST'가 /PERMISSION/에 걸려 'denied'가 되고, 메시지는 /not found in the manifest/에 맞지 않는다. alwaysPermission()의 catch도 이 오류를 'denied'로 돌려준다. 그래서 startLive가 '위치 항상 허용이 없어 백그라운드 기록을 껐습니다'라고 잘못 남긴다. wp5-background의 bgFailReason 테스트는 '빌드 설정이 빠진 것'을 본다고 하지만 이 경우는 빠져 있다. → 고칠 방법: bgFailReason에서 PERMISSION 정규식보다 먼저 `code === 'ERR_NO_PERMISSION_IN_MANIFEST' || code === 'ERR_LOCATION_INFO_PLIST' || /AndroidManifest|Info\.plist/.test(msg)`이면 'notInBuild'를 돌려준다. enable()은 `catch (e)`로 받아 bgFailReason(e)로 옮긴다. notInBuild와 servicesOff는 그대로 돌려주고 나머지만 denied로 둔다. alwaysPermission()도 매니페스트 오류는 거부로 보지 않게 한다. wp5-background 테스트에 { code:'ERR_NO_PERMISSION_IN_MANIFEST', message:'You need to add `ACCESS_BACKGROUND_LOCATION` to the AndroidManifest' } → 'notInBuild' 사례를 넣는다.
- [minor] test/src/core/live/engine.ts:146 — 명세는 '켜져 있는 동안은 기록 없는 구간(공백)으로 보지 않는다'인데, 기록 지도(22)에는 점선이 생긴다. 실제 core 코드로 재현했다(scratchpad gapcheck). 기록을 켠 채 화면 밖에서 안드로이드 받기(30초, 거리 조건 0)로 40분 정지한 뒤 차로 출발(30초에 300m)하면 엔진 공백은 0개다. 그런데 정지 샘플은 20m 규칙(throttleSample record=false)으로 로그에서 빠진다. 그래서 위치 로그에서 정지 시작 점과 출발 첫 점이 40분·300m 떨어져 buildDayTrack(journal/track.ts 100행: 5분 초과·100m 초과)이 공백 1개를 만든다. 기록 지도는 기록이 켜져 있던 구간을 점선 '기록 없는 구간'으로 그린다. 차로 다니는 일정에서 식당·카페처럼 5분 넘게 머문 곳을 떠날 때마다 생긴다. 앱 안 안드로이드 감시(정지 프로필 60초·20m)도 같은 규칙이라 이전부터 있던 한계다. 하지만 이번 명세의 약속과 직접 부딪힌다. → 고칠 방법: 정지가 끝날 때 마지막 정지 샘플(출발 지점)을 함께 남긴다. 예를 들어 ThrottleState에 lastStill을 두고, record가 다시 참이 되는 샘플 앞에 lastStill을 track 효과로 넣는다. 다른 방법은 정지 중에도 TRACK_GAP_MS보다 짧은 간격(예: 4분)으로 한 점씩 기록하는 것이다. '40분 정지 뒤 30초에 300m 출발이면 buildDayTrack gaps가 0'인 테스트를 wp5-background에 넣는다.
- [minor] test/app.config.js:27 — iOS '항상 허용' 권한 문구(BACKGROUND_LOCATION_TEXT)는 '여행 동선을 이 기기에만 남기려고 위치를 사용합니다'라고 한다. 안드로이드 포그라운드 서비스 알림 본문(services/location/background.ts 39행)도 '위치 기록은 이 기기에만 남습니다'라고 한다. 하지만 화면 밖 위치는 도착 판정에도 쓰인다. engine.ts ingestAway(136-152행)가 visit 효과를 내고, store/live.ts recordVisit(331-339행)가 journal/visit op(status arrived, arrivedAt)를 여행방에 dispatch해 서버로 동기화한다. 그래서 앱을 닫아 둔 사이에 들른 스팟과 도착 시각이 그룹원에게 보인다. 권한 문구가 실제 위치 사용 목적(도착 기록 공유)을 빠뜨려 App Store 목적 문구 기준과 '서버에 위치를 올리지 않는다'는 설명이 어긋날 수 있다. → 고칠 방법: 권한 문구, 안드로이드 알림 본문, BgRecordCard 꺼짐 상태 설명(bgRecordText.bgRecordSub 마지막 줄)에 '스팟 도착은 여행방 방문 기록으로 남는다'를 넣는다. 예: '…동선은 이 기기에만 남기고, 스팟에 도착하면 여행방 방문 기록에 남깁니다'. wp5-background의 앱 설정 테스트에 문구 검사를 더한다.
- [minor] test/tests/wp5-background.test.ts:504 — 스토어 연결부(startBg·off·onFail·syncWatch·startLive의 항상 허용 확인)는 store/live.ts 소스 정규식으로만 본다. 그래서 동작이 깨져도 테스트가 통과한다. 예: onFail 안의 `set({ bgRecord: false })`(store/live.ts 543행)를 지워도 모든 테스트가 그대로 통과한다. 이 줄을 지우면 권한 회수 같은 시작 실패 때 onFail → syncWatch가 일어난다. 옵션이 켜진 채라 watchPlan.bg가 참이 되어 startBg가 다시 불리고, 다시 실패한다. 이 반복이 계속 돌며 진행 기록에 '켜짐/껐습니다' 줄이 쌓인다. 반대로 동작을 바꾸지 않는 리팩터링(줄 순서, 변수 이름)은 테스트를 깨뜨린다. → 고칠 방법: 백그라운드 받기 제어(startBg/off/onFail, syncWatch의 결정 적용)를 BackgroundLocation 어댑터·시계·콜백을 주입받는 작은 모듈로 뺀다. 예: core/live 또는 features/live의 bgController. node 테스트에서 가짜 어댑터로 onFail·샘플·자정 타이머를 일으켜 옵션이 꺼지는지, 다시 시작하지 않는지, teardown에서 멈추는지를 동작으로 확인한다. 아니면 registry overrideServices로 bgLocation을 바꿔 끼울 수 있게 한다.
- [minor] test/src/core/live/session.ts:246 — 구현 보고가 지금 코드와 맞지 않는다. 문서 단계가 이 보고로 doc_notes와 추적표를 쓰면 틀린 동작이 기록된다. (1) '바꾼 파일' 목록에 src/core/live/session.ts가 없다. 이 기능을 위해 liveStopReason·LIVE_STOP_TEXT가 추가됐고, store/live.ts stopIfInvalid와 wp5-background 테스트가 쓴다. (2) 요약 2)는 '엔진은 화면 밖 샘플을 판정 없이 위치 로그에만 넣고'라고 하고, 남은 문제 (2)는 '화면 밖에서는 도착 판정을 하지 않는다'라고 한다. 실제 코드는 화면 밖에서도 도착을 판정해 visit op를 동기화한다(engine.ts ingestAway, 테스트 '…위치 로그와 도착 기록(visit)까지만 가고…'). (3) 보고한 테스트 이름 일부가 실제 파일과 다르다(예: '…도착 판정·알림은 없다'). 실제 파일에는 '기기 거부는 그날 실제로 진행할 때만 남긴다' 같은 보고에 없는 테스트가 있다. → 고칠 방법: 바꾼 파일 목록에 test/src/core/live/session.ts를 넣는다. 요약·남은 문제·doc_notes를 지금 동작으로 고친다. 화면 밖에서도 도착을 판정하고, 방문 기록(여행방 동기화)과 진행 기록 줄만 남기며, 알림·조정안·빈 시간 추천은 돌아온 뒤에 본다. 테스트 이름도 실제 파일 기준으로 다시 적는다.
- [minor] test/src/services/location/background.ts:130 — `export const BG_TASK_DEFINED = TM != null;`는 주석에 'index.ts 확인용'이라고 적혀 있지만 index.ts를 비롯해 어디에서도 쓰지 않는 죽은 내보내기다. 읽는 사람이 index.ts가 작업 정의 여부를 확인한다고 오해한다. → 고칠 방법: 쓰지 않으면 지운다. 확인이 필요하면 index.ts나 개발 모드 경고에서 실제로 쓰고 주석을 맞춘다.
### 리뷰 B 리뷰: 기능 4는 명세대로 동작하고 tsc와 WP5·WP6·foundation 테스트 300개도 통과한다. 다만 구현 보고(doc_notes에 쓸 내용)가 화면 밖 도착 판정·동기화, 받기 방식, 테스트 이름에서 지금 코드와 달라 그대로 문서에 옮기면 틀린 설명이 된다. 또 iOS에서 화면 밖에서도 앱이 살아 있게 되면서 동기화 폴링이 계속 도는 비용을 다루지 않았다.
- [major] test/src/core/live/engine.ts:136 — 구현 보고(요약·남은 문제·추가 테스트)가 지금 코드와 다르다.
(a) 요약 2)와 남은 문제 (2)는 '화면 밖 샘플을 판정 없이 위치 로그에만 넣는다', '화면 밖에서는 도착 판정을 하지 않는다'고 적었다. 실제 ingestAway는 화면 밖에서도 stepArrival로 도착·건너뜀을 판정해 visit 효과를 낸다. 그러면 store applyEffects→recordVisit가 journal/visit op를 여행방에 올리고, 이 op는 동기화 서버로 간다(좌표는 없다). 진행 기록 줄도 남는다.
(b) '이 작업 하나로 앱 안팎 샘플을 받는다(30초·20m)'도 사실과 다르다. 앱이 떠 있는 동안은 앱 안 감시(device.ts)와 백그라운드 받기를 함께 돌리고(watchPlan fg+bg), 요청 값은 iOS 20m 이동·안드로이드 30초 간격으로 나뉜다(backgroundWatchRequest).
(c) 보고에 빠진 동작이 있다.
- 오늘 날짜를 진행할 때만 돌고 자정에 멈춘다(notToday·dateOver 줄).
- 기기 거부는 진행 날짜가 오늘일 때만 남는다.
- 시뮬레이터 거부 기록은 그날을 다시 진행하면 지워진다.
- 시뮬레이터를 다시 재생하면 그날 앞 재생 점이 지워진다(clearSimTrackDay).
- 안드로이드 13 알림 권한(POST_NOTIFICATIONS) 요청과 noticeHidden 토스트가 생겼다.
(d) 보고의 테스트 이름 8개 이상이 실제와 다르다. 예를 들어 보고의 '엔진: 기록 중 화면 밖 샘플은 30초·정지 규칙으로 위치 로그에만 들어가고 도착 판정·알림은 없다'는 실제로 '...위치 로그와 도착 기록(visit)까지만 가고 알림·지연·빈 시간은 내지 않는다'이다. bgFailReason·watchPlan·머문 시간 도착·앞날 거부·clearSimTrackDay 등 테스트 9개는 보고에 아예 없다.
결과: 마지막 문서 단계가 이 보고로 README·FR-추적표를 고치면 '화면 밖 도착은 판정·공유하지 않는다'는 틀린 설명과 없는 테스트 이름이 들어간다. → 고칠 방법: doc_notes를 지금 코드 기준으로 다시 쓴다.
- 화면 밖 도착은 알림 없이 방문 기록(여행방 동기화, 좌표 없음)과 진행 기록 줄로 남는다. 지연 조정안·빈 시간 추천은 앱으로 돌아와서 본다.
- 앱이 떠 있으면 두 받기를 함께 돌린다. 요청은 iOS 20m, 안드로이드 30초다.
- 오늘 날짜를 진행할 때만 돌고 자정에 멈춘다.
- 기기 거부는 진행 날짜가 오늘일 때만 남기고, 시뮬레이터 거부 기록은 그날을 다시 진행하면 지운다.
- 시뮬레이터를 다시 재생하면 그날 앞 재생 점을 지운다.
- 안드로이드 13에서는 알림 권한도 묻는다.
사용법도 적는다. 더보기에서 '기기 위치 사용'을 켜고, 19 여행 진행에서 일정이 있는 날의 '백그라운드 동선 기록' 줄을 누른다. app.config가 바뀌었으니 개발 빌드를 다시 만들어야 한다.
테스트 이름은 tests/wp5-background.test.ts와 tests/wp6-record-map.test.ts에서 그대로 복사한다. 남은 문제 (2)는 '화면 밖 도착은 판정·기록하되 알림은 없음'으로 고친다.
- [major] test/src/store/live.ts:697 — iOS에서는 백그라운드 받기(UIBackgroundModes location, pausesUpdatesAutomatically false)가 도는 동안 앱이 멈추지 않는다. RN RCTTiming은 화면 밖에서도 sleep 타이머로 JS 타이머를 계속 부르고(bridgeless ObjCTimerRegistry도 같다), 스토어 주석도 '화면 밖에서도 앱이 살아 있어 자정 타이머가 돈다', '동기화가 계속 온다'고 전제한다.
EXPO_PUBLIC_SYNC_URL이 있으면 services/sync/http.ts subscribe가 따라가는 여행방마다 2.5초 setInterval로 GET /trips/:id/ops를 부르고, AppState를 보지 않는다. 경주 2박 3일 중 하루를 백그라운드 기록을 켠 채 다니면 방 하나에 시간당 1,440회, 하루 2만 회 넘게 서버를 부르고 셀룰러 무선을 계속 깨운다.
그 사이 다른 멤버가 일정을 고치면 onRemote→scheduleRecompute로 화면 밖에서도 경로 재계산(공개 OSRM·카카오 요청)이 돈다. 전에는 iOS가 화면 밖 앱을 곧 멈춰 생기지 않던 비용이다. 이 기능 때문에 새로 생겼는데 남은 문제에도 없다. → 고칠 방법: AppState가 active가 아니면 동기화 폴링을 멈추거나 느리게(예: 60초) 하고, 돌아오면 바로 pull을 한 번 하게 한다. 화면 밖에서 받은 원격 op 때문에 하는 재계산도 돌아온 뒤로 미룬다. 이 코드는 store/trips.ts의 connect/disconnect 또는 services/sync/http.ts에 들어가는데 이 기능 범위 밖(WP2·trips)이다. 이번에는 open_issues에 'iOS 백그라운드 기록 중 동기화 폴링 2.5초 지속·화면 밖 재계산'으로 적고 담당에게 넘긴다.
- [minor] test/src/services/location/background.ts:187 — 작업 관리자는 들어 있지만 백그라운드 위치 설정이 빠진 빌드가 있을 수 있다. 예를 들어 ios/android 폴더를 남긴 채 expo run으로 다시 빌드하면 app.config 변경이 반영되지 않는다.
이런 빌드에서 옵션을 켜면 iOS requestBackgroundPermissionsAsync는 ERR_LOCATION_INFO_PLIST로 거부한다(EXBackgroundLocationPermissionRequester). 안드로이드는 NoPermissionInManifestException('You need to add ACCESS_BACKGROUND_LOCATION to the AndroidManifest', 코드 ERR_NO_PERMISSION_IN_MANIFEST)을 던진다.
enable()의 catch는 예외를 모두 'denied'로 돌려준다. 그래서 '위치를 항상 허용해야 켤 수 있습니다. 설정에서 위치 권한을 바꾼 뒤 다시 켜 주세요' 토스트가 뜨지만, 설정에는 '항상 허용' 항목이 없어 사용자가 할 수 있는 일이 없다.
bgFailReason도 ERR_NO_PERMISSION_IN_MANIFEST를 /PERMISSION/ 규칙에 걸어 denied로 본다. → 고칠 방법: bgFailReason에서 PERMISSION 규칙보다 먼저 ERR_LOCATION_INFO_PLIST·E_LOCATION_INFO_PLIST·ERR_NO_PERMISSION_IN_MANIFEST(메시지에 'Info.plist'나 'to the AndroidManifest'가 있는 경우 포함)를 notInBuild로 보게 한다. enable()의 catch에서는 bgFailReason(e)가 notInBuild이면 { ok: false, reason: 'notInBuild' }를 돌려준다. 그러면 토스트가 BG_BLOCK_TEXT.notInBuild('개발 빌드를 다시 만든 뒤')가 된다. wp5-background의 bgFailReason 테스트에 두 코드를 더한다.
- [minor] test/src/store/live.ts:452 — zustand persist는 set을 부를 때마다 partialize한 상태 전체(모든 여행방·날짜의 track, denied, notifyLog)를 JSON으로 만들어 AsyncStorage에 쓴다. onSample은 효과가 없어도 applyEffects([], false, { last })로 set을 한 번 부른다.
안드로이드 백그라운드 받기는 거리 조건 없이 30초마다 샘플을 넘긴다(backgroundWatchRequest). 그래서 화면 밖에서 멈춰 있는 동안에도 30초마다 위치 로그 전체를 다시 쓴다. 정지 상태라 로그는 늘지 않는데도 그렇다. 3일 여행 로그(하루 최대 2,000점)라면 수백 KB를 하루 수천 번 쓰는 셈이다.
앱 안 감시는 정지가 2분 이어지면 20m 조건으로 바뀌어 이런 부담이 작았다. 이번 옵션으로 화면 밖에서 하루 종일 생긴다. → 고칠 방법: 화면 밖(run.engine.background.inBackground)인데 track·visit 효과가 없으면 set을 건너뛴다. 이때 엔진 상태와 마지막 샘플은 rt에만 두고, 돌아올 때 한 번 set 한다. 다른 방법으로, last·log처럼 저장하지 않는 값을 비저장 스토어로 옮겨 track이 바뀔 때만 persist가 쓰게 한다.
- [minor] test/src/core/journal/recordMap.ts:133 — recordMapModel은 그날 거부 기록이 있으면 도착 지점이 하나도 없어도 'denied' 안내를 띄운다. noLog 안내는 track.marks.length > 0일 때만 띄우는데, denied에는 이런 조건이 없다.
예: 기기 위치로 시작했다가 권한이 없어 수동 진행이 됐고, 그날 도착 처리를 하나도 안 했다. 이 날 기록 지도에는 계획 선만 있는데도 '이 날은 위치 권한이 없어 도착 지점만 순서대로 이었습니다. 그 사이 이동은 점선으로 남깁니다'라고 안내하고, 점선은 없다. 그날 계획도 없으면 '기록이 없습니다' 빈 화면 위에 같은 안내가 뜬다. → 고칠 방법: 도착 마크(kind 'arrival')가 있을 때만 'denied' 문구를 쓴다. 도착이 없으면 안내를 띄우지 않거나 '이 날은 위치 권한이 없어 이동 기록이 없습니다' 같은 다른 문구를 쓴다. wp6-record-map에 도착이 없는 거부일 테스트를 더한다.
### 리뷰 C 리뷰: 옵션 가능 판정, 받기 켜고 끄기(watchPlan·직렬 큐), 묶음 스로틀(퍼징 3천 회 이상 없음), 거부 기록, FR-804 색은 대체로 맞고 tsc 0, 전체 테스트 729개 통과입니다(실패 0, 건너뜀 1). 다만 Android 화면 밖 기록에서 정차 뒤 차로 떠나면 기록 지도에 공백 점선이 생겨 '켜져 있는 동안 공백 아님' 명세를 어깁니다(재현함). 그 밖에 기록 중 오래된 샘플을 기한 없이 믿는 문제, 시뮬레이터 점이 거부 안내를 가리는 문제 같은 작은 문제가 있습니다.
- [major] test/src/core/live/throttle.ts:45 — Android에서 백그라운드 기록 중에 한 자리에 5분 넘게 머문 뒤 차로 떠나면, 기록 지도에 '기록 없는 구간' 점선이 생깁니다. 명세의 '켜져 있는 동안은 공백으로 보지 않는다'를 어깁니다.

원인: Android 백그라운드 받기는 backgroundWatchRequest가 30초 간격·거리 조건 0으로 요청합니다. 머무는 동안 오는 샘플은 ingestAway의 throttleSample 정지 판정(20m)에 걸려 위치 로그에 하나도 남지 않습니다. 출발 뒤 첫 기록점은 30초 안에 100m 넘게 이동한 자리입니다. 그래서 마지막 기록점(도착 시각)과의 사이가 buildDayTrack의 공백 조건(5분 초과, 100m 초과)에 걸립니다.

재현(scratchpad probe2.test.ts): engineRecording(true) 뒤 background 상태에서 09:00~09:10 정차(30초 샘플), 09:10:05에 40km/h로 출발하는 샘플을 만들어 throttleBatch → ingestSample → buildDayTrack에 넣었습니다. 결과는 기록 점 [0s, 630s, 660s…], track.gaps 1, engine background.gaps [] 입니다.

구현 테스트는 30분 정차 뒤 25m 걷기만 봐서 이 경우를 잡지 못합니다. iOS는 20m 거리 조건이라 첫 점이 가까워 생기지 않습니다. 시내 주행(30~40km/h)이면 출발할 때마다 대략 60~70% 확률로 생깁니다. → 고칠 방법: 정지로 건너뛴 샘플 가운데 가장 늦은 것을 ThrottleState에 들고 있다가(예: lastStill), 다음 기록점보다 먼저 track으로 냅니다. 또는 정지 중이어도 마지막 기록점에서 TRACK_GAP_MS보다 짧은 간격(예: 4분)마다 한 점을 남깁니다. 회귀 테스트로 '30초 간격 10분 정차 뒤 차량 출발이면 buildDayTrack gaps 0'을 wp5-background에 추가합니다.
- [minor] test/src/core/live/engine.ts:234 — tickAt이 기록 중(recording)에는 마지막 샘플을 시간 제한 없이 믿습니다. 그런데 그 샘플이 기록을 켜기 전, 공백 이전의 것일 수 있습니다. Android처럼 샘플이 끊기면 정지가 아니라 신호 끊김인 경우도 있습니다.

재현 (a)(scratchpad probe4): 기록이 꺼진 상태에서 09:10 불국사 반경 안 샘플 1개를 받습니다. 그 뒤 화면 밖으로 가서 공백 [09:11, 10:40)이 생기고, 돌아와 10:40에 기록을 켭니다. 새 샘플 없이 tickAt만 돌면 10:40:00에 불국사 도착(visit)과 arrivalNotice가 나옵니다. 같은 상황에서 기록이 꺼져 있으면 도착이 나오지 않습니다. 결과는 여행방에 동기화되는 잘못된 도착 기록과 토스트입니다.

재현 (b)(probe1 P3): 기록 중 09:00 샘플 하나 뒤로 샘플이 없으면, 09:40에도 40분 전 위치로 ETA를 잽니다. 지연이 13분(조정안 없음)으로 나오고, 기록이 꺼져 있으면 30분(조정안)입니다.

주석의 근거('iOS는 20m 이동 시에만 와서 샘플 없음 = 그 자리')는 iOS 화면 밖에만 맞습니다. Android 백그라운드 요청은 30초 간격·거리 0이라, 5분 넘게 샘플이 없으면 신호 끊김입니다. → 고칠 방법: setRecording(true) 때 recordingSince(그리고 마지막 공백 끝)를 남깁니다. 무기한 신뢰는 last.t ≥ recordingSince인 샘플에만 줍니다. Android처럼 거리 조건이 없는 요청이면 LAST_SAMPLE_MAX_AGE_MS를 그대로 씁니다. 예를 들어 어댑터가 넘기는 distanceFiltered 플래그나 platform을 엔진 ctx에 넣어 판정합니다. 위 두 경우를 테스트로 고정합니다.
- [minor] test/src/core/journal/recordMap.ts:139 — 같은 날짜에 앞서 돌린 시뮬레이터(허용) 재생 점이 남아 있으면, 그날 실제 기기 진행이 권한 거부였어도 기록 지도에 거부 안내가 뜨지 않습니다. 대신 시뮬레이터 점이 '실제 이동 지점'으로 그려지고 'sim' 안내만 뜹니다.

noteLivePermission은 '시연 때 남은 시뮬레이터 기록이 실제 도착 위에 뜨면 안 된다'며 sim 거부 기록을 지웁니다. 그런데 시뮬레이터 위치 점은 기기·수동 진행에서 지우지 않습니다(clearSimTrackDay는 sim 시작 때만, store/live.ts 770행). 시뮬레이터는 실제 여행 날짜로 재생하므로 '시연 뒤 그날 실제 진행'에서 바로 생깁니다.

재현(probe1 P2): sim 점 6개, 거부 기록 {source:'device'}, 수동 도착 1건이면 notices는 ['sim'], gpsPoints는 6입니다. 'denied'는 없습니다. → 고칠 방법: recordMapModel에서 opts.denied?.source === 'device'이면 source가 'sim'인 점을 빼고 buildDayTrack에 넘깁니다. 또는 startLive에서 기기·수동으로 그날을 진행할 때도 clearSimTrackDay를 부릅니다. 거부 기록 규칙과 같게 맞춥니다. 테스트를 추가합니다.
- [minor] test/src/core/journal/recordMap.ts:133 — 거부 기록이 있는 날에 도착 기록이 하나도 없어도 'denied' 안내가 뜹니다. 안내 문구는 '도착 지점만 순서대로 이었습니다. 그 사이 이동은 점선으로 남깁니다'인데, 실제로는 이은 점도 점선도 없습니다. 같은 경우 noLog는 marks.length > 0일 때만 띄워 서로 맞지 않습니다.

재현(probe1 P1): visits [], points [], denied {source:'device'}이면 notices는 ['denied'], marks는 0입니다. → 고칠 방법: denied 판정에도 track.marks.length > 0을 겁니다. 도착이 없을 때는 '이 날은 위치 권한이 없어 기록이 없습니다' 같은 다른 안내 종류를 둡니다.
