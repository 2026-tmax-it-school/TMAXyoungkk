import type { GpsSample } from '../../types';
import type { LocationProvider } from '../../core/ports';

/**
 * 위치 한 번 읽기(WP5 소유). 27 길찾기에서 사용자가 '내 위치'를 직접 골랐을 때만 부른다.
 * 권한을 묻고(없으면 요청), 감시를 켜서 첫 표본 하나만 받고 바로 끈다. 시뮬레이터가 켜져 있으면 registry가 sim.ts로 덮어
 * 시뮬레이터 위치가 온다. 시한 안에 표본이 없으면 timeout이다(웹 http 출처처럼 브라우저가 막는 경우 포함).
 */

export type OnceResult = { ok: true; sample: GpsSample } | { ok: false; reason: 'denied' | 'timeout' };

export const ONCE_TIMEOUT_MS = 12_000;

export async function readLocationOnce(provider: LocationProvider, timeoutMs: number = ONCE_TIMEOUT_MS): Promise<OnceResult> {
  let perm = await provider.permission().catch(() => 'denied' as const);
  if (perm !== 'granted') perm = await provider.request().catch(() => 'denied' as const);
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  return new Promise<OnceResult>((resolve) => {
    let done = false;
    let stop: (() => void) | undefined;
    const finish = (r: OnceResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    try {
      stop = provider.watch((s) => finish({ ok: true, sample: s }), { intervalMs: 1000 });
      // 첫 표본이 watch 안에서 바로 온 경우 끄기 함수를 늦게 받는다
      if (done) stop();
    } catch {
      finish({ ok: false, reason: 'timeout' });
    }
  });
}
