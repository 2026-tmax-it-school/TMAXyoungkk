# 기능 6. CI GitFlow — 구현 보고
요약: I moved CI and the collaboration docs over to GitFlow. In CI, the existing `check` job still runs, and a new `db` job runs the server tests against a real PostgreSQL. The `db` job will fail until the server team's real-DB test lands. tsc and npm test are each failing on files another team is editing (WP6). My own new tests pass.
- `.github/workflows/ci.yml`: Triggers are push to main, develop, feature/**, release/**, hotfix/** and PRs into main and develop. I added `permissions: contents: read`. The `check` job's name and steps are unchanged (npm ci, tsc, npm test, web bundle, 4 ttf fonts).
- New `db` job: it uses a postgres:17-alpine service with a health check, a throwaway account that exists only in CI, and passes `YT_TEST_DATABASE_URL`. It first fails fast if no test reads `YT_TEST_DATABASE_URL`, so the real-DB tests can't be silently skipped. It then runs `tests/wp2-*.test.ts` one file at a time, loading .ts files the same way `npm test` does, with a 10-minute timeout. No secrets or keys are used.
- CONTRIBUTING.md: I kept the structure and wording and changed only the sentences that conflicted with GitFlow. Branch names are now `feature/<initials>/<type>-<scope>`, `release/vX.Y.Z` and `hotfix/vX.Y.Z`. Feature PRs go into develop with squash merge. Release and hotfix PRs merge into main with a merge commit, get tagged, then the same branch is merged into develop. Tags go on main only.
- I also updated all `origin/main` commands to `origin/develop`, the repository settings, and the CI section (now describes the `db` job). Under repository settings, the default branch becomes develop, merge commits are turned on, auto-delete is turned off, and rulesets now cover both develop and main.
- `협업규칙.md`: I changed the branch, merge, red-build and PR-size rows and added two rows, "브랜치 전략" and "PR 베이스".
- `.github/pull_request_template.md`: I added a comment on which base branch to use and a checkbox for it, and it matches the copy embedded in CONTRIBUTING.md.
- The `db` commit scope was already there, in both the scope table and the hook's `scopes=`, so I added nothing.
- New test `test/tests/foundation-ci.test.ts` (8 cases, no YAML library) checks the workflow structure, the template copy matching, the scope table against the hook, and that the branch-name rules accept the GitFlow names and reject old ones. I broke the workflow and template on purpose in 5 ways (temporarily, then restored the files byte-for-byte) and the test caught each one.
- I also checked the YAML with PyYAML; actionlint isn't installed. I ran the documented commit hook and branch-name check against sample titles and branch names, and they behaved as expected.
바꾼 파일: .github/workflows/ci.yml, .github/pull_request_template.md, CONTRIBUTING.md, 협업규칙.md, test/tests/foundation-ci.test.ts
게이트: - npx tsc --noEmit: fails with 9 errors, all in tests/wp6-track.test.ts (the `permission` property; another team is editing it). An earlier run also had 1 error in src/screens/RecordMapScreen.tsx, which is gone now. There are 0 errors in my files. I re-ran after waiting about 45s and got the same result.
- npm test: 626 tests (the 618 before plus my 8), 625 pass, 1 fails, 0 skipped. The failure is the WP6 'FR-804 기록 지도 모델' case "권한 거부면 도착 지점만 잇고 안내한다. 실선 없이 전부 점선이다", in a file another team is editing. All 8 cases in my tests/foundation-ci.test.ts pass. Same result on the re-run.
- node scripts/gate-scope.mjs WP2: passes (WP2 tsc errors 0, 10 errors in other files reported only; 3 wp2 test files pass; with YT_SCOPE=WP2, all 7 foundation test files including foundation-ci pass). My files are FOUNDATION only, so a WP gate of my own doesn't apply.
- The `db` job's test command, run locally without a DB: 88 WP2 tests pass. Its guard step currently fails, as intended, because no test reads YT_TEST_DATABASE_URL yet.
- YAML: parsed with PyYAML and the structure checked; no actionlint, so the rest was checked by eye.
doc_notes: Branch rules (GitFlow) summary:
- `main` = releases; it only takes release and hotfix merges, and each one gets a tag. `develop` = integration and becomes the default branch. Nobody pushes directly to either; changes go in by PR with 1 approval and CI `check` and `db` green.
- Feature work: `feature/<initials>/<type>-<scope>` (e.g. feature/dh/feat-route-finding), cut from develop, PR into develop, squash merge (`gh pr merge --squash --delete-branch`).
- Releases: on the milestone due date, dh cuts `release/vX.Y.Z` from develop and merges `origin/main` into it once (so the PR is up to date). Only fix/docs commits go on it. PR into main titled `chore(app): vX.Y.Z 릴리스`, merged with a merge commit (`--merge`), then an annotated tag on main. The same branch then goes to develop as a second PR, merged with a merge commit and `--delete-branch`. Release PRs are exempt from the 400-line limit and from the issue rule.
- Hotfixes: `hotfix/vX.Y.Z` cut from the newest tag on main, one fix. Finished the same way as a release (into main, tag, back into develop). Only the develop PR closes issues, so it needs `Closes #`.
- Reverts: a feature/<initials>/fix-revert-<scope> branch into develop. If the change is already on main, the revert goes through a hotfix.

CI:
- ci.yml runs on push to main, develop, feature/**, release/**, hotfix/** and on PRs into main and develop.
- Job `check`: steps unchanged.
- Job `db`: postgres:17-alpine service; YT_TEST_DATABASE_URL=postgres://yt:yt@localhost:5432/yt_test (a throwaway account that exists only inside the job); runs `tests/wp2-*.test.ts` with `--test-concurrency=1`. It fails immediately if no file under tests/ reads YT_TEST_DATABASE_URL.
- No secrets or keys anywhere in CI.
- Both job names are required status checks, so neither may be renamed.

Repository settings described in CONTRIBUTING:
- Default branch develop.
- Merge commits on, squash on (both default to the PR title), rebase off, auto-delete off.
- One ruleset each for develop and main: allowed merge methods are squash and merge for develop, merge only for main; required checks `check` and `db`.

Commit scope `db` (WP2: sync, server/) was already there, so nothing was added.

New test: tests/foundation-ci.test.ts (FOUNDATION) checks that the workflow, the PR template, the commit scopes and the branch-name check regex stay in sync with CONTRIBUTING.md.
남은 문제: The `db` job's guard step fails until the server team adds a real-DB test under tests/ that reads YT_TEST_DATABASE_URL. That test should be named tests/wp2-*.test.ts, or the job's glob needs changing. Because the job runs files one at a time, those tests should clean up their own DB state and close their connections, or the process may not exit. / A person has to do the GitHub settings: change the default branch from main to develop (origin/HEAD currently points to main); turn merge commits on and auto-delete off; create the develop and main rulesets with required checks `check` and `db` and the allowed merge methods. The settings page labels such as 'Allowed merge methods' and how GitHub phrases merge-commit messages were written from memory and not checked against GitHub. / Branch naming changed from `<initials>/<type>-<scope>` to `feature/<initials>/<type>-<scope>`, and release/hotfix PRs now use merge commits instead of squash. This is my call to make GitFlow work, and dh (the lead) should confirm it. / Existing history includes commits pushed straight to develop and main without a PR (d2a485e '테스트' on develop, 99e3905 '현재 프로토타입 설명' on main). The direct-push check command in CONTRIBUTING will keep printing them. / Stale lines unrelated to GitFlow were left alone: the CONTRIBUTING 'One-time setup: root repository' section and line 65 ('The root is not a git repository yet'), and the 협업규칙.md '처음 한 번' paragraph ('지금은 루트가 git 저장소가 아니다'). The root is already a git repository. The section's example branch name `dh/chore-repo-root` was also left as is. / .githooks/commit-msg does not exist, so I did not create it. That is checklist row 4, on branch feature/dh/chore-commit-hook. / tsc and npm test currently fail on WP6 files another team is editing (tests/wp6-track.test.ts and the FR-804 test case). I left them alone; still failing after a retry. / actionlint is not installed, so beyond the PyYAML parse the workflow was only checked by eye; nothing was run on GitHub.

# 수정 1차·2차·3차(이미 반영됨)
반영: 
- [major] ci.yml db 잡 가드 수정. 지적대로 `grep -rq YT_TEST_DATABASE_URL tests`는 foundation-ci.test.ts 글자에도 걸렸다. 서버 팀 파일 없이 재현하면 exit 0이 나왔다. 가드를 `grep -lq YT_TEST_DATABASE_URL tests/wp2-*.test.ts || { ...; exit 1; }`로 바꿔 잡이 실제로 돌리는 파일만 보게 했다
- [major 보강] '실제로 붙었는지'를 확인하는 단계를 더했다. 서버 DB 테스트 단계가 spec은 화면에, TAP은 /tmp/yt-db.tap에 남긴다. 새 단계는 TAP이 없거나 `# SKIP` 줄이 있으면 실패한다. Node 요약의 skipped는 건너뛴 describe를 세지 않는다(로컬에서 확인: 실 DB 묶음을 건너뛰어도 'skipped 0'). 그래서 요약 대신 TAP의 SKIP 줄을 본다
- [major] foundation-ci.test.ts의 db 검사도 바꿨다. 깨진 접두어(startsWith 'grep -rq ... tests ')를 지우고 다음을 고정했다: 가드 glob과 실행 glob이 같은지, TAP 경로를 다음 단계가 쓰는지. 또 가드와 건너뜀 검사를 bash로 직접 돌리는 테스트 2개를 더했다. 가드는 foundation 파일에만 변수가 있거나 wp2 밖 파일에만 있으면 실패하고, wp2 파일이 읽으면 통과한다. 건너뜀 검사는 건너뛴 describe가 있거나 TAP이 없으면 실패하고, 다 돌았으면 통과한다
- [major] CONTRIBUTING.md 'What CI runs'의 db 표를 바꿨다. 가드 명령과 '돌리는 파일 중 읽는 파일이 없다'로 고쳤고, 건너뜀 검사 행을 더했다
- [minor] CONTRIBUTING.md 마일스톤 1 닫는 조건의 fresh `main`을 fresh `develop`으로 바꿨다
- [minor] 릴리스 순서를 맞췄다. Release tags에서 게이트 (2)–(4)를 release·hotfix 브랜치 HEAD에서 먼저 확인한다. 그다음 `gh pr merge --merge`로 머지하고, main 머지 커밋의 트리가 확인한 HEAD와 같은지 본다. main push CI가 초록이면 태그를 단다. Tags and phases('then merge and tag', 'gates on the branch head')와 Merging 블록 첫 줄 주석도 같은 순서로 맞췄다
- [minor] 낡은 루트 저장소 문장을 지금 상태로 고쳤다. CONTRIBUTING 65행은 '루트가 git 저장소이고 One-time setup은 끝났다'로 바꿨다. 'One-time setup: root repository' 첫 문장은 '완료, 기록으로 남김, 다시 돌리지 않음, dh/chore-repo-root는 GitFlow 전 이름'으로, 체크리스트 1행은 'Root repository (done)'로 바꿨다. 협업규칙.md '처음 한 번'의 '루트가 git 저장소가 아니다'는 '루트 저장소(1행)는 만들었다'로 바꿨다
- [minor] ci.yml에 concurrency를 더했다: group `ci-${{ github.event_name }}-${{ github.ref }}`. cancel-in-progress는 main·develop push가 아닐 때만 켠다. 머지 커밋마다 결과가 남아야 하기 때문이다. foundation-ci에 구조 검사를 더하고, CONTRIBUTING 'What CI runs'에 'PR이 열린 브랜치는 push마다 두 번 돈다' 한 줄을 적었다
- [minor] CONTRIBUTING 'Reproduce locally'를 고쳤다. 'throwaway'를 지우고 `npm run db:up`(server/docker-compose.yml의 개발 DB, 계정은 server/.env.example과 같다)을 적었다. 임시 스키마라 기존 표는 남는다는 점과, 실제 재현 명령 블록도 넣었다. test/README.md 73행 반영 항목은 doc_notes에 넣었다
- [minor] foundation-ci.test.ts가 YT_SCOPE를 본다. currentScope()가 WPn이면 11개 테스트를 모두 건너뛴다. 최상위의 CONTRIBUTING·ci.yml 읽기도 건너뛰어 WP 게이트를 막지 않는다. 확인: gate WP2·WP5 통과, YT_SCOPE=WP2에서 11개 skipped
- 지적 확인 결과 하나 더: 리뷰 때와 달리 지금은 서버 팀의 tests/wp2-db.test.ts가 YT_TEST_DATABASE_URL을 읽는다. 닿지 않는 URL로 wp2 테스트를 돌리면 이제 ECONNREFUSED로 exit 1이다. 그래도 가드의 자기 매칭은 실제 결함이었고 고쳤다. 고친 뒤 이 트리에서 가드는 wp2-db.test.ts 덕에 정당하게 통과한다
건너뜀: 
- 정확성 리뷰의 pg_stat_database xact_commit 전후 비교: 반영하지 않았다. psql이나 service container docker exec가 있어야 하고, 통계 반영 시점과 임계값도 불안정하다. TAP의 `# SKIP` 검사가 같은 목적(실 DB 묶음이 건너뛰지 않고 돌았는지)을 더 직접 확인한다
- 규칙 리뷰의 YT_REQUIRE_REAL_DB=1(URL이 없으면 skip 대신 실패): 반영하지 않았다. tests/wp2-db.test.ts는 WP2(서버 팀) 파일이라 내 범위 밖이다. CI 쪽 TAP SKIP 검사가 같은 효과를 낸다
- 'db 잡은 지금 실패한다'는 보고·doc_notes 문장: 사실과 달라 지웠다. 지금은 wp2-db.test.ts가 있어 가드가 통과하고, 실 PostgreSQL 묶음이 skip 없이 돌아야 초록이다
- 통합 리뷰의 체크리스트 1행 이름을 feature/dh/chore-repo-root, 베이스를 origin/develop으로 바꾸자는 안: 이미 끝난 일회성 단계라 '완료' 표시를 골랐다(리뷰가 함께 낸 다른 안). 이름을 바꾸면 실제로 없었던 절차를 적게 된다. 실제 이력에도 dh/chore-repo-root PR은 없다
- 규칙 리뷰의 'reporter 출력의 skipped 0 확인': 쓰지 않았다. 로컬에서 확인해 보니 건너뛴 describe는 요약 skipped에 잡히지 않아 이 방법으로는 못 잡는다. 대신 TAP의 SKIP 줄을 본다
- test/README.md 73행 수정: 규칙상 README는 고치지 않는다. 문서 단계가 반영하도록 doc_notes에 넣었다
바꾼 파일: /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/workflows/ci.yml, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/CONTRIBUTING.md, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/협업규칙.md, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/foundation-ci.test.ts, (구현 단계에서 바꾼 뒤 이번 수정 단계에서는 손대지 않음) /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/pull_request_template.md
게이트: test/ 기준 최종 결과.
- `npx tsc --noEmit`: 0건.
- `npm test`: 679/679 통과(fail 0, skipped 0). foundation-ci 11개 포함.
- `node scripts/gate-scope.mjs WP2`, `WP5`: 둘 다 통과. 이때 foundation-ci는 YT_SCOPE 때문에 skip된다. FOUNDATION 전용 게이트는 없다(WP1–WP6만 받는다).
- ci.yml은 PyYAML 파싱만 했다. actionlint가 설치돼 있지 않다.
- 명령 직접 실행
  - 새 가드: 이 트리에서 exit 0. 서버 팀 파일 없이 foundation-ci만 있는 트리에서 exit 1(옛 가드는 0).
  - 서버 DB 테스트 명령(spec+TAP 리포터): 113 pass.
  - SKIP 검사: URL 없는 실행에서 exit 1, 건너뜀 없는 실행에서 0.
  - 닿지 않는 URL로 wp2 실행: exit 1(ECONNREFUSED).
- 변형 6가지를 scratch 사본에서 시험했다. 실제 파일은 건드리지 않았고, foundation-ci가 모두 잡았다: 옛 가드, `test -s` 제거, SKIP 단계 제거, cancel-in-progress true, TAP 리포터 제거, wp2-db.test.ts 삭제.
- 실 PostgreSQL로는 못 돌렸다. 로컬 docker 데몬이 꺼져 있고 psql도 없다. GitHub에서도 아직 돌지 않았다.
doc_notes: ## 브랜치 규칙(GitFlow) 요약
- `main`은 배포 브랜치다. release·hotfix 머지만 받고, 머지할 때마다 태그를 단다.
- `develop`은 통합 브랜치이고 기본 브랜치다.
- 둘 다 직접 push 금지. PR로만 넣는다(상대 승인 1개, CI `check`·`db` 초록).
- 기능: `feature/<이니셜>/<타입>-<범위>`(예: feature/dh/feat-route-finding).
  - `develop`에서 따서 `develop`으로 PR을 연다.
  - Squash 머지: `gh pr merge --squash --delete-branch`.
- 릴리스
  - 마일스톤 기한 날 dh가 `develop`에서 `release/vX.Y.Z`를 따고, `origin/main`을 한 번 머지한다.
  - fix·docs 커밋만 받는다.
  - `main`으로 PR을 연다. 제목은 `chore(app): vX.Y.Z 릴리스`.
  - 게이트 (2) 실기기 행, (3) 깨끗한 clone 실행, (4) 열린 P1 fix 없음은 release 브랜치 HEAD에서 먼저 확인한다. 실패하면 release 브랜치에서 되돌린다.
  - 통과하면 머지 커밋(`--merge`)으로 `main`에 넣는다.
  - 머지 커밋의 트리가 확인한 HEAD와 같고 main push CI가 초록이면, 그 커밋에 annotated 태그를 단다. 태그는 `main`에만.
  - 같은 브랜치를 `develop`으로 두 번째 PR로 올린다(머지 커밋, `--delete-branch`).
  - 릴리스 PR은 400줄 제한과 이슈 규칙에서 빠진다.
- 핫픽스
  - `main`의 최신 태그에서 `hotfix/vX.Y.Z`를 따고, 수정은 하나만 넣는다.
  - 끝내는 순서는 릴리스와 같다.
  - 이슈는 `develop` PR만 닫으므로 그 PR에 `Closes #`를 적는다.
- 되돌림: `feature/<이니셜>/fix-revert-<범위>` → `develop`. 이미 `main`에 나갔으면 hotfix로 한다.
- 마일스톤 1을 닫는 조건은 fresh `develop`에서 `npm ci && npm start`가 되는 것이다.
- 루트 저장소(체크리스트 1행)는 완료로 표시했다. 2–5행은 사람이 할 일이다.

## CI(.github/workflows/ci.yml)
- 트리거
  - push: main, develop, feature/**, release/**, hotfix/**
  - pull_request: main, develop
  - permissions: contents: read
- concurrency: 그룹은 `ci-<이벤트>-<ref>`이다.
  - 같은 이벤트·같은 ref에서 새 실행이 오면 지나간 실행을 끊는다.
  - main·develop push는 끊지 않는다.
  - PR이 열린 feature 브랜치는 push 한 번에 두 번 돈다(push, pull_request).
- 잡 `check`: 단계는 그대로다(npm ci, tsc, npm test, 웹 번들, ttf 4개).
- 잡 `db`
  - postgres:17-alpine 서비스를 쓴다.
  - YT_TEST_DATABASE_URL=postgres://yt:yt@localhost:5432/yt_test. 이 잡 안에서만 쓰는 계정이다.
  - 단계 1, 설치: npm ci.
  - 단계 2, 가드: `grep -lq YT_TEST_DATABASE_URL tests/wp2-*.test.ts`. 잡이 돌리는 파일만 본다.
  - 단계 3, 서버 DB 테스트: `tests/wp2-*.test.ts`를 `--test-concurrency=1`로 돈다. spec은 화면에, TAP은 /tmp/yt-db.tap에 남긴다.
  - 단계 4, 건너뜀 검사: TAP이 없거나 `# SKIP` 줄이 있으면 실패한다. Node 요약의 skipped는 건너뛴 describe를 세지 않아서 TAP을 본다.
  - 지금은 tests/wp2-db.test.ts의 '실제 PostgreSQL' 묶음이 skip 없이 돌아야 초록이다.
- 키·저장소 secret은 쓰지 않는다. 잡 이름 `check`·`db`는 필수 검사라 바꾸지 않고, 잡 단위 name:도 달지 않는다.
- 로컬 재현(test/에서)
  - `npm run db:up`: server/docker-compose.yml의 개발 DB. 계정은 server/.env.example과 같다.
  - 그다음 아래 명령을 돌린다.
    `YT_TEST_DATABASE_URL=postgresql://youngtrip:youngtrip-dev@127.0.0.1:5432/youngtrip node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/setup/resolve-ts.mjs --test --test-concurrency=1 "tests/wp2-*.test.ts"`
  - 테스트는 임시 스키마를 만들고 지우므로 기존 표는 남는다.

## README에 반영할 것
- test/README.md 73행('서버 없이 검증')의 'CI도 같은 세 단계와 ttf 4개 검사를 돈다'를 고친다.
  - check 잡은 지금처럼 세 단계와 ttf 4개를 돈다.
  - 별도 db 잡이 postgres:17-alpine에서 YT_TEST_DATABASE_URL로 tests/wp2-*.test.ts를 실 PostgreSQL로 한 번 더 돌고, 건너뛴 테스트가 있으면 실패한다는 문장을 더한다.
  - 위 로컬 재현 명령도 함께 넣는다.

## CONTRIBUTING에 적은 저장소 설정
- 기본 브랜치 develop.
- 머지 커밋 on, squash on(둘 다 기본 메시지는 PR 제목). rebase off, auto-delete off.
- develop·main 규칙: develop은 Squash와 Merge 허용, main은 Merge만. 필수 검사 `check`·`db`.

## 그 밖
- 커밋 범위 `db`(WP2: sync, server/)는 이미 있어 더하지 않았다.
- 테스트 tests/foundation-ci.test.ts(FOUNDATION, 11개)
  - 워크플로 구조와 concurrency를 본다.
  - db 잡의 가드·건너뜀 검사를 bash로 직접 돌린다.
  - PR 템플릿·커밋 범위·브랜치 이름 정규식이 CONTRIBUTING.md와 맞는지 본다.
  - YT_SCOPE=WPn이면 건너뛰어 WP 게이트를 막지 않는다.
남은 문제: 실 PostgreSQL로는 한 번도 돌려 보지 못했다. 로컬 docker 데몬이 꺼져 있고 psql도 없다. db 잡의 마지막 두 단계(실 PG 실행, SKIP 검사)는 GitHub의 첫 실행에서 확인해야 한다 / 머지 순서: ci.yml(db 잡)은 tests/wp2-db.test.ts와 server/db를 넣는 PR과 같은 PR이나 그 뒤에 머지해야 한다. 지금 둘 다 커밋되지 않았다. 순서가 바뀌면 가드가 실패해 db가 빨간불이 된다. 규칙의 필수 검사에 `db`를 넣는 것도 그 뒤에 한다 / GitHub 설정은 사람이 해야 한다. 기본 브랜치를 main에서 develop으로 바꾼다(origin/HEAD가 아직 main). 머지 커밋 on, auto-delete off로 바꾸고, develop·main 규칙(필수 검사 check·db, 허용 머지 방식)을 만든다. 설정 화면 라벨은 기억으로 적어 GitHub에서 대조하지 않았다 / dh 확인이 필요한 결정 세 가지: 브랜치 이름 `feature/<이니셜>/<타입>-<범위>`, release·hotfix의 머지 커밋, 이번에 바꾼 릴리스 순서(게이트를 release HEAD에서 먼저 확인한 뒤 머지·태그) / actionlint가 없어 PyYAML 파싱과 눈으로만 봤다. 특히 concurrency의 `cancel-in-progress: ${{ ... }}` 표현식은 GitHub에서 아직 돌지 않았다 / foundation-ci.test.ts가 이제 bash와 node 자식 프로세스를 띄우고 os.tmpdir()에 임시 폴더를 만들었다 지운다. CONTRIBUTING대로 macOS·Linux 전용이고, Windows cmd에서는 이 테스트가 실패한다 / foundation-ci의 가드 테스트는 이 트리에서 tests/wp2-*.test.ts 중 하나가 YT_TEST_DATABASE_URL을 읽어야 통과한다. 서버 팀이 변수 이름을 바꾸거나 테스트를 옮기면 check 잡(npm test)도 함께 실패한다. 의도한 결합이다. YT_SCOPE 게이트에서는 건너뛴다 / 기존 이력에 PR 없이 직접 push한 커밋이 있다: develop의 d2a485e '테스트', main의 99e3905 '현재 프로토타입 설명'. CONTRIBUTING의 직접 push 확인 명령이 이 둘을 계속 출력한다 / .githooks/commit-msg가 아직 없다(체크리스트 4행, feature/dh/chore-commit-hook). 만들지 않았다

반영: 
- [정확성 1, minor] db 잡의 글자 검사(grep -lq YT_TEST_DATABASE_URL)를 없앴다. 대신 실행 결과를 보는 단계 '실 PostgreSQL 묶음이 통과했는지'를 더했다. TAP에 이름에 '실제 PostgreSQL'이 든 묶음이 ok로, # SKIP 없이 찍혀야 통과한다. 주석만 남거나, 잡이 돌리지 않는 파일로 옮겨지거나, 이름이 바뀌면 빨강이다. 리뷰가 제안한 전체 이름 대신 표식만 맞춰 보게 했다. 그래서 서버 팀이 새로 만든 'HTTP 서버 + PostgreSQL 저장소(실제 PostgreSQL)'도 그대로 맞는다.
- [정확성 2·규칙 2, minor] concurrency를 고쳤다. main·develop push는 그룹 이름 끝에 커밋 SHA를 붙여 실행마다 그룹이 따로다. cancel-in-progress는 true다. 그래서 머지가 연달아 들어와도 기다리던 실행이 취소되지 않는다. feature·release·hotfix push와 PR은 지금처럼 지나간 실행을 끊는다. 워크플로 주석과 CONTRIBUTING CI 문장도 같이 고쳤다.
- [정확성 3·규칙 1 일부, minor] 직접 push 검사 범위를 GitFlow 이전 커밋 뒤로 줄였다. develop은 d2a485e..origin/develop, main은 99e3905..origin/main이다. 되돌려도 원래 커밋은 이력에 남는다고 한 문장으로 적었다. 새 직접 push를 다룬 뒤에는 그 SHA로 시작점을 옮긴다는 규칙도 적었다. 지금 refs로 돌려 보니 출력이 없다(예전 명령은 '테스트', '현재 프로토타입 설명'을 출력했다).
- [정확성 4, minor] 커밋 제목 검사 파이프에 sed -E 's/ \(#[0-9]+\)$//'를 넣었다. squash 제목 끝에 GitHub이 붙인 (#n)을 떼고 훅에 넘긴다. 그래서 release 브랜치에서 develop 커밋이 50자를 넘는 거짓 실패가 사라진다. 89행에 예외를 따로 적지 않고 명령이 직접 처리한다.
- [정확성 5·규칙 1·통합 1, major] One-time setup checklist 2행 맨 앞에 'main을 develop에 한 번 합치기(따로 PR 하나)'를 넣었다. 행 번호를 다시 매기지 않으려고 새 행 대신 2행 안에 넣었다. 표 아래에 명령 블록을 두었다: gh pr create --base develop --head main, gh pr merge <n> --merge(squash 금지, --delete-branch 금지), merge-base --is-ancestor 확인. 기본 브랜치를 바꾸기 전, 그리고 루트 README.md를 고치는 PR보다 먼저 하라고 적었다. Repository settings의 기본 브랜치 문장과 협업규칙.md 11행 '(기본 브랜치)'는 이 동기화를 끝낸 뒤의 상태라고 고쳤다. 처음 한 번 문단에도 한 줄 더했다. 동기화 머지는 git merge-tree로 지금 충돌이 없음을 확인했다.
- [정확성 5, minor] 첫 release에서 git merge --no-edit origin/main 다음 줄에 충돌 안내를 주석으로 더했다(Resolving conflicts대로 풀고 git commit --no-edit).
- [규칙 3, minor] 89행 규칙에 예외를 붙였다: back-merge PR into develop에서는 명령을 적힌 그대로 쓴다. §6 back-merge 블록에는 두 가지를 더했다. 하나는 develop보다 뒤처졌을 때 gh pr update-branch를 쓰고, 충돌하면 git merge origin/develop로 푸는 줄이다. 다른 하나는 'never squash, never self-merge'다.
- [통합 2, minor] SLA 셀프 머지 조건을 고쳤다. 'never a release or hotfix PR or its back-merge into develop'을 넣고, 'check and db are green'을 넣었다. 협업규칙.md 18행도 '(릴리스·핫픽스 PR과 그 브랜치의 develop PR 제외)'와 check·db 초록 조건으로 맞췄다.
- [통합 3, minor] 이 변경은 고정 규칙을 바꾼다. 그래서 yj 승인이 필수이고, 셀프 머지와 --admin은 쓸 수 없다. 이름 형식과 release·hotfix 머지 커밋 방식은 dh·yj가 함께 확정해야 한다. 이 내용을 open_issues와 doc_notes에 적었다.
- [통합 4·규칙 요약, minor] 보고를 지금 파일 상태로 고쳤다. 글자 가드는 없앴다. CONTRIBUTING 65행과 협업규칙 '처음 한 번'은 이미 고쳐져 있다. foundation-ci는 14개 테스트다. 게이트 결과는 아래 gates에 적었다. doc_notes에 브랜치 규칙 요약, 사람이 할 GitHub 설정, db 잡 로컬 재현법을 넣었다.
- 테스트 더함(tests/foundation-ci.test.ts, 11개에서 14개로). concurrency 식을 JS로 계산해 본다: main·develop push는 커밋마다 그룹이 다르고, feature·release·hotfix·PR은 같다. db 잡 명령과 두 결과 검사는 임시 폴더에서 그대로 돌린다: 정상이면 [0,0,0], 주석만 남고 다른 파일로 옮겼으면 [0,0,1], 건너뛰면 [0,1,1], 실패하면 [1,0,1]. 지금 wp2 파일에 표식 묶음이 있는지는 주석을 빼고 본다. 커밋 제목 검사가 (#n)을 떼는지는 대역 훅으로 본다. 직접 push 검사는 범위와 필터를 보고, 로컬 refs가 있을 때는 옛 두 커밋을 다시 출력하지 않는지도 본다. 일부러 다섯 가지로 고장 내 봤다(SHA 그룹 제거, 느슨한 grep, sed 제거, 전체 이력, 옛 시작점). 다섯 번 모두 잡았고 파일은 바이트 그대로 되돌렸다(cmp로 확인).
건너뜀: 
- 정확성 2의 run_id 그룹 안은 쓰지 않았다. 규칙 리뷰가 낸 SHA를 붙이는 식을 골랐다. 두 안은 효과가 같고, SHA 쪽이 실행 화면에서 어느 커밋의 그룹인지 읽기 쉽다.
- 정확성 3의 'gitflow-start 기준 태그' 안은 쓰지 않았다. 태그를 다는 일은 사람이 해야 하고 태그 ruleset도 건드린다. 알려진 SHA 두 개를 시작점으로 쓰면 문서만 고치면 된다.
- 정확성 1이 제안한 TAP 전체 이름 일치(^ok N - PostgreSQL 저장소\(실제 PostgreSQL\)$)는 쓰지 않았다. 대신 '실제 PostgreSQL' 표식이 든 묶음 이름을 본다. 서버 팀이 같은 표식으로 두 번째 실 DB 묶음(HTTP 서버 + PostgreSQL 저장소(실제 PostgreSQL))을 이미 더했다. 전체 이름에 묶으면 이름이 조금만 바뀌어도 깨진다.
- 정확성 5가 제안한 체크리스트 '2a' 새 행은 만들지 않았다. 2행 안에 넣어 행 번호를 지켰다. row 7, rows 1–5, 협업규칙 1~5행 같은 참조가 그대로 맞는다.
- README의 브랜치 표(origin/main 99e3905의 feature/<기능>, release/<버전>, hotfix/<내용>)는 고치지 않았다. README는 문서 단계 몫이라 doc_notes로 넘겼다.
- CONTRIBUTING 89행 '`develop` (integration; the default branch)'는 고정 규칙이 가리키는 목표 상태라 그대로 뒀다. 지금 상태와의 차이는 Repository settings 문장과 체크리스트 2행에 적었다.
바꾼 파일: /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/workflows/ci.yml (이번 수정: concurrency, db 잡 결과 검사), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/CONTRIBUTING.md (이번 수정: back-merge 예외, release 충돌 안내, 커밋 제목 검사 sed, 기본 브랜치 문장, 직접 push 범위, SLA 조건, back-merge 블록, 체크리스트 2행과 동기화 블록, CI 문장, db 잡 표), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/협업규칙.md (이번 수정: 브랜치 전략·리뷰 행, 처음 한 번 한 줄), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/foundation-ci.test.ts (이번 수정: 테스트 11개에서 14개로), /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/pull_request_template.md (구현 단계에서 바꿈. 이번 수정 단계에서는 그대로)
게이트: ["tests/foundation-ci.test.ts 단독: 14개 모두 통과. tests/foundation-*.test.ts 전체: 103개 모두 통과. YT_SCOPE=WP2이면 foundation-ci 14개는 모두 건너뛴다.", "node scripts/gate-scope.mjs WP2: 통과(tsc=ok, own-tests=ok, foundation-scoped=ok). 처음 돌렸을 때는 서버 팀이 고치던 wp2-db 테스트 2개 때문에 실패했다. 다시 돌리니 통과했다.", "npx tsc --noEmit: exit 2. 오류 3건이 모두 위치 묶음이 고치는 중인 WP5 파일에 있다. src/screens/LiveTripScreen.tsx(104,45) TS7053 'servicesOff'와 tests/wp5-background.test.ts(93,95) TS2353 'backgroundMode'다. 내 파일(foundation-ci.test.ts)에는 오류가 0건이다. 2분 넘게 기다렸다 다시 돌려도 남아 있다.", "npm test: 693개 중 687개 통과, 5개 실패, 1개 건너뜀. 실패 5개는 모두 tests/wp5-background.test.ts에 있다(88, 122, 163, 294, 307행. 위치 묶음이 고치는 중). 다시 돌려도 남아 있다.", "YAML: yaml 패키지와 PyYAML 둘 다 파싱된다. 잡은 check·db이고 트리거와 db 단계 이름도 확인했다. actionlint는 설치돼 있지 않아 눈으로 봤다.", "db 결과 검사 명령: 실제 wp2 TAP(PostgreSQL 없음, SKIP)에서는 1이다. SKIP을 지운 TAP에서는 0이다. 꾸민 TAP에서는 실패 1, 건너뜀 1, 정상 0이다. macOS bash와 LC_ALL=C에서 같은 결과다.", "직접 push 검사: 새 명령은 지금 refs에서 아무것도 출력하지 않는다. 예전 명령은 '테스트'와 '현재 프로토타입 설명'을 출력했다.", "GitHub에서는 아무것도 돌려 보지 않았다. 실 PostgreSQL 경로도 로컬에서 돌리지 않았다(docker를 띄우지 않았다)."]
doc_notes: 브랜치 규칙 요약(GitFlow)
- main은 배포 브랜치다. release·hotfix 머지만 받고, 머지마다 main에 annotated 태그를 단다. 태그는 main에만 단다. develop은 통합 브랜치이고, 체크리스트 2행에서 main을 한 번 합친 뒤 기본 브랜치가 된다. 둘 다 직접 push를 하지 않는다. PR로만 넣고, 상대 승인 1개와 CI check·db 초록이 있어야 한다.
- 기능: feature/<이니셜>/<타입>-<범위>(예: feature/dh/feat-route-finding). develop에서 따서 develop으로 PR하고 squash로 머지한다(gh pr merge --squash --delete-branch).
- 릴리스: 마일스톤 마감일에 dh가 develop에서 release/vX.Y.Z를 딴다. origin/main을 한 번 합친 뒤 fix·docs 커밋만 올린다. main으로 PR(제목 chore(app): vX.Y.Z 릴리스)하고 머지 커밋으로 합친다(--merge). main의 그 머지 커밋에 태그를 단다. 같은 브랜치를 develop으로 한 번 더 PR해서 머지 커밋으로 합친다(--merge --delete-branch). back-merge는 squash도 셀프 머지도 하지 않는다. develop보다 뒤처졌으면 gh pr update-branch를 쓰고, 충돌하면 git merge origin/develop로 푼다.
- 핫픽스: main의 최신 태그에서 hotfix/vX.Y.Z를 딴다. 고침 하나만 넣고, 끝내는 방법은 릴리스와 같다. 이슈는 develop PR에서만 닫는다(Closes #).
- 되돌림: feature/<이니셜>/fix-revert-<범위>에서 develop으로 PR한다. 이미 main에 나갔으면 hotfix로 되돌린다.
- release·hotfix 브랜치에서는 문서의 origin/develop을 origin/main으로 읽는다. back-merge PR만은 적힌 그대로 쓴다.
- 셀프 머지(SLA 24시간)는 chore·docs PR이고 check·db가 초록일 때만 할 수 있다. 릴리스·핫픽스 PR과 그 develop PR은 셀프 머지하지 않는다.

CI(.github/workflows/ci.yml)
- 트리거: push(main, develop, feature/**, release/**, hotfix/**), pull_request(main, develop). permissions는 contents: read다. 키와 저장소 secret은 쓰지 않는다.
- concurrency: 같은 이벤트·같은 ref에서 새 실행이 들어오면 지나간 실행을 끊는다. main·develop push는 커밋 SHA마다 그룹이 따로라 끊기지도, 기다리다 취소되지도 않는다. 그래서 머지 커밋마다 결과가 남는다.
- 잡 check: 단계는 그대로다(npm ci, tsc, npm test, 웹 번들 빌드, ttf 4개).
- 잡 db: postgres:17-alpine 서비스를 쓰고 YT_TEST_DATABASE_URL=postgres://yt:yt@localhost:5432/yt_test를 넘긴다. 이 계정은 잡 안에서만 쓰고 버린다. tests/wp2-*.test.ts를 --test-concurrency=1로 하나씩 돈다. 그 뒤 두 가지를 본다. (1) TAP에 # SKIP이 없어야 한다. (2) 이름에 '실제 PostgreSQL'이 든 묶음이 SKIP 없이 통과해야 한다. 실 DB 테스트가 빠지면(주석만 남거나, 다른 파일로 옮기거나, 이름이 바뀌면) 빨강이다. 서버 실 DB 묶음은 이름에 '실제 PostgreSQL'을 꼭 남긴다. 지금은 'PostgreSQL 저장소(실제 PostgreSQL)', 'HTTP 서버 + PostgreSQL 저장소(실제 PostgreSQL)'다.
- check와 db는 필수 검사 이름이라 바꾸지 않는다.
- db 잡 로컬 재현(test/에서): npm run db:up 뒤 YT_TEST_DATABASE_URL=postgresql://youngtrip:youngtrip-dev@127.0.0.1:5432/youngtrip node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/setup/resolve-ts.mjs --test --test-concurrency=1 "tests/wp2-*.test.ts"

사람이 할 GitHub 일(체크리스트 2·3행)
1. main을 develop에 한 번 합친다: gh pr create --base develop --head main --title "chore(docs): main 변경 develop 반영", 그다음 gh pr merge <n> --merge. squash와 --delete-branch는 쓰지 않는다. 지금 main에만 4c48188과 99e3905(README)가 있다. 이 일은 기본 브랜치를 바꾸기 전, 그리고 루트 README.md를 고치는 PR보다 먼저 한다.
2. 기본 브랜치를 develop으로 바꾼다. 머지 커밋 on, squash on(둘 다 Pull request title), rebase off, auto-delete off로 둔다.
3. ruleset을 develop용·main용 하나씩 만든다. 승인 1, 대화 해결 on, 필수 검사 check와 db, up to date on. 허용 머지 방식은 develop이 Squash·Merge, main은 Merge만이다. 태그 ruleset release-tags도 만든다.

직접 push 검사(GitHub Free로 ruleset이 없을 때)
- for r in d2a485e..origin/develop 99e3905..origin/main으로 GitFlow 이전 커밋 뒤만 본다. 새 직접 push를 다룬 뒤에는 그 SHA로 시작점을 옮긴다.

문서 단계에 넘기는 것
- 루트 README.md는 origin/main의 README(99e3905, git show origin/main:README.md)를 바탕으로 쓴다. 그 안의 '브랜치 전략 (Git Flow)' 표를 feature/<이니셜>/<타입>-<범위>, release/vX.Y.Z, hotfix/vX.Y.Z와 위 머지 방식에 맞춘다. 가능하면 main→develop 동기화(체크리스트 2행)가 끝난 뒤에 README를 고친다. 동기화 전에 고쳤다면 동기화 머지에서 README.md 충돌을 새 README 쪽으로 푼다.
- 'db 잡은 아직 빨간불'은 사실이 아니다. 지금 wp2 테스트에 실 DB 묶음이 있어서, 실 PostgreSQL이 있으면 통과할 구조다. GitHub에서는 아직 한 번도 돌지 않았다.
- 이 변경 PR은 docs이고 고정 규칙을 바꾼다. 그래서 yj 승인이 필수이고 셀프 머지와 --admin은 쓰지 않는다. 바뀐 이름 형식(feature/ 접두)과 release·hotfix 머지 커밋 방식은 dh·yj가 함께 확정한다.

커밋 범위 db(WP2: sync, server/)는 이미 있어서 더하지 않았다. tests/foundation-ci.test.ts(FOUNDATION, 14개)는 워크플로·PR 템플릿·커밋 범위·브랜치 이름 정규식·커밋 제목 검사·직접 push 검사가 CONTRIBUTING.md와 맞는지 본다.
남은 문제: tsc(오류 3건)와 npm test(실패 5건)가 위치 묶음이 고치는 중인 WP5 파일 때문에 실패한다. 오류는 src/screens/LiveTripScreen.tsx의 'servicesOff', tests/wp5-background.test.ts의 'backgroundMode'에 있다. 범위 밖이라 고치지 않았고, 다시 돌려도 남아 있다. 내 파일과 foundation 테스트는 모두 통과한다. / GitHub 설정은 사람이 해야 한다. main→develop 동기화 PR(머지 커밋), 기본 브랜치를 develop으로 바꾸기, 머지 커밋 on, auto-delete off, develop·main ruleset(필수 검사 check·db, 허용 머지 방식), 태그 ruleset이다. 설정 화면 이름과, 'Pull request title' 설정일 때 머지 커밋 제목이 어떻게 찍히는지는 기억으로 썼고 GitHub에서 확인하지 않았다. / db 잡은 실 DB 묶음 이름에 든 표식 '실제 PostgreSQL'에 기댄다. 서버 팀이 이 표식을 빼면 db 잡과 foundation-ci가 빨강이 된다(의도한 동작이다). 서버 팀과 이 표식을 합의해 둘 것. 잡이 파일을 하나씩 돌리므로 실 DB 테스트는 자기 스키마와 연결을 정리해야 한다. / 고정 규칙 변경(feature/ 접두 이름 형식, release·hotfix 머지 커밋, 필수 검사 db)이다. 그래서 이 PR은 yj 승인이 필수이고 셀프 머지와 --admin은 금지다. 이름 형식과 머지 방식은 dh·yj가 함께 확정해야 한다. / 직접 push 검사의 시작점(d2a485e, 99e3905)은 새 직접 push를 다룰 때마다 사람이 문서에서 옮겨야 한다. / .githooks/commit-msg는 아직 없다(체크리스트 4행 feature/dh/chore-commit-hook). 만들지 않았다. / concurrency 동작(그룹마다 실행 1개·대기 1개, 대기 실행 교체)은 GitHub 문서에 기대고 있다. 로컬에서는 식을 JS로 계산해 그룹 이름만 확인했다. actionlint가 없어 워크플로를 GitHub이나 actionlint로 검사하지 못했다. / 실 PostgreSQL로 db 잡을 끝까지 돌려 보지 않았다(docker를 띄우지 않았고 GitHub 실행도 없다). 결과 검사는 실제 wp2 TAP과 꾸민 TAP으로만 확인했다.

반영: 
- [blocker, 3건 공통] db 잡의 '건너뛴 서버 DB 테스트가 없는지' 단계가 이제 모든 '# SKIP'을 잡지 않는다. 두 경우만 걸린다. (1) 이름에 '실제 PostgreSQL'이 든 묶음 안의 SKIP(묶음 자체, 하위 테스트, before 실패 뒤의 'not ok … # SKIP' 포함) (2) 사유에 YT_TEST_DATABASE_URL이 들어간 SKIP. 판정은 TAP 들여쓰기를 따라가는 awk 한 줄로 한다. 그래서 wp2-db.test.ts의 PGlite 전용 openPostgresStore 건너뜀으로는 더 이상 빨강이 되지 않는다. 다른 팀 파일인 wp2-db.test.ts를 고치지 않고 CI 쪽을 좁혔다(리뷰 1·3의 2번 방안). 빈 TAP이나 TAP이 없는 경우는 그대로 실패한다.
- [major, 리뷰 2] foundation-ci.test.ts에 실제 tests/wp2-*.test.ts를 쓰는 회귀 테스트를 더했다. 잡의 테스트 명령을 그대로 두 번 돌리는데, 한 번은 연결이 바로 거절되는 YT_TEST_DATABASE_URL(127.0.0.1:1)을 넘기고 한 번은 주소 없이 돌린다. 주소가 있으면 건너뜀 검사가 0이고 걸린 줄도 없어야 한다. 주소가 없으면 1이고 걸린 줄이 하나 이상 있어야 한다. 옛 엄격 가드로 되돌려 보니 이 테스트가 실패하는 것을 확인했다. 이제 db 잡을 빨강으로 만들 SKIP은 check 잡과 로컬 npm test에서 먼저 잡힌다.
- [major, 리뷰 2] 합성 픽스처 테스트를 새 의미에 맞춰 다시 썼다. 통과해야 하는 경우는 PGlite 전용 SKIP이다. 실패해야 하는 경우는 다음과 같다: 실 DB 묶음 SKIP, 안쪽 테스트 SKIP, before 실패 뒤 SKIP, 사유에 변수 이름이 든 SKIP, TAP 없음, 빈 TAP. '결과 검사' 체인에는 PGlite 묶음 안 드라이버 전용 SKIP이 [0,0,0]으로 통과하는 경우를 더했다. 가드를 고의로 4가지로 망가뜨려 보니 각각 테스트가 잡았다. 실험 뒤 파일은 바이트 단위로 원래대로 되돌렸다.
- [minor, 리뷰 3] CONTRIBUTING의 'Reproduce locally' 블록을 잡과 같은 명령 세 개로 바꿨다. TAP 기록 옵션이 붙은 테스트 명령, 건너뜀 검사, 실 DB 묶음 통과 검사다. 두 검사는 exit가 개발자 셸을 닫지 않게 ( ) 하위 셸로 감쌌다. foundation-ci에 '재현 블록 = 잡 명령' 비교 테스트를 더했고, 블록을 일부러 어긋나게 바꾸면 이 테스트가 실패하는 것을 확인했다.
- [blocker 부속] CONTRIBUTING 'What CI runs'의 db 표 2행과 설명 문단을 새 가드에 맞췄다. 실 DB 묶음 두 개의 이름을 적었다. 다른 테스트·묶음 이름에는 '실제 PostgreSQL'을 쓰지 않는다는 규칙과, PGlite 묶음 안의 드라이버 전용 건너뜀은 무시한다는 점을 적었다. npm test가 이 검사를 미리 돌린다는 한 줄도 더했다.
- [major, 리뷰 3] 필수 검사 적용 순서를 적었다. Repository settings에는 '`db`는 develop에서 한 번 통과한 뒤에만 필수'를 넣었다. 체크리스트 2행 표 칸은 'rulesets requiring `check`; `db` joins after it passes on develop'로 바꿨다. 2행 아래에는 순서 문단을 더했다: (1) GitFlow 트리거와 check만 있는 ci.yml PR (2) server/db/와 tests/wp2-db.test.ts가 든 WP2 PR (3) db 잡을 더하는 ci.yml PR. 그 뒤 db가 develop push에서 초록이 되면 필수 검사에 더한다. 협업규칙.md '처음 한 번'에도 같은 순서를 한 줄로 요약했다.
- [minor, 리뷰 1] 백머지 앞에 분기를 넣었다. 6. Merging 블록에 `git fetch origin && git rev-list --count origin/develop..origin/release/v0.1.0` 줄과 주석을 더했다(0이면 GitHub가 PR을 거절하므로 브랜치를 지우고 멈춘다). Tags and phases 문단에도 같은 조건을 적었다: fix 커밋이 없고 merge origin/main이 Already up to date였던 릴리스는 develop PR 대신 브랜치를 지운다. 'so main and develop share history'는 사실에 맞게 고쳤다: main은 develop과 같은 커밋을 갖고, main의 머지 커밋은 다음 release의 git merge origin/main으로 develop에 들어온다.
- [minor, 리뷰 1] 핫픽스 명령 블록에서 push와 gh pr create 사이에 `git add <paths> && git commit -m "fix(<scope>): <설명>"   # after fixing` 줄을 넣었다. GitHub는 커밋이 없는 PR을 거절한다는 주석도 달았다. 머지 커밋으로 main 이력에 남기 때문에 빈 커밋으로 초안을 여는 방식은 쓰지 않았다.
- [minor, 리뷰 3] 보고와 doc_notes를 지금 상태에 맞게 새로 썼다. foundation-ci 테스트는 16개이고 가드는 TAP 기반 두 단계다. wp2-db.test.ts는 이미 있다. 루트 One-time setup 문단, 65행, 협업규칙 '처음 한 번'은 이미 고쳐져 있다. test/README 73행과 루트 README 브랜치 표를 어떻게 고칠지는 doc_notes에 넣었다.
건너뜀: 
- 리뷰 1·2·3의 1번 방안(wp2-db.test.ts에서 openPostgresStore를 `if (backend.real) test(...)`로 실 DB에서만 등록)은 쓰지 않았다. 이 파일은 WP2 범위이고 서버 묶음 에이전트가 동시에 고치고 있어 내 범위 밖이다. CI 쪽 가드를 좁히는 방안을 골랐다. WP2가 나중에 그렇게 바꿔도 새 가드와 테스트는 그대로 통과한다.
- 리뷰 2가 제안한 단언('주소 없이 돌린 TAP의 모든 SKIP 사유에 YT_TEST_DATABASE_URL이 든다')은 그대로 넣지 않았다. 새 가드에서는 PGlite 전용 SKIP의 사유에 변수 이름이 없어도 정상이라 이 단언은 맞지 않는다. 대신 더 직접적인 검사를 넣었다. 연결이 바로 거절되는 주소를 넘겨 실 DB 묶음을 실제로 돌리고, 건너뜀 검사가 0이고 걸린 줄이 없는지 본다. 주소가 없을 때는 가드가 실 DB 묶음을 잡는지 본다.
- 리뷰 1이 예로 든 백머지 한 줄 `[ ... -gt 0 ] || { echo; git push origin --delete ...; }`는 쓰지 않았다. 터미널에 붙여 넣으면 브랜치를 지운 뒤에도 다음 줄 gh pr create가 그대로 실행된다. 그래서 개수만 출력하고, 0이면 브랜치를 지우고 멈추라는 주석을 단 형태로 넣었다. 지적한 내용 자체는 반영했다.
- 리뷰 3이 언급한 test/README.md 73행과 루트 README.md 브랜치 표는 고치지 않았다. 작업 규칙상 README는 마지막 문서 단계가 고친다. 고칠 내용은 doc_notes에 넣었다.
바꾼 파일: /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/workflows/ci.yml, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/CONTRIBUTING.md, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/협업규칙.md, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/test/tests/foundation-ci.test.ts, /Users/handong-gwan/IT희망학교 여행계획 프로젝트/.github/pull_request_template.md (구현 단계에서만 바뀜, 이번 수정 단계에서는 그대로)
게이트: - npx tsc --noEmit: 오류 5건이고 모두 tests/wp5-background.test.ts에 있다(위치·시뮬레이터 묶음이 작업 중인 다른 팀 파일). 내 파일은 0건이다. 시간을 두고 다시 돌려도 결과가 같았다.
- npm test: 697개 중 691개 통과, 5개 실패, 1개 건너뜀. 실패 5개는 모두 wp5-background.test.ts의 '스토어/어댑터/엔진/웹과 Expo Go/진행 날짜' 테스트다. 다시 돌려도 같았다. 건너뜀 1개는 wp2-db의 PGlite 전용 openPostgresStore 테스트다.
- tests/foundation-ci.test.ts: 16개 모두 통과, 약 2.8초. 이 가운데 실제 wp2 파일을 돌리는 테스트가 약 2초다.
- 다른 foundation-* 테스트(디자인 규칙, 소유권 포함)도 모두 통과했다.
- node scripts/gate-scope.mjs WP2: 통과(tsc는 WP2 파일 0건, wp2 테스트 파일 4개 통과, YT_SCOPE=WP2 foundation 7개 통과).
- YAML은 PyYAML로 파싱했다. db 잡의 run 4개가 그대로 읽히고 on.push와 on.pull_request도 맞다. 새 가드에는 YAML 주석 시작(` #`)도 `: `도 없다.
- 새 awk 가드를 돌려 본 결과:
  - 주소 없는 TAP: exit 1. 실 DB 묶음 두 줄만 걸렸다.
  - 거절되는 주소를 넘긴 TAP: exit 0.
  - 실 DB 묶음 안에서 before가 실패한 합성 TAP: 하위 SKIP 3줄이 걸려 exit 1.
- 변형 검사: 옛 엄격 가드 1번, 묶음 범위 제거, 사유 변수 제거, 'not ok' 제거, 재현 블록 어긋남을 만들어 보니 각각 테스트가 실패했다. 실험한 파일은 cmp로 원래대로 돌아온 것을 확인했다.
- actionlint는 설치되어 있지 않아 돌리지 못했다. awk는 macOS BSD awk(20200816)로만 실행해 봤다.
doc_notes: 브랜치 규칙(GitFlow) 요약
- main: 배포용이다. release와 hotfix 머지만 받고, 머지할 때마다 main의 머지 커밋에 annotated 태그(v0.1.0 등)를 단다. 태그는 main에만 단다.
- develop: 통합용이고 기본 브랜치가 된다. 체크리스트 2행에서 main을 한 번 머지 커밋으로 합친 뒤에 바꾼다.
- 둘 다 직접 push하지 않는다. PR로만 넣고, 상대 개발자 승인 1개와 초록 CI가 있어야 한다.
- 기능: feature/<이니셜>/<타입>-<범위>. 예: feature/dh/feat-route-finding. 타입은 feat·fix·refactor·chore·docs다. develop에서 따서 develop으로 PR을 열고 Squash로만 머지한다(gh pr merge --squash --delete-branch).
- 릴리스: release/vX.Y.Z. 마일스톤 마감일에 dh가 develop에서 따고, git merge origin/main을 한 번 한다. 릴리스 브랜치에는 fix·docs 커밋만 넣는다. 제목 'chore(app): vX.Y.Z 릴리스'로 main에 PR을 열어 머지 커밋(--merge)으로 머지하고, main에 태그를 단다. 그다음 같은 브랜치를 develop으로 PR해 머지 커밋으로 머지한다. 단 develop에 없는 커밋이 있을 때만 그렇게 한다. git rev-list --count origin/develop..origin/<브랜치>가 0이면 GitHub가 PR을 거절하므로 브랜치만 지운다. 릴리스 PR은 400줄 제한과 이슈 규칙에서 빠진다.
- 핫픽스: hotfix/vX.Y.Z. main의 최신 태그에서 따고, 고친 커밋 하나를 만든 뒤에 PR을 연다. 마무리는 릴리스와 같다(main에 머지 커밋, 태그, 같은 브랜치를 develop으로). 이슈는 develop PR만 닫으므로 그 PR에 'Closes #'를 쓴다.
- 되돌림: feature/<이니셜>/fix-revert-<범위>로 develop에 PR한다. 이미 main에 나간 변경이면 hotfix로 되돌린다.
- 바뀐 이름: 예전 <이니셜>/<타입>-<범위>는 이제 feature/<이니셜>/<타입>-<범위>다. release·hotfix 이름에는 v가 붙은 버전을 쓴다.

CI(.github/workflows/ci.yml)
- 트리거: main, develop, feature/**, release/**, hotfix/**로의 push와, main·develop으로 가는 PR. permissions는 contents: read이고 키나 저장소 secret은 쓰지 않는다.
- 잡 check: npm ci, tsc, npm test, 웹 번들 빌드, ttf 4개. 단계는 바뀌지 않았다.
- 잡 db: postgres:17-alpine 서비스를 띄우고 YT_TEST_DATABASE_URL=postgres://yt:yt@localhost:5432/yt_test를 넘긴다. 이 계정은 잡 안에서만 쓰고 버린다. tests/wp2-*.test.ts를 파일 하나씩(--test-concurrency=1) 돌리고 TAP을 /tmp/yt-db.tap에 남긴다. 결과 검사는 두 가지다.
  (1) 건너뜀 검사. TAP이 없거나 비면 실패한다. 이름에 '실제 PostgreSQL'이 든 묶음 안에서 무엇이든 건너뛰었거나, 사유에 YT_TEST_DATABASE_URL이 든 건너뜀이 있으면 실패한다. PGlite 묶음 안의 실제 드라이버 전용 건너뜀(openPostgresStore)은 보지 않는다.
  (2) '실제 PostgreSQL' 묶음 가운데 SKIP 없이 통과한 줄이 있어야 한다.
  그래서 실 DB 묶음 이름에만 '실제 PostgreSQL'을 쓴다. 지금은 wp2-db.test.ts의 'PostgreSQL 저장소(실제 PostgreSQL)'와 'HTTP 서버 + PostgreSQL 저장소(실제 PostgreSQL)'다.
- 잡 이름 check와 db는 필수 검사 이름이므로 바꾸지 않는다.
- 로컬 재현(test/에서): npm run db:up을 한 뒤, CONTRIBUTING 'Reproduce locally' 블록의 명령 세 개를 그대로 돌린다. 첫 줄은 TAP 기록 옵션이 붙은 테스트 명령이고, 두 검사는 하위 셸에서 돈다.
- npm test(foundation-ci)는 연결이 바로 거절되는 주소로 실제 wp2 파일에 건너뜀 검사를 미리 돌린다. 그래서 db를 빨강으로 만들 건너뜀은 check 잡에서 먼저 드러난다.

저장소 설정(사람이 할 일, CONTRIBUTING Repository settings와 체크리스트 2행)
- 기본 브랜치는 develop. 머지 커밋 on, squash on(둘 다 PR 제목), rebase off, 자동 브랜치 삭제 off.
- develop과 main에 ruleset을 하나씩 둔다. 허용 머지 방식은 develop이 Squash와 Merge, main이 Merge만이다.
- 필수 검사는 처음에 check만 건다. develop에 다음 순서로 넣는다: (1) GitFlow 트리거와 check만 있는 ci.yml PR (2) server/db/와 tests/wp2-db.test.ts가 든 WP2 PR (3) db 잡을 더하는 ci.yml PR. db가 develop push에서 한 번 초록이 된 뒤 두 ruleset의 필수 검사에 db를 더한다. 그보다 먼저 걸면 모든 PR이 막힌다.

커밋 범위: db(WP2: sync, server/)는 범위 표와 훅의 scopes= 양쪽에 이미 있어서 더하지 않았다.

문서 단계에서 고칠 것
- test/README.md 73행 'CI도 같은 세 단계와 ttf 4개 검사를 돈다'를 바꾼다. check 잡은 같은 세 단계와 ttf 4개를 돌고, db 잡은 실 PostgreSQL(postgres:17-alpine)로 tests/wp2-*.test.ts를 돈다는 내용으로 쓴다. 트리거(main·develop·feature/**·release/**·hotfix/** push, main·develop PR)와 로컬 재현 위치(CONTRIBUTING 'Reproduce locally')도 넣는다.
- 루트 README.md의 '브랜치 전략 (Git Flow)' 표(feature/<기능>, release/<버전>, hotfix/<내용>)는 지금 origin/main(99e3905)에만 있다. 체크리스트 2행의 main→develop 동기화가 끝난 뒤, main 쪽 내용을 바탕으로 새 이름 feature/<이니셜>/<타입>-<범위>, release/vX.Y.Z, hotfix/vX.Y.Z로 고친다. 동기화 전에 develop에서 루트 README를 고치면 첫 릴리스의 git merge origin/main에서 충돌하므로 그 전에는 건드리지 않는다.
- 새 테스트: tests/foundation-ci.test.ts(FOUNDATION, 16개). 워크플로 구조, 트리거와 동시 실행 그룹, db 잡 명령과 두 결과 검사(합성 픽스처와 실제 wp2 파일 양쪽), 로컬 재현 블록, PR 템플릿, 커밋 범위, 브랜치 이름 정규식, 커밋 제목 검사, 직접 push 검사가 CONTRIBUTING.md와 맞는지 본다.
남은 문제: tsc 오류 5건과 npm test 실패 5건은 모두 tests/wp5-background.test.ts에 있다. 위치·시뮬레이터 묶음이 작업 중인 다른 팀 파일이라 고치지 않았고, 다시 돌려도 결과가 같았다. / 새 db 건너뜀 가드(awk)는 macOS BSD awk로만 돌려 봤다. ubuntu-latest의 awk(mawk 또는 gawk)에서는 돌려 보지 않았다. POSIX 기능(match, index, substr, ERE)만 썼다. actionlint가 없고 GitHub에서도 아직 돌려 보지 않았다. / 필수 검사 적용 순서를 지키려면 지금 작업 트리의 ci.yml을 사람이 두 PR로 나눠야 한다. 먼저 트리거·permissions·concurrency와 check 잡만 담은 PR, WP2 DB PR 뒤에 db 잡을 더하는 PR이다. ruleset·기본 브랜치·머지 방식 설정도 사람이 해야 한다. 설정 화면 이름은 GitHub에서 확인하지 않았다. / WP2(서버 묶음)에 알릴 제약이 있다. 실 DB 묶음 이름에만 '실제 PostgreSQL'을 쓰고, PGlite 묶음의 테스트 이름에는 이 글자를 넣지 않는다. 넣으면 그 테스트를 PGlite에서 건너뛸 때 db 잡이 빨강이 된다. 실 DB에서만 의미 있는 테스트는 `if (backend.real) test(...)`로 등록하는 편이 더 깔끔하지만 지금 상태로도 통과한다. / foundation-ci의 실제 wp2 파일 테스트는 127.0.0.1의 1번 포트가 연결을 바로 거절한다는 것을 전제로 한다. 이 테스트 때문에 npm test가 약 2초 늘어난다. / 브랜치 이름이 feature/<이니셜>/... 형식으로 바뀌었고, release·hotfix PR은 머지 커밋으로 머지한다. GitFlow를 맞추려고 내린 결정이니 dh가 확인해야 한다. / .githooks/commit-msg가 아직 없다(체크리스트 4행). GitFlow 전에 직접 push한 커밋(develop d2a485e, main 99e3905)은 직접 push 검사의 시작점 뒤로 빼 두었다. / README 두 개(루트, test)는 문서 단계 몫이라 고치지 않았다. 고칠 내용은 doc_notes에 있다.

# 마지막 수정 뒤 리뷰 3건(아직 반영 안 됨)
### 리뷰 A 리뷰: ci.yml(GitFlow 트리거, check 유지, postgres:17-alpine db 잡, TAP 건너뜀 검사)과 CONTRIBUTING·협업규칙·PR 템플릿은 서로 맞고, 실제로 돌려 본 결과 tsc 0, npm test 729개 중 728 통과·1 건너뜀, foundation-ci 16케이스 통과였다. YAML 파싱도 정상이고 키를 쓰지 않는다. 다만 main에 있는 사용자 README의 브랜치 이름(hotfix/<내용> 등)과 규칙이 어긋나고, 마지막 문서 단계가 빈 develop README 위에 쓰면 동기화 때 충돌한다는 점이 인계되지 않았다. 넣는 순서에 foundation-ci 테스트를 어느 PR에 넣는지가 빠졌고, 구현 보고는 지금 파일과 맞지 않는다.
- [major] CONTRIBUTING.md:93 — origin/main의 루트 README.md(99e3905 '현재 프로토타입 설명', 사용자가 쓴 91줄)에는 이미 '브랜치 전략 (Git Flow)' 표가 있다. 거기 적힌 이름은 `feature/<기능>`, `release/<버전>`, `hotfix/<내용>`이다. 이번에 CONTRIBUTING.md(93·101·105행)와 협업규칙.md는 `feature/<이니셜>/<타입>-<범위>`, `release/v<X.Y.Z>`, `hotfix/v<X.Y.Z>`만 받는다. 작업 트리의 루트 README.md는 develop 쪽 빈 파일('# TMAXyoungkk' 한 줄, 개행 없음)이라 이 차이가 보이지 않는다. 구현 보고의 남은 문제와 doc_notes에도 이 내용이 없다. 실패 상황은 두 가지다. (1) 체크리스트 2행 동기화(main을 develop에 머지)를 하면 README와 CONTRIBUTING이 서로 다른 브랜치 이름을 말한다. README대로 `hotfix/login-crash`나 `feature/route`를 파면 CONTRIBUTING의 이름 검사가 BAD를 내고, 에이전트 규칙(796행)이면 작업을 멈춘다. (2) 마지막 문서 단계는 루트 README.md를 고치게 돼 있는데, 빈 develop 사본 위에 새로 쓰면 2행 동기화 PR(main → develop)에서 README.md가 양쪽 수정으로 충돌한다. 그러면 사용자가 main에 쓴 설명이 덮이거나 손으로 합쳐야 한다. CONTRIBUTING 509행도 'README를 고치는 PR보다 동기화가 먼저'라고 경고하지만, 이 순서가 문서 단계에 전달되지 않았다. → 고칠 방법: doc_notes와 open_issues에 다음을 더한다. 첫째, 루트 README.md를 고칠 때는 `git show origin/main:README.md`를 바탕으로 한다(작업 트리 사본은 빈 develop 버전이다). 아니면 사람이 2행 동기화를 먼저 한 뒤 커밋한다. 둘째, README의 '브랜치 전략 (Git Flow)' 표를 CONTRIBUTING과 맞춘다. 맞출 내용은 이름 `feature/<이니셜>/<타입>-<범위>`·`release/vX.Y.Z`·`hotfix/vX.Y.Z`, feature → develop은 Squash, release·hotfix → main은 머지 커밋 + 태그 + develop 역머지다. 셋째, dh가 확정할 항목에 '사용자가 README에 쓴 `hotfix/<내용>`·`feature/<기능>` 대신 버전·이니셜 이름을 쓰는가'를 명시한다. dh가 README 이름을 택하면 CONTRIBUTING 105·796행 정규식과 tests/foundation-ci.test.ts의 이름 검사 케이스를 함께 바꾼다.
- [minor] CONTRIBUTING.md:517 — CONTRIBUTING 517행과 협업규칙.md '처음 한 번'은 develop에 넣는 순서를 (1) GitFlow 트리거에 `check`만 있는 ci.yml → (2) WP2 서버 DB PR → (3) `db` 잡 추가로 적었다. 그런데 tests/foundation-ci.test.ts를 어느 PR에 넣는지는 없다. 이 테스트는 잡이 정확히 ['check','db']인지, db 단계가 4개인지(dbRuns), wp2 파일에 '실제 PostgreSQL' 묶음과 process.env.YT_TEST_DATABASE_URL이 있는지를 검사한다. 그래서 (1)에 같이 넣으면 그 PR의 `check`(npm test)가 빨갛게 되고, 그때는 이미 `check`를 필수로 거는 규칙이 있어 머지가 막힌다. 크기 규칙과도 어긋난다. 이 테스트 파일은 FOUNDATION이고 476줄이다. 같은 문서가 'ci.yml을 고치는 PR은 따로, 100줄 이하'(430행)이고 '400줄 초과 예외에는 FOUNDATION 파일 금지'(284행)라고 정해서, 이 테스트가 든 PR은 어떤 경우에도 규칙을 지킬 수 없다. → 고칠 방법: 순서 문장(CONTRIBUTING 517행, 협업규칙.md 마지막 줄)에 'tests/foundation-ci.test.ts는 (3) `db` 잡 PR과 함께 넣는다(앞 단계에서는 실패한다)'를 더하고, 이 파일 하나는 크기 예외라고 적는다. 더 나은 방법도 있다. TAP 검사(awk·grep 한 줄 명령)를 test/scripts 아래 node 스크립트 하나로 옮겨 워크플로·CONTRIBUTING 재현 블록·테스트가 함께 부르게 한다. 그러면 bash 재현 테스트가 줄어 PR 크기 규칙 안으로 들어온다.
- [minor] .github/workflows/ci.yml:89 — 구현 보고의 요약·게이트·남은 문제가 지금 파일과 맞지 않는다. 마지막 문서 단계가 이것을 그대로 옮기면 틀린 안내가 된다. (a) 보고에는 'db 잡이 YT_TEST_DATABASE_URL을 읽는 테스트가 없으면 먼저 빠르게 실패한다', '서버 팀 실 DB 테스트가 들어오기 전까지 db 잡은 실패한다'고 돼 있다. 실제 ci.yml에는 그런 사전 검사 단계가 없다. 지금 단계는 테스트 실행, TAP 건너뜀 검사, '실제 PostgreSQL' 묶음 통과 검사 셋이다. tests/wp2-db.test.ts도 이미 있어서 로컬 건너뜀 검사가 통과한다. (b) 보고는 'foundation-ci 8케이스, tsc 9오류, npm test 1실패'라고 했다. 지금 다시 돌리면 foundation-ci 16케이스 통과, tsc 0, npm test 729개 중 728 통과·1 건너뜀·0 실패다. (c) 보고는 'CONTRIBUTING 65행과 협업규칙.md 처음 한 번 문단을 그대로 뒀다'고 했지만, 두 곳 모두 이미 '루트가 저장소다'로 고쳐져 있다. → 고칠 방법: doc_notes와 남은 문제를 지금 상태로 다시 쓴다. db 잡은 실 PostgreSQL에서 tests/wp2-*.test.ts를 한 파일씩 돌린 뒤 TAP으로 두 가지를 확인한다. 하나는 '실제 PostgreSQL' 묶음 안의 건너뜀과 YT_TEST_DATABASE_URL 때문에 생긴 건너뜀이 없는지, 다른 하나는 그 묶음이 통과했는지다. 실 DB 묶음은 이름에 '실제 PostgreSQL'을 단다. 로컬 재현은 `npm run db:up` 뒤 CONTRIBUTING의 세 줄이다. 게이트 수치는 tsc 0, 729/728 통과/1 건너뜀, foundation-ci 16으로 고친다. 이미 처리된 '남겨 둔 오래된 문장' 항목은 지운다.
### 리뷰 B 리뷰: CI·문서는 GitFlow에 맞게 바뀌었고 게이트는 직접 돌려 모두 통과했다(npx tsc --noEmit 0건, npm test 729개 중 728 통과·0 실패·1 건너뜀, node scripts/gate-scope.mjs WP2 통과, ci.yml은 yaml 패키지 strict 파싱 오류 0, foundation-ci 단독 2회 반복 통과). ci.yml 트리거·permissions·concurrency·db 잡(postgres:17-alpine, YT_TEST_DATABASE_URL, 건너뜀·실 DB 묶음 검사), secret 없음, PR 템플릿과 CONTRIBUTING 일치, 범위 표의 db, 앵커 링크, 브랜치 정규식에서 문제를 찾지 못했다. 남은 것은 넣는 순서·PR 크기 규칙과 관련된 사소한 문제 두 가지다.
- [minor] 협업규칙.md:30 — 협업규칙.md 30행과 CONTRIBUTING.md 517행은 develop에 PR을 세 번에 나눠 넣으라고 한다. (1) ci.yml(GitFlow 트리거, check 잡만) (2) WP2 서버 DB PR (3) ci.yml에 db 잡 추가. 그런데 tests/foundation-ci.test.ts를 어느 PR에 넣을지는 적혀 있지 않다. 이 테스트는 잡이 정확히 ['check','db']인지, db 잡 단계가 4개인지, tests/wp2-*.test.ts에 YT_TEST_DATABASE_URL을 읽는 '실제 PostgreSQL' 묶음이 있는지를 확인한다. 테스트를 ci.yml 변경과 같이 (1) PR에 넣거나 CONTRIBUTING 변경과 같이 넣으면(PR 템플릿 일치 검사 때문에 같이 넣고 싶어진다) 그 PR의 check 잡이 npm test에서 빨갛게 된다. 이미 머지됐다면 (3)이 들어갈 때까지 develop이 빨간불이 되고, 'develop 빨간불이면 30분 안에 되돌림' 규칙에 걸린다. → 고칠 방법: CONTRIBUTING.md 517행 문단과 협업규칙.md 30행에 tests/foundation-ci.test.ts, 그리고 그 테스트가 보는 CONTRIBUTING의 'Job db…' 문단·로컬 재현 블록은 (3) db 잡 PR에 같이 넣는다고 한 문장 더한다. 아니면 db 관련 테스트 묶음(잡 db 구조, 결과·건너뜀 검사, 로컬 재현 일치)을 jobs에 db가 있을 때만 돌게 나눠서 (1) 단계에서도 초록이 되게 한다.
- [minor] test/tests/foundation-ci.test.ts:1 — 새 FOUNDATION 테스트 파일이 476줄이다. 저장소 규칙(CONTRIBUTING.md 430행 Shared files: FOUNDATION 변경은 '별도 PR, 100줄 이하')으로는 한 PR에 넣을 수 없다. 284행 크기 예외('크기 사유')도 FOUNDATION 파일이 있으면 쓸 수 없다. 위 (3) PR에 ci.yml diff 72줄과 함께 넣으면 550줄 가까이 되어 리뷰어가 규칙대로 반려해야 한다. 이 기능 범위(.github/**, CONTRIBUTING.md, 협업규칙.md)에 비해 테스트가 너무 크다. YAML 미니 파서, ${{ }} 식 평가기(new Function), 로컬 git 이력 검사, WP2 전체 묶음을 두 번 더 돌리는 검사까지 들어 있다. → 고칠 방법: 두 방법 중 하나를 고른다. (a) 구조 검사(트리거·잡·단계·secret 없음·템플릿 일치·범위 표·브랜치 정규식)와 db 결과·건너뜀 검사(bash 실행)를 각각 100줄 안팎 파일 두세 개로 나누고, 넣을 순서를 체크리스트에 적는다. (b) dh가 이 PR을 공유 파일 100줄 규칙의 예외로 승인한다고 CONTRIBUTING이나 PR 본문에 남긴다. 덜 중요한 검사(직접 push 범위 검사 두 개, concurrency 식 평가)는 줄여도 된다.
### 리뷰 C 리뷰: No blocker or major issues. The YAML parses with both yaml and js-yaml, and the parsed run steps match the raw lines. foundation-ci passes 16/16. Four runs of npm test each gave 729 tests, 0 failures. tsc reports 0 errors. Three gaps found: the db job catches a real-DB suite leaving the glob only when all of them leave (reproduced); the landing order clashes with foundation-ci and the size rules; and the README sync risk is not handed to the docs step. The real PostgreSQL run could not be reproduced because the docker daemon is not running here. Also, parts of the implementation report do not match the current files. It says there is a fail-fast guard step, but the current ci.yml has none; it now checks the TAP output after the run. It says CONTRIBUTING line 65 and the 협업규칙 '처음 한 번' section were left untouched, but both have been updated. It says the db job stays red because wp2-db is missing, but tests/wp2-db.test.ts now exists. Those parts of the report should not be used for doc_notes.
- [minor] .github/workflows/ci.yml:105 — The db job only fails when every real-DB suite disappears from tests/wp2-*.test.ts. If any single suite named '실제 PostgreSQL' still passes, the job is green. Reproduced in the scratchpad (scratchpad/ci/split) by running the job's three run steps exactly as parsed from the YAML. Setup: tests/wp2-db.test.ts keeps only the 'HTTP 서버 + PostgreSQL 저장소(실제 PostgreSQL)' suite, and 'PostgreSQL 저장소(실제 PostgreSQL)' moves to tests/integration-db.test.ts (for example when the 62KB file is split). Result: test step 0, skip check 0, passing-suite check 0, so the job is green while the store suite never runs against real PostgreSQL in CI. npm test (job check) has no URL, so it also skips that suite silently. The nested-run check in foundation-ci only looks at wp2 files, so it misses this too. CONTRIBUTING.md line 669 says red means 'The real-database suite is gone, renamed or moved out of tests/wp2-*.test.ts', which is wrong for the current setup with two suites. The 'moved to another file' case in foundation-ci only covers a single suite moving. → 고칠 방법: Make the db job follow the marker instead of a fixed glob, for example files=$(grep -rl '실제 PostgreSQL' tests --include='*.test.ts') and pass those to node --test. Alternatively, add a check to foundation-ci that strips comments from every tests/**/*.test.ts file and fails if any file outside wp2-*.test.ts contains the string literal '실제 PostgreSQL'. Add a test case where only one of two suites moves out, and update line 669 of CONTRIBUTING to match.
- [minor] CONTRIBUTING.md:517 — The documented landing order cannot be followed as written. The doc says to land into develop in order: (1) ci.yml with only job check, (2) the WP2 DB PR, (3) ci.yml adding job db. But test/tests/foundation-ci.test.ts has these hard requirements: jobs are exactly ['check','db'] (keys(jobs) deepEqual); db has 4 run steps (dbRuns); tests/wp2-*.test.ts reads YT_TEST_DATABASE_URL and has a '실제 PostgreSQL' suite; and the 'Reproduce locally' block in CONTRIBUTING matches the db job commands character for character. So if foundation-ci.test.ts or the GitFlow and CI sections of CONTRIBUTING go into (1) or (2), npm test in job check fails for certain. The doc does not say which PR these two files belong in. On top of that, foundation-ci.test.ts is a 476-line FOUNDATION file. CONTRIBUTING's own rules cap shared-file PRs at 100 lines, and the over-400-line exception does not allow FOUNDATION files, so the file cannot go into any PR. → 고칠 방법: Add a sentence to the order paragraph (and to line 30 of 협업규칙.md): tests/foundation-ci.test.ts and the job db part of CONTRIBUTING 'What CI runs' (the Reproduce block included) go into (3) together; (1) carries only the triggers, concurrency, the GitFlow docs and the PR template. Either cut foundation-ci down (for example, merge the temp-folder reproduction cases into one) so it fits the size rules, or record in open_issues that it needs a size exception decided by dh. Alternatively, state that (1) through (3) may land as a single PR.
- [minor] CONTRIBUTING.md:509 — Commit 99e3905, which exists only on main, changed the root README.md from the one line '# TMAXyoung' to the 92-line prototype description. The working tree is based on develop, and its README.md is still one line. This workflow's final docs step plans to edit the root README.md. If that edit is committed to develop before the row-2 main→develop sync PR, the sync PR conflicts on README.md, because both sides changed the same file. If the conflict is resolved by taking develop's side, main's 92-line description is lost. CONTRIBUTING mentions this ordering, but the implementation report's open issues and doc_notes do not, so the docs step is never told. → 고칠 방법: Add to open_issues/doc_notes: 'Before editing the root README.md, either merge the row-2 sync PR (main→develop) first, or have the docs step write README.md starting from the content of git show origin/main:README.md.'
