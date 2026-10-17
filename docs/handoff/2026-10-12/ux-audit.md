# 앱 전체 UX 점검 결과 (2026-10-11, 읽기 전용 에이전트 7개)

워크플로 `wf_e2c1f6d8-466`의 UX 점검 결과를 그대로 옮겼다. 이 결과를 합친 재배치 계획(ux:plan)은 사용량 한도로 실패해서 아직 없다.
다음 세션은 이 파일을 입력으로 계획 → 검토 → 구현을 다시 돌린다(점검은 다시 돌리지 않는다).

## 홈·여행방 (HomeScreen, CreateTripScreen, TripSettingsScreen, MembersScreen, src/features/trip/**, src/features/account/home.ts)

**주요 흐름**
- 1. 이어서 하기: 앱을 열고 지금이나 다음 여행을 찾아 다음 할 일(후보 모으기, 루트 계산, 시간표 확인)로 바로 들어간다
- 2. 여행 중: 진행중인 여행에서 오늘 여행 진행(LiveTrip)이나 길찾기를 바로 연다
- 3. 여러 여행방 사이를 오간다(진행중, 예정, 완료). 하단 탭(후보, 시간표, 지도)이 따라갈 '지금 여행방'을 고른다
- 4. 새 여행방 만들기: 지역과 날짜를 고르고, 이름(자동 제안)과 이동수단을 정하고, 숙소(기점)와 활동시간은 필요할 때만 정한다. 그다음 친구 초대(2 / 2 단계)
- 5. 친구 초대: 링크 만들기, 공유나 복사, 만료와 남은 자리 확인, 새 링크 만들기
- 6. 초대 코드를 받아 다른 여행방에 합류한다(이미 세션이 있는 사용자)
- 7. 여행방 고치기: 이름, 지역, 날짜, 주 이동수단, 날짜별 기점(숙소), 복귀 없음, 날짜별 활동시간
- 8. 멤버 관리와 정리: 초대 권한, 내보내기, 그룹원 나가기, 방장 삭제
- 9. 혼자 여행(개인 모드): 채팅 없이 계획하고 설정을 고친다

### [high/S] 여행방 설정 진입점(홈, 멤버, 채팅)
- 문제: 여행방 설정 화면(이름, 지역, 날짜, 이동수단, 날짜별 기점(숙소), 활동시간, 삭제와 나가기)으로 가는 길이 채팅 화면 오른쪽 위 점 메뉴의 '여행방 설정'(ChatScreen.tsx:211-221)과 프로필 탭 시연 도구의 화면 목록, 이 둘뿐이다. 홈, 멤버, 시간표 어디에서도 열 수 없다. 혼자 여행(개인 모드)에서는 홈의 '그룹 채팅' 칸이 비활성이라 실제로 설정에 들어갈 수 없다. 그래서 숙소(FR-205)를 정하거나 날짜를 고치거나 방을 지울 수 없다. 그룹원도 '나가기'를 찾으려면 채팅 메뉴를 열어야 한다.
- 제안: (a) 홈의 여행방 바로가기 줄(아래 빠른 메뉴 항목 참고)에 '여행방 설정' 칸을 넣는다. homeMenu에 key 'settings', icon 'gear'를 추가하고 개인과 그룹 모드 모두 활성으로 둔다. openMenu에 case 'settings'를 넣는다: setCurrentTrip 뒤 navigation.navigate('TripSettings', { tripId: current.id }). (b) MembersScreen Header의 right 자리에 IconBtn icon='gear' label='여행방 설정'을 둔다. 멤버 화면과 설정 화면이 서로 오갈 수 있다(설정에는 이미 멤버로 가는 줄이 있다). 채팅 메뉴의 진입점은 그대로 둔다.
- 파일: test/src/features/account/home.ts, test/src/screens/HomeScreen.tsx, test/src/screens/MembersScreen.tsx
- 테스트 영향: tests/wp1-home.test.ts의 '목업 03 순서의 6칸이다' 기대 key 목록과 '여행방이 없으면 만들기만 열린다'를 새 메뉴 구성에 맞게 고친다(빠른 메뉴 항목과 함께 고침). HomeMenuKey와 HomeMenuIcon 유니온에 'settings'와 'gear'를 더한다. MembersScreen을 고정하는 소스 규칙 테스트는 없다.

### [high/M] 홈 · 여행 표지 카드
- 문제: 표지 카드를 누르면 '선택'(잉크 2px 테두리)만 되고 아무 화면도 열리지 않는다. 그런데 CoverTile의 접근성 이름은 '{제목} 열기'라 스크린리더 사용자는 잘못된 안내를 듣는다. 여행에 실제로 들어가는 길은 카드 아래 작은 '시간표 보기' 글자 링크 하나다. 높이는 약 18px이고 hitSlop이 없어 44pt에 못 미친다. 이 링크는 후보가 0곳이거나 루트 계산 전이어도 늘 빈 시간표로 보낸다. 카드 문구는 '후보 없음 · 채팅이나 검색으로 모아 주세요'라고 하지만 그리로 가는 버튼이 없다. 진행중인 여행에서 가장 필요한 '여행 진행'(LiveTrip)은 홈에 없고 지도 탭과 프로필 탭에만 있다.
- 제안: features/account/home.ts에 순수 함수 tripNextStep(trip, plan, now)를 둔다. 반환값은 { label, target }이고 규칙은 다음과 같다. 완료면 '기록 보기'(RecordMap). 진행중이면 '오늘 여행 진행'(LiveTrip { tripId, date: 오늘 }). 후보가 0곳이면 '후보 모으기'(Candidates 탭). plan이 없으면 '루트 계산하기'(Planning). 그 밖에는 '시간표 보기'(Schedule). TripCard footer에서는 AvatarStack 줄 아래 '시간표 보기' 글자 링크를 Btn size='sm' variant='ghost'(카드 폭 272)로 바꾸고 그 라벨을 쓴다. 누르면 setCurrentTrip 뒤 target으로 간다. 표지 누르기는 지금처럼 '고르기'로 두되 CoverTile에 a11yLabel prop을 열어 '{제목} 고르기'와 selected 상태로 읽히게 한다.
- 파일: test/src/features/account/home.ts, test/src/screens/HomeScreen.tsx, test/src/ui/Discover.tsx
- 테스트 영향: 기존 테스트는 깨지지 않는다. tests/wp1-home.test.ts에 tripNextStep 5가지 경우(완료, 진행중, 후보 0, 계획 없음, 계획 있음) 순수 테스트를 더한다. src/ui/Discover.tsx는 FOUNDATION 소유이고 선택 prop 하나만 더한다.

### [high/M] 홈 · 빠른 메뉴
- 문제: 빠른 메뉴 6칸 중 4칸이 다른 곳과 겹친다. 후보와 지도는 하단 탭에 있고, '여행방 만들기'는 '내 여행' 옆 꺾쇠, 빈 화면 버튼, 추천 타일에도 있고, '멤버 초대'는 머리말 users 아이콘과 같다. 칸이 어느 여행방에 대해 동작하는지 화면에 적혀 있지 않다(useUi.currentTripId). 세그먼트를 '완료'로 바꿔도 이전 진행중 방에 대해 동작한다. 개인 모드에서 '그룹 채팅'은 회색 원으로만 남고 이유가 보이지 않는다. homeMenu는 reason과 sub를 만들지만 MenuGrid가 QuickAction에 넘기지 않는다. 리디자인(b6244d9)에서 빠진 것으로, 화면 주석과 wp1-home 테스트의 의도('이유를 적는다')와 어긋난다. 여행방이 0개면 회색 원 5개가 늘어선다. 390×844에서는 카드(높이 약 360px) 뒤에 오는 메뉴 둘째 줄이 첫 화면 밖으로 밀린다.
- 제안: '빠른 메뉴'를 '{선택한 여행방 제목}' 구역으로 바꿔 카드 줄 바로 아래에 둔다. 한 줄 4칸 QuickAction으로 그룹 채팅, 멤버 초대, 길찾기, 여행방 설정을 둔다. 360px에서 한 칸은 (312-24)/4=72px이고 가장 긴 라벨 '멤버 초대'(약 60px)가 들어간다. 후보, 지도, 만들기 칸은 뺀다(탭과 머리말이 맡는다). 채팅이 비활성이면 줄 아래에 Txt v='mtTight' 한 줄로 cell.reason을 적고 옆에 '멤버 초대' 글자 버튼을 둔다(DS: 지금 상태는 짧은 한 줄 허용). 여행방이 없으면 구역 전체를 숨긴다.
- 파일: test/src/features/account/home.ts, test/src/screens/HomeScreen.tsx
- 테스트 영향: tests/wp1-home.test.ts의 describe '메뉴 6칸'을 고친다. '목업 03 순서의 6칸이다'는 새 4칸 순서 ['chat','members','navigate','settings']로 바꾼다. '여행방이 없으면 만들기만 열린다'는 '여행방이 없으면 모든 칸이 비활성이고 이유가 있다'로 바꾼다. 개인 모드, 그룹 모드, 전원 나감, 길찾기 활성 테스트는 의도를 그대로 둔다. 화면 머리 주석과 docs/FR-추적표의 '메뉴 6칸' 표현도 맞춘다.

### [high/S] 멤버 초대(만들기 2 / 2 단계 포함)
- 문제: createTrip은 초대를 만들지 않는다(store/trips.ts:401-438). 그래서 만들기 직후 '2 / 2 단계'에 오면 '아직 초대 링크가 없습니다'와 작은 ghost 버튼 '초대 링크 만들기'만 있다. 이걸 누른 뒤 나타나는 '링크 공유하기'를 또 눌러야 해서 두 번 눌러야 한다. 단계 화면인데 '완료'나 '나중에' 버튼이 없어 뒤로 가기 말고는 끝낼 방법이 없다. 주 버튼 '링크 공유하기'는 카드 아래 화면 중간에 있어 엄지가 잘 닿지 않는다. 바로 밑에 시연용 '이 기기에서 다른 사람으로 합류해 보기(시연)'가 붙어 있어 실제 기능처럼 보인다. 360px에서 멤버 줄은 '전송 대기'와 '후보 N곳' 칩 두 개, 40px 메뉴 버튼 때문에 이름과 보조 줄 폭이 약 65px로 줄어 보조 줄이 두 줄로 잘린다. 멤버 메뉴 시트에는 '내보내기' 라벨과 '내보내기' 버튼이 나란히 있어 같은 말이 두 번 나온다.
- 제안: Foot을 더하고 주 버튼을 하나 둔다. 링크가 없거나 만료되었거나 무효면 '링크 만들고 공유하기'로 한 번에 처리한다. features/trip/actions.ts에 issueAndShare(tripId)를 두어 issueInvite 뒤 useTrips.getState().docs[tripId]로 새 trip을 읽어 shareInvite를 부른다. 링크가 있으면 '링크 공유하기'다. fromCreate면 그 아래 quiet 버튼 '나중에 초대하기'를 두고 navigation.reset으로 Main의 Candidates 탭(다음 할 일: 후보 모으기)으로 보낸다. 카드 안에는 링크 줄, 복사, 만료와 남은 자리, 새 링크 만들기만 남긴다. 시연 버튼은 멤버 목록 아래 eyebrow '시연' 밑으로 옮긴다. 멤버 줄에서는 '후보 N곳' 칩을 빼고 화면에서 보조 줄 뒤에 ' · 후보 N곳'을 붙인다. core의 sub 문자열은 바꾸지 않는다. 칩은 '전송 대기'만 남긴다. 멤버 메뉴 시트는 '초대 권한' 토글 줄과 전체 폭 quiet 버튼 '{이름}님 내보내기' 하나로 줄인다.
- 파일: test/src/screens/MembersScreen.tsx, test/src/features/trip/actions.ts
- 테스트 영향: 고정된 테스트는 없다. tests/wp2-invite.test.ts는 memberRows().sub('방장 · 이 기기', ' · 초대 가능$', '합류 전송 대기 · 연결되면 반영')만 보고, 그 문자열은 그대로 둔다. 원하면 issueAndShare를 가짜 share 서비스로 확인하는 wp2 테스트를 더한다.

### [medium/S] 홈 · 머리줄과 만들기 버튼
- 문제: 홈 맨 위에 제목이 없고 eyebrow '게스트 · 민지'만 있다. DS는 탭 첫 화면에 display 제목을 두라고 하고, 프로필 탭은 이미 hero 제목을 쓴다. 오른쪽 아이콘 두 개는 user(프로필 화면, 하단 '프로필' 탭과 겹침)와 users(지금 여행방 멤버)라 거의 같은 모양이어서 구분하기 어렵다. 가장 자주 쓰는 '여행방 만들기'는 '내 여행' 옆 32px 꺾쇠 원(SectionTitle onMore)으로만 보이고, 꺾쇠는 '더 보기'로 읽힌다. 글자 라벨은 스크린리더에만 있다.
- 제안: 머리줄 왼쪽에 eyebrow '게스트 · 민지'와 hero 제목 '내 여행'을 둔다. 오른쪽에는 보이는 글자가 있는 Btn size='sm' variant='ghost' icon='plus' '새 여행'을 두고 CreateTrip으로 보낸다. user와 users IconBtn은 지운다(프로필은 탭이, 멤버는 여행방 바로가기 줄이 맡는다). 아래 SectionTitle '내 여행'은 제목과 겹치므로 빼고, 순서를 머리줄, Seg, 카드 줄, 여행방 바로가기, 추천 여행지로 한다.
- 파일: test/src/screens/HomeScreen.tsx
- 테스트 영향: 없음. 디자인 규칙 테스트에 걸리는 값(hex, fontSize, 가운데 정렬)은 쓰지 않는다.

### [medium/S] 홈 · 초대 코드로 합류
- 문제: 공유가 안 되면 앱이 '초대 코드를 직접 알려 주세요'라고 안내하고, 초대 문구에도 '초대 코드 XXXX'가 들어 있다(features/trip/actions.ts). 그런데 이미 세션이 있는 사람은 코드를 칠 곳이 없다. 코드 입력 칸이 있는 초대 수락 화면(InviteAccept, 코드 없이 열면 입력 칸)은 온보딩과 프로필 탭 시연 도구의 화면 목록에서만 열린다. 그래서 두 번째 여행방에 초대받은 사람은 링크를 다시 받아야 한다.
- 제안: 홈에 진입점을 둔다. 여행방이 0개면 Empty('여행방 만들기') 아래에 quiet Btn '초대 코드로 합류'를 둔다. 여행방이 있으면 카드 줄 아래 구역 끝에 quiet Btn size='sm' icon='link' '초대 코드로 합류'를 둔다. 둘 다 navigation.navigate('InviteAccept')다. 새 백엔드는 필요 없다.
- 파일: test/src/screens/HomeScreen.tsx
- 테스트 영향: 없음.

### [medium/S] 여행방 만들기 · 칸 순서와 미리 채우기
- 문제: 첫 칸이 '여행방 이름'인데, 이름은 지역과 날짜로 자동 제안된다(suggestTitle). 먼저 이름을 치면 titleTouched가 켜져 제안이 멈추고, 비워 두면 빈 칸이 먼저 채워야 할 것처럼 보인다. '기점 · 선택'은 지역을 고르기 전에는 회색 비활성인데 이유가 없다. 필수 3개(지역, 날짜, 이름)와 선택 3개(기점, 이동수단, 활동시간)가 같은 무게로 나열된다. '주 이동수단' 라벨 줄 오른쪽에는 '대중교통' 글자가 홀로 남아 있다. a209dee에서 ScopeBadge를 지우며 남은 찌꺼기라 뜻이 없다. 홈 '추천 여행지'에서 '부산'을 눌러도 지역이 빈 폼이 열린다. HOME_PICKS의 id 6개는 모두 REGIONS id와 같다. 버튼 '다음 · 멤버 초대'는 누르면 방이 만들어진다는 걸 말하지 않는다.
- 제안: 순서를 지역, 날짜, 여행방 이름(제안값이 채워진 Field, 고칠 수 있음), 주 이동수단, eyebrow '선택' 아래 기점(숙소)과 하루 활동시간으로 바꾼다. 지역을 고른 뒤 날짜가 비어 있으면 날짜 시트를 바로 연다(RegionSheet onPick 뒤 setSheet('dates')). 기점 칸에는 지역을 고르기 전 help '지역을 고르면 찾을 수 있어요'를 단다. 남은 '대중교통' Txt와 빈 View를 지운다. 라우트를 CreateTrip: { regionId?: string } | undefined로 바꾸고, 추천 타일이 p.id를 넘겨 useState(regionId) 초깃값으로 쓴다. 버튼 라벨은 목업 04 '만들고 친구 초대하기'처럼 '만들고 멤버 초대하기'로 한다.
- 파일: test/src/screens/CreateTripScreen.tsx, test/src/screens/HomeScreen.tsx, test/src/navigation/routes.ts
- 테스트 영향: 고정된 테스트는 없다. routes.ts는 FOUNDATION 소유이고 파라미터 한 줄만 바뀐다. 파라미터가 선택이라 기존 navigate('CreateTrip') 호출(후보, 시간표, 지도 화면)은 그대로 컴파일된다. tsc로 확인한다.

### [medium/S] 여행방 만들기 · 중간에 나가기
- 문제: 지역, 날짜, 기점까지 고른 뒤 뒤로를 누르거나 안드로이드 뒤로 제스처를 하면 묻지 않고 입력이 전부 사라진다. 사용자가 이번에 커뮤니티 글쓰기에 요청한 '나가시겠습니까?' 문제가 여행방 만들기에도 똑같이 있다.
- 제안: navigation.addListener('beforeRemove')를 단다. 무엇이든 입력했고 아직 만들지 않았으면(made.current가 false) e.preventDefault() 뒤 ConfirmSheet를 띄운다. 제목은 '여행방 만들기를 그만할까요', 확인은 '그만 만들기', 취소는 '계속 만들기'다. 확인하면 navigation.dispatch(e.data.action)으로 나간다. navigation.replace('Members')도 beforeRemove를 부르므로 made.current가 true면 통과시킨다. 커뮤니티 글쓰기의 나가기 확인과 같은 문구 톤을 쓴다. 폼이 짧아 임시 저장은 하지 않는다.
- 파일: test/src/screens/CreateTripScreen.tsx
- 테스트 영향: 없음. 원하면 tests/wp2-trip.test.ts에 소스 규칙(beforeRemove와 made.current 통과)을 더한다.

