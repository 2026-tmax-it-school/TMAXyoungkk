import { SCENARIO_CHAT, SCENARIO_MEMBERS } from '../../data/scenario';
import { useTrips } from '../../store/trips';
import { sendChatMessage } from './send';

/**
 * 시나리오 대화 재생(WP3 소유). 05 헤더 메뉴와 시연 도구(seedScenario)가 쓴다.
 * 책임은 chat 단계뿐이다: fromLine~toLine 줄을 chat/send로 보내고 추출(spot/extracted)까지 한다.
 * 사용자 조작(SCENARIO_USER_ACTIONS), 추가 조작(SCENARIO_EXTRA_ACTIONS), 지우 합류는 여기서 하지 않는다.
 * 그 순서는 demo/scenarioSteps(WP1)가 정하고 seedScenario와 runScenario가 적용한다(계약 A7).
 * 아직 합류하지 않은 멤버의 줄은 건너뛴다. 시각은 앱 시계(appClock)를 그대로 쓴다.
 * 돌려주는 값은 보낸 줄 수다. 05 화면이 '합류하지 않은 멤버의 줄은 건너뛰었다'를 안내할 때 쓴다.
 */
export async function playScenarioChat(
  tripId: string,
  opts: { fromLine?: number; toLine?: number } = {},
): Promise<number> {
  const from = opts.fromLine ?? 1;
  const to = opts.toLine ?? SCENARIO_CHAT.length;
  let sent = 0;
  for (const line of SCENARIO_CHAT) {
    if (line.line < from || line.line > to) continue;
    const doc = useTrips.getState().docs[tripId];
    if (!doc) return sent;
    const nickname = SCENARIO_MEMBERS.find((m) => m.key === line.from)?.nickname;
    const member = doc.members.find((m) => m.nickname === nickname && m.leftAt == null);
    if (!member) continue;
    const r = await sendChatMessage(tripId, line.text, { actorId: member.id });
    if (r.ok) sent += 1;
  }
  return sent;
}
