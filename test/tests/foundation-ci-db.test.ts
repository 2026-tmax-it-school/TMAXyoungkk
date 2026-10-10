import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

import { globToRegExp } from './setup/ownership.mjs';
import { currentScope, listFiles, read, ROOT, stripComments } from './setup/scan';
import { at, keys, readCi, stepValues, tmpTree } from './setup/workflow';

/**
 * CI 잡 db(실 PostgreSQL). 테스트 명령과 두 결과 검사(건너뜀, 실 DB 묶음 통과)는 임시 폴더에서 bash로 직접 돌려 본다.
 * 실 DB 묶음은 이름에 표식(ci.yml에서 읽는다)을 달고, 묶음과 실 DB 주소는 잡이 돌리는 파일(tests/wp2-*.test.ts)에만 둔다(도우미 파일도 밖에 두지 않는다).
 * 묶음 둘 중 하나만 다른 파일로 옮기면 잡 db는 초록이므로, 그 경우는 이 파일이 npm test(잡 check)에서 잡는다.
 * 건너뜀 검사는 지금 tests/wp2-*.test.ts에도 돌린다(연결이 바로 거절되는 실 DB 주소를 넘긴다).
 * ci.yml에 잡 db를 더하는 PR에 같이 넣는다. YT_SCOPE=WPn이면 건너뛴다.
 */

const scope = currentScope();
const skip = scope !== undefined && scope !== 'FOUNDATION' ? `YT_SCOPE=${scope}: 루트 문서·CI는 FOUNDATION 몫` : false;

const SELF = 'tests/foundation-ci-db.test.ts';
const DB_URL_VAR = 'YT_TEST_DATABASE_URL';
const CONTRIBUTING = skip ? '' : read('../CONTRIBUTING.md');
const db = skip ? [] : at(readCi().jobs, 'db').body;

/** 잡 db의 run 단계: 설치, 서버 DB 테스트, 건너뜀 검사, 실 DB 묶음 통과 검사. marker는 실 DB 묶음 이름에 든 표식 */
function dbRuns() {
  const runs = stepValues(at(db, 'steps').body, 'run');
  assert.equal(runs.length, 4, runs.join('\n'));
  const [install, tests, noSkip, ran] = runs;
  const glob = /"([^"]+)"$/.exec(tests)?.[1] ?? '';
  const tap = /--test-reporter=tap --test-reporter-destination=(\S+)/.exec(tests)?.[1] ?? '';
  const marker = /\[\^#\]\*([^[\]^$]+)\[\^#\]\*\$'/.exec(ran)?.[1] ?? '';
  return { install, tests, noSkip, ran, glob, tap, marker };
}

/** 표식이 든 문자열 리터럴 */
const markerLiteral = (marker: string) =>
  new RegExp(`['"\`][^'"\`\\n]*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'"\`\\n]*['"\`]`);

/** 잡이 돌리지 않는 tests/ 파일(도우미 포함) 가운데 실 DB 묶음 표식(문자열)이나 실 DB 주소 변수를 쓰는 파일. 주석은 세지 않는다 */
function outsideJob(files: Record<string, string>, glob: string, marker: string): string[] {
  const inJob = globToRegExp(glob);
  return Object.entries(files)
    .filter(([f, src]) => {
      const code = stripComments(src);
      return !inJob.test(f) && (markerLiteral(marker).test(code) || code.includes(DB_URL_VAR));
    })
    .map(([f]) => f);
}

/** 바깥 테스트 러너가 넘기는 NODE_TEST_CONTEXT가 있으면 자식이 TAP 대신 내부 형식으로 쓴다. 실 DB 주소도 빼고 넘긴다 */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  if (!(DB_URL_VAR in extra)) delete env[DB_URL_VAR];
  return env;
}

/** bash로 명령 한 줄을 돌린다(CI 러너와 같은 셸). 종료 코드와 표준 출력 */
function sh(command: string, cwd: string, env = childEnv()) {
  const r = spawnSync('bash', ['-c', command], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout };
}

