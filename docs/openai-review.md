# OpenAI PR 코드리뷰

기본 설정: **비활성화**. 병합만으로 API가 호출되지 않습니다. 결제·키·권한 설정은 이 변경에 포함되지 않습니다. `CI` 검사는 유지하며 PR 대상 브랜치는 `main`, `develop`입니다.

## 활성화 전 체크리스트

1. 관리자가 코드를 검토하고 PR을 병합합니다. `workflow_run`/`workflow_dispatch` 수신 워크플로는 기본 브랜치에 있어야 합니다.
2. 사용자가 OpenAI API 결제와 전용 프로젝트를 직접 준비하고, **Enforce a hard limit**을 켭니다. 모든 참여 저장소가 같은 전용 프로젝트를 사용해야 조직 전체 지출을 합산할 수 있습니다.
3. 월 10,000원에서 세금·환율·동시 요청 및 한도 반영 지연 여유를 뺀 보수적인 USD 한도를 정합니다. 알림만 설정해서는 지출이 차단되지 않습니다. 자동 충전은 끕니다. 이 코드는 원화 결제액을 보장하는 결제 시스템이 아닙니다.
4. 사용자가 전용 프로젝트 키를 이 저장소의 Actions secret `KEY`에 직접 등록합니다. 이 저장소의 호출 워크플로는 `KEY`를 재사용 워크플로의 `OPENAI_API_KEY` 입력으로 전달합니다. 새 저장소용 템플릿의 기본 secret 이름은 `OPENAI_API_KEY`입니다. 키를 채팅·코드·앱의 `EXPO_PUBLIC_*`에 넣지 않습니다. 조직 secret 사용 시 선택한 저장소로만 제한합니다.
5. 위 절차와 코드 diff의 OpenAI 전송을 확인한 뒤 Actions variable `OPENAI_REVIEW_BUDGET_CONFIRMED=true`, 마지막으로 `OPENAI_REVIEW_ENABLED=true`를 설정합니다. 중지하려면 `OPENAI_REVIEW_ENABLED`를 지우거나 `false`로 바꿉니다.

## 동작과 한계

- 자동 리뷰는 기본 브랜치(`main`) 또는 `develop`을 대상으로 하는 같은 저장소의 열린 일반 PR만 대상입니다. fork, bot, draft, 쓰기 권한 없는 작성자, 실패한 CI, 지난 head SHA는 자동 경로에서 제외합니다. 외부 fork는 아래 관리자 수동 승인 경로만 사용합니다.
- 자동 경로는 `CI` 성공 후, fork 수동 경로는 관리자 승인 후 신뢰된 고정 SHA의 리뷰어만 실행합니다. PR 코드를 checkout·실행하거나 의존성/산출물을 설치하지 않습니다. PR의 제목·본문도 모델에 보내지 않습니다.
- 모델은 `gpt-6-luna`, Responses API, low reasoning, 출력 최대 2,000토큰, 도구 없음, `store:false`입니다. 변경 파일 수로 PR 전체를 제외하지 않습니다. 파일 목록은 100개씩 페이지를 넘겨 조회하며 최대 20개 파일/32,000바이트 diff만 보냅니다. 요청 JSON도 40,000바이트로 제한합니다.
- 자동 경로의 GitHub 파일 목록 API는 PR당 최대 3,000개만 제공합니다. 더 큰 PR도 조회된 파일에서 부분 검토하며, 결과에 전체 파일 수·검토 파일 수·필터/예산으로 제외된 수·API 한도로 미조회한 수를 표시합니다. 3,000개 이내에서 목록이 불완전하거나 중복되면 비용 발생 전에 중단합니다.
- 비밀 관련 경로, 숨김 디렉터리, lockfile, 생성물·바이너리 등은 제외합니다. 패턴 필터가 모든 비밀을 탐지하지는 못하므로 민감한 정보를 커밋하지 않아야 합니다. 모델 응답과 코드 diff를 로그에 기록하지 않습니다.
- 최대 5개의 high/medium 문제를 변경된 추가 라인에 한해 요약 `COMMENT` 리뷰로 게시합니다. 승인·변경 요청·자동 수정·병합은 하지 않습니다. 제공된 부분 diff만 검토하므로 누락/오탐이 가능하며 사람의 리뷰가 필요합니다.
- API 요청 전에 SHA별 리뷰 예약을 기록합니다. 실패·타임아웃도 같은 SHA에서는 자동 재시도하지 않습니다. GitHub의 동일 저장소 concurrency로 요청을 직렬화합니다. 최대 100개 실행이 대기하며 이를 넘는 실행은 GitHub가 취소할 수 있습니다.
- draft를 ready로 바꾸는 것만으로 기존 CI가 다시 실행되지 않을 수 있습니다. 필요하면 기존 CI를 재실행하거나 새 커밋을 푸시합니다. 아직 API를 호출하지 않은 SHA만 검토합니다.

