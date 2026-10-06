import test from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, selectFiles, validateFindings, makeRequest, runReview, clean } from './openai-review.mjs';
const sha = 'a'.repeat(40), repo = 'example/project';
const event = { repository: { id: 1, full_name: repo, default_branch: 'main' }, workflow_run: { id: 7 } };
const env = { OPENAI_REVIEW_ENABLED: 'true', OPENAI_REVIEW_BUDGET_CONFIRMED: 'true', OPENAI_API_KEY: 'test-only',
  GITHUB_TOKEN: 'test-only', GITHUB_EVENT_NAME: 'workflow_run', GITHUB_REPOSITORY: repo };
const patch = '@@ -1,2 +1,3 @@\n context\n-old\n+new\n+next';
const files = [{ filename: 'src/code.ts', status: 'modified', patch }];
function harness(options = {}) {
  const calls = []; let reads = 0;
  const pull = { state: 'open', draft: false, changed_files: 1, user: { login: 'member', type: 'User' },
    head: { sha, repo: { id: 1 } }, base: { ref: 'main', repo: { id: 1 } }, ...options.pull };
  const run = { event: 'pull_request', conclusion: 'success', status: 'completed', repository: { id: 1 },
    head_repository: { id: 1 }, path: '.github/workflows/ci.yml', name: 'CI', head_sha: sha, pull_requests: [{ number: 2 }], ...options.run };
  const fetcher = async (url, init) => {
    const body = init.body && JSON.parse(init.body); calls.push({ url, ...init, body });
    let data;
    if (url === 'https://api.openai.com/v1/responses') {
      if (options.throwAPI) throw Error('timeout');
      data = options.result ?? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text',
        text: JSON.stringify({ findings: [{ path: 'src/code.ts', line: 2, severity: 'high', title: '오류', body: '조건 확인' }] }) }] }] };
    } else if (url.endsWith('/actions/runs/7')) data = run;
    else if (url.endsWith('/pulls/2')) { reads++; data = options.stale && reads >= options.stale ? { ...pull, draft: true } : pull; }
    else if (url.endsWith('/permission')) data = { permission: options.permission ?? 'write' };
    else if (url.includes('/reviews?')) data = options.reviewPages?.[Number(new URL(url).searchParams.get('page')) - 1] ?? options.reviews ?? [];
    else if (url.includes('/files?')) data = options.files ?? files;
    else if (url.endsWith('/reviews') && init.method === 'POST') { if (options.failReservation) throw Error('reservation failed'); data = { id: 4 }; }
    else if (url.endsWith('/reviews/4') && init.method === 'PUT') data = { id: 4 };
    else throw Error(`Unexpected URL: ${url}`);
    return { ok: true, json: async () => data };
  };
  return { calls, execute: overrides => runReview({ ...env, ...overrides }, event, fetcher, () => {}) };
}
const paid = h => h.calls.filter(c => c.url.startsWith('https://api.openai.com/'));
test('added lines use RIGHT line numbers across deleted/context lines and hunks', () => {
  assert.deepEqual([...addedLines(patch + '\n@@ -8 +12 @@\n-a\n+b')], [2, 3, 12]);
});
test('exclude secret/generated/binary/oversized files and bound input', () => {
  const extra = ['.env', '.github/secret.yml', 'credentials.json', 'vendor/x.ts', 'package-lock.json', 'image.png'];
  const result = selectFiles([...files, ...extra.map(filename => ({ filename, patch })), { filename: 'huge.ts', patch: 'a'.repeat(33000) }]);
  assert.equal(result.selected.length, 1); assert.equal(result.skipped, 7);
  assert.equal(selectFiles(Array.from({ length: 30 }, (_, i) => ({ filename: `${i}.js`, patch }))).selected.length, 20);
});
test('validate locations, severity, duplicates; reject malformed model output', () => {
  const selected = selectFiles(files).selected;
  const good = { path: 'src/code.ts', line: 2, severity: 'high', title: 'x', body: 'y' };
  assert.equal(validateFindings({ findings: [good, good, { ...good, line: 1 }, { ...good, path: '../../x' }] }, selected).length, 1);
  assert.throws(() => validateFindings({ findings: 'invalid' }, selected));
  assert.throws(() => validateFindings({ findings: Array(6).fill(good) }, selected));
  assert.equal(clean('www.evil.test', 100).includes('www.'), false);
  assert.equal(clean('@all <script>`x` https://evil.test', 200).includes('@all'), false);
});
test('Responses request is bounded, stateless, strict, and tool-free', () => {
  const request = makeRequest(selectFiles(files).selected);
  assert.equal(request.store, false); assert.equal(request.max_output_tokens, 2000);
  assert.equal(request.model, 'gpt-6-luna'); assert.equal(request.text.format.strict, true);
  assert.equal(request.tools, undefined); assert.equal(request.reasoning.effort, 'low');
});
test('all activation gates fail before any network access', async () => {
  for (const overrides of [{ OPENAI_REVIEW_ENABLED: '' }, { OPENAI_REVIEW_BUDGET_CONFIRMED: '' }, { OPENAI_API_KEY: '' }, { GITHUB_EVENT_NAME: 'pull_request' }]) {
    const h = harness(); await h.execute(overrides); assert.equal(h.calls.length, 0);
  }
});
test('forks, bots, drafts, closed, stale heads and non-default bases never spend', async () => {
  for (const pull of [{ draft: true }, { state: 'closed' }, { user: { type: 'Bot' } },
    { head: { sha, repo: { id: 9 } } }, { head: { sha: 'b'.repeat(40), repo: { id: 1 } } },
    { base: { ref: 'develop', repo: { id: 1 } } }]) {
    const h = harness({ pull }); await h.execute(); assert.equal(paid(h).length, 0);
  }
});
test('only verified successful same-repo expected CI and write-author can spend', async () => {
  for (const run of [{ event: 'push' }, { conclusion: 'failure' }, { status: 'in_progress' }, { path: 'other.yml' },
    { name: 'Other' }, { head_repository: { id: 9 } }, { pull_requests: [] }]) {
    const h = harness({ run }); await h.execute(); assert.equal(paid(h).length, 0);
  }
  const h = harness({ permission: 'read' }); await h.execute(); assert.equal(paid(h).length, 0);
});
test('SHA reservation deduplicates failed/completed attempts, ignoring forged users', async () => {
  const body = `<!-- openai-review:v1:${sha} -->`;
  const h = harness({ reviews: [{ body, user: { login: 'github-actions[bot]' } }] });
  assert.equal(await h.execute(), 'already attempted'); assert.equal(paid(h).length, 0);
  const fake = harness({ reviews: [{ body, user: { login: 'someone' } }] });
  assert.equal(await fake.execute(), 'reviewed'); assert.equal(paid(fake).length, 1);
});
test('large/incomplete diffs and stale PR before request never spend', async () => {
  for (const options of [{ pull: { changed_files: 101 } }, { files: [] }, { files: [{ filename: 'x.png' }] }, { stale: 2 }]) {
    const h = harness(options); await h.execute(); assert.equal(paid(h).length, 0);
  }
});
test('one COMMENT reservation precedes one API call and a bounded result update', async () => {
  const h = harness(); assert.equal(await h.execute(), 'reviewed');
  const writes = h.calls.filter(c => c.method !== 'GET');
  assert.deepEqual(writes.map(c => c.method), ['POST', 'POST', 'PUT']);
  assert.equal(writes[0].body.event, 'COMMENT'); assert.equal(writes[0].body.commit_id, sha);
  assert.match(writes[2].body.body, /src\/code.ts:2/); assert.equal(paid(h).length, 1);
});
test('timeout/refusal/incomplete/invalid output never retry and safely update reservation', async () => {
  for (const options of [{ throwAPI: true }, { result: { status: 'incomplete' } },
    { result: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] } },
    { result: { status: 'completed', output: [] } }]) {
    const h = harness(options); assert.equal(await h.execute(), 'failed'); assert.equal(paid(h).length, 1);
    assert.match(h.calls.at(-1).body.body, /자동 재시도하지/);
  }
});
test('head changes during request suppress stale findings', async () => {
  const h = harness({ stale: 3 }); assert.equal(await h.execute(), 'stale');
  assert.equal(paid(h).length, 1); assert.doesNotMatch(h.calls.at(-1).body.body, /src\/code/);
});
test('GitHub run paths may include an @ref suffix', async () => {
  const good = harness({ run: { path: '.github/workflows/ci.yml@refs/pull/2/merge' } });
  assert.equal(await good.execute(), 'reviewed');
  const bad = harness({ run: { path: '.github/workflows/other.yml@main' } });
  await bad.execute(); assert.equal(paid(bad).length, 0);
});
test('failed reservation prevents billing; dedup searches later pages', async () => {
  const failed = harness({ failReservation: true }); await assert.rejects(failed.execute()); assert.equal(paid(failed).length, 0);
  const later = harness({ reviewPages: [Array(100).fill({ body: '', user: {} }), [{ body: `<!-- openai-review:v1:${sha} -->`, user: { login: 'github-actions[bot]' } }]] });
  assert.equal(await later.execute(), 'already attempted'); assert.equal(paid(later).length, 0);
});
