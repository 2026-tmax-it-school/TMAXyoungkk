import type { SimPresetId } from '../../types';

/**
 * 여행 시뮬레이터 프리셋 9종(WP5 소유). 실제로 경주를 돌아다닐 수 없어 2·3차 실시간 기능을 시각 가속 재생으로 보여준다.
 * 각 프리셋이 무엇을 시연하는지 한 줄로 적는다. 궤적은 generateTrack이 그날 시간표로 만든다.
 */

export interface SimPreset {
  id: SimPresetId;
  label: string;
  text: string;
  /** 시연하는 FR */
  fr: string;
}

export const SIM_PRESETS: SimPreset[] = [
  { id: 'normal', label: '정상', text: '시간표대로 움직입니다. 스팟마다 도착이 기록됩니다.', fr: 'FR-601·602' },
  { id: 'delay25', label: '지연 25분', text: '첫 스팟에서 25분 더 머뭅니다. 다음 스팟 조정안이 나옵니다.', fr: 'FR-603' },
  {
    id: 'closed',
    label: '영업 종료',
    text: '마감이 가장 가까운 스팟 바로 앞에서 오래 머뭅니다. 도착 예정이 영업 종료를 넘기면 그 스팟 빼기가 조정안 1순위로 나옵니다.',
    fr: 'FR-603',
  },
  { id: 'gpsShadow', label: 'GPS 음영', text: '두 번째 스팟으로 가는 길에 정확도가 떨어집니다. 음영 안내가 나오고 판정에서 빠집니다.', fr: 'FR-601·602' },
  { id: 'passBy', label: '지나침', text: '첫 스팟을 머물지 않고 지나칩니다. 다음 스팟에 도착하면 첫 스팟은 건너뜀입니다.', fr: 'FR-602' },
  { id: 'nextDoor', label: '옆 건물', text: '첫 스팟 120m 옆 건물에서 5분 머문 뒤 들어갑니다. 옆 건물은 도착이 아닙니다.', fr: 'FR-602' },
  { id: 'denied', label: '권한 거부', text: '위치 권한이 없습니다. 수동 진행 모드에서 도착 처리 버튼으로 진행합니다.', fr: 'FR-601' },
  { id: 'freeTime', label: '빈 시간', text: '첫 스팟을 30분 만에 나섭니다. 다음 일정까지 남는 시간에 주변을 추천합니다.', fr: 'FR-604' },
  {
    id: 'full1018',
    label: '10/18 종합',
    text: '불국사 도착, 석굴암 구간 지연 조정안, 점심 뒤 빈 시간 추천, 사진 이벤트가 이어집니다.',
    fr: 'FR-601~604·701',
  },
];

export function presetById(id: SimPresetId): SimPreset {
  return SIM_PRESETS.find((p) => p.id === id) ?? SIM_PRESETS[0];
}

/** 프리셋마다 고정 시드. 같은 시드면 같은 궤적과 같은 이벤트 열이 나온다. */
export const PRESET_SEED: Record<SimPresetId, number> = {
  normal: 11,
  delay25: 12,
  closed: 13,
  gpsShadow: 14,
  passBy: 15,
  nextDoor: 16,
  denied: 17,
  freeTime: 18,
  full1018: 1018,
};

/** 가상 시각 배속 */
export const SIM_SPEEDS = [1, 10, 60, 300] as const;