test('잡 db는 postgres:17-alpine에 실 DB 주소를 넘겨 서버 테스트를 하나씩 돈다', { skip }, () => {
  const pg = at(db, 'services', 'postgres').body;
  assert.equal(at(pg, 'image').value, 'postgres:17-alpine');
  assert.ok(at(pg, 'ports').body.some((l) => l.text === '- 5432:5432'));
  assert.match(at(pg, 'options').body.map((l) => l.text).join(' '), /--health-cmd "pg_isready /);

  assert.deepEqual(keys(at(db, 'env').body), [DB_URL_VAR]);
  const user = at(pg, 'env', 'POSTGRES_USER').value;
  const pass = at(pg, 'env', 'POSTGRES_PASSWORD').value;
  const name = at(pg, 'env', 'POSTGRES_DB').value;
  assert.equal(at(db, 'env', DB_URL_VAR).value, `postgres://${user}:${pass}@localhost:5432/${name}`);

  assert.deepEqual(stepValues(at(db, 'steps').body, 'uses'), ['actions/checkout@v4', 'actions/setup-node@v4']);
  const { install, tests, noSkip, ran, glob, tap, marker } = dbRuns();
  assert.equal(install, 'npm ci');
  // npm test와 같은 방식(.ts 로더)으로, 같은 DB를 함께 쓰니 파일 하나씩
  const pkg: { scripts: Record<string, string> } = JSON.parse(read('package.json'));
  assert.ok(tests.startsWith(pkg.scripts.test.split(' "')[0]), tests);
  assert.ok(tests.includes('--test-concurrency=1'));
  assert.equal(glob, 'tests/wp2-*.test.ts');
  // 두 검사는 위 실행이 남긴 TAP을 보고, 건너뜀은 실 DB 묶음 표식과 실 DB 주소 변수 이름으로 걸러 낸다(PGlite 전용 건너뜀은 보지 않는다)
  assert.ok(tap.startsWith('/tmp/'), tests);
  assert.ok(noSkip.startsWith(`if ! test -s ${tap} || ! awk '`) && noSkip.includes(`' ${tap}; then `), noSkip);
  assert.ok(ran.includes(` ${tap} || `), ran);
  assert.ok(marker.length > 0, ran);
  assert.ok(noSkip.includes(`"${marker}"`) && noSkip.includes(`"${DB_URL_VAR}"`), noSkip);
  assert.ok(CONTRIBUTING.includes(`keeps \`${marker}\` in its name`), `CONTRIBUTING에 실 DB 묶음 표식 ${marker}`);
});

test('실 DB 묶음과 실 DB 주소는 잡 db가 돌리는 파일에만 있다(일부만 옮겨도 잡 db는 초록이라 여기서 잡는다)', { skip }, () => {
  const { glob, marker } = dbRuns();
  // 도우미 파일까지 본다(도우미가 실 DB 주소를 읽으면 잡 밖 테스트가 표식 없이 실 DB 묶음을 만들 수 있다). 이 파일은 표식과 변수 이름을 검사하려고 적으므로 뺀다
  const all: string[] = listFiles('tests', ['.ts', '.mjs']);
  assert.ok(all.includes(SELF), SELF);
  const files = Object.fromEntries(all.filter((f) => f !== SELF).map((f) => [f, read(f)]));
  assert.deepEqual(outsideJob(files, glob, marker), [], `실 DB 묶음과 ${DB_URL_VAR}는 ${glob}에만 둔다(잡 db는 그 파일만 실 DB로 돈다)`);
  // 잡이 돌리는 파일에는 실 DB 주소를 읽고 이름(describe 또는 name:)에 표식을 단 묶음이 있다(주석·건너뜀 사유는 세지 않는다)
  const inJob = globToRegExp(glob);
  const named = new RegExp(`(?:describe\\(|name:)\\s*${markerLiteral(marker).source}`);
  assert.ok(
    Object.entries(files).some(([f, src]) => {
      const code = stripComments(src);
      return inJob.test(f) && code.includes(`process.env.${DB_URL_VAR}`) && named.test(code);
    }),
    `${glob}에 ${DB_URL_VAR}를 읽고 이름에 '${marker}'를 단 묶음이 없다(db 잡이 실패한다)`,
  );
});

test('db 잡 결과 검사: 실 DB 묶음이 잡이 돌리는 파일에서 SKIP 없이 다 통과해야 초록이다(PGlite 전용 건너뜀은 지나간다)', { skip }, (t) => {
  const { tests, noSkip, ran, glob, tap, marker } = dbRuns();
  const head = "import { before, describe, test } from 'node:test';\n";
  const pass = "test('a', () => {});";
  /** 이름에 표식을 단 실 DB 묶음 둘(저장소, HTTP 서버) */
  const store = (body = pass, opts = '') => `describe('PostgreSQL 저장소(${marker})', {${opts}}, () => { ${body} });\n`;
  const http = `describe('HTTP 서버 + PostgreSQL 저장소(${marker})', () => { ${pass} });\n`;
  // 지금 tests/wp2-db.test.ts처럼 PGlite 묶음 안에서 실제 드라이버 전용 테스트를 건너뛴다. 사유에 표식 글자가 들어 있어도 묶음 밖이다
  const pglite = `${head}describe('PostgreSQL 저장소(PGlite)', () => { ${pass} test('드라이버', { skip: '연결 문자열이 있는 ${marker}에서만 돈다' }, () => {}); });\n`;
  const wp2 = 'tests/wp2-db.test.ts';
  const moved = 'tests/integration-db.test.ts';
  /** [무엇, 파일, 테스트 명령·건너뜀 검사·통과 검사의 종료 코드] */
  const cases: [string, Record<string, string>, number[]][] = [
    ['실 DB 묶음 둘이 다 통과', { [wp2]: pglite + store() + http }, [0, 0, 0]],
    ['실 DB 묶음을 주소가 없어 건너뜀', { [wp2]: pglite + store(pass, "skip: '주소 없음'") + http }, [0, 1, 0]],
    ['실 DB 묶음 안쪽 테스트를 건너뜀', { [wp2]: pglite + store(`describe('안쪽', () => { test('b', { skip: '느림' }, () => {}); }); ${pass}`) }, [0, 1, 0]],
    // 연결에 실패해(before) 묶음이 실패해도 건너뛴 하위 테스트는 'not ok … # SKIP'으로 남는다
    ['연결 실패, 건너뛴 하위 테스트', { [wp2]: pglite + store("before(() => { throw new Error('거절'); }); test('b', { skip: true }, () => {});") }, [1, 1, 1]],
    ['묶음 밖 테스트를 실 DB 주소 때문에 건너뜀', { [wp2]: `${pglite}test('b', { skip: '${DB_URL_VAR}가 없어 건너뜀' }, () => {});\n${store()}` }, [0, 1, 0]],
    ['실 DB에서 실패', { [wp2]: pglite + store("test('a', () => { throw new Error('거절'); });") }, [1, 0, 1]],
    ['잡이 돌릴 파일이 없음(테스트 0개)', {}, [0, 0, 1]],
    // 모두 잡이 돌리지 않는 파일로 옮기고 wp2 파일에는 변수 이름이 주석으로만 남았을 때
    ['실 DB 묶음을 모두 옮김', { [wp2]: `// ${DB_URL_VAR}가 있으면 ${marker}로도 돈다\n${pglite}`, [moved]: head + store() + http }, [0, 0, 1]],
    // 하나만 옮기면 남은 묶음이 통과해 잡 db는 초록이다. 옮긴 파일은 앞 테스트의 정적 검사가 잡 check(npm test)에서 잡는다
    ['실 DB 묶음 하나만 옮김', { [wp2]: pglite + http, [moved]: head + store() }, [0, 0, 0]],
  ];
  for (const [what, files, codes] of cases) {
    const dir = tmpTree(t, { 'tests/setup/resolve-ts.mjs': read('tests/setup/resolve-ts.mjs'), ...files });
    const swap = (command: string) => command.split(tap).join(path.join(dir, 'db.tap'));
    assert.deepEqual([sh(swap(tests), dir).status, sh(swap(noSkip), dir).status, sh(swap(ran), dir).status], codes, what);
    assert.deepEqual(outsideJob(files, glob, marker), moved in files ? [moved] : [], what);
  }
  // 실 DB 주소를 도우미로 옮겨도 잡 밖이라 잡힌다
  const helper = 'tests/helpers/db.ts';
  assert.deepEqual(outsideJob({ [helper]: `export const url = process.env.${DB_URL_VAR};\n`, [wp2]: pglite + http }, glob, marker), [helper]);
  // TAP이 남지 않았거나 비었으면 건너뜀을 확인할 수 없으니 실패한다
  const dir = tmpTree(t, { 'empty.tap': '' });
  for (const f of ['none.tap', 'empty.tap']) assert.equal(sh(noSkip.split(tap).join(path.join(dir, f)), dir).status, 1, f);
});

test('db 잡 건너뜀 검사를 지금 tests/wp2-*.test.ts에 돌린다: 실 DB 주소가 있으면 걸리는 줄이 없다', { skip }, (t) => {
  const { tests, noSkip, tap } = dbRuns();
  const out = path.join(tmpTree(t, {}), 'url.tap');
  // 아무것도 듣지 않는 포트라 연결이 바로 거절된다. 실 DB 묶음은 before에서 실패하지만 건너뜀은 주소가 있을 때와 같게 TAP에 남는다
  sh(tests.split(tap).join(out), ROOT, childEnv({ [DB_URL_VAR]: 'postgres://yt:yt@127.0.0.1:1/yt_test' }));
  const r = sh(noSkip.split(tap).join(out), ROOT);
  assert.deepEqual(
    { status: r.status, caught: r.stdout.split('\n').filter((l) => /^ *(not )?ok \d+ - /.test(l)) },
    { status: 0, caught: [] },
    'CI처럼 실 DB 주소가 있으면 건너뜀 검사는 초록이어야 한다',
  );
});

test('CONTRIBUTING의 로컬 재현 명령은 db 잡과 같은 테스트 명령과 두 결과 검사다', { skip }, () => {
  const { tests, noSkip, ran } = dbRuns();
  const m = /Reproduce locally[^\n]*\n\n```bash\n([\s\S]*?)\n```/.exec(CONTRIBUTING);
  assert.ok(m, 'CONTRIBUTING에 로컬 재현 블록이 있다');
  const [first, ...checks] = m[1].split('\n');
  assert.match(first, new RegExp(`^${DB_URL_VAR}=postgresql://\\S+ `));
  assert.equal(first.slice(first.indexOf(' ') + 1), tests);
  // 검사의 exit가 개발자 셸을 닫지 않게 하위 셸로 감싼다
  assert.deepEqual(checks, [`(${noSkip})`, `(${ran})`]);
});
