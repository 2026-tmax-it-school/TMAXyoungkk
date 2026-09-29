import type { GpsSample } from '../../types';
import type { Clock, LocationPermission, LocationProvider } from '../../core/ports';
import { samplesBetween } from '../../core/sim/track';

/**
 * 시뮬레이터 위치(WP5 소유, 순수). 미리 만든 샘플열(core/sim/track.generateTrack)을 시계에 맞춰 흘린다.
 * - 시계는 SimClock(가상 시각)이다. 배속·일시정지·점프는 시계가 맡고, 여기서는 '지난번 이후 새로 지난 샘플'만 넘긴다.
 * - 점프로 한 번에 10분 넘게 지나가면 마지막 샘플 하나만 넘긴다. 건너뛴 구간은 채우지 않는다(기록 지도에서 점선).
 * - 시각이 뒤로 가면(프리셋 다시 시작) 그 시각부터 다시 센다.
 * - 권한 거부 프리셋은 permission 'denied'로 만들고 아무 샘플도 넘기지 않는다.
 * 타이머는 주입할 수 있다(테스트는 수동 타이머, 앱은 setInterval). 폴링 간격은 실제 시각 기준이다.
 */

export interface SimTimer {
  every(ms: number, fn: () => void): () => void;
}

const intervalTimer: SimTimer = {
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

export const SIM_POLL_MS = 400;

export function createSimLocation(opts: {
  clock: Clock;
  samples: GpsSample[];
  permission?: Exclude<LocationPermission, 'undetermined'>;
  timer?: SimTimer;
  pollMs?: number;
}): LocationProvider {
  const perm = opts.permission ?? 'granted';
  const timer = opts.timer ?? intervalTimer;
  return {
    id: 'sim',
    async permission() {
      return perm;
    },
    async request() {
      return perm;
    },
    watch(onSample) {
      if (perm !== 'granted') return () => {};
      let cursor = opts.clock.now();
      // 시작 시각의 위치를 하나 바로 준다(지도에 현재 위치가 곧바로 보이게).
      const first = [...opts.samples].reverse().find((s) => s.t <= cursor);
      if (first) onSample(first);
      return timer.every(opts.pollMs ?? SIM_POLL_MS, () => {
        const now = opts.clock.now();
        if (now < cursor) {
          cursor = now;
          return;
        }
        const batch = samplesBetween(opts.samples, cursor, now);
        cursor = now;
        for (const s of batch) onSample(s);
      });
    },
  };
}
