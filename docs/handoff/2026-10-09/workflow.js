export const meta = {
  name: 'young-trip-dh-continue',
  description: '끊긴 한동관 기능 작업 이어하기: 남은 수정 3건, 실제 이동 시간·시뮬레이터 기능(구현·리뷰 3·수정), 문서·최종 검사',
  phases: [
    { title: '서버·경로', detail: '키 숨기는 서버 수정 → 실제 이동 시간(5)' },
    { title: '위치', detail: '동선 기록 2차 수정 → 시뮬레이터 길 따라가기(5)' },
    { title: '기반', detail: 'CI 마지막 리뷰 반영' },
    { title: '문서·최종 검사', detail: 'README·추적표 반영, 전체 게이트' },
  ],
}

const ROOT = '/Users/handong-gwan/IT희망학교 여행계획 프로젝트'
const APP = ROOT + '/test'
const SCRATCH = '/private/tmp/claude-501/-Users-handong-gwan-IT--------------/6161f0d7-d0df-45fe-b698-e6fffc883ebd/scratchpad'

const COMMON = `
## 프로젝트
Young Trip 여행 계획 앱 프로토타입. 앱은 ${APP} (Expo SDK 57, React Native 0.86, TypeScript strict, zustand, React Navigation).
레포 루트는 ${ROOT}. 너는 메인 책임자 한동관 담당(기반, 일정과 경로, 지도와 위치)의 남은 기능을 프로토타입에 이어서 만든다.
명령은 test/ 에서: npx tsc --noEmit · npm test (node:test, tests/**/*.test.ts) · node scripts/gate-scope.mjs WP<n>
임시 파일은 ${SCRATCH} 아래에만 둔다.

## 꼭 지킬 규칙
- .env 파일(test/.env, test/server/.env 등)은 절대 읽거나 고치지 않는다. 키가 들어 있다. .env.example 파일만 고친다.
- git commit, push, branch 조작을 하지 않는다.
- 개발 서버(expo start, npm run web), 브라우저, 헤드리스 크롬, expo export를 띄우지 않는다(구글 지도 Demo Key 하루 사용량과 키 든 번들 때문). 검증은 tsc와 테스트로 한다.
- 다른 에이전트들이 같은 작업 트리에서 다른 기능을 동시에 고친다(서버·경로 묶음 / 위치·시뮬레이터 묶음 / CI 묶음). 내 범위 밖 파일은 고치지 않는다.
  tsc나 테스트가 내 범위 밖 파일 때문에 실패하면 고치지 말고 30초쯤 뒤 다시 돌려 보고, 그래도 실패하면 결과에 적는다.
- README.md(루트·test 둘 다), docs/FR-추적표.md는 고치지 않는다. 마지막 문서 단계가 모아서 고친다. 문서에 넣을 내용은 doc_notes로 돌려준다.
- 의존성은 이미 설치돼 있다: pg, @types/pg, @electric-sql/pglite(devDependencies), expo-task-manager. 더 설치하지 않는다(꼭 필요하면 설치하지 말고 open_issues에 적는다).
- 새 파일은 tests/setup/ownership.json 글롭 하나에만 걸려야 한다(foundation-ownership 테스트). 새 테스트 파일 이름은 그 영역 패키지 번호로 tests/wp<N>-*.test.ts.
  영역: server/**·src/services/sync/**는 WP2, src/services/routes/**·src/core/planner/**·LegTransportScreen은 WP4,
  src/core/sim/**·src/core/live/**·src/store/live.ts·src/services/location/**·src/components/map/**·src/core/map/**·MapScreen·NavigateScreen·LiveTripScreen은 WP5,
  src/core/journal/**·RecordMapScreen은 WP6, src/config.ts·src/services/registry.ts·src/services/kakaoHttp.ts·package.json·app.config.js·App.tsx·index.ts·.env.example·scripts/**는 FOUNDATION.
- 디자인 규칙 테스트(tests/foundation-design-rules.test.ts): src/ui 밖에서 hex·rgba·fontFamily·fontSize 금지, 이모지와 저작권 기호(©)·텍스트 화살표 금지, 글자는 Txt만, radius 16 이하.
- process.env는 src/config.ts에서만 읽는다(앱 쪽). 새 앱 변수는 src/config.ts와 test/.env.example에 같이 넣는다. 서버 변수는 test/server/.env.example에 적는다.
- 저장 필드는 되도록 추가로만 바꾼다. 이름·타입을 바꾸면 STORAGE_VERSION(src/core/constants.ts) 규칙을 따른다.
- 키는 앱 번들에 넣지 않는다. 사용자 이메일과 현재 위치를 외부 서비스로 보내지 않는다.
- 코드 주석과 화면 문구는 주변 코드처럼 한국어로, 주변 코드의 말투·밀도·이름 짓기를 따른다. 화면 문구는 주변 화면 말투를 따른다.

## 메인 책임 결정(2026-10-09)
- DB는 PostgreSQL. 서버는 test/server(Node 24, node:http, 의존성 최소). 드라이버는 pg. 테스트는 @electric-sql/pglite(WASM Postgres, 데몬 불필요)로 같은 SQL을 돌린다.
  로컬 실 DB는 docker compose(postgres:17-alpine). DATABASE_URL이 없으면 서버는 지금처럼 메모리 저장으로 돈다. 실 Postgres 테스트는 YT_TEST_DATABASE_URL이 있을 때만 돈다.
- 그룹원 위치 공유는 만들지 않는다. 서버에 위치를 올리지 않는다.
- 이동 시간은 실제 길 시간(OSRM)을 계획에 쓴다. 예시 구간표(src/data/scenario-tuning.ts)에 있는 구간은 구간표가 우선이다(시연 수치 유지). 서버에 카카오 키가 있으면 자동차는 카카오.
- 백그라운드 동선 기록은 사용자가 켜는 옵션이고 기본은 꺼짐. Expo Go와 웹에서는 켤 수 없다고 안내한다.

## 지금 상태(시작점)
- 테스트 618개 통과, tsc 0. git에는 아직 커밋 안 된 변경이 많다(구글 지도, 도로 모양). git diff로 내 변경만 골라낼 수 없으니 바꾼 파일 목록을 정확히 돌려준다.
- 경로: src/services/routes/{index,local,kakao,osm,transit,cache}.ts. 선 모양은 osm.ts가 OpenStreetMap 공개 OSRM(https://routing.openstreetmap.de, routed-foot/routed-car, CORS 허용)에서 받는다.
  지금은 route()만 외부에 묻고 시간은 로컬 추정이며 matrix()는 외부 호출이 없다. RouteLeg(src/core/ports.ts)에 road('osm'|'kakao')·provisional 필드가 있다. provisional은 캐시하지 않는다.
- 설정: src/config.ts(ROAD_SHAPES, KAKAO_REST_KEY, SYNC_URL…), src/services/registry.ts(조립, describeServices).
- 서버: test/server/sync-server.mjs(메모리 저장, POST /trips/:id/ops, GET /trips/:id/ops?after=N, GET /invites/:code, POST /reset, CORS). 앱 쪽은 src/services/sync/http.ts. 서버 테스트는 tests/wp2-*.test.ts가 '../server/sync-server.mjs'를 확장자까지 적어 import한다.
- 카카오 REST 공용 클라이언트 src/services/kakaoHttp.ts(장소 dapi.kakao.com/v2/local/search/{keyword,category}.json, 자동차 apis-navi.kakaomobility.com/v1/directions).
- CI: ${ROOT}/.github/workflows/ci.yml(main만 대상).
`

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '무엇을 어떻게 만들었는지(한국어, 10줄 안팎)' },
    files_changed: { type: 'array', items: { type: 'string' }, description: '고치거나 만든 파일 경로(레포 루트 기준)' },
    tests_added: { type: 'array', items: { type: 'string' }, description: '추가한 테스트 이름' },
    gates: { type: 'string', description: 'tsc·npm test·게이트 결과(통과 수/실패 수와 실패 원인)' },
    doc_notes: { type: 'string', description: 'README·FR-추적표에 넣을 내용(사용법, 환경 변수, 결정, 한계)' },
    open_issues: { type: 'array', items: { type: 'string' }, description: '못 한 것, 확인 못 한 것, 사람이 해야 하는 것' },
  },
  required: ['summary', 'files_changed', 'gates', 'doc_notes', 'open_issues'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          line: { type: 'number' },
          problem: { type: 'string', description: '구체적 실패 상황(입력·상태 → 잘못된 결과)' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'fix'],
      },
    },
    verdict: { type: 'string', description: '한 줄 총평' },
  },
  required: ['findings', 'verdict'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    applied: { type: 'array', items: { type: 'string' }, description: '반영한 지적(한 줄씩)' },
    skipped: { type: 'array', items: { type: 'string' }, description: '반영 안 한 지적과 이유' },
    files_changed: { type: 'array', items: { type: 'string' } },
    gates: { type: 'string', description: '최종 tsc·npm test·게이트 결과' },
    doc_notes: { type: 'string', description: '구현 단계 doc_notes를 수정 반영해 최종본으로' },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['applied', 'skipped', 'files_changed', 'gates', 'doc_notes', 'open_issues'],
}

