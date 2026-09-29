/**
 * node --test용 해석 훅. node 24의 타입 제거(.ts)를 쓰되, 확장자 없는 import와 폴더 import를 찾아 준다.
 *   import '../core/util'  → util.ts
 *   import '../core/ops'   → ops/index.ts
 * .tsx는 찾지 않는다(node는 .tsx를 불러오지 못한다). 테스트 대상 로직은 .ts에 둔다.
 * RN 계열 모듈을 불러오면 이유를 담은 오류를 던진다. 팩토리나 core로 분리해 테스트한다.
 *
 * 쓰는 법: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/setup/resolve-ts.mjs --test 'tests/**\/*.test.ts'
 */
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RN_MODULE_PATTERNS = [
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

const KNOWN_EXT = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs', '.json', '.node']);

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (RN_MODULE_PATTERNS.some((r) => r.test(specifier))) {
      throw new Error(
        `테스트에서 RN 모듈을 불러왔다: ${specifier} — 팩토리나 core로 분리할 것 (불러온 곳: ${context.parentURL ?? '?'})`,
      );
    }
    const parent = context.parentURL;
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && parent && parent.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      const ext = path.extname(base);
      if (ext === '.tsx') {
        throw new Error(`테스트가 .tsx 모듈에 닿았다: ${specifier} — 테스트 대상 로직은 .ts로 옮길 것 (불러온 곳: ${parent})`);
      }
      if (!KNOWN_EXT.has(ext)) {
        for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
          if (isFile(cand)) return nextResolve(pathToFileURL(cand).href, context);
        }
        if (isFile(`${base}.tsx`) || isFile(path.join(base, 'index.tsx'))) {
          throw new Error(`테스트가 .tsx 모듈에 닿았다: ${specifier} — 테스트 대상 로직은 .ts로 옮길 것 (불러온 곳: ${parent})`);
        }
        if (existsSync(base) && !isFile(base)) {
          throw new Error(`폴더 import에 index.ts가 없다: ${specifier} (불러온 곳: ${parent})`);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
