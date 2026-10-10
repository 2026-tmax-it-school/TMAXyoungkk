/**
 * 외부 제공자 키. test/.env 에 넣고 앱을 다시 띄운다(.env.example 참고).
 *
 * 키가 하나도 없어도 앱은 전부 돈다. 없으면 로컬 모의 제공자로 동작한다.
 *   EXPO_PUBLIC_API_URL         키 숨기는 서버(server/sync-server.mjs의 중계) 주소. 있으면 장소 검색·자동차 경로가 키 없이
 *                               이 서버를 거쳐 카카오로 바뀌고(카카오 키는 서버 변수 KAKAO_REST_KEY에만 둔다), 도로 모양의
 *                               기본 주소도 이 서버의 /osrm이 된다. 서버에 카카오 키가 없으면(503) 로컬 장소 사전·추정 경로다.
 *                               http(s) 주소가 아니면 없는 것으로 본다. 서버에 닿지 못하거나 서버·카카오가 실패해도 로컬 대체다.
 *                               빈 시간 추천(주변 장소)은 지금 위치를 이 서버를 거쳐 카카오에 묻는다(남은 문제, 서버는 두지 않는다).
 *   EXPO_PUBLIC_KAKAO_REST_KEY  시연 한정 직접 호출. 있으면 장소 검색·자동차 경로가 앱에서 바로 카카오로 간다.
 *                               프로토타입 가정 · 국내 SDK 선정 미결정. REST 키가 번들에 들어가므로 시연 한정이다.
 *                               EXPO_PUBLIC_API_URL이 있으면 쓰지 않는다(값이 있으면 번들에는 들어가니 비워 둔다.
 *                               남아 있으면 KAKAO_KEY_IGNORED로 더보기 서비스 상태가 알린다).
 *   EXPO_PUBLIC_AI_PROXY_URL    있으면 추출·추천·일기 문장이 AI 프록시를 쓴다. AI 키는 프록시 서버에만 둔다.
 *   EXPO_PUBLIC_SYNC_URL        있으면 그룹 동기화가 HTTP 폴링 서버(server/sync-server.mjs)를 쓴다.
 *                               계정(가입·로그인)은 EXPO_PUBLIC_API_URL, 없으면 이 주소의 서버(/auth)를 쓴다(pickAuthUrl).
 *                               둘 다 없으면 이 기기 모의 인증이다.
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  있으면 지도가 구글 지도로 바뀐다. 웹은 Maps JavaScript API, 앱은 react-native-maps.
 *                               웹 키라 HTTP 리퍼러로 제한한다. 앱 빌드용 키는 app.config.js가 따로 읽는다.
 *   EXPO_PUBLIC_MAP_PROVIDER    svg면 구글 키가 있어도 기본 지도다. 비우면 구글 키가 있을 때만 구글이다.
 *   EXPO_PUBLIC_ROAD_SHAPE      off(또는 false·0·no·none)면 경로 선을 두 점 직선으로 두고 시간도 예시 구간표·직선 추정만 쓴다(외부 호출 0).
 *                               비우면 도보·자동차 선 모양과 이동 시간을 OpenStreetMap 공개 경로 서버
 *                               (routing.openstreetmap.de, 키 불필요)에서 받는다. 예시 구간표 구간은 구간표 시간이 우선이고,
 *                               자동차는 카카오가 있으면 카카오가 먼저다(OSRM 자동차 시간은 교통 보정 1.3배).
 *                               EXPO_PUBLIC_API_URL이 있으면 그 서버의 /osrm을 거친다(서버가 대신 묻고 24시간 캐시).
 *                               스팟 좌표가 그 서버로 간다. 다른 OSRM 서버 주소를 넣으면 그 서버를 쓴다.
 *
 * 이 파일은 순수 영역(src/core 등)에서 import하지 않는다. registry와 components/map/engine만 읽는다.
 * 고르는 규칙은 순수 함수(parseApiUrl, pickKakaoKey, parseRoadShapes, roadShapeSource)로 두어 테스트가 본다.
 */

