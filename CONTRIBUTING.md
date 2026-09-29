# Contributing to Young Trip

This file is for the two developers, 한동관 (dh) and 최윤재 (yj), and the AI coding agents (Claude Code) they run. It is the single source of collaboration rules: humans and agents follow it as written. Roles live in [`역할분담.md`](역할분담.md).

---

## Quick reference

| Rule | Daily standard |
| --- | --- |
| Branch | `<initials>/<type>-<scope>` from `main`, e.g. `dh/feat-route-finding`, `yj/fix-chat-order`; types `feat` `fix` `refactor` `chore` `docs`; one branch per feature, never per person; English only |
| Commit and PR title | `type(scope): 한국어 명사형 설명`, ≤50 chars, e.g. `feat(route): 도보 구간 이동 시간 계산 추가`; types add `test` `style` (commits only; a PR title's type equals the branch type); hook `.githooks/commit-msg` |
| PR size and age | ≤400 insertions + deletions (lockfile, `test/assets` excluded; shared-file PR ≤100); first commit to merge ≤72 h; Draft PR the day the branch is cut |
| Before `gh pr ready` (in `test/`) | `npm run gate:wp -- WP<n>` for each work package you changed (skip if only FOUNDATION or root files), then `npm run typecheck && npm test && npm run export:web`, ttf count = 4 |
| Review deadline | First review 24 h (phases 7–8: 6 h); re-review 4 h (2 h); revert 30 min |
| Merge | Squash only; 1 approval from the other developer; CI `check` green; threads resolved; `gh pr merge --squash --delete-branch` |
| `main` red | Post in team chat; fix or revert within 30 min, revert merged within 60 min; phases 7–8 revert only |
| Never commit | `.env`, `.env*.local`, `*.key`, any key value; AI provider keys live only on the proxy; every `EXPO_PUBLIC_*` value is public |
| Dependencies | `npx expo install <pkg>` in `test/`, separate PR, never `npm install <pkg>` |
| Disagreements | 한동관 (dh) decides anything not settled in writing; roles: `역할분담.md` |

---

## Contents

- [Quick reference](#quick-reference)
- [Overview and daily loop](#overview-and-daily-loop)
- [Branching model](#branching-model)
- [Commit conventions](#commit-conventions)
- [Pull requests and review](#pull-requests-and-review)
- [Code ownership and conflict prevention](#code-ownership-and-conflict-prevention)
- [Development environment, configuration, and secrets](#development-environment-configuration-and-secrets)
- [Issues, labels, milestones, and the board](#issues-labels-milestones-and-the-board)
- [CI, quality gates, and releases](#ci-quality-gates-and-releases)
- [Working with AI coding agents](#working-with-ai-coding-agents)

---

## Overview and daily loop

Young Trip plans domestic Korean group trips: trip room, chat, place extraction, auto-built daily timetable and route. Two students, IT희망학교. Expo SDK 57, React Native 0.86, TypeScript, zustand. With no keys it runs on local mocks.

This file is the only rulebook, for humans and Claude Code. Roles: [`역할분담.md`](역할분담.md) (authoritative). Branch names are English only. Commit subjects and PR titles are `type(scope): 한국어 설명`, e.g. `feat(route): 도보 구간 이동 시간 계산 추가`. Locked rules: [Branching model](#branching-model).

**Current phase** = the lowest-numbered open milestone: `gh api 'repos/{owner}/{repo}/milestones?state=open' --jq '[.[].title]|sort|.[0]'`. Every rule that names a phase uses this.

### Team

| Person | GitHub | Owns |
| --- | --- | --- |
| 한동관 (`dh`) | `@<fill-in>` | Lead; foundation; schedule and routes; map, GPS, route finding, activity suggestion, path recording |
| 최윤재 (`yj`) | `@<fill-in>` | Design and tokens; presentation; chat, place extraction, AI API; candidates; guest session, invite; photo markers, diary, exchange rate |

Team chat: `<fill-in: messenger and room name>`. Weekly review day: `<fill-in: weekday>`. Every "post in team chat" rule means this room. Fill in the GitHub IDs, the room and the day in the first docs PR.

Unsettled disputes: 한동관 (dh) decides. File ownership: see [Ownership map](#ownership-map).

### Where things live

- `test/`: the app. Run every command from `test/` unless its block starts with `cd` or its section says "from the root"; git works from either.
- `여행계획-앱-기능명세서-v0.2.md`: spec, FR numbers.
- `docs/`: `FR-추적표.md`, `plan.json`, `meetings/`.
- `HANDOFF.md`: handover between AI sessions.

The root is not a git repository yet: do [One-time setup](#one-time-setup-root-repository) first.

### Daily loop

1. Start, from the repo root:
   ```bash
   git switch main && git pull --ff-only   # fails: see [Create, sync, delete](#create-sync-delete)
   git diff --quiet main@{1} main -- test/package-lock.json || (cd test && npm ci)
   (cd test && npm start)                  # port 8090; RN_PORT overrides
   ```
2. Create the branch and Draft PR: [Create, sync, delete](#create-sync-delete).
3. While working, from `test/`: `npm run gate:wp -- WP<n>` for each work package your changed files belong to ([ownership command](#ownership-map)) is advisory; it must exit 0 before `gh pr ready`. Only FOUNDATION or root files changed: skip it (it accepts only `WP1`–`WP6` and exits 2 otherwise) and write `gate:wp: 해당 없음` under `## 어떻게 확인했나`.
4. End of day: commit and push, finished or not. Secrets: [Keys](#keys); leak: [When a key leaks](#when-a-key-leaks).
5. Before `gh pr ready`, rebase onto `main` ([Create, sync, delete](#create-sync-delete)), then run the [pre-PR checks](#when-a-check-is-red).
6. After merge: [Merging](#6-merging).

### Changing this document

Change a rule that is wrong or broken twice; do not ignore it. Branch `<initials>/docs-contributing`; PR body names the rule, when it broke, and the replacement. Self-merge: [PR §3](#3-review-request-and-deadlines), except a PR that changes a locked rule (the first paragraph of [Branching model](#branching-model), Conventional Commits with an English type and Korean description, `.env` never committed, CI `check`): it needs the other developer's approval and is never self-merged.

---

## Branching model

GitHub Flow. Only `main` lives long: no `develop`, `release/*`, `hotfix/*`, or per-person branches (`dh/main`); one branch per feature (decided, do not reopen). Releases are tags `v0.1.0`, `v0.2.0`, `v0.9.0`, `v1.0.0`. `main` is always runnable: no direct pushes, PR only, 1 approval from the other developer, green CI, **squash merge only**. Repo settings: [Repository settings](#repository-settings).

### Names

`<initials>/<type>-<scope>`:

| Slot | Allowed |
| --- | --- |
| initials | `dh`, `yj`: the issue's assignee, who is the PR author |
| type | `feat` `fix` `refactor` `chore` `docs`; `test`/`style` work is `chore` |
| scope | `a-z0-9`, 1–3 hyphen-joined words, 3–20 chars, no issue number |

```bash
b=$(git branch --show-current); s=${b#*-}
echo "$b" | grep -Eq '^(dh|yj)/(feat|fix|refactor|chore|docs)-[a-z0-9]+(-[a-z0-9]+){0,2}$' && [ ${#s} -ge 3 ] && [ ${#s} -le 20 ] && echo OK || echo BAD
```

The reviewer rejects `BAD` (CI does not check). Rename, no PR yet: `git branch -m <new> && git push -u origin <new> && git push origin --delete <old>`. Open PR: renaming or deleting its head branch closes it, so recreate it: `git branch -m <new> && git push -u origin <new>`, `gh pr create --draft --base main --title "<same title>" --body-file <saved body>`, then `gh pr close <old-pr> --comment "Superseded by #<new-pr>" && git push origin --delete <old>`.

### One branch = one issue = one PR

1. Issue first (task or bug template); PR body: `Closes #12`.
2. Side fix only if under 20 changed lines, in a file this PR already touches and that you own ([ownership command](#ownership-map)), and `grep -rln '<changed symbol>' src` lists only files already in this PR: own commit, listed under `## 함께 고친 것`. Else or unsure: new issue.
3. Never reuse a deleted name; follow-ups get a narrower one (`dh/feat-route-detail`, not `-2`); a broken merge gets a new issue and a `fix-` branch.

### Lifetime: 72 hours

First commit to merge ≤ 72 h, weekends included; size limit: [PR §1](#1-open-and-describe-the-pr); Draft PR the day the branch is cut. First to start work each day runs:

```bash
gh pr list --state open --json number,headRefName,createdAt \
  --jq '.[] | select(.createdAt < (now - 259200 | todate)) | "\(.number) \(.headRefName)"'
```

Each PR printed is merged or split today. Split on the long branch, clean tree, from the root. `<sha>` = the newest commit in `git log --oneline origin/main..HEAD` whose [PR §1](#1-open-and-describe-the-pr) size is ≤400 and that typechecks; try candidates newest first:

```bash
git switch -c dh/feat-route-detail && git push -u origin HEAD   # carry-over keeps everything
git switch dh/feat-route-finding
git switch --detach <sha> && (cd test && npm run typecheck); ok=$?; git switch -
[ $ok -eq 0 ] && git reset --hard <sha> && git push --force-with-lease
```

The carry-over gets its own issue; rebase it after the front merges. No green commit: hide the feature's entry tab or button, merge, file an unhide issue.

### Create, sync, delete

```bash
git switch main && git pull --ff-only
git switch -c dh/feat-route-finding
git commit --allow-empty -m "chore(route): 초안 PR 열기"
git push -u origin HEAD
gh pr create --draft --base main --title "feat(route): 경로 탐색" --body-file .github/pull_request_template.md
```

Then fill the template body, including `Closes #12`, with `gh pr edit --body`.

- `--ff-only` fails (local commits on `main`): `git switch -c <initials>/chore-<scope> && git switch main && git reset --hard origin/main`.
- Sync while Draft: `git fetch && git rebase origin/main && git push --force-with-lease`. Never `--force`. In review (after `gh pr ready`), never rebase: run `gh pr update-branch <n>` (a merge, hidden by the squash); conflicts: [Resolving conflicts](#resolving-conflicts).
- Rebase over 3 conflicting files or 10 min: `git rebase --abort && git merge origin/main && git push`; note it in the PR body, tell the other developer today.
- After merge: [Merging](#6-merging). Remote branches auto-delete: [Repository settings](#repository-settings).

### Tags and phases

A tag is cut on its milestone due date. Unmerged branches move to the next milestone. If a [release gate](#release-tags) fails, revert the offending PRs that day until the gates pass, then tag; the tag slips by at most 1 day. List unmerged branches first: `git fetch --prune && git branch -r --no-merged origin/main`; if the app cannot run without one, merge it or revert its dependents that day.

Initials name the owner in [역할분담.md](역할분담.md), e.g. `yj/feat-photo-marker`.

- Phases 5, 7: `fix-<scope>`, `fix-perf-<scope>`; the finder files a bug issue; who fixes: see [Ownership map](#ownership-map).
- Phase 6: one screen = one issue = one branch, each assigned in the milestone first; `yj/feat-ui-tokens` merges before any screen branch.
- Phase 4: leads (AI API yj, DB dh) first merge a wiring-only branch (≤ 200 lines, within 24 h) for `src/types.ts`, `src/core/ports.ts`, `src/services/registry.ts`, `.env.example` in `test/`; the other developer then branches. Can't wait: branch from `main`, edit none of those four files, and build on the mock providers; after the wiring PR merges, `git fetch && git rebase origin/main && git push --force-with-lease`. Every PR's base is `main`; never `--base <other-branch>`.

---

## Commit conventions

Conventional Commits. `main` gets one squash commit per PR, titled by the PR title. See [Branching model](#branching-model), [Pull requests](#pull-requests-and-review).

### Format

```
<type>(<scope>): <Korean description>

<body: why>

Refs #<issue>
```

- Types (only 7): `feat` new behavior, `fix` broken behavior, `refactor` same behavior, `chore` config/scripts, `docs`, `test`, `style`. Speed: `fix` if it closes a `type:fix` issue, else `refactor`.
- Scope required, chosen by the file's package in `test/tests/setup/ownership.json`:

| Package | Scopes |
| --- | --- |
| FOUNDATION and files outside `ownership.json` | `ui` (`src/ui/`); `ai` (`src/services/aiProxy.ts`); `deps` (`package.json`, `package-lock.json`); `ci` (`.github/`, `.githooks/`, `.claude/`); `docs` (`*.md`, `docs/`); `app` (every other file) |
| WP1 | `account` |
| WP2 | `trip`; `db` (sync, `server/`) |
| WP3 | `chat`; `suggest` (recommendation) |
| WP4 | `route` |
| WP5 | `map`; `gps` (location, live, sim) |
| WP6 | `photo`; `diary`; `gps` (path tracking) |
| not built | `fx` (exchange rate) |

- Several packages: the scope of the package with the most changed lines in the commit (`git diff --cached --numstat`).
- No scope fits: before the feature commit, open `<initials>/docs-commit-scope`; it adds the scope to this table and to `scopes=` in `.githooks/commit-msg` (`docs(docs): 커밋 범위에 <name> 추가`) and merges first. Agents stop and ask.

### Subject line

- Whole line ≤50 characters; if longer, split the commit first.
- Korean description, identifiers as written. No trailing period, space or emoji.
- End with a noun (`추가`, `수정`, `제거`, `되돌림`), never `~함`, `~했다`, `~한다`, `~하기`, `~니다`: `feat(route): 도보 구간 이동 시간 계산 추가`

### Body

| Case | Required lines |
| --- | --- |
| `fix`, cause not in subject | `증상:` / `원인:` / `수정:` |
| FOUNDATION file changed | `상대 브랜치 영향: <change or 없음>` |
| `chore(deps)` | See [Shared files](#shared-files) |
| Workaround | `임시: <removal condition>` + `// TODO(#<issue>): <same>` at the workaround (file the issue first) |
| Speed change | Measured `before → after` |

Copy these into the PR's `## 무엇을 했나`. `Closes #N` goes in the PR body only.

### Rules

- One change per commit. Stage by path or `git add -p`, never `git add .`/`-A`.
- Dependencies: [Shared files](#shared-files); commit both package files together.
- Squash message setting: see [Repository settings](#repository-settings). The required body lines above live in the PR description, not in the squash commit.
- Pushed a wrong message: fix the PR title (`gh pr edit --title`); never rewrite `main`.

### Enforcement

Commit as `.githooks/commit-msg` (`chmod +x`). Every clone: `git config core.hooksPath .githooks`.

```bash
#!/usr/bin/env bash
export LC_ALL=en_US.UTF-8  # Korean = 1 char
s=$(head -n 1 "$1")
case "$s" in "Merge "*) exit 0 ;; esac  # git merge origin/main, gh pr update-branch
types='feat|fix|refactor|chore|docs|test|style'
scopes='app|account|trip|db|chat|suggest|ai|route|map|gps|photo|diary|fx|ui|deps|ci|docs'
fail() { echo "commit-msg: $1: $s"; exit 1; }
echo "$s" | grep -qE "^($types)\(($scopes)\): .*[^.[:space:]]$" || fail "bad format"
echo "${s#*: }" | grep -q '[가-힣]' || fail "description must be Korean"
echo "$s" | grep -qE '(했음|했다|니다|한다|하기|[가-힣]{2}함)$' && fail "use a noun ending"
[ ${#s} -le 50 ] || fail "over 50 chars"
exit 0
```

Check commit subjects and PR title (silent = pass):

```bash
f=$(mktemp); git fetch -q origin
git log --no-merges --format=%s origin/main..HEAD | while IFS= read -r s; do echo "$s" >"$f"; "$(git rev-parse --show-toplevel)/.githooks/commit-msg" "$f"; done
gh pr view --json title -q .title >"$f" && "$(git rev-parse --show-toplevel)/.githooks/commit-msg" "$f"
```

- Hook wrong: fix it in the same PR. Only a human may use `--no-verify`, stating why in the PR.
- AI agents: if `git config core.hooksPath` is not `.githooks`, stop and tell the human. Never `--no-verify` or `git add .`/`-A`; pushing and PRs are human-only ([Working with AI coding agents](#working-with-ai-coding-agents)). After committing, show the check's output.

---

## Pull requests and review

Git mechanics: [Branching model](#branching-model).

### Repository settings

- **Settings → General → Pull Requests**: merge commits **off**, rebase merging **off**, squash **on** (default message **Pull request title**), auto-delete head branches **on**.
- **Settings → Rules → Rulesets**, default branch, **Active**: restrict deletions; block force pushes; require PR (approvals **1**, dismiss stale approvals **off**, conversation resolution **on**); require status check `check`, up to date **on**. Bypass: **Repository admin**, **For pull requests only**.

Private repository on GitHub Free: rulesets are unavailable and Draft PRs may be refused. The repository owner either claims GitHub Pro through the GitHub Student Developer Pack or makes the repository public (nothing secret is committed), then applies the ruleset. Until then, open normal PRs titled `WIP …` instead of Drafts, and after every merge run `git log origin/main --format=%s | grep -vE '\(#[0-9]+\)$|^Initial commit$'`; any output is a direct push: post it in team chat and revert it through a PR.

### 1. Open and describe the PR

- Create the branch and Draft PR: [Create, sync, delete](#create-sync-delete).
- **Title** = squash commit subject ([Commit conventions](#commit-conventions)), max 50 characters, type equals the branch type.
- **Body**: fill every template part. `무엇을 했나`: 1–2 lines with why, written by the human author. **Closes #**: required, except revert PRs and the exemptions in [Issue first](#issue-first). `어떻게 확인했나`: screen, taps, platform; "잘 됨" counts as empty. `화면`: screenshots or delete.
- **Size**: insertions + deletions ≤ 400 in `git diff --shortstat origin/main...HEAD -- ':(top)' ':(top,exclude)test/package-lock.json' ':(top,exclude)test/assets'` (same result from the root or `test/`). Over: split mechanical changes into an earlier PR. Unsplittable: first body line `크기 사유: …`, no FOUNDATION files, at most 1 per milestone; tell the other developer.

`.github/pull_request_template.md` holds exactly this ([setup checklist](#one-time-setup-checklist) row 7):

```markdown
<!-- 크기 사유: (400줄 초과일 때만, 첫 줄) -->
<!-- 공유 파일: (FOUNDATION 경로가 있으면 전부) -->

## 무엇을 했나

<!-- 한두 줄. 왜 필요했는지까지. fix면 증상/원인/수정 -->

Closes #

## 어떻게 확인했나

<!-- 수동 체크리스트 해당 행: - [x] <key>: <본 것> — <기기, OS> -->

- [ ] `npm run gate:wp -- WP<n>` 통과 (바꾼 WP마다. FOUNDATION만 바꿨으면 `해당 없음`)
- [ ] `npm run typecheck && npm test && npm run export:web` 통과, ttf 4개
- [ ] 상대 영역 화면 하나 열어 봄

## 함께 고친 것

<!-- 20줄 미만 곁가지 수정만. 없으면 지움 -->

## 리뷰할 때 봐줬으면 하는 곳

## 화면

<!-- UI를 바꿨으면 스크린샷. 아니면 지움 -->
```

### 2. Before marking ready (author)

1. Read the whole diff in **Files changed**: no debug `console.log`, commented-out code, stray files.
2. Run `npm start` in `test/`; open one screen from the other developer's area. Phone and native checks: [Manual checklist](#manual-checklist).
3. Run the [pre-PR checks](#when-a-check-is-red).
4. Secrets (a real value: [When a key leaks](#when-a-key-leaks)):
   ```bash
   git fetch origin
   git diff origin/main...HEAD --name-only | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$'   # must print nothing
   git diff origin/main...HEAD -U0 | grep -Ei "^\+.*(key|secret|token|password|bearer)[a-z_]*[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"']{16,}[\"']"   # must print nothing
   ```

Tick template checkboxes only after steps 2–3. Red CI: do not mark ready.

### 3. Review request and deadlines

Run `gh pr ready && gh pr edit --add-reviewer <other-github-id>` (IDs: [Team](#team)), then post the link and deadline in team chat (`#12 리뷰 부탁. 내일 21시까지`); the clock starts there. Deadlines: first review 24 h (phases 7–8: 6 h), re-review 4 h (2 h), revert 30 min. Cannot make it: say so in chat with a time. Deadline passed, no response:

- `chore`, `docs`: 24 h after the chat post in every phase (the phase 7–8 6 h deadline does not shorten this), if `check` is green and no `[필수]` is open, comment `SLA 경과 리뷰 없음, self-merge`, then `gh pr merge --squash --delete-branch --admin`. Refused: wait. Never for a PR that edits the other developer's area ([Editing outside your area](#editing-outside-your-area)).
- `feat`, `fix`, `refactor`: never self-merge. At 48 h, agree a time directly; no agreement: `gh pr ready --undo`.

### 4. Review comments

- `[필수]`: fix before merge; states what, why, how. No approval while one is open.
- `[제안]`: optional; if only these, approve now.
- `[질문]`: ends when answered.

The author resolves threads; the reviewer clicks **Unresolve** if a `[필수]` is not fixed. Round 2: reply `수정 완료`, then `gh pr edit --add-reviewer <other-github-id>`; a push alone notifies nobody. After approval, push only requested changes, or re-request. `[필수]` disputes: 한동관 (dh) decides.

### 5. What the reviewer checks

No style comments, not even `[제안]`.

1. Failure paths: API 404, network drop, empty array, denied location permission, no keys (mock providers).
2. `feat`, in `test/`: `gh pr checkout 12 && npm ci && npm start`.
3. FOUNDATION files first; unexplained changes to your area get a `[필수]`.
4. Section 2 secret checks.
5. `test/package.json` changed: [Shared files](#shared-files) dependencies row.

### 6. Merging

The author merges after approval, `check` green, threads resolved, branch up to date.

```bash
gh pr merge --squash --delete-branch
git switch main && git pull --prune
(cd test && npm start)    # from the root; fails: see section 7
```

Add 1–3 lines of *why* to the squash message only if useful later.

### 7. When main breaks

Never push to `main` or disable a ruleset. Timeline and actions: [When main goes red](#when-main-goes-red).

Revert = a `<initials>/fix-revert-<scope>` branch from `main` that reverts the squash commit, PR titled `fix(<scope>): #<PR> 되돌림`; commands: [Rolling back](#rolling-back). The PR is exempt from the issue and size rules only; branch naming and 1 approval still apply.

Freeze: see [Presentation day](#presentation-day).

### 8. Closing and stale PRs

- Abandon: comment why, `gh pr close 31 --delete-branch`; close the issue if invalid.
- On the weekly review day ([Team](#team)), together: `gh pr list --search "sort:updated-asc"`; close PRs idle 7 days or comment why they stay.
- Agents never push or open PRs: [Working with AI coding agents](#working-with-ai-coding-agents).

---

## Code ownership and conflict prevention

Run commands from `test/`; paths are relative to it.

### Ownership map

`tests/setup/ownership.json` maps every file in `src/`, `tests/`, `server/` to exactly one of `FOUNDATION`, `WP1`–`WP6`; `tests/foundation-ownership.test.ts` fails `npm test` and CI otherwise. A PR that creates a file no existing glob covers (the `ownersOf` command below prints `[]`) adds its path there.

Owners are **proposed — confirm in a docs PR**. [역할분담.md](역할분담.md) wins on conflict.

| Package | Owner |
| --- | --- |
| `FOUNDATION`: config, types, ports, util, navigation, `src/ui/`, registry, `../docs/`, `ci.yml` | dh |
| `WP1`: account, session, home, settings | yj |
| `WP2`: trip room, group, sync, invite | dh; `InviteAcceptScreen.tsx` yj |
| `WP3`: extraction, candidates, recommendation | yj; `RecommendScreen.tsx`, `src/core/recommend.ts`, `src/services/recommend/**` dh |
| `WP4`: schedule, route | dh |
| `WP5`: map, live trip, simulator | dh |
| `WP6`: photos, diary, path records | yj; `src/core/journal/track.ts` dh |

```bash
node --input-type=module -e 'import{ownersOf as o}from"./tests/setup/ownership.mjs";console.log(o(process.argv[1]))' <path>
npm run gate:wp -- WP4   # each WP you changed; must exit 0 before gh pr ready; skip if only FOUNDATION
```

Owners decide structure (signatures, state shape, placement); disagree via a `refactor` issue. Ownership never decides a conflict hunk.

### Shared files

Shared = `FOUNDATION` plus unlisted files (`AGENTS.md`, `CLAUDE.md`, `assets/`). A PR touching one is a Draft from day one ([Create, sync, delete](#create-sync-delete)) and lists the shared paths first in its body under `공유 파일:`.

- **In the feature PR** (≤15 shared lines): a new route and its screen line; a helper or constant appended to `util.ts`/`constants.ts`; your own paths in `ownership.json`.
- **Separate PR, ≤100 lines, merged first:** everything else: renaming/deleting/retyping an export; any edit to `src/types.ts` (frozen contract; dh authors or approves); any edit to `package.json`, `package-lock.json`, `app.config.js`, `app.json`, `tsconfig.json`, `.env.example`, `ci.yml`; a `STORAGE_VERSION` bump; moving a path between packages. Exception: a Phase 4 wiring-only PR ([Tags and phases](#tags-and-phases)) may reach 200 lines.

| File | Rule |
| --- | --- |
| `src/core/util.ts` | Append only; never change a signature. |
| `src/store/trips.ts` | Add actions after the last one. If your change would make `wc -l src/store/trips.ts` print ≥600, stop and tell dh; dh splits it in a `refactor` PR that merges before yours. |
| `STORAGE_VERSION` (`src/core/constants.ts`, `2`) | Bump when renaming, removing or retyping a saved field; with no `migrate`, a bump wipes saved state (reset: 더보기 → 시연 리셋). |
| `.env.example` | Body starts `NEW ENV KEY: EXPO_PUBLIC_<NAME>`; merge after the other comments `env updated`. |
| dependencies, `app.config.js`, `app.json` | Separate PR. `npx expo install <pkg>` in `test/`. Body lines `expo install --check: OK` and either `Verified: Expo Go` or `Verified: native build` (ran `npx expo run:android` or `run:ios`). Not runnable in Expo Go needs agreement first. |
| DB (phase 4) | dh lands the connection first; then the schema only grows. |

### Editing outside your area

Separate PR; body names the file and why in one sentence. Phases 1–4: ≤20 changed lines only; else open an issue for the owner, mark your workaround `// TODO(#<n>)`, and close it only when `grep -rn 'TODO(#<n>)' src` prints nothing. Phases 5–7: over 200 lines is a `refactor` PR. Never self-merge.

### Limits

Update when `git rev-list --count HEAD..origin/main` reaches 5: before `gh pr ready`, rebase; in review, run `gh pr update-branch <n>` (merge, hidden by the squash). Line caps use the [PR §1](#1-open-and-describe-the-pr) size command (shared-file PR: 100; Phase 4 wiring PR: 200). Age and size: [Lifetime](#lifetime-72-hours), [PR §1](#1-open-and-describe-the-pr).

### Resolving conflicts

Draft PR: rebase as below. In review, if `gh pr update-branch` reports a conflict: `git fetch origin && git merge origin/main`, resolve each file by the rules below, then `git commit --no-edit && git push`.

```bash
git branch -f "backup/$(git branch --show-current)"  # undo: git reset --hard backup/<branch>
git fetch origin && git rebase origin/main
git diff --name-only --diff-filter=U
```

- **`.ts`/`.tsx`:** keep both behaviors, pass `npm run typecheck && npm test`, try both features in the app. Cannot keep both: `git rebase --abort`, ask in the PR.
- **`package-lock.json`:** never hand-edit. Keep both sides in `package.json`, then per replayed commit: `git checkout origin/main -- package-lock.json && npm install`, `git add package*.json && git rebase --continue`. Never `git rebase --skip`.
- **Ignored path** (`node_modules/`, `.expo/`, `dist/`, `.env`): tracked by mistake; `git rm -r --cached <path>`.
- **`app.config.js`, `app.json`, `tsconfig.json`, `ci.yml`:** one person writes the merged file; `npx expo config --type public` must succeed.

### Duplicate work

Winner: on `main`, else runs end to end, else the owner's. Close the other PR with `Superseded by #<n>`. Two open PRs on one file: the earlier-opened merges first; the other updates after. Before coding, check `gh pr list --state open`; `grep -n '^export' src/core/util.ts src/core/spotUtil.ts`.

---

## Development environment, configuration, and secrets

Run every command from `test/` unless its block starts with `cd` or its section says "from the root". macOS or Linux only; `npm start` fails in Windows `cmd.exe`.

### One-time setup: root repository

Only `test/.git` exists; root files are untracked and CI never runs. 한동관 (dh) merges `dh/chore-repo-root` before any other PR (exempt from the size limit):

1. Create the GitHub repository with **Add a README file** checked, so `main` exists. Do not protect `main` yet; that is checklist row 2, done right after this PR merges.
2. From the project root:

```bash
mv test/.git ../young-trip-test-git.bak  # avoids an empty gitlink
git init && git remote add origin <repository URL> && git fetch origin
git switch -c dh/chore-repo-root origin/main
printf '.DS_Store\n.env\n.env*.local\n' > .gitignore
git add -A && git status --short  # no .env, node_modules/, .expo/
git commit -m 'chore(ci): 저장소 루트 생성과 test/ 추적 시작'
git push -u origin dh/chore-repo-root
```

This one commit is the only allowed `git add -A`.

### One-time setup checklist

Do in order; each is one PR unless noted. Tick in issue `#1`.

| # | Who | Task | Where defined |
| --- | --- | --- | --- |
| 1 | dh | Root repository, `dh/chore-repo-root` | above |
| 2 | dh | Repository settings and `main` ruleset (no PR) | [Repository settings](#repository-settings) |
| 3 | dh | Tag ruleset `release-tags` (no PR) | [Release tags](#release-tags) |
| 4 | dh | `.githooks/commit-msg`, `dh/chore-commit-hook` | [Enforcement](#enforcement) |
| 5 | both | `git config core.hooksPath .githooks` per clone | [Enforcement](#enforcement) |
| 6 | dh | Labels, `bug.md` label, board, milestones (no PR except `bug.md`) | [Issues](#issues-labels-milestones-and-the-board) |
| 7 | dh | `.github/pull_request_template.md` update | [PR §1](#1-open-and-describe-the-pr) |
| 8 | dh | `test/.claude/settings.json`, `test/AGENTS.md`, `dh/chore-agent-rules` | [Agent configuration](#agent-configuration) |
| 9 | both | `gh auth refresh -s project`; `/permissions` in Claude Code | [Board](#board), [Agent configuration](#agent-configuration) |

No feature PR is marked ready before rows 1–5 are done.

### First run

Needs Node 24 (`node -v` prints `v24.*`; else `nvm install 24`) and Expo Go for SDK 57.

```bash
cd test && npm ci  # never npm install
cp .env.example .env  # empty values are valid
npm start  # port 8090; scan the QR code in Expo Go
```

Done: the phone shows the onboarding screen (`Young Trip 시작하기`). Enter a nickname and tap `게스트로 시작하기`; the tabs 홈 / 후보 / 시간표 / 지도 / 더보기 appear.

| Problem | Fix |
| --- | --- |
| `npm ci`: `not in sync` | Branch `<initials>/chore-lockfile-sync` from `main`, `npm install` once, commit only `test/package-lock.json` as `chore(deps): 잠금 파일 동기화`, separate PR. Agents stop and tell the human. |
| New dependency | [Shared files](#shared-files) |
| Native library or SDK upgrade | `chore` issue first; never in a feature PR |
| Stale app or edited `.env` | `npm start -- --clear`; still stale: `rm -rf node_modules && npm ci` |
| Port 8090 busy | `lsof -i :8090`, or `RN_PORT=8091 npm start` |

- Never run `npx expo start` (port 8081). Pass flags after `--`.
- Sync server, port 8787 (`PORT=` overrides). `node server/sync-server.mjs` exits silently on this project's path (spaces, non-ASCII), so run:
  ```bash
  node --input-type=module -e 'import("./server/sync-server.mjs").then(m=>m.startSyncServer({port:Number(process.env.PORT??8787),host:"0.0.0.0"})).then(s=>console.log(s.url))'
  ```
- Phone verification: [Manual checklist](#manual-checklist).

### Environment variables

`test/.env.example` lists exactly what `src/config.ts` reads, values empty; only `src/config.ts` may use `process` (a foundation test enforces it). Add a variable to both files and this table in one PR.

| Variable | Owner | Status | When empty |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_KAKAO_REST_KEY` | dh | **Demo only**; prototype assumption | Local place dictionary; routes from the scenario table, else straight-line × detour estimates |
| `EXPO_PUBLIC_AI_PROXY_URL` | yj | URL only | Rule-based local fallbacks |
| `EXPO_PUBLIC_SYNC_URL` | dh | `http://<laptop IP>:8787`, not `localhost` | On-device loopback |

`EXPO_PUBLIC_*` values ship in the bundle; anyone can read them.

- AI provider keys and DB credentials live only on a server, never under `test/`. If yj's proxy fails by `v0.2.0`, the URL stays empty and the demo uses fallbacks.
- The exchange-rate PR (yj) adds its row; a key not documented as client-safe goes behind the proxy.
- CI gets no keys. Add no repository secrets.

### Keys

- Never commit `test/.env`. Per clone, from the root: `git check-ignore -q test/.env && echo OK` prints `OK`; `git ls-files test/.env` prints nothing. On failure, keep `.env` empty until `<initials>/chore-gitignore-env` merges.
- Each developer issues their own keys. Never share a key or hand out a build made with one.
- No payment method on accounts whose key goes in `test/.env`. yj's AI account is prepaid, auto-reload off.
- Never paste a key into chat, issues, PRs, commits, screenshots, slides or Claude Code prompts. AI agents never read or edit `test/.env`.

### When a key leaks

AI agents do none of these steps: stop, make no further edits, and tell a human.

1. Not pushed and pasted nowhere: delete the value from the file, then `git reset --soft @{u}` (branch never pushed: `git reset --soft origin/main`), `git add <files>`, `git commit`; `git log -p origin/main..HEAD` must not show the value. Stop.
2. Revoke and reissue it in the provider console.
3. Tell the other developer the same day: variable, where, when. Never the value.
4. Feature branch: delete the value, `git reset --soft $(git merge-base HEAD origin/main) && git commit -m '<PR title>'`, `git push --force-with-lease`; `git log -p origin/main..HEAD` must not show the value. On `main`: never rewrite; open `<initials>/fix-leaked-key`, reviewed first.
5. Check 7 days of provider usage; report unknown use the same day.

### Before you push

Run the [pre-PR checks](#when-a-check-is-red). CI-only failure: check `node -v`, then code that assumes a key.

---

## Issues, labels, milestones, and the board

Copy labels, milestones, `Status` options, headings and markers verbatim.

### Issue first

Order: issue → branch → Draft PR → review → squash merge; PR body `Closes #<n>`. Exempt: `docs`/`chore` PRs ≤5 added lines; `[필수]` fixes. Forgot: create it before `gh pr ready`, or post-merge, then `gh issue close <n> -c "Done in #<pr>"`.

- `작업` (never worked on `main`): ≥2 boxes in `## 끝났다고 볼 조건`; FR and 핑크 캔버스 screen 01–14 in `## 참고`.
- `버그` (worked before): numbered repro steps, device, last good commit. No repro in 3 tries: close.

```bash
# no --template; reuse template headings
gh issue create --title "길찾기: 도보 경로" --label "P1,area:map,type:feat" \
  --milestone "2 주요기능" --project "Young Trip" --body-file issue.md
```

### Labels

Exactly 13; the creator adds one `P*`, one `area:*`, one `type:*`.

| Label | Meaning |
| --- | --- |
| `P1`/`P2` | Demo fails/runs without it; `P2` default in milestones 3, 6 |
| `area:map` | Trip room, schedule, route, map, GPS, suggestion, path recording (dh) |
| `area:chat` | Chat, extraction, AI, candidates, invite, photos, diary, exchange rate (yj) |
| `area:design` | Screens, design tokens (yj) |
| `area:core`/`area:infra` | `FOUNDATION` files under `test/src/` and `test/tests/` (dh) / everything else: CI, `.env.example`, `package.json`, docs, slides |
| `type:feat`/`fix`/`chore`/`docs` | New / broke on `main` / config, deps, refactor, tests / docs only |
| `status:blocked`/`status:needs-decision` | Outside wait / body lists 2–3 options with costs |

`status:*` needs `기한: YYYY-MM-DD` (≤3 days `P1`, ≤7 `P2`) and `푸는 사람: dh` or `yj`. Past 기한: dh decides (`결정`); blocked → mock it, file a follow-up, drop the label.

Setup (dh, once): set `labels: "type:fix"` in `.github/ISSUE_TEMPLATE/bug.md`, delete other labels, run:

```bash
for l in P1 P2 area:{map,chat,design,core,infra} type:{feat,fix,chore,docs} status:{blocked,needs-decision}; do gh label create "$l" --force; done
gh issue list -L 200 --json number,labels -q '.[]|select([.labels[].name|select(test("^(P[12]$|area:|type:)"))]|length!=3)|.number'  # empty
```

### Milestones

`1 기본설계·환경구축` (dh), `2 주요기능`, `3 부가기능`, `4 API·DB연동`, `5 검증·오류수정`, `6 최종디자인`, `7 성능·최종테스트`, `8 발표자료` (yj). Close at 0 open issues plus: 1 = both run `cd test && npm ci && npm start` on fresh `main`; 2/4/5/7 = tag `v0.1.0`/`v0.2.0`/`v0.9.0`/`v1.0.0` ([gates](#release-tags)); 8 = the day before presenting. Leftovers: move or close with a reason.

No milestone = backlog: `P2`, no `Status`. Due date: when a milestone's first issue moves to `진행 중`, dh sets it to that day + 14 days (`gh api -X PATCH 'repos/{owner}/{repo}/milestones/<number>' -f due_on=YYYY-MM-DDT23:59:59Z`); missed: move open `P2` issues to backlog that day.

### Board

Setup (dh, once): Projects board `Young Trip`; `Status` exactly `할 일`, `진행 중`, `리뷰`, `완료`; only workflow `Item closed` → `완료`. Everyone: `gh auth refresh -s project`.

`할 일`: 3 labels + milestone → `진행 중`: branch exists, `gh issue edit <n> --add-assignee @me`; Drafts stay → `리뷰`: `gh pr ready` → `완료`: merge closes it. Authors move own cards. Max 2 open feature PRs each, Drafts included (`gh pr list -A @me | wc -l`); revert PRs, split carry-overs and a feature's separate shared-file PR do not count. At 2, do not cut a new feature branch.

### Split, decide, scope

- Split at the [size](#1-open-and-describe-the-pr) or [72-hour](#lifetime-72-hours) limit, >5 boxes, or two tasks: `gh issue create --parent <n>`, same labels and milestone; parent gets no branch, closes at N/N.
- Record decisions same day: issue comment `결정 YYYY-MM-DD (dh, yj): …` + `이유:` + `영향:`; meetings → `docs/meetings/`. `여행계획-앱-기능명세서-v0.2.md` beats issues. Unwritten = undecided; deadlock: dh ([역할분담.md](역할분담.md)).
- Out-of-scope work: own issue. Write `// TODO(#57)`, never bare `TODO`.
- `docs/FR-추적표.md`: feature PRs never edit it. At the weekly PR review, both update the status column in one `docs` PR (`<initials>/docs-fr-status`) from PRs merged that week.
- `HANDOFF.md`: feature PRs never edit it. Notes for the next AI session on a branch go in that PR's body under `## 인계`. 한동관 (dh) updates `HANDOFF.md` in a `docs` PR when a milestone closes.

---

## CI, quality gates, and releases

### What CI runs

`.github/workflows/ci.yml` job `check` (Node 24, in `test/`) runs on every PR into `main` and every push to `main`:

| Step | Red means |
| --- | --- |
| `npm ci` | Lockfile out of sync |
| `npx tsc --noEmit` | Type error |
| `npm test` | A failing test, incl. file ownership |
| `npx expo export --platform web --output-dir /tmp/yt-export` | Web bundle fails |
| ttf count = `4` | Font imported outside `src/ui/fonts.ts` subpaths |

No native build, no app launch: see the [manual checklist](#manual-checklist).

### When a check is red

- Do not merge, even if approved. Read `gh run view <run-id> --log-failed`; fix on the same branch.
- Re-run once (`gh run rerun <run-id> --failed`) only for `ETIMEDOUT`, `ECONNRESET`, `npm error network` or runner shutdown; comment `re-ran: <error line>`. Fails again: stop.
- Never comment out a step, add `continue-on-error`, skip or delete a test, or change the ttf number. A wrong test is fixed in its own PR.
- Never rename job `check` or add a job-level `name:` (step `name:` keys are fine); the `main` ruleset requires the status check `check`.

**Pre-PR checks**, before every `gh pr ready` (while working, `gate:wp` is advisory):

```bash
cd "$(git rev-parse --show-toplevel)/test"
npm run gate:wp -- WP<n>   # each WP you changed; must exit 0; skip if only FOUNDATION or root files
node -v   # v24.x
npm ci && npm run typecheck && npm test
rm -rf /tmp/yt-export && npm run export:web
test "$(find /tmp/yt-export -name '*.ttf' | wc -l | tr -d ' ')" = "4" && echo ttf OK
```

### When main goes red

The merger owns it. Check after merging and before branching: `gh run list --branch main --event push --limit 1`.

| Time red | Action |
| --- | --- |
| 0 | Post `main red: <run URL>` in team chat; nobody branches from `main` |
| ≤30 min | Merger merges a fix or opens a revert PR; the other reviews at once |
| 30 / 60 min | Revert PR open / merged |

Phases 7–8: revert only, never fix forward.

### Manual checklist

For each row whose paths (under `test/`) the PR touches (`gh pr diff <PR> --name-only`), the author adds `- [x] <key>: <what you saw> — <device, OS>` under `## 어떻게 확인했나`. Reviewing: see [What the reviewer checks](#5-what-the-reviewer-checks).

| Key | Paths | Check |
| --- | --- | --- |
| `map` | `src/components/map/`, `src/core/map/`, `MapScreen`, `RecordMapScreen`, `NavigateScreen` | Every spot has a marker; route follows timetable order |
| `keys` | `src/services/{places,routes,sync}/`, `registry.ts`, `kakaoHttp.ts`, `aiProxy.ts`, `src/config.ts`, `.env.example`, `server/` | Real provider answers with key; mocks work with `test/.env` moved aside (`npm start -- --clear`) |
| `gps` | `src/services/location/`, `LiveTripScreen`, `NavigateScreen` | Path updates; denied permission does not crash |
| `photo` | `src/services/photos/`, `src/core/journal/exif.ts`, `PhotosScreen`, `RecordMapScreen` | Geotagged photo gets a marker; no crash without GPS data or permission |
| `share` | `src/services/share.ts` | Share sheet opens on a phone |
| `storage` | `src/store/`, `src/*/kv.ts` | Data survives killing the app |
| `link` | `src/navigation/routes.ts`, `InviteAcceptScreen` | `npm run web`, `localhost:8090/j/<code>` joins |
| `ui` | `src/screens/`, `src/components/`, `src/ui/` | Nothing clipped at 360dp width |

Rows `gps`, `photo`, `share`: phone required; reviewers block web-only.

Before `v0.9.0`: one outdoor walk ≥1 km each for path tracking (dh) and photo markers (yj); log date, km walked, km recorded on the issue. Gap >20% = a `type:fix` issue.

### Release tags

Annotated tags on `main`; no release branches.

| Tag | Gate |
| --- | --- |
| `v0.1.0` | Phase 2: route finding, activity suggestion, chat room |
| `v0.2.0` | Phase 4: AI, place/route, exchange rate, GPS, DB connected |
| `v0.9.0` | Phase 5: cross-verified, both walk logs, demo method chosen |
| `v1.0.0` | Phase 7: presentation build |

Tag with both present, only if (1) CI is green on that commit; (2) the non-builder ran each feature's rows on a real device; (3) a clean clone runs; (4) no open `type:fix` + `P1` issue.

```bash
git switch main && git pull && SHA=$(git rev-parse HEAD)
gh run list --commit "$SHA" --event push --json conclusion -q '.[0].conclusion'  # success
rm -rf /tmp/rel && git clone "$(git remote get-url origin)" /tmp/rel && git -C /tmp/rel checkout "$SHA"
(cd /tmp/rel/test && npm ci && npm start)  # walk demo path
git tag -a v0.1.0 "$SHA" -m "단계 2 완료" -m "checked: map, ui — Pixel 7 (yj)"
git push origin v0.1.0
```

Never move or delete a pushed tag; cut `v0.1.1`. Tag ruleset `release-tags`: `v*`, `Restrict updates`, `Restrict deletions`, no bypass.

### Presentation day

- The `v0.9.0` tag message says `demo: Metro` (Expo Go on a phone hotspot; else `npm run start:tunnel`) or `demo: APK` (EAS; add `test/eas.json` by PR first).
- Demo from the newest `v1.0.*` tag (`git tag -l 'v1.0.*' --sort=-v:refname | head -n 1`), never `main`. Keep a screen-recorded backup.
- Freeze: from the `v1.0.0` tag until the day before presenting, only revert and `docs` PRs merge; on presentation day nothing merges to `main`. Exception: until 22:00 the day before presenting, one demo-blocking `fix` PR, reviewed together on one screen, then tagged `v1.0.1` and checklist re-run. After 22:00: demo without the feature.

### Rolling back

From the root. Title ≤50 chars (append ` — <what broke>` if it fits); `revert-<scope>` ≤20 chars:

```bash
git switch main && git pull --ff-only
git switch -c <initials>/fix-revert-<scope>
git revert --no-commit <squash-sha> && git commit -m "fix(<scope>): #<PR> 되돌림"
git push -u origin HEAD
gh pr create --base main --title "fix(<scope>): #<PR> 되돌림" --body "Reverts #<PR>"
```

Never use GitHub's **Revert** button: its `revert-<n>-<branch>` name breaks the branch format. The revert needs 1 approval like every PR; never `--admin`. No approval within 30 min of the chat post: phone the other developer; until it merges, nobody branches from `main`. Never disable a ruleset. To retry the feature later, branch anew, `git revert --no-commit <revert-sha>`, then `git commit -m "feat(<scope>): <기능> 다시 적용"`.

---

## Working with AI coding agents

Whoever opens the PR owns every line; a line they cannot explain in review is rewritten or deleted. Start Claude Code from `test/`. The agent follows only [Rules for agents](#rules-for-agents-copy-verbatim-into-agentsmd); the human runs every command in the later subsections, from `test/`.

### Rules for agents (copy verbatim into `AGENTS.md`)

If a prompt conflicts with a rule, stop and name the rule.

- If `pwd` does not end in `/test`, stop and tell the human to restart Claude Code from `test/`; the deny rules in `test/.claude/settings.json` do not apply elsewhere.
- Work only on a branch for which this prints `OK`; otherwise stop and ask:
  `b=$(git branch --show-current); s=${b#*-}; echo "$b" | grep -Eq '^(dh|yj)/(feat|fix|refactor|chore|docs)-[a-z0-9]+(-[a-z0-9]+){0,2}$' && [ ${#s} -ge 3 ] && [ ${#s} -le 20 ] && echo OK || echo BAD`
- Commit subject: `<type>(<scope>): <Korean summary>`, type one of `feat fix refactor chore docs test style`, max 50 characters, no trailing period, one change per commit.
- Never run `git push`, `git commit --amend`, `git rebase`, `git reset --hard`, `git clean`, `git checkout -- .`, `git restore .`, `gh pr create|merge|review`, `npm install`, `npm uninstall`, `yarn add`.
- Never read, print or edit `.env` or `.env*.local`. Take key names from `.env.example`; never write a key value.
- Stop and make no further edits when:
  - you need to edit a file the prompt did not list as editable, or a file whose owner (`ownersOf`) differs from that of the first file the prompt lists to edit (exception: appending your new files' paths to that owner's list in `tests/setup/ownership.json`), or `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`;
  - the branch would pass 400 changed lines;
  - one check fails with the same error after 2 fix attempts;
  - the task decides what `../여행계획-앱-기능명세서-v0.2.md` decides: map SDK, candidate selection, stay-time defaults, exclusion reasons.
- Never silence a type error with an `as <Type>` cast, `any`, `// @ts-ignore`, `// @ts-expect-error` or a copied type; `as const` and `import { a as b }` are allowed.
- Never invent coordinates, addresses, hours, fees, endpoints, parameters, SDK method names or measurements. Write `TODO(verify)` and list each at the end.
- Read https://docs.expo.dev/versions/v57.0.0/ before using an Expo API. Cite an HTTP API's doc URL and check date in the file header, like `src/services/routes/kakao.ts`.
- Use the terms in the `src/types.ts` header; never add a second name for a concept (`Itinerary` beside `Plan`).
- Finish: run `npm run gate:wp -- WP<n>` for each work package whose files you changed (skip if only FOUNDATION), `npm run typecheck`, `npm test`; paste the last 10 lines of each; list every file changed or created.

### Agent configuration

Create `test/.claude/settings.json`; confirm with `/permissions` once per machine.

```json
{
  "enabledPlugins": { "expo@claude-plugins-official": true },
  "permissions": { "deny": [
    "Bash(git push:*)", "Bash(git commit --amend:*)", "Bash(git rebase:*)",
    "Bash(git reset --hard:*)", "Bash(git clean:*)", "Bash(gh pr create:*)",
    "Bash(gh pr merge:*)", "Bash(gh pr review:*)", "Bash(npm install:*)",
    "Bash(npm uninstall:*)", "Bash(yarn add:*)", "Read(./.env)", "Edit(./.env)"
  ] }
}
```

`AGENTS.md` = its Expo SDK 57 line + the subsection above; `CLAUDE.md` = `@AGENTS.md`. A PR changing versions, folders, terms or forbidden commands updates `AGENTS.md`.

### Prompts

Name the FR, files to read, and the only files to edit:

```text
Read src/core/ports.ts (RouteProvider), src/services/registry.ts, FR-504.
In src/screens/LegTransportScreen.tsx show walk vs car for one leg.
Edit only that file; if you need another, stop and say why.
```

Discard output if the transcript does not show each named file being read. A FOUNDATION change merges in its own PR first.

### Before opening a PR

Run the [pre-PR checks](#when-a-check-is-red), then:

```bash
git fetch origin && git status --porcelain  # must print nothing
git diff -U0 origin/main...HEAD | grep -cE "^\+.*(TODO\(verify\)|[\"'][0-9a-fA-F]{32}[\"'])"  # must print 0
npm start  # use every screen you changed
```

- Size: [Pull requests §1](#1-open-and-describe-the-pr).
- Grep hits: resolve each `TODO(verify)`; rename a hex literal that is not a key; a real key: [When a key leaks](#when-a-key-leaks).
- Read the whole diff; delete added files you did not ask for (`git diff --name-status origin/main...HEAD`).
- Phone checks: [Manual checklist](#manual-checklist). Native packages, `app.config.js`, `app.json`: [Shared files](#shared-files).

### Undo broken output

After 2 failed agent fixes, fix by hand or undo and re-prompt a smaller step.

```bash
git restore --source=HEAD --staged --worktree -- <path>  # uncommitted
git reset --hard <good-sha>  # unreviewed; drops uncommitted work
git revert --no-commit <bad-sha> && git commit -m "fix(<scope>): <무엇> 되돌림"  # under review: never rewind
git clean -nd  # -fd only if every path is agent output
```

### High-risk review

- Secrets: [Keys](#keys); leak: [When a key leaks](#when-a-key-leaks).
- Packages: [Shared files](#shared-files). Lockfile changed without `package.json`: `git checkout origin/main -- package.json package-lock.json`, then `npm ci`.
- Each new or changed `placeId`, address or opening hour cites a Kakao/Naver Map link or API response in the PR body; otherwise `[필수]`.
- Overlapping branches: [Duplicate work](#duplicate-work). After a conflict, `/clear` the agent session.

### Not delegated to agents

Locked decisions (GitHub Flow with no `develop`/`release/*`/`hotfix/*`, `<initials>/<type>-<scope>` branch names, one branch per feature, squash merge only, PR-only `main` with 1 approval, release tags, Conventional Commits with Korean descriptions, `.env` never committed, CI `check`) and the 400-line PR limit; this document (`docs` PR, 한동관 (dh) breaks ties); spec product rules; phase 8 slide numbers, each measured in phase 7 and recorded in an issue.
