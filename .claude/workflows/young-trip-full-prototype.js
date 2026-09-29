export const meta = {
  name: 'young-trip-full-prototype',
  description: '기능명세서 전 기능을 회사식 회의(킥오프·설계리뷰·코드리뷰·QA·회고)를 거치며 Expo 프로토타입으로 구현',
  phases: [
    { title: '킥오프', detail: 'PM·테크리드·디자이너·QA 4명 입장 발표' },
    { title: '킥오프 회의', detail: '진행자가 결정 사항과 작업 분할 확정' },
    { title: '설계 리뷰', detail: '리뷰어 3명이 계획 검토' },
    { title: '계획 확정', detail: '리뷰 반영 최종 계획' },
    { title: '기반 작업', detail: '공유 파일·계약·스텁·의존성 (1명 작성, 2명 리뷰, 1명 수정)' },
    { title: '기능 개발', detail: '작업 패키지별 개발' },
    { title: '코드 리뷰', detail: '패키지마다 리뷰어 3명' },
    { title: '리뷰 반영', detail: '패키지마다 수정' },
    { title: '통합 QA', detail: '통합·테스트·추적표 병렬' },
    { title: '최종 점검', detail: '테스트·타입·번들 통과까지 수정' },
    { title: '회고', detail: '3명 회고 + 회의록' },
  ],
}

const ROOT = '/Users/handong-gwan/IT희망학교 여행계획 프로젝트'
const APP = ROOT + '/test'
const MEET = ROOT + '/docs/meetings'

// 이전 실행에서 사용량 한도로 끊기기 전 각 패키지가 이미 쓴 파일
const RESUME = {"WP2":["server/sync-server.mjs","tests/wp2-trip.test.ts","src/store/trips.ts","src/services/sync/http.ts","src/services/sync/loopback.ts","src/core/ops/trip.ts","src/core/ops/members.ts","src/core/trip/outbox.ts","src/core/trip/join.ts","src/core/trip/format.ts","src/core/trip/invite.ts","src/core/trip/lookup.ts","src/core/trip/members.ts","src/core/trip/create.ts"],"WP3":["tests/wp3-extract-quality.test.ts","tests/wp3-extract.test.ts","tests/wp3-candidates.test.ts","tests/wp3-providers.test.ts","tests/wp3-recommend.test.ts","tests/wp3-golden-extract.test.ts","src/screens/RecommendScreen.tsx","src/screens/SpotDetailScreen.tsx","src/screens/ChatScreen.tsx","src/screens/CandidatesScreen.tsx","src/data/places.ts","src/core/recommend.ts","src/services/extraction/rules.ts","src/services/extraction/ai.ts","src/services/extraction/index.ts","src/core/ops/chat.ts","src/core/ops/spots.ts","src/core/extract/spot.ts","src/core/extract/text.ts","src/core/extract/manual.ts","src/core/extract/index.ts","src/services/places/local.ts","src/services/places/kakao.ts","src/features/candidates/rows.ts","src/features/candidates/detail.ts","src/features/candidates/actions.ts","src/features/chat/scenario.ts","src/features/chat/view.ts","src/features/chat/send.ts","src/services/recommend/ai.ts","src/services/recommend/local.ts","src/features/candidates/components/ManualAdd.tsx","src/features/candidates/components/PlacePickSheet.tsx","src/features/chat/components/Bubble.tsx","src/features/chat/components/ExtractionCardView.tsx"],"WP6":["tests/wp6-diary.test.ts","tests/wp6-track.test.ts","tests/wp6-photo.test.ts","src/screens/DiaryScreen.tsx","src/screens/PhotosScreen.tsx","src/core/journal/photo.ts","src/core/journal/exif.ts","src/core/journal/diary.ts","src/core/journal/track.ts","src/features/journal/api.ts","src/services/photos/device.ts","src/services/photos/sim.ts","src/core/ops/journal.ts","src/services/diary/template.ts","src/services/diary/ai.ts","src/features/journal/components/DateSeg.tsx","src/features/journal/components/PhotoTile.tsx"],"WP1":["src/core/session.ts","src/core/auth.ts","src/store/session.ts","src/screens/SocialConsentScreen.tsx","src/screens/HomeScreen.tsx","src/screens/LoginScreen.tsx","src/screens/SplashScreen.tsx","src/screens/OnboardingScreen.tsx","src/screens/SignupScreen.tsx","src/features/account/useAuthDone.ts","src/features/account/flows.ts","src/features/account/messages.ts","src/features/account/home.ts","src/features/account/bootstrap.ts","src/services/auth/local.ts"],"WP5":["src/screens/NavigateScreen.tsx","src/store/live.ts","tests/wp5-map.test.ts","tests/wp5-arrival.test.ts","tests/wp5-live.test.ts","tests/wp5-freetime.test.ts","tests/wp5-delay.test.ts","tests/wp5-sim.test.ts","src/screens/LiveTripScreen.tsx","src/screens/MapScreen.tsx","src/services/location/device.ts","src/services/location/sim.ts","src/components/map/useLegGeometry.ts","src/components/map/MapCanvas.tsx","src/core/live/freetime.ts","src/core/live/delay.ts","src/core/live/context.ts","src/core/live/engine.ts","src/core/live/mode.ts","src/core/live/background.ts","src/core/live/session.ts","src/core/live/track.ts","src/core/sim/track.ts","src/core/sim/presets.ts","src/core/sim/replay.ts","src/core/sim/clock.ts","src/core/map/model.ts","src/core/map/layout.ts","src/core/live/arrival.ts","src/core/live/throttle.ts","src/features/live/useDayMap.ts","src/features/live/photoBridge.ts","src/features/live/components/SimBanner.tsx","src/features/live/components/ProposalSheet.tsx","src/features/live/components/FreeTimeCard.tsx","src/features/live/components/SimControls.tsx"],"WP4":["tests/wp4-golden-plan.test.ts","tests/wp4-replan.test.ts","tests/wp4-optimize.test.ts","tests/wp4-invariants.test.ts","tests/wp4-timetable.test.ts","tests/wp4-budget.test.ts","src/data/scenario-tuning.ts","tests/wp4-edit.test.ts","tests/wp4-transport.test.ts","src/services/routes/cache.ts","src/services/routes/local.ts","src/services/routes/index.ts","src/services/routes/kakao.ts","src/services/routes/transit.ts","src/features/schedule/view.ts","src/features/schedule/timeline.ts","src/core/ops/schedule.ts","src/core/planner/replan.ts","src/core/planner/invariants.ts","src/core/planner/legs.ts","src/core/planner/estimate.ts","src/core/planner/day.ts","src/core/planner/adjust.ts","src/core/planner/order.ts","src/core/planner/index.ts","src/core/planner/travel.ts","src/core/planner/preview.ts","src/features/schedule/components/DayTimeline.tsx"]}

