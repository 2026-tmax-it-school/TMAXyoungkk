import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';

import type { GpsSample } from '../../types';
import type { LocationPermission } from '../../core/ports';
import { bgFailReason, bgRecordBlock, type BgFailReason, type BgRecordBlock } from '../../core/live/background';
import { backgroundStillSilent, backgroundWatchRequest, flushPending, throttleBatch, type ThrottleState } from '../../core/live/throttle';
import type { BgReceiver } from '../../core/live/watchControl';

/**
 * 백그라운드 동선 기록 어댑터(WP5 소유). 사용자가 켜는 옵션이고 기본은 꺼짐이다(store/live bgRecord).
 * - expo-location startLocationUpdatesAsync + expo-task-manager. 작업(defineTask)은 이 모듈을 처음 불러올 때 한 번 정의한다.
 *   앱이 백그라운드에서 다시 떠도 정의되도록 index.ts가 앱 등록 전에 이 모듈을 불러온다.
 * - Expo Go와 웹에서는 켤 수 없다(개발 빌드 필요). expo-task-manager는 네이티브 모듈이 없으면 불러오는 순간 오류가 나서
 *   Expo Go·웹에서는 아예 불러오지 않고, 그 밖에서도 try로 감싸 불러온다. import만으로 앱이 깨지지 않는다.
 * - 진행을 시작할 때 받기를 켜서 화면 밖까지 이어 받는다(안드로이드 12부터 화면 밖에서는 포그라운드 서비스를 새로 띄울 수
 *   없다). 앱이 떠 있는 동안은 스토어가 앱 안 감시(device.ts)도 함께 돌린다. 요청은 iOS 20m 이동, 안드로이드 30초 간격
 *   (backgroundWatchRequest). 간격은 throttleBatch가 맞추고, 간격 안이라 넘기지 않은 마지막 샘플(멈춘 자리)은
 *   그 뒤로 간격만큼 샘플이 없으면 넘긴다(flushPending, 타이머).
 * - 안드로이드는 포그라운드 서비스 알림('동선 기록 중')을 띄우고, 앱을 닫으면 서비스도 닫는다(killServiceOnDestroy).
 *   안드로이드 13부터는 알림 권한이 없으면 이 알림이 알림창에 보이지 않아, 켤 때 알림 권한도 묻는다(거부해도 기록은 된다).
 * - 샘플은 스토어가 넘긴 함수만 받는다. 서버로 보내지 않는다. 받을 곳이 없으면(여행 진행이 끝남) 받기를 멈춘다.
 * - 앱을 새로 켜면(JS가 새로 뜨면) 이전 실행이 남긴 받기를 먼저 멈춘다. expo-task-manager는 등록한 작업을 저장해 두었다가
 *   앱이 뜰 때 되살리는데, 여행 진행 상태는 저장하지 않으므로 이때 진행 중인 기록은 있을 수 없다
 *   (강제 종료 뒤 다시 켰을 때 '동선 기록 중' 알림·위치 표시가 다시 뜨지 않게).
 * - 받는 중 오류가 오면(iOS 설정에서 '항상 허용'을 거둠 등) 권한과 기기 위치를 다시 보고, 받을 수 없으면 실패로 알린다
 *   (스토어가 옵션을 끄고 앱 안 감시로 돌아간다). 위치를 잠깐 모르는 일시 오류는 넘긴다.
 * - 빌드에 백그라운드 위치 설정이 없는지(이전 설정으로 만든 개발 빌드)는 권한을 보거나 받기를 시작할 때 난 오류로 가린다
 *   (core/live/background bgFailReason). 한 번 알면 그 뒤로 block()이 notInBuild를 돌려준다(missingInBuild).
 * - 네이티브 시작·정지는 순서대로 한 줄로 부른다(앞 진행의 정지가 뒤 진행의 시작보다 늦게 끝나 새 받기를 끄지 않게).
 */

export const BG_LOCATION_TASK = 'young-trip-bg-location';

/** 시작 전에 OS가 쥐고 있던 옛 위치는 버린다(앱을 다시 켰을 때 넘어오는 묶음) */
const STALE_MS = 60_000;

/** 안드로이드 포그라운드 서비스 알림. 동선은 이 기기에만, 스팟 도착은 여행방 방문 기록에 남는다(app.config.js 권한 문구와 같다) */
const ANDROID_NOTICE = {
  notificationTitle: 'Young Trip 동선 기록 중',
  notificationBody: '동선은 이 기기에만 남고, 스팟 도착은 여행방 방문 기록에 남습니다. 여행 진행을 끝내거나 기록을 끄면 멈춥니다.',
  killServiceOnDestroy: true,
};

type TaskManagerModule = typeof import('expo-task-manager');
type LocationTaskData = { locations?: Location.LocationObject[] };

