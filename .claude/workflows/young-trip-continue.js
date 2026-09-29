export const meta = {
  name: 'young-trip-continue',
  description: 'Young Trip 전 기능 프로토타입 이어하기 — 남은 코드 리뷰, 리뷰 반영, 통합 QA, 최종 점검, 회고. 결과를 파일로 남기고 이미 끝난 일은 건너뛴다',
  phases: [
    { title: '코드 리뷰', detail: '아직 리뷰가 없는 패키지만' },
    { title: '리뷰 반영', detail: '패키지마다 수정 + 회의록 04' },
    { title: '통합 QA', detail: '통합·로직 테스트·명세 추적 병렬' },
    { title: '최종 점검', detail: 'tsc · npm test · 웹 번들 통과까지 + 회의록 05' },
    { title: '회고', detail: 'PM·테크리드·QA 발언 + 진행자 회의록 06' },
  ],
}

// args.done: docs/workflow-state 에 이미 있는 파일 이름 목록. 있으면 그 일은 건너뛴다.
const DONE = new Set((args && args.done) || [])
const has = (f) => DONE.has(f)

const ROOT = '/Users/handong-gwan/IT희망학교 여행계획 프로젝트'
const APP = ROOT + '/test'
const MEET = ROOT + '/docs/meetings'
const STATE = ROOT + '/docs/workflow-state'
const PLAN = ROOT + '/docs/plan.json'

const WPS = [
  { id: 'WP1', name: '계정·세션·홈·설정' },
  { id: 'WP2', name: '여행방·그룹·동기화' },
  { id: 'WP3', name: '대화 인식·후보·추천' },
  { id: 'WP4', name: '일정·경로' },
  { id: 'WP5', name: '지도·실시간·여행 시뮬레이터' },
  { id: 'WP6', name: '기록·일기' },
]
const REVIEWERS = [
  { key: 'spec', name: '명세 준수', brief: '담당 FR과 명세서 예외 처리 열, 수용 기준이 실제로 구현됐는지 본다. 빠진 예외, 용어 위반, 확정 결정 위반을 잡는다.' },
  { key: 'correct', name: '정확성', brief: '버그, 타입 오류, 상태 경합, 경계값, 웹 번들에서 깨질 코드를 잡는다. 순수 로직이 core 계층에 있고 RN에 묶이지 않았는지 본다. npx tsc --noEmit 과 node scripts/gate-scope.mjs <패키지> 를 직접 돌린다.' },
  { key: 'design', name: '디자인 충실도', brief: '담당 화면이 핑크 목업과 HANDOFF 토큰을 따르는지 본다. 목업의 해당 화면을 직접 열어 비교한다. 이모지 아이콘, 임의 색, 금지된 스타일을 잡는다.' },
]

const CTX = `
회사: Young Trip 개발팀. 너는 이 팀의 구성원이다.
제품: Young Trip — 그룹 채팅에서 나온 "가고 싶은 곳"을 여행 루트로 자동 변환하는 한국어 모바일 앱.

자료:
- 기능명세서 v0.2: ${ROOT}/여행계획-앱-기능명세서-v0.2.md  (범위의 유일한 기준)
- 인계 문서(디자인 토큰, 시나리오 데이터, 용어, 확정 결정): ${ROOT}/HANDOFF.md
- 핑크 목업: ${ROOT}/여행계획-앱-핑크-캔버스.html
- 확정 계획: ${PLAN}  (결정, 범위, 계약, 작업 패키지, 수용 기준)
- 회의록: ${MEET}/01-킥오프.md, 02-설계리뷰.md, 03-기반작업-리뷰.md
- 앞 단계 결과 파일: ${STATE}/  (WPn-build.json = 개발 보고, WPn-review-*.json = 코드 리뷰, foundation.json = 기반 작업 보고)
- 코드: ${APP}  (Expo SDK 57, RN 0.86, TypeScript, zustand, react-navigation, react-native-svg)
- 파일 소유권: ${APP}/tests/setup/ownership.json  (패키지는 자기 파일만 고친다)
- 패키지 게이트: cd ${APP} && node scripts/gate-scope.mjs WPn

진행 상황: 기반 작업과 작업 패키지 6개 개발이 끝났다. 시작 시점 기준 npm test 459개 중 447 통과, 6 실패(wp1-auth 3, wp2-invite 1, wp2-sync 2), todo 6(골든 — 통합 때 푼다). tsc 오류 2개(InviteAcceptScreen.tsx). 이전 실행이 사용량 한도로 여러 번 끊겼으므로, 네 일의 일부가 이미 반영돼 있을 수 있다. 항상 현재 파일을 먼저 읽고 판단한다.

고정 규칙:
- 앱 이름 Young Trip. 용어 고정: 후보 / 확정 스팟 / 제외 스팟 / 고정 / 기점 / 수용량 / 제안자 / 조정안 / 여행방 / 그룹방 / 게스트.
- 확정 결정을 되돌리지 않는다: 확정 버튼 없음·자동 선별, 1단계 도보·자동차(대중교통은 2차), 국내 전용·SDK 중립, 게스트 세션.
- 명세서에 없는 기능(환율 등)은 만들지 않는다.
- 개발 서버(expo start 등 끝나지 않는 명령)를 띄우지 않는다. 검증은 npx tsc --noEmit, npm test, npx expo export --platform web --output-dir /tmp/yt-export 로만 한다.
- git commit, push, branch 조작 금지.
- python3 는 이 기기에서 Xcode 라이선스 문제로 실행되지 않는다. 스크립트가 필요하면 node 를 쓴다.
- 문서는 한국어 평문. 코드 주석은 기존 밀도와 말투를 따른다.
- 끝나기 직전에 네 결과를 지정된 경로에 JSON 파일로 저장하고, 같은 내용을 반환한다. 이 파일이 다음 단계의 입력이고, 끊겼을 때 이어하는 근거다.
`

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

