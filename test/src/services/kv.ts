import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

import type { KV } from '../core/ports';

/** AsyncStorage 위의 KV(웹은 localStorage). 키 앞에 prefix를 붙인다. 예: 'young-trip/' */
export function asyncStorageKV(prefix: string): KV {
  return {
    get: (key) => AsyncStorage.getItem(prefix + key),
    set: (key, value) => AsyncStorage.setItem(prefix + key, value),
    remove: (key) => AsyncStorage.removeItem(prefix + key),
  };
}

/** zustand persist 저장소. 스토어 persist 이름은 constants.STORAGE_KEYS(young-trip/* v2)를 쓴다. */
export const persistStorage = createJSONStorage(() => AsyncStorage);

interface PersistApi {
  persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void };
}

/**
 * persist 복원이 끝날 때까지 기다린다. 저장소 오류로 복원 알림이 오지 않아도 timeoutMs 뒤에는 넘어간다.
 * 모든 스토어의 waitHydrated()가 이것을 쓴다(부팅 스플래시가 기다린다).
 */
export function waitForHydration(store: PersistApi, timeoutMs = 5000): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve();
    }, timeoutMs);
    const off = store.persist.onFinishHydration(() => {
      clearTimeout(timer);
      off();
      resolve();
    });
  });
}