const LENSES = [
  {
    key: 'correctness',
    title: '정확성',
    prompt: `렌즈: 정확성·버그. 구현을 깨뜨리려고 읽어라. 경계값, 실패·시간 초과·부분 실패, 동시성·경쟁, 순서·멱등성, 캐시 일관성, SQL(트랜잭션, 인젝션, 인덱스, NULL), 타입 거짓말, 정리되지 않는 타이머·연결, 결정성.
필요하면 ${SCRATCH} 아래에 버릴 스크립트·테스트를 만들어 실제로 돌려 재현하라(레포 파일은 고치지 않는다). 재현한 것은 그렇다고 적어라. 추측만으로 blocker를 매기지 마라.`,
  },
  {
    key: 'rules',
    title: '규칙·테스트·보안',
    prompt: `렌즈: 프로젝트 규칙·테스트·보안. 직접 npx tsc --noEmit, npm test, 해당 영역 node scripts/gate-scope.mjs WP<n>을 돌려라.
소유권(ownership.json), 디자인 규칙 테스트, process.env는 config.ts만, .env.example 동기화, 키가 앱 번들에 들어가지 않는지, 사용자 위치·이메일이 외부로 나가지 않는지, 서버가 열린 프록시가 되지 않는지(허용 경로·파라미터 제한, 크기·속도 제한),
테스트가 실제 동작을 검증하는지(빠진 경로, 네트워크 의존, 결정성, 시간 의존), qa-decisions 같은 결정 테스트와 충돌하지 않는지 본다.`,
  },
  {
    key: 'integration',
    title: '통합·사용성',
    prompt: `렌즈: 앱 전체와의 연결·사용성. 이 기능이 실제 화면 흐름(시간표, 지도, 길찾기, 여행 진행, 기록 지도, 더보기 서비스 상태)과 시연 시나리오(경주 2박 3일)에 어떻게 이어지는지 따라가 보라.
키·서버가 없을 때와 실패했을 때 대체 동작과 화면 안내, 저장된 기존 데이터와의 호환, 성능(재계산 경로 예산 100구간, 외부 요청 수, 공개 OSRM 공정 사용), 한국어 문구와 주변 말투, 이름·패턴이 기존 코드와 맞는지,
doc_notes가 사실과 맞고 빠진 사용법이 없는지 본다.`,
  },
]

