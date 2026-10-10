/**
 * 카카오맵 JavaScript SDK 주소(순수). 카카오 지도 SDK 주소는 카카오 어댑터 파일 안에서만 쓴다(qa-decisions 국내 전용 규칙).
 * autoload=false로 받고 kakao.maps.load(콜백)로 실제 지도 코드를 불러온다. 스크립트를 나중에 붙여도(document.write 없이) 뜬다.
 * 장소 검색은 서버·REST 제공자가 맡으므로 services 등 추가 라이브러리는 받지 않는다.
 * 키가 비면 appkey를 넣지 않는다(그 경우 어댑터를 고르지 않는다).
 */
export const KAKAO_SDK_ORIGIN = 'https://dapi.kakao.com';

export function kakaoScriptUrl(appKey: string): string {
  const q = new URLSearchParams({ autoload: 'false' });
  if (appKey.trim()) q.set('appkey', appKey.trim());
  return `${KAKAO_SDK_ORIGIN}/v2/maps/sdk.js?${q.toString()}`;
}

/** SDK가 지도 코드를 이 안에 못 불러오면(앱 키 거부·도메인 미등록이면 콜백이 오지 않는다) 키 거부로 본다 */
export const KAKAO_LOAD_TIMEOUT_MS = 10_000;
/** 지도가 보이는 동안 첫 타일이 이 안에 안 오면 그 지도 하나만 기본 지도로 바꾼다 */
export const KAKAO_TILE_TIMEOUT_MS = 10_000;
/** 지도 클릭을 고르기로 보내기 전에 더블클릭(확대)인지 기다리는 시간 */
export const KAKAO_CLICK_DELAY_MS = 300;

/** Ctrl·Cmd+휠 확대에서 레벨 한 단계에 필요한 휠 양(픽셀). 마우스 휠 한 칸은 보통 100 안팎, 트랙패드 핀치는 한 번에 몇 픽셀씩 온다 */
export const KAKAO_WHEEL_STEP_PX = 100;

/**
 * Ctrl·Cmd+휠 이벤트 하나를 받아 쌓인 양과 바꿀 레벨 단계를 돌려준다(순수).
 * deltaMode 1(줄)·2(쪽)는 픽셀로 바꾼다. 0은 무시하고, 방향이 바뀌면 쌓인 양을 버린다.
 * 쌓인 양이 KAKAO_WHEEL_STEP_PX를 넘을 때만 한 단계(+1 축소, -1 확대) 움직이고 쌓인 양을 비운다.
 */
export function wheelZoomStep(acc: number, deltaY: number, deltaMode = 0): { acc: number; step: -1 | 0 | 1 } {
  if (!Number.isFinite(deltaY) || deltaY === 0) return { acc, step: 0 };
  const px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 800 : deltaY;
  const sum = Math.sign(px) === Math.sign(acc) ? acc + px : px;
  if (Math.abs(sum) < KAKAO_WHEEL_STEP_PX) return { acc: sum, step: 0 };
  return { acc: 0, step: sum > 0 ? 1 : -1 };
}
