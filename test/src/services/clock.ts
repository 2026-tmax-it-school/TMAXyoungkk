import { useEffect, useState } from 'react';

import type { Clock } from '../core/ports';

/**
 * 앱 시계. 화면·스토어·op 시각은 전부 appClock().now()를 쓴다.
 * 여행 시뮬레이터가 켜지면 setClockOverride(SimClock)로 가상 시각이 앱 시계가 된다.
 * 그래서 홈 상태(예정·진행중·완료), 종료 잠금, op 시각이 같이 움직인다.
 *
 * 시계 단조 규칙(계약 A5·A6):
 * - 가상 시각은 되돌리지 않는다. 시뮬레이터 stop·pause는 가상 시각을 멈춘 채 override를 유지한다.
 * - setClockOverride(null)은 resetDemo만 부른다. 기기 시각으로 돌아가면 LWW(op.at)가 조용히 틀어지기 때문이다.
 * - 그래도 시각이 뒤로 가는 경우(프리셋 다시 시작 등)는 스토어 dispatch가 stampAt으로 op.at을 앞으로만 찍어 막는다.
 */

export const systemClock: Clock = { now: () => Date.now() };

let override: Clock | null = null;
const listeners = new Set<() => void>();

export function appClock(): Clock {
  return override ?? systemClock;
}

/** 늘 현재 앱 시계를 따라가는 Clock. 서비스 팩토리에 주입할 때 쓴다. */
export const liveClock: Clock = { now: () => appClock().now() };

export function isClockOverridden(): boolean {
  return override != null;
}

/** 앱 시계를 바꾼다. null(기기 시각으로 복귀)은 resetDemo 전용이다. */
export function setClockOverride(c: Clock | null): void {
  override = c;
  for (const l of listeners) l();
}

export function onClockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 앱 시각을 tickMs마다 다시 읽는 훅. 시계가 바뀌면 바로 다시 읽는다. */
export function useNow(tickMs = 30_000): number {
  const [now, setNow] = useState(() => appClock().now());
  useEffect(() => {
    const tick = () => setNow(appClock().now());
    const id = setInterval(tick, tickMs);
    const off = onClockChange(tick);
    return () => {
      clearInterval(id);
      off();
    };
  }, [tickMs]);
  return now;
}