function implPrompt(f) {
  return `${COMMON}

# 너의 기능: ${f.title}
${f.spec}

## 할 일
1. 관련 코드를 먼저 충분히 읽고(기존 패턴을 따른다) 설계를 정한 뒤 구현한다.
2. 테스트를 추가한다. 네트워크·데몬 없이 결정적으로 돌아야 한다(fakeFetch, PGlite, 가짜 시계).
3. npx tsc --noEmit, npm test, 관련 node scripts/gate-scope.mjs WP<n>을 돌려 통과시킨다.
4. 결과를 스키마대로 돌려준다. files_changed는 빠짐없이.`
}

function reviewPrompt(f, impl, lens) {
  return `${COMMON}

# 리뷰 대상 기능: ${f.title}
## 기능 명세
${f.spec}

## 구현 결과(구현 에이전트 보고)
요약: ${impl.summary}
바꾼 파일: ${(impl.files_changed || []).join(', ')}
추가 테스트: ${(impl.tests_added || []).join(' / ')}
게이트: ${impl.gates}
남은 문제: ${(impl.open_issues || []).join(' / ')}

## 리뷰
${lens.prompt}
레포 파일은 고치지 않는다(읽기만). 바꾼 파일을 실제로 열어 읽어라. 명세에서 빠진 것도 지적한다.
지적마다 구체적 실패 상황과 고칠 방법을 쓴다. 문제가 없으면 findings를 비워라. 지어내지 마라.`
}

