import type { DaySetting, Transport } from '../types';
import { scenarioPlace, SCENARIO_BASE_PLACE_ID, type ScenarioAction } from './scenario';

/**
 * 시나리오 튜닝 손잡이(WP4 소유, 기반 작업 초안). 골든 수치를 맞추는 조정은 이 파일에서만 한다.
 * 알고리즘에 시나리오 분기를 넣지 않는다. export 이름은 바꾸지 않는다(tests/helpers/fixtures가 import한다).
 */

const base = scenarioPlace(SCENARIO_BASE_PLACE_ID);

/** 시내(도심) 스팟 */
const DOWNTOWN = [
  'gj-gyochon-hanjeongsik',
  'gj-hwangnidan',
  'gj-museum',
  'gj-daereungwon',
  'gj-cheomseongdae',
  'gj-cheomseongdae-cafe',
  'gj-woljeonggyo',
  'gj-daereungwon-wall',
  'gj-donggung',
];

function fromPlace(from: string, ids: string[], min: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[`${from}>${id}`] = min;
  return out;
}

function fromBase(ids: string[], min: number): Record<string, number> {
  return fromPlace(SCENARIO_BASE_PLACE_ID, ids, min);
}

/** 날짜별 설정 초안(01 부록 B1). 10/17 도착일 저녁, 10/18 종일, 10/19 출발일 오전·복귀 없음. */
export const SCENARIO_DAYS: DaySetting[] = [
  {
    date: '2026-10-17',
    base: { name: base.name, coord: base.coord, placeId: base.placeId },
    noReturn: false,
    dayStart: '18:00',
    dayEnd: '21:00',
  },
  { date: '2026-10-18', base: 'inherit', noReturn: false, dayStart: '09:00', dayEnd: '21:00' },
  { date: '2026-10-19', base: 'inherit', noReturn: true, dayStart: '09:00', dayEnd: '12:00' },
];

/**
 * 구간표(분). 키는 'fromPlaceId>toPlaceId'이고 방향마다 따로 적는다. null은 그 수단 경로 없음.
 * 여기에 없는 구간은 로컬 RouteProvider가 직선거리로 추정한다.
 * RouteProvider는 좌표만 받으므로 로컬 제공자는 SCENARIO_PLACES 좌표를 coordKey(소수 4자리)로 색인해
 * 좌표 → placeId로 이 표를 찾는다(계약 A11). 테스트 가짜 tableRoutes는 좌표 키라 키 체계가 다르다.
 * TODO(WP4) 기점→도심 스팟 26분 이상(불국사가 먼저 뽑히는 방향 조건) 등 골든에 맞춰 채운다.
 */
export const SCENARIO_ROUTE_TABLE: Record<Transport, Record<string, number | null>> = {
  car: {
    // 부록 B1 초안 그대로
    'gj-lahan-select>gj-bulguksa': 25,
    'gj-bulguksa>gj-seokguram': 12,
    'gj-seokguram>gj-gyochon-hanjeongsik': 20,
    'gj-lahan-select>gj-gameunsaji': 35,
    'gj-gameunsaji>gj-lahan-select': 35,
    // 반대 방향과 산길(토함산) 구간. 기점에서 불국사가 먼저 뽑히는 방향 조건
    'gj-lahan-select>gj-seokguram': 34,
    'gj-seokguram>gj-bulguksa': 12,
    'gj-seokguram>gj-lahan-select': 32,
    'gj-gyochon-hanjeongsik>gj-seokguram': 30,
    'gj-bulguksa>gj-gyochon-hanjeongsik': 28,
    // 기점 → 도심 스팟은 26분 이상(보문단지 → 시내 진입 정체, 부록 B1)
    ...fromBase(DOWNTOWN, 30),
    // 보문호·경주월드(보문단지) → 도심도 같은 정체 구간
    ...fromPlace('gj-bomunho', DOWNTOWN, 26),
    ...fromPlace('gj-gyeongjuworld', DOWNTOWN, 26),
    // 동궁과 월지와 황리단길·첨성대 카페거리: 대릉원 뒤편 일방통행과 주차 대기
    'gj-donggung>gj-hwangnidan': 12,
    'gj-hwangnidan>gj-donggung': 12,
    'gj-donggung>gj-lahan-select': 24,
    'gj-donggung>gj-cheomseongdae-cafe': 10,
    'gj-cheomseongdae-cafe>gj-donggung': 10,
  },
  walk: {},
  transit: {
    'gj-lahan-select>gj-gameunsaji': null,
    'gj-gameunsaji>gj-lahan-select': null,
  },
};

/** 대중교통 모의 모델 수치(2차). 도보 접근 + 배차 간격 절반 대기 + 승차 + 환승 벌점. */
export const SCENARIO_TRANSIT: {
  accessWalkMin: number;
  defaultHeadwayMin: number;
  transferPenaltyMin: number;
  /** 구간별 승차 시간·배차·환승 덮어쓰기 */
  legs: Record<string, { rideMin: number; headwayMin: number; transfers: number }>;
} = {
  accessWalkMin: 6,
  defaultHeadwayMin: 30,
  transferPenaltyMin: 10,
  legs: {
    'gj-bulguksa>gj-seokguram': { rideMin: 15, headwayMin: 40, transfers: 0 },
  },
};

/** 부록 B1의 '필요하면 추가 사용자 조작'. 예: 민지가 황리단길을 10/17로 지정. TODO(WP4) 필요 여부 확정 */
export const SCENARIO_EXTRA_ACTIONS: ScenarioAction[] = [
  { afterLine: 3, by: 'minji', kind: 'setDate', placeId: 'gj-hwangnidan', date: '2026-10-17' },
];