const FIX_SCHEMA = {
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
    findingsResolved: { type: 'number' },
    findingsDeferred: { type: 'array', items: { type: 'string' }, description: '고치지 않은 지적과 이유' },
    sharedChangeRequests: { type: 'array', items: { type: 'string' }, description: '소유하지 않은 파일에 필요한 변경' },
    gateResult: { type: 'string', description: 'node scripts/gate-scope.mjs WPn 의 마지막 결과 요약' },
    notes: { type: 'string' },
  },
  required: ['id', 'summary', 'filesChanged', 'features', 'findingsResolved', 'findingsDeferred', 'sharedChangeRequests', 'gateResult', 'notes'],
}

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

log(`건너뛸 결과 파일 ${DONE.size}개`)

// ---------------- 코드 리뷰(남은 것) → 리뷰 반영, 패키지별 파이프라인 ----------------
const fixes = await pipeline(
  WPS,
  (wp) => {
    const todo = REVIEWERS.filter(r => !has(`${wp.id}-review-${r.key}.json`))
    if (!todo.length) return Promise.resolve([])
    return parallel(todo.map(r => () =>
      agent(
        `${CTX}\n\n너는 코드 리뷰 회의의 리뷰어(${r.name})다. 대상은 작업 패키지 ${wp.id} "${wp.name}".\n${r.brief}\n\n먼저 읽을 것: ${PLAN} 의 workPackages 중 ${wp.id} 항목(ownsFiles, acceptance), ${STATE}/${wp.id}-build.json, ${APP}/tests/setup/ownership.json 의 ${wp.id} 목록.\n패키지 파일을 실제로 열어라. 칭찬 금지. 코드는 수정하지 마라.\n\n결과를 ${STATE}/${wp.id}-review-${r.key}.json 에 저장하고 반환한다.`,
        { label: `리뷰:${wp.id} ${r.name}`, phase: '코드 리뷰', schema: REVIEW_SCHEMA, effort: 'high' }
      )
    ))
  },
  (_reviews, wp) => {
    if (has(`${wp.id}-fix.json`)) return Promise.resolve({ id: wp.id, skipped: true })
    return agent(
      `${CTX}\n\n너는 작업 패키지 ${wp.id} "${wp.name}" 담당 엔지니어다. 코드 리뷰 회의 결과를 반영한다.\n\n먼저 읽을 것:\n- ${PLAN} 의 ${wp.id} 항목\n- ${STATE}/${wp.id}-build.json (네 개발 보고)\n- ${STATE}/${wp.id}-review-spec.json, ${wp.id}-review-correct.json, ${wp.id}-review-design.json (리뷰어 3명)\n- ${APP}/tests/setup/ownership.json 의 ${wp.id} 목록\n\n규칙:\n- blocker와 major를 전부 고친다. minor는 가능한 만큼. 고치지 않은 것은 이유와 함께 findingsDeferred 에 적는다.\n- 지적마다 현재 코드를 먼저 열어 이미 고쳐졌는지 확인한다. 이전 반영 시도가 중간에 끊겼을 수 있다.\n- 네 소유 파일만 고친다. 다른 파일 변경이 필요하면 sharedChangeRequests 에 정확히 적는다.\n- 다른 패키지도 동시에 반영 중이다. tsc와 테스트는 네 파일 오류만 책임진다.\n- 마지막에 cd ${APP} && node scripts/gate-scope.mjs ${wp.id} 를 돌려 결과를 gateResult 에 적는다.\n\n회의록 ${MEET}/04-코드리뷰-${wp.id}.md 를 쓴다(이미 있으면 이어서 채운다): 리뷰어별 지적, 반영 여부, 이유.\n결과를 ${STATE}/${wp.id}-fix.json 에 저장하고 반환한다.`,
      { label: `반영:${wp.id} ${wp.name}`, phase: '리뷰 반영', schema: FIX_SCHEMA, effort: 'high' }
    )
  }
)
const fixOk = fixes.filter(Boolean)
log(`리뷰 반영 ${fixOk.length}/${WPS.length}`)
const fixFailed = WPS.filter((w, i) => !fixes[i]).map(w => w.id)
if (fixFailed.length) {
  log(`반영 실패: ${fixFailed.join(', ')} — 통합 QA를 멈춘다`)
  return { stage: '리뷰 반영', fixFailed }
}