const CTX = `
회사: Young Trip 개발팀. 너는 이 팀의 구성원이다.
제품: Young Trip — 그룹 채팅에서 나온 "가고 싶은 곳"을 여행 루트로 자동 변환하는 한국어 모바일 앱.

반드시 읽을 자료:
- 기능명세서 v0.2: ${ROOT}/여행계획-앱-기능명세서-v0.2.md  (범위의 유일한 기준)
- 인계 문서(디자인 토큰, 시나리오 데이터, 용어, 확정 결정): ${ROOT}/HANDOFF.md
- 현행 핑크 목업 14화면: ${ROOT}/여행계획-앱-핑크-캔버스.html
- 역할 분담: ${ROOT}/역할분담.md
- 기존 코드(Expo SDK 57, React Native 0.86, TypeScript, zustand, react-navigation): ${APP}
  특히 ${APP}/README.md, ${APP}/src 전체, ${APP}/App.tsx, ${APP}/AGENTS.md

현재 상태: ${APP} 에 1단계 MVP 일부가 이미 돌아간다(약 2800줄, tsc 통과). 2·3차 기능과 목업 일부 화면이 없다.

이번 목표: 기능명세서 v0.2에 나온 모든 FR(FR-101~105, 201~205, 301~304, 401~404, 501~505, 601~604, 701~704, 801~804)을
동작하는 프로토타입으로 구현하고, 화면은 핑크 목업과 HANDOFF의 디자인 토큰을 따른다.
명세서에 없는 기능(예: 환율)은 만들지 않는다.

고정 규칙:
- 앱 이름은 Young Trip. 코드와 화면의 "여정" 표기는 Young Trip으로 바꾼다.
- 용어 고정: 후보 / 확정 스팟 / 제외 스팟 / 고정 / 기점 / 수용량 / 제안자 / 조정안 / 여행방 / 그룹방 / 게스트.
- 확정 결정(되돌리지 말 것): 확정 버튼 없음·자동 선별, 1단계 이동수단 도보·자동차(대중교통은 2차 기능으로 구현), 국내 전용·지도 SDK 중립 인터페이스, 게스트 세션.
- 실제 외부 키가 없다. 모든 외부 의존(지도, 경로, AI, 위치, 사진 EXIF)은 중립 인터페이스 뒤의 로컬 모의 제공자로 동작해야 하고, 키가 있으면 실제 제공자로 바뀌는 구조여야 한다.
- 실제로 경주를 돌아다닐 수 없으므로 2·3차의 실시간 기능(현재 위치, 도착 감지, 지연 감지, 빈 시간 추천, 경로 기록)은 "여행 시뮬레이터"(시각 가속 재생)로 시연 가능해야 한다.
- Expo SDK 57은 네 학습 시점 이후 버전일 수 있다. 새 expo 모듈을 쓸 때는 https://docs.expo.dev/versions/v57.0.0/ 문서를 WebFetch로 확인해라.
- 개발 서버(expo start 등 끝나지 않는 명령)를 절대 띄우지 마라. 검증은 "npx tsc --noEmit", "npx expo export --platform web --output-dir /tmp/yt-export", "node --test" 로만 한다.
- git commit, push, branch 조작 금지.
- 회의록과 문서는 한국어 평문으로 쓴다. 코드 주석은 기존 코드 밀도와 말투를 따른다.
`

