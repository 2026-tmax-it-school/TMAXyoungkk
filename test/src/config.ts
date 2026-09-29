/**
 * 외부 제공자 키. test/.env 에 넣고 앱을 다시 띄운다(.env.example 참고).
 *
 * 키가 하나도 없어도 앱은 전부 돈다. 없으면 로컬 모의 제공자로 동작한다.
 *   EXPO_PUBLIC_KAKAO_REST_KEY  있으면 장소 검색·자동차 경로가 카카오로 바뀐다.
 *                               프로토타입 가정 · 국내 SDK 선정 미결정.
 *                               REST 키가 번들에 들어가므로 시연 한정이다. 실서비스는 프록시로 옮긴다.
 *   EXPO_PUBLIC_AI_PROXY_URL    있으면 추출·추천·일기 문장이 AI 프록시를 쓴다. AI 키는 프록시 서버에만 둔다.
 *   EXPO_PUBLIC_SYNC_URL        있으면 그룹 동기화가 HTTP 폴링 서버(server/sync-server.mjs)를 쓴다.
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  있으면 지도가 구글 지도로 바뀐다. 웹은 Maps JavaScript API, 앱은 react-native-maps.
 *                               웹 키라 HTTP 리퍼러로 제한한다. 앱 빌드용 키는 app.config.js가 따로 읽는다.
 *   EXPO_PUBLIC_MAP_PROVIDER    svg면 구글 키가 있어도 기본 지도다. 비우면 구글 키가 있을 때만 구글이다.
 *
 * 이 파일은 순수 영역(src/core 등)에서 import하지 않는다. registry와 components/map/engine만 읽는다.
 */
export const KAKAO_REST_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_KEY ?? '';
export const HAS_KAKAO_KEY = KAKAO_REST_KEY.length > 0;

export const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL ?? '';

export const SYNC_URL = process.env.EXPO_PUBLIC_SYNC_URL ?? '';

export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export const MAP_PROVIDER = process.env.EXPO_PUBLIC_MAP_PROVIDER ?? '';