function fixPrompt(f, impl, reviews) {
  const lines = []
  reviews.forEach((r, i) => {
    if (!r) return
    lines.push(`### ${LENSES[i].title} 리뷰: ${r.verdict}`)
    for (const x of r.findings || []) lines.push(`- [${x.severity}] ${x.file}${x.line ? ':' + x.line : ''} — ${x.problem} → 고칠 방법: ${x.fix}`)
  })
  return `${COMMON}

# 수정 단계 기능: ${f.title}
## 기능 명세
${f.spec}

## 구현 결과
요약: ${impl.summary}
바꾼 파일: ${(impl.files_changed || []).join(', ')}
구현 doc_notes: ${impl.doc_notes}
구현 남은 문제: ${(impl.open_issues || []).join(' / ')}

## 리뷰 3건
${lines.join('\n') || '(지적 없음)'}

## 할 일
1. 지적마다 코드를 열어 사실인지 먼저 확인한다. 사실인 blocker·major는 모두 고친다. minor는 타당하고 범위 안이면 고친다. 리뷰끼리 엇갈리면 명세와 결정을 기준으로 고른다.
2. 사실이 아니거나 범위 밖이면 skipped에 이유를 적는다.
3. 고친 동작에는 테스트를 더한다.
4. npx tsc --noEmit, npm test, 관련 게이트를 다시 돌려 통과시킨다.
5. doc_notes를 최종본으로 정리해 돌려준다.`
}

async function runFeature(f, ph) {
  log(`${f.title}: 구현 시작`)
  const impl = await agent(implPrompt(f), { label: `${f.key}:구현`, phase: ph, schema: IMPL_SCHEMA })
  if (!impl) {
    log(`${f.title}: 구현 에이전트 실패`)
    return { feature: f.key, title: f.title, failed: true }
  }
  const reviews = await parallel(
    LENSES.map((lens) => () => agent(reviewPrompt(f, impl, lens), { label: `${f.key}:리뷰-${lens.title}`, phase: ph, schema: REVIEW_SCHEMA })),
  )
  const counts = reviews.map((r) => (r ? (r.findings || []).length : 0))
  log(`${f.title}: 리뷰 지적 ${counts.join('/')}건`)
  const fix = await agent(fixPrompt(f, impl, reviews), { label: `${f.key}:수정`, phase: ph, schema: FIX_SCHEMA })
  return { feature: f.key, title: f.title, impl, reviews, fix }
}

const F_SERVER = {
  key: 'server-db',
  title: '1. PostgreSQL 서버·DB',
  spec: `범위: test/server/**, src/services/sync/**(필요할 때만), package.json scripts, tests/wp2-*.test.ts.
- 동기화 서버를 PostgreSQL로 영속화한다. 저장소 인터페이스(메모리 | Postgres)를 두고, DATABASE_URL이 있으면 pg.Pool, 없으면 지금 메모리 동작 그대로. 테스트는 같은 Postgres 저장소를 PGlite로 돌린다(pg.Pool과 PGlite는 둘 다 query(text, params) → {rows}).
- 스키마는 버전 관리되는 마이그레이션(test/server/db/migrations/*.sql 등)으로 만들고, 시작 때 한 번만 적용한다(재실행 안전, 동시 시작 안전).
- 테이블: 여행방 이벤트 로그(trip_id, seq, op_id 유일, 받은 시각, 본문 jsonb)와 초대 코드 색인이 원천이다. 역할분담의 한동관 테이블(여행방·장소·경로·일정)을 위해
  로그에서 바로 뽑을 수 있는 조회용 표(여행방 요약, 장소/스팟, 일정)를 같은 트랜잭션에서 갱신한다. src/core/ops/*.ts의 op 종류를 읽고, 리듀서 전체를 서버에 복제하지 말고 op에 들어 있는 값만 옮긴다(설계와 한계를 doc_notes에).
  경로 캐시 테이블(route_cache: 키, 응답 jsonb, 만든 시각)도 만든다. 다음 기능(키 숨기는 서버)이 OSRM·카카오 응답 24시간 캐시에 쓴다. 위치 테이블은 만들지 않는다(위치를 서버에 올리지 않는다는 결정).
- 기존 HTTP API(POST /trips/:id/ops → {acks}, GET /trips/:id/ops?after=N, GET /invites/:code, POST /reset, OPTIONS)의 응답 모양과 seq·멱등 규칙은 그대로. GET /health → {ok, db:'postgres'|'memory'} 추가.
- 보관 기한 정리: 여행 종료 1년 뒤 여행방 데이터 삭제(README 보관 정책과 같게). 서버 시작 때와 하루 한 번.
- 실행: package.json에 "server"(node --env-file-if-exists=server/.env server/sync-server.mjs), "db:up"/"db:down"(docker compose -f server/docker-compose.yml). test/server/docker-compose.yml(postgres:17-alpine, 볼륨, 포트 5432, 개발용 계정), test/server/.env.example(DATABASE_URL, PORT).
- 연결 실패 시 서버가 조용히 메모리로 바뀌지 않는다(DATABASE_URL을 줬는데 못 붙으면 에러로 멈춘다).
- 테스트: PGlite로 멱등 op, seq 순서, after 조회, 초대 색인, 조회용 표 갱신, 보관 정리, 마이그레이션 재실행. 기존 wp2 서버 테스트는 메모리로 그대로 통과. YT_TEST_DATABASE_URL이 있으면 같은 테스트를 실 Postgres로도 돈다(없으면 건너뜀).`,
}