const POSITION_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    summary: { type: 'string', description: '입장 요약 3-5문장' },
    currentStateFindings: { type: 'array', items: { type: 'string' }, description: '기존 코드와 목업을 실제로 읽고 발견한 사실. 파일 경로 포함' },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: { topic: { type: 'string' }, proposal: { type: 'string' }, rationale: { type: 'string' } },
        required: ['topic', 'proposal', 'rationale'],
      },
    },
    mustHaves: { type: 'array', items: { type: 'string' }, description: '이게 없으면 반대한다는 것' },
    risks: { type: 'array', items: { type: 'string' } },
    questionsForOthers: { type: 'array', items: { type: 'string' } },
  },
  required: ['role', 'summary', 'currentStateFindings', 'proposals', 'mustHaves', 'risks', 'questionsForOthers'],
}

const WP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '예: WP1' },
    name: { type: 'string' },
    features: { type: 'array', items: { type: 'string' }, description: '담당 FR 번호와 목업 화면 번호' },
    goal: { type: 'string' },
    ownsFiles: { type: 'array', items: { type: 'string' }, description: '이 패키지만 수정·생성할 수 있는 파일. test/ 기준 상대경로. 다른 패키지와 절대 겹치면 안 된다' },
    mayRead: { type: 'array', items: { type: 'string' } },
    consumes: { type: 'string', description: '기반 작업이 만들어 둔 어떤 계약(타입, 스토어 액션, 서비스 인터페이스, 스텁)을 쓰는지' },
    acceptance: { type: 'array', items: { type: 'string' }, description: '검수 기준. 명세서 예외 처리 열을 포함' },
  },
  required: ['id', 'name', 'features', 'goal', 'ownsFiles', 'mayRead', 'consumes', 'acceptance'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { topic: { type: 'string' }, decision: { type: 'string' }, rationale: { type: 'string' } },
        required: ['topic', 'decision', 'rationale'],
      },
    },
    scope: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fr: { type: 'string' },
          name: { type: 'string' },
          tier: { type: 'string' },
          status: { type: 'string', description: '기존 구현 있음 / 보강 필요 / 신규' },
          approach: { type: 'string' },
          wp: { type: 'string', description: '담당 작업 패키지 id 또는 FOUNDATION' },
        },
        required: ['fr', 'name', 'tier', 'status', 'approach', 'wp'],
      },
      description: '명세서의 모든 FR을 빠짐없이',
    },
    dependencies: { type: 'array', items: { type: 'string' }, description: 'npx expo install 로 설치할 패키지. 최소한으로' },
    foundation: {
      type: 'object',
      properties: {
        tasks: { type: 'array', items: { type: 'string' } },
        sharedFiles: { type: 'array', items: { type: 'string' }, description: '기반 작업과 통합 담당만 수정할 수 있는 공유 파일' },
        contracts: { type: 'string', description: '기반 작업이 만들어야 할 타입, 스토어 액션/셀렉터, 서비스 인터페이스, 라우트 이름을 구체적으로. 작업 패키지가 이것만 보고 병렬로 일할 수 있어야 한다' },
        stubs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, purpose: { type: 'string' }, wp: { type: 'string' } },
            required: ['path', 'purpose', 'wp'],
          },
          description: '기반 작업이 미리 만들고 라우트에 등록해 둘 빈 파일. 각 작업 패키지가 채운다',
        },
      },
      required: ['tasks', 'sharedFiles', 'contracts', 'stubs'],
    },
    workPackages: { type: 'array', items: WP_SCHEMA, description: '4-6개. ownsFiles가 서로 겹치지 않아야 한다' },
    designRules: { type: 'array', items: { type: 'string' } },
    qa: {
      type: 'object',
      properties: {
        testTargets: { type: 'array', items: { type: 'string' }, description: 'node --test 로 검증할 순수 로직 모듈과 시나리오' },
        demoScenario: { type: 'array', items: { type: 'string' }, description: '처음부터 끝까지 시연 순서' },
      },
      required: ['testTargets', 'demoScenario'],
    },
    minutesPath: { type: 'string' },
  },
  required: ['decisions', 'scope', 'dependencies', 'foundation', 'workPackages', 'designRules', 'qa', 'minutesPath'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reviewer: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'where', 'issue', 'fix'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['reviewer', 'findings', 'verdict'],
}

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fr: { type: 'string' },
          status: { type: 'string', enum: ['done', 'partial', 'skipped'] },
          note: { type: 'string' },
        },
        required: ['fr', 'status', 'note'],
      },
    },
    sharedChangeRequests: { type: 'array', items: { type: 'string' }, description: '소유하지 않은 파일에 필요한 변경. 직접 고치지 말고 여기 적는다' },
    ownFilesTscClean: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['id', 'summary', 'filesChanged', 'features', 'sharedChangeRequests', 'ownFilesTscClean', 'notes'],
}

