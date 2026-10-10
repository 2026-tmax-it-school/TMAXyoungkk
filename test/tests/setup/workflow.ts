import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import { read } from './scan';

/**
 * CI 검사(foundation-ci, foundation-ci-db) 공용 도구.
 * ../.github/workflows/ci.yml을 들여쓰기로 읽어 구조를 본다(YAML 파서 의존성을 두지 않는다).
 */

export const CI_YML = '../.github/workflows/ci.yml';

export interface YLine {
  indent: number;
  text: string;
}

/** 빈 줄과 주석을 뺀 줄. 따옴표 밖에서 공백 뒤 # 부터 줄 끝까지가 주석이다 */
export function yamlLines(src: string): YLine[] {
  const out: YLine[] = [];
  for (const raw of src.split('\n')) {
    let quote: string | null = null;
    let cut = raw.length;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
        cut = i;
        break;
      }
    }
    const line = raw.slice(0, cut).trimEnd();
    if (line.trim() === '') continue;
    out.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  return out;
}

function keyOf(text: string): string | undefined {
  return /^([A-Za-z0-9_-]+):(\s|$)/.exec(text)?.[1];
}

/** 블록 맨 윗단의 키 이름들 */
export function keys(lines: YLine[]): string[] {
  if (lines.length === 0) return [];
  const base = Math.min(...lines.map((l) => l.indent));
  return lines.filter((l) => l.indent === base).flatMap((l) => keyOf(l.text) ?? []);
}

/** 키 경로를 따라 내려간다. 마지막 키 줄의 값과 그 아래 블록 */
export function at(lines: YLine[], ...keyPath: string[]): { value: string; body: YLine[] } {
  let body = lines;
  let value = '';
  for (const key of keyPath) {
    if (body.length === 0) return { value: '', body: [] };
    const base = Math.min(...body.map((l) => l.indent));
    const i = body.findIndex((l) => l.indent === base && keyOf(l.text) === key);
    if (i < 0) return { value: '', body: [] };
    value = body[i].text.slice(key.length + 1).trim();
    const next: YLine[] = [];
    for (let j = i + 1; j < body.length && body[j].indent > base; j += 1) next.push(body[j]);
    body = next;
  }
  return { value, body };
}

/** [a, 'b'] 꼴 목록 */
export function flowList(value: string): string[] {
  const m = /^\[(.*)\]$/.exec(value);
  assert.ok(m, `목록이 아니다: ${value}`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter((s) => s.length > 0);
}

/** 단계 목록에서 키 하나의 값만 차례대로 뽑는다(- uses: …, run: …) */
export function stepValues(steps: YLine[], key: string): string[] {
  return steps
    .map((l) => l.text.replace(/^-\s+/, ''))
    .filter((t) => keyOf(t) === key)
    .map((t) => t.slice(key.length + 1).trim());
}

/** ci.yml 전체와 jobs 블록 */
export function readCi(): { doc: YLine[]; jobs: YLine[] } {
  const doc = yamlLines(read(CI_YML));
  return { doc, jobs: at(doc, 'jobs').body };
}

/** 임시 폴더에 파일들을 만든다. 테스트가 끝나면 지운다 */
export function tmpTree(t: TestContext, files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'yt-ci-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
