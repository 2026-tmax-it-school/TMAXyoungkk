/**
 * 구글 지도 API 키.
 *
 * test/.env 파일에 아래 한 줄을 넣고 `npx expo start --clear`로 다시 띄운다.
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=발급받은_키
 *
 * 키가 없으면 앱은 로컬 추정 제공자로 자동 전환한다. 장소는 내장 경주 사전에서만 찾고
 * 이동 시간은 직선거리로 추정하지만, 기능 흐름은 전부 그대로 돌아간다.
 *
 * 필요한 API (Google Cloud 콘솔에서 사용 설정):
 *   - Places API (New)   : 장소 검색
 *   - Routes API         : 구간 이동 시간
 *   - Maps SDK for Android / Maps SDK for iOS : 지도 화면
 */
export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export const HAS_GOOGLE_KEY = GOOGLE_MAPS_API_KEY.length > 0;