// ---------------- 1. 킥오프 ----------------
phase('킥오프')
const ROLES = [
  { key: 'pm', name: 'PM', brief: '프로덕트 매니저. 명세서의 모든 FR을 빠짐없이 목록화하고, 각 FR이 기존 코드에 있는지 없는지 실제로 확인한다. 시연 시나리오(경주 2박 3일)가 처음부터 끝까지 끊기지 않는 것이 최우선이다. 범위 밖(환율 등)은 명확히 뺀다.' },
  { key: 'techlead', name: '테크리드', brief: '테크리드. 기존 코드 구조(src/core, src/services, src/store/useTrip.ts, App.tsx)를 실제로 읽고, 6개 안팎의 작업 패키지가 서로 파일을 겹치지 않고 병렬로 개발할 수 있는 아키텍처를 제안한다. 스토어를 기능별 슬라이스/별도 스토어로 나누는 방법, 서비스 중립 인터페이스, 그룹 동기화(서버 없이 갈지, 의존성 없는 Node 로컬 동기화 서버 + 폴링을 둘지)를 판단한다. 설치할 의존성은 최소로.' },
  { key: 'designer', name: '디자이너', brief: '디자이너(최윤재 역할). 핑크 목업 HTML과 HANDOFF의 확정 디자인 토큰을 읽고, React Native 공통 컴포넌트(src/ui.tsx)로 옮길 토큰·컴포넌트 목록과 화면별 적용 규칙을 제안한다. 목업 14화면 중 코드에 없는 화면(스플래시, 계산 중, 일정 편집, 경로 비교, 길찾기, 초대 공유 등)을 짚는다. 폰트(Hahmlet, Gothic A1) 적용 방법, AI 느낌 금지 규칙을 코드 규칙으로 바꾼다.' },
  { key: 'qa', name: 'QA 리드', brief: 'QA 리드. 명세서 예외 처리 열을 수용 기준으로 바꾼다. node --test 로 검증할 순수 로직(추출, 선별, 배분, 최적화, 시간표, 지연 감지, 도착 감지, 일기 생성, 추천)을 정하고, 로직이 React Native에 묶이지 않도록 core 계층 분리를 요구한다. 여행 시뮬레이터로 2·3차 실시간 기능을 시연·검증하는 방법을 제안한다.' },
]

const positions = (await parallel(ROLES.map(r => () =>
  agent(
    `${CTX}\n\n너의 역할: ${r.brief}\n\n킥오프 회의 전 입장문을 준비한다. 자료를 실제로 읽고 파일 경로를 들어 사실을 적어라. 추측으로 채우지 마라. 코드는 아직 수정하지 마라.`,
    { label: `킥오프:${r.name}`, phase: '킥오프', schema: POSITION_SCHEMA, effort: 'high' }
  )
))).filter(Boolean)
log(`킥오프 입장문 ${positions.length}건`)

// ---------------- 2. 킥오프 회의 ----------------
phase('킥오프 회의')
const draftPlan = await agent(
  `${CTX}\n\n너는 이 회의의 진행자이자 메인 책임자(한동관 역할)다. 네 명의 입장문을 읽고 충돌을 정리해 개발 계획 초안을 확정한다.\n\n입장문:\n${JSON.stringify(positions, null, 1)}\n\n해야 할 것:\n1. 기존 코드를 직접 확인해 입장문의 사실 주장이 맞는지 검증한다.\n2. 쟁점마다 결정하고 이유를 남긴다. 한쪽 손을 들어줬으면 왜 다른 쪽을 기각했는지도 적는다.\n3. 명세서의 모든 FR을 scope에 빠짐없이 넣는다.\n4. 기반 작업(공유 파일, 계약, 스텁, 의존성 설치, 디자인 토큰 적용)과 4-6개 작업 패키지로 나눈다. 작업 패키지의 ownsFiles는 서로 절대 겹치면 안 된다. 기존 화면 파일도 한 패키지에만 속해야 한다.\n5. 작업 패키지가 서로 기다리지 않도록 contracts를 구체적으로 적는다(타입 이름, 스토어 액션 시그니처, 서비스 인터페이스 메서드, 라우트 이름, 스텁 파일 경로).\n6. 회의록을 ${MEET}/01-킥오프.md 로 저장한다. 참석자, 안건, 쟁점별 발언 요지, 결정, 기각된 안, 할 일과 담당을 적는다. minutesPath에 그 경로를 넣는다.\n\n코드는 아직 수정하지 마라.`,
  { label: '킥오프 회의:진행', phase: '킥오프 회의', schema: PLAN_SCHEMA, effort: 'xhigh' }
)
if (!draftPlan) { return { error: '킥오프 회의 실패' } }
log(`초안: 작업 패키지 ${draftPlan.workPackages.length}개, FR ${draftPlan.scope.length}개`)

// ---------------- 3. 설계 리뷰 ----------------
phase('설계 리뷰')
const PLAN_REVIEWERS = [
  { key: 'coverage', name: '명세 커버리지', brief: '명세서의 모든 FR과 예외 처리 열이 계획에 빠짐없이 들어갔는지만 본다. 빠진 FR, 빠진 예외, 잘못 분류된 차수를 전부 잡는다. 목업 14화면이 전부 어느 패키지에 속하는지도 확인한다.' },
  { key: 'parallel', name: '병렬 충돌', brief: '작업 패키지들이 파일 충돌 없이 동시에 개발 가능한지만 본다. ownsFiles 겹침, 공유 파일을 몰래 고쳐야만 하는 패키지, 계약이 모호해 서로 기다리게 되는 지점을 잡는다. 기존 코드를 실제로 열어 확인한다.' },
  { key: 'feasibility', name: '기술 타당성', brief: 'Expo SDK 57 / RN 0.86 / 웹 번들에서 실제로 되는지만 본다. 제안된 의존성이 SDK 57과 호환되는지 npm view 와 Expo 문서로 확인하고, 웹(react-native-web)에서 깨질 모듈, 순수 로직이 RN에 묶여 node --test 로 못 도는 구조를 잡는다.' },
]
const planReviews = (await parallel(PLAN_REVIEWERS.map(r => () =>
  agent(
    `${CTX}\n\n너는 설계 리뷰 회의의 리뷰어(${r.name})다. ${r.brief}\n\n검토할 계획 초안:\n${JSON.stringify(draftPlan, null, 1)}\n\n칭찬하지 마라. 문제만 적어라. 없으면 없다고 해라. 코드는 수정하지 마라.`,
    { label: `설계 리뷰:${r.name}`, phase: '설계 리뷰', schema: REVIEW_SCHEMA, effort: 'high' }
  )
))).filter(Boolean)
log(`설계 리뷰 지적 ${planReviews.reduce((n, r) => n + r.findings.length, 0)}건`)

