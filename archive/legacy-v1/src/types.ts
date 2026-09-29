/**
 * 도메인 타입. 기능명세서 v0.2의 용어 정의를 그대로 따른다.
 * 용어: 여행방 / 그룹방 / 게스트 / 스팟 / 후보 / 확정 스팟 / 제외 스팟 / 고정 / 제안자 / 기점 / 루트 / 시간표 / 조정안
 */

export type Category = '식당' | '카페' | '관광지' | '쇼핑' | '공원' | '기타';

/** FR-504. 1단계는 도보와 자동차만. 대중교통은 2차. */
export type Transport = 'car' | 'walk';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Member {
  id: string;
  nickname: string;
  isHost: boolean;
  /** FR-105. 게스트는 기기 토큰으로만 식별한다. */
  isGuest: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  memberId: string;
  text: string;
  sentAt: number;
  /** 이 메시지에서 뽑아낸 후보 ID. FR-401 되돌리기에 쓴다. */
  extractedSpotIds: string[];
}

/** 후보. 확정/제외는 계산 결과이지 후보의 속성이 아니다(FR-403). */
export interface Spot {
  id: string;
  name: string;
  category: Category;
  coord: LatLng;
  address?: string;
  /** FR-402. 같은 장소는 하나로 합치고 제안자만 누적한다. */
  proposerIds: string[];
  /** 고정. 자동 제외 대상에서 빠진다. */
  pinned: boolean;
  /** 체류 시간(분). 기본값은 카테고리에서 온다. */
  stayMin: number;
  createdAt: number;
  /** 채팅에서 뽑은 경우 원문. FR-803에서 보여준다. */
  sourceText?: string;
  /** 사용자가 날짜를 직접 지정하면 고정 취급한다(FR-505). */
  fixedDate?: string;
  /** 사용자가 직접 뺀 후보. 자동 제외와 구분한다. */
  removedByUser?: boolean;
}

export interface Trip {
  id: string;
  title: string;
  region: string;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  /** FR-205 기점. 날짜별 기점은 프로토타입에서 단일 기점으로 단순화했다. */
  base: { name: string; coord: LatLng };
  transport: Transport;
  /** HH:MM. 하루 활동시간. 수용량 계산의 입력값이다. */
  dayStart: string;
  dayEnd: string;
  members: Member[];
  spots: Spot[];
  messages: ChatMessage[];
  invite?: { code: string; expiresAt: number; capacity: number };
  plan?: Plan;
  createdAt: number;
}

export interface TimetableItem {
  spotId: string;
  name: string;
  /** 직전 지점에서 이 스팟까지 이동 시간(분) */
  travelMin: number;
  /** HH:MM */
  arrive: string;
  depart: string;
  stayMin: number;
  pinned: boolean;
  proposerCount: number;
}

export interface DayPlan {
  date: string;
  items: TimetableItem[];
  /** 마지막 스팟에서 기점으로 돌아오는 시간(분) */
  returnMin: number;
  /** 기점 출발부터 기점 복귀까지 총 사용 시간(분) */
  usedMin: number;
  /** 그날 활동시간(분) */
  capacityMin: number;
}

export interface ExcludedSpot {
  spotId: string;
  name: string;
  /** 조용한 제외는 없다. 비기능 요구사항: 제외 이유 100% 표시. */
  reason: string;
  proposerCount: number;
}

export interface Plan {
  days: DayPlan[];
  excluded: ExcludedSpot[];
  /** 고정만으로 수용량을 넘긴 날짜. 사용자가 직접 빼야 한다(FR-403). */
  overCapacityDates: string[];
  computedAt: number;
  /** 이번 계산에서 쓴 경로 조회 횟수. 비기능 요구사항(재계산 1회당 100회 이하) 확인용. */
  routeCalls: number;
  /** 경로 API가 아니라 직선거리로 때운 구간이 있는지 */
  estimated: boolean;
}
