import type { Member, Op, OpBody, Plan, Trip } from '../types';
import type { Clock, ExtractionProvider, IdGen, PlaceProvider, RouteProvider } from '../core/ports';
import { INVITE_TTL_MS, MEMBER_CAPACITY } from '../core/constants';
import { extractForMessage } from '../core/extract';
import { applyOp, validateOp } from '../core/ops';
import { buildPlan } from '../core/planner';
import { regionById } from '../data/regions';
import { SCENARIO_INVITE_CODE, SCENARIO_MEMBERS, SCENARIO_TRIP_INPUT, type ScenarioMemberKey } from '../data/scenario';
import { SCENARIO_DAYS } from '../data/scenario-tuning';
import { scenarioSteps } from './scenarioSteps';

/**
 * 시나리오 실행기(WP1 소유, 순수). 채팅 13줄 → 추출 → 사용자 조작 → buildPlan을 스토어 없이 돌린다.
 * golden-e2e 테스트와 시연(seedScenario)이 같은 순서표(scenarioSteps)를 돌아 같은 숫자를 본다.
 * RN 모듈을 import하지 않는다.
 *
 * - 시각: clock.now()를 t0로 한 번만 읽고, 단계마다 scenarioSteps가 정한 시각(줄 × 60초, 조작은 +초)을 op.at에 쓴다.
 * - 초대: trip/issueInvite(SCENARIO_INVITE_CODE)를 먼저 넣고 같은 코드로 member/join한다.
 * - validateOp가 거부하는 op는 조용히 건너뛰지 않고 이유와 함께 던진다. 골든이 깨질 때 원인이 보이게 하려는 것이다.
 */
export interface ScenarioDeps {
  ids: IdGen;
  clock: Clock;
  places: PlaceProvider;
  extraction: ExtractionProvider;
  routes: RouteProvider;
}

export async function runScenario(deps: ScenarioDeps): Promise<{ trip: Trip; ops: Op[]; plan: Plan }> {
  const t0 = deps.clock.now();
  const tripId = deps.ids.next('trip');
  const region = regionById(SCENARIO_TRIP_INPUT.region);
  if (!region) throw new Error(`시나리오 지역이 없다: ${SCENARIO_TRIP_INPUT.region}`);

  const ops: Op[] = [];
  const memberOf = new Map<ScenarioMemberKey, string>();
  let doc: Trip | undefined;
  let lastAt = t0;

  function push(actorId: string, at: number, body: OpBody): Op {
    const op = { ...body, id: deps.ids.next('op'), tripId, actorId, at, seq: ops.length + 1 } as Op;
    const v = validateOp(doc, op);
    if (!v.ok) throw new Error(`시나리오 op 거부: ${op.type} — ${v.reason}`);
    ops.push(op);
    doc = applyOp(doc, op);
    lastAt = at;
    return op;
  }

  function actor(key: ScenarioMemberKey): string {
    const id = memberOf.get(key);
    if (!id) throw new Error(`시나리오 멤버가 아직 합류하지 않았다: ${key}`);
    return id;
  }

  function newMember(key: ScenarioMemberKey, at: number): Member {
    const m = SCENARIO_MEMBERS.find((x) => x.key === key);
    if (!m) throw new Error(`시나리오 멤버가 없다: ${key}`);
    const member: Member = {
      id: deps.ids.next('m'),
      userId: deps.ids.next('u'),
      nickname: m.nickname,
      role: m.role,
      isGuest: m.isGuest,
      canInvite: false,
      joinedAt: at,
    };
    memberOf.set(key, member.id);
    return member;
  }

  for (const step of scenarioSteps(t0)) {
    switch (step.kind) {
      case 'create': {
        const host = newMember('minji', step.at);
        push(host.id, step.at, {
          type: 'trip/create',
          trip: {
            id: tripId,
            title: SCENARIO_TRIP_INPUT.title,
            region: SCENARIO_TRIP_INPUT.region,
            startDate: SCENARIO_TRIP_INPUT.startDate,
            endDate: SCENARIO_TRIP_INPUT.endDate,
            transport: SCENARIO_TRIP_INPUT.transport,
            dayStart: SCENARIO_TRIP_INPUT.dayStart,
            dayEnd: SCENARIO_TRIP_INPUT.dayEnd,
            days: SCENARIO_DAYS.map((d) => ({ ...d })),
            legs: [],
            members: [host],
            spots: [],
            messages: [],
            photos: [],
            visits: [],
            diaries: {},
            createdAt: step.at,
            createdBy: host.userId,
          },
        });
        break;
      }
      case 'issueInvite':
        push(actor('minji'), step.at, {
          type: 'trip/issueInvite',
          invite: {
            code: SCENARIO_INVITE_CODE,
            issuedAt: step.at,
            expiresAt: step.at + INVITE_TTL_MS,
            capacity: MEMBER_CAPACITY,
          },
        });
        break;
      case 'join': {
        const member = newMember(step.member, step.at);
        push(member.id, step.at, { type: 'member/join', member, inviteCode: SCENARIO_INVITE_CODE });
        break;
      }
      case 'chat': {
        const memberId = actor(step.from);
        const messageId = deps.ids.next('msg');
        push(memberId, step.at, { type: 'chat/send', message: { id: messageId, text: step.text } });
        const cur = doc as Trip;
        const r = await extractForMessage(
          cur,
          { id: messageId, text: step.text, memberId },
          { extraction: deps.extraction, places: deps.places, region, ids: deps.ids, at: step.at },
        );
        push(memberId, step.at, {
          type: 'spot/extracted',
          messageId,
          created: r.created,
          mergedSpotIds: r.mergedSpotIds,
          ambiguous: r.ambiguous,
          highlights: r.highlights,
        });
        break;
      }
      case 'action': {
        const a = step.action;
        const spot = (doc as Trip).spots.find((s) => s.placeId === a.placeId && !s.removedByUser);
        if (!spot) throw new Error(`시나리오 조작 대상 후보가 없다: ${a.placeId}(${a.afterLine}번 줄 뒤) — 추출 결과를 확인`);
        if (a.kind === 'pin') push(actor(a.by), step.at, { type: 'spot/pin', spotId: spot.id, pinned: true });
        else push(actor(a.by), step.at, { type: 'schedule/setDate', spotId: spot.id, date: a.date ?? null });
        break;
      }
    }
  }

  if (!doc) throw new Error('시나리오 여행방을 만들지 못했다');
  const plan = await buildPlan(doc, { routes: deps.routes, now: lastAt });
  return { trip: doc, ops, plan };
}
