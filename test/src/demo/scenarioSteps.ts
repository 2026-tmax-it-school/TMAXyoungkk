import {
  SCENARIO_CHAT,
  SCENARIO_LATE_JOIN,
  SCENARIO_LINE_MS,
  SCENARIO_MEMBERS,
  SCENARIO_USER_ACTIONS,
  type ScenarioAction,
  type ScenarioMemberKey,
} from '../data/scenario';
import { SCENARIO_EXTRA_ACTIONS } from '../data/scenario-tuning';

/**
 * 시나리오 순서표(WP1 소유, 순수). 시연(seedScenario)과 골든 테스트(runScenario)가 이 표 하나로 같은 순서를 재현한다.
 * playScenarioChat(WP3)은 chat 단계의 전송과 추출만 한다. 나머지 단계(방 만들기, 초대, 합류, 사용자 조작,
 * 추가 조작, 지우 합류)는 이 표를 도는 쪽(WP1)이 적용한다.
 *
 * 시각 규칙: chat 단계는 t0 + 줄 번호 × 60초, 줄 뒤에 붙는 단계(조작·합류)는 그 줄 시각 + 순서(초)다.
 * 채팅 전 단계(방 만들기·초대·첫 합류)는 t0 + 순서(초)다. 같은 시각이 없어서 FR-403 동점 규칙
 * ('등록 늦은 순')이 id 비교까지 가지 않는다.
 */

export type ScenarioStep =
  | { kind: 'create'; at: number }
  | { kind: 'issueInvite'; at: number }
  | { kind: 'join'; member: ScenarioMemberKey; at: number }
  | { kind: 'chat'; line: number; from: ScenarioMemberKey; text: string; at: number }
  | { kind: 'action'; action: ScenarioAction; at: number };

export type ScenarioStage = 'trip' | 'members' | 'chat' | 'all';

const SEC = 1000;

export function scenarioSteps(t0: number): ScenarioStep[] {
  const steps: ScenarioStep[] = [];
  let k = 0;
  const before = () => t0 + k++ * SEC;
  steps.push({ kind: 'create', at: before() });
  steps.push({ kind: 'issueInvite', at: before() });
  for (const m of SCENARIO_MEMBERS.filter((x) => x.joinedBy === 'invite')) {
    steps.push({ kind: 'join', member: m.key, at: before() });
  }

  const actions = [...SCENARIO_USER_ACTIONS, ...SCENARIO_EXTRA_ACTIONS];
  for (const line of SCENARIO_CHAT) {
    const lineAt = t0 + line.line * SCENARIO_LINE_MS;
    steps.push({ kind: 'chat', line: line.line, from: line.from, text: line.text, at: lineAt });
    let n = 0;
    for (const a of actions.filter((x) => x.afterLine === line.line)) {
      n += 1;
      steps.push({ kind: 'action', action: a, at: lineAt + n * SEC });
    }
    if (SCENARIO_LATE_JOIN.afterLine === line.line) {
      n += 1;
      steps.push({ kind: 'join', member: SCENARIO_LATE_JOIN.member, at: lineAt + n * SEC });
    }
  }
  return steps;
}

/**
 * seedScenario 단계별로 어디까지 돌리는지. 'trip'은 방까지, 'members'는 초대 합류까지,
 * 'chat'은 지우 합류 직전 줄까지(조작 포함), 'all'은 13줄 끝까지다.
 */
export function stepsUntil(steps: ScenarioStep[], until: ScenarioStage): ScenarioStep[] {
  if (until === 'all') return steps;
  if (until === 'trip') return steps.filter((s) => s.kind === 'create');
  if (until === 'members') {
    return steps.filter(
      (s) =>
        s.kind === 'create' ||
        s.kind === 'issueInvite' ||
        (s.kind === 'join' && s.member !== SCENARIO_LATE_JOIN.member),
    );
  }
  const cut = steps.findIndex((s) => s.kind === 'join' && s.member === SCENARIO_LATE_JOIN.member);
  return cut < 0 ? steps : steps.slice(0, cut);
}