/** 서버 주소 값 → 끝 '/'를 뗀 주소. http(s) 주소(호스트 있음)가 아니면 빈 값 */
export function parseApiUrl(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  return /^https?:\/\/[^\s/?#]+\S*$/.test(v) ? v.replace(/\/+$/, '') : '';
}

/**
 * 카카오 직접 호출 키 고르기. 서버 주소가 있으면 키를 쓰지 않는다(서버가 키를 붙인다).
 * ignored는 서버 주소가 있는데 앱 .env에 키가 남은 경우다. 쓰지 않아도 Expo가 빌드 때 값을 번들에 넣는다.
 */
export function pickKakaoKey(apiUrl: string, raw: string | undefined): { key: string; ignored: boolean } {
  const v = raw ?? '';
  if (!apiUrl) return { key: v, ignored: false };
  return { key: '', ignored: v.trim().length > 0 };
}

/** 도로 모양을 끄는 값(대소문자 무시) */
const ROAD_SHAPE_OFF = new Set(['off', 'false', '0', 'no', 'none']);

/** 도로 모양 설정 값 → off·false·0·no·none이면 끈다(undefined), http(s) 주소면 그 서버, 그 밖(빈 값 포함)은 기본 주소({}) */
export function parseRoadShapes(raw: string | undefined): { baseUrl?: string } | undefined {
  const v = (raw ?? '').trim();
  if (ROAD_SHAPE_OFF.has(v.toLowerCase())) return undefined;
  return /^https?:\/\//.test(v) ? { baseUrl: v } : {};
}

/** 도로 모양을 어디서 받는지. 주소를 따로 주지 않았고 서버 주소가 있으면 서버 경유다 */
export function roadShapeSource(
  roadShapes: { baseUrl?: string } | undefined,
  apiUrl: string,
): 'server' | 'custom' | 'public' | undefined {
  if (!roadShapes) return undefined;
  if (roadShapes.baseUrl) return 'custom';
  return apiUrl ? 'server' : 'public';
}

/** 계정 서버 주소. 키 숨기는 서버가 있으면 그 서버, 없으면 동기화 서버(같은 server/sync-server.mjs). 둘 다 없으면 빈 값(모의 인증) */
export function pickAuthUrl(apiUrl: string, syncUrl: string | undefined): string {
  return apiUrl || parseApiUrl(syncUrl);
}

/** 키 숨기는 서버 주소(끝 '/' 없음). http(s) 주소가 아니면 빈 값 */
export const API_URL = parseApiUrl(process.env.EXPO_PUBLIC_API_URL);

const KAKAO = pickKakaoKey(API_URL, process.env.EXPO_PUBLIC_KAKAO_REST_KEY);
/** 시연 한정 직접 호출 키. API_URL이 있으면 쓰지 않는다(서버가 키를 붙인다) */
export const KAKAO_REST_KEY = KAKAO.key;
export const HAS_KAKAO_KEY = KAKAO_REST_KEY.length > 0;
/** API_URL이 있는데 앱 .env에 카카오 키도 있다. 쓰지 않지만 번들에는 들어간다(더보기 서비스 상태가 알린다) */
export const KAKAO_KEY_IGNORED = KAKAO.ignored;

export const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL ?? '';

export const SYNC_URL = process.env.EXPO_PUBLIC_SYNC_URL ?? '';

/** 계정 서버 주소(끝 '/' 없음). 비면 이 기기 모의 인증 */
export const AUTH_URL = pickAuthUrl(API_URL, SYNC_URL);

export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export const MAP_PROVIDER = process.env.EXPO_PUBLIC_MAP_PROVIDER ?? '';

/** 도로 모양을 받을지와 서버 주소. off(false·0·no·none)면 끈다. http(s) 주소면 그 서버, 비우면 기본(API_URL이 있으면 그 서버의 /osrm, 없으면 공개 서버) */
export const ROAD_SHAPES = parseRoadShapes(process.env.EXPO_PUBLIC_ROAD_SHAPE);