## 외부 fork PR: 관리자 수동 승인

포크는 자동 과금하지 않습니다. 저장소의 현재 **admin** 권한을 가진 사용자만 특정 PR의 **전체 40자리 head SHA + 대상 브랜치**를 승인해 부분 diff 리뷰를 실행합니다. `write`/`maintain` 권한, 작성자 관계, 라벨, PR 댓글은 승인이 아닙니다. 키나 별도 토큰을 새로 만들지 않습니다.

### 실행 방법

1. 열린 일반 fork PR에서 대상 브랜치(`main` 또는 `develop`)와 Commits의 최신 커밋 **전체 40자리 SHA**를 확인합니다.
2. 저장소 **Actions → OpenAI code review → Run workflow**로 갑니다. 워크플로 실행 브랜치는 반드시 기본 브랜치 **main**을 그대로 둡니다. 이것은 PR 대상 브랜치와 별개입니다.
3. `pr-number`에 PR 번호, `head-sha`에 최신 전체 SHA, `base-branch`에 PR 대상 브랜치를 넣습니다. 예: `6`, `40자리 실제 SHA`, `develop`.
4. **Run workflow**를 누르면 그 PR/SHA/대상 브랜치의 제한된 diff를 OpenAI로 보내는 1회 검토를 승인합니다. 기존 활성화/예산 설정이 켜져 있어야 합니다.
5. PR의 COMMENT 리뷰와 해당 Actions 로그에서 결과 또는 건너뛴 이유를 확인합니다. head가 바뀌면 새 SHA를 다시 승인해야 합니다. **Re-run jobs**는 허용하지 않으며 새 Run workflow를 사용합니다. 이미 예약/시도한 SHA는 새 실행에서도 재과금하지 않습니다.

English: Open the fork PR → copy its latest full head SHA and target branch → Actions → OpenAI code review → Run workflow on the default branch → enter `pr-number`, `head-sha`, and `base-branch` → Run workflow. Only a current repository admin can authorize this one-time partial diff inspection.

### 승인과 안전 경계

