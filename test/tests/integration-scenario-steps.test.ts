import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCENARIO_CHAT,
  SCENARIO_LATE_JOIN,
  SCENARIO_LINE_MS,
  SCENARIO_T0,
  SCENARIO_USER_ACTIONS,
} from '../src/data/scenario';
import { SCENARIO_EXTRA_ACTIONS } from '../src/data/scenario-tuning';
import { scenarioSteps, stepsUntil } from '../src/demo/scenarioSteps';
import { isEditLocked } from '../src/core/ops';

/**
 * 시나리오 순서표(통합 소유 테스트, 03 회의 결정). 시연(seedScenario)과 골든(runScenario)이 같은 표를 돈다.
 * 패키지 경계를 넘는 보장이라 wp1 테스트가 아니라 통합 테스트로 둔다.
 */

const steps = scenarioSteps(SCENARIO_T0);

test('단계 시각은 엄격히 증가한다(같은 등록 시각이 없어 FR-403 동점이 id 비교로 가지 않는다)', () => {
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i].at > steps[i - 1].at, `${i}번째 단계 ${steps[i].kind}`);
  }
});

test('채팅 줄 시각은 t0 + 줄 번호 × 60초다', () => {
  const chats = steps.filter((s) => s.kind === 'chat');
  assert.equal(chats.length, SCENARIO_CHAT.length);
  for (const c of chats) if (c.kind === 'chat') assert.equal(c.at, SCENARIO_T0 + c.line * SCENARIO_LINE_MS);
});

test('방 만들기 → 초대 → 준호·수아 합류가 채팅보다 먼저다', () => {
  assert.deepEqual(
    steps.slice(0, 4).map((s) => (s.kind === 'join' ? `join:${s.member}` : s.kind)),
    ['create', 'issueInvite', 'join:junho', 'join:sua'],
  );
});

test('사용자 조작과 추가 조작은 전부 한 번씩, 정해진 줄 바로 뒤에 온다', () => {
  const all = [...SCENARIO_USER_ACTIONS, ...SCENARIO_EXTRA_ACTIONS];
  const acts = steps.filter((s) => s.kind === 'action');
  assert.equal(acts.length, all.length);
  for (const a of acts) {
    if (a.kind !== 'action') continue;
    const i = steps.indexOf(a);
    const prevChat = [...steps.slice(0, i)].reverse().find((s) => s.kind === 'chat');
    assert.equal(prevChat?.kind === 'chat' ? prevChat.line : -1, a.action.afterLine);
  }
});

test('지우는 11번 줄 뒤, 12번 줄 앞에 합류한다', () => {
  const i = steps.findIndex((s) => s.kind === 'join' && s.member === SCENARIO_LATE_JOIN.member);
  const prev = steps.slice(0, i).filter((s) => s.kind === 'chat').pop();
  const next = steps.slice(i).find((s) => s.kind === 'chat');
  assert.equal(prev?.kind === 'chat' && prev.line, SCENARIO_LATE_JOIN.afterLine);
  assert.equal(next?.kind === 'chat' && next.line, SCENARIO_LATE_JOIN.afterLine + 1);
});

test("stepsUntil: 'chat'은 지우 합류 직전까지, 'members'는 채팅 전까지다", () => {
  assert.equal(stepsUntil(steps, 'trip').length, 1);
  assert.equal(stepsUntil(steps, 'members').length, 4);
  assert.equal(stepsUntil(steps, 'chat').some((s) => s.kind === 'join' && s.member === 'jiwoo'), false);
  assert.equal(stepsUntil(steps, 'all').length, steps.length);
});

test('시나리오 시각은 모두 여행 종료 전이라 편집 잠금에 걸리지 않는다(실제 날짜와 무관)', () => {
  for (const s of steps) assert.equal(isEditLocked({ endDate: '2026-10-19' }, s.at), false);
});
