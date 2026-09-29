import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { currentScope, globToRegExp, inScope, listFiles, ownersOf, ROOT } from './ownership.mjs';

/**
 * 정적 검사 공용 도구(foundation-core-boundary, foundation-design-rules, foundation-ownership).
 * 파일을 읽어 주석을 지우고 import를 뽑는다. YT_SCOPE가 있으면 그 패키지 파일의 위반만 남긴다.
 */

export { currentScope, inScope, listFiles, ownersOf, ROOT };

export interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

export function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

export function exists(rel: string): boolean {
  return existsSync(path.join(ROOT, rel));
}

function isFile(rel: string): boolean {
  try {
    return statSync(path.join(ROOT, rel)).isFile();
  } catch {
    return false;
  }
}

/**
 * 주석을 공백으로 바꾼다. 줄 번호가 유지되게 개행은 남긴다. 문자열·템플릿 안의 // 는 건드리지 않는다.
 * 정규식 리터럴은 따로 다루지 않는다(소스에 슬래시 두 개가 든 정규식을 쓰지 않는 전제).
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** import·export from·동적 import·require의 모듈 이름 */
export function importSpecifiers(code: string): { spec: string; line: number; typeOnly: boolean }[] {
  const out: { spec: string; line: number; typeOnly: boolean }[] = [];
  const re =
    /(?:^|[\s;])(import|export)\s+(type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const spec = m[3] ?? m[4] ?? m[5] ?? m[6];
    if (!spec) continue;
    out.push({ spec, line: lineOf(code, m.index), typeOnly: !!m[2] });
  }
  return out;
}

/** 상대 import를 test/ 기준 파일 경로로 푼다. 확장자 없음 → .ts → .tsx → /index.ts → /index.tsx */
export function resolveRelative(fromRel: string, spec: string): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const cands = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return cands.find(isFile);
}

export const RN_MODULE_PATTERNS: RegExp[] = [
  /^react$/,
  /^react\//,
  /^react-dom($|\/)/,
  /^react-native($|\/)/,
  /^react-native-/,
  /^expo($|\/)/,
  /^expo-/,
  /^@expo\//,
  /^@expo-google-fonts\//,
  /^@react-native-async-storage\//,
  /^@react-native\//,
  /^@react-navigation\//,
  /^zustand($|\/)/,
];

export function isRnModule(spec: string): boolean {
  return RN_MODULE_PATTERNS.some((r) => r.test(spec));
}

/** 순수 영역(계약 A1). RN·스토어·비순수 공유 서비스·config를 import하지 않는다. */
export const PURE_GLOBS = [
  'src/core/**',
  'src/data/**',
  'src/demo/scenarioRunner.ts',
  'src/demo/scenarioSteps.ts',
  'src/services/kakaoHttp.ts',
  'src/services/aiProxy.ts',
  'src/services/places/{index,local,kakao}.ts',
  'src/services/routes/{index,local,kakao,cache,transit}.ts',
  'src/services/extraction/{index,rules,ai}.ts',
  'src/services/recommend/{index,local,ai}.ts',
  'src/services/diary/{index,template,ai}.ts',
  'src/services/auth/{index,local}.ts',
  'src/services/sync/{index,loopback,http}.ts',
  'src/services/location/sim.ts',
  'src/services/photos/sim.ts',
];
const PURE_RES = PURE_GLOBS.map(globToRegExp);

export function isPure(rel: string): boolean {
  return PURE_RES.some((r) => r.test(rel));
}

/** 순수 영역이 import하면 안 되는 앱 파일 */
export const FORBIDDEN_FROM_PURE = [
  'src/store/**',
  'src/services/{registry,index,clock,random,kv,share}.ts',
  'src/config.ts',
  'src/navigation/**',
  'src/screens/**',
  'src/components/**',
  'src/ui/!(tokens).ts',
  'src/ui/*.tsx',
  'App.tsx',
].map((g) => (g === 'src/ui/!(tokens).ts' ? /^src\/ui\/(?!tokens\.ts$)[^/]+\.ts$/ : globToRegExp(g)));

export function scoped(vs: Violation[]): Violation[] {
  return vs.filter((v) => inScope(v.file));
}

export function formatViolations(vs: Violation[]): string {
  const scope = currentScope();
  const head = scope ? `[YT_SCOPE=${scope}] ` : '';
  return `${head}위반 ${vs.length}건\n${vs.map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.text}`).join('\n')}`;
}

/** 줄 단위 정규식 검사 */
export function scanLines(file: string, text: string, rule: string, re: RegExp): Violation[] {
  const out: Violation[] = [];
  text.split('\n').forEach((line, i) => {
    if (re.test(line)) out.push({ file, line: i + 1, rule, text: line.trim().slice(0, 120) });
  });
  return out;
}