- 이 경로는 **CI 성공 여부와 독립적인 관리자 승인 diff 검토**입니다. 테스트 실패 코드를 살펴보는 데도 쓸 수 있지만 CI 통과, PR 승인, 병합 가능 여부를 뜻하지 않습니다. 기존 CI와 브랜치 보호/병합 조건은 그대로입니다. GitHub의 일반 fork CI 실행 승인 버튼도 이 OpenAI 승인과 별개입니다.
- 최초 실행만 허용하고 실제 실행자의 GitHub ID와 이벤트 송신자를 대조한 뒤 현재 admin 권한을 조회합니다. 권한은 비용 발생 전과 결과 게시 전에도 재확인합니다. 기본 브랜치 밖의 dispatch, 재실행, bot/draft/닫힌 PR, 같은 저장소 PR의 수동 실행은 건너뜁니다.
- 승인한 head SHA와 대상 브랜치가 현재 PR과 일치해야 합니다. 실행 시작 시 대상의 base SHA도 고정하고, head 저장소/브랜치/SHA 및 base 저장소/브랜치/SHA가 바뀌면 비용 발생 전 중단하거나 이미 발생한 결과를 보류합니다.
- fork diff는 **고정 base SHA...head SHA 비교 API**에서 데이터로만 읽습니다. force-push 후 되돌리기로 다른 커밋의 diff를 섞을 수 없도록 가변 PR 파일 목록을 쓰지 않습니다. PR 코드, 워크플로, 패키지, 캐시, 산출물을 실행하지 않고 비밀값도 모델에 보내지 않습니다. 모델 도구도 없습니다.
- GitHub 불변 비교 API는 처음 **300개 파일 목록**만 제공합니다. 그중 최대 **20개 파일/32,000바이트**를 검토하고 전체·선택·제외·미조회 수를 결과에 표시합니다. 160개 파일 PR도 지원합니다. 자동 경로는 기존 100개씩/최대 3,000개 목록 조회를 유지합니다.
- 자동/수동 경로는 같은 저장소 실행 큐와 PR/head SHA 예약을 공유합니다. API 실패/타임아웃도 자동 재시도하지 않습니다. 승인·base·head·실행 링크는 리뷰에 기록하며, 결과는 그 head 커밋의 COMMENT 리뷰에만 남깁니다. 마지막 확인 직후 PR 상태가 바뀌는 작은 경쟁 구간까지 원자적으로 잠그지는 않으므로 표시된 SHA와 현재 PR을 함께 확인하세요.
- 이 설계는 외부 fork 코드를 실행하지 않는 안전 경계입니다. 이미 비밀을 사용하는 저장소 워크플로를 수정할 수 있는 내부 쓰기 권한자의 악성 변경까지 차단하는 별도 보안 샌드박스는 아닙니다.

## 새 저장소에 적용

동봉된 `workflow-templates/openai-review.yml`을 새 저장소의 `.github/workflows/openai-review.yml`에 복사합니다. 코드 저장소 전체를 복사할 필요가 없습니다. 템플릿은 중앙 재사용 워크플로의 불변 SHA를 참조합니다.

새 저장소에도 기본 브랜치와 `develop` 대상 `pull_request`를 받는 CI가 있어야 합니다. 이름이 `CI`, 경로가 `.github/workflows/ci.yml`과 다르면 템플릿의 `workflows`, `ci-name`, `ci-path`를 함께 변경합니다. 위 활성화 체크리스트도 저장소마다 적용합니다.

조직의 Actions 템플릿 선택기에 표시하려면 별도 공개 `2026-tmax-it-school/.github` 저장소의 `workflow-templates/`에 yml과 properties.json을 게시해야 합니다. 공통 템플릿 게시 위치: https://github.com/2026-tmax-it-school/.github/tree/main/workflow-templates (별도 공개 저장소). 템플릿은 새 저장소에 자동 설치되지 않으며 선택/복사가 필요합니다. 일반 새 저장소 생성까지 자동 감지하려면 별도 GitHub App 등이 필요합니다.

## 검증 및 유지보수

`node --test .github/scripts/openai-review.test.mjs`는 네트워크·실제 API 키 없이 동작합니다. paid API 호출은 아직 검증하지 않았습니다. 새 리뷰어 버전을 배포할 때 재사용 워크플로의 소스 SHA와 템플릿의 워크플로 SHA를 함께 검토·갱신합니다. 스크립트 변경 커밋 → 그 커밋으로 checkout SHA를 갱신한 워크플로 커밋 → 그 워크플로 커밋으로 템플릿 SHA를 갱신하는 순서로 고정합니다. 기존 저장소에 복사한 템플릿과 별도 조직 `.github` 저장소는 자동 갱신되지 않습니다. 중앙 저장소/고정 커밋을 삭제하면 재사용이 중단됩니다.

공식 근거 (2026-10-05 확인): [모델](https://developers.openai.com/api/docs/models/gpt-6-luna), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [지출 한도](https://developers.openai.com/api/docs/guides/spend-limits), [재사용 워크플로](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [조직 템플릿](https://docs.github.com/en/actions/how-tos/reuse-automations/create-workflow-templates)

파일 목록 한도: [GitHub REST API](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files) (2026-10-10 확인).

포크 수동 경로 공식 근거 (2026-10-10): [수동 실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [재실행 actor](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context), [저장소 권한 확인](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user), [불변 비교 및 300개 파일 한도](https://docs.github.com/en/rest/commits/commits#compare-two-commits).
