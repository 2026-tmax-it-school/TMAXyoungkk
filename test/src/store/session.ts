import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { NotifyKind, NotifyLogEntry, NotifyPrefs, Session } from '../types';
import { DEFAULT_NOTIFY_PREFS, STORAGE_KEYS, STORAGE_VERSION } from '../core/constants';
import { recordNotify } from '../core/notify';
import type { AccountPublic, Profile } from '../core/ports';
import { accountSession, issueGuest, keepSession, newDeviceToken, touchOrExpire, type KeepResult } from '../core/session';
import { appClock } from '../services/clock';
import { persistStorage, waitForHydration } from '../services/kv';
import { secureRng } from '../services/random';

/**
 * 세션·프로필·알림 설정(WP1 소유).
 * - 게스트(FR-105)와 계정(FR-102) 세션 모두 30일이고 touchSession마다 연장된다. 만료면 폐기한다.
 * - 기기 토큰(deviceToken)은 로그아웃해도 남는다. 로그인 시도 제한을 기기 기준으로 세기 때문이다(IP 대신, 가정).
 * - 로그아웃은 세션과 프로필을 지운다(다음 게스트가 이전 계정의 태그·이미지를 물려받지 않게). 여행방은 trips 스토어에
 *   그대로 있어서 같은 계정으로 다시 로그인하면 이어 쓰고, 프로필은 applyAuth가 계정 것으로 되돌린다.
 *   지금 여행방(ui.currentTripId) 정리는 flows.signOutFlow가 한다(ui 스토어를 거치는 흐름).
 * - 여러 스토어를 거치는 흐름(승격의 member/accountLinked, 탈퇴의 사진 삭제·익명화)은
 *   features/account/flows.ts가 맡는다. 이 파일이 trips 스토어를 import하면 순환이 생겨서다.
 *   deleteAccount 액션은 flows가 등록한 처리기를 부른다.
 */

export type DeleteAccountResult = { ok: true } | { ok: false; reason: string };

export interface SessionState {
  session?: Session;
  profile: Profile;
  notifyPrefs: NotifyPrefs;
  notifyLog: NotifyLogEntry[];
  /** 기기 위치 사용 여부(18 설정). 꺼져 있으면 시뮬레이터나 수동 진행만 쓴다. */
  useDeviceLocation: boolean;
  /** 구 저장 키 삭제 안내를 한 번 보였는지 */
  legacyNoticeShown: boolean;
  /** 이 기기의 토큰. 로그아웃해도 남는다(기기 기준 로그인 시도 제한) */
  deviceToken?: string;
  /** sessionExpiry를 이미 띄운 세션 창(key). '만료 3일 전에 한 번'의 영구 표식이다 */
  expiryNotifiedKey?: string;
  /** 마지막 touchSession이 폐기한 세션 종류(부팅 안내 문구용, 저장하지 않는다) */
  expiredKind?: Session['kind'];

  createGuest: (nickname: string) => Session;
  touchSession: () => 'ok' | 'expired' | 'none';
  /** 앱을 쓰는 중 시각이 흐를 때 부른다(core/session.keepSession). 폐기·연장·만료 전 알림 기록까지 한다 */
  keepAlive: () => KeepResult;
  signOut: () => void;
  applyAuth: (account: AccountPublic) => void;
  setProfile: (p: Partial<Profile>) => void;
  setNotifyPref: (kind: NotifyKind, on: boolean) => void;
  setUseDeviceLocation: (on: boolean) => void;
  deleteAccount: () => Promise<DeleteAccountResult>;
  /** 알림을 띄웠다고 기록한다(공유 core/notify.recordNotify) */
  noteNotified: (entry: NotifyLogEntry) => void;
  markLegacyNoticeShown: () => void;
  /** 이 기기 토큰. 없으면 만든다 */
  ensureDeviceToken: () => string;
  reset: () => void;
  waitHydrated: () => Promise<void>;
}

const initial = {
  session: undefined,
  profile: { nickname: '', tags: [] } as Profile,
  notifyPrefs: DEFAULT_NOTIFY_PREFS,
  notifyLog: [] as NotifyLogEntry[],
  useDeviceLocation: false,
  legacyNoticeShown: false,
  deviceToken: undefined as string | undefined,
  expiryNotifiedKey: undefined as string | undefined,
  expiredKind: undefined as Session['kind'] | undefined,
};

