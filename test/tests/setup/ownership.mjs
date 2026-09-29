/**
 * 파일 소유권(계약 A10). tests/setup/ownership.json 하나로 정한다.
 * gate-scope 스크립트와 foundation 테스트가 같이 쓴다. 경로는 test/ 기준 상대 경로(슬래시)다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OWNERS = ['FOUNDATION', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5', 'WP6'];

export function loadOwnership() {
  return JSON.parse(readFileSync(path.join(ROOT, 'tests', 'setup', 'ownership.json'), 'utf8'));
}

/** glob → 정규식. ** 는 경로 여러 단, * 는 한 단 안, {a,b} 는 택일 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',') re += '|';
    else if ('.+^$()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function isLiteralGlob(glob) {
  return !/[*?{]/.test(glob);
}

let cache;
function compiled() {
  if (!cache) {
    const own = loadOwnership();
    cache = Object.entries(own).map(([owner, globs]) => ({ owner, globs, res: globs.map(globToRegExp) }));
  }
  return cache;
}

/** 이 파일의 소유자들. 정확히 하나여야 한다. */
export function ownersOf(relPath) {
  const p = relPath.split(path.sep).join('/');
  return compiled()
    .filter((o) => o.res.some((r) => r.test(p)))
    .map((o) => o.owner);
}

export function ownerOf(relPath) {
  return ownersOf(relPath)[0];
}

/** YT_SCOPE=WPn이면 그 패키지 파일만 본다. 없으면 전부 */
export function currentScope() {
  const s = process.env.YT_SCOPE;
  return s && s.length > 0 ? s.toUpperCase() : undefined;
}

export function inScope(relPath) {
  const scope = currentScope();
  if (!scope) return true;
  return ownersOf(relPath).includes(scope);
}

const SKIP_DIRS = new Set(['node_modules', '.expo', '.git', 'dist', 'web-build', 'ios', 'android']);

/** test/ 아래 dir 안의 파일 목록(상대 경로). 없는 폴더면 빈 배열 */
export function listFiles(dir, exts) {
  const out = [];
  const start = path.join(ROOT, dir);
  let st;
  try {
    st = statSync(start);
  } catch {
    return out;
  }
  if (!st.isDirectory()) return out;
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      if (SKIP_DIRS.has(name) || name === '.DS_Store') continue;
      const full = path.join(abs, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!exts || exts.some((e) => name.endsWith(e))) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  walk(start);
  return out.sort();
}
