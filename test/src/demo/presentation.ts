import { SCENARIO_DAYS } from '../data/scenario-tuning';
import type { SimPresetId } from '../types';
import type { SimSpeed } from '../core/sim/clock';
import type { ScenarioStage } from './scenarioSteps';

/**
 * 발표 시나리오(시연 도구, 관리자 전용). 발표 슬라이드 'Young Trip 직접 써 보기' 4단계를 순서대로 눌러 가며 보여 준다.
 * 1·2단계는 경주 시나리오 순서표(scenarioSteps)를 두 번에 나눠 돌리고, 3·4단계는 화면을 열고(4단계는 시뮬레이터 재생)만 한다.
 * 순수 정의만 둔다(화면 이동과 실행은 PresentationPanel이 한다).
 */
export type PresentationStepKey = 'collect' | 'select' | 'schedule' | 'live';

export interface PresentationStep {
  key: PresentationStepKey;
  /** 슬라이드 카드 제목 */
  title: string;
  /** 슬라이드 카드 설명 */
  sub: string;
  /** 시나리오 순서표를 돌리는 단계면 어디까지(until)와 어디서부터(after) */
  seed?: { until: ScenarioStage; after?: ScenarioStage };
}

export const PRESENTATION_STEPS: readonly PresentationStep[] = [
  { key: 'collect', title: '채팅으로 담기', sub: '메시지 속 장소가 바로 후보로', seed: { until: 'collect' } },
  { key: 'select', title: '자동 선별', sub: '좋아요가 모이면 고정, 넘치면 제외', seed: { until: 'all', after: 'collect' } },
  { key: 'schedule', title: '시간표와 루트', sub: '날짜별 방문 순서와 이동 시간' },
  { key: 'live', title: '여행 진행', sub: '도착 기록과 늦을 때 조정안' },
];

/**
 * 4단계(여행 진행) 시뮬레이터 설정. 슬라이드 '도착 기록과 늦을 때 조정안'을 그대로 보이려고 '지연 25분'(첫 스팟에서 25분 더 머물고
 * 다음 스팟 조정안이 나온다)을 300배속으로 돌린다. 약 20초면 도착 기록과 조정안이 나온다.
 */
export const PRESENTATION_LIVE_PRESET: SimPresetId = 'delay25';
export const PRESENTATION_LIVE_SPEED: SimSpeed = 300;

/** 4단계(여행 진행)를 시작할 날짜: 시나리오 첫날 */
export const PRESENTATION_LIVE_DATE: string = SCENARIO_DAYS[0].date;

/**
 * n번째(0부터) 단계를 누를 때 먼저 채워야 하는 시나리오 단계. seeded는 지금까지 채운 단계 수(0 없음, 1 담기까지, 2 선별까지).
 * 1단계는 언제나 처음부터 다시 채운다. 그 뒤 단계는 비어 있는 앞 단계를 알아서 채워서 어느 단계든 바로 누를 수 있다
 * (시나리오 채우기처럼 4단계만 눌러도 1~3단계가 채워진다).
 */
export function seedsNeeded(index: number, seeded: number): ('collect' | 'select')[] {
  if (index === 0) return ['collect'];
  if (seeded <= 0) return ['collect', 'select'];
  if (seeded === 1) return ['select'];
  return [];
}
