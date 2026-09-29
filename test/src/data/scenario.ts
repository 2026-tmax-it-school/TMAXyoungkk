import type { Category, ExcludeReasonCode, Place, Transport } from '../types';
import { atKst } from '../core/util';

/**
 * 시연·테스트 공용 시나리오(01 회의록 부록 B). 동결 파일이다. 기반 작업과 통합 담당만 고친다.
 *
 * 경주 2박 3일, 2026-10-17 ~ 10-19, 주 이동수단 자동차, 멤버 4명(민지 방장, 준호·수아 초대 합류, 지우 나중 합류).
 * 기점은 라한셀렉트 경주. 후보 14곳 → 확정 11곳, 제외 3곳.
 *
 * - 14곳과 기점의 placeId·이름·좌표·카테고리·영업시간·체류는 여기만 정한다.
 *   data/places.ts(WP3)는 이것을 가져다 쓰고 별칭·주변 장소·태그·인기도만 더한다.
 * - 날짜별 설정, 구간표, 대중교통 모의 수치, 추가 조작은 data/scenario-tuning.ts(WP4)에서 튜닝한다.
 * - 좌표는 프로토타입 근사값, 영업시간은 예시 데이터다.
 * - HANDOFF의 요일 표기 '(금)~(일)'은 2025년 달력 기준이다. 2026-10-17은 토요일이라 화면 요일은 계산값을 쓴다.
 */

/**
 * 시나리오 시작 시각(2026-10-01 10:00 KST). 여행 3주 전이라 편집 잠금에 걸리지 않는다.
 * runScenario와 seedScenario가 모두 이 시각을 기준으로 줄마다 +60초씩 시각을 찍는다(실제 날짜와 무관).
 */
export const SCENARIO_T0 = atKst('2026-10-01', '10:00');

/** 시나리오 한 줄(또는 조작)마다 늘리는 시각 */
export const SCENARIO_LINE_MS = 60_000;

/** 시나리오 초대 코드(Crockford base32 8자). runScenario·seedScenario가 trip/issueInvite로 먼저 발급한다. */
export const SCENARIO_INVITE_CODE = 'SCNR-2026';

export type ScenarioMemberKey = 'minji' | 'junho' | 'sua' | 'jiwoo';

export interface ScenarioPlace extends Place {
  /** 카테고리 기본 체류(분). 사용자 값이 없을 때 쓴다. */
  stayMin: number;
  role: 'spot' | 'base';
}

function p(
  placeId: string,
  name: string,
  latitude: number,
  longitude: number,
  category: Category,
  kind: string,
  stayMin: number,
  extra: Partial<Pick<Place, 'address' | 'hours'>> = {},
  role: 'spot' | 'base' = 'spot',
): ScenarioPlace {
  return { placeId, name, coord: { latitude, longitude }, category, kind, stayMin, role, ...extra };
}

