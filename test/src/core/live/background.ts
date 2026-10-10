import { addDays, atKst, kstDate } from '../util';
import type { LiveMode } from './mode';

/**
 * 백그라운드 판정(NFR 백그라운드, WP5 소유, 순수).
 * 명세: 위치 기능은 앱이 화면에 떠 있을 때 쓴다. 화면 밖 기록은 사용자가 켜는 옵션(백그라운드 동선 기록)이고 기본은 꺼짐이다.
 * - 옵션이 꺼져 있으면 AppState가 background(또는 inactive)가 될 때 위치 감시와 시뮬레이터 재생을 멈춘다.
 *   돌아와도 그 사이 경로를 채우지 않는다. 공백 구간에 찍힌 샘플(OS가 늦게 넘긴 것 포함)은 버린다.
 *   빈 구간은 FR-804 기록 지도에서 점선으로 남는다(WP6).
 * - 옵션이 켜져 있으면(recording) 공백으로 보지 않는다. 화면 밖 샘플은 위치 로그와 도착 기록까지만 간다
 *   (engine.ingestSample). 화면 밖 도착은 방문 기록(journal/visit op, 앱 안 도착과 같이 여행방에 동기화)과
 *   진행 기록 한 줄로만 남고 도착 알림(토스트)은 없다. 지연 조정안·빈 시간 추천은 앱으로 돌아와서 본다.
 *   기기 위치로 오늘 날짜를 진행할 때만 켠다. 시뮬레이터·수동 진행에는 영향이 없다.
 * - 앱이 떠 있는 동안은 기록이 켜져 있어도 앱 안 감시를 함께 돌린다(watchPlan). iOS 백그라운드 받기는 20m 이동 조건이라
 *   멈춰 서면 샘플이 없다. 앱 안 감시가 30초 간격으로 도착 머묾을 잰다.
 * - 웹과 Expo Go는 화면 밖 위치를 받을 수 없어 켤 수 없다(bgRecordBlock). 개발 빌드가 필요하다.
 * - 진행을 끝내거나 옵션을 끄거나 진행 날짜가 오늘이 아니면 받기를 멈춘다(bgRecordRuns, bgRecordEndsAt).
 */

export type AppPhase = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface BackgroundState {
  inBackground: boolean;
  since?: number;
  /** 앱이 꺼져 있던 구간 [from, to) */
  gaps: { from: number; to: number }[];
  /** 백그라운드 동선 기록이 돌고 있는지. 켜져 있는 동안 화면 밖에 있던 구간은 공백이 아니다 */
  recording?: boolean;
  /** 이번 기록이 켜진 시각. 그 전 샘플은 기록 중이어도 오래 믿지 않는다(engine holdsLast) */
  recordingSince?: number;
  /**
   * 멈춰 있으면 백그라운드 받기가 샘플을 보내지 않는지(iOS 20m 이동 조건, backgroundWatchRequest).
   * 참이면 샘플이 없다는 것은 마지막 샘플 자리에 있다는 뜻이다. 안드로이드는 30초마다 오므로 끊기면 신호가 없는 것이다.
   */
  stillSilent?: boolean;
}

export const initialBackground: BackgroundState = { inBackground: false, gaps: [] };

export interface BackgroundAction {
  state: BackgroundState;
  /** 감시·재생을 모두 멈춰야 하는지(기록 중이면 백그라운드 받기는 남는다. 앱 안 감시는 watchPlan이 멈춘다) */
  stop: boolean;
  /** 돌아왔는지(재생은 자동으로 다시 켜지 않는다. 사용자가 누른다) */
  resumed: boolean;
}

export function onAppPhase(st: BackgroundState, phase: AppPhase, now: number): BackgroundAction {
  const away = phase === 'background' || phase === 'inactive';
  if (away && !st.inBackground) {
    // 기록 중이면 백그라운드 받기를 멈추지 않는다(화면 밖 샘플은 위치 로그와 도착 기록으로 간다).
    return { state: { ...st, inBackground: true, since: now }, stop: !st.recording, resumed: false };
  }
  if (phase === 'active' && st.inBackground) {
    const gap = !st.recording && st.since != null && now > st.since;
    const gaps = gap ? [...st.gaps, { from: st.since!, to: now }] : st.gaps;
    const { since: _since, ...rest } = st;
    return { state: { ...rest, inBackground: false, gaps }, stop: false, resumed: true };
  }
  return { state: st, stop: false, resumed: false };
}

/**
 * 백그라운드 동선 기록을 켜고 끈다. 보통은 앱이 떠 있을 때 바뀐다.
 * 화면 밖에서 바뀌면(기록 시작 실패 등) 그 시각을 공백 경계로 삼는다. 기록이 없던 앞 구간은 공백으로 닫고,
 * 기록이 끊긴 뒤 구간은 돌아올 때 공백이 된다.
 * 켤 때 그 시각(recordingSince)과 받기 방식(stillSilent)을 남긴다. 끄면 둘 다 지운다.
 */
