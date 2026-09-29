import type { KV } from './ports';

/** 메모리 KV. 테스트와 모의 제공자가 쓴다. 앱 저장소는 services/kv.ts의 asyncStorageKV다. */
export function memoryKV(initial?: Record<string, string>): KV & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    async get(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map);
    },
  };
}