// ---------------- 통합 QA ----------------
phase('통합 QA')
const qaJobs = []
if (!has('qa-integrate.json')) qaJobs.push(() => agent(
  `${CTX}\n\n너는 통합 담당 엔지니어다. 모든 패키지의 리뷰 반영이 끝났다. 앱을 하나로 붙인다.\n\n먼저 읽을 것: ${STATE}/WP1-fix.json ~ WP6-fix.json 과 WP1-build.json ~ WP6-build.json 의 sharedChangeRequests, ${STATE}/foundation.json, ${PLAN} 의 통합 게이트 결정.\n\n해야 할 것:\n1. 공유 파일 변경 요청을 적용한다. 서로 충돌하는 요청은 계획의 계약을 기준으로 정리한다.\n2. 남은 스텁을 없애거나 연결한다. 목업 01~14 화면과 계획이 추가한 화면이 네비게이션으로 이어지는지 확인한다.\n3. 골든 테스트의 todo 를 풀고 통과시킨다(tests/golden-e2e.test.ts 등). 실패하면 원인이 된 src 를 고친다.\n4. legacy-v1 을 import 하는 곳이 0건인지 확인하고, 0건이면 계획대로 legacy-v1 을 지우고 tsconfig exclude 를 정리한다.\n5. npx tsc --noEmit 과 npx expo export --platform web --output-dir /tmp/yt-export 통과.\n\ntests/ 의 새 테스트 작성과 docs/FR-추적표.md 는 다른 QA가 동시에 하고 있다. 그 둘은 건드리지 마라(기존 테스트의 todo 해제와 잘못된 기대값 수정은 네 몫이다).\n결과를 ${STATE}/qa-integrate.json 에 저장하고 반환한다.`,
  { label: '통합 QA:통합', phase: '통합 QA', schema: QA_SCHEMA, effort: 'xhigh' }
))
if (!has('qa-tests.json')) qaJobs.push(() => agent(
  `${CTX}\n\n너는 QA 엔지니어(로직 테스트)다. ${PLAN} 의 qa.testTargets 와 확정 결정이 테스트로 보장되는지 점검하고, 빠진 테스트를 ${APP}/tests/ 에 새 파일(qa-*.test.ts)로만 추가한다.\n반드시 테스트할 것: 제외 순서(제안자 수 적은 순, 동점이면 등록 늦은 순), 고정은 안 빠짐, 조용한 제외 없음, 도착 감지(정확도 50m 이하 샘플·반경 100m·3분), 지연 감지(15분), 빈 시간 추천(30분), 루트 정렬(10곳 이하 정확해·11곳 이상 근사), 경로 호출 예산과 24시간 캐시, 오프라인 큐와 중복 op, 게스트 30일.\n기존 테스트 파일과 src 는 고치지 않는다. 새 테스트가 src 버그를 드러내면 openIssues 에 파일과 원인을 적는다.\n결과를 ${STATE}/qa-tests.json 에 저장하고 반환한다.`,
  { label: '통합 QA:로직 테스트', phase: '통합 QA', schema: QA_SCHEMA, effort: 'high' }
))
if (!has('qa-trace.json')) qaJobs.push(() => agent(
  `${CTX}\n\n너는 QA 엔지니어(명세 추적)다. 명세서의 모든 FR(FR-101~105, 201~205, 301~304, 401~404, 501~505, 601~604, 701~704, 801~804)과 비기능 요구사항을 행으로 하는 추적표를 ${ROOT}/docs/FR-추적표.md 에 쓴다. 이미 있으면 갱신한다.\n열: FR, 기능명, 차수, 구현 파일, 확인 방법(화면 경로 또는 테스트 이름), 상태(구현/부분/미구현), 남은 문제.\n코드를 실제로 열어 확인하라. 보고서의 주장을 믿지 마라. src 와 tests 는 고치지 않는다.\n결과를 ${STATE}/qa-trace.json 에 저장하고 반환한다.`,
  { label: '통합 QA:명세 추적', phase: '통합 QA', schema: QA_SCHEMA, effort: 'high' }
))
const qa = (await parallel(qaJobs)).filter(Boolean)
log(`통합 QA ${qa.length}/${qaJobs.length}`)
if (qa.length < qaJobs.length) return { stage: '통합 QA', done: qa.length, of: qaJobs.length }

