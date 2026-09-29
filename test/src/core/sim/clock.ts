import type { Clock } from '../ports';

/**
 * 여행 시뮬레이터 시계(WP5 소유). 1·10·60·300배, 일시정지, 시각 점프.
 * 시뮬레이터가 켜지면 services/clock의 setClockOverride로 이 시계가 appClock이 된다.
 * 기준 시계(base)는 주입받는다. 순수 영역이라 Date.now를 직접 부르지 않는다.
 * 가상 시각 = 기준 시점의 가상 시각 + (지금 실제 시각 - 기준 실제 시각) × 배속. 배속을 바꾸거나 멈출 때 기준을 다시 잡는다.
 * 시계 단조 규칙(계약 A5): stop·pause는 가상 시각을 멈춘 채 앱 시계로 남는다. 기기 시각으로 돌아가는 것은 resetDemo뿐이다.
 */
export type SimSpeed = 1 | 10 | 60 | 300;

export interface SimClock extends Clock {
  speed(): SimSpeed;
  setSpeed(s: SimSpeed): void;
  playing(): boolean;
  play(): void;
  pause(): void;
  jumpTo(t: number): void;
}

export function createSimClock(base: Clock, startAt: number, speed: SimSpeed = 60): SimClock {
  let anchorReal = base.now();
  let anchorVirtual = startAt;
  let rate: SimSpeed = speed;
  let running = false;

  const current = () => (running ? anchorVirtual + (base.now() - anchorReal) * rate : anchorVirtual);
  const reanchor = () => {
    anchorVirtual = current();
    anchorReal = base.now();
  };

  return {
    now: current,
    speed: () => rate,
    setSpeed(s) {
      reanchor();
      rate = s;
    },
    playing: () => running,
    play() {
      if (running) return;
      anchorReal = base.now();
      running = true;
    },
    pause() {
      if (!running) return;
      reanchor();
      running = false;
    },
    jumpTo(t) {
      anchorVirtual = t;
      anchorReal = base.now();
    },
  };
}