### [medium/M] 여행방 설정 · 날짜별 기점
- 문제: 날짜마다 카드 하나에 기점 방식 3칸(Choice), 기점 칸, '복귀 없음' 켜짐과 꺼짐, '이날 활동시간' 제목과 칸까지 조작 5개가 늘 펼쳐져 있다. 2박 3일이면 약 900px, 14일이면 조작 70개가 이어지고, '멤버'와 '삭제 · 나가기'가 한참 아래로 밀린다. 대부분의 날은 '직전과 같음'과 기본 시간이라 볼 게 없다. 360px에서 카드 안 Choice 한 칸은 약 87px인데 '직전과 같음'(14px 5글자와 패딩, 약 94px)이 두 줄로 꺾인다. 활동시간 시트에서 '+ 30분'을 누를 때마다 trip/update나 trip/setDay op가 하나씩 쌓이고 동기화와 재계산 예약이 일어난다(TimeRange가 탭마다 onChange를 부른다).
- 제안: 날짜별 기점을 ListRow 목록으로 접는다. label은 '10월 17일 (금)', sub는 '라한셀렉트 경주 · 09:00 – 21:00', '직전과 같음 · 라한셀렉트 경주', '기점 없음 · 첫 스팟' 꼴이고, 복귀 없음이면 ' · 복귀 없음'을 붙인다. 오른쪽에는 그날만 바꾼 시간이 있을 때 '이날만' 칩을 둔다. 줄을 누르면 새 DaySheet(features/trip/components)에 지금 DayCard의 조작을 그대로 넣는다. 시트 폭이 312라 칸이 약 98px이 되어 꺾이지 않는다. TimeRange는 시트 안에서 초안을 들고 있다가 '완료'에서 onChange를 한 번만 부른다. 같은 값이면 부르지 않는 규칙은 유지한다.
- 파일: test/src/screens/TripSettingsScreen.tsx, test/src/features/trip/components/TimeRange.tsx, test/src/features/trip/components/DaySheet.tsx
- 테스트 영향: tests/wp2-trip-edit.test.ts의 소스 정규식은 방장 블록만 본다(`{host && !locked ? (<Col gap={SP.m}><PickerBox label="지역"`). 그 구조는 그대로 둔다. 새 파일은 ownership 글롭 src/features/trip/**가 이미 덮는다. TimeRange 변경은 여행방 만들기(로컬 상태)에도 해가 없다.

### [medium/S] 홈 · 상태 세그먼트
- 문제: 처음에는 진행중 칸(없으면 예정 칸)만 보여서, 예정 여행이 있어도 탭을 바꿔야 보인다. 탭을 '완료'로 바꿔도 currentTripId는 이전 방 그대로라 바로가기와 멤버 버튼이 화면에 보이지 않는 방에 대해 동작한다. 여행방이 1개뿐이어도 아이콘 탭 3칸(약 70px)이 첫 화면 자리를 차지한다.
- 제안: (a) home.ts에 순수 함수 visibleSegments(counts)를 두어 개수가 0보다 큰 칸만 고르고, 2칸 이상일 때만 Seg를 그린다. (b) 세그먼트를 바꾸면 그 목록의 첫 방을 setCurrentTrip한다. 이미 선택된 방이 그 목록에 있으면 그대로 둔다. 그러면 바로가기 구역과 보이는 카드가 늘 같은 방이다. FR-203의 예정, 진행중, 완료 구분은 유지한다.
- 파일: test/src/screens/HomeScreen.tsx, test/src/features/account/home.ts
- 테스트 영향: tests/wp1-home.test.ts의 homeSegments와 defaultSegment 테스트는 그대로 둔다. visibleSegments 순수 테스트를 더한다.

### [medium/S] 여행방 설정 · 이름 저장과 구성
- 문제: 지역, 날짜, 이동수단, 활동시간은 고르는 즉시 저장되는데, 이름만 글자를 바꾸면 나타나는 작은 '이름 저장' 버튼을 눌러야 저장된다. 이름을 고치고 뒤로 가면 아무 말 없이 버려진다. 머리말 eyebrow와 sub에 이름, 지역, 기간이 이미 있고 바로 아래 칸에 또 나와, 같은 값이 세 번 보인다. '멤버'와 '데이터 보존'은 eyebrow와 카드로 감싸져 있어 DS 규칙(설정 메뉴는 ListRow, 카드로 감싸지 않는다)과 다르다. 방장에게는 '방장은 나갈 수 없습니다' Notice가 늘 펼쳐져 있다.
- 제안: 이름은 Field onSubmitEditing과 뒤로 가기에서 저장한다. back() 안에서 바뀐 이름이 유효하면 trip/update 뒤 goBack한다. '이름 저장' 버튼은 지우거나 보조로만 남긴다. Header는 eyebrow 없이 title '여행방 설정'과 sub(지역 · 기간)만 둔다. '멤버 초대 · 관리'와 '보관 기한'은 ListRow 두 줄로 바꾼다(sub '멤버 4명', '2027년 10월 19일까지'). 방장 나가기 안내는 삭제 버튼 아래 mtTight 한 줄로 줄인다.
- 파일: test/src/screens/TripSettingsScreen.tsx
- 테스트 영향: tests/wp2-trip-edit.test.ts의 정규식이 계속 맞아야 한다: `{host && !locked ? (\s*<Col gap={SP.m}>\s*<PickerBox label="지역"`, patch region, startDate/endDate, transport, droppedDates와 basesToClear 확인 흐름, josa(datesBrief(dropped), '이/가'). 이 블록은 건드리지 않는다. onBlur 저장까지 원하면 src/ui/Field.tsx(FOUNDATION)에 onBlur prop이 필요하다.

### [low/S] 여행방 만들기와 설정 · 입력 칸 모양
- 문제: 같은 폼에서 '여행방 이름'(Field)은 라벨이 칸 안 위쪽에 있고 오류 때 앰버 2px 테두리가 된다. 반면 지역, 날짜, 기점(PickerBox)과 활동시간(TimeRange)은 라벨이 칸 밖 위에 있고, 오류 때 테두리는 그대로이고 아래 글자만 앰버다. 첫 칸과 나머지 칸이 다른 부품처럼 보이고, '다음'을 눌렀을 때 어느 칸이 비었는지 한눈에 보이지 않는다. 달력 칸의 접근성 이름이 '2026-10-17'이라 스크린리더로 듣기 어렵다.
- 제안: PickerBox를 DS TextField 모양으로 바꾼다. 56 상자 안 위쪽에 label(mtTight), 그 아래 값이나 placeholder를 두고, error면 surfaceC.amber 2px 테두리를 쓴다(Field와 같은 토큰). TimeRange에 label prop을 줘 같은 상자를 쓰게 하고, 화면에서 따로 그린 <Txt v="label">을 지운다. CalendarRange의 accessibilityLabel은 core/trip/create의 dateLong을 써서 '10월 17일 (토)' 꼴로 한다.
- 파일: test/src/features/trip/components/PickerBox.tsx, test/src/features/trip/components/TimeRange.tsx, test/src/features/trip/components/CalendarRange.tsx, test/src/screens/CreateTripScreen.tsx, test/src/screens/TripSettingsScreen.tsx
- 테스트 영향: PickerBox API가 그대로라 tests/wp2-trip-edit.test.ts의 `<PickerBox label="지역"` 정규식은 그대로 맞는다. 디자인 규칙: 토큰(surfaceC.amber, R.field, H.field)만 쓰고 hex와 fontSize는 쓰지 않는다.

## 채팅·후보 (ChatScreen, CandidatesScreen, SpotDetailScreen, RecommendScreen, src/features/chat/**, src/features/candidates/**)

**주요 흐름**
- 친구들과 채팅하며 가고 싶은 곳을 말하는 흐름: 말풍선 장소 강조와 추출 카드로 무엇이 담겼는지 확인하고, 잘못 잡았으면 되돌리고, 이름이 같은 장소는 하나를 고른다 (05)
- 채팅 중에 지금까지 후보가 몇 곳 모였고 몇 곳이 확정·제외됐는지 확인한 뒤 후보 탭으로 넘어가는 흐름 (05에서 06으로)
- 후보 탭에서 확정 스팟과 제외 스팟을 사유와 함께 훑어보고, 빠진 곳을 고정해서 다시 넣고, 수용량 초과를 해결하는 흐름(그날 일정 편집으로 감) (06)
- 채팅에서 인식되지 않은 곳을 검색하거나 지도에서 골라 직접 담는 흐름. 목적지 밖이면 확인하고, 같은 이름이 여러 곳이면 시트에서 고른다 (06 ManualAdd, 24)
- 성향 태그로 추천을 받아 이유를 보고 후보에 담는 흐름 (23)
- 스팟 상세에서 체류 시간, 기점에서 걸리는 시간, 배치 시각, 제안자, 채팅 원문을 보고 고정·체류 변경·날짜 지정·빼기·지우기·길찾기를 하는 흐름 (07)
- 시연용 흐름: 보내는 사람 바꾸기, 시나리오 대화 재생, 채팅 메뉴에서 여행방 설정 열기

### [high/S] 05 채팅 (ChatScreen)
- 문제: 채팅으로 후보를 모으는 것이 이 화면의 목적인데, 그 결과가 화면에 보이지 않습니다. '후보 보기'는 점 세 개 메뉴 시트의 맨 아래, 시연 버튼 두 개 밑에 quiet 버튼으로 있습니다. 채팅은 탭바가 없는 스택 화면이라 후보를 보려면 메뉴를 열어 세 번 누르거나, 뒤로 가서 홈을 거쳐 후보 탭으로 가야 합니다. 장소를 말할수록 후보가 몇 곳 모였고 몇 곳이 빠졌는지 알 방법이 없습니다. 목업 05에는 입력줄 위에 '후보 14곳이 모였어요 · 확정 11 · 제외 3' 줄이 있었습니다.
- 제안: 입력줄 바로 위(오프라인 Notice와 같은 하단 묶음, 엄지가 닿는 자리)에 누를 수 있는 한 줄 요약을 둡니다. 구성은 list 아이콘, '후보 14곳 · 확정 11 · 제외 3', 오른쪽 right 아이콘입니다. 누르면 useUi.setCurrentTrip(tripId)를 부르고 navigate('Main', { screen: 'Candidates' })로 갑니다. 숫자는 candidateView(trip, usePlan(tripId))로 계산합니다. 계산 전이면 '후보 N곳 · 배치 계산 전', 후보가 0곳이면 줄을 숨깁니다. 메뉴 시트의 '후보 보기' Btn은 지웁니다. 새 컴포넌트는 src/features/chat/components/CandidateBar.tsx(WP3 글롭 안)에 두고, 요약 문구는 rows.ts의 순수 함수로 둡니다.
- 파일: test/src/screens/ChatScreen.tsx, test/src/features/chat/components/CandidateBar.tsx (new), test/src/features/candidates/rows.ts
- 테스트 영향: 이 화면 배치를 고정하는 테스트는 없습니다. wp6-community.test.ts의 '채팅 메뉴 → 여행방 설정' 정규식은 건드리지 않습니다. 요약 문구 함수(예: summaryLine(view))에 대한 단언은 tests/wp3-candidates.test.ts에 추가합니다.

### [high/M] 05 채팅 입력줄 (ChatScreen + ui Field)
- 문제: (a) 앱 전체에 KeyboardAvoidingView가 없어서 iOS 앱에서는 입력칸을 누르면 키보드가 입력줄과 보내기 버튼을 덮습니다. (b) 채팅이 Field에 onSubmitEditing을 넘기지 않아서 키보드의 엔터나 보내기 키로 보낼 수 없고, 매번 오른쪽 44px 버튼을 눌러야 합니다. (c) 입력줄 아래 여백이 SP.section 고정값이고 안전 영역(홈 인디케이터)을 더하지 않습니다. Screen은 edges=['top']만 처리합니다. (d) onContentSizeChange가 올 때마다 무조건 scrollToEnd를 해서, 위로 올려 예전 대화를 읽는 중에 새 메시지나 추출 카드가 오면 맨 아래로 튑니다. (e) placeholder '메시지 입력'은 이 화면의 핵심인 '장소를 말하면 후보가 된다'를 알려 주지 않습니다.
- 제안: Screen 안 본문(대화 ScrollView와 입력줄)을 KeyboardAvoidingView로 감쌉니다. iOS는 behavior='padding'입니다. Field에 선택 prop(예: keepFocusOnSubmit)을 추가해 blurOnSubmit={false}, submitBehavior='submit', returnKeyType='send'로 연결하고, 채팅에서는 onSubmitEditing={send}를 넘깁니다. RNW 0.21 TextInput은 이미 한글 조합 중(isComposing)의 엔터를 거릅니다. 입력줄 묶음의 paddingBottom에는 useSafeAreaInsets().bottom을 더합니다. onScroll에서 '바닥에서 80px 안' 여부를 기억해 두고, 그 상태이거나 내가 방금 보냈을 때만 scrollToEnd를 합니다. placeholder는 예시 문장으로 바꿉니다(예: '가고 싶은 곳을 말해 보세요').
- 파일: test/src/screens/ChatScreen.tsx, test/src/ui/Field.tsx (FOUNDATION 소유)
- 테스트 영향: 고정하는 테스트는 없습니다. foundation-design-rules는 TextInput 직접 사용을 금지하므로 반드시 Field를 확장해서 처리합니다. Field가 FOUNDATION 소유라 gate-scope WP1~WP6을 모두 다시 확인해야 합니다.

### [high/M] 07 스팟 상세 버튼 배치 (SpotDetailScreen)
- 문제: 버튼이 7개입니다(헤더 고정 아이콘, 여기까지 길찾기, 날짜 지정, 직접 빼기, 후보에서 지우기, Foot의 고정하기, Foot의 체류 시간 바꾸기). '고정'은 헤더 아이콘, Foot 버튼, 칩으로 세 번 나옵니다. 제외 스팟일 때 헤더 고정 아이콘은 숨기지만 Foot의 '고정하기'와 '체류 시간 바꾸기'는 그대로 보입니다. 사용자가 직접 뺀 후보에서 '고정하기'를 누르면 spot/pin이 pinned만 켜고 removedByUser는 그대로라서, 라벨은 '고정 풀기'로 바뀌는데 후보는 제외 스팟에 남습니다. 실제로 되돌리는 버튼은 본문 중간 제외 카드 안의 sm 버튼입니다. 배치된 스팟에서 그날 시간표로 가는 길도 없습니다(목업 11의 '일정에서 보기').
- 제안: 헤더 오른쪽의 고정 IconBtn을 지웁니다. Foot은 상태에 따라 나눕니다. 확정·배치 전 상태에서는 왼쪽에 quiet '시간표에서 보기'(배치됐을 때만, navigate('Main', { screen: 'Schedule', params: { date } })), 오른쪽에 고정 안 됨이면 primary '고정하기', 고정됨이면 quiet '고정 풀기'를 둡니다. 제외 상태에서는 primary '고정해서 다시 넣기'(spot/restore) 하나만 두고, 본문 제외 카드에는 사유만 남깁니다. '직접 빼기'와 '후보에서 지우기'는 본문 맨 아래 '관리' 묶음의 ListRow 두 줄로 내립니다. sub는 각각 '제외 스팟으로 옮겨요 · 되돌릴 수 있어요', '되돌릴 수 없어요'로 해서 되돌릴 수 있는 것과 없는 것을 구분합니다. 지운 뒤 goBack 전에 토스트 'X를 후보에서 지웠습니다'를 띄웁니다.
- 파일: test/src/screens/SpotDetailScreen.tsx, test/src/features/candidates/detail.ts
- 테스트 영향: 이 화면에 걸린 테스트는 wp5-my-location.test.ts의 'MapCanvas에 locate 없음'뿐이라 영향이 없습니다. 상태별 Foot 동작(제외 상태면 pin 대신 restore)을 detail.ts의 순수 함수로 빼고, tests/wp3-spot-detail.test.ts를 새로 만들어 고정하기를 권합니다.

### [high/S] 06 후보 탭 상단 (CandidatesScreen)
- 문제: '장소 직접 담기'와 '성향 태그로 추천 받기'가 확정, 배치 전, 제외 목록을 모두 지난 맨 끝에 있습니다. 시나리오(후보 14곳)라면 카드 14장 아래라 스크롤해야 보이고, 펼친 수동 담기 패널도 목록 끝에서 열립니다. 후보가 있을 때는 채팅으로 가는 길이 없고(빈 화면의 '채팅 열기'뿐), 머리말에 어느 여행방의 후보인지도 없습니다. 시간표 탭은 eyebrow에 여행방 이름을 보여 줍니다. 머리말 right에는 빈 <Row>만 남아 있고 sample 변수도 쓰지 않습니다(예시 데이터 칩을 지운 흔적). 계산 중 표시도 Notice라서 시간표 탭의 Chip '다시 계산하는 중' + '단계 보기'와 모양이 다릅니다.
- 제안: Header에 eyebrow={trip.title}을 넣고, right에는 IconBtn 'chat'(채팅 열기, navigate('Chat', { tripId }))을 둡니다. 목록 맨 위(Seg 또는 구역 머리 바로 아래)에 검색창 모양의 Pressable(search 아이콘, '장소 검색해서 담기')을 두고, 누르면 그 자리에서 ManualAdd가 펼쳐집니다. ManualAdd는 안에 시트가 있어서 시트로 감싸지 않고 그대로 펼칩니다. 바로 아래에 ListRow(compass 아이콘, '성향 태그로 추천 받기')를 둡니다. 빈 right Row와 sample은 지웁니다. 계산 중 표시는 시간표 탭과 같은 Chip과 '단계 보기'(Planning)로 맞춥니다.
- 파일: test/src/screens/CandidatesScreen.tsx
- 테스트 영향: 없습니다. 이 화면을 고정하는 소스 규칙 테스트가 없습니다.

### [medium/M] 06 후보 탭 목록 구조 (CandidatesScreen)
- 문제: Seg 두 탭이 같은 내용을 두 번 보여 줍니다. '확정 스팟' 탭에는 확정, 배치 전, 제외 목록이 모두 나옵니다(제외는 조용한 제외 금지 규칙 때문입니다). '제외 스팟' 탭은 그 안의 제외 목록만 다시 보여 줍니다. 그래서 탭 이름 '확정 스팟'과 실제 내용이 맞지 않습니다. 또 확정 11곳이 위에 전부 펼쳐져 있어서, 사용자가 손봐야 할 빠진 곳과 되돌리기 버튼이 첫 화면 밖에 있습니다.
- 제안: Seg를 없애고 하나의 목록을 구역 머리(eyebrow + 개수)로 나눕니다. 순서는 '확정 스팟 11', '배치 계산 전 N'(있을 때만), '제외 스팟 3 · 되돌릴 수 있음'입니다. 확정 구역은 앞 5곳만 보이고, quiet 버튼 '나머지 6곳 보기'로 펼칩니다(목업 06의 '나머지 8곳 보기'와 같은 방식). 제외 구역은 절대 접지 않습니다(조용한 제외 없음 유지). 머리말 sub는 지금 headline을 그대로 씁니다.
- 파일: test/src/screens/CandidatesScreen.tsx, test/src/features/candidates/rows.ts
- 테스트 영향: wp3-candidates의 '06 행 계산'은 candidateView 결과만 보므로 그대로 통과합니다. qa-selection.test.ts의 '조용한 제외 없음'은 로직 테스트라 영향이 없습니다. 접힘 개수와 '확정 구역에만 적용'을 rows.ts의 순수 함수로 두고 tests/wp3-candidates.test.ts에 단언을 추가합니다.

### [medium/S] 23 여행지 추천 (RecommendScreen)
- 문제: 추천 카드에 이유가 없습니다. 제공자는 items[].reason('역사 성향과 맞아요 · 후보들과 가까워요', '많이 찾는 곳이에요')을 주고 화면 주석도 '곳마다 추천 이유 한 줄'이라고 하지만, 화면은 ({ place })만 꺼내고 reason을 버립니다. 사용자는 왜 이곳인지 모른 채 담게 되고, '대체됨' 칩이 그 일부만 대신합니다. 태그를 바꾸는 동안에는 '추천을 고르는 중입니다' 글자 아래에 예전 결과와 담기 버튼이 그대로 남아 있어 헷갈립니다. 머리말 right의 빈 Row와 쓰지 않는 sample 변수도 남아 있습니다.
- 제안: 카드를 세 줄로 합니다. 이름(nm), 종류·주소(mtTight), 이유 한 줄(mt)입니다. '후보에 담기'와 '후보에 담김'은 이름 줄 오른쪽 trailing으로 옮겨 카드 높이를 줄입니다. 360px에서 이름 칸이 좁으면 지금처럼 아래 줄에 둡니다. 이유 줄이 '많이 찾는 곳이에요'를 말해 주므로 '대체됨' 칩은 지우고, 위쪽의 Notice '인기 장소로 대체됨'은 남깁니다. busy일 때는 Notice(clock 아이콘)를 목록 위에 두고, 이전 결과의 담기 버튼을 잠그거나 목록을 숨깁니다. 빈 right Row와 sample은 지웁니다.
- 파일: test/src/screens/RecommendScreen.tsx
- 테스트 영향: 없습니다. wp3-recommend.test.ts는 pickRecommendations, recommendReason, 제공자 로직만 봅니다.

### [medium/S] 06 제외 카드 되돌리기 (CandidatesScreen, SpotDetailScreen)
- 문제: 제외 카드의 '되돌리기'는 13px 글자에 hitSlop 8뿐이라 누를 수 있는 영역이 약 30px입니다(권장 44px). 실제 동작은 spot/restore로 고정을 켜서 다시 넣는 것인데 이름이 그 동작을 말해 주지 않습니다. 누른 뒤 토스트도 없어서, 카드가 사라지면 어디로 갔는지(배치 계산 전에서 확정으로) 모릅니다. 고정이 늘면 수용량 초과 WarnCard가 새로 생길 수 있다는 것도 알 수 없습니다.
- 제안: 카드 아래 줄에 Btn(size sm, variant ghost, icon undo) '고정해서 다시 넣기'를 둡니다. 목업 06은 '넣기'라고 썼습니다. 누르면 토스트 'X를 고정해서 다시 넣었습니다'를 띄웁니다. 상세 화면 상태 보기는 이름 영역을 누르는 지금 방식 그대로 둡니다. 스팟 상세의 제외 상태 버튼(앞의 스팟 상세 버튼 배치 항목)과 같은 이름을 씁니다.
- 파일: test/src/screens/CandidatesScreen.tsx, test/src/screens/SpotDetailScreen.tsx
- 테스트 영향: 없습니다. 용어 테스트('확정 장소', '제외 장소', '투표', '출발지' 금지)도 통과합니다.

### [medium/M] 07 스팟 상세 정보 칸 (SpotDetailScreen)
- 문제: 정보 칸 3개를 flex:1 카드로 나란히 둬서 360px에서 칸 안쪽 너비가 약 74px입니다. '자동차 25분'(16px semibold로 약 86px)이 두 줄로 넘어가 칸 높이가 들쭉날쭉해집니다. 값(체류 90분)과 그 값을 바꾸는 버튼(Foot의 '체류 시간 바꾸기', 본문의 '날짜 지정')이 떨어져 있어서 무엇을 바꾸는지 연결이 약합니다. '체류를 N분으로 늘리면 X가 제외 스팟이 됩니다' 예고 카드는 체류를 바꿀 때만 필요한데 본문에 늘 떠 있습니다.
- 제안: 칸 Row를 구분선 있는 키-값 목록으로 바꿉니다. ListRow 모양으로 라벨은 왼쪽(muted), 값은 오른쪽(nm)에 둡니다. 행은 '체류 90분'(누르면 체류 시트), '날짜 자동 배분' 또는 '10/18 (토) 지정'(누르면 날짜 시트), '기점에서 자동차 25분', '배치 시각 09:25'입니다. 마지막 두 줄은 읽기 전용이라 right 아이콘을 달지 않습니다. 고정·날짜 칩 줄은 이 행 값으로 흡수합니다. 체류 예고 문장은 체류 시트 안, 옵션 아래 Notice로 옮깁니다.
- 파일: test/src/screens/SpotDetailScreen.tsx, test/src/features/candidates/detail.ts
- 테스트 영향: detail.ts를 고정하는 테스트가 없습니다. wp5-map의 dayOrdinal은 다른 모듈입니다. cells에 날짜 칸과 '편집 가능' 여부를 추가하면 tests/wp3-spot-detail.test.ts에 단언을 추가합니다.

### [medium/M] 05 추출 카드 (ExtractionCardView)
- 문제: 같은 이름의 장소가 나오면 카드에 '황남빵'과 [고르기]만 있어서 무엇을 골라야 하는지 모르고, 고르기, 시트, 장소 누르기로 모달을 두 번 거쳐야 합니다. 목업 05는 카드 안에 '대릉원이 두 곳이에요. 어디일까요?'와 선택지 두 줄을 바로 보여 줬습니다. 카드 제목 '대화에서 장소 N곳을 찾았습니다'는 아직 고르지 않은 것까지 셉니다. 행마다 칩이 두 개('제안자 1'과 '후보 추가됨')라 360px에서 이름 칸이 약 120px로 좁아집니다. 행을 누르면 상세로 가는데 화살표가 없어서 누를 수 있는지 보이지 않습니다. '되돌리기'는 12px muted 글자이고 누를 수 있는 영역이 작습니다.
- 제안: picks는 먼저 한 줄로 안내합니다('‘황남빵’이 2곳이에요'). 선택지가 3곳 이하이면 카드 안에 이름·주소 행으로 보여 주고 바로 고르게 합니다. 이미 후보인 곳에는 '이미 후보' 칩을 달고, '해당 없음' 링크를 둡니다. 4곳 이상일 때만 PlacePickSheet를 엽니다. 이때 pickOptions(region 필터)를 재사용합니다. 행 칩은 하나로 줄입니다(새 후보는 '새 후보', 병합은 '제안 +1', 고정은 '고정'). 각 행 오른쪽에 right 아이콘을 답니다. 제목은 rows만 세서 '후보 N곳에 담았어요'로 하고, picks는 별도 줄로 둡니다. 되돌리기는 undo 아이콘과 글자로 바꾸고 높이를 36 이상으로 합니다.
- 파일: test/src/features/chat/components/ExtractionCardView.tsx, test/src/features/chat/view.ts, test/src/screens/ChatScreen.tsx
- 테스트 영향: wp3-candidates.test.ts는 card.picks.length, canUndo, 카드 없음(undefined)만 단언하므로 그대로 유지됩니다. 제목·칩 문구와 '3곳 이하는 카드 안에서 고른다' 판정을 view.ts에서 바꾸면 같은 파일에 새 단언을 추가합니다.

### [medium/S] 05 말풍선 접근성 (Bubble)
- 문제: Bubble은 줄바꿈 때문에 어절마다 <Txt>를 따로 그리고, 장소 조각은 accessibilityLabel '장소 X'를 단 별도 View입니다. 그래서 스크린리더가 메시지 하나를 어절 단위로 끊어 읽고, 보낸 사람이나 시각과도 묶어 주지 않습니다.
- 제안: 메시지 한 줄(아바타, 이름, 말풍선, 시각, 전송 대기 칩)을 accessible View 하나로 묶습니다. accessibilityLabel은 '민지, 둘째 날 불국사 가자, 장소 불국사, 14:02, 전송 대기' 형태로 만듭니다. 장소 조각 View에 달린 개별 라벨은 지웁니다. 라벨 문자열은 view.ts의 순수 함수(messageA11yLabel)로 만듭니다.
- 파일: test/src/features/chat/components/Bubble.tsx, test/src/features/chat/view.ts, test/src/screens/ChatScreen.tsx
- 테스트 영향: 기존 테스트에는 영향이 없습니다. messageA11yLabel 단언을 tests/wp3-candidates.test.ts의 '05 말풍선' 테스트 옆에 추가합니다.

### [low/S] 05 채팅 메뉴 시트 (ChatScreen)
- 문제: 점 세 개 메뉴 시트에 실제 기능(여행방 설정)과 시연 도구(보내는 사람 바꾸기, 시나리오 재생 두 개)가 섞여 있습니다. 모두 Btn을 쌓아 둔 형태라 위계가 없습니다. 채팅에서 멤버·초대 화면으로 가는 길은 개인 모드 카드에만 있습니다.
- 제안: DS 규칙('설정 메뉴는 ListRow')에 따라 시트를 ListRow 목록으로 바꿉니다. 'gear 여행방 설정'과 'users 멤버·초대'(Members)를 먼저 둡니다. 그 아래 label '시연' 구역에 보내는 사람 Btn 줄과 시나리오 재생 두 줄을 둡니다. '후보 보기'는 맨 앞의 채팅 후보 요약 항목에 따라 시트에서 빠집니다.
- 파일: test/src/screens/ChatScreen.tsx
- 테스트 영향: tests/wp6-community.test.ts의 '연결: … 채팅 메뉴 → 여행방 설정' 테스트가 /title="여행방 설정"[\s\S]{0,200}navigation\.navigate\('TripSettings', \{ tripId \}\)/로 Btn의 title prop을 봅니다. ListRow는 label prop을 쓰므로 정규식을 label="여행방 설정"으로 고쳐야 합니다. '채팅 메뉴에서 여행방 설정으로 간다'는 의도는 유지하고, 테스트는 지우지 않습니다.

### [low/S] 05 채팅 시각·날짜 표시 (ChatScreen)
- 문제: 시각은 마지막 메시지와 전송 대기 메시지에만 있고 날짜는 아예 없습니다. 여행 전에 며칠에 걸쳐 나눈 대화에서 언제 한 말인지 알 수 없습니다. 같은 사람이 연달아 보내도 아바타와 이름이 매번 반복되어 대화가 길어집니다.
- 제안: view.ts에 sentAt 기반 순수 함수 messageMeta(messages, me)를 둡니다. 먼저 KST 날짜(kstDate)가 바뀌는 곳에 날짜 구분 줄(dayLabel)을 넣습니다. 가운데 정렬 금지 규칙 때문에 textAlign을 쓰지 않고, 선, 글자, 선을 Row로 놓습니다. 다음으로 같은 사람이 같은 분에 연달아 보낸 메시지는 첫 줄에만 이름과 아바타를 보이고, 시각은 묶음 마지막 줄에만 둡니다. 전송 대기 메시지는 지금처럼 늘 시각을 보입니다.
- 파일: test/src/features/chat/view.ts, test/src/screens/ChatScreen.tsx
- 테스트 영향: 새 단언을 tests/wp3-chat-meta.test.ts에 둡니다(또는 wp3-candidates에 추가). sentAt만 쓰므로 Date.now()나 시계 주입이 필요 없습니다.

## 진입·계정 (Splash, Onboarding, Login, Signup, SocialConsent, InviteAccept, Profile, features/account)

**주요 흐름**
- 1. 처음 연 방장: 스플래시(진행 막대) → 온보딩에서 닉네임 입력 → '게스트로 시작하기' → 홈
- 2. 링크를 받은 친구: 딥링크 j/코드 → 초대 미리보기(여행 요약) → 이 방에서 쓸 이름 → '게스트로 합류하기' → 여행방 홈. 코드만 받은 경우: 온보딩 → '초대 코드로 합류' → 코드 입력 → 미리보기
- 3. 돌아온 계정 사용자(세션 만료, 로그아웃 후, 새 기기): 온보딩 → 로그인(이메일 또는 닉네임, 또는 카카오·구글) → 홈. 비밀번호를 잊으면 '계정찾기' 시트에서 재설정 메일 → 새 비밀번호
- 4. 게스트를 계정으로 바꾸기(여행방 유지): 프로필 탭 → 내 프로필 '이메일로 승격하기'(또는 로그인 화면 경고 확인 후 회원가입) → 회원가입(승격) → 모의 메일함에서 인증하기 → 홈
- 5. 새 계정 가입: 로그인 → 회원가입 → 인증 메일 받기 → 인증하기 → 자동 로그인
- 6. 소셜 로그인과 계정 연결: 카카오·구글 → (같은 이메일이면) '기존 계정에 연결할까요' 확인 → 로그인. 계정 사용자는 프로필에서 카카오·구글 연결
- 7. 프로필 다듬기: 프로필 탭 → 내 프로필 → 닉네임·사진·여행 성향 태그 → 저장
- 8. 계정 관리: 로그아웃(프로필 탭과 내 프로필 두 곳), 계정 탈퇴(확인 1회)

### [high/M] 공통 입력 화면(온보딩, 초대 수락, 로그인, 회원가입, 계정찾기 시트, 내 프로필)
- 문제: 폰(iOS 앱, 모바일 Safari)에서 입력하는 동안 키보드가 아래 고정 버튼(Foot)을 가립니다. 가려지는 버튼은 '게스트로 시작하기', '초대 확인', '게스트로 합류하기', 프로필 '저장'입니다. 앱 전체에 KeyboardAvoidingView와 keyboardShouldPersistTaps가 한 곳도 없습니다(src grep 0건). 온보딩 닉네임, 초대 코드, 초대 이름, 회원가입 칸에는 onSubmitEditing도 없어서 키보드의 완료/Enter로 다음 단계로 갈 수 없습니다. 그래서 키보드를 내리고 버튼을 다시 찾아 눌러야 합니다. 네이티브에서는 키보드가 열린 채 스크롤 안의 버튼(로그인, 가입)을 누르면 첫 탭은 키보드만 닫고 버튼은 눌리지 않습니다(기본값 'never'). 계정찾기 Sheet(Modal)도 아래쪽 입력 칸을 키보드가 덮을 수 있습니다.
- 제안: (1) src/ui/layout.tsx의 Screen 안쪽을 KeyboardAvoidingView로 감쌉니다(iOS는 behavior 'padding', 그 밖은 undefined). 이러면 Foot이 키보드 위로 올라옵니다. (2) Body의 ScrollView에 keyboardShouldPersistTaps="handled"와 keyboardDismissMode="on-drag"를 줍니다. (3) Sheet 패널도 KeyboardAvoidingView로 감쌉니다. (4) 각 화면 마지막 칸의 onSubmitEditing에 주 동작을 연결합니다. 온보딩 닉네임은 문제가 없을 때 createGuest, 초대 코드는 submitCode, 초대 이름은 join, 회원가입 닉네임은 canSubmit일 때 submit입니다. 앞 칸은 returnKeyType 'next'로 다음 칸에 포커스를 넘깁니다(Field에 returnKeyType와 inputRef 선택 prop 추가). 모바일 웹에서는 KeyboardAvoidingView가 아무 일도 하지 않으므로 Enter 제출이 실제 해결책입니다.
- 파일: test/src/ui/layout.tsx, test/src/ui/Sheet.tsx, test/src/ui/Field.tsx, test/src/screens/OnboardingScreen.tsx, test/src/screens/InviteAcceptScreen.tsx, test/src/screens/SignupScreen.tsx, test/src/screens/ProfileScreen.tsx
- 테스트 영향: 이 화면이나 layout/Sheet를 고정하는 소스 테스트는 없습니다. wp1-oauth의 '로그인 화면 순서' 테스트는 표시 문자열 순서만 보므로 영향이 없습니다. foundation-design-rules의 색과 글자 규칙만 지키면 됩니다. 새 규칙 테스트 tests/wp1-entry-keyboard.test.ts 추가를 권합니다(입력 화면 마지막 Field에 onSubmitEditing, Body에 keyboardShouldPersistTaps). src/ui는 FOUNDATION 소유입니다.

### [high/S] 온보딩(게스트로 시작), 초대 수락(세션 없이 게스트 합류)
- 문제: 게스트가 만들어지는 두 순간에 한계 안내가 전혀 없습니다. 이 기기에서만 쓸 수 있고, 30일 동안 안 쓰거나 기기를 바꾸면 복구할 수 없다는 내용입니다. 이 안내는 여러 곳에서 요구합니다. 명세 FR-105('토큰 분실 시 복구 불가 안내')와 본문('게스트의 한계는 명확히 안내한다'), 목업 02의 '게스트로 바로 참여합니다' 카드, 그리고 두 화면의 주석('게스트 한계는 시작/합류 버튼 앞에 보여준다')입니다. 그런데 10-10 리디자인 커밋 b6244d9('부가 설명 정리')에서 카드째 지워졌습니다. 사용자는 일정을 다 짜고 폰을 바꾼 뒤에야 알게 되어 데이터를 잃습니다.
- 제안: DS 원칙('설명 문장 없이, 경고와 지금 상태는 짧은 한 줄')에 맞춰 카드 대신 Field의 help 한 줄로 되살립니다. 온보딩 닉네임 help: '이 기기에서만 쓰는 게스트예요. 기기를 바꾸거나 30일 동안 안 쓰면 복구할 수 없어요.' 초대 수락의 '이 여행방에서 쓸 이름' Field에는 !session일 때만 같은 help를 붙입니다(계정이나 기존 게스트에게는 생략). 오류가 있으면 Field가 error를 대신 보여 주므로 두 줄이 겹치지 않습니다. 문구는 상수 하나로 두고 두 화면이 같이 씁니다(features/account/messages.ts 등).
- 파일: test/src/screens/OnboardingScreen.tsx, test/src/screens/InviteAcceptScreen.tsx, test/src/features/account/messages.ts
- 테스트 영향: 고정 테스트는 없습니다. 되돌아가지 않도록 wp1(온보딩)과 wp2(초대 수락, WP2 소유)에 소스 규칙 테스트를 한 줄씩 추가하기를 권합니다.

### [high/S] 내 프로필(17) 계정 구역
- 문제: 내 프로필의 '로그아웃'은 확인 없이 바로 signOutFlow를 부릅니다. 프로필 탭(MoreScreen)의 같은 '로그아웃'은 ConfirmSheet '로그아웃할까요'를 거치므로 같은 동작인데 방식이 다릅니다. 로그아웃하면 지금 여행방 선택이 비워지고, 웹에서는 이 세션에만 있던 사진 원본(blob)이 지워집니다(clearSessionPhotos). 이는 되돌릴 수 없습니다. 게다가 로그아웃(ghost)과 계정 탈퇴(quiet)가 스크롤 맨 끝, 고정 '저장' 버튼 바로 위에 붙어 있어서 저장하려다 잘못 누르기 쉽습니다.
- 제안: 내 프로필에서 '로그아웃' 버튼을 없앱니다. 확인 시트가 붙은 프로필 탭 계정 줄을 유일한 자리로 둡니다. 계정 탈퇴는 화면 맨 아래 '계정 관리' 구역의 ListRow(trash 아이콘, 꺾쇠)로 낮추고, 저장 Foot과는 SP.section만큼 띄웁니다. 버튼을 남기기로 하면 최소한 More와 같은 ConfirmSheet('로그아웃할까요')를 붙입니다.
- 파일: test/src/screens/ProfileScreen.tsx
- 테스트 영향: 화면을 고정하는 테스트가 없습니다. integration-account-delete와 wp1-auth-http는 store와 flows만 검사하므로 영향이 없습니다.

### [medium/M] 내 프로필(17) 전체 배치
- 문제: 지금 순서는 머리말 → 이니셜 아바타 카드(기기 토큰 끝자리) → 닉네임 → 별도 '프로필 이미지' 카드(56px 미리보기, [사진 고르기][예시 8.4MB로 시연]) → 성향 태그 → 구분선 → 계정 또는 승격입니다. 문제는 다섯 가지입니다. (a) 저장한 사진이 머리 카드 아바타에는 안 보이고 아래 카드에만 보여서 '내 사진'이 두 군데로 나뉩니다. (b) 게스트에게 가장 중요한 '계정으로 바꾸기'가 390×844에서도 첫 화면 밖 맨 아래에 있습니다. (c) 시연용 '예시로 시연' 버튼이 실제 '사진 고르기'와 같은 무게로 나란히 있습니다. (d) 계정 구역은 Card 안에 이메일, 연결 칩, [카카오 연결][구글 연결] 버튼을 넣어서 이미 연결된 제공자에도 '연결' 버튼이 보입니다. DS는 '설정·프로필 메뉴는 ListRow, 카드로 감싸지 않는다'고 정합니다. (e) 회색 '바뀐 내용 없음' 버튼이 아래 약 94px을 늘 차지합니다.
- 제안: 위에서부터 다시 배치합니다. ① 가운데 정렬 머리(ui 컴포넌트): 큰 아바타가 사진을 보여 주고, 누르면 사진 고르기가 열립니다(카메라 배지). 아래에 이름과 '계정'/'게스트' 칩을 둡니다. 압축 정보는 사진을 고른 직후에만 한 줄로 보입니다('8.4MB에서 1.2MB로 줄여 저장해요'). '예시로 시연'은 그 아래 TextLink로 낮추거나 More의 시연 도구로 옮깁니다. ② 게스트면 바로 아래에 tinted 카드 '계정 만들기'와 한 줄 '여행방은 그대로 유지돼요'를 둡니다('승격' 대신 쉬운 말, ghost 버튼). ③ '기본 정보': 닉네임 Field와 여행 성향 Tag. ④ 계정이면 '로그인 방법' ListRow 세 줄: 이메일(값), 카카오(연결됨 Chip 또는 '연결하기' 꺾쇠), 구글(같은 방식). ProviderChips 결과로 줄마다 상태를 정합니다. ⑤ '계정 관리'(3번 항목). 저장 Foot은 dirty일 때만 보입니다.
- 파일: test/src/screens/ProfileScreen.tsx, test/src/ui/Discover.tsx, test/src/ui/index.ts
- 테스트 영향: ProfileScreen을 고정하는 테스트는 없습니다. foundation-design-rules가 src/ui와 Splash 밖에서 가운데 정렬(textAlign center, <Txt center>)을 금지하므로 가운데 머리는 반드시 src/ui 컴포넌트로 만들어야 합니다. ProfileHero에 imageUri, onPhotoPress, chip 옵션을 더하거나 ProfileEditHero를 새로 만듭니다. Image 테두리 같은 색은 토큰(lineC)만 씁니다.

### [medium/S] 로그인(15), 소셜 동의(26): 같은 이메일 계정 연결 확인
- 문제: 카카오나 구글 로그인에서 같은 이메일 계정이 나오면 '기존 계정에 연결할까요' 카드가 로그인 화면 맨 아래(구글 버튼과 안내 아래)에 인라인으로 붙습니다. 폰에서는 첫 화면 밖이라 사용자는 버튼을 눌렀는데 아무 일도 없다고 느낍니다. 26 소셜 동의 화면도 같은 카드가 스크롤 안에 생기고, 아래 주 버튼이 이유 없이 회색(disabled: link != null)으로 바뀝니다.
- 제안: 두 화면 모두 이 확인을 ConfirmSheet로 띄웁니다. 제목 '기존 계정에 연결할까요', 본문은 link.text에 '연결하면 두 로그인 방법이 같은 여행방을 봅니다'를 붙이고, 확인은 '연결하기', 취소는 '연결하지 않기'입니다. 이를 위해 ConfirmSheet에 선택 prop cancelLabel(기본 '취소')을 더합니다. SocialConsent Foot의 '취소'는 머리의 닫기(X)와 겹치므로 지웁니다.
- 파일: test/src/screens/LoginScreen.tsx, test/src/screens/SocialConsentScreen.tsx, test/src/ui/Sheet.tsx
- 테스트 영향: wp1-oauth '로그인 화면 순서'의 표시들(AuthTitle부터 '구글 로그인'까지)은 그대로라 통과합니다. ConfirmSheet는 선택 prop만 추가하므로 다른 화면에는 영향이 없습니다.

### [medium/M] 회원가입(16) · 이메일 인증
- 문제: 한 화면에 폼, 제출 버튼, '인증 메일을 보냈어요' Notice, '모의 메일함'과 '인증 메일 다시 받기', 메일 카드가 전부 세로로 쌓여 있습니다. 가입 전에도 '모의 메일함 · 아직 받은 메일이 없습니다'와 회색 재발송 버튼이 보여 지금 할 일이 흐려집니다. 가입 후에는 다음 할 일(인증하기)이 버튼 아래 스크롤 밖에 생기고, 폼은 그대로 편집할 수 있어서 가입이 된 건지 상태가 불분명합니다. 게스트 승격일 때는 sub 문장과 Notice가 같은 말을 두 번 합니다.
- 제안: sentTo 값으로 두 단계를 나눕니다. 1단계(가입): 제목, 이메일, 비밀번호와 규칙 칩, 닉네임, 오류, '가입하고 인증 메일 받기'. 이 단계에서는 메일함 구역을 숨깁니다. 2단계(메일 확인): 제목 '메일을 확인해 주세요', 요약 줄 '{email}로 보냈어요'와 TextLink '이메일 바꾸기'(1단계로 돌아감), 바로 아래 메일 카드(인증하기), 그 아래 quiet '인증 메일 다시 받기'. 승격 안내는 sub 한 줄만 남기고 Notice는 지웁니다.
- 파일: test/src/screens/SignupScreen.tsx
- 테스트 영향: wp1-oauth의 hex/rgba 금지 검사만 해당하며 토큰만 쓰면 통과합니다. 모의 메일함과 인증 동작 테스트(wp1-auth, wp2-auth)는 제공자 수준이라 영향이 없습니다.

### [medium/S] 온보딩 · 돌아온 사용자
- 문제: 계정 세션이 서버에서 끊긴 사람(만료, 다른 기기에서 비밀번호 재설정, 탈퇴)이나 로그아웃한 사람이 다시 열면 온보딩으로 옵니다. 그런데 주 버튼은 '게스트로 시작하기'이고 로그인은 아래 작은 quiet 버튼입니다. 습관대로 주 버튼을 누르면 빈 게스트가 생겨서 '내 여행방이 사라졌다'고 느낍니다. useSession에 expiredKind('account')가 있는데 온보딩은 이 값을 읽지 않습니다. 또 온보딩에서 닉네임을 적은 뒤 '초대 코드로 합류'를 누르면 초대 화면에서 이름을 다시 적어야 합니다.
- 제안: expiredKind === 'account'이면 머리 아래에 한 줄 Notice('로그인이 끝났어요. 다시 로그인하면 여행방을 이어 써요')를 두고, 주 버튼을 '다시 로그인하기'(Login)로, '게스트로 시작하기'를 ghost로 바꿉니다. 평소에는 지금 순서를 유지하되, 아래 두 보조 버튼 중 '계정으로 로그인'은 TextLink '이미 계정이 있어요 · 로그인'으로 정리합니다. '초대 코드로 합류'는 적어 둔 닉네임을 InviteAccept 파라미터(nickname?)로 넘겨 이름 칸을 미리 채웁니다.
- 파일: test/src/screens/OnboardingScreen.tsx, test/src/screens/InviteAcceptScreen.tsx, test/src/navigation/routes.ts
- 테스트 영향: 고정 테스트는 없습니다. routes의 InviteAccept 파라미터에 nickname?을 더하면 타입만 바뀌고 딥링크 'j/:code'는 그대로입니다(tsc 확인). routes.ts의 소유 범위는 확인이 필요합니다.

### [medium/S] 로그인(15) · 게스트 경고
- 문제: 게스트가 프로필 탭의 '로그인' 줄로 들어오면 맨 위에 세 문장짜리 앰버 경고가 나옵니다. 경고는 '먼저 회원가입으로 승격해 주세요'라고 하지만 그 자리에 승격 버튼이 없어서, 사용자는 아래 '회원가입' 버튼을 따로 찾아야 합니다. 경고 때문에 카카오·구글 버튼도 더 아래로 밀립니다. 게스트에게 프로필 탭 계정 줄은 게스트 데이터를 잃는 길인 '로그인' 하나뿐이고 '계정 만들기'는 없습니다.
- 제안: Notice를 제목 '지금은 게스트 {닉네임}이에요'와 한 줄 '다른 계정으로 로그인하면 이 기기의 게스트 여행방은 보이지 않아요'로 줄입니다. 바로 아래에 ghost sm 버튼 '계정으로 바꾸기(여행방 유지)'를 두어 Signup으로 보냅니다. 같은 맥락으로 MoreScreen의 게스트 계정 줄을 '계정 만들기'(Signup)와 '다른 계정으로 로그인' 두 줄로 바꾸는 것을 권합니다. 다른 그룹 파일이라 조율이 필요합니다.
- 파일: test/src/screens/LoginScreen.tsx, test/src/screens/MoreScreen.tsx
- 테스트 영향: wp1-oauth 로그인 순서 테스트는 src.indexOf('title="회원가입"')로 첫 위치를 찾습니다. 그래서 새 버튼 제목을 정확히 title="회원가입"으로 쓰면 순서 검사가 깨집니다. '계정으로 바꾸기' 같은 다른 제목을 쓰면 통과합니다. MoreScreen은 wp6-community가 소스를 읽지만 '여행방 설정' 부재만 보므로 계정 줄 변경과는 무관합니다.

### [medium/S] 내 프로필(17) · 저장하지 않고 나가기
- 문제: 닉네임, 사진, 태그를 바꾸고 뒤로 가기(또는 안드로이드 뒤로 제스처)를 누르면 확인 없이 바뀐 내용이 사라집니다. 사진을 고르자마자 뒤로 가는 경우가 흔합니다. 사용자가 이번에 커뮤니티 글쓰기에 요구한 '나가시겠습니까? 저장하고 나가기/취소' 패턴과도 어긋납니다.
- 제안: dirty일 때 @react-navigation/native 7.4.1의 usePreventRemove로 나가기를 막고 시트를 띄웁니다. 제목은 '바뀐 내용을 저장할까요', 주 버튼은 '저장하고 나가기'(save 성공 뒤 data.action dispatch), quiet 버튼은 '저장하지 않고 나가기'와 '취소'입니다. 닉네임 오류가 있으면 '저장하고 나가기'를 끄고 이유를 한 줄로 보여 줍니다. 커뮤니티 글쓰기에서도 같은 시트를 만들 예정이므로, src/ui/Sheet.tsx에 공용 LeaveConfirmSheet를 두고 두 화면이 같이 쓰도록 조율합니다.
- 파일: test/src/screens/ProfileScreen.tsx, test/src/ui/Sheet.tsx, test/src/ui/index.ts
- 테스트 영향: 고정 테스트는 없습니다. usePreventRemove(dirty) 사용을 확인하는 wp1 소스 규칙 테스트 추가를 권합니다. 커뮤니티 작업 쪽 컴포넌트와 이름이 겹치지 않게 주의해야 합니다.

### [medium/S] 초대 수락(02) · 미리보기와 코드 입력
- 문제: 로그인한 사람이 초대 미리보기를 열면 아래 고정 영역에 버튼 세 개가 쌓입니다(합류 48 + '초대 거절' 36 + '다른 사람으로 합류(시연)' 36, 패딩 포함 약 184px). 360×640 화면의 약 30%를 덮고, 시연 전용 버튼이 엄지 영역에 실제 동작과 같은 무게로 있습니다. 시연 토글을 누르면 이름 칸이 말없이 비워집니다. 제목은 입력 중인 이름을 글자마다 따라 바뀌어('민지님이 지님을…') 줄 수가 변하고 아래 입력 칸이 흔들립니다. 코드 칸에는 Enter 제출이 없습니다. '초대 거절'은 방장에게 알리는 것처럼 읽히지만 실제로는 화면만 닫습니다.
- 제안: Foot에는 주 버튼과 quiet '나중에 할게요'(지금과 같은 leave 동작) 두 개만 둡니다. '다른 사람으로 합류(시연)'는 Body의 이름 칸 아래 TextLink로 옮기고, 켜지면 이름 칸 위에 line Chip '시연 · 새 멤버로 합류'를 보입니다. 제목은 '{방장}님이 여행방에 초대했어요'로 고정합니다(이름 따라 바뀌는 부분 제거). 코드 Field에는 onSubmitEditing=submitCode와 autoCapitalize 'characters'를, 이름 Field에는 onSubmitEditing=join을 줍니다.
- 파일: test/src/screens/InviteAcceptScreen.tsx, test/src/ui/Field.tsx
- 테스트 영향: wp2-invite는 core/trip/join 로직만 검사하므로 영향이 없습니다. '초대 거절' 문구는 목업 02 기준이라 바꿀지는 사용자 확인이 필요합니다(바꾸지 않아도 나머지 제안은 유효). InviteAccept는 WP2 소유입니다.

### [medium/M] 공통 입력 칸(Field), 화면 제목 접근성
- 문제: Field가 TextInput에 autoCapitalize, autoCorrect, autoComplete/textContentType, returnKeyType을 넘기지 않습니다. 그래서 iOS에서 이메일과 아이디 칸 첫 글자가 대문자가 되고 자동 수정이 주소를 바꿉니다. 대소문자는 인증 쪽이 맞춰 주지만, 비밀번호 관리자와 저장된 로그인 자동 채우기, iOS '강력한 암호 제안'이 동작하지 않습니다. 비밀번호 보기 토글이 없어서 비밀번호 확인 칸이 없는 회원가입과 재설정에서 오타를 확인할 수 없습니다. 화면 제목(Header, AuthTitle)에 accessibilityRole header가 없어 스크린리더로 제목 이동이 안 되고(Splash만 있음), 입력 오류 줄은 읽어 주지 않습니다.
- 제안: Field에 선택 prop kind를 더합니다: 'email', 'username', 'password', 'newPassword', 'nickname', 'code'. kind 하나로 autoCapitalize('none' 또는 'characters'), autoCorrect=false, autoComplete('email', 'username', 'current-password', 'new-password'), textContentType(iOS), returnKeyType을 정합니다. secure Field 오른쪽에는 '보기'/'숨기기' 글자 버튼을 둡니다. 아이콘 세트에 eye가 없으므로 글자로 하고, 높이 48은 그대로 둡니다. Header 제목과 AuthTitle은 accessibilityRole="header" View로 감쌉니다(Splash와 같은 방식). 오류 Txt에는 accessibilityLiveRegion="polite"를 줍니다. 화면은 kind만 넘깁니다: 로그인(ident는 username, password), 회원가입(email, newPassword, nickname), 계정찾기(email, newPassword), 초대 코드(code).
- 파일: test/src/ui/Field.tsx, test/src/ui/layout.tsx, test/src/ui/Auth.tsx, test/src/screens/LoginScreen.tsx, test/src/screens/SignupScreen.tsx, test/src/features/account/FindAccountSheet.tsx, test/src/screens/InviteAcceptScreen.tsx
- 테스트 영향: wp1-oauth 디자인 규칙(H.auth 48, 라운드 16 이하, 화면 hex 금지)을 지키면 통과합니다. TextInput은 src/ui 안이라 foundation-design-rules에 걸리지 않습니다. 로그인 순서 테스트의 표시('"아이디 또는 이메일"', 'placeholder="비밀번호"')는 문자열을 바꾸지 않으면 통과합니다.

### [low/S] 내 프로필 머리, 계정찾기 시트, 회원가입 메일 카드
- 문제: 일반 사용자가 보는 자리에 개발용 말이 남아 있습니다. 내 프로필 머리 카드의 '기기 토큰 ab12'와 계정일 때의 '로그인 유지 …까지', 계정찾기 시트 빈 메일함의 'AUTH_DEV_OUTBOX=1일 때', 메일 카드의 '링크 끝 xxxx'입니다. 시트 제목은 '계정찾기'인데 실제로는 비밀번호 재설정만 합니다.
- 제안: 프로필 머리: 게스트는 칩 아래 한 줄 '이 기기 · {날짜}까지(쓸 때마다 연장)', 계정은 이메일만 보입니다. 토큰 끝자리는 프로필 탭 설정 카드(sessionSummary)에만 남깁니다. 계정찾기 빈 메일함 문구는 '받은 재설정 메일이 없어요. 잠시 뒤 다시 받아 주세요.'로 바꾸고 서버 변수 설명은 코드 주석으로 옮깁니다. 시트 제목은 '비밀번호 재설정'으로 바꿉니다(로그인 링크 '계정찾기'는 사용자 시안이자 테스트 고정이라 유지). '링크 끝 xxxx'는 지우고 보낸 시각만 남깁니다(오래된 메일은 '쓸 수 없음' 칩이 구분해 줍니다).
- 파일: test/src/screens/ProfileScreen.tsx, test/src/features/account/FindAccountSheet.tsx, test/src/screens/SignupScreen.tsx
- 테스트 영향: wp1-home '게스트 세션 요약은 만료일과 토큰 끝 4자리만 보인다'는 features/account/settings.ts의 sessionSummary(More 설정 카드)만 고정하므로 그대로 둡니다. wp1-oauth 로그인 순서는 title="계정찾기" 링크만 보므로 시트 제목 변경과 무관합니다.

## 기록·프로필 탭 (PhotosScreen, DiaryScreen, RecordMapScreen, MoreScreen, src/features/journal/**)

**주요 흐름**
- 여행 중: 방금 찍은 사진을 여행방에 올리고(사진 올리기) 잘 올라갔는지 확인한다
- 사진을 날짜별로 훑어보고, 한 장의 정보(언제·어디서·누가 올렸는지)를 보거나 내가 올린 사진을 지운다
- 하루가 끝나거나 여행이 끝난 뒤 그날 일기를 만들거나, 자동으로 만들어진 일기를 읽는다
- 일기 문단을 눌러 문장을 고치고 저장한다
- 일기를 친구·그룹에 보내거나(시스템 공유·복사) 커뮤니티에 올린다
- 사진·방문 기록이 새로 생기면 일기를 다시 만든다
- 기록 지도에서 그날 실제로 다닌 길을 계획과 비교하고, 방문 순서·시각을 확인하고, 장소를 연다
- 같은 날짜를 유지한 채 사진·일기·기록 지도 사이를 오간다
- 프로필 탭: 내 프로필을 보고 고친다, 여행방 기능(멤버 초대, 여행 진행, 여행지 추천, 기록)으로 들어간다
- 계정: 로그인·로그아웃, 게스트에서 계정으로 전환, 세션 만료 확인
- 설정: 알림 종류별 켜기·끄기, 위치 사용 상태 확인
- (시연 운영자) 시나리오 채우기, 네트워크 끊기 모의, 시연 리셋, 화면 목록 열기

### [high/M] 사진 · 일기 · 기록 지도 (공통 이동)
- 문제: 같은 날 기록을 보여 주는 세 화면이 서로 따로 놉니다. 화면끼리 오가는 버튼이 화면마다 다른 곳에 있습니다. 사진 화면은 맨 위에 '일기·기록 지도' 버튼 두 개, 기록 지도는 스크롤 맨 아래에 '사진·일기', 일기 화면에는 아예 없고, 여행 진행 화면에는 '기록 지도·사진'이 있습니다. 고른 날짜도 넘어가지 않습니다. 사진에서 일기로 갈 때 date를 넘기지 않고, Photos 라우트에는 date 파라미터가 없어서 기록 지도나 여행 진행에서 사진으로 가면 늘 '전체'로 열립니다. 그래서 '10/18 사진을 보다가 그날 일기 보기'가 날짜를 다시 고르는 2~3번의 탭이 됩니다. 들어가는 길도 프로필 탭 목록의 3줄과 여행 진행 화면뿐이라, 명세가 핵심 차별점으로 꼽는 자동 일기가 '프로필' 탭 4번째 줄에 묻혀 있습니다.
- 제안: src/features/journal/components/RecordTabs.tsx를 새로 만듭니다. DS CategoryTabs 형태(icon이 있는 Seg)로 [사진 camera | 일기 book | 지도 map] 세 칸을 두고, 세 화면 모두 Header 바로 아래·DateSeg 위에 놓습니다. 탭을 누르면 navigation.replace(대상, { tripId, date })로 화면을 바꿉니다. 그래야 뒤로 가기 스택이 쌓이지 않고 고른 날짜가 이어집니다(사진의 '전체'는 undefined로 넘김). RootStackParamList.Photos에 date?: string을 더하고, PhotosScreen의 처음 date는 route.params.date ?? 'all'로 합니다. 각 화면에 임시로 둔 교차 버튼 Row는 지웁니다(PhotosScreen 123~130행, RecordMapScreen 133~140행). Header는 eyebrow=여행 제목, title='여행 기록'으로 맞추고, 지금 어느 화면인지는 탭이 보여 줍니다. 여행 진행 화면의 두 버튼은 '기록 보기' 하나(RecordMap, date)로 줄입니다. 다른 그룹 선택안: 홈 메뉴에 진행 중이거나 끝난 여행이면 '기록' 칸을 둡니다.
- 파일: src/features/journal/components/RecordTabs.tsx (new), src/screens/PhotosScreen.tsx, src/screens/DiaryScreen.tsx, src/screens/RecordMapScreen.tsx, src/navigation/routes.ts, src/screens/MoreScreen.tsx (open()의 Photos 파라미터), src/screens/LiveTripScreen.tsx (선택, WP5)
- 테스트 영향: 교차 버튼을 고정하는 기존 테스트는 없습니다. wp6-community가 DiaryScreen에서 찾는 정규식 두 개(navigate('CommunityCompose', { tripId, date }), entry && entry.blocks.length > 0)는 그대로 둡니다. 새 파일은 WP6 글롭 src/features/journal/**에 걸립니다. tests/wp6-record-tabs.test.ts를 새로 두어 세 화면이 RecordTabs를 쓰고 date를 넘기는지, Photos 라우트에 date?가 있는지 확인하는 소스 규칙 테스트를 권장합니다. 홈에 칸을 더하면 wp1-home 114행의 homeMenu 키 목록 단언을 갱신해야 합니다.

### [high/M] 프로필 탭 (MoreScreen) 전체 배치
- 문제: 탭을 열면 모든 것이 펼쳐진 채 한 줄로 이어집니다. 위에서부터 큰 '프로필' 제목, 높이 약 210px의 프로필 카드, '여행 진행·멤버 초대' 타일(둘 다 홈·지도 탭에 이미 있는 진입점), 여행방 목록, 계정, 알림 카드, 위치 카드, 제공자 상태 카드, 데이터 보존 긴 문단, 시연 도구(시나리오·네트워크·리셋·화면 목록) 순서입니다. 360x640 폰에서는 여러 화면을 스크롤해야 합니다. 일반 여행자에게 필요 없는 개발·시연 항목(제공자 상태의 '예시 데이터', 화면 번호 목록)이 설정 사이에 섞여 있습니다. 구역 제목도 섞여 있습니다. 여행방·계정은 Txt 'section'(22px)인데 알림·위치·제공자·보존·시연은 'label'(12px)입니다. 설정은 DS 규칙('설정·프로필 메뉴는 ListRow, 카드로 감싸지 않는다')과 달리 Card로 감쌌습니다. 여행방이 없으면 회색 줄 4개와 타일 2개가 이유 없이 비활성으로 보입니다. '그룹원 위치 공유 · 준비 중' 줄은 HANDOFF 결정('위치 공유는 만들지 않는다')과 달리 곧 나올 기능처럼 보입니다. 게스트에게는 '로그인'만 보이고, 여행방을 지켜 주는 계정 전환(승격)은 프로필 상세 안에 숨어 있습니다.
- 제안: 위에서 아래로 다시 놓습니다. (1) '프로필' hero 제목은 그대로 둡니다. (2) ProfileHero를 가로 한 줄로 줄입니다: 원 56 + 이름 + '게스트 · 11/10까지' 또는 '계정 · 이메일' + 꺾쇠, 곧 만료면 warn 칩. ProfileHero에 row 변형을 더합니다. (3) '내 여행 기록' FeatureTile 3칸 [사진 N장 | 일기 N일 | 기록 지도]를 FeatureTile badge로 두고 F1 기록 화면으로 보냅니다. (4) 여행방 제목 구역의 ListRow는 여행 진행, 멤버 · 초대 링크, 여행지 추천입니다. 여행방이 없으면 비활성 줄 대신 ListRow 하나 '여행방 만들기'(CreateTrip)만 둡니다. (5) '설정' 구역 ListRow: 알림(sub '4개 중 3개 켜짐', 누르면 스위치 4개가 든 Sheet), 위치(sub '허용됨 · 기기 위치 켜짐'), 데이터 보존(sub '2027-10-19까지', 누르면 안내 Sheet). (6) '계정' 구역: 게스트면 '이메일 계정 만들기'(Signup, 여행방 유지)와 '로그인', 계정이면 '로그아웃'. (7) 맨 아래에 기본으로 접힌 '시연 도구' ListRow 하나를 두고, 펼치면 시나리오 채우기·네트워크·시연 리셋·제공자 상태·화면 목록이 나옵니다(showScreens처럼 펼침 상태로). '그룹원 위치 공유' 줄은 지웁니다. 구역 제목은 모두 Txt v="section"으로, gap={8}·paddingTop 10 같은 숫자는 SP 토큰으로 바꿉니다.
- 파일: src/screens/MoreScreen.tsx, src/ui/Discover.tsx (ProfileHero 가로 변형), src/features/account/settings.ts (알림 요약·보존 날짜 짧은 값 순수 헬퍼)
- 테스트 영향: wp6-community의 '프로필 탭 여행방 목록에는 여행방 설정이 없다' 단언(more.includes("label: '여행방 설정")이 false)은 그대로 둡니다. MoreScreen 소스를 고정하는 다른 테스트는 없습니다. settings.ts에 새 순수 헬퍼를 두면 wp1-home에 단언을 더합니다(NOTIFY_ROWS kind 목록, retentionText 단언은 유지).

### [high/S] 일기 (DiaryScreen) 빈 날·만드는 중 상태
- 문제: 일기가 없는 날에는 '10/18 (토) 일기가 아직 없습니다' 카드 한 줄과 아래 주 버튼 '일기 만들기'뿐입니다. 그날 사진·도착 기록이 하나도 없어도 같은 주 버튼이 뜨고, 누르면 문단 0개짜리 빈 일기가 저장·동기화됩니다. 그 뒤에는 '빈 일기' 경고와 비활성 '공유'만 남습니다(composeDiary는 drafts가 0이면 status 'empty'를 돌려주고 화면은 그대로 dispatch). 나중에 기록이 생겨도 이미 일기가 있어서 종료 후 자동 만들기(needsAuto는 !trip.diaries[date] 조건)가 돌지 않습니다. 일기를 만드는 동안(AI는 몇 초)이나 종료 후 자동으로 만드는 동안에는 버튼이 회색이 될 뿐 '만드는 중'이라는 표시가 없습니다. 나간 멤버에게도 만들기·'고치기'가 그대로 보이고, 누르면 거부 토스트만 뜹니다.
- 제안: entry가 없으면 Card 대신 Empty(icon 'book')를 씁니다. pending.length > 0이면 title '{dayLabel} 일기를 만들 수 있어요', text '사진 {n}장 · 방문 {n}곳', action '일기 만들기'(Empty 가운데 주 버튼)로 하고 Foot은 비웁니다. pending.length === 0이면 title '이 날은 기록이 없어요', action '사진 올리기'(Photos { tripId, date }, F1)로 하고 일기 만들기 버튼은 두지 않습니다. busy면 버튼 제목을 '일기 만드는 중'으로 바꾸고 Notice(icon 'clock') '사진과 방문 기록으로 일기를 쓰는 중이에요'를 보여 줍니다. 나간 멤버(leftAt)면 만들기·고치기를 숨기고 Notice '나간 멤버는 일기를 볼 수만 있어요'를 보여 주며, BlockCard의 '고치기' 라벨과 onPress도 숨깁니다.
- 파일: src/screens/DiaryScreen.tsx
- 테스트 영향: DiaryScreen을 고정하는 테스트는 wp6-community 정규식 두 개뿐이고 영향이 없습니다(wp6-diary는 core만 봅니다). 선택: wp6 소스 규칙 테스트로 'pending이 0이면 generateDiary를 부르는 버튼이 없다'를 더할 수 있습니다.

### [high/M] 프로필 탭 (MoreScreen) 켜고 끄는 줄
- 문제: 알림·위치·네트워크의 켜고 끄는 줄(ToggleRow)에는 오른쪽에 '켜짐/꺼짐/연결/끊김' Chip만 있습니다. DS에서 Chip/Badge는 '누를 수 없는 상태 표시'라서, 사용자는 이 줄이 스위치인 줄 모릅니다. 설명 문구는 accessibilityHint로만 들어가고 화면에는 보이지 않습니다(NOTIFY_ROWS sub '스팟 100m 안에 3분 머물면…', 네트워크 '끊으면 메시지와 편집이 전송 대기로…'). 특히 '네트워크 · 연결' 줄은 상태 표시처럼 보이는데, 한 번 누르면 앱이 오프라인 모의 상태가 되어 동기화와 재계산이 멈춥니다. 줄 높이도 첫 줄 약 24px, 나머지 약 34px로 44px 터치 기준보다 작습니다. 정보만 보여 주는 '위치 권한' 줄도 같은 모양입니다.
- 제안: src/ui에 Switch를 더합니다(트랙 44x26, 켜짐 surfaceC.accent, 꺼짐 lineC.strong, 손잡이 card, 비텍스트 대비 3:1). ToggleRow는 src/ui ListRow의 스위치 변형으로 옮깁니다(right=Switch, 꺾쇠 없음, minHeight 64, accessibilityRole 'switch', checked). sub는 DS 규칙대로 현재 값이나 짧은 조건만 화면에 보입니다: '15분 이상 밀릴 때', '100m 안에 3분', '30분 이상 빌 때', '만료 3일 전'. 네트워크 토글은 F2의 접힌 '시연 도구' 안으로 옮기고, 하는 일이 드러나게 라벨을 '오프라인 흉내(시연)'로 바꿉니다. 위치 권한은 꺾쇠·스위치 없는 정보 줄로 만들거나 '기기 위치 사용' 줄의 sub('권한 허용됨')로 합칩니다.
- 파일: src/ui/Switch.tsx (new, FOUNDATION src/ui/**), src/ui/Discover.tsx (ListRow 스위치 변형), src/ui/index.ts, src/screens/MoreScreen.tsx, src/features/account/settings.ts (NOTIFY_ROWS sub 짧게)
- 테스트 영향: wp1-home 154행의 NOTIFY_ROWS kind 목록 단언은 그대로 통과합니다. sub 문구를 고정하는 단언은 없습니다. 새 스위치의 트랙·손잡이 색 대비는 foundation-contrast의 '상태를 알리는 비텍스트 요소 3:1' 테스트에 쌍으로 더하기를 권장합니다. 색 값은 src/ui 안에서만 쓰므로 design-rules를 통과합니다.

### [medium/S] 일기 (DiaryScreen) 하단 버튼과 공유
- 문제: 일기가 있으면 하단에 '다시 만들기'(quiet)·'공유'(primary) 한 줄과 '커뮤니티에 올리기'(ghost)까지 버튼 3개가 세로로 약 150px를 차지해, 360x640에서 본문 영역이 크게 줄어듭니다. 자주 쓰지 않는 '다시 만들기'가 엄지 자리에서 '공유'와 같은 크기로 붙어 있어 잘못 누르기 쉽습니다. 누르면 확인 없이 AI 문장을 새로 씁니다(고친 문장은 남지만 고치지 않은 문장은 바뀝니다). '공유'(시스템 공유·복사)와 '커뮤니티에 올리기'(앱 사용자 전체 공개)의 차이도 버튼 이름만으로는 알기 어렵습니다. 반대로 '새 기록 N건이 일기에 없습니다' Notice에는 바로 고칠 수 있는 행동이 붙어 있지 않습니다.
- 제안: Foot에는 primary '공유하기' 하나만 둡니다. 누르면 Sheet '어디에 나눌까요'가 열리고 ListRow 두 줄이 나옵니다: '메시지·메모로 보내기'(shareDiary, 안 되면 복사)와 '커뮤니티에 올리기'(CommunityCompose { tripId, date }, entry.blocks.length > 0일 때만). '다시 만들기'는 두 곳으로 옮깁니다. (a) stale일 때 Notice 아래 Btn sm quiet '새 기록 넣어 다시 만들기', (b) Header right IconBtn 'dots'를 누르면 나오는 Sheet의 '일기 다시 만들기'(mt 한 줄 '고친 문장은 그대로 둬요').
- 파일: src/screens/DiaryScreen.tsx
- 테스트 영향: wp6-community '연결: 일기 화면 → 커뮤니티 글쓰기'가 DiaryScreen 소스에서 navigation.navigate('CommunityCompose', { tripId, date })와 entry && entry.blocks.length > 0을 찾습니다. 공유 Sheet 안에서도 두 식을 그대로 쓰면 통과합니다. 구조를 바꾸면 같은 의도(문단이 있을 때만 tripId·date를 넘겨 커뮤니티로)로 정규식을 갱신합니다.

### [medium/M] 일기 (DiaryScreen) 문장 고치기 시트
- 문제: 문단을 눌러 고치는 Sheet에서 바깥(어두운 면)을 누르거나 안드로이드 뒤로 가기를 하면, 고친 문장이 확인 없이 사라집니다. 사용자가 커뮤니티 글쓰기에 요청한 '나가시겠습니까? 저장하고 나가기/취소' 패턴과도 맞지 않습니다. 또 src 전체에 KeyboardAvoidingView가 없어서, 폰(특히 iOS와 iOS Safari)에서는 아래에 붙은 시트의 4줄 입력칸과 '저장' 버튼이 키보드에 가립니다.
- 제안: draft.trim()이 원문과 다르면 onClose(바깥 누름·뒤로 가기)와 시트 안 '취소'를 가로챕니다. 그리고 같은 Sheet 안 내용을 확인 화면으로 바꿉니다(Modal 두 개를 겹치지 않음): 제목 '고친 문장을 저장할까요', 버튼 '저장하고 닫기'(primary)와 '취소'(계속 고치기), 그 아래 quiet sm '고친 내용 버리기'. 바뀐 것이 없으면 지금처럼 바로 닫습니다. src/ui/Sheet에 KeyboardAvoidingView(iOS는 behavior 'padding')와 keyboardShouldPersistTaps='handled' ScrollView를 넣어, 모든 시트의 입력칸이 키보드 위로 올라오게 합니다. Col gap={9}는 SP 토큰으로 바꿉니다.
- 파일: src/screens/DiaryScreen.tsx, src/ui/Sheet.tsx
- 테스트 영향: Sheet와 일기 편집을 고정하는 테스트는 없습니다. Sheet 변경은 모든 시트에 영향을 주므로 메인 세션의 웹 확인 한 번이 필요합니다. wp6 소스 규칙 테스트로 '바뀐 draft를 닫을 때 확인을 거친다'를 더하기를 권장합니다.

### [medium/M] 사진 (PhotosScreen) 하단·피드백·전체 보기
- 문제: 하단에 '사진 올리기'와 같은 너비의 '예시 사진 3장 넣기'(시연용)가 모든 사용자에게 두 번째 주 행동처럼 보입니다. 올리는 중에는 두 버튼이 회색이 될 뿐 진행 표시가 없습니다. 나간 멤버가 사진을 올리면 스토어가 '나간 멤버는 사진을 올릴 수 없습니다' 토스트를 띄운 직후, 화면이 '사진 0장을 올렸습니다' 토스트로 덮어씁니다(r.picked > 0인데 r.photos가 0). '전체' 보기는 날짜 구분 없는 오래된 순 격자라서, 사진이 많으면 어느 날 사진인지 알 수 없습니다. Header sub '사진 N장'은 DateSeg의 '전체 N'과 겹칩니다. '여행 기간 밖에 찍은 사진' 앰버 경고는 어느 날짜 탭에서든 매번 뜹니다.
- 제안: Foot에는 '사진 올리기' 하나만 둡니다(busy면 '올리는 중'). '예시 사진 3장 넣기'는 Header right IconBtn 'dots' Sheet의 '예시 사진 넣기(시연)'와, 빈 상태 Empty 아래 quiet sm 버튼으로 옮깁니다. 나간 멤버면 Foot 대신 Notice '나간 멤버는 사진을 볼 수만 있어요'를 둡니다. r.picked > 0 && r.photos.length === 0이면 성공 토스트를 띄우지 않습니다. '전체' 보기는 날짜별로 묶습니다. 각 묶음 위에 Row [Txt nm dayLabel, mt 'N장', 오른쪽 quiet sm '이 날 일기'(Diary { date })]를 두고, 기간 밖 사진은 맨 아래 '여행 기간 밖' 묶음으로 보여 주어 앰버 Notice를 대신합니다. 날짜 탭에서는 그 경고를 띄우지 않습니다. Header sub는 지웁니다.
- 파일: src/screens/PhotosScreen.tsx
- 테스트 영향: 없습니다. wp6-photo는 core/journal과 api만 보고, PhotosScreen 소스를 고정하는 테스트는 없습니다.

### [medium/S] 사진 (PhotosScreen) 격자 타일
- 문제: 격자 타일 왼쪽 위에 '추정/날짜 지정', '장소 추정', '압축' Chip이 최대 3개까지 세로로 쌓입니다. 360px 폭에서 타일은 100px((312-12)/3)인데, 칩 3개(24px씩, 간격 포함 약 80px)가 사진의 대부분을 가립니다. 예시 사진은 아래에 22px 라벨 띠까지 있어 그림이 거의 보이지 않습니다. DS Badge 규칙('사진 위에는 photo 배지 하나만')과도 어긋납니다. 타일 Pressable에 accessibilityLabel이 없어서, 스크린리더가 모든 칸을 똑같이 '사진, 버튼'으로 읽어 구분할 수 없습니다.
- 제안: 타일에는 배지를 하나만 둡니다. 우선순위는 '날짜 지정' > '추정' > '장소 추정'이고, '압축'은 정보 시트에서만 보여 줍니다. Pressable에 accessibilityLabel을 줍니다: `${spotName ?? '장소 모름'} ${kstHHMM(takenAt)} 사진${badge ? ', ' + badge : ''}`. PhotoTile의 예시 라벨 띠는 size >= 96일 때만 그리거나, 배지가 있으면 생략합니다.
- 파일: src/screens/PhotosScreen.tsx, src/features/journal/components/PhotoTile.tsx
- 테스트 영향: 없습니다.

### [medium/S] 기록 지도 (RecordMapScreen)
- 문제: 지도(340px) 아래 범례가 항목 6개(계획 루트·실제 이동 지점·사진 위치·기록 없는 구간·기점·지나친 스팟)를 늘 모두 보여 줍니다. 그래서 360px에서 3줄로 접히고, 그날 지도에 없는 항목(점선, 지나친 스팟, GPS 점)까지 나옵니다. 그 아래에는 '도착 N곳' 칩 하나만 있는 줄이 따로 있습니다. 방문 기록 줄은 눌러지지 않아서(핀은 스팟 상세로 갑니다) 목록에서 장소를 열 수 없습니다. 위치 권한 거부·시뮬레이터 안내 Notice가 최대 2개까지 지도 위에 쌓여 지도를 아래로 밉니다. 사진·일기로 가는 버튼은 스크롤 맨 아래에 있습니다.
- 제안: 범례는 지도에 실제로 그려진 것만 보여 줍니다. 실제 이동 점은 model.gpsPoints > 0일 때, 점선은 polylines.some(l => l.dashed)일 때, 사진 점은 dots에 사진 점이 있을 때, 지나친 스팟은 rows에 'passed'가 있을 때, 기점은 'base' 마커가 있을 때만 둡니다. '도착 N곳'은 방문 기록 카드 제목 '방문 기록 · 도착 N곳'으로 합치고 칩 줄은 지웁니다. VisitRow를 Pressable(minHeight 44, accessibilityLabel '{번호} {이름} {시각} 도착')로 바꿔, 핀과 같이 SpotDetail로 보냅니다(spotId가 trip.spots에 있을 때). 안내 Notice는 지도 아래로 옮기고, 'sim' 안내는 지도 왼쪽 위 Chip '시뮬레이터 기록'으로 띄웁니다(RecordMapScreen은 E.float 허용 목록에 이미 있습니다). 교차 버튼은 F1 탭이 대신합니다.
- 파일: src/screens/RecordMapScreen.tsx, src/core/journal/recordMap.ts (선택: 범례 표시 플래그 순수 계산)
- 테스트 영향: wp6-record-map '범례는 모델 색…' 테스트가 정확히 `<Legend planned={model.plannedColor} gap={model.gapColor} />`를 찾습니다. 프롭을 더하면 이 정규식을 `<Legend planned=\{model\.plannedColor\} gap=\{model\.gapColor\}` 접두로 바꿔 색 의도를 지킵니다. 견본 SVG 정규식(stroke={mapC[gap]} strokeWidth={3.4} strokeDasharray="6 5", r={3.5} fill={mapC.user} stroke={mapC.white}), deniedNone 문구, useLive((s) => s.denied[tripId]) 단언, s.permission 금지는 그대로 둡니다. wp5-my-location의 'RecordMap에 locate 없음'도 그대로입니다. 플래그를 recordMap.ts에 두면 wp6-record-map에 단언을 더합니다.

### [low/S] 사진 (PhotosScreen) 사진 정보 시트
- 문제: 사진 정보 시트에 '촬영 정보(EXIF)', '원본 12.4MB(10MB 초과) · 압축 뒤 약 3.1MB' 같은 기술 용어와 칩 최대 4개가 한꺼번에 나옵니다. 남이 올린 사진에는 '사진 지우기'가 이유 없이 회색으로 보입니다. 사진에서 그날 일기로 가는 길도 없습니다.
- 제안: 썸네일 96 옆을 정보 세 줄로 바꿉니다: '찍은 때 10/18 (토) 14:20'과 값 칩('촬영 정보'/'추정'), '장소 불국사'와 ('추정'), '올린 사람 민지'와 ('나간 멤버'). 크기 줄은 compressed일 때만 '10MB가 넘어 줄여서 올렸어요'로 보여 주고, 'EXIF' 단어는 지웁니다. 내 사진이 아니면 지우기 버튼을 숨기고 mt '올린 사람만 지울 수 있어요'를 둡니다. 아래에 quiet 버튼 '이 날 일기 보기'(Diary { tripId, date: kstDate(takenAt) })를 더합니다.
- 파일: src/screens/PhotosScreen.tsx (SourceChips, Uploader)
- 테스트 영향: 없습니다.

### [low/S] 일기 (DiaryScreen) 머리 칩·안내 쌓임
- 문제: 일기 본문 앞에 여러 겹이 쌓입니다: Header sub(고른 날짜, DateSeg와 같은 정보), 칩 줄(방문·사진·'AI가 쓴 문장'·공유 시각), Notice 최대 3개(새 기록, 비운 문단, 여행 기간 밖 사진). 그래서 360x640에서 첫 문단이 첫 화면 아래로 밀립니다. 'AI가 쓴 문장' 칩은 AI 서비스가 켜져 있기만 하면, 일기가 없거나 모든 문장을 직접 고친 날에도 뜹니다. '여행 기간 밖 사진' 경고는 그날 일기와 관계가 없습니다.
- 제안: Header sub를 '방문 N곳 · 사진 N장'(공유했으면 ' · 공유함')으로 바꾸고 칩 줄은 지웁니다. 'AI가 쓴 문장'은 entry에 editedAt 없는 문장이 있을 때만 본문 맨 아래 mtTight 한 줄로 보여 줍니다. 새 기록·비운 문단 Notice는 하나('새 기록 3건 · 비운 문단 1개')로 합치고 F5의 다시 만들기 버튼을 붙입니다. 기간 밖 사진 Notice는 일기에서 빼고, 사진 화면 '전체' 보기에서만 보여 줍니다(F7).
- 파일: src/screens/DiaryScreen.tsx
- 테스트 영향: 없습니다.

### [low/S] 사진 · 일기 · 기록 지도 날짜 탭 (DateSeg)
- 문제: 세 화면이 같은 DateSeg를 쓰는데 숫자의 뜻이 다릅니다. 사진은 사진 장수, 일기는 기록 묶음(문단) 수, 기록 지도는 숫자가 없습니다. 라벨도 '10/18'뿐이라 시간표 탭('10/18 토', daySegLabel)과 다릅니다. 스크린리더는 '10/18 3, 탭'으로 읽어서 3이 무엇인지 알 수 없습니다.
- 제안: DateSeg 라벨을 daySegLabel과 같은 '10/18 토'로 맞춥니다. daySegLabel은 core/util로 옮기고 schedule/view에서 다시 내보냅니다. 숫자는 사진 탭에서만 장수로 쓰고, 일기·지도 탭에서는 숫자를 빼서 뜻이 하나가 되게 합니다. Seg 아이템에 선택 필드 a11yLabel을 더해 '10월 18일 토요일, 사진 3장'처럼 읽히게 합니다.
- 파일: src/features/journal/components/DateSeg.tsx, src/ui/Seg.tsx, src/core/util.ts 또는 src/features/schedule/view.ts (daySegLabel 공유)
- 테스트 영향: DateSeg 라벨을 고정하는 테스트는 없습니다. daySegLabel을 옮기면 schedule/view에서 다시 내보내 ScheduleScreen(WP4) import가 그대로 되게 합니다. src/core는 순수 영역이라 Date.now()를 쓰지 않습니다(문자열 계산만).

## 시간표·계산 (09 ScheduleScreen, 10 ScheduleEditScreen, 08 PlanningScreen, 12 LegTransportScreen, src/features/schedule/**)

**주요 흐름**
- 하루 일정 훑어보기: 시간표 탭에서 날짜 Seg로 날짜를 고르고, 타임라인에서 도착·출발·이동 시간을 본다. 스팟을 누르면 07 스팟 상세로 간다.
- 하루가 넘쳤을 때 고치기: 09 초과 경고에서 10 일정 편집으로 가서 조정안(체류 줄이기, 다른 날로 옮기기, 빼기)을 한 번 누른다. 필요하면 되돌리고 시간표로 돌아간다. 06 후보 화면의 고정 초과 WarnCard로도 들어온다.
- 직접 손보기(FR-503): 10에서 스팟 순서를 바꾸고, 체류를 15분씩 조절하고, 도착 시각을 지정하거나 풀고, 날짜를 지정하고, 고정(빠지지 않음)을 켜고 끈다.
- 구간 이동수단 바꾸기(FR-504): 09 이동 줄을 눌러 12에서 자동차·도보·대중교통을 비교하고 '바꾸면 이렇게 됩니다' 미리보기를 본 뒤 '이 구간만' 또는 '하루 전체 적용'을 누른다.
- 하루 전체 이동수단 바꾸기: 지금은 아무 구간이나 눌러 12에 들어간 뒤 '하루 전체 적용'을 골라야만 할 수 있다.
- 루트를 처음 계산하거나 다시 계산하고 진행 보기: 09·11·19의 '루트 계산'·'다시 계산'으로 08에 가서 단계와 진행 막대를 보고, '시간표 보기'를 누르거나 이전 화면으로 돌아간다.
- 상태 이해하기: 오프라인 여부, 재계산 대기·진행, 예시 데이터 여부, 제외 스팟 수, 기점·활동시간, 그날 이동수단을 확인한다. 필요하면 06 후보(제외 스팟)나 여행방 설정으로 간다.

### [high/S] 09 시간표 (ScheduleScreen): 초과 경고와 편집 진입
- 문제: 하루가 넘치면 앰버 Notice가 '일정 편집에서 조정안을 골라 주세요'라고 하지만 누를 곳이 없다. 편집으로 가는 입구는 오른쪽 위 40px IconBtn 하나뿐이다. 이 버튼은 'drag' 아이콘(가로줄 두 개)이라 메뉴나 손잡이로 읽히고, 스팟이 없는 날에는 사라진다. 목업 09에는 '편집'이라는 글자 버튼이 있었다. 그래서 가장 중요한 해결 경로(초과에서 조정안으로)가 숨어 있다.
- 제안: (a) 초과 Notice를 06 후보 화면과 같은 WarnCard로 바꾼다. title은 `활동시간을 {humanMin} 넘습니다`, text는 overflowCause(...)이고, items는 [{label:'일정 편집에서 조정안 보기', value:'편집', onPress: openEdit}] 하나다. 한 번 누르면 10으로 간다. 이 초과는 고정 초과이므로 WarnCard 용도(고정 초과)에도 맞다. (b) 헤더 오른쪽 drag IconBtn을 Btn size='sm' variant='quiet' title='일정 편집'으로 바꿔 글자로 보이게 한다. (c) ScheduleScreen 머리 주석과 Notice.tsx의 WarnCard 주석('10 전용')을 '고정 초과(06·09·10)'로 고친다.
- 파일: test/src/screens/ScheduleScreen.tsx, test/src/ui/Notice.tsx
- 테스트 영향: 09 화면 소스를 고정하는 테스트는 없다. foundation-design-rules만 통과하면 된다. wp4-screens의 overflowCause 문장 테스트는 그대로 둔다.

### [high/S] 10 일정 편집 (ScheduleEditScreen): 상태 알림 때문에 레이아웃이 밀림
- 문제: '다시 계산하는 중' 칩(높이 22 + Body gap 12 = 약 34px), 오류 Notice, '편집 뒤 제외 스팟이 생겼습니다' Notice가 모두 목록 위에 끼어든다. 편집할 때마다 150ms 디바운스 뒤 칩이 나타났다 사라져서 목록과 펼친 도구 카드가 34px씩 위아래로 움직인다. '15분 늘리기'를 연달아 누르면 손가락 아래 버튼이 바뀌어 엉뚱한 버튼(예: 날짜 Choice)을 누를 수 있다. 아래로 스크롤한 상태에서 적용이 실패하면 오류는 화면 밖 위쪽에 떠서, 버튼이 아무 일도 하지 않은 것처럼 보인다.
- 제안: 상태를 높이가 고정된 곳으로 옮긴다. (a) 계산 중 표시는 헤더 둘째 줄에 붙인다: `10월 18일 (일) · 4곳 · 5시간 17분 · 계산 중`(clock 아이콘). 화면 맨 아래의 `N곳 · 시간` 줄은 이 헤더 줄로 합치고 지운다. (b) 적용 실패는 useUi.getState().showToast(reason, 'warn')로 띄운다. 위쪽 오버레이라 터치를 막지 않고 스크롤 위치와 상관없이 보인다. (c) '편집 뒤 제외 스팟' 안내는 Foot 안, 버튼 바로 위로 옮긴다. 고정 영역이라 목록이 밀리지 않고 되돌리기 버튼과 붙는다. 오프라인 Notice는 들어올 때 정해지므로 위에 그대로 둔다.
- 파일: test/src/screens/ScheduleEditScreen.tsx
- 테스트 영향: 없다. 10 화면 소스를 보는 테스트가 없다. wp4-screens의 newlyExcludedLines 테스트는 그대로다.

### [high/S] 10 일정 편집: 수용량 초과 조정안(WarnCard)과 '빼기'
- 문제: 06·09에서 조정안을 보러 들어온 사람이 찾는 WarnCard가 스팟 카드 목록과 펼친 도구 카드(약 360px) 아래, 맨 끝에 있다. 7곳짜리 날이면 폰 첫 화면에 보이지 않는다. 또 '조정안 3 · 동궁과 월지 빼기'는 한 번 누르면 바로 spot/remove가 나간다. inverseDrafts가 null을 돌려줘 되돌리기 목록에 들어가지 않고, newlyExcludedLines는 userRemoved를 걸러 내서 안내도 없다. 스팟이 조용히 사라지고, 어디서 되살리는지 알려 주지 않는다.
- 제안: (a) day.overMin > 0이면 WarnCard를 Body 맨 위(상태 줄 바로 아래, 목록 앞)로 옮긴다. 목업 10 순서와는 다르지만 이 화면에 들어온 이유가 이것이라 먼저 보여 준다. (b) kind === 'exclude' 조정안은 DS 규칙(삭제는 quiet + ConfirmSheet 1회)대로 ConfirmSheet를 한 번 띄운다. title '동궁과 월지를 빼요', text '제외 스팟으로 옮겨요. 후보 > 제외 스팟에서 되돌릴 수 있어요.', confirmLabel '빼기'. 적용한 뒤에는 같은 내용을 토스트로 알린다. 체류 줄이기와 날짜 옮기기 조정안은 되돌릴 수 있으므로 지금처럼 바로 적용한다.
- 파일: test/src/screens/ScheduleEditScreen.tsx
- 테스트 영향: 없다. wp4-screens의 'spot/remove는 inverseDrafts null' 테스트는 이 동작의 근거이므로 그대로 둔다.

### [high/M] 10 일정 편집: 순서 바꾸기
- 문제: FR-503에서 가장 흔한 편집인 순서 바꾸기가 두 단계다. 카드를 누른 뒤 아래에 펼쳐진 도구 카드에서 '앞으로/뒤로'를 찾아야 한다. 카드마다 'drag' 손잡이 아이콘이 있어 끌어서 옮길 수 있을 것 같지만 끌기는 없다. 선택했을 때 칩 이름이 '옮기는 중'이라, 체류만 바꾸려는 사람에게 틀린 상태를 알린다. '자동 순서로 되돌리기'는 목록 맨 아래에 따로 떨어져 있다.
- 제안: 카드 오른쪽에 40px IconBtn 두 개(위·아래)를 늘 보이게 둔다. accessibilityLabel은 '불국사 앞으로'/'불국사 뒤로'이고, 처음·끝 카드에서는 disabled다. 누르면 바로 지금의 move(-1|1)로 reorder한다. drag 아이콘은 지우고 그 자리에 순서 번호(1·2·3, 09 타임라인과 11 지도 핀 번호와 같은 값)를 둔다. 카드 본문을 누르면 나머지 도구(체류·도착·날짜·고정)가 펼쳐진다. 칩은 '편집 중'으로 바꾸거나 없애고 selected 테두리와 accessibilityState {expanded}로 표시한다. 목록 위 한 줄에 순서 상태를 둔다: '순서 · 이동 짧은 순' 또는 '순서 · 직접 정함', 오른쪽에 링크형 버튼 '자동 순서로'(맨 아래 Btn을 이리로 옮김). 360px에서 이름 칸은 카드 안쪽 280 − 아이콘 80 − 번호 24 ≈ 160px로 충분하다.
- 파일: test/src/screens/ScheduleEditScreen.tsx, test/src/ui/Icon.tsx
- 테스트 영향: wp4-screens의 moveInOrder·editOrder 테스트는 그대로다. 아이콘 이름 목록을 고정하는 테스트는 없다. Icon.tsx에 'up'·'down' 꺾쇠를 추가하는데, 이 파일은 FOUNDATION 소유이고 git에서 이미 수정됨 상태라 커뮤니티 작업과 합칠 때 주의해야 한다.

### [medium/M] 10 일정 편집: 펼친 도구 카드(체류·도착·날짜·고정)
- 문제: 펼친 도구 카드는 라벨 4개와 버튼 줄 5개라 약 360px다. 스팟 하나를 고치는 데 화면 절반을 쓴다. '15분 줄이기/15분 늘리기'처럼 한 가지 값을 두 버튼으로 나눴고, 바뀐 값은 작은 라벨에만 보인다. '10:25 도착 고정'과 스팟 '고정'(제외되지 않음, 용어집의 '고정')이 한 줄에 나란히 있어 두 '고정'이 헷갈린다. 날짜 지정은 여행 길이에 따라 모양이 바뀐다. 5칸 이하는 Choice(선택 = 잉크 테두리)이고, 6칸 이상은 DateScroll(선택 = 연두 면에 흰 글씨)이라 DS의 '선택은 ink' 규칙에 어긋난다. 4일 여행(자동 + 4칸 = 5칸)이면 360px에서 칸 폭이 (280 − 32) / 5 ≈ 50px인데 '10/17' 글자와 좌우 여백 20을 더하면 약 58px라 줄이 바뀐다. 390px에서도 56px라 빠듯하다.
- 제안: 한 줄 스테퍼로 줄인다. 새 컴포넌트 features/schedule/components/Stepper.tsx는 왼쪽 라벨, 가운데 값, 오른쪽 IconBtn [−][+]로 되어 있다. 줄 1은 '체류 90분 [−][+]'. 줄 2는 '도착 10:25 · 자동 [−][+]'이고, 지정했으면 '도착 10:40 · 지정됨'과 오른쪽 작은 링크 '지정 풀기'를 둔다. 자정을 넘긴 경우의 긴 설명 문장은 한 줄로 줄인다. 줄 3은 '날짜'와 가로 스크롤 칩 줄(자동 · 10/17 · …)이다. Choice와 DateScroll 분기를 없애고 늘 가로 스크롤에 잉크 선택(Choice 모양)으로 통일한다. Choice에 scroll 옵션을 추가하거나 DateScroll의 모양만 Choice에 맞춘다. 줄 4는 '고정 · 빠지지 않아요' 토글(pinlock)이다. '도착 고정'이라는 말은 '도착 시각 지정'으로 바꿔 용어 '고정'과 겹치지 않게 하고, 카드 칩도 '10:40 도착 지정'으로 바꾼다. 이렇게 하면 높이가 약 200px가 된다.
- 파일: test/src/screens/ScheduleEditScreen.tsx, test/src/features/schedule/components/Stepper.tsx, test/src/ui/Icon.tsx, test/src/ui/Field.tsx
- 테스트 영향: wp4-screens의 stepStay·stepArrive·canPinArrive 테스트는 그대로다. '도착 고정' 문구를 고정하는 테스트는 없다. Stepper.tsx는 기존 'src/features/schedule/**' 글롭에 걸리므로 ownership.json을 바꿀 필요가 없다. 'minus' 아이콘을 추가한다(FOUNDATION 파일).

### [medium/S] 10 일정 편집: 되돌리기 위치와 결과 알림
- 문제: 되돌리기는 오른쪽 위의 작은 글자 링크라 한 손으로 닿기 어렵다. 그래서 안내문이 '오른쪽 위 되돌리기를 누르세요'라고 위치까지 설명해야 한다. 무엇을 되돌리는지(마지막 편집)도 보이지 않는다. 날짜를 바꾸면 그 카드는 재계산 뒤 목록에서 사라질 뿐, 어디로 갔는지 알려 주지 않는다. 반면 하단 Foot은 즉시 저장이라 하는 일이 '시간표로' 하나뿐인데 넓은 자리를 차지한다.
- 제안: Foot을 버튼 두 개 한 줄로 바꾼다. 왼쪽은 Btn variant='quiet' icon='undo' '되돌리기'로, undo가 비면 disabled이고 accessibilityLabel에 마지막 label('불국사 날짜 되돌리기')을 넣는다. 오른쪽은 primary '시간표로'다. 헤더의 되돌리기 링크는 지운다. 제외 안내 문구는 '아래 되돌리기를 누르면 돌아가요'로 바꾼다. 날짜 옮기기, 조정안 적용, 빼기처럼 카드가 사라지는 편집은 apply 뒤 토스트로 알린다(예: '불국사를 10/19로 옮겼어요'). 체류·도착처럼 그 자리에서 값이 보이는 편집은 토스트를 띄우지 않는다(연달아 누를 때 시끄럽지 않게).
- 파일: test/src/screens/ScheduleEditScreen.tsx
- 테스트 영향: 없다. wp4-screens의 inverseDrafts 테스트는 그대로다.

### [medium/S] 08 루트 계산 (PlanningScreen)과 09 '다시 계산'
- 문제: 08의 보조 버튼은 '후보로 돌아가기(계산은 계속됩니다)'다. 그런데 08로 들어오는 곳은 09 시간표, 11 지도, 19 여행 진행뿐이고, back()은 goBack이라 실제로는 그 화면으로 돌아간다. 버튼 말과 결과가 다르다. 09의 '다시 계산'은 타임라인 맨 아래의 12px 링크인데, 누르면 전체 화면 08로 보낸 뒤 '시간표 보기'를 다시 누르게 한다. 편집은 어차피 150ms 뒤 자동으로 다시 계산되므로 이 왕복은 대부분 필요 없다. 09의 '다시 계산하는 중 · 단계 보기' 줄도 칩과 12px 글자라 누르는 영역이 작다. 08 단계 행은 완료·진행·대기를 아이콘과 색으로만 보여 줘서 스크린리더가 상태를 읽지 못한다.
- 제안: (a) 08 보조 버튼 문구를 '이전 화면으로'로 바꾸고, 계산 중이면 '이전 화면으로(계산은 계속돼요)'로 쓴다. back 동작은 그대로다. (b) 09의 '다시 계산'은 화면을 떠나지 않고 useTrips.getState().recompute(trip.id)를 부른다. 진행을 보고 싶은 사람만 위쪽 요약 줄의 '계산 중' 칩(발견 8)을 눌러 08로 간다. 계획이 아직 없을 때의 첫 '루트 계산'은 지금처럼 08로 보낸다. (c) 08 단계 Row에 accessibilityLabel `${label}, 완료|진행 중|대기`를 단다.
- 파일: test/src/screens/PlanningScreen.tsx, test/src/screens/ScheduleScreen.tsx
- 테스트 영향: 없다. 문구나 화면 소스를 고정하는 테스트가 없다. wp4-screens의 planningStepRows·planningProgress 테스트는 그대로다.

### [medium/M] 09 시간표: 하루 요약과 상태 줄
- 문제: 하루 요약(daySummary '4곳 · 09:00–14:17 · 초과')이 타임라인 맨 아래 12px 글자로 묻혀 있다. 그 아래에는 '경로 조회 6건 · 캐시 4건 · 자동차 기준' 같은 개발용 숫자가 여행자에게 보인다. 게다가 planMeta는 trip.transport만 읽어서, 그날을 '하루 전체 적용'으로 도보로 바꿔도 '자동차 기준'이라고 틀리게 말한다. '제외 스팟 3곳'은 글자뿐이라 누를 수 없다. 머리 주석에 적힌 '예시 데이터' 칩은 sample 변수만 만들고 그리지 않는다. 오프라인 Notice, 계산 중 줄, 초과 경고가 겹치면 세 겹으로 타임라인을 밀어낸다. 날짜별 활동시간과 기점을 바꾸는 여행방 설정은 지금 채팅 화면에서만 들어갈 수 있다.
- 제안: 날짜 Seg 바로 아래, 스크롤되지 않는 위쪽 블록에 요약 줄 하나를 고정한다(목업 09 위쪽 바처럼). 왼쪽에 '4곳 · 09:00–14:17'(nm)을 둔다. 오른쪽 칩은 그날 수단('도보', trip.days 덮어쓰기 반영), 로컬 경로면 '예시 데이터'(line), 계산 중이면 '계산 중'(clock, 누르면 08), 오프라인이면 '오프라인'이다. 그 아래에 얇은 채움 막대(usedMin / (endLimitMin − startMin), 초과면 warn)와 오른쪽 끝 '활동 09:00–21:00'을 둔다. 이 글자를 누르면 TripSettings로 간다. 맨 아래 메타 블록은 지운다. 경로 조회·캐시 줄은 08에만 남기고, '제외 스팟 3곳'은 ListRow 모양 링크로 바꿔 후보 탭(06)으로 보낸다. 선택 사항으로 요약 줄에 '지도' IconBtn을 두어 navigate('Main', {screen:'Map', params:{date}})로 보낼 수 있다. 다만 MapScreen은 date를 useState 초깃값으로만 읽어서 탭이 이미 열려 있으면 날짜가 바뀌지 않으므로, WP5 쪽에 params 변화를 받는 effect가 필요하다.
- 파일: test/src/screens/ScheduleScreen.tsx, test/src/features/schedule/view.ts
- 테스트 영향: 새 순수 도우미(그날 수단: 날짜 덮어쓰기 우선, 채움 비율 0~1)를 view.ts에 두고 tests/wp4-screens.test.ts에 케이스를 추가한다. planMeta를 고정하는 기존 테스트는 없다. 08도 planMeta를 쓰므로 08 문구가 그날 수단으로 바뀌는지 웹 확인 때 함께 본다.

### [medium/S] 09 타임라인 카드 (DayTimeline, 19 여행 진행도 같이 씀)
- 문제: 스팟 카드의 보조 줄 '09:25 – 10:55 · 90분'은 왼쪽 시각 열의 도착 시각을 한 번 더 적고, 정작 출발 시각은 시각 열에 없다. 카드마다 '제안자 N' 칩이 붙어 시간표 읽기와 상관없는 정보가 오른쪽 자리를 차지한다. 360px에서 카드 안쪽은 312 − 86(시각 열·축) − 24(패딩) ≈ 202px이고, 칩(약 66px)을 빼면 이름 칸이 약 125px라 '교촌마을 한정식' 정도의 이름도 줄바꿈 직전이다. 19 여행 진행은 이 타임라인을 Card 안에 한 번 더 넣어서 이름 칸이 약 95px까지 줄어든다. 카테고리(식당·관광지)는 보이지 않는다.
- 제안: 목업 09처럼 시각 열을 두 줄로 바꾼다. 위에 도착(time, 굵게), 아래에 출발(mtTight, muted)을 둔다. 카드 보조 줄은 '관광지 · 체류 90분'으로 바꾼다. category는 DayTimeline이 이미 받는 trip.spots에서 꺼낸다(지금은 void trip으로 버리고 있다). '제안자 N' 칩은 지우고 오른쪽에는 상태만 둔다: 고정(pinlock)과 방문 상태. 이름 앞에 작은 순서 번호 배지(1·2·3)를 두어 11 지도 핀 번호, 10의 순서 번호와 맞춘다.
- 파일: test/src/features/schedule/components/DayTimeline.tsx, test/src/features/schedule/timeline.ts
- 테스트 영향: wp4-timetable의 timelineRows 테스트는 kind·time·minutes만 비교하므로 필드를 추가해도 깨지지 않는다. spot 행 category 단언을 하나 더하면 좋다. 19 LiveTripScreen 화면은 웹 확인 때 함께 본다.

### [medium/M] 09 이동 줄과 하루 전체 이동수단
- 문제: 이동수단을 바꾸는 유일한 입구인 이동 줄은 14px 아이콘과 12px 글자에 hitSlop 6이라, 누를 수 있는 높이가 약 28px이고 폭은 글자 길이뿐이다(권장 44px 미만). 누를 수 있다는 표시(꺾쇠 등)도 없어 대부분 모르고 지나간다. '이날 전체를 도보로' 같은 하루 단위 변경은 아무 구간이나 눌러 12에 들어간 뒤 '하루 전체 적용'을 골라야만 할 수 있다.
- 제안: (a) 이동 줄을 축 오른쪽 전체 폭의 Pressable(minHeight 44)로 키우고, 오른쪽 끝에 'right' 꺾쇠 아이콘(muted, 14px)을 둔다. onPressLeg가 없는 19 여행 진행은 지금 그대로다(꺾쇠 없음). (b) 10 일정 편집 위쪽(초과 WarnCard 바로 아래)에 '이날 이동수단' Choice(자동차·도보·대중교통)를 둔다. 누르면 apply('이날 이동수단', dayTransportDrafts(trip, date, t))를 부른다. inverseDrafts가 setDayTransport와 setLegTransport를 이미 되돌리므로 되돌리기도 그대로 된다. 구간마다 다른 수단은 계속 12에서 정한다.
- 파일: test/src/features/schedule/components/DayTimeline.tsx, test/src/screens/ScheduleEditScreen.tsx
- 테스트 영향: wp4-screens의 dayTransportDrafts와 inverseDrafts 왕복 테스트가 이미 이 경로를 덮는다. qa-decisions의 '여행방 기본 수단은 자동차·도보'는 여행방 기본값 이야기라 날짜 단위 선택은 12와 같은 세 칸을 써도 충돌하지 않는다.

### [medium/S] 12 이동수단 비교 (LegTransportScreen): 적용 버튼과 미리보기
- 문제: 한 구간을 눌러 들어왔는데 주(연두) 버튼은 '하루 전체 적용'이고 '이 구간만'은 보조다. '하루 전체 적용'은 그날 다른 구간 지정까지 모두 푼다(dayTransportDrafts). 더 큰 변경이 기본 버튼인 셈이다. 지금 수단을 그대로 둔 상태(choice === 현재)에서도 두 버튼이 켜져 있어, 누르면 아무것도 바꾸지 않고 뒤로 간다. dispatchMany가 실패하면(r.ok false) 아무 반응이 없고, 성공해도 09로 돌아갈 뿐 무엇이 바뀌었는지 말해 주지 않는다. 미리보기는 11.5px 문단 두 개라 '+58분, 1곳 제외' 같은 핵심 숫자가 문장에 묻힌다. '이 구간만'은 동사가 없다(DS: 버튼은 동사로 끝낸다).
- 제안: Foot을 위계대로 바꾼다. 주 버튼(전체 폭)은 '이 구간만 도보로 바꾸기', 그 아래 보조는 quiet sm '이날 전체를 도보로'다. choice === ends.transport면 둘 다 disabled로 하고 미리보기 카드에 '지금 이 구간은 자동차예요'를 보인다. 미리보기 카드는 두 줄 표로 바꾼다: '이 구간만' | 칩 '+58분'·'1곳 제외', '이날 전체' | 칩. 그 아래 previewSentence 전문은 note로 한 번만 둔다. 적용에 성공하면 '불국사–석굴암 구간을 도보로 바꿨어요' 토스트를 띄우고, 실패하면 r.reason을 warn 토스트로 띄우고 화면에 머문다.
- 파일: test/src/screens/LegTransportScreen.tsx, test/src/features/schedule/view.ts
- 테스트 영향: previewSentence 정규식 테스트(/^도보로 바꾸/)는 문장을 그대로 두면 유지된다. 차이 칩 도우미(deltaChip과 같은 형식)를 view.ts에 만들면 wp4-screens에 케이스를 추가한다.

### [low/S] 12 이동수단 비교: 구간 넘기기와 헤더
- 문제: 위에 '구간 2 / 6'이 보여 페이지처럼 넘길 수 있을 것 같지만, 이전·다음 구간으로 가는 방법이 없다. 하루의 여러 구간을 도보로 바꾸려면 12, 뒤로, 09에서 다음 이동 줄 찾기, 다시 12를 구간 수만큼 되풀이해야 한다. 헤더도 공통 Header가 아니라 직접 그린 3단(뒤로·구간 수 / eyebrow / 제목)이라 다른 상세 화면과 모양이 다르다.
- 제안: '구간 2 / 6' 양옆에 IconBtn 'back'·'right'를 둔다. accessibilityLabel은 '이전 구간'/'다음 구간'이고 끝이면 disabled다. legIndexes(day)로 이웃 legIndex를 찾아 navigation.setParams({ legIndex })로 넘기고, 구간이 바뀌면 picked를 초기화한다. 헤더는 Header(back, eyebrow, title, size='sm', right=구간 넘김 묶음)로 바꿔 다른 화면과 맞춘다.
- 파일: test/src/screens/LegTransportScreen.tsx
- 테스트 영향: wp4-screens의 legIndexes·legPositionText 테스트는 그대로다. 새 테스트는 필요 없다.

## 지도·길찾기·여행 진행 (11 MapScreen · 13 NavigateScreen · 27 DirectionsScreen · 19 LiveTripScreen · features/live · components/map/parts)

**주요 흐름**
- 오늘 루트 한눈에 보기: 지도 탭에서 날짜를 골라 핀 순서, 이동·체류 시간, 수단을 확인한다 (11)
- 스팟 확인·정리: 핀이나 목록 줄을 눌러 스팟 정보와 도착 예정 시각을 보고, 제외 스팟 사유를 보고 되돌린다 (11 → 07)
- 계획 구간 따라가기: 다음 스팟까지 안내 줄, 거리, 도착 시각을 보고 이전·다음 구간을 넘기거나 카카오맵으로 넘긴다 (11·19·홈 → 13)
- 아무 두 지점 길찾기: 출발·도착을 검색, 내 위치, 지도, 기점, 여행방 스팟 가운데서 고르고 자동차·대중교통·도보를 견준 뒤 카카오맵으로 연다 (11·07 → 27)
- 내 위치 보기: 지도 오른쪽 아래 버튼으로 내 자리로 옮기고 따라가기를 켜고 끈다 (11·27)
- 여행 당일 진행 시작: 날짜를 고르고 진행 방식(기기 위치, 수동, 시뮬레이터)을 골라 시작한다 (19)
- 진행 중: 지금 머무는 스팟과 다음 스팟의 예상 도착을 보고, 도착 처리·도착 취소를 하고, 지연 조정안을 적용하거나 원래대로 두고, 빈 시간 추천과 시간표를 본다 (19)
- 시연: 시뮬레이터를 재생·일시정지하고 배속, 프리셋, 시각 점프를 바꾼다 (19)
- 진행 끝내기 → 기록 지도·사진으로 넘어간다 (19 → 22·20)

### [high/M] 19 여행 진행 · 진행 중 배치
- 문제: 진행 중에 지금 할 일(다음 스팟, 예상 도착, '도착 처리', 구간 안내)이 맨 아래쪽에 있다. 위에는 큰 머리말(뒤로 줄, eyebrow, 22px 제목, 여행방 이름까지 약 144px), 240px 지도, OSM 출처 줄, 안내 상자들이 먼저 나온다. 375×667에서 시뮬레이터 띠와 '스팟 도착' 카드가 함께 있으면 '다음 스팟' 카드의 버튼이 약 700px 아래로 밀려 스크롤해야 보인다. 수동 진행에서 가장 많이 누를 '도착 처리'가 엄지가 닿는 자리 밖에 있다. 또 스크롤되는 본문 안에 들어 있는 240px 카카오 지도(draggable)가 한 손가락 끌기를 지도 이동으로 가져가서, 화면 대부분에서 페이지 스크롤이 막힌다.
- 제안: (1) Header를 size="sm"으로 줄이고 eyebrow를 '여행 진행 · {여행방 이름}'으로 합친다. sub는 빼고 제목은 날짜로 둔다. (2) 본문 맨 위에 '지금' 카드 하나를 둔다. 도착해 있으면 '{스팟} 도착 · 14:05부터 머무는 중 [도착 취소]', 아니면 '다음 · {스팟}'과 계획·예상 시각, 지연 칩을 보여 준다(지금의 current 카드와 timing 카드를 합친다). (3) 화면 아래에 ui Foot을 고정하고 버튼 두 개를 둔다: [구간 안내](quiet), [도착 처리](수동 진행이거나 정확도를 모르면 primary, 아니면 quiet). timing===null이면 Foot에 '오늘 일정을 모두 마쳤어요'와 [기록 지도]를 둔다. (4) 지도는 '지금' 카드 아래로 내리고 높이를 200으로 줄인다. 또는 compact 미리보기로 바꾸고 '지도 크게 보기'를 누르면 navigate('Main', { screen: 'Map', params: { date } })로 보낸다. 이렇게 하면 스크롤을 가로채는 일이 줄어든다. (5) 그 아래 순서: 조정안으로 뺀 스팟 → 빈 시간 추천 → 시간표 → 시뮬레이터 조작 → 백그라운드 기록 → 진행 기록 → 끝내기.
- 파일: test/src/screens/LiveTripScreen.tsx, test/src/features/live/components/LiveNowCard.tsx (새 파일, ownership의 src/features/live/** 글롭에 이미 포함)
- 테스트 영향: LiveTrip 배치를 고정한 소스 규칙 테스트는 없다. wp5-delay(src/features/live와 LiveTripScreen에서 금지 문구 '늦었습니다·지연되었습니다·서두르세요' 검사)와 foundation-design-rules(Txt만 사용, 토큰 색, LiveTrip은 E.float 허용 목록에 있음)만 다시 확인하면 된다. 원하면 tests/wp5-live-layout.test.ts를 새로 만들어 '도착 처리'가 Foot 안에 있는지 소스 규칙으로 고정한다.

### [high/M] 11 지도 탭 · 하단 시트
- 문제: 목록 펼치기·접기 손잡이는 38×4px짜리 Pressable 하나라서 사실상 누를 수 없다(role도 없다). 대신 쓰는 'list' IconBtn은 시트가 아니라 지도 오른쪽 위에 투명 바탕(면·그림자 없음)으로 떠 있어서, 지도 타일 위에서 잘 안 보이고 엄지에서도 멀다. 접힌 시트에 날짜 Seg, 제목·요약, OSM 출처, 스팟 3줄, '이후 N곳', 버튼 두 개, '제외 스팟 N곳'이 모두 들어가 높이가 약 320px다. 375×667에서 지도는 위쪽 칩 줄을 빼면 약 220px로, 화면의 1/3밖에 안 된다. 펼친 높이는 460으로 고정이라 작은 폰에서는 지도가 100px 안팎으로 줄어든다. 접힌 상태의 '제외 스팟 N곳'은 누를 수 없는 글자다. 여행 진행 중이어도 지도 탭에서는 진행 상태가 보이지 않는다.
- 제안: (1) 손잡이, '첫째 날 루트' 제목·요약, 오른쪽 chevron 아이콘을 한 Pressable(minHeight 44, accessibilityRole button, accessibilityState expanded)로 묶어 펼치기·접기를 맡긴다. 지도 위 'list' IconBtn은 지운다. (2) 접힌 상태에는 날짜 Seg, 머리 줄, 버튼 줄만 둔다. 머리 줄 요약에 수단을 합친다: '자동차 · 이동 1시간 20분 · 체류 5시간'. 스팟 순서는 핀 번호로 이미 보이므로 스팟 목록과 제외 스팟은 펼쳤을 때만 보인다. OSM 출처는 라이선스 표기라서 지우지 않고 시트 맨 끝 한 줄로 옮긴다. 이렇게 하면 접힌 높이가 약 200px로 줄고 지도가 약 120px 커진다. (3) 이 여행방이 진행 중이면 '여행 진행' 버튼 자리에 한 줄 '진행 중 · 다음 첨성대 · 예상 14:20'을 둔다. useLive timing과 etaView를 그대로 쓰고, 누르면 19로 간다. (4) 접힌 상태의 '제외 스팟 N곳'은 펼치는 Btn(quiet, sm)으로 바꾼다. (5) 펼친 최대 높이는 고정 460 대신 onLayout으로 잰 화면 높이의 60%로 둔다.
- 파일: test/src/screens/MapScreen.tsx
- 테스트 영향: wp5-my-location '화면: 11 지도 탭과 27 길찾기에 버튼을 켜고…'가 `<MapCanvas[\s\S]*?\n\s+locate\n`를 본다. 그래서 locate prop은 계속 따로 한 줄에 둬야 한다. 그 밖에 MapScreen 배치를 고정한 테스트는 없다. wp5-delay 금지 문구 검사와 foundation 규칙만 다시 확인한다.

### [high/S] 11 지도 탭 · 19 여행 진행 · 날짜 고르기
- 문제: 두 화면 모두 날짜 Seg를 가로 스크롤 없이 칸 사이 28px로 늘어놓는다. 11은 '전체'와 날짜 5개(5일 여행)부터 너비가 약 350px로, 360·390 폭의 안쪽(312·342px)을 넘는다. 19는 스팟이 있는 날이 6일 이상이면 넘친다. 넘친 날짜는 화면 밖으로 잘려서 고를 수 없다(여행은 최대 14일까지이고, 확인을 거치면 그보다 길 수 있다). 이미 ScheduleScreen과 DateSeg는 가로 스크롤로 감싸 두었으니 같은 패턴인데 이 두 화면만 빠졌다. 또 11은 지도 위 왼쪽 날짜 칩이 아래 Seg와 같은 정보를 한 번 더 보여 준다.
- 제안: Seg를 ScheduleScreen과 DateSeg처럼 `<ScrollView horizontal showsHorizontalScrollIndicator={false}>`로 감싸고, 날짜를 고르면 그 칸이 보이도록 scrollTo한다. 11 지도 위의 날짜 칩과 수단 칩은 뺀다(수단은 시트 요약 줄로 옮긴다). 지도 위에는 길찾기 버튼과 내 위치 버튼만 남긴다.
- 파일: test/src/screens/MapScreen.tsx, test/src/screens/LiveTripScreen.tsx
- 테스트 영향: 영향받는 테스트는 없다(ui Seg는 그대로 둔다). 회귀 방지용으로 tests/wp5-date-seg.test.ts를 새로 만들어, 두 화면의 `<Seg`가 `ScrollView horizontal` 안에 있는지 소스 규칙으로 고정하기를 권한다.

### [high/M] 19 여행 진행 · 시작 전
- 문제: 더보기에서 '기기 위치 사용'이 꺼져 있으면 '기기 위치로 시작'이 이유 없이 회색으로 죽어 있다. 실제 여행자는 왜 못 누르는지, 어디서 켜는지 모른다. 오늘이 여행 날이어도 '여행 시뮬레이터로 재생'이 늘 가장 큰 primary라서, 시연용 기능이 실제 진행보다 앞에 온다. 360px에서 카드 안 버튼 칸은 약 135px인데 '기기 위치로 시작'(아이콘 포함)은 약 150px라 두 줄로 꺾인다(390px에서도 거의 꽉 찬다). 시작 전인데도 아래에 SimControls 카드(재생 전, 재생 버튼, 배속 Seg, 프리셋 9개, 시각 점프)가 나와서 위의 '시뮬레이터로 재생'과 같은 일을 두 번 보여 주고 화면만 길어진다. 게다가 시작 카드가 240px 지도 아래에 있어 작은 화면에서는 아래 끝에 걸린다.
- 제안: (1) '어떻게 진행할까요'를 날짜 Seg 바로 아래, 지도 위로 올린다. (2) 버튼 3개 대신 ListRow 3줄로 바꾼다. 줄마다 아이콘, 이름, 한 줄 sub가 있고 누르면 바로 시작한다: '기기 위치로 진행 · 도착을 자동으로 기록해요', '수동으로 진행 · 도착을 직접 눌러요', '시뮬레이터로 재생 · 실제 위치가 아니에요'. 오늘이 여행 기간 안이면 기기 위치 줄을 맨 위에, 아니면 시뮬레이터 줄을 맨 위에 둔다. (3) 기기 위치가 꺼진 채로 그 줄을 누르면 ConfirmSheet를 띄운다(제목 '기기 위치를 쓸까요?', 본문 '도착을 자동으로 기록하려면 기기 위치가 필요해요. 위치는 이 기기에서만 써요.', 확인 '기기 위치 켜고 시작'). 확인하면 useSession.getState().setUseDeviceLocation(true)를 부른 다음 L.start(tripId, date, 'device')를 부른다. (4) 시작 전에는 SimControls를 숨긴다. 프리셋은 시뮬레이터 줄 아래 접힌 '프리셋' Tag 줄로만 둔다.
- 파일: test/src/screens/LiveTripScreen.tsx, test/src/features/live/components/SimControls.tsx
- 테스트 영향: 시작 카드의 문구나 배치를 고정한 테스트는 없다. store/live의 invalidReason은 기기 위치 진행 중에 '기기 위치 사용'이 꺼지면 진행을 끝낸다. 그러므로 설정을 먼저 켜고 그다음에 start해야 이 규칙과 충돌하지 않는다. 다른 테스트에는 영향이 없다.

### [medium/S] 11·13·19·27 공통 · '길찾기'와 '구간 안내' 이름
- 문제: '길찾기'라는 이름이 서로 다른 두 기능을 가리킨다. 11 지도 위 '길찾기'는 27(아무 두 지점)로 간다. 그런데 19 다음 스팟 카드의 '길찾기' 버튼과 홈 빠른 메뉴 '길찾기'는 13(계획 구간 안내)으로 가고, 13 머리말도 '길찾기 · 10/18 (토)'다. 같은 지도 탭 시트에서는 같은 13을 '구간 안내'라고 부른다. 그래서 사용자는 어떤 버튼이 어디로 가는지 예측할 수 없다. 또 11의 '길찾기'는 누를 수 없는 배지(Chip, DS Badge)를 Pressable로 감싼 것이라 버튼처럼 보이지 않는다. 카카오 링크라는 같은 동작도 13은 '지도 앱으로 열기', 27은 '카카오맵으로 열기'라고 부른다.
- 제안: 13은 어디서나 '구간 안내'로 부른다: 13 eyebrow '구간 안내 · 10/18 (토)', 19 버튼 '구간 안내', routes.ts SCREEN_META.Navigate 제목, 홈 메뉴 칸 이름. 홈 메뉴는 WP1 파일이라 그쪽과 맞춘다. '길찾기'라는 이름은 27에만 쓴다. 11 지도 위 길찾기는 Chip 대신 떠 있는 알약 버튼으로 바꾼다: Pressable, minHeight 44, R.chip, surfaceC.card, E.float, nav 아이콘과 '길찾기'. 카카오 링크 버튼은 두 화면 모두 '카카오맵으로 열기'로 맞춘다.
- 파일: test/src/screens/NavigateScreen.tsx, test/src/screens/LiveTripScreen.tsx, test/src/screens/MapScreen.tsx, test/src/navigation/routes.ts, test/src/features/account/home.ts (WP1, 이름만 맞춤)
- 테스트 영향: 이 문구들을 고정한 테스트는 없다. wp1-home '길찾기 칸은 활성이다'는 navigate 칸의 disabled 값만 보므로 테스트 이름만 바꾸면 된다. E.float는 MapScreen이 FLOAT_ALLOWED에 들어 있어 허용된다.

### [medium/S] 13 구간 안내 · 27 길찾기 · 아래 버튼 줄
- 문제: 13의 primary 버튼 '안내 시작'은 실제로 안내를 시작하지 않고 19 화면을 열 뿐이다. 거기서 진행 방식을 다시 골라야 한다. 이미 여행 진행 중(liveHere)일 때도 그대로 보여서, 같은 19 화면을 또 쌓는다. 27의 '안내 시작'은 진행 중일 때만 보이는데, 누르면 방금 고른 A→B 경로와 상관없는 19로 간다. 또 27은 진행 중이 아니면 primary 버튼이 아예 없다. 실제로 할 수 있는 다음 행동인 '카카오맵으로 열기'는 quiet이고, 끝점을 고르기 전에는 회색 비활성 버튼이 자리만 차지한다.
- 제안: 27: 경로가 준비되면 '카카오맵으로 열기'를 전체 폭 primary로 둔다. 준비 전에는 버튼 줄을 숨긴다. 진행 중이면 그 아래에 quiet '여행 진행으로 돌아가기'(19)를 둔다. 13: 진행 중(liveHere)이면 '안내 시작'을 없애고 전체 폭 '카카오맵으로 열기' 하나만 둔다. 진행 중이 아니면 [카카오맵으로 열기](quiet)와 [여행 진행 시작](primary, 19로 감)을 두어 이름이 실제 결과와 맞게 한다.
- 파일: test/src/screens/DirectionsScreen.tsx, test/src/screens/NavigateScreen.tsx
- 테스트 영향: wp5-directions '화면 규칙: 두 끝이 정해진 뒤에만 경로를 묻고…'의 마지막 단언 `/\{liveTripId \? \(\s*<View style=\{\{ flex: 1 \}\}>\s*<Btn title="안내 시작"/`을 새 제목과 모양에 맞게 고친다. 원래 의도인 '진행 중일 때만 19로 가는 버튼'은 그대로 유지한다.

### [medium/M] 13 구간 안내
- 문제: '구간 2 / 5'와 이전·다음 버튼이 시트 가운데(목적지와 칩 아래, 안내 줄 위)에 끼어 있어서 목적지와 그 안내 줄을 갈라 놓는다. 번호만으로는 어느 구간인지도 알 수 없다. 여행 진행 중에 다음 스팟에 도착하고 다시 출발해도 화면은 처음 연 구간에 그대로 머문다(legIndex가 처음 값으로 고정). 홈 '길찾기'와 11 '구간 안내'는 늘 첫 구간(기점→1번)을 연다. 길 안내 화면인데 '내 위치' 버튼이 없어서, 진행 중이 아니면 내가 어디쯤에 있는지 볼 수 없다(11과 27에는 있다). 루트를 계산하기 전이면 '안내할 구간이 없습니다'만 나오고 다음 행동이 없는 막다른 화면이 된다.
- 제안: (1) 시트 첫 줄을 구간 머리로 바꾼다: [이전 IconBtn] '구간 2/5 · 석굴암까지'(nm) [다음 IconBtn]. 그 아래 순서는 '25분'(nmLg accent)과 '3.2km · 도착 10:40 · 예상 10:45', 칩, 안내 줄, 버튼이다. (2) liveHere이면 timing.spotId가 바뀔 때 toId가 같은 구간으로 따라간다. 사용자가 이전·다음을 직접 누른 뒤에는 따라가지 않는다(userPaged ref로 구분). 11과 19에서 13을 열 때도 진행 중이면 진행 중인 구간의 index를 넘긴다. (3) MapCanvas에 locate를 켠다. 진행 중이면 그 위치를 쓰므로 GPS를 따로 켜지 않는다. (4) 빈 상태의 Empty에 action '루트 계산'(Planning으로 감)을 더한다. 19 빈 상태와 같은 모양이다.
- 파일: test/src/screens/NavigateScreen.tsx, test/src/screens/MapScreen.tsx
- 테스트 영향: wp5-navigate-progress의 alongRef와 progressOnPath 정규식 세 줄은 건드리지 않는다. wp5-my-location '화면: 11 지도 탭과 27 길찾기에 버튼을 켜고…'의 버튼을 켜는 화면 목록에 NavigateScreen을 더해서 새 동작을 고정한다. 미리보기 지도에는 켜지 않는다는 의도는 그대로 둔다.

### [medium/M] 27 길찾기 · 출발·도착 고르기
- 문제: 출발·도착 줄(EndRow)의 Pressable 높이가 글자 높이(약 22px)뿐이다. 두 줄 사이도 1px 선과 6px 간격밖에 없어서 손가락으로 잘못 누르기 쉽다(권장 크기 44px 미만). 지도 탭에서 열면 도착이 비어 있으므로 '도착' 줄 → 시트 → 검색이나 스팟 순으로 최소 두 번은 눌러야 한다. 그동안 아래 시트에는 설명 문장 한 줄과 비활성 버튼만 보인다. DS 원칙 '설명 문장 없이'와도 맞지 않는다.
- 제안: (1) EndRow Pressable에 StyleSheet로 minHeight: H.fieldSm(44)와 justifyContent center를 준다. 줄 사이 구분선은 그대로 둔다. (2) 끝점이 비어 있으면 아래 시트를 비어 있는 쪽의 바로 고르기 목록으로 바꾼다. 목록에는 기점, 여행방 스팟(PickLine 최대 5개), '장소 검색'과 '지도에서 고르기' 줄을 둔다. 마지막 두 줄을 누르면 지금의 EndpointPicker를 그 쪽으로 열거나 지도 고르기 모드로 들어간다. 그러면 한 번 눌러 바로 경로 비교로 넘어간다. '내 위치'는 위치를 읽는 규칙 때문에 EndpointPicker 안에만 둔다.
- 파일: test/src/screens/DirectionsScreen.tsx
- 테스트 영향: wp5-directions의 소스 규칙을 모두 지켜야 한다: readLocationOnce는 한 번, pickMe 안에서만 부른다. `usesMe ? <Txt v="mtTight">{ME_NOTICE}</Txt> : null` 줄, reset 안의 locGuard.cancel, setTimeout 디바운스, `const anywhere = DIRECTIONS_SEARCH_ANYWHERE;`도 그대로 둔다. 바로 고르기 목록에서는 위치를 읽지 않는다. wp5-my-location의 '27에는 onUserMove·useMyLocation이 없다' 규칙도 유지한다.

### [medium/S] 19 여행 진행 · 끝내기
- 문제: '여행 진행 끝내기'를 누르면 확인 없이 바로 L.stop()이 불린다. 진행 기록 아래 작은 quiet 버튼이라 스크롤 끝의 '기록 지도'·'사진' 버튼 바로 위에 있어 잘못 누르기 쉽다. 누르는 순간 도착 판정, 조정안, 빈 시간 추천, 백그라운드 기록이 모두 멈추고 화면의 동선 점도 사라진다. 되돌릴 방법도 없다. DS 규칙('나가기 류는 quiet + ConfirmSheet 1회')과도 어긋난다.
- 제안: ConfirmSheet를 띄운다. 제목 '여행 진행을 끝낼까요?', 본문 '도착 기록과 동선은 기록 지도에 남고, 위치 확인과 조정안이 멈춰요.', 확인 버튼 '진행 끝내기'. 끝내기 버튼은 기록 지도·사진 줄과 떨어지도록 진행 기록 카드 아래 별도 구역에 둔다.
- 파일: test/src/screens/LiveTripScreen.tsx
- 테스트 영향: 없음. stop()은 track과 방문 기록을 지우지 않으므로 본문 문구가 사실과 맞다.

### [medium/M] 11 지도 탭 · 핀·목록 누르기
- 문제: 핀이나 목록 줄을 누르면 바로 07 스팟 상세 전체 화면으로 넘어가서 지도 맥락을 잃는다. 여러 스팟을 견주거나 '여기까지 어떻게 가지?'를 보려면 상세 → 뒤로 → 다른 핀을 계속 반복해야 한다. 목업 11은 핀을 고르면 아래 시트에 그 스팟을 보여 준다(순번, 이름, 주소, '09:25 도착'·체류·'숙소에서 25분' 칩, '일정에서 보기'). 목록 줄은 높이 약 22px라 손가락으로 누르기에도 작다.
- 제안: 핀이나 목록 줄을 누르면 그 스팟을 선택한다. 선택하면 시트 머리 아래에 선택 카드가 뜬다: 순번 원과 이름(nm), '도착 09:25 · 체류 1시간 30분 · 앞 구간 25분', 버튼 [상세 보기](quiet), [구간 안내](이 스팟까지의 구간), [여기까지 길찾기](27, toSpotId). 같은 핀을 다시 누르거나 x IconBtn을 누르면 선택이 풀린다. 선택한 스팟 쪽으로 fitTo(MapCanvas의 공개 prop)를 당긴다. 목록 줄은 minHeight 44로 키운다. ClusterListSheet에서 고른 스팟도 같은 선택 흐름으로 간다. FR-803('마커를 누르면 장소 정보와 도착 예정 시각')도 이 방식으로 더 직접 충족된다.
- 파일: test/src/screens/MapScreen.tsx, test/src/components/map/parts.tsx (주석의 '마커를 누르면 스팟 상세' 문구만 수정)
- 테스트 영향: 핀 → 상세 동작을 고정한 테스트는 없다. parts.tsx의 overlay StyleSheet pointerEvents, locateWrap, locateLabel 규칙(wp5-google-map, wp5-my-location)은 건드리지 않는다.

### [low/S] 19 여행 진행 · 상태 안내 상자
- 문제: 진행 상태를 알리는 안내 상자가 최대 5개(시뮬레이터 띠, 수동 진행 모드, GPS 신호 약함(긴 두 문장), 도착 자동 판정 안 함, 화면 밖 멈춤)까지 지도 위아래에 흩어져 쌓인다. 문장이 길고, '진행 방식'이라는 같은 정보를 여러 곳에서 말한다(DS: 상태는 짧은 한 줄). 또 시작 전에 다른 날짜를 골라도 시간표 제목은 '오늘 시간표'로 나온다.
- 제안: 머리말 바로 아래에 상태 줄 하나를 둔다. 왼쪽 Chip은 진행 방식('시뮬레이터 · 실제 위치 아님', '기기 위치', '수동 진행'), 오른쪽 Chip은 지금 상태 하나('신호 약함'은 warn, '자동 도착 꺼짐'·'화면 밖 멈춤'은 line)를 보여 준다. 줄을 누르면 Sheet로 자세한 설명이 열린다. 경고가 필요한 '신호 약함'만 warn Notice 한 줄로 짧게 쓴다: 'GPS 신호가 약해 도착 판정을 잠시 멈췄어요'. 시간표 제목은 날짜가 오늘이 아니면 '{10/18} 시간표'로 바꾼다. 백그라운드 기록 카드 문구는 HANDOFF 결정(웹·Expo Go 안내)이고 테스트로 고정되어 있으므로 그대로 둔다.
- 파일: test/src/screens/LiveTripScreen.tsx, test/src/features/live/components/SimBanner.tsx (13도 같이 씀)
- 테스트 영향: SIM_BANNER_TEXT를 직접 보는 테스트는 없다. wp5-delay의 금지 문구 검사(src/features/live 전체)는 다시 통과하는지 확인한다. bgRecordText는 wp5-background가 정규식으로 고정하고 있으니 바꾸지 않는다.

### [low/S] 19 여행 진행 · 빈 시간 추천
- 문제: 빈 시간 추천 카드는 '걸어서 다녀올 만한 곳' 2~3곳을 보여 주지만, LiveTripScreen이 onPressPlace를 넘기지 않아서 아무 곳도 누를 수 없다. 사용자는 장소 이름을 외워 다른 앱에서 다시 찾아야 한다. 게다가 전체 폭 '닫기' 버튼이 카드에서 가장 눈에 띄는 행동이다.
- 제안: 장소 줄을 누르면 13과 같은 방식으로 카카오맵 도보 링크(https://map.kakao.com/link/to/{이름},{lat},{lng})를 연다. 이를 위해 FreeTimeCard의 onPressPlace를 (place) => void로 바꾸고 줄 오른쪽에 'right' 아이콘을 단다. '닫기'는 카드 오른쪽 위 IconBtn x(label '빈 시간 추천 닫기')로 옮긴다. 링크에는 목적지 좌표만 들어가고 내 위치는 보내지 않는다.
- 파일: test/src/features/live/components/FreeTimeCard.tsx, test/src/screens/LiveTripScreen.tsx
- 테스트 영향: 없음. FreeTimeCard를 보는 테스트가 없다.

## 전체 구조·공통 UI (내비게이션, src/ui, 화면 간 일관성, 정보 구조). 파일 경로는 /Users/handong-gwan/TMAXyoungkk/test 기준이다. 커뮤니티 화면은 다루지 않았다.

**주요 흐름**
- 처음 시작: 게스트로 시작, 계정 로그인, 초대 링크나 코드로 합류(온보딩, 02 초대 수락, 15·16 로그인·회원가입)
- 여행방 만들기에서 멤버 초대로 넘어가 링크를 공유하고 마법사를 끝낸다(04에서 14로, 2단계)
- 장소 모으기: 그룹 채팅 자동 추출, 장소 직접 담기, 성향 태그 추천(05·06·23)
- 후보 확인: 확정과 제외(자동 선별, FR-403 확정 버튼 없음), 고정과 되돌리기(06·07)
- 루트 계산 뒤 날짜별 시간표를 보고, 일정 편집과 구간 이동수단 비교로 손본다(08·09·10·12)
- 지도에서 날짜별 루트를 보고 자유 길찾기(27)나 계획 구간 안내(13)를 연다
- 여행 당일: 여행 진행에서 다음 스팟, 도착 처리, 조정안, 빈 시간 추천을 보고 다음 구간 안내로 간다(19·13)
- 여행이 끝난 뒤: 사진 올리기, 일기 만들기와 고치기, 기록 지도, 공유와 커뮤니티 올리기(20·21·22·29)
- 여러 여행방(예정·진행중·완료) 사이를 오가며 어느 방을 보고 있는지 안다
- 여행방 설정 바꾸기: 이름, 날짜, 날짜별 기점, 활동시간, 삭제와 나가기(25)
- 계정과 설정: 내 프로필, 게스트 승격, 로그인과 로그아웃, 알림, 위치, 시연 도구(17·18)

### [high/M] 공통 · 현재 여행방(홈, 후보·시간표·지도 탭, 프로필 탭의 여행방 목록)
- 문제: 후보·시간표·지도 탭과 프로필 탭의 여행방 목록은 useCurrentTrip(useUi.currentTripId)만 본다. 홈은 이 값이 비면 진행중이나 예정인 첫 방을 대신 고른다(HomeScreen.tsx:64). 카드에 선택 테두리까지 그리지만 그 선택을 저장하지 않는다. 그래서 다른 계정으로 로그인한 뒤(flows.ts:64), 방장이 보던 방을 지운 뒤, 방을 나간 뒤에는 화면이 서로 어긋난다. 홈에서는 여행이 선택돼 보이는데 후보·시간표·지도 탭은 '여행방이 없습니다 · 여행방 만들기'를 띄운다. 그러면 사용자가 같은 여행방을 하나 더 만들게 된다. 후보 탭 머리말('후보 N곳')과 지도 탭에는 어느 여행방인지 나오지 않는다. 탭 안에서 다른 방으로 바꾸는 방법도 없어서, 홈으로 돌아가 가로로 밀리는 카드를 눌러야 한다. 여행방 설정은 채팅의 ... 메뉴에만 있다. 개인 모드(혼자) 방은 홈에서 채팅 칸이 꺼지므로, 혼자 쓰는 방은 날짜·기점을 바꾸거나 방을 지울 길이 시연 도구의 화면 목록 말고는 없다.
- 제안: (1) 현재 방을 고르는 규칙을 한 곳에 둔다. features/account/home.ts에 순수 함수 pickCurrentTrip(trips, currentTripId, now)를 만들고(지정한 방 → 진행중 첫 방 → 예정 첫 방 → 최근에 끝난 방 순), useCurrentTrip과 HomeScreen이 같이 쓴다. (2) features/trip/components/TripBar.tsx를 새로 만든다. 여행방 이름, 상태 칩(D-3·2일째·여행 끝), 꺾쇠를 한 줄에 두고, 누르면 Sheet에 내 여행방 목록을 상태별로 띄워 바꿀 수 있게 한다. 오른쪽에는 채팅·멤버·설정(gear) IconBtn을 둔다. 설정 버튼은 개인 모드 방에도 늘 보인다. 후보·시간표 탭 머리말 맨 위에 두고, 지도 탭에서는 위 칩 줄의 날짜 칩 앞에 같은 칩으로 둔다. (3) 여행방은 있는데 고른 방이 없으면 탭의 빈 화면은 '여행방을 골라 주세요'와 목록 시트 열기를 보인다. '여행방 만들기'는 방이 하나도 없을 때만 보인다. 채팅 메뉴의 여행방 설정은 그대로 두고(테스트로 고정), 프로필 탭 목록에는 다시 넣지 않는다.
- 파일: src/store/trips.ts, src/features/account/home.ts, src/features/trip/components/TripBar.tsx, src/screens/HomeScreen.tsx, src/screens/CandidatesScreen.tsx, src/screens/ScheduleScreen.tsx, src/screens/MapScreen.tsx, src/screens/MoreScreen.tsx
- 테스트 영향: currentTripId나 useCurrentTrip을 고정한 테스트가 없어서 깨지는 테스트는 없다. pickCurrentTrip 순서 테스트를 tests/wp1-home.test.ts에 더한다. wp6-community 테스트('채팅 메뉴 → 여행방 설정, 프로필 탭에는 없음')는 그대로 통과한다.

### [high/S] 공통 · 토스트(src/ui/Toast.tsx, src/navigation/ToastHost.tsx)
- 문제: Toast.tsx:20은 pointerEvents:'none'을 인라인 style로 준다. react-native-web 0.21.2의 inline 스타일 컴파일러는 pointerEvents를 지원하지 않는다(node_modules/react-native-web/dist/exports/StyleSheet/compiler/index.js의 inline() 주석). 그래서 웹에서는 이 값이 버려진다. 지도 오버레이에서 이미 한 번 겪은 문제와 같다(components/map/parts.tsx 주석, wp5-google-map 테스트). 토스트는 top insets.top+8, 좌우 24, 높이 약 42라서 머리말 아이콘 줄(y 6~50)을 덮는다. 이 줄에는 뒤로, 닫기, 채팅 메뉴, 홈의 프로필·멤버 아이콘이 있다. 담기·되돌리기·저장 뒤 토스트가 떠 있는 3.2초 동안은 사용자가 바로 누르는 '뒤로'가 먹지 않는다. 표시 시간도 길이와 상관없이 3.2초라서, '로그아웃했습니다. 같은 계정으로 다시 로그인하면…'이나 '계정을 지웠습니다. 올린 사진은…' 같은 두 문장짜리 토스트는 다 읽기 전에 사라진다.
- 제안: Toast의 위치와 pointerEvents를 StyleSheet.create로 옮긴다(parts.tsx의 overlay와 같은 방식). 표시 시간은 글자 수에 비례하게 바꾼다. 예를 들어 2500ms에 글자당 60ms를 더하고 최대 6000ms로 하는 순수 함수를 두고 ToastHost가 쓴다. 토스트 문장은 한 문장만 쓰고, 덧붙일 설명은 화면 안 Notice로 보낸다는 규칙을 Toast 주석에 적는다.
- 파일: src/ui/Toast.tsx, src/navigation/ToastHost.tsx
- 테스트 영향: wp5-google-map의 인라인 pointerEvents 금지 테스트가 보는 파일 목록에 src/ui/Toast.tsx를 더한다. foundation-design-rules에서 src 전체를 검사하도록 넓혀도 된다. 표시 시간 함수에는 테스트를 하나 더한다.

### [high/M] 03 홈 · 메인 메뉴
- 문제: 홈 '빠른 메뉴' 6칸(만들기·채팅·후보·지도·멤버·길찾기)은 여행 단계와 상관없이 늘 같다. 여행 당일 가장 필요한 '여행 진행'(19)은 홈에 없다. 지도 탭에서 날짜를 골라 '여행 진행'을 누르거나, 프로필 탭 타일이나 구간 내비를 거쳐야 한다. 끝난 여행의 사진·일기·기록 지도는 프로필 탭 목록이나 여행 진행 화면 맨 아래 버튼에만 있다. 명세는 여행이 끝난 뒤에도 일기와 지도를 열람할 수 있어야 한다고 한다. 꺼진 칸의 이유는 homeMenu가 계산해 두지만('멤버를 초대하면 채팅과 대화 인식이 열립니다', '여행방을 먼저 골라 주세요') MenuGrid가 그리지 않는다. 그래서 꺼진 칸을 눌러도 아무 반응이 없다. 메뉴가 어느 방에 대한 것인지는 가로로 밀리는 카드의 2px 테두리로만 보인다. 머리줄의 사람 아이콘은 프로필 탭과 같은 '내 프로필'로 가서 중복이고, 사람들 아이콘(멤버)에는 라벨이 없다. '여행방 만들기'는 구역 제목 꺾쇠, 메뉴 첫 칸, 빈 화면에서 세 번 나온다. 추천 여행지(부산·경주 등)를 누르면 지역이 비어 있는 만들기 폼이 열린다.
- 제안: '빠른 메뉴' 구역을 '선택한 여행방' 구역으로 바꾼다. 제목은 여행방 이름이고 TripBar와 같은 칩을 쓴다. 아래 동작은 여행 단계에 따라 다르게 보인다. 진행중이면 주 버튼 '오늘 여행 진행'(LiveTrip, 오늘 날짜)에 시간표·구간 안내·채팅을 더한다. 예정이면 채팅·후보·시간표·멤버 초대, 완료면 사진·일기·기록 지도·커뮤니티에 올리기를 둔다. 꺼진 칸이 있으면 격자 아래에 이유를 한 줄로 적는다(QuickAction의 sub 자리를 써도 된다). 머리줄의 프로필 아이콘은 빼고, 멤버 아이콘은 TripBar로 옮긴다. 여행방 만들기는 방이 0개일 때 빈 화면 버튼으로, 그 밖에는 구역 제목 꺾쇠 하나로만 둔다. 방이 3개 이하면 예정·진행중·완료 Seg를 숨기고 한 줄에 진행중 → 예정 → 완료 순으로 놓는다. 카드 배지가 이미 상태를 말해 준다. 추천 여행지는 CreateTrip에 { region: p.id }를 넘겨 지역을 채운 채로 연다. HOME_PICKS의 id가 data/regions의 id와 같아서 바로 쓸 수 있다.
- 파일: src/screens/HomeScreen.tsx, src/features/account/home.ts, src/ui/Discover.tsx, src/navigation/routes.ts, src/screens/CreateTripScreen.tsx
- 테스트 영향: wp1-home의 '메뉴 6칸' 묶음, 특히 '목업 03 순서의 6칸이다'(순서 고정)를 단계별 동작 함수 테스트로 바꾼다. 의도는 그대로 지킨다: 여행방이 없으면 만들기만 열리고, 개인 모드면 채팅이 꺼지며 이유에 '초대'가 들어가고, 구간 안내는 활성이다. homeSegments와 defaultSegment 테스트는 그대로 둔다.

### [medium/M] 공통 · 하단 탭(TAB_ITEMS, RootNavigator, TabBar)
- 문제: 하단 탭이 6칸이다(홈·후보·시간표·지도·커뮤니티·프로필). 디자인 시스템의 TabBar 규칙은 '다섯 칸 고정, 라벨은 두세 글자'이고, TabBar.tsx 주석도 아직 다섯 칸을 말한다. 360px 화면에서 칸 하나가 56px로 좁아진다. 후보와 시간표는 한 계획의 두 면이다(후보 → 자동 선별 → 시간표, 확정 버튼 없음). 그런데 사용자는 두 탭을 오가며 같은 확정·제외 정보를 따로 본다. 시간표에서 '후보 보기'를 누르거나 채팅 메뉴에서 '후보 보기'를 누르면 탭이 통째로 바뀐다.
- 제안: 탭을 다섯 칸으로 줄인다: 홈 · 일정 · 지도 · 커뮤니티 · 프로필. '일정' 탭은 Schedule 라우트이고 아이콘은 cal이다. Candidates는 탭 라우트로 그대로 등록해 두고 TAB_ITEMS에서만 뺀다. 그러면 링크 'candidates'와 지금의 navigate('Candidates') 호출이 모두 그대로 동작한다. AppTabBar는 활성 라우트가 Candidates일 때 '일정' 칸을 켜진 칸으로 그린다. 두 화면 머리말 아래에는 같은 전환 Seg '시간표 · 후보 N'을 둔다. 새 컴포넌트 PlanSwitch로 만들고, 탭 안에서 navigate로 오가므로 화면이 쌓이지 않는다. 커뮤니티는 지도와 프로필 사이 자리를 그대로 지킨다.
- 파일: src/navigation/routes.ts, src/navigation/RootNavigator.tsx, src/ui/TabBar.tsx, src/features/schedule/components/PlanSwitch.tsx, src/screens/ScheduleScreen.tsx, src/screens/CandidatesScreen.tsx
- 테스트 영향: wp6-community '탭·화면 연결' 테스트의 TAB_ITEMS 키 deepEqual을 ['Home','Schedule','Map','Community','More']로 바꾼다. 커뮤니티가 지도와 프로필 사이라는 의도는 그대로다. 같은 테스트에 Candidates가 Tabs.Screen으로 남아 있고 linking에 'candidates'가 있는지 확인을 더한다.

### [medium/M] 공통 · 주 버튼 자리(14 멤버 초대, 19 여행 진행, 13 구간 안내)
- 문제: 주 버튼 자리가 화면마다 다르다. 만들기·사진·일기·스팟 상세·이동수단 비교는 하단 Foot에 두지만, 다른 화면은 본문 중간 카드 안의 작은 버튼으로 둔다. 여행방 만들기 2/2 단계(멤버 초대)는 '링크 공유하기'가 본문 중간에 있고 끝내는 버튼이 없다. 그래서 뒤로 화살표 말고는 마법사를 끝내는 방법이 보이지 않는다. 여행 진행 중 가장 자주 누르는 '도착 처리'와 '길찾기'는 240px 지도와 안내 카드들 아래 '다음 스팟' 카드 안의 작은 버튼이다. 안내가 쌓이면 스크롤해야 보인다. '여행 진행 끝내기'는 맨 아래의 작은 quiet 버튼이다.
- 제안: 할 일이 있는 화면은 주 버튼 하나를 Foot(엄지가 닿는 하단 고정 자리)에 둔다는 규칙을 정한다. 멤버 초대에서 만들기 마법사로 들어왔으면(fromCreate) Foot에 주 버튼 '링크 공유하기'와 quiet 버튼 '나중에 초대하기'를 둔다. 링크가 없으면 주 버튼은 '초대 링크 만들기'다. '나중에 초대하기'는 그 방을 현재 방으로 정하고 일정(후보) 탭으로 간다. 여행 진행이 실행 중이면 Foot에 '도착 처리'(수동 진행이거나 정확도를 모를 때 주 버튼)와 '구간 안내'를 두고, 위의 다음 스팟 카드에는 정보만 남긴다. 실행 전이면 Foot에 '여행 시뮬레이터로 재생'을 두고, 기기 위치와 수동 진행은 카드 안 보조 버튼으로 둔다. 구간 안내의 '안내 시작'도 Foot으로 옮긴다.
- 파일: src/screens/MembersScreen.tsx, src/screens/LiveTripScreen.tsx, src/screens/NavigateScreen.tsx
- 테스트 영향: 버튼 라벨이나 자리를 고정한 테스트는 없다(wp5-delay는 금지 문구만 본다). 버튼을 옮기기만 하므로 기존 테스트에 영향이 없다.

### [medium/S] 공통 · 길찾기 이름(13 구간 안내와 27 자유 길찾기)
- 문제: 같은 '길찾기'라는 말이 서로 다른 두 화면으로 간다. 홈 빠른 메뉴의 '길찾기'와 여행 진행의 '길찾기' 버튼은 13 계획 구간 내비(NavigateScreen)로 간다. 이 화면 머리말도 '길찾기 · 날짜'다. 지도 탭 위의 '길찾기' 칩과 스팟 상세의 '여기까지 길찾기'는 27 자유 길찾기(DirectionsScreen)로 간다. 그런데 지도 탭 아래 시트는 13을 '구간 안내'라고 부른다. 사용자는 홈에서 누른 '길찾기'에서 왜 출발과 도착을 고를 수 없는지 알 수 없다.
- 제안: 13은 어디서나 '구간 안내'로 부르고(아이콘 nav), '길찾기'는 27에만 쓴다. 홈 칸 라벨을 '구간 안내'로 바꾼다. 아니면 홈 칸을 27 길찾기로 보내고 여행방 기점을 출발로 채운다. 여행 진행 버튼은 '구간 안내'로, NavigateScreen 머리말과 빈 화면 제목은 '구간 안내'로, SCREEN_META.Navigate 제목도 '구간 안내'로 바꾼다.
- 파일: src/features/account/home.ts, src/screens/HomeScreen.tsx, src/screens/LiveTripScreen.tsx, src/screens/NavigateScreen.tsx, src/navigation/routes.ts
- 테스트 영향: 라벨을 고정한 테스트는 없다. wp1-home '길찾기 칸은 활성이다' 테스트는 키 'navigate'로 찾으므로 테스트 이름만 고치면 된다. 의도는 그대로다.

### [medium/S] 공통 · 날짜 Seg(11 지도 탭 시트, 19 여행 진행)
- 문제: Seg는 칸 사이가 28px로 고정이고 줄바꿈도 가로 스크롤도 없다. 시간표와 기록 화면(DateSeg)은 바깥에서 ScrollView로 감싸 두었지만, 지도 탭 시트(MapScreen.tsx:175)와 여행 진행(LiveTripScreen.tsx:137)은 감싸지 않았다. '전체'와 '10/17' 같은 날짜 칸이 5일만 돼도 폭이 약 360px가 된다. 360px 화면의 안쪽 폭은 312px라서 뒤쪽 날짜가 잘려 누를 수 없다. 여행은 최대 14일까지 만들 수 있다.
- 제안: 넘침 처리를 Seg 안으로 옮긴다. 칸이 화면보다 넓으면 Seg가 스스로 가로 ScrollView로 감싸고, 고른 칸이 보이게 밀어 준다. 시간표의 pickDate 스크롤 로직을 Seg 안으로 옮기면 된다. 시간표와 DateSeg의 바깥 ScrollView는 지운다. 지도 시트의 날짜 칸은 '17 금'처럼 짧게 쓴다.
- 파일: src/ui/Seg.tsx, src/screens/MapScreen.tsx, src/screens/LiveTripScreen.tsx, src/screens/ScheduleScreen.tsx, src/features/journal/components/DateSeg.tsx
- 테스트 영향: Seg나 날짜 줄을 고정한 테스트는 없다. 다섯 날 이상인 시연 여행방으로 360px 웹 화면을 확인하는 항목을 남긴다.

### [medium/S] 공통 · 아이콘만 있는 핵심 버튼과 작은 글자 링크
- 문제: 자주 쓰는 동작이 뜻이 모호한 아이콘이나 12~14px 글자 링크로만 있다. 시간표의 '일정 편집'은 두 줄짜리 drag 아이콘이라 메뉴 버튼처럼 보인다. 활동시간 초과 경고는 '일정 편집에서 조정안을 골라 주세요'라고만 하고, 그리로 바로 가는 링크가 없다. 스팟 상세의 '고정하기'는 머리말 오른쪽 자물쇠 아이콘 하나뿐이다. 고정은 자동 제외를 막는 핵심 기능이다. 시간표의 '다시 계산'·'단계 보기', 홈 카드의 '시간표 보기', 멤버의 '새 링크 만들기'는 높이 17~20px인 글자 한 줄이다. hitSlop을 더해도 33px 안팎이라 손가락으로 누르기 어렵다. IconBtn도 40×40이다.
- 제안: 핵심 동작은 라벨이 있는 작은 버튼(Btn sm quiet + 아이콘)으로 바꾼다. 시간표 머리말에는 '편집' 버튼을 두고, Icon에 edit(연필) 아이콘을 더한다. 스팟 상세의 '고정'/'고정 풀기'는 체류·날짜 버튼 줄로 옮긴다. Notice에 action?: { label, onPress } 프롭을 더해, 활동시간 초과 경고와 오프라인 안내에 '조정안 보기' 같은 링크를 단다. 글자 링크는 공용 TextLink 하나로 모으고 최소 44 높이를 보장한다. IconBtn에는 hitSlop 4를 줘서 실제로 누르는 넓이가 48이 되게 한다.
- 파일: src/ui/Icon.tsx, src/ui/Notice.tsx, src/ui/Btn.tsx, src/ui/Auth.tsx, src/screens/ScheduleScreen.tsx, src/screens/SpotDetailScreen.tsx, src/screens/HomeScreen.tsx, src/screens/MembersScreen.tsx
- 테스트 영향: 이 버튼들을 고정한 테스트는 없다. foundation-design-rules 규칙(텍스트 화살표 금지, 아이콘은 Icon만, 가운데 정렬은 src/ui에서만)을 지킨다.

### [medium/M] 공통 · 머리말과 뒤로(스택 화면 전부)
- 문제: 뒤로 처리가 화면마다 다르다. 스택 화면 11곳은 canGoBack이 false면 뒤로 버튼을 아예 숨긴다: Chat, Diary, Photos, RecordMap, LiveTrip, Navigate, Directions, Recommend, SpotDetail, CreateTrip, Profile. '찾을 수 없습니다' 빈 화면 11곳 가운데 9곳에는 버튼도 없다. 그래서 웹에서 새로 고침하거나, 딥링크로 들어오거나, 방장이 방을 지운 뒤에는 나갈 곳이 없는 화면이 된다. 탭으로 돌아가는 대체 경로가 있는 곳은 6곳뿐이다(커뮤니티 글쓰기 포함). 루트 계산(08)은 머리말에 뒤로가 없고, 하단 버튼은 시간표나 지도에서 들어왔어도 '후보로 돌아가기'라고 쓴다. 한 줄 머리말도 화면마다 따로 만들었다(채팅, 길찾기, 구간 안내, 이동수단 비교, 일정 편집, 시간표). 그래서 아래 여백(8·10·14)과 제목 크기(nm·ttlSm·12px eyebrow)가 제각각이다. 길찾기와 구간 안내는 12px eyebrow가 제목 역할을 한다.
- 제안: src/navigation/useBack.ts를 새로 만든다. useBack(fallback)은 늘 함수를 돌려주고, 돌아갈 화면이 없으면 그 화면이 속한 탭으로 navigate한다. Header에 compact 변형을 더한다: 한 줄에 뒤로, 제목(nm)과 보조 줄(mtTight), 오른쪽 슬롯을 둔다. 위 6곳의 손수 만든 머리말을 이것으로 바꾼다. src/ui에 NotFound(제목과 '홈으로' 주 버튼)를 두고 '찾을 수 없습니다' 화면들이 같이 쓴다. 루트 계산 머리말에는 뒤로를 보이고, 하단 라벨은 '돌아가기'로 바꾼다.
- 파일: src/navigation/useBack.ts, src/ui/layout.tsx, src/ui/Notice.tsx, src/screens/ChatScreen.tsx, src/screens/DirectionsScreen.tsx, src/screens/NavigateScreen.tsx, src/screens/LegTransportScreen.tsx, src/screens/ScheduleEditScreen.tsx, src/screens/ScheduleScreen.tsx, src/screens/PlanningScreen.tsx, src/screens/DiaryScreen.tsx, src/screens/PhotosScreen.tsx, src/screens/RecordMapScreen.tsx, src/screens/LiveTripScreen.tsx, src/screens/RecommendScreen.tsx, src/screens/SpotDetailScreen.tsx, src/screens/CreateTripScreen.tsx, src/screens/ProfileScreen.tsx
- 테스트 영향: 뒤로나 머리말 마크업을 고정한 테스트는 없다(tests를 grep해 canGoBack, IconBtn back, eyebrow가 걸리지 않음을 확인했다). wp5-directions와 wp5-navigate-progress는 로직만 본다. useBack은 node 테스트를 하나 더하고, 새 파일은 src/navigation/** 소유 글롭에 걸린다.

### [medium/S] 20 사진 · 21 일기 · 22 기록 지도
- 문제: 세 기록 화면은 서로를 버튼으로 잇는데, 버튼 자리가 제각각이다. 사진은 날짜 줄 위, 기록 지도는 맨 아래에 있고, 일기에는 아예 없다. 누를 때마다 새 화면이 쌓여서, 사진 → 기록 지도 → 사진 → 일기처럼 가면 뒤로를 여러 번 눌러야 한다. 사진 → 일기와 기록 지도 → 사진은 보던 날짜를 넘기지 않아서 첫날로 돌아간다.
- 제안: src/features/journal/components/RecordTabs.tsx를 새로 만든다. 머리말 바로 아래 Seg '사진 · 일기 · 기록 지도'를 세 화면이 같이 쓴다. 누르면 navigation.replace(route, { tripId, date })로 화면을 바꿔서 쌓이지 않고 날짜도 이어진다. 기존 버튼 줄은 지운다. 여행 진행 화면의 '기록 지도'·'사진' 두 버튼은 '기록 보기' 입구 하나로 합친다. 홈의 완료 여행 동작(홈 항목)도 같은 묶음으로 들어간다.
- 파일: src/features/journal/components/RecordTabs.tsx, src/screens/PhotosScreen.tsx, src/screens/DiaryScreen.tsx, src/screens/RecordMapScreen.tsx, src/screens/LiveTripScreen.tsx
- 테스트 영향: 고정한 테스트는 없다. wp6-record-map은 범례와 문구를, wp6-community는 일기 → 커뮤니티 글쓰기 navigate만 보며, 둘 다 그대로 통과한다. 새 파일은 src/features/journal/** 글롭에 걸린다.

### [medium/S] 공통 · 입력과 시트(Screen, Body, Sheet)
- 문제: src 어디에도 KeyboardAvoidingView와 keyboardShouldPersistTaps가 없다. iOS에서는 키보드가 채팅 입력줄, Foot 위 입력(프로필 저장, 여행방 만들기), 시트 안 입력(일기 문단 고치기)을 가린다. 스크롤 안의 검색(후보의 '장소 직접 담기', 기점 찾기 시트)에서는 결과를 처음 누르면 키보드만 내려가고 선택은 되지 않아서 두 번 눌러야 한다. Sheet는 높이 제한과 스크롤이 없다. 그래서 작은 화면에서 긴 시트(달력 날짜 바꾸기, 멤버가 많은 채팅 메뉴)는 제목이 위로 밀려날 수 있다. 닫기 버튼도 없어서 바깥을 눌러야만 닫힌다.
- 제안: Body scroll과 Sheet 내용 ScrollView에 keyboardShouldPersistTaps="handled"를 준다. Screen에 keyboard 프롭을 더해 iOS에서 behavior 'padding'인 KeyboardAvoidingView로 감싸고, 채팅·프로필·일기·여행방 만들기에서 켠다. Sheet 내용은 창 높이 85%를 넘지 않는 ScrollView로 감싸고, title이 있으면 오른쪽에 닫기 IconBtn을 둔다.
- 파일: src/ui/layout.tsx, src/ui/Sheet.tsx, src/screens/ChatScreen.tsx, src/screens/ProfileScreen.tsx, src/screens/DiaryScreen.tsx, src/screens/CreateTripScreen.tsx
- 테스트 영향: 고정한 테스트는 없다. 웹 확인으로는 보이지 않는 문제라서 iOS 기기 확인 항목으로 남긴다.

### [low/M] 공통 · 오프라인·동기화 안내
- 문제: 오프라인 안내가 화면마다 다른 문장으로 screens와 features에 19곳 있다. 제목이 있기도 하고 없기도 하며, 아이콘도 다르다. 여기에 계산 중, 다시 계산 대기, 예시 데이터 안내가 겹치면 목록이 시작되기 전 첫 화면을 Notice 2~3개가 차지한다(시간표, 후보, 여행방 설정).
- 제안: 앱 전체에 하나뿐인 OfflineBar를 둔다. ToastHost처럼 App에서 그리고, 안전 영역 아래 얇은 한 줄에 '오프라인 · 연결되면 보냅니다'를 띄운다. 누르면 프로필 탭의 네트워크 설정으로 간다. 화면 안 Notice는 그 화면에서 할 수 있는 일이 바뀔 때만 한 줄로 남긴다(예: 채팅의 전송 대기). '다시 계산하는 중'은 지금처럼 칩 하나로 둔다.
- 파일: App.tsx, src/navigation/OfflineBar.tsx, src/screens/ScheduleScreen.tsx, src/screens/CandidatesScreen.tsx, src/screens/TripSettingsScreen.tsx, src/screens/ChatScreen.tsx, src/screens/RecommendScreen.tsx, src/screens/DirectionsScreen.tsx
- 테스트 영향: 오프라인 문장을 고정한 화면 테스트는 없다. wp2-sync와 qa-sync-session은 큐와 순서 로직만 본다. 새 파일은 src/navigation/** 글롭에 걸린다.

### [low/M] 18 프로필 탭 · 켜고 끄기(프로필 탭, 25 여행방 설정, 14 멤버)
- 문제: 켜고 끄는 컨트롤이 세 가지 모양이다. 프로필 탭의 ToggleRow는 줄 오른쪽에 '켜짐/꺼짐' 배지를 둔다. 상태 표시처럼 보여서 누를 수 있는지 알기 어렵다. 여행방 설정의 '복귀 없음'과 멤버의 '초대 권한'은 Tag 알약(체크박스 역할)이고, 잠겼을 때는 Chip이다. ToggleRow의 설명(sub)은 accessibilityHint로만 가고 화면에는 보이지 않는다. 그래서 '기기 위치 사용'과 '네트워크'의 설명을 볼 수 없다. 프로필 탭은 여행방 바로가기, 계정, 알림, 위치, 제공자 상태, 데이터 보존, 시연 도구가 한 스크롤에 이어져 있어서, 일반 사용자에게는 절반이 개발용 항목이다.
- 제안: src/ui/Toggle.tsx를 새로 만들어 세 곳을 이것으로 바꾼다. 모양은 DS ListRow를 따른다: 라벨, 현재 값이나 짧은 설명 한 줄, 오른쪽 스위치. 켜진 스위치는 brand 색이다(DS가 '켜진 상태'에 brand를 허용한다). 프로필 탭 순서는 프로필 머리 → 계정 → 알림·위치(ListRow, DS대로 카드로 감싸지 않음) → '시연 · 개발' 한 줄로 바꾼다. 이 줄을 누르면 제공자 상태, 시나리오 채우기, 네트워크, 리셋, 화면 목록이 펼쳐진다. 여행방 바로가기는 홈의 선택한 여행방 구역으로 옮긴다. 여행방 설정은 계속 넣지 않는다.
- 파일: src/ui/Toggle.tsx, src/ui/index.ts, src/ui/tokens.ts, src/screens/MoreScreen.tsx, src/screens/TripSettingsScreen.tsx, src/screens/MembersScreen.tsx
- 테스트 영향: foundation-contrast의 NON_TEXT_PAIRS에 스위치 트랙과 손잡이 쌍을 더한다. wp6-community의 MoreScreen 검사('여행방 설정' 없음)는 그대로 통과한다. wp1-home의 알림 4종 테스트는 순수 데이터 NOTIFY_ROWS만 보므로 영향이 없다.
