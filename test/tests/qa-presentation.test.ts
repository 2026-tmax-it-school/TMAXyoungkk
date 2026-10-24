import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { SCENARIO_T0 } from '../src/data/scenario';
import { PRESENTATION_LIVE_DATE, PRESENTATION_LIVE_PRESET, PRESENTATION_LIVE_SPEED, PRESENTATION_STEPS, seedsNeeded } from '../src/demo/presentation';
import { COLLECT_LAST_LINE, scenarioSteps, stepsAfter, stepsUntil } from '../src/demo/scenarioSteps';

/** 발표 시나리오(시연 도구): 슬라이드 4단계와 순서표 분할 */

test('슬라이드 4단계의 제목과 설명이 그대로 들어 있다', () => {
  assert.deepEqual(
    PRESENTATION_STEPS.map((s) => [s.title, s.sub]),
    [
      ['채팅으로 담기', '메시지 속 장소가 바로 후보로'],
      ['자동 선별', '좋아요가 모이면 고정, 넘치면 제외'],
      ['시간표와 루트', '날짜별 방문 순서와 이동 시간'],
      ['여행 진행', '도착 기록과 늦을 때 조정안'],
    ],
  );
  assert.equal(PRESENTATION_LIVE_DATE, '2026-10-17');
  assert.equal(PRESENTATION_LIVE_PRESET, 'delay25');
  assert.equal(PRESENTATION_LIVE_SPEED, 300);
});

test('1단계(collect)는 대화 9번째 줄까지, 2단계가 나머지이며 합치면 전체 순서표와 같다', () => {
  const all = scenarioSteps(SCENARIO_T0);
  const first = stepsUntil(all, 'collect');
  const rest = stepsAfter(all, 'collect');
  assert.deepEqual([...first, ...rest], all);
  const lines = (list: typeof all) => list.filter((s) => s.kind === 'chat').map((s) => (s.kind === 'chat' ? s.line : 0));
  assert.equal(Math.max(...lines(first)), COLLECT_LAST_LINE);
  assert.equal(Math.min(...lines(rest)), COLLECT_LAST_LINE + 1);
  // 방 만들기·초대·첫 합류는 1단계에만 있고, 지우 합류(늦은 합류)는 2단계에 있다
  assert.ok(first.some((s) => s.kind === 'create'));
  assert.ok(!rest.some((s) => s.kind === 'create'));
  assert.ok(rest.some((s) => s.kind === 'join' && s.member === 'jiwoo'));
  assert.ok(!first.some((s) => s.kind === 'join' && s.member === 'jiwoo'));
});

test('어느 단계든 바로 누를 수 있고 비어 있는 앞 단계는 알아서 채운다', () => {
  assert.deepEqual(seedsNeeded(0, 0), ['collect']);
  assert.deepEqual(seedsNeeded(0, 2), ['collect']); // 1단계는 언제나 처음부터
  assert.deepEqual(seedsNeeded(3, 0), ['collect', 'select']); // 4단계만 눌러도 1·2단계가 채워진다
  assert.deepEqual(seedsNeeded(2, 0), ['collect', 'select']);
  assert.deepEqual(seedsNeeded(1, 0), ['collect', 'select']);
  assert.deepEqual(seedsNeeded(1, 1), ['select']);
  assert.deepEqual(seedsNeeded(3, 1), ['select']);
  assert.deepEqual(seedsNeeded(3, 2), []);
  assert.deepEqual(seedsNeeded(2, 2), []);
});

test('시연 도구 안에 관리자 전용 발표 패널이 있고 단계마다 화면을 연다', () => {
  const more = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
  assert.match(more, /canUseDemoTools\(session\) \? \([\s\S]*<PresentationPanel busy=\{seeding != null\} onOpen=\{openPresentationStep\} \/>/);
  assert.match(more, /step === 'collect'\) navigation\.navigate\('Chat', \{ tripId, view: 'chat' \}\)/);
  assert.match(more, /navigation\.navigate\('Main', \{ screen: 'Candidates' \}\)/);
  assert.match(more, /navigation\.navigate\('Main', \{ screen: 'Schedule' \}\)/);
  assert.match(more, /navigation\.navigate\('LiveTrip', \{ tripId, date: PRESENTATION_LIVE_DATE \}\)/);
  const panel = readFileSync('src/demo/PresentationPanel.tsx', 'utf8');
  assert.match(panel, /recompute\(tripId\);\s*L\.setPreset\(PRESENTATION_LIVE_PRESET\);\s*L\.setSpeed\(PRESENTATION_LIVE_SPEED\);\s*L\.start\(tripId, PRESENTATION_LIVE_DATE, 'sim'\);\s*L\.play\(\)/);
  assert.match(panel, /seedScenario\(seed\.until, \{ onProgress: setProgress, after: seed\.after \}\)/);
  assert.doesNotMatch(panel, /canRunStep/);
});