const F_PROXY = {
  key: 'api-proxy',
  title: '2. 키 숨기는 서버(카카오·경로 프록시)',
  spec: `범위: test/server/**, src/services/kakaoHttp.ts, src/services/places/kakao.ts(필요할 때만), src/services/routes/**, src/config.ts, src/services/registry.ts, test/.env.example, test/server/.env.example, 테스트.
앞 기능에서 서버가 PostgreSQL 저장소와 route_cache 테이블을 갖췄다. 그 위에 만든다.
- 서버 프록시 엔드포인트: 카카오 장소(키워드·카테고리), 카카오모빌리티 자동차 길찾기, OSRM(route·table, foot·car). 서버는 KAKAO_REST_KEY를 서버 환경 변수에서만 읽어 Authorization: KakaoAK 헤더를 붙인다. OSRM 상류는 OSRM_URL(기본 https://routing.openstreetmap.de).
- 열린 프록시 금지: 허용한 경로·파라미터만 전달, 좌표 개수·요청 크기 상한, IP별 간단한 속도 제한, 상류 시간 초과, 상류 상태 코드 전달. 카카오 키가 없으면 카카오 엔드포인트는 503과 이유. 응답에 키가 섞이지 않는다.
- OSRM·카카오 길찾기 응답은 route_cache에 24시간(메모리 저장소면 메모리) 캐시하고, 공개 OSRM에는 동시 요청을 1~2개로 줄여 보낸다(공정 사용).
- 앱: 새 환경 변수 EXPO_PUBLIC_API_URL(서버 주소). 있으면 카카오 요청은 키 없이 서버로 가고(EXPO_PUBLIC_KAKAO_REST_KEY 없이도 카카오 장소·자동차가 켜진다), 도로 모양(ROAD_SHAPES)의 기본 주소도 서버 OSRM 경로가 된다(osm.ts의 URL 형식과 맞춘다).
  서버가 503이면 기존 대체(로컬 장소 사전, 추정 경로)로 넘어간다. EXPO_PUBLIC_KAKAO_REST_KEY는 '시연 한정 직접 호출'로 남기되 API_URL이 있으면 쓰지 않는다.
- describeServices(더보기 서비스 상태)에 서버 경유 여부를 정확히 적는다.
- 테스트: 서버에 가짜 상류 fetch를 주입해 헤더·허용 목록·속도 제한·캐시·503을, 앱 쪽은 fakeFetch로 프록시 URL·헤더 없음·대체 동작을 본다.`,
}

const F_TIME = {
  key: 'real-time',
  title: '3. 실제 길 기준 이동 시간',
  spec: `범위: src/services/routes/**, src/core/planner/**(꼭 필요할 때만), src/screens/LegTransportScreen.tsx·NavigateScreen.tsx(추정 칩 문구만), tests/wp4-*.test.ts, tests/qa-decisions.test.ts(결정 바뀜 반영).
앞 기능에서 서버 OSRM 프록시와 EXPO_PUBLIC_API_URL이 생겼다. ROAD_SHAPES 설정이 가리키는 OSRM(서버 또는 공개)을 쓴다.
- matrix(): 도보·자동차에서 예시 구간표(src/data/scenario-tuning.ts)에 없는 구간은 OSRM table 서비스(GET {base}/{profile}/table/v1/{foot|driving}/{좌표들}?sources=..&destinations=..&annotations=duration,distance, 2026-10 확인: routed-foot에서 동작)로 한 번에 받는다. 구간표에 있는 구간은 구간표 값(시연 수치 유지).
  자동차는 카카오(서버 또는 키)가 있으면 카카오가 우선. 대중교통은 모의 모델 그대로(승차 시간을 자동차 길 시간으로 바꿀지는 판단해 근거를 doc_notes에).
- 자동차 OSRM 시간은 교통 정보가 없어 짧게 나온다. 계수 상수(예: core/constants 또는 routes 안)를 두고 근거를 주석과 doc_notes에 적는다. 도보는 OSRM 그대로.
- route(): 같은 구간이면 matrix와 같은 분을 낸다(경로 비교와 계획이 어긋나지 않게). 실제 길 시간이면 estimated=false. 시간이 추정인 경우만 '시간 추정' 칩이 뜨게 화면 판단을 맞춘다.
- 실패·시간 초과는 지금처럼 직선 추정으로 대체하고 estimated를 세우며 캐시하지 않는다(provisional과 같은 원리). 재계산 경로 예산(1회 100구간)과 calls·cacheHits 세는 규칙(A11)을 지킨다. table 한 번이 여러 구간이면 calls는 구간 수다.
- roadShapes 없이 만든 제공자(테스트·골든)는 지금과 똑같이 외부 호출이 없다. 골든 계획 테스트는 그대로 통과해야 한다.
- qa-decisions의 '도보·대중교통은 외부로 묻지 않는다' 결정은 '도로 경로 서버를 켜면 도보 시간도 실제 길에서 받는다'로 바뀌었다. 테스트와 주석을 결정에 맞게 고친다(roadShapes 없을 때는 여전히 외부 호출 0).
- 테스트: table 파싱, 구간표 우선, 혼합 행렬, 실패 대체, 캐시, route·matrix 일치, 예산.`,
}

