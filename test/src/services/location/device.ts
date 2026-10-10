import * as Location from 'expo-location';

import type { GpsSample } from '../../types';
import type { LocationProvider } from '../../core/ports';
import {
  initialWatchProfile,
  nextWatchProfile,
  throttleSample,
  watchRequest,
  type ThrottleState,
  type WatchProfile,
  type WatchProfileState,
} from '../../core/live/throttle';

/**
 * expo-location 어댑터(WP5 소유). 전경 권한만 쓴다. 화면 밖 기록은 사용자가 켜는 옵션이고 background.ts가 맡는다.
 * - 웹 watchPosition은 간격을 보장하지 않고 coords.accuracy가 null일 수 있다. 그래서 30초 간격은
 *   core/live/throttle.ts의 throttleSample로 JS에서 거른다(네이티브 timeInterval은 힌트일 뿐이다).
 * - 정지가 2분 이어지면(nextWatchProfile) 20m 넘게 움직일 때만 갱신받도록 다시 구독한다(NFR 배터리).
 *   움직임이 잡히면 30초 간격으로 돌아온다. 웹은 distanceInterval을 무시할 수 있다(추적표 가정).
 *   opts.adaptive === false(지도 '내 위치')면 바꾸지 않고 1초·거리 조건 없이 계속 받는다.
 * - 비보안 출처(http)에서는 브라우저가 위치를 막는다. 그때는 권한 거부처럼 동작한다(수동 진행 모드).
 */
export function createExpoLocation(): LocationProvider {
  return {
    id: 'device',
    async permission() {
      try {
        const res = await Location.getForegroundPermissionsAsync();
        return res.status === 'granted' ? 'granted' : res.status === 'denied' ? 'denied' : 'undetermined';
      } catch {
        return 'denied';
      }
    },
    async request() {
      try {
        const res = await Location.requestForegroundPermissionsAsync();
        return res.status === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    },
    watch(onSample: (s: GpsSample) => void, opts: { intervalMs: number; adaptive?: boolean }) {
      let sub: Location.LocationSubscription | undefined;
      let stopped = false;
      let throttle: ThrottleState = {};
      let profile: WatchProfileState = initialWatchProfile;
      let generation = 0;

      const subscribe = (p: WatchProfile) => {
        generation += 1;
        const mine = generation;
        sub?.remove();
        sub = undefined;
        const req = watchRequest(p, opts.intervalMs);
        void Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: req.timeIntervalMs, distanceInterval: req.distanceIntervalM },
          (loc) => {
            if (stopped || mine !== generation) return;
            const sample: GpsSample = {
              t: loc.timestamp,
              coord: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
              accuracyM: loc.coords.accuracy ?? null,
            };
            const r = throttleSample(throttle, sample, { intervalMs: opts.intervalMs });
            throttle = r.state;
            if (!r.decision.emit) return;
            onSample(sample);
            const np = nextWatchProfile(profile, r.decision, opts.adaptive !== false);
            profile = np.state;
            if (np.changed && !stopped) subscribe(profile.profile);
          },
        )
          .then((s) => {
            if (stopped || mine !== generation) s.remove();
            else sub = s;
          })
          .catch(() => {});
      };

      subscribe('active');
      return () => {
        stopped = true;
        sub?.remove();
      };
    },
  };
}
