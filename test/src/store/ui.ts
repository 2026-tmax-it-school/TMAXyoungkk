import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS, STORAGE_VERSION } from '../core/constants';
import { persistStorage, waitForHydration } from '../services/kv';

/**
 * 화면 상태(공유). 지금 보고 있는 여행방, 방마다 '누구로 행동하는지'(같은 기기 시연용), 토스트.
 * 탭 화면(후보·시간표·지도)은 currentTripId를 보여주고, 없으면 Empty와 여행방 만들기를 보여준다.
 */

export interface ToastState {
  id: number;
  text: string;
  tone: 'soft' | 'warn';
}

export interface UiState {
  currentTripId?: string;
  /** tripId → memberId. 같은 기기에서 다른 멤버로 말하기·합류하기(시연) */
  actingAs: Record<string, string>;
  toast?: ToastState;

  setCurrentTrip: (id?: string) => void;
  setActingAs: (tripId: string, memberId: string) => void;
  showToast: (text: string, tone?: 'soft' | 'warn') => void;
  clearToast: (id?: number) => void;
  reset: () => void;
  waitHydrated: () => Promise<void>;
}

let toastSeq = 0;

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      currentTripId: undefined,
      actingAs: {},
      toast: undefined,

      setCurrentTrip: (id) => set({ currentTripId: id }),
      setActingAs: (tripId, memberId) => set({ actingAs: { ...get().actingAs, [tripId]: memberId } }),
      showToast: (text, tone = 'soft') => {
        toastSeq += 1;
        set({ toast: { id: toastSeq, text, tone } });
      },
      clearToast: (id) => {
        const cur = get().toast;
        if (!cur) return;
        if (id == null || cur.id === id) set({ toast: undefined });
      },
      reset: () => set({ currentTripId: undefined, actingAs: {}, toast: undefined }),
      waitHydrated: (): Promise<void> => waitForHydration(useUi),
    }),
    {
      name: STORAGE_KEYS.ui,
      version: STORAGE_VERSION,
      storage: persistStorage,
      partialize: (s) => ({ currentTripId: s.currentTripId, actingAs: s.actingAs }),
    },
  ),
);