const F_TRACK = {
  key: 'track',
  title: '4. 동선 기록 보완(백그라운드 옵션·권한 거부 기록·기록 지도 색)',
  spec: `범위: src/core/live/**, src/core/journal/**, src/store/live.ts, src/services/location/**, src/screens/LiveTripScreen.tsx, src/screens/RecordMapScreen.tsx, src/features/live/**, src/features/journal/**, app.config.js, App.tsx 또는 index.ts(작업 등록만), tests/wp5-*·wp6-*.test.ts.
- 백그라운드 위치 기록 옵션: 기본 꺼짐. 여행 진행 화면(또는 알맞은 설정 자리)에서 사용자가 켠다. expo-location startLocationUpdatesAsync + expo-task-manager(defineTask는 모듈 최상위에서 한 번).
  안드로이드는 포그라운드 서비스 알림 문구, iOS는 UIBackgroundModes location과 '항상 허용' 권한 문구(app.config.js의 expo-location 플러그인 옵션 isIosBackgroundLocationEnabled·isAndroidBackgroundLocationEnabled, 권한 문구).
  켤 때만 백그라운드 권한을 묻는다. 웹과 Expo Go(Constants.executionEnvironment 등)에서는 켤 수 없다고 이유를 안내한다(개발 빌드 필요). 여행 진행이 끝나거나 끄면 멈춘다.
  백그라운드에서 받은 샘플은 같은 동선 저장소로 들어가 기존 정확도·간격 규칙(core/live/throttle, track)을 따른다. 켜져 있는 동안은 '기록 없는 구간(공백)'으로 보지 않는다. 시뮬레이터 모드에는 영향 없음.
  서버로 보내지 않는다. 90일 보관 정리는 그대로.
- 권한 거부 기록을 날짜별로 남긴다(FR-704 남은 문제: 지금은 날짜별로 안 남아 기록 지도가 그날 거부였는지 모른다). 기록 지도는 그 날짜를 '위치 권한이 없어 도착 지점만 이었다'로 안내.
- 기록 지도(FR-804) 넷째 날부터 계획 선과 실제 이동 점 색이 같아져 구분이 안 되는 문제를 고친다(날짜 색 체계 core/constants dayColor와 RecordMap 범례 확인).
- 코드 설계상 Expo Go에서 import만으로 깨지지 않게(expo-task-manager가 없는 환경 방어).
- 테스트: 순수 로직(옵션 가능 여부 판정, 공백 판정, 날짜별 권한 기록, 색 구분)을 테스트한다. 실기기 확인은 open_issues에 적는다.`,
}