/** 후보 14곳(등록 순서 = 첫 언급 순서)과 기점 후보 2곳 */
export const SCENARIO_PLACES: ScenarioPlace[] = [
  p('gj-bulguksa', '불국사', 35.7901, 129.332, '관광지', '사찰', 90, {
    address: '경상북도 경주시 불국로 385',
    hours: { open: '09:00', close: '18:00' },
  }),
  p('gj-seokguram', '석굴암', 35.7948, 129.3491, '관광지', '사찰', 90, {
    address: '경상북도 경주시 불국로 873-243',
    hours: { open: '09:00', close: '17:30' },
  }),
  p('gj-gyochon-hanjeongsik', '교촌마을 한정식', 35.8296, 129.2148, '식당', '한정식', 60, {
    address: '경상북도 경주시 교동 (예시)',
    hours: { open: '11:30', close: '21:00' },
  }),
  p('gj-hwangnidan', '황리단길', 35.8375, 129.2097, '쇼핑', '거리', 60, {
    address: '경상북도 경주시 황남동 포석로 일대',
    hours: { open: '10:00', close: '22:00' },
  }),
  p('gj-museum', '국립경주박물관', 35.8292, 129.2281, '관광지', '전시', 90, {
    address: '경상북도 경주시 일정로 186',
    hours: { open: '10:00', close: '18:00' },
  }),
  p('gj-daereungwon', '대릉원', 35.8383, 129.2118, '관광지', '고분', 90, {
    address: '경상북도 경주시 황남동',
    hours: { open: '09:00', close: '22:00' },
  }),
  p('gj-cheomseongdae', '첨성대', 35.8347, 129.219, '관광지', '유적', 90, {
    address: '경상북도 경주시 인왕동',
    hours: { open: '09:00', close: '22:00' },
  }),
  p('gj-cheomseongdae-cafe', '첨성대 카페거리', 35.8357, 129.2152, '카페', '카페거리', 40, {
    hours: { open: '10:00', close: '22:00' },
  }),
  p('gj-woljeonggyo', '월정교', 35.8292, 129.2178, '관광지', '다리', 90, {
    address: '경상북도 경주시 교동',
    hours: { open: '09:00', close: '22:00' },
  }),
  p('gj-bomunho', '보문호', 35.8436, 129.2876, '공원', '산책', 45, {
    address: '경상북도 경주시 보문로 일대',
  }),
  p('gj-gyeongjuworld', '경주월드', 35.8367, 129.2823, '관광지', '놀이공원', 90, {
    address: '경상북도 경주시 보문로 544',
    hours: { open: '09:30', close: '18:00' },
  }),
  p('gj-daereungwon-wall', '대릉원 돌담길', 35.8366, 129.213, '공원', '산책', 45),
  p('gj-gameunsaji', '감은사지 삼층석탑', 35.7446, 129.4838, '관광지', '유적', 90, {
    address: '경상북도 경주시 문무대왕면 용당리',
  }),
  p('gj-donggung', '동궁과 월지', 35.8349, 129.2266, '관광지', '유적', 90, {
    address: '경상북도 경주시 원화로 102',
    hours: { open: '09:00', close: '22:00' },
  }),
  p(
    'gj-lahan-select',
    '라한셀렉트 경주',
    35.8413,
    129.2862,
    '기타',
    '숙소',
    0,
    { address: '경상북도 경주시 보문로 338' },
    'base',
  ),
  p(
    'gj-station',
    '경주역',
    35.7983,
    129.1395,
    '기타',
    '역',
    0,
    { address: '경상북도 경주시 건천읍 신경주역로 80' },
    'base',
  ),
];

export function scenarioPlace(placeId: string): ScenarioPlace {
  const found = SCENARIO_PLACES.find((x) => x.placeId === placeId);
  if (!found) throw new Error(`시나리오 장소가 없다: ${placeId}`);
  return found;
}

export const SCENARIO_BASE_PLACE_ID = 'gj-lahan-select';

/** 여행방 만들기 입력. 날짜별 설정(days)은 scenario-tuning.ts의 SCENARIO_DAYS에서 온다. */
export const SCENARIO_TRIP_INPUT: {
  title: string;
  region: string;
  startDate: string;
  endDate: string;
  transport: Transport;
  dayStart: string;
  dayEnd: string;
  hostNickname: string;
  basePlaceId: string;
} = {
  title: '경주 2박 3일',
  region: 'gyeongju',
  startDate: '2026-10-17',
  endDate: '2026-10-19',
  transport: 'car',
  dayStart: '09:00',
  dayEnd: '21:00',
  hostNickname: '민지',
  basePlaceId: SCENARIO_BASE_PLACE_ID,
};

export interface ScenarioMember {
  key: ScenarioMemberKey;
  nickname: string;
  role: 'host' | 'member';
  isGuest: boolean;
  /** create: 방을 만든 사람, invite: 채팅 전에 초대로 합류, late: 대화 중간에 02로 합류 */
  joinedBy: 'create' | 'invite' | 'late';
}

