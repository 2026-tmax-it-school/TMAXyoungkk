import type { LatLng } from '../../types';
import { haversineKm } from '../util';

/**
 * 지도 '내 위치' 버튼(WP5 소유, 순수). 카카오맵·구글 지도처럼 지도 오른쪽 아래 둥근 버튼 하나로 켠다.
 * - off: 위치를 읽지 않는다(감시 없음, 파랑 점 없음).
 * - locating: 누른 뒤 첫 위치를 기다린다. 다시 누르면 취소(off).
 * - centered: 첫 위치가 오면 지도를 내 자리로 옮기고 거리 단위 배율로 당긴다. 파랑 점·정확도 원은 계속 움직인다.
 * - follow: 한 번 더 누르면 걷는 동안 지도가 나를 따라간다. 사용자가 지도를 끌거나 확대하면 centered로 내려온다.
 * - follow에서 누르면 off다(위치 감시도 끈다). 화면을 떠나거나 앱이 뒤로 가면(stop) 어느 상태든 off다.
 * - 권한 거부·위치 못 받음·시한 초과(fail)는 locating에서만 받고 off로 돌아간다(안내는 locateFailText).
 * 위치는 기기 안에서만 쓴다. 우리 서버로 보내지 않는다(지도 SDK 타일 요청이 보는 범위만큼만 드러난다. 손으로 옮길 때와 같다).
 * 시계는 부르는 쪽이 넘긴다(now).
 */

export type LocateMode = 'off' | 'locating' | 'centered' | 'follow';
export type LocateFail = 'denied' | 'unavailable' | 'timeout';

export type LocateEvent =
  | { type: 'tap' }
  | { type: 'fix' }
  | { type: 'fail'; reason: LocateFail }
  | { type: 'userMove' }
  | { type: 'stop' };

export function locateNext(mode: LocateMode, ev: LocateEvent): LocateMode {
  switch (ev.type) {
    case 'tap':
      if (mode === 'off') return 'locating';
      if (mode === 'locating') return 'off';
      if (mode === 'centered') return 'follow';
      return 'off';
    case 'fix':
      return mode === 'locating' ? 'centered' : mode;
    case 'fail':
      return mode === 'locating' ? 'off' : mode;
    case 'userMove':
      return mode === 'follow' ? 'centered' : mode;
    case 'stop':
      return 'off';
  }
}

/** 처음 내 자리로 옮길 때 배율(구글 zoom, 약 300m 폭). 카카오는 kakaoLevel로 3이다 */
export const LOCATE_ZOOM = 17;
/** 이보다 덜 움직이면 점·지도를 옮기지 않는다(GPS 흔들림) */
export const LOCATE_MIN_MOVE_M = 5;
/** 따라가기 중 지도 다시 맞추기 최소 간격 */
export const LOCATE_RECENTER_MS = 1000;
/** 정확도가 이만큼 바뀌면 움직이지 않아도 점(정확도 원)을 고친다 */
const ACCURACY_STEP_M = 10;

export interface LocateFix {
  coord: LatLng;
  accuracyM: number | null;
}

export function moveM(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

/** 새 위치를 점으로 받을지. 처음이거나 5m 넘게 움직였거나 정확도가 크게 바뀌었을 때만 받는다 */
export function acceptFix(prev: LocateFix | undefined, next: LocateFix, minMoveM = LOCATE_MIN_MOVE_M): boolean {
  if (!prev) return true;
  if (moveM(prev.coord, next.coord) >= minMoveM) return true;
  if ((prev.accuracyM == null) !== (next.accuracyM == null)) return true;
  if (prev.accuracyM != null && next.accuracyM != null && Math.abs(prev.accuracyM - next.accuracyM) >= ACCURACY_STEP_M) return true;
  return false;
}

/** 따라가기 중 지도를 다시 옮길지. 마지막으로 옮긴 자리에서 5m 넘게, 1초 넘게 지났을 때만 */
export function shouldRecenter(
  last: { coord: LatLng; at: number } | undefined,
  next: LatLng,
  now: number,
  o: { minMoveM?: number; minIntervalMs?: number } = {},
): boolean {
  if (!last) return true;
  if (now < last.at) return true;
  if (now - last.at < (o.minIntervalMs ?? LOCATE_RECENTER_MS)) return false;
  return moveM(last.coord, next) >= (o.minMoveM ?? LOCATE_MIN_MOVE_M);
}

/** 버튼 읽기 이름. 누르면 무엇이 되는지를 말한다 */
export function locateLabel(mode: LocateMode): string {
  switch (mode) {
    case 'off':
      return '내 위치 보기';
    case 'locating':
      return '내 위치 찾는 중, 누르면 취소';
    case 'centered':
      return '내 위치 따라가기';
    case 'follow':
      return '따라가기 끄기';
  }
}

/** 실패 안내(토스트). 거부면 켜는 방법을 같이 말한다 */
export function locateFailText(reason: LocateFail, web: boolean): string {
  if (reason === 'denied') {
    return web
      ? '위치 권한이 꺼져 있어요. 주소창 왼쪽 사이트 설정에서 위치를 허용해 주세요'
      : '위치 권한이 꺼져 있어요. 휴대폰 설정에서 Young Trip의 위치 권한을 허용해 주세요';
  }
  if (reason === 'unavailable') {
    return web ? '이 주소에서는 위치를 쓸 수 없어요. https 주소나 localhost에서 열어 주세요' : '이 기기에서 위치를 쓸 수 없어요';
  }
  return '지금 위치를 받지 못했어요. 잠시 뒤 다시 눌러 주세요';
}
