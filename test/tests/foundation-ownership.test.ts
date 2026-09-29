import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isLiteralGlob, loadOwnership, OWNERS } from './setup/ownership.mjs';
import { currentScope, listFiles, ownersOf } from './setup/scan';

/**
 * 소유권(계약 A10). tests/setup/ownership.json 하나로 정한다.
 * 모든 src·tests·server 파일의 소유자가 정확히 하나여야 한다.
 * YT_SCOPE=WPn이면 그 패키지 파일의 겹침만 실패로 치고, 주인 없는 파일은 진단으로만 알린다(통합 게이트가 실패로 본다).
 */

const own = loadOwnership() as Record<string, string[]>;

test('소유자 목록은 FOUNDATION과 WP1~WP6이다', () => {
  assert.deepEqual(Object.keys(own).sort(), [...OWNERS].sort());
});

test('글롭 문자열이 두 소유자에 동시에 들어 있지 않다', () => {
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const [owner, globs] of Object.entries(own)) {
    for (const g of globs) {
      if (seen.has(g)) dup.push(`${g}: ${seen.get(g)} + ${owner}`);
      seen.set(g, owner);
    }
  }
  assert.deepEqual(dup, []);
});

test('고정 경로 글롭은 다른 소유자의 글롭과 겹치지 않는다', () => {
  const overlaps: string[] = [];
  for (const [owner, globs] of Object.entries(own)) {
    for (const g of globs.filter(isLiteralGlob)) {
      const owners = ownersOf(g) as string[];
      if (owners.length !== 1 || owners[0] !== owner) overlaps.push(`${g} → ${owners.join(', ')}`);
    }
  }
  assert.deepEqual(overlaps, []);
});

test('모든 src·tests·server 파일의 소유자가 정확히 하나다', (t) => {
  const scope = currentScope();
  const files = [...listFiles('src'), ...listFiles('tests'), ...listFiles('server')];
  assert.ok(files.length > 0);
  const unowned: string[] = [];
  const multi: string[] = [];
  for (const f of files) {
    const owners = ownersOf(f) as string[];
    if (owners.length === 0) unowned.push(f);
    else if (owners.length > 1) multi.push(`${f} → ${owners.join(', ')}`);
  }
  if (scope) {
    const mine = multi.filter((m) => m.includes(scope));
    if (unowned.length > 0) t.diagnostic(`주인 없는 파일(통합 게이트에서 실패): ${unowned.join(', ')}`);
    assert.deepEqual(mine, []);
    return;
  }
  assert.deepEqual({ unowned, multi }, { unowned: [], multi: [] });
});
