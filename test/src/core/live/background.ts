/**
 * 백그라운드 판정(NFR 백그라운드, WP5 소유, 순수).
 * 명세: 위치 기능은 앱이 화면에 떠 있을 때만 쓴다. 백그라운드 상시 추적은 범위 밖이다.
 * - AppState가 background(또는 inactive)가 되면 위치 감시와 시뮬레이터 재생을 멈춘다.
 * - 돌아와도 그 사이 경로를 채우지 않는다. 공백 구간에 찍힌 샘플(OS가 늦게 넘긴 것 포함)은 버린다.
 *   빈 구간은 FR-804 기록 지도에서 점선으로 남는다(WP6).
 */

export type AppPhase = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface BackgroundState {
  inBackground: boolean;
  since?: number;
  /** 앱이 꺼져 있던 구간 [from, to) */
  gaps: { from: number; to: number }[];
}

export const initialBackground: BackgroundState = { inBackground: false, gaps: [] };

export interface BackgroundAction {
  state: BackgroundState;
  /** 감시·재생을 멈춰야 하는지 */
  stop: boolean;
  /** 돌아왔는지(재생은 자동으로 다시 켜지 않는다. 사용자가 누른다) */
  resumed: boolean;
}

export function onAppPhase(st: BackgroundState, phase: AppPhase, now: number): BackgroundAction {
  const away = phase === 'background' || phase === 'inactive';
  if (away && !st.inBackground) {
    return { state: { ...st, inBackground: true, since: now }, stop: true, resumed: false };
  }
  if (phase === 'active' && st.inBackground) {
    const gaps = st.since != null && now > st.since ? [...st.gaps, { from: st.since, to: now }] : st.gaps;
    return { state: { inBackground: false, gaps }, stop: false, resumed: true };
  }
  return { state: st, stop: false, resumed: false };
}

/** 이 샘플을 받아도 되는지. 백그라운드 중이거나 공백 구간 안이면 버린다(경로 복원 안 함). */
export function acceptWhileForeground(st: BackgroundState, t: number): boolean {
  if (st.inBackground) return false;
  return !st.gaps.some((g) => t >= g.from && t < g.to);
}
