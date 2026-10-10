import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { currentScope, read, ROOT } from './setup/scan';
import { at, flowList, keys, readCi, stepValues, tmpTree } from './setup/workflow';

/**
 * CI와 브랜치 규칙(GitFlow). 잡 이름은 main·develop 규칙의 필수 검사라 바뀌면 머지가 막힌다. CI에는 키를 넣지 않는다.
 * CONTRIBUTING.md에 적힌 PR 템플릿·커밋 범위·브랜치 이름 정규식·검사 명령도 실제 파일과 맞는지 본다.
 * 잡 db는 tests/foundation-ci-db.test.ts가 본다(db 잡 PR에 같이 넣는다. CONTRIBUTING One-time setup checklist).
 * YT_SCOPE=WPn이면 건너뛴다(루트 문서·CI는 FOUNDATION 몫이라 WP 게이트를 막지 않는다).
 */

const scope = currentScope();
const skip = scope !== undefined && scope !== 'FOUNDATION' ? `YT_SCOPE=${scope}: 루트 문서·CI는 FOUNDATION 몫` : false;

const CONTRIBUTING = skip ? '' : read('../CONTRIBUTING.md');
const { doc, jobs } = skip ? { doc: [], jobs: [] } : readCi();

test('CI는 GitFlow 브랜치 push와 main·develop PR에서 돈다', { skip }, () => {
  assert.deepEqual(flowList(at(doc, 'on', 'push', 'branches').value), [
    'main',
    'develop',
    'feature/**',
    'release/**',
    'hotfix/**',
  ]);
  assert.deepEqual(flowList(at(doc, 'on', 'pull_request', 'branches').value), ['main', 'develop']);
  assert.equal(at(doc, 'permissions', 'contents').value, 'read');
});

test('같은 이벤트·같은 ref의 지나간 실행은 끊고, main·develop push만 커밋마다 그룹이 따로다', { skip }, () => {
  // GitHub은 그룹마다 대기 1개만 두고 기다리던 실행을 새 실행으로 바꾼다. 머지마다 결과가 남아야 하는 main·develop push만 sha를 붙인다
  assert.equal(at(doc, 'concurrency', 'cancel-in-progress').value, 'true');
  const group = at(doc, 'concurrency', 'group').value;
  assert.ok(group.startsWith('ci-${{ github.event_name }}-${{ github.ref }}${{ '), group);
  assert.ok(
    group.includes(
      "(github.ref == 'refs/heads/main' || github.ref == 'refs/heads/develop') && format('-{0}', github.sha) || ''",
    ),
    group,
  );
});

test('잡 check가 있고 잡 단위 name:이 없다(필수 검사 이름)', { skip }, () => {
  assert.ok(keys(jobs).includes('check'), keys(jobs).join());
  for (const job of keys(jobs)) {
    assert.equal(keys(at(jobs, job).body).includes('name'), false, `${job}에 name:`);
    assert.equal(at(jobs, job, 'defaults', 'run', 'working-directory').value, 'test');
  }
});

test('잡 check는 Node 24에서 지금 단계를 그대로 돈다', { skip }, () => {
  const steps = at(jobs, 'check', 'steps').body;
  assert.deepEqual(stepValues(steps, 'uses'), ['actions/checkout@v4', 'actions/setup-node@v4']);
  assert.deepEqual(stepValues(steps, 'node-version'), ['24']);
  assert.deepEqual(stepValues(steps, 'run'), [
    'npm ci',
    'npx tsc --noEmit',
    'npm test',
    'npx expo export --platform web --output-dir /tmp/yt-export',
    `test "$(find /tmp/yt-export -name '*.ttf' | wc -l | tr -d ' ')" = "4"`,
  ]);
});