// ---------------- 4. 계획 확정 ----------------
phase('계획 확정')
const plan = await agent(
  `${CTX}\n\n너는 메인 책임자다. 설계 리뷰 회의 결과를 반영해 최종 계획을 확정한다.\n\n초안:\n${JSON.stringify(draftPlan, null, 1)}\n\n리뷰:\n${JSON.stringify(planReviews, null, 1)}\n\nblocker와 major는 전부 해소하거나, 해소하지 않는 이유를 decisions에 남긴다. ownsFiles 겹침은 0이어야 한다.\n최종 계획을 ${ROOT}/docs/plan.json 에도 저장한다(PLAN_SCHEMA 그대로의 JSON).\n회의록을 ${MEET}/02-설계리뷰.md 로 저장한다. 지적마다 수용/기각과 이유를 표로 적는다. minutesPath에 그 경로를 넣는다.\n코드는 아직 수정하지 마라.`,
  { label: '계획 확정', phase: '계획 확정', schema: PLAN_SCHEMA, effort: 'xhigh' }
)
if (!plan) { return { error: '계획 확정 실패', draftPlan, planReviews } }
log(`최종: 작업 패키지 ${plan.workPackages.map(w => w.id + ' ' + w.name).join(' / ')}`)

// ---------------- 5. 기반 작업 ----------------
phase('기반 작업')
const PLAN_TXT = JSON.stringify(plan, null, 1)
const foundation = await agent(
  `${CTX}\n\n너는 기반 작업 담당 엔지니어다. 최종 계획의 foundation 항목만 수행한다. 작업 패키지들이 바로 뒤이어 병렬로 일할 수 있게 만드는 것이 목표다.\n\n[중요 — 이어서 하는 작업] 이전 기반 작업 시도가 사용량 한도로 중간에 끊겼다. 처음부터 다시 하지 말고 현재 파일 상태에서 이어간다. 끊긴 시점의 상태:\n- ${APP}/legacy-v1/src 에 구 코드 22개 파일 복사 완료\n- 구 파일 삭제 완료: src/core/extract.ts, src/core/planner.ts, src/services/google.ts, src/services/local.ts, src/services/maps.ts, src/store/useTrip.ts, src/ui.tsx, src/screens/MapScreen.web.tsx\n- 의존성 설치 완료(package.json 반영): @expo-google-fonts/gothic-a1, @expo-google-fonts/hahmlet, expo-clipboard, expo-crypto, expo-font, expo-image-picker, expo-location, react-native-svg 추가, react-native-maps 제거\n- 새로 쓴 파일: src/types.ts(508줄), src/core/ports.ts(285줄), src/config.ts(18줄), app.config.js\n- 아직 없음: tests/, scripts/gate-scope.mjs, server/, src/data/, src/demo/, 스텁 화면, 새 ui, 새 스토어. 현재 tsc는 삭제된 파일 import 때문에 깨져 있다\n먼저 이미 쓴 types.ts, ports.ts, config.ts, app.config.js, package.json 이 최종 계획의 contracts 와 맞는지 검증하고, 맞지 않으면 고친 뒤 남은 단계를 이어서 끝낸다. 의존성은 이미 설치됐으니 다시 설치하지 말고 빠진 것만 추가한다.\n\n최종 계획:\n${PLAN_TXT}\n\n해야 할 것:\n1. dependencies를 ${APP} 에서 "npx expo install <패키지들>" 로 설치한다. 설치 실패 시 대안을 찾고 notes에 적는다.\n2. contracts에 적힌 타입, 스토어 액션/셀렉터 시그니처, 서비스 인터페이스, 라우트를 만든다. 구현이 필요한 부분은 명확한 TODO 스텁으로 두되 타입은 완결되게 한다.\n3. stubs 파일을 전부 만들고 App.tsx 라우트에 등록한다. 각 스텁은 화면 이름과 담당 패키지를 보여주는 임시 화면이면 된다.\n4. HANDOFF의 확정 디자인 토큰과 폰트(Hahmlet, Gothic A1)를 src/ui.tsx 공통 컴포넌트에 적용한다. 기존 화면이 자동으로 새 토큰을 따르게 한다.\n5. 앱 이름을 Young Trip으로 바꾼다(app.config.js, 헤더 제목 등).\n6. 기존 기능이 깨지지 않게 한다. 마지막에 npx tsc --noEmit 이 통과해야 한다.\n\nsharedFiles와 스텁 외의 파일, 즉 작업 패키지 소유 파일의 실제 기능은 만들지 마라.`,
  { label: '기반 작업:엔지니어', phase: '기반 작업', schema: BUILD_SCHEMA, effort: 'xhigh' }
)

