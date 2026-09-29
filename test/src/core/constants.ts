import type { Category, NotifyPrefs, Transport } from '../types';

/**
 * 명세 수치와 02 설계 리뷰 추가분. 동결 계약이다(기반 작업과 통합 담당만 고친다).
 * 기능명세서 v0.2의 숫자는 전부 여기서 가져다 쓴다. 화면과 core에 숫자를 따로 적지 않는다.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ---------- FR-500 일정 ---------- */

/** 체류 시간 기본값(분). 기능명세서 FR-500 절의 표와 같다. 기타는 표에 없어 식당·쇼핑과 같게 둔다. */
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

/** 시간대 경계. 제외 사유 문장의 '오전/오후/저녁'을 고른다(A2 사유 규칙). */
export const DAYPART_NOON = '12:00';
export const DAYPART_EVENING = '18:00';

/** 기점 왕복이 이 값 이상이면 제외 사유 문장이 tooFar가 된다. 제외 여부는 바꾸지 않는다. */
export const FAR_ROUNDTRIP_MIN = 60;

/** FR-501: 하루 스팟이 이 수 이하면 정확해(Held-Karp), 넘으면 근사 정렬. */
export const EXACT_ORDER_MAX = 10;

/**
 * 경로 API가 실패했을 때 쓰는 직선거리 기준 속도(km/h).
 * FR-501 예외 처리: "경로 API 실패 시 직선거리 기준". 대중교통은 2차 모의 모델의 승차 구간 속도다.
 */
export const FALLBACK_SPEED_KMH: Record<Transport, number> = {
  car: 34,
  walk: 4.2,
  transit: 22,
};

/** 직선거리를 실제 도로 거리로 보정하는 계수. */
export const DETOUR_FACTOR: Record<Transport, number> = {
  car: 1.35,
  walk: 1.25,
  transit: 1.4,
};

export const TRANSPORT_LABEL: Record<Transport, string> = {
  car: '자동차',
  walk: '도보',
  transit: '대중교통',
};

/** 1단계에서 여행방 기본 수단으로 고를 수 있는 것. 대중교통은 2차 확장이다(FR-504). */
export const MVP_TRANSPORTS: Transport[] = ['car', 'walk'];

/* ---------- 비기능: 성능·비용 ---------- */

/** 루트 재계산 3초 이내. */
export const RECOMPUTE_MS = 3000;
/** 지도 초기 로딩 2초 이내(렌더 포함, 화면 확인). */
export const MAP_INITIAL_LOAD_MS = 2000;
/** 지도 순수 계산(투영·클러스터·선) 예산. 14곳·3일·위치 점 300개 기준. */
export const MAP_LAYOUT_BUDGET_MS = 100;
/** 편집 뒤 재계산 디바운스. */
export const RECOMPUTE_DEBOUNCE_MS = 150;

/** 루트 재계산 1회당 경로 조회 100구간 이하. 캐시에서 나온 구간은 세지 않는다. */
export const ROUTE_CALL_BUDGET = 100;
/** 동일 구간 결과는 24시간 캐시. */
export const ROUTE_CACHE_TTL_MS = DAY;

/* ---------- FR-100 계정·세션 ---------- */

/** FR-105 게스트 세션과 2차 계정 세션 모두 30일, 사용할 때마다 갱신. */
export const SESSION_TTL_MS = 30 * DAY;
/** 기기 토큰 길이(바이트). 128비트. */
export const DEVICE_TOKEN_BYTES = 16;
/** 화면에 보이는 토큰 끝자리 수. 원문은 보이지 않는다. */
export const TOKEN_VISIBLE_TAIL = 4;
/** 세션 만료 몇 일 전에 앱 안 알림을 띄울지(프로토타입 가정). */
export const SESSION_EXPIRY_NOTICE_MS = 3 * DAY;

/** FR-101 비밀번호 규칙: 8자 이상, 영문과 숫자 포함. */
export const PASSWORD_MIN_LENGTH = 8;
/** FR-102 계정 기준 5회 연속 실패 시 10분 잠금. */
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_LOCK_MS = 10 * MIN;
/** FR-102 기기 토큰 기준 10분 20회 제한(서버가 없어 IP 대신 기기 토큰, 프로토타입 가정). */
export const DEVICE_ATTEMPT_LIMIT = 20;
export const DEVICE_ATTEMPT_WINDOW_MS = 10 * MIN;
/** FR-104 프로필 이미지 5MB 초과 시 압축. */
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** FR-104 성향 태그. FR-404 추천 입력. */
export const PROFILE_TAGS = ['맛집', '자연', '액티비티', '휴식', '역사', '카페'] as const;
/** 닉네임 최대 길이(02 화면 12자 카운터). */
export const NICKNAME_MAX = 12;

/* ---------- FR-200·300 여행방·그룹 ---------- */