const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function loadTaskManager(): TaskManagerModule | null {
  if (Platform.OS === 'web' || IN_EXPO_GO) return null;
  try {
    // 네이티브 모듈이 없는 빌드에서는 여기서 오류가 난다. 정적 import를 쓰면 이 파일을 불러오는 순간 앱이 깨진다.
    return require('expo-task-manager') as TaskManagerModule;
  } catch {
    return null;
  }
}

const TM = loadTaskManager();

/** 권한을 보거나 받기를 시작하다 빌드에 백그라운드 위치 설정이 없다는 것을 알았는지. 알면 그 뒤로 켤 수 없음이다 */
let missingInBuild = false;

/** 오류를 이유로 바꾸고, 빌드 설정이 없다는 오류면 기억한다 */
function failReason(e: unknown): BgFailReason {
  const reason = bgFailReason(e);
  if (reason === 'notInBuild') missingInBuild = true;
  return reason;
}

/** 지금 받는 중인 watch. 작업 실행기가 묶음과 오류를 넘긴다 */
let current: { handle: (batch: GpsSample[]) => void; fail: (reason: BgFailReason) => void } | undefined;
let chain: Promise<void> = Promise.resolve();

/** 네이티브 호출을 한 줄로 세운다. 실패해도 다음 호출은 이어서 부른다. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function stopUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    // 등록되지 않은 작업이면 멈출 것이 없다.
  }
}

/** '항상 허용' 권한 상태. 빌드에 백그라운드 위치 권한이 없으면(안드로이드 매니페스트에 ACCESS_BACKGROUND_LOCATION 없음) notInBuild */
export type BgPermission = LocationPermission | 'notInBuild';

/** 지금 '항상 허용' 권한 상태. 묻지 않는다 */
async function alwaysPermission(): Promise<BgPermission> {
  try {
    const res = await Location.getBackgroundPermissionsAsync();
    return res.status === 'granted' ? 'granted' : res.status === 'denied' ? 'denied' : 'undetermined';
  } catch (e) {
    // 이전 설정으로 만든 안드로이드 빌드는 권한을 보기만 해도 매니페스트 오류가 난다. 거부로 보면 설정에 없는 '항상 허용'을 안내하게 된다.
    return failReason(e) === 'notInBuild' ? 'notInBuild' : 'denied';
  }
}

/** 권한 상태를 받기 실패 이유로. 받을 수 있으면 undefined */
function permissionFail(p: BgPermission): BgFailReason | undefined {
  return p === 'granted' ? undefined : p === 'notInBuild' ? 'notInBuild' : 'denied';
}

/** 받는 중 오류가 왔을 때 받기가 끊긴 이유. 계속 받을 수 있으면(일시 오류) undefined */
async function lostReason(): Promise<BgFailReason | undefined> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) return 'servicesOff';
  } catch {
    // 확인하지 못하면 권한만 본다.
  }
  return permissionFail(await alwaysPermission());
}

function toSample(loc: Location.LocationObject): GpsSample {
  return {
    t: loc.timestamp,
    coord: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
    accuracyM: loc.coords.accuracy ?? null,
  };
}

if (TM && !TM.isTaskDefined(BG_LOCATION_TASK)) {
  TM.defineTask<LocationTaskData>(BG_LOCATION_TASK, async ({ data, error }) => {
    const target = current;
    if (!target) {
      await enqueue(stopUpdates);
      return;
    }
    if (error) {
      const reason = await lostReason();
      if (reason && current === target) target.fail(reason);
      return;
    }
    target.handle((data?.locations ?? []).map(toSample));
  });
}

// 앱을 새로 켰을 때 이전 실행이 남긴(작업 관리자가 되살린) 받기를 멈춘다. 진행을 시작하면 같은 줄 뒤에서 다시 켠다.
if (TM) void enqueue(stopUpdates);

/** noticeHidden: 안드로이드 알림 권한이 없어 '동선 기록 중' 알림이 알림창에 보이지 않는다(기록은 된다) */
export type BgEnableResult = { ok: true; noticeHidden?: boolean } | { ok: false; reason: BgRecordBlock | 'denied' | 'servicesOff' };

/**
 * 안드로이드 13(API 33)부터 포그라운드 서비스 알림도 알림 권한이 있어야 알림창에 보인다. 없으면 묻는다.
 * 허용되면(또는 묻지 않아도 되는 기기면) true. 알림 권한은 app.config.js android.permissions에 있다.
 */