const FOUND_REVIEWERS = [
  { key: 'contract', name: '계약 리뷰', brief: '작업 패키지 각각의 입장에서 계약을 읽고, 이 계약만으로 자기 일을 끝낼 수 있는지 본다. 빠진 액션, 모호한 타입, 공유 파일을 건드려야만 하는 지점을 잡는다. npx tsc --noEmit 을 직접 돌려라.' },
  { key: 'design', name: '디자인 리뷰', brief: 'src/ui.tsx 와 기존 화면이 HANDOFF 토큰과 핑크 목업을 따르는지 본다. 색 값, 폰트 적용, 라운드·그림자 규칙, AI 느낌 금지 항목 위반을 잡는다.' },
]
const foundReviews = (await parallel(FOUND_REVIEWERS.map(r => () =>
  agent(
    `${CTX}\n\n너는 기반 작업 코드 리뷰어(${r.name})다. ${r.brief}\n\n최종 계획:\n${PLAN_TXT}\n\n기반 작업 보고:\n${JSON.stringify(foundation, null, 1)}\n\n코드를 실제로 열어 확인하라. 코드는 수정하지 마라.`,
    { label: `기반 작업:${r.name}`, phase: '기반 작업', schema: REVIEW_SCHEMA, effort: 'high' }
  )
))).filter(Boolean)

const foundationFixed = await agent(
  `${CTX}\n\n너는 기반 작업 엔지니어다. 리뷰 지적을 반영한다.\n\n최종 계획:\n${PLAN_TXT}\n\n처음 보고:\n${JSON.stringify(foundation, null, 1)}\n\n리뷰:\n${JSON.stringify(foundReviews, null, 1)}\n\nblocker와 major를 전부 고친다. 마지막에 npx tsc --noEmit 통과를 확인한다.\n회의록 ${MEET}/03-기반작업-리뷰.md 를 저장한다. 지적마다 반영 여부와 이유.`,
  { label: '기반 작업:리뷰 반영', phase: '기반 작업', schema: BUILD_SCHEMA, effort: 'high' }
)
log(`기반 작업 완료: tsc ${foundationFixed && foundationFixed.ownFilesTscClean ? '통과' : '확인 필요'}`)

// ---------------- 6-8. 기능 개발 → 코드 리뷰 → 리뷰 반영 (패키지별 파이프라인) ----------------
const CODE_REVIEWERS = [
  { key: 'spec', name: '명세 준수', brief: '담당 FR과 명세서 예외 처리 열, 수용 기준이 실제로 구현됐는지 본다. 빠진 예외, 용어 위반, 확정 결정 위반을 잡는다.' },
  { key: 'correct', name: '정확성', brief: '버그, 타입 오류, 상태 경합, 경계값, 웹 번들에서 깨질 코드를 잡는다. 순수 로직이 core 계층에 있고 RN에 묶이지 않았는지 본다. npx tsc --noEmit 을 직접 돌려 자기 패키지 파일의 오류만 본다.' },
  { key: 'design', name: '디자인 충실도', brief: '담당 화면이 핑크 목업과 HANDOFF 토큰을 따르는지 본다. 목업의 해당 화면 번호를 직접 열어 비교한다. 이모지 아이콘, 임의 색, 금지된 스타일을 잡는다.' },
]