// ---------------- 최종 점검 ----------------
phase('최종 점검')
if (!has('final.json')) {
  const final = await agent(
    `${CTX}\n\n너는 릴리스 담당 엔지니어다. 먼저 ${STATE}/qa-integrate.json, qa-tests.json, qa-trace.json 을 읽는다.\n세 가지가 전부 통과할 때까지 고친다.\n1) cd ${APP} && npx tsc --noEmit\n2) cd ${APP} && npm test  (실패 0, todo 0)\n3) cd ${APP} && npx expo export --platform web --output-dir /tmp/yt-export\n테스트가 틀렸으면 테스트를, 코드가 틀렸으면 코드를 고친다. 판단 기준은 명세서와 ${PLAN} 의 확정 결정이다.\n그다음 ${APP}/README.md 를 갱신한다: 실행 방법(웹 미리보기 포함), 여행 시뮬레이터 사용법, 시연 순서, 구현 기능 표(FR 전부, docs/FR-추적표.md 링크), 프로토타입이라 다른 점, 실제 제공자(카카오·AI 프록시)로 바꾸는 방법.\n회의록 ${MEET}/05-통합-QA.md 를 쓴다. 명령별 최종 결과를 그대로 적는다.\n결과를 ${STATE}/final.json 에 저장하고 반환한다.`,
    { label: '최종 점검:릴리스', phase: '최종 점검', schema: QA_SCHEMA, effort: 'xhigh' }
  )
  if (!final) return { stage: '최종 점검', failed: true }
}

// ---------------- 회고 ----------------
phase('회고')
const RETROS = [
  { key: 'pm', name: 'PM', brief: '범위와 일정 관점. 명세서 대비 무엇이 되고 무엇이 안 됐나. 시연 시나리오가 끊기는 지점. 사용량 한도로 여러 번 끊긴 진행에서 배운 점.' },
  { key: 'tech', name: '테크리드', brief: '아키텍처와 품질 관점. 계약·소유권 기반 병렬 분할이 잘 먹혔나. 기술 부채. 실제 제공자(카카오 지도·경로, AI 프록시)로 바꿀 때 필요한 작업.' },
  { key: 'qa', name: 'QA 리드', brief: '검증 관점. 테스트로 보장되는 것과 안 되는 것. 사람이 직접 눌러봐야 하는 것 목록.' },
]
const retroJobs = RETROS.filter(r => !has(`retro-${r.key}.json`)).map(r => () =>
  agent(
    `${CTX}\n\n너는 ${r.name}다. 회고 회의 발언을 준비한다. ${r.brief}\n${STATE}/ 의 결과 파일들, ${MEET}/ 의 회의록, 실제 코드와 테스트 결과를 확인하고 말하라.\n결과를 ${STATE}/retro-${r.key}.json 에 저장하고 반환한다.`,
    { label: `회고:${r.name}`, phase: '회고', schema: RETRO_SCHEMA, effort: 'medium' }
  )
)
await parallel(retroJobs)

let minutes = null
if (!has('retro-minutes.json')) {
  minutes = await agent(
    `${CTX}\n\n너는 회고 회의 진행자(메인 책임자 한동관 역할)다. ${STATE}/retro-pm.json, retro-tech.json, retro-qa.json 과 final.json 을 읽고 ${MEET}/06-회고.md 를 쓴다. 잘된 점, 문제점, 다음 액션(담당과 우선순위). 과장하지 말고 실제 결과대로 적는다.\n그다음 ${ROOT}/docs/README.md 에 docs 폴더 안내(회의록 01~06 목록과 한 줄 요약, plan.json, FR-추적표.md, workflow-state 설명)를 쓴다.\n마지막에 {"done":true} 를 ${STATE}/retro-minutes.json 에 저장한다.`,
    { label: '회고:진행', phase: '회고', effort: 'medium' }
  )
}

return { stage: '완료', fixes: fixOk.map(f => ({ id: f.id, skipped: !!f.skipped, gate: f.gateResult })), qa: qa.map(q => ({ role: q.role, openIssues: q.openIssues })), minutes }