export const SCENARIO_MEMBERS: ScenarioMember[] = [
  { key: 'minji', nickname: '민지', role: 'host', isGuest: true, joinedBy: 'create' },
  { key: 'junho', nickname: '준호', role: 'member', isGuest: true, joinedBy: 'invite' },
  { key: 'sua', nickname: '수아', role: 'member', isGuest: true, joinedBy: 'invite' },
  { key: 'jiwoo', nickname: '지우', role: 'member', isGuest: true, joinedBy: 'late' },
];

export interface ScenarioChatLine {
  line: number;
  from: ScenarioMemberKey;
  text: string;
}

/** 채팅 13줄. 순서 고정. */
export const SCENARIO_CHAT: ScenarioChatLine[] = [
  { line: 1, from: 'junho', text: '둘째 날 오전은 불국사 갔다가 석굴암 올라가자' },
  { line: 2, from: 'sua', text: '점심은 교촌마을 한정식 예약해뒀어. 여긴 시간 못 바꿔' },
  { line: 3, from: 'minji', text: '좋다. 첫날 저녁은 황리단길 어때?' },
  { line: 4, from: 'sua', text: '나도 불국사랑 석굴암 찬성. 황리단길도 좋아' },
  { line: 5, from: 'junho', text: '황리단길 가면 국립경주박물관도 들르자' },
  { line: 6, from: 'sua', text: '대릉원이랑 첨성대도 보고 싶어' },
  { line: 7, from: 'minji', text: '불국사는 나도 꼭. 대릉원도 찬성이고 경주박물관도 좋아' },
  { line: 8, from: 'sua', text: '첨성대 카페거리에서 커피 한잔하고 월정교까지 걷자' },
  { line: 9, from: 'junho', text: '마지막 날은 숙소 근처 보문호 산책하고 경주월드 가자' },
  { line: 10, from: 'minji', text: '대릉원 돌담길 걷는 것도 좋대' },
  { line: 11, from: 'junho', text: '감은사지 삼층석탑도 가보고 싶은데 멀려나' },
  { line: 12, from: 'jiwoo', text: '나 왔어! 황리단길 나도 좋아. 첨성대도 가자' },
  { line: 13, from: 'jiwoo', text: '동궁과 월지 야경 유명하대' },
];

/** 채팅 사이에 끼는 사용자 조작. spotId는 실행 때 생기므로 placeId로 가리킨다. */
export interface ScenarioAction {
  /** 이 줄을 보낸 직후에 한다 */
  afterLine: number;
  by: ScenarioMemberKey;
  kind: 'pin' | 'setDate';
  placeId: string;
  /** setDate일 때 'YYYY-MM-DD' */
  date?: string;
}

/**
 * 교촌마을 한정식 고정은 추출 규칙이 아니라 수아의 조작으로 재현한다(FR-401 출력에 고정이 없다).
 */
export const SCENARIO_USER_ACTIONS: ScenarioAction[] = [
  { afterLine: 2, by: 'sua', kind: 'pin', placeId: 'gj-gyochon-hanjeongsik' },
  { afterLine: 2, by: 'sua', kind: 'setDate', placeId: 'gj-gyochon-hanjeongsik', date: '2026-10-18' },
];

/** 지우는 11번 문장 뒤, 12번 문장 앞에 초대 링크(02)로 게스트 합류한다. */
export const SCENARIO_LATE_JOIN: { member: ScenarioMemberKey; afterLine: number } = {
  member: 'jiwoo',
  afterLine: 11,
};

export interface ScenarioExpectedCandidate {
  order: number;
  placeId: string;
  name: string;
  category: Category;
  stayMin: number;
  /** 첫 언급 순서의 제안자 */
  proposers: ScenarioMemberKey[];
  result: 'confirmed' | 'excluded';
  pinned?: boolean;
  date?: string;
  arrive?: string;
  depart?: string;
  reasonCode?: ExcludeReasonCode;
  reason?: string;
  nearestDate?: string;
}

