import type { GpsSample } from '../../types';
import type { LocationProvider } from '../ports';
import { BG_FAIL_LINE, BG_LINE, bgRecordEndsAt, watchPlan, type BgFailReason, type BgRecordBlock } from './background';
import type { LiveMode } from './mode';

/**
 * 위치 받기 제어(WP5 소유, 순수). 여행 진행 하나의 앱 안 감시와 백그라운드 받기를 watchPlan에 맞춰 켜고 끈다.
 * 스토어(store/live)는 진행을 시작할 때 하나 만들고, 상태가 바뀔 때마다(진행 시작, 앱 상태 변화, 옵션 켜고 끄기, 시계 틱,
 * 샘플) sync()만 부른다. 받기 어댑터·시계·타이머를 주입받으므로 테스트가 가짜 어댑터로 동작을 확인한다.
 * - 백그라운드 받기를 실제로 켤 때 기록 상태를 알리고(onRecording) '켜짐' 줄을 한 번 남긴다.
 *   진행 날짜가 끝나는 시각(다음 날 0시)에 타이머로 다시 맞춘다. 정지 중에는 샘플이 없어도 멈추게.
 * - 옵션을 끄거나 날짜가 지나 멈추면 그 줄을 남긴다.
 * - 시작하지 못하거나 도중에 끊기면(권한 회수·기기 위치 꺼짐·빌드 설정 없음) 옵션을 끄게 알리고(onFail) 이유를 남긴다.
 *   이 진행에서는 옵션이 꺼진 것을 본 뒤에만 다시 켠다. 옵션이 켜진 채 남아도 실패와 재시작이 되풀이되지 않는다.
 * - dispose(진행 끝·리셋·다시 시작) 뒤에는 어댑터가 늦게 넘긴 샘플과 실패를 받지 않는다.
 */

/** 백그라운드 받기 어댑터(services/location/background BackgroundLocation 중 받기 부분) */
export interface BgReceiver {
  block(): BgRecordBlock | undefined;
  /** 멈춰 있으면 샘플을 보내지 않는지(iOS 20m 이동 조건, throttle backgroundStillSilent) */
  readonly stillSilent: boolean;
  watch(onSample: (s: GpsSample) => void, opts: { intervalMs: number; onFail: (reason: BgFailReason) => void }): () => void;
}

export interface WatchControlDeps {
  /** 진행 날짜(YYYY-MM-DD, KST) */
  date: string;
  intervalMs: number;
  bg: BgReceiver;
  /** 앱 안 감시 제공자. 시뮬레이터 궤적이 바뀌면 제공자도 바뀌므로 켤 때마다 읽는다 */
  fg: () => Pick<LocationProvider, 'watch'>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** 지금 옵션 값·진행 방식·화면 밖인지 */
  read: () => { pref: boolean; mode: LiveMode; inBackground: boolean };
  onSample: (s: GpsSample) => void;
  /** 백그라운드 받기가 켜지거나 꺼졌다(엔진 기록 상태, 화면의 bgActive) */
  onRecording: (on: boolean, at: number, stillSilent: boolean) => void;
  /** 받기를 시작하지 못했거나 끊겼다. 스토어는 옵션을 끈다 */
  onFail: (reason: BgFailReason) => void;
  /** 진행 기록 한 줄 */
  onLine: (text: string, at: number) => void;
}

export interface WatchControl {
  /** 지금 상태에 맞춘다. 이미 맞으면 아무것도 하지 않는다 */
  sync(): void;
  /** 앱 안 감시를 새 제공자로 다시 구독한다(시뮬레이터 궤적이 바뀜). 화면 밖이면 돌아올 때 켠다 */
  restartFg(): void;
  /** 지금 백그라운드 받기가 도는지 */
  bgActive(): boolean;
  /** 모든 받기와 타이머를 멈춘다 */
  dispose(): void;
}

export function createWatchControl(d: WatchControlDeps): WatchControl {
  let disposed = false;
  let stopFg: (() => void) | undefined;
  /** 지금 도는 백그라운드 받기 */
  let bg: { stop: () => void } | undefined;
  let timer: unknown;
  /** 이번 진행에서 받기가 실패했다. 옵션이 꺼진 것을 볼 때까지 다시 켜지 않는다 */
  let failed = false;

  const clearDayTimer = () => {
    if (timer !== undefined) d.clearTimer(timer);
    timer = undefined;
  };

  const startBg = () => {
    let live = true;
    let stopNative: () => void = () => {};
    /** 받기가 끝났다고 정리한다. 이미 끝났으면 false */
    const off = (): boolean => {
      if (!live) return false;
      live = false;
      clearDayTimer();
      if (bg === handle) bg = undefined;
      d.onRecording(false, d.now(), d.bg.stillSilent);
      return true;
    };
    const handle = {
      stop: () => {
        if (!live) return;
        stopNative();
        off();
      },
    };
    bg = handle;
    const at = d.now();
    d.onRecording(true, at, d.bg.stillSilent);
    d.onLine(BG_LINE.on, at);
    stopNative = d.bg.watch(d.onSample, {
      intervalMs: d.intervalMs,
      onFail: (reason) => {
        if (disposed || !off()) return;
        failed = true;
        d.onFail(reason);
        d.onLine(BG_FAIL_LINE[reason], d.now());
        sync();
      },
    });
    // 시작하자마자 실패했으면 타이머를 걸지 않는다.
    if (!live) return;
    timer = d.setTimer(
      () => {
        timer = undefined;
        sync();
      },
      Math.max(0, bgRecordEndsAt(d.date) - d.now()) + 1000,
    );
  };

  const sync = () => {
    if (disposed) return;
    const s = d.read();
    if (!s.pref) failed = false;
    const now = d.now();
    const plan = watchPlan({
      pref: s.pref && !failed,
      mode: s.mode,
      block: d.bg.block(),
      date: d.date,
      now,
      inBackground: s.inBackground,
      bgActive: bg != null,
    });
    if (!plan.bg && bg) {
      bg.stop();
      d.onLine(plan.bgStop === 'dateOver' ? BG_LINE.dateOver : BG_LINE.off, now);
    }
    if (plan.bg && !bg) startBg();
    if (plan.fg && !stopFg) stopFg = d.fg().watch(d.onSample, { intervalMs: d.intervalMs });
    if (!plan.fg && stopFg) {
      stopFg();
      stopFg = undefined;
    }
  };

  return {
    sync,
    restartFg: () => {
      stopFg?.();
      stopFg = undefined;
      sync();
    },
    bgActive: () => bg != null,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopFg?.();
      stopFg = undefined;
      bg?.stop();
      clearDayTimer();
    },
  };
}
