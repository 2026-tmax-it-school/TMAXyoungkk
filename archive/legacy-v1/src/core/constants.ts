import type { Category, Transport } from '../types';

/** 체류 시간 기본값(분). 기능명세서 FR-500 절의 표와 같다. */
export const DEFAULT_STAY_MIN: Record<Category, number> = {
  식당: 60,
  카페: 40,
  관광지: 90,
  쇼핑: 60,
  공원: 45,
  기타: 60,
};

/** 하루 기본 활동시간. 수용량은 이 값에서 이동 시간을 뺀 값이다. */
export const DEFAULT_DAY_START = '09:00';
export const DEFAULT_DAY_END = '21:00';

/**
 * 경로 API가 실패했을 때 쓰는 직선거리 기준 속도(km/h).
 * FR-501 예외 처리: "경로 API 실패 시 직선거리 기준".
 */
export const FALLBACK_SPEED_KMH: Record<Transport, number> = {
  car: 34,
  walk: 4.2,
};

/** 직선거리를 실제 도로 거리로 보정하는 계수. */
export const DETOUR_FACTOR: Record<Transport, number> = {
  car: 1.35,
  walk: 1.25,
};

export const TRANSPORT_LABEL: Record<Transport, string> = {
  car: '자동차',
  walk: '도보',
};

/** 비기능 요구사항: 루트 재계산 1회당 경로 API 호출 100회 이하. */
export const ROUTE_CALL_BUDGET = 100;

/** 비기능 요구사항: 동일 구간 결과는 24시간 캐시. */
export const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** FR-105: 게스트 토큰 유효기간 30일, 사용할 때마다 갱신. */
export const GUEST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** FR-301: 초대 링크 기본 7일 유효, 정원 6명. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEMBER_CAPACITY = 6;

/** FR-201: 기간 14일 초과 시 확인. */
export const MAX_TRIP_DAYS = 14;
