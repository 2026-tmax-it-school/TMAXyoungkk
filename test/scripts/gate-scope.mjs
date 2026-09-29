#!/usr/bin/env node
/**
 * 작업 중 게이트(계약 A10). 같은 트리에서 여섯 패키지가 동시에 일해도 서로 막지 않게 자기 범위만 본다.
 *
 *   node scripts/gate-scope.mjs WP3
 *
 * 1. npx tsc --noEmit 결과 중 WPn 소유 파일의 오류가 0건
 * 2. tests/wpn-*.test.ts 통과(파일이 없으면 건너뛴다)
 * 3. YT_SCOPE=WPn으로 foundation 테스트를 돌려 WPn 소유 파일의 위반이 0건
 *
 * 다른 패키지 파일이 원인인 tsc 오류는 개수만 알린다(고치지 않고 보고만 한다).
 * 완료 보고 직전에는 따로 npx expo export --platform web --output-dir /tmp/yt-export-wpn 을 한 번 돌린다.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { ownersOf, ROOT } from '../tests/setup/ownership.mjs';

const wp = (process.argv[2] ?? '').toUpperCase();
if (!/^WP[1-6]$/.test(wp)) {
  console.error('쓰는 법: node scripts/gate-scope.mjs WP1 … WP6');
  process.exit(2);
}
const lower = wp.toLowerCase();
const NODE_TEST = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './tests/setup/resolve-ts.mjs', '--test'];

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const results = [];

// 1. tsc
{
  const r = run('npx', ['tsc', '--noEmit', '--pretty', 'false']);
  const errors = r.out
    .split('\n')
    .map((l) => /^(.+?)\(\d+,\d+\): error TS\d+/.exec(l))
    .filter(Boolean)
    .map((m) => ({ file: path.normalize(m[1]).split(path.sep).join('/'), line: m.input }));
  const mine = errors.filter((e) => ownersOf(e.file).includes(wp));
  const others = errors.length - mine.length;
  console.log(`\n[1/3] tsc: ${wp} 파일 오류 ${mine.length}건, 다른 파일 오류 ${others}건(보고만)`);
  for (const e of mine) console.log(`  ${e.line}`);
  results.push({ step: 'tsc', ok: mine.length === 0 });
}

// 2. 자기 테스트
{
  const own = readdirSync(path.join(ROOT, 'tests')).filter((f) => f.startsWith(`${lower}-`) && f.endsWith('.test.ts'));
  if (own.length === 0) {
    console.log(`\n[2/3] tests/${lower}-*.test.ts: 파일 없음(건너뜀)`);
    results.push({ step: 'own-tests', ok: true, skipped: true });
  } else {
    const r = run('node', [...NODE_TEST, ...own.map((f) => `tests/${f}`)]);
    console.log(`\n[2/3] tests/${lower}-*.test.ts: ${own.length}개 파일 ${r.code === 0 ? '통과' : '실패'}`);
    if (r.code !== 0) console.log(r.out.split('\n').filter((l) => /^(✖|not ok|#|ℹ)/.test(l.trim())).join('\n'));
    results.push({ step: 'own-tests', ok: r.code === 0 });
  }
}

// 3. foundation 테스트(YT_SCOPE)
{
  const files = readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => f.startsWith('foundation-') && f.endsWith('.test.ts'))
    .map((f) => `tests/${f}`);
  const r = run('node', [...NODE_TEST, ...files], { YT_SCOPE: wp });
  console.log(`\n[3/3] YT_SCOPE=${wp} foundation 테스트 ${files.length}개: ${r.code === 0 ? '통과' : '실패'}`);
  if (r.code !== 0) {
    console.log(
      r.out
        .split('\n')
        .filter((l) => /^(✖|위반|\s+src\/|\s+tests\/|\[YT_SCOPE)/.test(l) || /\[[a-z-]+\]/.test(l))
        .slice(0, 80)
        .join('\n'),
    );
  }
  results.push({ step: 'foundation-scoped', ok: r.code === 0 });
}

const ok = results.every((r) => r.ok);
console.log(`\n${wp} 작업 중 게이트: ${ok ? '통과' : '실패'} (${results.map((r) => `${r.step}=${r.ok ? (r.skipped ? 'skip' : 'ok') : 'FAIL'}`).join(', ')})`);
process.exit(ok ? 0 : 1);
