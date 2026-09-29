import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FORBIDDEN_FROM_PURE,
  formatViolations,
  importSpecifiers,
  isPure,
  isRnModule,
  listFiles,
  read,
  resolveRelative,
  scoped,
  stripComments,
  type Violation,
} from './setup/scan';

/**
 * 순수 영역 경계(계약 A1). src/core/**, src/data/**, src/demo/scenarioRunner.ts, 순수 서비스 파일은
 * RN 계열·스토어·비순수 공유 서비스·config를 import하지 않고, 시각·난수를 직접 만들지 않는다.
 * 테스트가 닿는 모듈 그래프에는 .tsx가 없어야 한다(node는 .tsx를 불러오지 못한다).
 * YT_SCOPE=WPn이면 그 패키지 파일의 위반만 본다.
 */

const SRC = listFiles('src', ['.ts', '.tsx']);
const PURE = SRC.filter(isPure);

test('순수 영역 파일 목록이 비어 있지 않다', () => {
  assert.ok(PURE.length > 20, `순수 파일 ${PURE.length}개`);
  assert.ok(PURE.includes('src/core/ops/index.ts'));
  assert.ok(PURE.includes('src/services/routes/cache.ts'));
  assert.equal(PURE.includes('src/services/location/device.ts'), false);
});

test('순수 영역에 .tsx가 없다', () => {
  const vs: Violation[] = PURE.filter((f) => f.endsWith('.tsx')).map((f) => ({
    file: f,
    line: 1,
    rule: 'tsx',
    text: '순수 영역은 .ts만 둔다',
  }));
  assert.deepEqual(scoped(vs), [], formatViolations(scoped(vs)));
});

test('순수 영역은 RN 계열·스토어·비순수 서비스·config를 import하지 않는다', () => {
  const vs: Violation[] = [];
  for (const f of PURE) {
    const code = stripComments(read(f));
    for (const { spec, line } of importSpecifiers(code)) {
      if (isRnModule(spec)) {
        vs.push({ file: f, line, rule: 'rn-import', text: spec });
        continue;
      }
      if (!spec.startsWith('.')) continue;
      const target = resolveRelative(f, spec);
      if (!target) {
        vs.push({ file: f, line, rule: 'unresolved', text: spec });
        continue;
      }
      if (target.endsWith('.tsx')) vs.push({ file: f, line, rule: 'tsx-import', text: `${spec} → ${target}` });
      if (FORBIDDEN_FROM_PURE.some((r) => r.test(target))) {
        vs.push({ file: f, line, rule: 'impure-import', text: `${spec} → ${target}` });
      }
    }
  }
  assert.deepEqual(scoped(vs), [], formatViolations(scoped(vs)));
});

test('순수 영역은 Date.now·Math.random·인자 없는 new Date를 쓰지 않는다', () => {
  const vs: Violation[] = [];
  const rules: [string, RegExp][] = [
    ['Date.now', /\bDate\.now\s*\(/],
    ['Math.random', /\bMath\.random\s*\(/],
    ['new Date()', /\bnew\s+Date\s*\(\s*\)/],
  ];
  for (const f of PURE) {
    const lines = stripComments(read(f)).split('\n');
    lines.forEach((l, i) => {
      for (const [rule, re] of rules) if (re.test(l)) vs.push({ file: f, line: i + 1, rule, text: l.trim() });
    });
  }
  assert.deepEqual(scoped(vs), [], formatViolations(scoped(vs)));
});

test('앱 코드는 Node 전역(Buffer, process)과 node 내장 모듈을 쓰지 않는다(tsconfig types node 보완)', () => {
  // tsconfig에 types ["node"]가 있어 tsc가 Node API를 잡지 못한다. RN·웹에는 없는 API라 여기서 막는다.
  // process.env.EXPO_PUBLIC_*는 Expo가 빌드 때 치환하므로 src/config.ts에서만 허용한다.
  const NODE_BUILTIN = /^(node:|fs$|path$|os$|crypto$|http$|https$|child_process$|url$|util$|stream$|buffer$)/;
  const vs: Violation[] = [];
  for (const f of SRC) {
    const code = stripComments(read(f));
    code.split('\n').forEach((l, i) => {
      if (/\bBuffer\s*[.(]/.test(l)) vs.push({ file: f, line: i + 1, rule: 'node-buffer', text: l.trim() });
      if (f !== 'src/config.ts' && /\bprocess\s*\./.test(l)) vs.push({ file: f, line: i + 1, rule: 'node-process', text: l.trim() });
    });
    for (const { spec, line } of importSpecifiers(code)) {
      if (NODE_BUILTIN.test(spec)) vs.push({ file: f, line, rule: 'node-builtin', text: spec });
    }
  }
  assert.deepEqual(scoped(vs), [], formatViolations(scoped(vs)));
});

test('순수 영역은 enum·namespace·매개변수 프로퍼티를 쓰지 않는다', () => {
  const vs: Violation[] = [];
  const rules: [string, RegExp][] = [
    ['enum', /(^|\s)(const\s+)?enum\s+[A-Za-z_]\w*\s*\{/],
    ['namespace', /(^|\s)namespace\s+[A-Za-z_]\w*/],
    ['param-property', /constructor\s*\([^)]*\b(public|private|protected|readonly)\s+\w+/],
  ];
  for (const f of PURE) {
    const lines = stripComments(read(f)).split('\n');
    lines.forEach((l, i) => {
      for (const [rule, re] of rules) if (re.test(l)) vs.push({ file: f, line: i + 1, rule, text: l.trim() });
    });
  }
  assert.deepEqual(scoped(vs), [], formatViolations(scoped(vs)));
});

test('테스트가 닿는 모듈 그래프에 .tsx와 RN 계열 import가 없다', () => {
  const tests = listFiles('tests', ['.ts']);
  const seen = new Set<string>();
  const queue = [...tests];
  const vs: Violation[] = [];
  while (queue.length > 0) {
    const f = queue.shift() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith('.tsx')) continue;
    if (!f.endsWith('.ts')) continue;
    const code = stripComments(read(f));
    for (const { spec, line, typeOnly } of importSpecifiers(code)) {
      if (typeOnly) continue;
      if (isRnModule(spec)) {
        vs.push({ file: f, line, rule: 'rn-reachable', text: spec });
        continue;
      }
      if (!spec.startsWith('.')) continue;
      const target = resolveRelative(f, spec);
      if (!target) {
        vs.push({ file: f, line, rule: 'unresolved', text: spec });
        continue;
      }
      if (target.endsWith('.tsx')) {
        vs.push({ file: f, line, rule: 'tsx-reachable', text: `${spec} → ${target}` });
        continue;
      }
      queue.push(target);
    }
  }
  assert.ok(seen.size > tests.length, '테스트가 src 모듈에 닿는다');
  assert.deepEqual(scoped(vs), [], formatViolations(scoped(vs)));
});
