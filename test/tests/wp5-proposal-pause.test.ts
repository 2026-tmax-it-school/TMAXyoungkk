import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * 조정안 계산 중 시뮬레이터 멈춤(WP5, 2026-10-09 웹 실행 오류 2). 소스 규칙 테스트다(store/live.ts는 zustand·RN에 기대 node에서 돌리지 않는다).
 * 300배속에서 지연은 11:10에 잡혔는데 조정안 시트는 13:20 뒤에 떴다. makeProposal이 replanForDelay(경로 서버 대기)를
 * 마친 뒤에야 시계를 멈췄기 때문이다. 이제 계산 전에 멈추고, 조정안이 없으면 다시 재생하고, 있으면 고른 뒤 재생한다.
 * 리뷰 5: 계산 때문에 멈췄다는 표시가 지역 변수라, 계산 중에 사용자가 재생·멈춤을 누르거나 앱이 화면 밖으로 가도
 * 계산이 끝나면 재생을 다시 켰고(또는 고른 뒤 켜게 남겼고), 프리셋을 바꿔 다시 시작하면 새 재생이 멈춘 채 시작했다.
 * 이제 표시는 진행(run.calcPause, 계산 번호)에 두고 재생·멈춤·화면 밖에서 지운다. 다시 시작하면 그 멈춤을 물려받지 않는다.
 */

const src = readFileSync('src/store/live.ts', 'utf8');
const start = src.indexOf('const makeProposal = async');
const end = src.indexOf('const lookFreeTime = async');
const body = src.slice(start, end);

/** 스토어 동작 하나의 본문(이름부터 다음 동작 이름 앞까지) */
function action(name: string, next: string): string {
  const a = src.indexOf(`        ${name}: `);
  const b = src.indexOf(`        ${next}: `, a);
  assert.ok(a > 0 && b > a, `${name} 동작을 찾는다`);
  return src.slice(a, b);
}

test('makeProposal: 시뮬레이터면 replanForDelay를 기다리기 전에 시계를 멈추고, 멈춘 것을 진행에 계산 번호로 남긴다', () => {
  assert.ok(start > 0 && end > start, 'makeProposal을 찾는다');
  const pauseAt = body.indexOf('simClock.pause()');
  const awaitAt = body.indexOf('await replanForDelay');
  assert.ok(pauseAt > 0, '멈춤이 있다');
  assert.ok(awaitAt > 0, '조정안 계산이 있다');
  assert.ok(pauseAt < awaitAt, '멈춤이 계산보다 먼저다');
  assert.match(body, /calcSeq \+= 1;\n\s+const calc = calcSeq;\n\s+if \(run\.requested === 'sim' && simClock\?\.playing\(\)\) \{\n\s+simClock\.pause\(\);\n\s+run\.calcPause = calc;/);
  // 멈춘 표시는 지역 변수가 아니라 진행에 있다. 계산 전에 pausedForCalc를 정하지 않는다
  const decided = body.indexOf('const pausedForCalc = run.calcPause === calc;');
  assert.ok(decided > awaitAt, '계산이 끝난 뒤 진행의 표시로 정한다');
  assert.ok(body.indexOf('if (rt !== run) return;') < decided, '다시 시작한 진행이면 아무것도 하지 않는다');
  assert.match(body, /const pausedForCalc = run\.calcPause === calc;\n\s+if \(pausedForCalc\) run\.calcPause = undefined;/);
  assert.match(src, /let calcSeq = 0;/);
  assert.match(src, /\n {2}calcPause\?: number;\n/);
});

test('makeProposal: 조정안이 없으면 이 계산 때문에 멈춘 채일 때만 다시 켜고, 있으면 그때만 고른 뒤 재생하게 남긴다', () => {
  const none = body.slice(body.indexOf('if (adjustments.length === 0)'), body.indexOf("const id = getServices().ids.next('lp')"));
  assert.match(none, /if \(pausedForCalc && simClock && !simClock\.playing\(\) && !get\(\)\.background\)/);
  assert.match(none, /simClock\.play\(\)/);
  const after = body.slice(body.indexOf("const id = getServices().ids.next('lp')"));
  assert.match(after, /let resume = pausedForCalc/);
  assert.match(after, /if \(resume\) run\.resumeAfterDecision = true/);
  // 계산 중에 사용자가 다시 재생했으면 읽는 동안 멈추고 고른 뒤 이어서 재생한다
  assert.match(after, /if \(run\.requested === 'sim' && simClock\?\.playing\(\)\) \{\n\s+simClock\.pause\(\);\n\s+set\(\{ sim: \{ \.\.\.get\(\)\.sim, playing: false \} \}\);\n\s+resume = true;/);
});

test('재생·멈춤·화면 밖으로 가기는 조정안 계산 때문에 멈춘 표시를 지운다(계산이 끝나도 사용자가 고른 상태를 따른다)', () => {
  const play = action('play', 'pause');
  assert.match(play, /if \(rt\) rt\.calcPause = undefined;/);
  assert.ok(play.indexOf('rt.calcPause = undefined') < play.indexOf('simClock.play()'));
  const pause = action('pause', 'jumpTo');
  assert.match(pause, /rt\.resumeAfterDecision = false;\n\s+rt\.calcPause = undefined;/);
  const appState = src.slice(src.indexOf('const onAppState = '), src.indexOf('const stopFor = '));
  const goingAway = appState.slice(appState.indexOf('if (r.state.background.inBackground && !get().background) {'), appState.indexOf('syncWatch();'));
  assert.match(goingAway, /run\.calcPause = undefined;/);
});

test('진행을 다시 시작하면(프리셋 바꿈 등) 조정안 때문에 멈춘 재생을 물려받지 않는다', () => {
  const startLive = /const startLive = async[\s\S]*?\n {6}\};\n/.exec(src)?.[0] ?? '';
  assert.ok(startLive.length > 0);
  const restore = startLive.indexOf(
    "if (rt?.requested === 'sim' && (rt.calcPause != null || rt.resumeAfterDecision)) set({ sim: { ...get().sim, playing: true } });",
  );
  assert.ok(restore > 0, '조정안 때문에 멈춘 재생이면 사용자가 재생 중이던 것으로 되돌린다');
  assert.ok(restore < startLive.indexOf('teardown();'), '옛 진행을 풀기 전에 본다');
  // 새 진행은 멈춤 표시 없이 시작하고, 사용자가 재생 중이면 재생한다
  const literal = startLive.slice(startLive.indexOf('rt = {'), startLive.indexOf('};', startLive.indexOf('rt = {')));
  assert.match(literal, /resumeAfterDecision: false,/);
  assert.doesNotMatch(literal, /calcPause/);
  assert.match(startLive, /if \(requested === 'sim' && get\(\)\.sim\.playing\) simClock\?\.play\(\);\n {6}\};\n$/);
  // setPreset과 끝까지 재생한 뒤 재생은 startLive로 다시 시작한다
  assert.match(action('setPreset', 'setSpeed'), /void startLive\(rt\.tripId, rt\.date, 'sim'\)/);
});
