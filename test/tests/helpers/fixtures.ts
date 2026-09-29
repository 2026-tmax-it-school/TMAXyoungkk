import type { DayPlan, Member, Spot, Trip } from '../../src/types';
import { DEFAULT_STAY_MIN } from '../../src/core/constants';
import { toMin } from '../../src/core/util';
import {
  SCENARIO_T0,
  scenarioPlace,
  SCENARIO_EXPECTED,
  SCENARIO_MEMBERS,
  SCENARIO_TRIP_INPUT,
  SCENARIO_USER_ACTIONS,
  type ScenarioMemberKey,
} from '../../src/data/scenario';
import { SCENARIO_DAYS, SCENARIO_EXTRA_ACTIONS } from '../../src/data/scenario-tuning';

/**
 * 공용 픽스처. 시나리오 채팅을 돌리지 않고 '채팅과 사용자 조작이 끝난 뒤'의 여행방을 바로 만든다.
 * 후보 14곳의 장소 값은 동결 SCENARIO_PLACES, 제안자는 SCENARIO_EXPECTED, 날짜 설정은 SCENARIO_DAYS(WP4 튜닝)다.
 * 사용자 조작(교촌마을 한정식 고정·10/18 지정)과 추가 조작(SCENARIO_EXTRA_ACTIONS)을 반영한다.
 */

export { SCENARIO_T0 };

export function memberId(key: ScenarioMemberKey): string {
  return `m-${key}`;
}

export function scenarioMembers(): Member[] {
  return SCENARIO_MEMBERS.map((m, i) => ({
    id: memberId(m.key),
    userId: `u-${m.key}`,
    nickname: m.nickname,
    role: m.role,
    isGuest: m.isGuest,
    canInvite: false,
    joinedAt: SCENARIO_T0 + i * 60_000,
  }));
}

export function scenarioTrip(): Trip {
  const actions = [...SCENARIO_USER_ACTIONS, ...SCENARIO_EXTRA_ACTIONS];
  const spots: Spot[] = SCENARIO_EXPECTED.candidates.map((c) => {
    const place = scenarioPlace(c.placeId);
    const createdAt = SCENARIO_T0 + c.order * 60_000;
    const spot: Spot = {
      id: `s-${c.placeId}`,
      placeId: place.placeId,
      name: place.name,
      category: place.category,
      kind: place.kind,
      coord: place.coord,
      address: place.address,
      hours: place.hours,
      proposals: c.proposers.map((key, i) => ({
        memberId: memberId(key),
        source: 'chat' as const,
        messageId: `msg-${c.placeId}-${i}`,
        at: createdAt + i * 1000,
      })),
      pinned: false,
      stayMin: place.stayMin || DEFAULT_STAY_MIN[place.category],
      createdAt,
      edited: {},
    };
    for (const a of actions) {
      if (a.placeId !== c.placeId) continue;
      if (a.kind === 'pin') {
        spot.pinned = true;
        spot.edited.pinned = createdAt;
      }
      if (a.kind === 'setDate' && a.date) {
        spot.fixedDate = a.date;
        spot.edited.fixedDate = createdAt;
      }
    }
    return spot;
  });

  return {
    id: 'trip-scenario',
    title: SCENARIO_TRIP_INPUT.title,
    region: SCENARIO_TRIP_INPUT.region,
    startDate: SCENARIO_TRIP_INPUT.startDate,
    endDate: SCENARIO_TRIP_INPUT.endDate,
    transport: SCENARIO_TRIP_INPUT.transport,
    dayStart: SCENARIO_TRIP_INPUT.dayStart,
    dayEnd: SCENARIO_TRIP_INPUT.dayEnd,
    days: SCENARIO_DAYS.map((d) => ({ ...d })),
    legs: [],
    members: scenarioMembers(),
    spots,
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: SCENARIO_T0,
    createdBy: 'u-minji',
    lastSeq: 0,
  };
}

/** HANDOFF 10/18 타임라인 앞 세 곳으로 만든 DayPlan(화면·지도·실시간 테스트용) */
export function fixturePlan1018(): DayPlan {
  const base = scenarioPlace('gj-lahan-select');
  const items = SCENARIO_EXPECTED.timeline1018.map((t) => {
    const place = scenarioPlace(t.placeId);
    const c = SCENARIO_EXPECTED.candidates.find((x) => x.placeId === t.placeId);
    return {
      spotId: `s-${t.placeId}`,
      name: place.name,
      travelMin: t.travelMin,
      legTransport: 'car' as const,
      legEstimated: false,
      arrive: t.arrive,
      depart: t.depart,
      stayMin: toMin(t.depart) - toMin(t.arrive),
      pinned: !!c?.pinned,
      proposerCount: c?.proposers.length ?? 1,
      manual: false,
      notices: [],
    };
  });
  const startMin = toMin('09:00');
  const lastDepart = toMin(items[items.length - 1].depart);
  return {
    date: '2026-10-18',
    base: { name: base.name, coord: base.coord, placeId: base.placeId },
    baseSource: 'inherited',
    noReturn: false,
    startMin,
    endLimitMin: toMin('21:00'),
    items,
    returnMin: 20,
    usedMin: lastDepart + 20 - startMin,
    capacityMin: toMin('21:00') - startMin,
    overMin: 0,
    carryOver: [],
    orderMethod: 'exact',
  };
}