export function setRecording(st: BackgroundState, on: boolean, now: number, opts: { stillSilent?: boolean } = {}): BackgroundState {
  if (!!st.recording === on) return st;
  const { recordingSince: _since, stillSilent: _silent, ...base } = st;
  const next: BackgroundState = on
    ? { ...base, recording: true, recordingSince: now, stillSilent: !!opts.stillSilent }
    : { ...base, recording: false };
  if (!st.inBackground) return next;
  if (on) {
    const gaps = st.since != null && now > st.since ? [...st.gaps, { from: st.since, to: now }] : st.gaps;
    return { ...next, gaps, since: now };
  }
  return { ...next, since: now };
}

/** 이 샘플을 받아도 되는지. 백그라운드 중이거나 공백 구간 안이면 버린다(경로 복원 안 함). */
export function acceptWhileForeground(st: BackgroundState, t: number): boolean {
  if (st.inBackground) return false;
  return !st.gaps.some((g) => t >= g.from && t < g.to);
}

/* ---------- 백그라운드 동선 기록 옵션 ---------- */

/** 켤 수 없는 이유. web: 웹, expoGo: Expo Go, notInBuild: 이 빌드에 작업 관리자가 없음 */
export type BgRecordBlock = 'web' | 'expoGo' | 'notInBuild';

export interface BgRecordEnv {
  /** Platform.OS */
  platform: string;
  /** Constants.executionEnvironment가 Expo Go(storeClient)인지 */
  expoGo: boolean;
  /** expo-task-manager 네이티브 모듈을 불러왔는지(isAvailableAsync까지 봤으면 그 결과) */
  taskManager: boolean;
  /** 권한을 보거나 받기를 시작하다 빌드에 백그라운드 위치 설정이 없다는 오류(bgFailReason notInBuild)를 이미 받았는지 */
  missingInBuild?: boolean;
}

/**
 * 이 환경에서 켤 수 있는지. 빌드에 백그라운드 위치 설정(iOS UIBackgroundModes, 안드로이드 ACCESS_BACKGROUND_LOCATION·
 * 포그라운드 서비스 권한)이 있는지는 미리 알 수 없다. expo-location isBackgroundLocationAvailableAsync는 iOS에서 늘 참이고
 * 안드로이드에서는 기기 위치 서비스가 켜져 있는지라 쓰지 않는다. 권한을 볼 때나 받기를 시작할 때 난 오류로 가리고(bgFailReason),
 * 한 번 알면 그 뒤로는 켤 수 없음으로 본다(missingInBuild).
 */
export function bgRecordBlock(env: BgRecordEnv): BgRecordBlock | undefined {
  if (env.platform === 'web') return 'web';
  if (env.expoGo) return 'expoGo';
  if (env.platform !== 'ios' && env.platform !== 'android') return 'notInBuild';
  if (!env.taskManager || env.missingInBuild) return 'notInBuild';
  return undefined;
}

/** 받기를 시작하지 못했거나 도중에 끊긴 이유. servicesOff: 기기 위치(위치 서비스)가 꺼져 있음 */
export type BgFailReason = 'notInBuild' | 'servicesOff' | 'denied' | 'failed';

/** 빌드 설정이 빠졌다는 오류 코드(네이티브 예외 이름에서 나온다) */
const NOT_IN_BUILD_CODES = new Set([
  // iOS: UIBackgroundModes location 없음, '항상 허용' 권한 문구(NSLocation*UsageDescription) 없음
  'ERR_LOCATION_UPDATES_UNAVAILABLE',
  'ERR_LOCATION_INFO_PLIST',
  'E_LOCATION_INFO_PLIST',
  // 안드로이드: 매니페스트에 ACCESS_BACKGROUND_LOCATION·포그라운드 서비스 권한 없음
  'ERR_NO_PERMISSION_IN_MANIFEST',
  'ERR_FOREGROUND_SERVICE_PERMISSIONS',
  // 작업 관리자 네이티브 모듈 없음
  'ERR_TASK_MANAGER_UNAVAILABLE',
  'ERR_TASK_MANAGER_NOT_FOUND',
]);

/**
 * expo-location 오류를 이유로 바꾼다. 오류 코드는 네이티브 예외 이름에서 나온다.
 * 빌드 설정이 빠진 것(NOT_IN_BUILD_CODES, 이전 설정으로 만든 개발 빌드)은 권한 규칙보다 먼저 본다.
 * 안드로이드 NoPermissionInManifest는 코드에 PERMISSION이 들어 있어 거부로 읽히면 설정에 '항상 허용' 항목이 없는데도
 * 권한을 바꾸라고 안내하게 된다. 그 밖에 화면 밖에서 시작하려 한 경우(ForegroundServiceStartNotAllowed) 등은 failed다.
 */
export function bgFailReason(err: unknown): BgFailReason {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = typeof e.message === 'string' ? e.message : '';
  if (NOT_IN_BUILD_CODES.has(code)) return 'notInBuild';
  if (/UIBackgroundModes|Info\.plist|AndroidManifest|not found in the manifest|task[- ]manager/i.test(msg)) return 'notInBuild';
  if (code === 'ERR_LOCATION_SERVICES_DISABLED' || /services are disabled/i.test(msg)) return 'servicesOff';
  if (/PERMISSION|UNAUTHORIZED/.test(code) || /permission|not authorized/i.test(msg)) return 'denied';
  return 'failed';
}