let deleteHandler: (() => Promise<DeleteAccountResult>) | undefined;

/** features/account/flows가 계정 탈퇴 처리기를 등록한다(trips 스토어를 거치는 흐름). */
export function registerAccountDeletion(fn: () => Promise<DeleteAccountResult>): void {
  deleteHandler = fn;
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      ...initial,

      createGuest: (nickname) => {
        // 이 기기 토큰을 그대로 쓴다. 제한 기준 토큰과 화면의 끝 4자리가 늘 같다.
        const session = issueGuest({ nickname, rng: secureRng, now: appClock().now(), deviceToken: get().deviceToken });
        set({
          session,
          deviceToken: session.deviceToken,
          profile: { ...initial.profile, tags: [], nickname },
          expiredKind: undefined,
        });
        return session;
      },

      touchSession: () => {
        const r = touchOrExpire(get().session, appClock().now());
        if (r.state === 'none') return 'none';
        if (r.state === 'expired') {
          // FR-105 만료 세션은 폐기한다. 안내 문구는 bootstrap notices가 낸다.
          set({ session: undefined, expiredKind: r.expired.kind });
          return 'expired';
        }
        set({ session: r.session, expiredKind: undefined });
        return 'ok';
      },

      keepAlive: () => {
        const st = get();
        const r = keepSession(st.session, appClock().now(), st.notifyLog, st.notifyPrefs, st.expiryNotifiedKey);
        if (r.state === 'expired') set({ session: undefined, expiredKind: r.expired.kind });
        if (r.state === 'touched') {
          set({ session: r.session, expiredKind: undefined });
          if (r.notice) get().noteNotified(r.notice.entry);
        }
        return r;
      },

      signOut: () => set({ session: undefined, profile: { ...initial.profile, tags: [] }, expiredKind: undefined }),

      applyAuth: (account) => {
        const cur = get();
        const deviceToken = cur.session?.deviceToken ?? cur.ensureDeviceToken();
        const session = accountSession({ account, deviceToken, rng: secureRng, now: appClock().now() });
        set({ session, profile: { ...account.profile, tags: [...account.profile.tags] }, expiredKind: undefined });
      },

      setProfile: (p) => set({ profile: { ...get().profile, ...p } }),
      setNotifyPref: (kind, on) => set({ notifyPrefs: { ...get().notifyPrefs, [kind]: on } }),
      setUseDeviceLocation: (on) => set({ useDeviceLocation: on }),

      deleteAccount: async () => {
        if (get().session?.kind !== 'account') return { ok: false, reason: '게스트는 탈퇴할 계정이 없습니다' };
        if (!deleteHandler) return { ok: false, reason: '계정 탈퇴 처리기가 준비되지 않았습니다' };
        return deleteHandler();
      },

      noteNotified: (entry) =>
        set({
          notifyLog: recordNotify(get().notifyLog, entry, entry.at),
          ...(entry.kind === 'sessionExpiry' ? { expiryNotifiedKey: entry.key } : {}),
        }),
      markLegacyNoticeShown: () => set({ legacyNoticeShown: true }),

      ensureDeviceToken: () => {
        const cur = get().deviceToken ?? get().session?.deviceToken;
        if (cur) {
          if (!get().deviceToken) set({ deviceToken: cur });
          return cur;
        }
        const t = newDeviceToken(secureRng);
        set({ deviceToken: t });
        return t;
      },

      reset: () => set({ ...initial }),
      waitHydrated: (): Promise<void> => waitForHydration(useSession),
    }),
    {
      name: STORAGE_KEYS.session,
      version: STORAGE_VERSION,
      storage: persistStorage,
      partialize: (s) => ({
        session: s.session,
        profile: s.profile,
        notifyPrefs: s.notifyPrefs,
        notifyLog: s.notifyLog,
        useDeviceLocation: s.useDeviceLocation,
        legacyNoticeShown: s.legacyNoticeShown,
        deviceToken: s.deviceToken,
        expiryNotifiedKey: s.expiryNotifiedKey,
      }),
    },
  ),
);

/** 지금 사람의 userId. 세션이 없으면 undefined */
export function getUserId(): string | undefined {
  return useSession.getState().session?.userId;
}