const wpResults = await pipeline(
  plan.workPackages,
  (wp) => agent(
    `${CTX}\n\n너는 작업 패키지 ${wp.id} "${wp.name}" 담당 엔지니어다.\n\n${RESUME[wp.id] ? '[중요 — 이어서 하는 작업] 이 패키지의 이전 시도가 사용량 한도로 중간에 끊겼다. 처음부터 다시 쓰지 말고 현재 파일 상태에서 이어간다. 끊기기 전에 이미 쓴 파일: ' + RESUME[wp.id].join(', ') + '. 이 파일들을 먼저 읽고 계획·계약과 맞는지 확인한 뒤, 빠진 부분과 아직 안 만든 ownsFiles를 채워 끝낸다. 다른 패키지도 같은 식으로 이어서 작업 중이다.\n\n' : ''}최종 계획(전체 맥락):\n${PLAN_TXT}\n\n너의 패키지:\n${JSON.stringify(wp, null, 1)}\n\n규칙:\n- ownsFiles 에 있는 파일만 수정·생성한다. 다른 파일은 읽기만 한다.\n- 다른 파일 변경이 꼭 필요하면 직접 고치지 말고 sharedChangeRequests 에 정확히 적는다.\n- 다른 패키지가 동시에 작업 중이다. npx tsc --noEmit 결과 중 네 파일의 오류만 책임진다.\n- 순수 로직은 src/core 계층(또는 계획이 정한 위치)에 RN 의존 없이 둔다.\n- 화면은 src/ui.tsx 공통 컴포넌트와 토큰만 쓴다.\n- 모의 제공자와 여행 시뮬레이터로 시연 가능해야 한다.\n- 수용 기준을 하나씩 확인하고 features 에 FR별 상태를 정직하게 적는다.`,
    { label: `개발:${wp.id} ${wp.name}`, phase: '기능 개발', schema: BUILD_SCHEMA, effort: 'high' }
  ),
  (build, wp) => parallel(CODE_REVIEWERS.map(r => () =>
    agent(
      `${CTX}\n\n너는 코드 리뷰 회의의 리뷰어(${r.name})다. ${r.brief}\n\n패키지:\n${JSON.stringify(wp, null, 1)}\n\n개발 보고:\n${JSON.stringify(build, null, 1)}\n\n패키지의 파일을 실제로 열어라. 칭찬 금지. 코드는 수정하지 마라.`,
      { label: `리뷰:${wp.id} ${r.name}`, phase: '코드 리뷰', schema: REVIEW_SCHEMA, effort: 'high' }
    )
  )).then(reviews => ({ build, reviews: reviews.filter(Boolean) })),
  (br, wp) => agent(
    `${CTX}\n\n너는 작업 패키지 ${wp.id} "${wp.name}" 담당 엔지니어다. 코드 리뷰 회의 결과를 반영한다.\n\n[이어서 하는 작업일 수 있음] 이전 반영 시도가 사용량 한도로 중간에 끊겼을 수 있다. 지적마다 현재 코드를 먼저 열어 이미 고쳐졌는지 확인하고, 고쳐졌으면 확인만 하고 넘어간다. 회의록 파일이 이미 있으면 이어서 채운다.\n\n패키지:\n${JSON.stringify(wp, null, 1)}\n\n개발 보고:\n${JSON.stringify(br.build, null, 1)}\n\n리뷰:\n${JSON.stringify(br.reviews, null, 1)}\n\nblocker와 major를 전부 고친다. ownsFiles 밖은 여전히 건드리지 않는다. 필요하면 sharedChangeRequests 에 적는다.\n회의록 ${MEET}/04-코드리뷰-${wp.id}.md 를 저장한다. 리뷰어별 지적, 반영 여부, 이유.`,
    { label: `반영:${wp.id} ${wp.name}`, phase: '리뷰 반영', schema: BUILD_SCHEMA, effort: 'high' }
  ).then(fixed => ({ wp: wp.id, name: wp.name, fixed, reviews: br.reviews }))
)
const wpDone = wpResults.filter(Boolean)
log(`작업 패키지 완료 ${wpDone.length}/${plan.workPackages.length}`)
const skippedWps = plan.workPackages.filter(w => !wpDone.find(d => d.wp === w.id)).map(w => w.id)
if (skippedWps.length) log(`실패한 패키지: ${skippedWps.join(', ')}`)

const sharedReqs = wpDone.flatMap(d => ((d.fixed && d.fixed.sharedChangeRequests) || []).map(s => `[${d.wp}] ${s}`))
  .concat(((foundationFixed && foundationFixed.sharedChangeRequests) || []).map(s => `[FOUNDATION] ${s}`))

// ---------------- 9. 통합 QA ----------------
phase('통합 QA')
const QA_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    results: { type: 'array', items: { type: 'string' }, description: '실행한 명령과 결과' },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['role', 'summary', 'filesChanged', 'results', 'openIssues'],
}
const WP_SUMMARY = JSON.stringify(wpDone.map(d => ({ wp: d.wp, name: d.name, features: d.fixed && d.fixed.features, files: d.fixed && d.fixed.filesChanged })), null, 1)

const qa = (await parallel([
  () => agent(
    `${CTX}\n\n너는 통합 담당 엔지니어다. 모든 패키지가 끝났다. 공유 파일 변경 요청을 적용하고 앱을 하나로 붙인다.\n\n최종 계획:\n${PLAN_TXT}\n\n패키지 결과:\n${WP_SUMMARY}\n\n공유 변경 요청:\n${JSON.stringify(sharedReqs, null, 1)}\n\n해야 할 것: 요청 적용, 남은 스텁 제거 또는 연결, 네비게이션 흐름 점검(목업 01~14 화면 순서대로 이동 가능), npx tsc --noEmit 통과, npx expo export --platform web --output-dir /tmp/yt-export 통과. tests/ 와 docs/ 는 다른 QA가 쓰고 있으니 건드리지 마라.`,
    { label: '통합 QA:통합', phase: '통합 QA', schema: QA_SCHEMA, effort: 'xhigh' }
  ),
  () => agent(
    `${CTX}\n\n너는 QA 엔지니어(로직 테스트)다. 계획의 qa.testTargets 를 node --test 로 검증하는 테스트를 ${APP}/tests/ 아래에만 작성한다. 시나리오 데이터는 HANDOFF의 경주 2박 3일을 쓴다. 확정 결정(제외 순서: 제안자 수 적은 순, 동점이면 등록 늦은 순, 고정은 안 빠짐, 조용한 제외 없음)을 반드시 테스트한다. 도착 감지(정확도 50m 이하 샘플, 반경 100m, 3분), 지연 감지(15분), 빈 시간 추천(30분) 수치도 테스트한다.\n테스트가 RN 모듈을 import 해서 못 돌면, 그 사실과 어떤 파일을 core로 분리해야 하는지 openIssues 에 적어라(src는 고치지 마라). package.json 에 "test" 스크립트가 필요하면 openIssues 에 적는다.\n\n최종 계획:\n${PLAN_TXT}\n\n패키지 결과:\n${WP_SUMMARY}`,
    { label: '통합 QA:로직 테스트', phase: '통합 QA', schema: QA_SCHEMA, effort: 'high' }
  ),
  () => agent(
    `${CTX}\n\n너는 QA 엔지니어(명세 추적)다. 명세서의 모든 FR을 행으로 하는 추적표를 ${ROOT}/docs/추적표.md 에 작성한다. 열: FR, 기능명, 차수, 구현 파일, 확인 방법(화면 경로 또는 테스트), 상태(구현/부분/미구현), 남은 문제. 코드를 실제로 열어 확인하라. 보고서의 주장을 믿지 마라. src와 tests는 수정하지 마라.\n\n패키지 결과:\n${WP_SUMMARY}`,
    { label: '통합 QA:명세 추적', phase: '통합 QA', schema: QA_SCHEMA, effort: 'high' }
  ),
])).filter(Boolean)

