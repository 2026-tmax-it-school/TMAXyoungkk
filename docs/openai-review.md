# OpenAI PR 코드리뷰

현재 상태: **초안, 기본 비활성화**. 병합만으로 API가 호출되지 않습니다. 결제·키·권한 설정은 이 변경에 포함되지 않습니다. 기존 `CI`는 그대로 유지합니다.

## 활성화 전 체크리스트

1. 관리자가 코드를 검토하고 PR을 병합합니다. `workflow_run` 수신 워크플로는 기본 브랜치에 있어야 합니다.
2. 사용자가 OpenAI API 결제와 전용 프로젝트를 직접 준비하고, **Enforce a hard limit**을 켭니다. 모든 참여 저장소가 같은 전용 프로젝트를 사용해야 조직 전체 지출을 합산할 수 있습니다.
3. 월 10,000원에서 세금·환율·동시 요청 및 한도 반영 지연 여유를 뺀 보수적인 USD 한도를 정합니다. 알림만 설정해서는 지출이 차단되지 않습니다. 자동 충전은 끕니다. 이 코드는 원화 결제액을 보장하는 결제 시스템이 아닙니다.
4. 사용자가 전용 프로젝트 키를 해당 저장소의 Actions secret `OPENAI_API_KEY`에 직접 등록합니다. 키를 채팅·코드·앱의 `EXPO_PUBLIC_*`에 넣지 않습니다. 조직 secret 사용 시 선택한 저장소로만 제한합니다.
5. 위 절차와 코드 diff의 OpenAI 전송을 확인한 뒤 Actions variable `OPENAI_REVIEW_BUDGET_CONFIRMED=true`, 마지막으로 `OPENAI_REVIEW_ENABLED=true`를 설정합니다. 중지하려면 `OPENAI_REVIEW_ENABLED`를 지우거나 `false`로 바꿉니다.

## 동작과 한계

- 기본 브랜치를 대상으로 하는 같은 저장소의 열린 일반 PR만 대상입니다. fork, bot, draft, 쓰기 권한 없는 작성자, 실패한 CI, 지난 head SHA는 제외합니다.
- `CI` 성공 후 신뢰된 고정 SHA의 리뷰어만 실행합니다. PR 코드를 checkout·실행하거나 의존성/산출물을 설치하지 않습니다. PR의 제목·본문도 모델에 보내지 않습니다.
- 모델은 `gpt-6-luna`, Responses API, low reasoning, 출력 최대 2,000토큰, 도구 없음, `store:false`입니다. 변경 파일 100개 초과 PR은 건너뜁니다. 최대 20개 파일/32,000바이트 diff만 보내며 요청 JSON도 40,000바이트로 제한합니다.
- 비밀 관련 경로, 숨김 디렉터리, lockfile, 생성물·바이너리 등은 제외합니다. 패턴 필터가 모든 비밀을 탐지하지는 못하므로 민감한 정보를 커밋하지 않아야 합니다. 모델 응답과 코드 diff를 로그에 기록하지 않습니다.
- 최대 5개의 high/medium 문제를 변경된 추가 라인에 한해 요약 `COMMENT` 리뷰로 게시합니다. 승인·변경 요청·자동 수정·병합은 하지 않습니다. 제공된 부분 diff만 검토하므로 누락/오탐이 가능하며 사람의 리뷰가 필요합니다.
- API 요청 전에 SHA별 리뷰 예약을 기록합니다. 실패·타임아웃도 같은 SHA에서는 자동 재시도하지 않습니다. GitHub의 동일 저장소 concurrency로 요청을 직렬화합니다. 최대 100개 실행이 대기하며 이를 넘는 실행은 GitHub가 취소할 수 있습니다.
- draft를 ready로 바꾸는 것만으로 기존 CI가 다시 실행되지 않을 수 있습니다. 필요하면 기존 CI를 재실행하거나 새 커밋을 푸시합니다. 아직 API를 호출하지 않은 SHA만 검토합니다.

## 새 저장소에 적용

동봉된 `workflow-templates/openai-review.yml`을 새 저장소의 `.github/workflows/openai-review.yml`에 복사합니다. 코드 저장소 전체를 복사할 필요가 없습니다. 템플릿은 중앙 재사용 워크플로의 불변 SHA를 참조합니다.

새 저장소에도 `pull_request`를 받는 CI가 있어야 합니다. 이름이 `CI`, 경로가 `.github/workflows/ci.yml`과 다르면 템플릿의 `workflows`, `ci-name`, `ci-path`를 함께 변경합니다. 위 활성화 체크리스트도 저장소마다 적용합니다.

조직의 Actions 템플릿 선택기에 표시하려면 별도 공개 `2026-tmax-it-school/.github` 저장소의 `workflow-templates/`에 yml과 properties.json을 게시해야 합니다. 공통 템플릿 게시 위치: https://github.com/2026-tmax-it-school/.github/tree/main/workflow-templates (별도 공개 저장소). 템플릿은 새 저장소에 자동 설치되지 않으며 선택/복사가 필요합니다. 일반 새 저장소 생성까지 자동 감지하려면 별도 GitHub App 등이 필요합니다.

## 검증 및 유지보수

`node --test .github/scripts/openai-review.test.mjs`는 네트워크·실제 API 키 없이 동작합니다. paid API 호출은 아직 검증하지 않았습니다. 새 리뷰어 버전을 배포할 때 재사용 워크플로의 소스 SHA와 템플릿의 워크플로 SHA를 함께 검토·갱신합니다. 중앙 저장소/고정 커밋을 삭제하면 재사용이 중단됩니다.

공식 근거 (2026-10-05 확인): [모델](https://developers.openai.com/api/docs/models/gpt-6-luna), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [지출 한도](https://developers.openai.com/api/docs/guides/spend-limits), [재사용 워크플로](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [조직 템플릿](https://docs.github.com/en/actions/how-tos/reuse-automations/create-workflow-templates)