test('워크플로는 저장소 secret과 앱 키를 쓰지 않는다', { skip }, () => {
  const files = readdirSync(path.join(ROOT, '..', '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.includes('ci.yml'));
  for (const f of files) {
    const src = read(`../.github/workflows/${f}`);
    assert.doesNotMatch(src, /\$\{\{\s*secrets\./, f);
    assert.doesNotMatch(src, /EXPO_PUBLIC_|KAKAO|GOOGLE_MAPS|API_KEY/, f);
  }
});

test('PR 템플릿은 CONTRIBUTING.md에 적힌 그대로다', { skip }, () => {
  const m = /holds exactly this[^\n]*\n\n```markdown\n([\s\S]*?)\n```/.exec(CONTRIBUTING);
  assert.ok(m, 'CONTRIBUTING.md에 템플릿 블록이 있다');
  assert.equal(read('../.github/pull_request_template.md').trimEnd(), m[1].trimEnd());
  assert.match(m[1], /feature\/\* → develop/);
});

test('커밋 범위: 훅의 scopes와 범위 표가 같고 서버 DB(db)가 있다', { skip }, () => {
  const hook = /^scopes='([a-z|]+)'$/m.exec(CONTRIBUTING);
  assert.ok(hook, 'commit-msg 훅의 scopes=');
  const fromHook = hook[1].split('|').sort();

  const table = /\| Package \| Scopes \|\n\| --- \| --- \|\n((?:\|.*\|\n)+)/.exec(CONTRIBUTING);
  assert.ok(table, '범위 표');
  const fromTable = new Set<string>();
  for (const row of table[1].trimEnd().split('\n')) {
    for (const t of (row.split('|')[2] ?? '').matchAll(/`([a-z]+)`/g)) fromTable.add(t[1]);
  }
  assert.deepEqual([...fromTable].sort(), fromHook);
  assert.match(table[1], /\| WP2 \| `trip`; `db` \(sync, `server\/`\) \|/);
});

test('브랜치 이름 검사 정규식은 GitFlow 이름만 받는다(에이전트는 feature만)', { skip }, () => {
  const pattern = (title: string) => {
    const start = CONTRIBUTING.indexOf(`\n### ${title}\n`);
    assert.ok(start >= 0, title);
    const end = CONTRIBUTING.indexOf('\n### ', start + 1);
    const m = /grep -Eq '([^']+)'/.exec(CONTRIBUTING.slice(start, end < 0 ? undefined : end));
    assert.ok(m, `${title}의 grep -Eq`);
    return new RegExp(m[1]);
  };

  const human = pattern('Names');
  for (const ok of ['feature/dh/feat-route-finding', 'feature/yj/fix-chat-order', 'release/v0.2.0', 'hotfix/v1.0.1']) {
    assert.ok(human.test(ok), ok);
  }
  for (const bad of ['dh/feat-route-finding', 'main', 'develop', 'feature/route', 'release/0.2.0', 'feature/kim/feat-x1']) {
    assert.equal(human.test(bad), false, bad);
  }

  const agent = pattern('Rules for agents (copy verbatim into `AGENTS.md`)');
  assert.ok(agent.test('feature/dh/feat-route-finding'));
  assert.equal(agent.test('release/v0.2.0'), false);
  assert.equal(agent.test('dh/feat-route-finding'), false);
});

test('커밋 제목 검사는 squash 제목 끝의 (#n)을 떼고 훅에 넘긴다(release 브랜치가 나열하는 develop 커밋이 50자를 넘지 않게)', { skip }, (t) => {
  const line = CONTRIBUTING.split('\n').find((l) => l.startsWith('git log --no-merges --format=%s origin/develop..HEAD | '));
  assert.ok(line, '커밋 제목 검사 줄');
  const hook = '"$(git rev-parse --show-toplevel)/.githooks/commit-msg"';
  assert.ok(line.includes(hook), line);

  // 50자 이하 PR 제목이 squash되면 ' (#12)'가 붙어 50자를 넘는다
  const title = 'feat(route): 도보 구간 이동 시간 계산과 환승 대기 시간 반영 규칙 추가';
  assert.ok(title.length <= 50 && `${title} (#12)`.length > 50);
  const fix = 'fix(route): 릴리스 전 도보 시간 반올림 수정';
  // 훅 대신 받은 제목을 그대로 찍는 대역을 둔다(훅의 글자 수는 en_US.UTF-8 로케일에 기대므로 러너마다 다를 수 있다)
  const dir = tmpTree(t, { 'subjects.txt': `${title} (#12)\n${fix}\n`, 'hook.sh': 'cat "$1"\n' });
  const command = 'f="$PWD/subject.txt"; ' + line.replace(/^git log [^|]+\|/, 'cat subjects.txt |').split(hook).join('bash hook.sh');
  const r = spawnSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trimEnd().split('\n'), [title, fix]);
});