// ---------------- 10. 최종 점검 ----------------
phase('최종 점검')
const finalCheck = await agent(
  `${CTX}\n\n너는 릴리스 담당 엔지니어다. 통합 QA 결과를 받아 세 가지가 전부 통과할 때까지 고친다.\n1) npx tsc --noEmit\n2) node --test tests/  (package.json 에 "test" 스크립트가 없으면 추가)\n3) npx expo export --platform web --output-dir /tmp/yt-export\n\n통합 QA 결과:\n${JSON.stringify(qa, null, 1)}\n\n테스트가 틀렸으면 테스트를, 코드가 틀렸으면 코드를 고친다. 어느 쪽인지는 명세서가 기준이다.\n그다음 ${APP}/README.md 를 갱신한다: 실행 방법, 여행 시뮬레이터 사용법, 구현한 기능 표(FR 전부), 프로토타입이라 다른 점.\n회의록 ${MEET}/05-통합-QA.md 를 저장한다. 명령별 최종 결과를 그대로 적는다.`,
  { label: '최종 점검:릴리스', phase: '최종 점검', schema: QA_SCHEMA, effort: 'xhigh' }
)

// ---------------- 11. 회고 ----------------
phase('회고')
const RETRO_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    wentWell: { type: 'array', items: { type: 'string' } },
    wentWrong: { type: 'array', items: { type: 'string' } },
    nextActions: { type: 'array', items: { type: 'string' } },
  },
  required: ['role', 'wentWell', 'wentWrong', 'nextActions'],
}
const RETRO_CTX = JSON.stringify({ plan: plan.decisions, wp: wpDone.map(d => ({ wp: d.wp, features: d.fixed && d.fixed.features })), qa, finalCheck }, null, 1)
const retros = (await parallel([
  { key: 'pm', name: 'PM', brief: '범위와 일정 관점. 명세서 대비 무엇이 되고 무엇이 안 됐나. 시연 시나리오가 끊기는 지점.' },
  { key: 'tech', name: '테크리드', brief: '아키텍처와 품질 관점. 계약·병렬 분할이 잘 먹혔나. 기술 부채와 실제 제공자(카카오/네이버, 실제 AI)로 바꿀 때의 작업.' },
  { key: 'qa', name: 'QA 리드', brief: '검증 관점. 테스트로 보장되는 것과 안 되는 것. 사람이 직접 눌러봐야 하는 것.' },
].map(r => () =>
  agent(
    `${CTX}\n\n너는 ${r.name}다. 회고 회의 발언을 준비한다. ${r.brief}\n실제 코드와 docs를 확인하고 말하라.\n\n진행 기록:\n${RETRO_CTX}`,
    { label: `회고:${r.name}`, phase: '회고', schema: RETRO_SCHEMA, effort: 'high' }
  )
))).filter(Boolean)

const retroMinutes = await agent(
  `${CTX}\n\n너는 회고 회의 진행자(메인 책임자)다. 세 명의 발언을 모아 ${MEET}/06-회고.md 를 작성한다. 잘된 점, 문제점, 다음 액션(담당과 우선순위). 과장하지 말고 실제 결과대로 적는다.\n마지막으로 ${ROOT}/docs/README.md 에 docs 폴더 안내(회의록 목록, plan.json, 추적표)를 쓴다.\n\n발언:\n${JSON.stringify(retros, null, 1)}\n\n최종 점검 결과:\n${JSON.stringify(finalCheck, null, 1)}`,
  { label: '회고:진행', phase: '회고', effort: 'high' }
)

return {
  plan: { decisions: plan.decisions, workPackages: plan.workPackages.map(w => ({ id: w.id, name: w.name, features: w.features })) },
  foundation: foundationFixed,
  workPackages: wpDone.map(d => ({ wp: d.wp, name: d.name, features: d.fixed && d.fixed.features, notes: d.fixed && d.fixed.notes })),
  failedPackages: skippedWps,
  qa,
  finalCheck,
  retro: retroMinutes,
}