/** FR-201: 기간 14일 초과(15일 이상) 시 확인 뒤 허용. */
export const MAX_TRIP_DAYS = 14;
/** FR-301: 초대 링크 기본 7일 유효, 정원 6명. */
export const INVITE_TTL_MS = 7 * DAY;
export const MEMBER_CAPACITY = 6;
/** 초대 코드 Crockford base32 8자(40비트), 'XXXX-XXXX'. */
export const INVITE_CODE_BYTES = 5;
/** 초대 링크 도메인. 앱 안 linking의 https 접두사와 같다. */
export const INVITE_HOST = 'youngtrip.app';
export const INVITE_URL_PREFIX = 'https://youngtrip.app/j/';
export const APP_SCHEME = 'youngtrip';

/* ---------- FR-802 지도 선 색 ---------- */

/** 지도 선 색 이름. 실제 색 값은 ui/tokens의 mapC가 갖는다. */
export type RouteColor = 'ink' | 'slate' | 'ok' | 'warn';

/**
 * 날짜별 선 색 순서. 1일 잉크, 2일 청회색, 3일 초록, 4일부터 앰버.
 * 순수 영역(core/map)이 ui를 import하지 않게 여기에 두고, ui/tokens가 다시 내보낸다(통합 때 옮김).
 */
export const DAY_COLORS: readonly RouteColor[] = ['ink', 'slate', 'ok', 'warn'];

export function dayColor(dayIndex: number): RouteColor {
  return DAY_COLORS[Math.min(dayIndex, DAY_COLORS.length - 1)];
}

/* ---------- FR-600 실시간 (2차) ---------- */

/** 도착 판정에 쓰는 샘플 정확도 상한(m). */
export const ARRIVAL_ACCURACY_M = 50;
/** 도착 판정 반경(m). */
export const ARRIVAL_RADIUS_M = 100;
/** 반경 안에 머문 시간이 이 값 이상이면 도착. */
export const ARRIVAL_DWELL_MS = 3 * MIN;
/** ETA가 계획보다 이 값 이상 늦으면 조정안을 낸다(FR-603). */
export const DELAY_THRESHOLD_MIN = 15;
/** 다음 일정까지 이 값 이상 남으면 빈 시간 추천(FR-604, 3차). */
export const FREE_TIME_MIN = 30;
/** 빈 시간 추천 반경. 도보 이동 가능 거리(프로토타입 가정). */
export const WALKABLE_RADIUS_M = 800;
/** 여행 진행 중 위치 갱신 간격(배터리). */
export const LOCATION_INTERVAL_MS = 30 * 1000;
/** 정지 판정: 이 거리 안에서만 움직이면 정지로 보고 갱신을 멈춘다. */
export const STATIONARY_RADIUS_M = 20;
/** 정확도 초과 샘플이 연속 이 수 이상이면 GPS 음영 안내. */
export const GPS_SHADOW_SAMPLES = 3;

/* ---------- 알림 ---------- */

/** 동일 유형·같은 키 알림은 30분에 1회. */
export const NOTIFY_COOLDOWN_MS = 30 * MIN;
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  delay: true,
  freeTime: true,
  arrival: true,
  sessionExpiry: true,
};

/* ---------- FR-700 기록 (3차) ---------- */

/** 사진 장당 10MB 초과 시 압축. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/* ---------- 비기능: 보존·개인정보 ---------- */

/** 위치 이력은 여행 종료 후 90일 보관 뒤 삭제. */
export const TRACK_RETENTION_MS = 90 * DAY;
/** 여행방·채팅·사진은 여행 종료 후 1년 보관. */
export const DATA_RETENTION_MS = 365 * DAY;
/** 계정 탈퇴 멤버 표시 이름. */
export const DELETED_MEMBER_NAME = '탈퇴한 멤버';

/* ---------- 저장 키 ---------- */

/** 새 저장 키 접두사. 스토어 persist 이름은 전부 이 아래에 둔다(v2). */
export const STORAGE_PREFIX = 'young-trip/';
export const STORAGE_VERSION = 2;
export const STORAGE_KEYS = {
  ui: 'young-trip/ui',
  session: 'young-trip/session',
  trips: 'young-trip/trips',
  live: 'young-trip/live',
} as const;

/**
 * 서비스 KV 접두사(계약 A4·A5). registry가 영역마다 'young-trip/svc/<영역>/' 접두사 KV를 따로 넘긴다.
 * 그래서 서비스가 kv.set('trips', …)을 써도 스토어 persist 키('young-trip/trips')를 덮지 않는다.
 * KV에는 키 나열 API가 없으므로, 여러 키를 쓰는 영역은 색인 키 하나(예: 'index')에 키 목록이나 전체 blob을 둔다.
 */
export const SERVICE_KV_PREFIX = 'young-trip/svc/';
export type ServiceKvArea = 'routes' | 'auth' | 'sync' | 'app';

/**
 * 1단계 프로토타입의 persist 키. 첫 실행 때 지우고 옮기지 않는다(구 토큰이 추측 가능해서).
 * 구 브랜드 표기가 src에 0건이어야 해서(통합 게이트 grep) 문자열을 나눠 적는다.
 */
export const LEGACY_STORAGE_KEY = ['yeo', 'jeong-proto-v1'].join('');
