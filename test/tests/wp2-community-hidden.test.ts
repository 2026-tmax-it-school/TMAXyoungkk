import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemoryCommunityStore, parseHiddenIds, withHiddenPosts } from '../server/community.mjs';

/** B3: 가린 글은 목록·상세에서 빠지고, 목록 쪽은 가린 글이 끼어도 채워진다 */
const rec = (n: number) => ({
  id: `p${n}`,
  accountId: 'a',
  userId: 'u',
  nickname: 'n',
  kind: 'diary' as const,
  title: `t${n}`,
  body: 'b',
  createdAt: 1000 + n,
  tags: [],
  photos: [],
});

async function seeded() {
  const mem = createMemoryCommunityStore();
  for (let i = 1; i <= 6; i++) await mem.insertPost(rec(i));
  return mem;
}

test('parseHiddenIds: 쉼표 목록을 공백 없이 읽는다', () => {
  assert.deepEqual([...parseHiddenIds(' p1, p2 ,,p3')], ['p1', 'p2', 'p3']);
  assert.equal(parseHiddenIds(undefined).size, 0);
});

test('가린 글은 목록과 상세에서 빠지고 목록은 한 쪽을 채운다', async () => {
  const store = withHiddenPosts(await seeded(), new Set(['p6', 'p5', 'p3']));
  const page = await store.list({ before: null, limit: 2, kind: null, tag: null, q: '' });
  assert.deepEqual(page.map((r: { id: string }) => r.id), ['p4', 'p2']);
  const all = await store.list({ before: null, limit: 10, kind: null, tag: null, q: '' });
  assert.deepEqual(all.map((r: { id: string }) => r.id), ['p4', 'p2', 'p1']);
  assert.equal(await store.getPost('p5'), null);
  assert.equal((await store.getPost('p4'))?.id, 'p4');
});

test('숨김 목록이 비면 저장소를 그대로 쓴다', async () => {
  const mem = await seeded();
  assert.equal(withHiddenPosts(mem, new Set()), mem);
});
