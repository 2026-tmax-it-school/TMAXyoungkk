import { INVITE_TTL_MS, MEMBER_CAPACITY } from '../core/constants';
import { manualClock, offsetClock } from '../core/util';
import {
  SCENARIO_INVITE_CODE,
  SCENARIO_MEMBERS,
  SCENARIO_T0,
  SCENARIO_TRIP_INPUT,
  type ScenarioMemberKey,
} from '../data/scenario';
import { SCENARIO_DAYS } from '../data/scenario-tuning';
import { playScenarioChat } from '../features/chat/scenario';
import { clearSessionPhotos } from '../features/journal/api';
import { setClockOverride, systemClock } from '../services/clock';
import { getServices, resetServices } from '../services/registry';
import { useLive } from '../store/live';
import { useSession } from '../store/session';
import { useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import { scenarioSteps, stepsUntil, type ScenarioStage } from './scenarioSteps';

/**
 * 시연 도구(WP1 소유). 18 더보기 > 시연 도구가 쓴다.
 *
 * 시각 정책(계약 A7): seedScenario는 실제 날짜와 무관하게 SCENARIO_T0(2026-10-01 10:00 KST)부터 돈다.
 * 단계마다 scenarioSteps가 정한 시각으로 앱 시계를 맞추고(runScenario와 같은 op.at), 끝나면 마지막 단계
 * 시각에서 실제 속도로 흐르는 시계를 남긴다. 그래서 10/20 이후에 시연해도 편집 잠금에 걸리지 않는다.
 * setClockOverride(null)은 resetDemo만 부른다(시뮬레이터 stop·pause는 가상 시각을 유지한다).
 *
 * 단계 적용 책임: 순서표(scenarioSteps)는 여기와 runScenario가 같이 돈다. chat 단계는 playScenarioChat(WP3)이
 * 전송과 추출을 하고, 방 만들기·초대·합류·사용자 조작·추가 조작은 여기서 한다.
 * 실패한 단계(합류 거부, 조작 대상 후보 없음 등)는 건너뛰지 않고 모아서 끝에 앰버 토스트로 알린다.
 * resetDemo 뒤 seedScenario('all')을 두 번 돌려도 후보 14·확정 11·제외 3이 같다(같은 순서표, 같은 시각).
 * 리셋 없이 다시 채워도 같게, 시작할 때 이전 시나리오 방(같은 초대 코드 SCENARIO_INVITE_CODE를 가진 방)을 이 기기에서
 * 지운다. 남겨 두면 acceptInvite가 코드로 먼저 찾은 이전 방에 멤버가 합류해 새 방이 비게 된다.
 * 도중에 던지거나 시연 리셋이 끼어도 시계가 멈춘 채 남지 않게 한다: 끝(finally)에서 offsetClock을 남기되,
 * 그사이 resetDemo가 불렸으면(세대 번호가 바뀜) 아무것도 쓰지 않고 멈춘다(리셋을 되돌리지 않는다).
 */

export interface SeedProgress {
  done: number;
  total: number;
  label: string;
}

const STEP_LABEL: Record<string, string> = {
  create: '여행방 만드는 중',
  issueInvite: '초대 링크 발급 중',
  join: '멤버 합류 중',
  chat: '대화 보내는 중',
  action: '사용자 조작 적용 중',
};

/** resetDemo마다 늘어난다. 진행 중인 seedScenario는 세대가 바뀌면 멈춘다 */
let generation = 0;
let seedingNow = false;

/** 시나리오를 채우는 중인지(18이 리셋 버튼을 막는 데 쓴다) */
export function isSeeding(): boolean {
  return seedingNow;
}

export async function resetDemo(): Promise<void> {
  generation += 1;
  await resetServices();
  useTrips.getState().reset();
  useLive.getState().reset();
  useSession.getState().reset();
  useUi.getState().reset();
  clearSessionPhotos();
  setClockOverride(null);
}

function memberIdByKey(tripId: string, key: ScenarioMemberKey): string | undefined {
  const nickname = SCENARIO_MEMBERS.find((m) => m.key === key)?.nickname;
  const doc = useTrips.getState().docs[tripId];
  return doc?.members.find((m) => m.nickname === nickname && m.leftAt == null)?.id;
}

export async function seedScenario(
  until: ScenarioStage,
  opts: { onProgress?: (p: SeedProgress) => void } = {},
): Promise<string> {
  const gen = generation;
  const stale = () => gen !== generation;
  const clock = manualClock(SCENARIO_T0);
  const trips = () => useTrips.getState();
  let tripId = '';
  let lastAt = SCENARIO_T0;
  const failures: string[] = [];
  const steps = stepsUntil(scenarioSteps(SCENARIO_T0), until);

  // 이전 시나리오 방을 지운다(리셋 없이 두 번 채워도 같은 결과).
  for (const doc of Object.values(trips().docs)) {
    if (doc.invite?.code === SCENARIO_INVITE_CODE) trips().removeLocal(doc.id);
  }

  seedingNow = true;
  setClockOverride(clock);
  try {
    tripId = await runSteps();
  } finally {
    seedingNow = false;
    // 시연을 이어 가도록 마지막 단계 1초 뒤부터 실제 속도로 흐르는 시계를 남긴다. 리셋이 끼었으면 두지 않는다.
    if (!stale()) setClockOverride(offsetClock(lastAt + 1000, systemClock));
  }
  if (stale()) return '';

  if (tripId) useUi.getState().setCurrentTrip(tripId);
  if (failures.length > 0) useUi.getState().showToast(`시나리오 일부 단계를 건너뛰었습니다: ${failures.join(' / ')}`, 'warn');
  return tripId;

  async function runSteps(): Promise<string> {
    for (let i = 0; i < steps.length; i += 1) {
      if (stale()) return '';
      const step = steps[i];
      opts.onProgress?.({
        done: i,
        total: steps.length,
        label: step.kind === 'chat' ? `대화 ${step.line}번째 줄 보내는 중` : STEP_LABEL[step.kind],
      });
      clock.set(step.at);
      lastAt = step.at;
      switch (step.kind) {
        case 'create': {
          const session = useSession.getState();
          if (!session.session) session.createGuest(SCENARIO_TRIP_INPUT.hostNickname);
          tripId = trips().createTrip({
            title: SCENARIO_TRIP_INPUT.title,
            region: SCENARIO_TRIP_INPUT.region,
            startDate: SCENARIO_TRIP_INPUT.startDate,
            endDate: SCENARIO_TRIP_INPUT.endDate,
            transport: SCENARIO_TRIP_INPUT.transport,
            dayStart: SCENARIO_TRIP_INPUT.dayStart,
            dayEnd: SCENARIO_TRIP_INPUT.dayEnd,
            days: SCENARIO_DAYS.map((d) => ({ ...d })),
            hostNickname: SCENARIO_TRIP_INPUT.hostNickname,
          });
          break;
        }
        case 'issueInvite': {
          const r = trips().dispatch(tripId, {
            type: 'trip/issueInvite',
            invite: {
              code: SCENARIO_INVITE_CODE,
              issuedAt: step.at,
              expiresAt: step.at + INVITE_TTL_MS,
              capacity: MEMBER_CAPACITY,
            },
          });
          if (!r.ok) failures.push(`초대 링크 발급: ${r.reason}`);
          break;
        }
        case 'join': {
          const m = SCENARIO_MEMBERS.find((x) => x.key === step.member);
          if (!m) break;
          const r = await trips().acceptInvite(SCENARIO_INVITE_CODE, {
            userId: getServices().ids.next('u'),
            nickname: m.nickname,
            isGuest: m.isGuest,
          });
          if (!r.ok) failures.push(`${m.nickname} 합류: ${r.reason}`);
          break;
        }
        case 'chat':
          await playScenarioChat(tripId, { fromLine: step.line, toLine: step.line });
          break;
        case 'action': {
          const a = step.action;
          const actorId = memberIdByKey(tripId, a.by);
          const spot = trips().docs[tripId]?.spots.find((s) => s.placeId === a.placeId && !s.removedByUser);
          if (!actorId || !spot) {
            failures.push(`${a.afterLine}번 줄 뒤 조작: ${!actorId ? '멤버가 없음' : '대상 후보가 없음'}`);
            break;
          }
          const r =
            a.kind === 'pin'
              ? trips().dispatch(tripId, { type: 'spot/pin', spotId: spot.id, pinned: true }, { actorId })
              : trips().dispatch(tripId, { type: 'schedule/setDate', spotId: spot.id, date: a.date ?? null }, { actorId });
          if (!r.ok) failures.push(`${spot.name} 조작: ${r.reason}`);
          break;
        }
      }
      if (step.kind === 'create' && !tripId) {
        failures.push('여행방을 만들지 못했습니다');
        break;
      }
    }
    opts.onProgress?.({ done: steps.length, total: steps.length, label: '시나리오 준비 완료' });
    return tripId;
  }
}