const F_SIM = {
  key: 'sim-road',
  title: '5. 시뮬레이터 위치가 길을 따라가기',
  spec: `범위: src/core/sim/**, src/store/live.ts, src/features/live/**, src/components/map/useLegGeometry.ts(필요할 때만), tests/wp5-*.test.ts.
앞 기능(동선 기록 보완)이 store/live.ts를 고쳤을 수 있다. 그 위에 만든다.
- 지금 시뮬레이터(core/sim/track.ts generateTrack)는 스팟 사이를 직선(lerp)으로 움직여서, 지도 선은 길을 따르는데 점은 질러 간다.
- generateTrack 입력에 구간별 모양(선택)을 받아, 있으면 그 선을 따라 거리 비율로 움직인다(같은 입력이면 같은 샘플: 결정성 유지, 프리셋 수정·지연·이어서 만들기(resume)도 같은 방식).
  선이 핀에서 떨어져 시작·끝나도 도착 판정(반경 100m, 3분)이 그대로 되게 끝점을 핀에 잇는다(core/map/model.legShape와 같은 원리).
- store/live.ts가 궤적을 만들기 전에 그날 구간 모양을 경로 제공자(getServices().routes.route, 24시간 캐시)에서 받는다. 시간 상한을 두고 못 받으면 직선으로 만든다. 시뮬레이터 시작이 느려지지 않게(병렬, 상한).
- 길찾기 화면 진행률(polylineProgress)과 안내 줄 선택이 시뮬레이터 점과 맞는지 확인한다.
- 테스트: 모양을 주면 점이 선 위(근처)에 있고, 모양이 없으면 기존과 같은 샘플(기존 wp5-sim 테스트 그대로 통과), 도착 감지가 그대로 된다.`,
}

const F_CI = {
  key: 'ci',
  title: '6. CI를 GitFlow에 맞추기',
  spec: `범위: ${ROOT}/.github/**, ${ROOT}/CONTRIBUTING.md, ${ROOT}/협업규칙.md, ${ROOT}/.githooks/**(있으면). 이 기능만 CONTRIBUTING.md·협업규칙.md를 고칠 수 있다. 앱 코드는 고치지 않는다.
- 브랜치 전략은 GitFlow로 정했다: main(배포), develop(통합), feature/*, release/*, hotfix/*. 지금 원격에는 main, develop이 있다.
- ci.yml: push(main, develop, feature/**, release/**, hotfix/**)와 pull_request(main, develop)에서 돈다. 단계는 지금 것(npm ci, tsc, npm test, 웹 번들 빌드, ttf 4개) 유지.
  실 PostgreSQL 검사 잡을 더한다: services postgres:17-alpine, YT_TEST_DATABASE_URL을 넘겨 서버 DB 테스트를 실 Postgres로도 돈다(다른 기능이 YT_TEST_DATABASE_URL이 있을 때만 실 DB 테스트를 돌게 만든다). CI에는 키를 넣지 않는다(저장소 secret 추가 금지).
- CONTRIBUTING.md와 협업규칙.md에서 'PR 베이스는 언제나 main' 같은 GitFlow와 어긋나는 규칙을 GitFlow(feature → develop PR, release/hotfix → main과 develop, 태그는 main) 기준으로 고친다. 구조와 문체는 유지하고 바뀌는 문장만 고친다. .github/pull_request_template.md도 맞춘다.
- 커밋 범위 목록에 서버 DB(db)가 이미 있는지 확인하고 없으면 더한다.
- 검증: YAML 문법(node로 파싱하거나 구조 확인), actionlint가 없으면 눈으로. 결과 doc_notes에 브랜치 규칙 요약.`,
}


const CONT = SCRATCH + '/continue'

function fixFromFile(title, specText, file) {
  return `${COMMON}

# 이어하기 수정 단계: ${title}
앞선 작업이 사용량 한도로 여러 번 끊겼다. 구현·리뷰 결과와 이미 반영한 수정은 파일 ${file}에 있다. 먼저 그 파일을 끝까지 읽어라.
## 기능 명세
${specText}

## 할 일
1. 끊긴 수정 에이전트가 일부만 고치고 멈췄을 수 있다. 지금 코드를 열어 지적마다 이미 반영됐는지, 사실인지 먼저 확인한다.
2. 아직 남은 사실인 blocker·major는 모두 고친다. minor는 타당하고 범위 안이면 고친다. 리뷰끼리 엇갈리면 명세와 결정을 기준으로 고른다.
3. 사실이 아니거나 범위 밖이면 skipped에 이유를 적는다. 고친 동작에는 테스트를 더한다.
4. npx tsc --noEmit, npm test, 관련 게이트를 다시 돌려 통과시킨다.
5. doc_notes는 이 기능 전체(구현 + 모든 수정)를 기준으로 최종본을 돌려준다.`
}