/** 골든 수치(01 부록 B3, HANDOFF). 정확 일치 항목만 적는다. */
export const SCENARIO_EXPECTED: {
  totals: { candidates: number; confirmed: number; excluded: number };
  candidates: ScenarioExpectedCandidate[];
  /** 10/18 앞 세 곳. travelMin은 직전 지점에서 온 분 */
  timeline1018: { placeId: string; arrive: string; depart: string; travelMin: number }[];
  day1018: { date: string; start: string; count: number; endBy: string };
} = {
  totals: { candidates: 14, confirmed: 11, excluded: 3 },
  candidates: [
    { order: 1, placeId: 'gj-bulguksa', name: '불국사', category: '관광지', stayMin: 90, proposers: ['junho', 'sua', 'minji'], result: 'confirmed', date: '2026-10-18', arrive: '09:25', depart: '10:55' },
    { order: 2, placeId: 'gj-seokguram', name: '석굴암', category: '관광지', stayMin: 90, proposers: ['junho', 'sua'], result: 'confirmed', date: '2026-10-18', arrive: '11:07', depart: '12:37' },
    { order: 3, placeId: 'gj-gyochon-hanjeongsik', name: '교촌마을 한정식', category: '식당', stayMin: 60, proposers: ['sua'], result: 'confirmed', pinned: true, date: '2026-10-18', arrive: '12:57', depart: '13:57' },
    { order: 4, placeId: 'gj-hwangnidan', name: '황리단길', category: '쇼핑', stayMin: 60, proposers: ['minji', 'sua', 'junho', 'jiwoo'], result: 'confirmed', date: '2026-10-17' },
    { order: 5, placeId: 'gj-museum', name: '국립경주박물관', category: '관광지', stayMin: 90, proposers: ['junho', 'minji'], result: 'confirmed' },
    { order: 6, placeId: 'gj-daereungwon', name: '대릉원', category: '관광지', stayMin: 90, proposers: ['sua', 'minji'], result: 'confirmed' },
    { order: 7, placeId: 'gj-cheomseongdae', name: '첨성대', category: '관광지', stayMin: 90, proposers: ['sua', 'jiwoo'], result: 'confirmed' },
    { order: 8, placeId: 'gj-cheomseongdae-cafe', name: '첨성대 카페거리', category: '카페', stayMin: 40, proposers: ['sua'], result: 'confirmed' },
    { order: 9, placeId: 'gj-woljeonggyo', name: '월정교', category: '관광지', stayMin: 90, proposers: ['sua'], result: 'confirmed' },
    { order: 10, placeId: 'gj-bomunho', name: '보문호', category: '공원', stayMin: 45, proposers: ['junho'], result: 'confirmed' },
    { order: 11, placeId: 'gj-gyeongjuworld', name: '경주월드', category: '관광지', stayMin: 90, proposers: ['junho'], result: 'confirmed' },
    { order: 12, placeId: 'gj-daereungwon-wall', name: '대릉원 돌담길', category: '공원', stayMin: 45, proposers: ['minji'], result: 'excluded', reasonCode: 'dayFull', reason: '10/17이 꽉 차서', nearestDate: '2026-10-17' },
    { order: 13, placeId: 'gj-gameunsaji', name: '감은사지 삼층석탑', category: '관광지', stayMin: 90, proposers: ['junho'], result: 'excluded', reasonCode: 'tooFar', reason: '왕복 1시간 10분' },
    { order: 14, placeId: 'gj-donggung', name: '동궁과 월지', category: '관광지', stayMin: 90, proposers: ['jiwoo'], result: 'excluded', reasonCode: 'dayFull', reason: '10/18 저녁이 꽉 차서', nearestDate: '2026-10-18' },
  ],
  timeline1018: [
    { placeId: 'gj-bulguksa', arrive: '09:25', depart: '10:55', travelMin: 25 },
    { placeId: 'gj-seokguram', arrive: '11:07', depart: '12:37', travelMin: 12 },
    { placeId: 'gj-gyochon-hanjeongsik', arrive: '12:57', depart: '13:57', travelMin: 20 },
  ],
  day1018: { date: '2026-10-18', start: '09:00', count: 7, endBy: '21:00' },
};