async function ensureNoticePermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  try {
    const p = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (await PermissionsAndroid.check(p)) return true;
    return (await PermissionsAndroid.request(p)) === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export interface BackgroundLocation extends BgReceiver {
  /**
   * 이 환경에서 켤 수 없는 이유. 켤 수 있으면 undefined. 빌드 설정은 권한을 보거나 받기를 시작할 때 난 오류로 가리고,
   * 한 번 알면 그 뒤로 notInBuild다.
   */
  block(): BgRecordBlock | undefined;
  /** 지금 '항상 허용' 권한 상태. 묻지 않는다(진행을 시작할 때 본다). 빌드에 설정이 없으면 notInBuild */
  permission(): Promise<BgPermission>;
  /** 옵션을 켤 때만 부른다. 작업 관리자와 기기 위치를 보고, 앱 사용 중 권한 → 항상 허용(→ 안드로이드 13부터 알림) 순서로 묻는다 */
  enable(): Promise<BgEnableResult>;
  /** 받기 시작. 반환값을 부르면 멈춘다. 시작하지 못하거나 도중에 끊기면 onFail에 이유를 넘긴다 */
  watch(onSample: (s: GpsSample) => void, opts: { intervalMs: number; onFail: (reason: BgFailReason) => void }): () => void;
}

export function createBackgroundLocation(): BackgroundLocation {
  const block = () => bgRecordBlock({ platform: Platform.OS, expoGo: IN_EXPO_GO, taskManager: TM != null, missingInBuild });
  const permission = async (): Promise<BgPermission> => {
    const b = block();
    if (b) return b === 'notInBuild' ? 'notInBuild' : 'denied';
    return alwaysPermission();
  };
  return {
    block,
    stillSilent: backgroundStillSilent(Platform.OS),
    permission,
    async enable() {
      const first = block();
      if (first) return { ok: false, reason: first };
      let taskManager = false;
      try {
        taskManager = (await TM?.isAvailableAsync()) === true;
      } catch {
        // 확인하지 못하면 이 빌드에 없는 것으로 본다.
      }
      const reason = bgRecordBlock({ platform: Platform.OS, expoGo: IN_EXPO_GO, taskManager, missingInBuild });
      if (reason) return { ok: false, reason };
      try {
        // isBackgroundLocationAvailableAsync는 iOS에서 늘 참이고 안드로이드에서는 이 값과 같아 쓰지 않는다.
        if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: 'servicesOff' };
        let fg = await Location.getForegroundPermissionsAsync();
        if (fg.status !== 'granted') fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== 'granted') return { ok: false, reason: 'denied' };
        const bg = await Location.requestBackgroundPermissionsAsync();
        if (bg.status !== 'granted') return { ok: false, reason: 'denied' };
        return (await ensureNoticePermission()) ? { ok: true } : { ok: true, noticeHidden: true };
      } catch (e) {
        // 이전 설정으로 만든 빌드(안드로이드 매니페스트에 ACCESS_BACKGROUND_LOCATION 없음, iOS Info.plist 문구 없음)는
        // 권한을 묻는 순간 오류가 난다. 설정에 '항상 허용' 항목이 없으므로 권한이 아니라 빌드를 다시 만들라고 안내한다.
        const r = failReason(e);
        return { ok: false, reason: r === 'notInBuild' || r === 'servicesOff' ? r : 'denied' };
      }
    },
    watch(onSample, opts) {
      let stopped = false;
      let throttle: ThrottleState = {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const startedAt = Date.now();
      const emit = (out: { sample: GpsSample }[]) => {
        for (const x of out) onSample(x.sample);
      };
      // 간격 안이라 넘기지 않은 마지막 샘플(멈춘 자리)을 그 뒤로 간격만큼 샘플이 없으면 넘긴다. 그 사이 새 묶음이 오면 다시 잡는다.
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        const p = throttle.pending;
        if (!p) return;
        timer = setTimeout(
          () => {
            timer = undefined;
            if (stopped) return;
            const r = flushPending(throttle, Date.now(), { intervalMs: opts.intervalMs });
            throttle = r.state;
            emit(r.out);
            schedule();
          },
          Math.max(0, p.t + opts.intervalMs - Date.now()),
        );
      };
      const handle = (batch: GpsSample[]) => {
        if (stopped) return;
        const fresh = batch.filter((s) => s.t >= startedAt - STALE_MS);
        const r = throttleBatch(throttle, fresh, { intervalMs: opts.intervalMs });
        throttle = r.state;
        emit(r.out);
        schedule();
      };
      const finish = () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = undefined;
        if (current?.handle === handle) current = undefined;
        void enqueue(stopUpdates);
      };
      const fail = (reason: BgFailReason) => {
        if (stopped) return;
        finish();
        opts.onFail(reason);
      };
      current = { handle, fail };
      void enqueue(async (): Promise<BgFailReason | undefined> => {
        if (stopped) return undefined;
        const denied = permissionFail(await permission());
        if (denied) return denied;
        const req = backgroundWatchRequest(opts.intervalMs, Platform.OS);
        await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: req.timeIntervalMs,
          distanceInterval: req.distanceIntervalM,
          activityType: Location.ActivityType.Other,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: ANDROID_NOTICE,
        });
        // 시작을 기다리는 사이 멈췄으면 바로 다시 끈다.
        if (stopped) await stopUpdates();
        return undefined;
      }).then(
        (reason) => {
          if (reason) fail(reason);
        },
        (e: unknown) => fail(failReason(e)),
      );
      return () => {
        if (stopped) return;
        finish();
      };
    },
  };
}