const results = await parallel([
  async () => {
    const out = []
    const fx = await agent(fixFromFile(F_PROXY.title, F_PROXY.spec, CONT + '/api-proxy.md'), { label: 'api-proxy:수정', phase: '서버·경로', schema: FIX_SCHEMA })
    out.push({ feature: 'api-proxy', title: F_PROXY.title, fixOnly: true, fix: fx })
    out.push(await runFeature(F_TIME, '서버·경로'))
    return out
  },
  async () => {
    const out = []
    const fx = await agent(fixFromFile(F_TRACK.title + ' (2차 수정)', F_TRACK.spec, CONT + '/track.md'), { label: 'track:2차수정', phase: '위치', schema: FIX_SCHEMA })
    out.push({ feature: 'track', title: F_TRACK.title, fixOnly: true, fix: fx })
    out.push(await runFeature(F_SIM, '위치'))
    return out
  },
  async () => {
    const fx = await agent(fixFromFile(F_CI.title + ' (마지막 리뷰 반영)', F_CI.spec, CONT + '/ci.md'), { label: 'ci:마지막수정', phase: '기반', schema: FIX_SCHEMA })
    return [{ feature: 'ci', title: F_CI.title, fixOnly: true, fix: fx }]
  },
])

const all = results.filter(Boolean).flat().filter(Boolean)
const notes = all
  .map((r) => {
    if (r.failed) return `## ${r.title}\n(구현 실패)`
    const fx = r.fix || {}
    if (r.fixOnly) return `## ${r.title} (이어하기 수정)\n반영: ${(fx.applied || []).join(' / ')}\n바꾼 파일: ${(fx.files_changed || []).join(', ')}\n문서 메모: ${fx.doc_notes || '(수정 실패)'}\n남은 문제: ${(fx.open_issues || []).join(' / ')}`
    return `## ${r.title}
요약: ${r.impl.summary}
바꾼 파일: ${[...new Set([...(r.impl.files_changed || []), ...(fx.files_changed || [])])].join(', ')}
문서 메모: ${fx.doc_notes || r.impl.doc_notes}
남은 문제: ${[...(fx.open_issues || r.impl.open_issues || [])].join(' / ')}`
  })
  .join('\n\n')

phase('문서·최종 검사')
const docs = await agent(
  `${COMMON}

# 마지막 단계: 문서 반영과 전체 검사
6개 기능이 끝났다. 이제 README.md 금지 규칙은 풀렸다. 너만 문서를 고친다.
먼저 ${CONT}/done-notes.md(서버·DB, 동선 기록 1차 수정, CI 수정의 문서 메모)를 끝까지 읽어라. 아래는 이번에 끝난 작업이다.

${notes}

## 할 일
1. ${APP}/README.md(환경 변수 표, 외부 연동 절, 서버 실행·DB 절, 한계·알려진 문제, 검증 상태)와 ${ROOT}/docs/FR-추적표.md(해당 FR 줄의 구현 파일·테스트·남은 문제, 데이터 보존·탈퇴 행)를 사실대로 고친다. 코드를 열어 문서 메모가 맞는지 확인한다.
   루트 ${ROOT}/README.md에 서버 실행 안내가 필요하면 짧게 더한다. CONTRIBUTING.md는 CI 기능이 이미 고쳤으니 서버·DB 메모(환경 변수 표 등)만 더한다. 주변 문체(한국어 '-다'체, 짧은 문장) 유지.
2. test/.env.example, test/server/.env.example가 config.ts와 서버 코드가 읽는 변수와 정확히 같은지 확인하고 고친다(값은 비운다).
3. 전체 검사: npx tsc --noEmit, npm test, node scripts/gate-scope.mjs WP2 / WP4 / WP5 / WP6. 실패하면 원인을 찾아 고친다(문서가 아닌 코드 실패면 가장 좁게 고치고 적는다).
4. 결과: 고친 문서, 검사 결과, 사람이 해야 할 일(실기기·키·Docker) 목록.`,
  { label: '문서·최종검사', phase: '문서·최종 검사', schema: FIX_SCHEMA },
)

return {
  features: all.map((r) => ({
    key: r.feature,
    title: r.title,
    fixOnly: !!r.fixOnly,
    failed: !!r.failed,
    impl_summary: r.impl ? r.impl.summary : null,
    review_counts: r.reviews ? r.reviews.map((x) => (x ? (x.findings || []).length : null)) : null,
    fix_applied: r.fix ? r.fix.applied : null,
    fix_skipped: r.fix ? r.fix.skipped : null,
    gates: r.fix ? r.fix.gates : r.impl ? r.impl.gates : null,
    open_issues: r.fix ? r.fix.open_issues : r.impl ? r.impl.open_issues : null,
  })),
  docs,
}