/**
 * 이번 진행에서 백그라운드 받기를 실제로 돌릴지. 옵션이 켜져 있고 기기 위치로 오늘 날짜를 진행할 때만이다.
 * 오늘이 아닌 날짜(지난 날짜·앞날)로 진행하면 쓰지 않는다. 기록 지도는 그날 시각의 점만 쓰므로 남겨도 보이지 않는다.
 * 자정을 넘기면(진행을 켜 둔 채 잊은 경우) 멈춘다. 그날 동선만 남긴다.
 */
export function bgRecordRuns(o: {
  pref: boolean;
  mode: LiveMode;
  block: BgRecordBlock | undefined;
  /** 진행 날짜(YYYY-MM-DD, KST) */
  date: string;
  now: number;
}): boolean {
  return o.pref && o.mode === 'device' && o.block == null && kstDate(o.now) === o.date;
}

/** 진행 날짜의 백그라운드 받기가 끝나는 시각(다음 날 KST 0시). 샘플이 없어도 이 시각에 멈춘다(정지 중에는 샘플이 없다) */
export function bgRecordEndsAt(date: string): number {
  return atKst(addDays(date, 1), '00:00');
}

export interface WatchPlan {
  /** 앱 안 감시(기기·시뮬레이터). 앱이 떠 있을 때만 */
  fg: boolean;
  /** 백그라운드 받기 */
  bg: boolean;
  /** 돌던 백그라운드 받기를 멈추는 이유. off: 옵션 끔, dateOver: 진행 날짜가 지남 */
  bgStop?: 'off' | 'dateOver';
}

/**
 * 지금 돌려야 할 위치 받기. 스토어(store/live syncWatch)는 이 결과에 맞춰 켜고 끄기만 한다.
 * 진행 시작·앱 상태 변화·옵션 켜고 끄기·시계 틱·샘플·자정 타이머가 모두 이것을 부른다.
 * - fg: 기기·시뮬레이터 진행이고 앱이 떠 있으면 켠다. 백그라운드 받기가 돌아도 함께 돌린다.
 * - bg: bgRecordRuns가 참일 때만. 화면 밖에서는 새로 켜지 않는다(안드로이드 12부터 화면 밖에서 포그라운드 서비스를
 *   띄울 수 없다). 이미 돌던 것은 날짜가 지나거나 옵션을 끌 때까지 그대로 둔다.
 *   진행 날짜 전날 밤에 시작해 앱을 켜 둔 채 자정이 지나면 시계 틱이 이것을 불러 그때 켠다. 화면 밖에서 자정을 넘겼으면
 *   앱으로 돌아올 때 켠다.
 */
export function watchPlan(o: {
  pref: boolean;
  mode: LiveMode;
  block: BgRecordBlock | undefined;
  date: string;
  now: number;
  inBackground: boolean;
  /** 지금 백그라운드 받기가 돌고 있는지 */
  bgActive: boolean;
}): WatchPlan {
  const fg = (o.mode === 'device' || o.mode === 'sim') && !o.inBackground;
  const runs = bgRecordRuns(o);
  const bg = runs && (!o.inBackground || o.bgActive);
  if (o.bgActive && !bg) return { fg, bg, bgStop: o.pref && kstDate(o.now) !== o.date ? 'dateOver' : 'off' };
  return { fg, bg };
}

/** 진행 기록 한 줄(백그라운드 동선 기록). 앱을 켜 둔 동안의 기록은 그대로라고 함께 알린다 */
export const BG_LINE = {
  on: '백그라운드 동선 기록 켜짐 · 앱이 화면 밖에 있어도 동선과 도착을 남김',
  notToday: '오늘 날짜가 아니라 백그라운드 기록은 쓰지 않음 · 앱을 켜 둔 동안만 기록',
  off: '백그라운드 기록 끔 · 앱을 켜 둔 동안만 기록',
  dateOver: '진행 날짜가 지나 백그라운드 기록을 멈춤 · 앱을 켜 둔 동안만 기록',
  noAlways: '위치 항상 허용이 없어 백그라운드 기록을 껐습니다 · 앱을 켜 둔 동안만 기록',
} as const;

/** 받기를 시작하지 못했거나 도중에 끊겨 옵션을 껐을 때 진행 기록 한 줄 */
export const BG_FAIL_LINE: Record<BgFailReason, string> = {
  notInBuild: '이 빌드에는 백그라운드 위치 설정이 없어 백그라운드 기록을 껐습니다 · 앱을 켜 둔 동안만 기록',
  servicesOff: '기기 위치가 꺼져 있어 백그라운드 기록을 껐습니다 · 앱을 켜 둔 동안만 기록',
  denied: BG_LINE.noAlways,
  failed: '백그라운드 기록을 시작하지 못해 껐습니다 · 앱을 켜 둔 동안만 기록',
};
