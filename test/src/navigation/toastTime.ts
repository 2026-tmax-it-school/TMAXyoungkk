/**
 * 토스트가 떠 있는 시간(순수). 짧은 글은 2.5초대, 글자마다 60ms를 더하고 6초에서 멈춘다.
 * 긴 문장을 다 읽기 전에 사라지지 않게 한다. ToastHost가 쓴다.
 */
export const TOAST_MIN_MS = 2500;
export const TOAST_MAX_MS = 6000;
export const TOAST_MS_PER_CHAR = 60;

export function toastDuration(text: string): number {
  return Math.min(TOAST_MAX_MS, TOAST_MIN_MS + TOAST_MS_PER_CHAR * [...text].length);
}
