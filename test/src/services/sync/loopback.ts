import type { Op } from '../../types';
import type { Clock, InviteLookup, KV, SyncTransport } from '../../core/ports';
import { lookupInviteInLogs } from '../../core/trip/lookup';

/**
 * 루프백 전송(WP2 소유, 기본 동기화). 한 기기 안에서 서버 역할을 흉내 낸다. 받은 순서대로 seq를 매긴다.
 * 같은 op.id는 한 번만 받고, 다시 오면 처음 매긴 seq로 확인 응답만 한다.
 *
 * - 저장: KV 색인 키 하나('index')에 전체를 JSON으로 둔다(계약 A11 서비스 KV 규칙). 새로고침 뒤에도 유지된다.
 * - 초대 조회: 받은 op를 방마다 접어 판정한다(core/trip/lookup). 예전 코드는 revoked다.
 * - reset(): 메모리와 KV를 비운다. 시연 리셋 뒤 옛 op가 되살아나지 않는다.
 * - 오프라인(setOnline(false)): push·pull·lookupInvite가 던진다. 스토어는 pending으로 남겨 두었다가 재연결 때 보낸다.
 * - chaos(테스트 주입 전용): 구독 전달·pull 결과·확인 응답의 순서를 시드 고정으로 뒤섞고, op를 중복해서 보낸다.
 *   시연은 setOnline 토글만 쓴다(03 결정 C14).
 */
export interface Chaos {
  shuffle: boolean;
  duplicate: boolean;
  seed: number;
}

const INDEX_KEY = 'index';

interface Stored {
  v: 1;
  seq: number;
  trips: Record<string, Op[]>;
}

/** mulberry32. 시드가 같으면 같은 순서다. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OFFLINE_ERROR = '오프라인이라 보낼 수 없습니다';

export function createLoopbackTransport(opts: { clock: Clock; kv: KV; chaos?: Chaos }): SyncTransport {
  const { clock, kv, chaos } = opts;
  const rand = seeded(chaos?.seed ?? 1);
  let isOnline = true;
  let state: Stored = { v: 1, seq: 0, trips: {} };
  let loading: Promise<void> | undefined;
  const subs = new Map<string, Set<(ops: Op[]) => void>>();

  function load(): Promise<void> {
    if (!loading) {
      loading = (async () => {
        try {
          const raw = await kv.get(INDEX_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw) as Stored;
          if (parsed && parsed.v === 1 && parsed.trips) state = parsed;
        } catch {
          // 깨진 저장분은 버리고 빈 상태로 시작한다.
        }
      })();
    }
    return loading;
  }

  async function save(): Promise<void> {
    try {
      await kv.set(INDEX_KEY, JSON.stringify(state));
    } catch {
      // 저장 실패는 메모리 상태로 계속한다(다음 push 때 다시 저장한다).
    }
  }

  /** chaos: 순서 뒤섞기와 중복 주입 */
  function scramble<T>(list: T[]): T[] {
    if (!chaos) return list;
    let out = [...list];
    if (chaos.duplicate) {
      const extra = out.filter(() => rand() < 0.4);
      out = [...out, ...extra];
    }
    if (chaos.shuffle) {
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
    }
    return out;
  }

  function assertOnline() {
    if (!isOnline) throw new Error(OFFLINE_ERROR);
  }

  return {
    id: 'loopback',
    async push(ops) {
      assertOnline();
      await load();
      const acks: { opId: string; seq: number }[] = [];
      const fresh = new Map<string, Op[]>();
      for (const op of ops) {
        const list = state.trips[op.tripId] ?? [];
        const existing = list.find((o) => o.id === op.id);
        if (existing) {
          acks.push({ opId: op.id, seq: existing.seq as number });
          continue;
        }
        state.seq += 1;
        const stored = { ...op, seq: state.seq } as Op;
        state.trips[op.tripId] = [...list, stored];
        fresh.set(op.tripId, [...(fresh.get(op.tripId) ?? []), stored]);
        acks.push({ opId: op.id, seq: state.seq });
      }
      if (fresh.size > 0) await save();
      for (const [tripId, list] of fresh) {
        const batch = scramble(list);
        // 구독자 오류가 전송(확인 응답)과 다른 구독자에게 번지지 않게 한 명씩 막는다. 이미 저장했으니 pull로도 받을 수 있다.
        subs.get(tripId)?.forEach((fn) => {
          try {
            fn(batch);
          } catch {
            // 구독자 쪽 오류는 무시한다.
          }
        });
      }
      return scramble(acks);
    },
    async pull(tripId, afterSeq) {
      assertOnline();
      await load();
      return scramble((state.trips[tripId] ?? []).filter((o) => (o.seq ?? 0) > afterSeq));
    },
    subscribe(tripId, onOps) {
      const set = subs.get(tripId) ?? new Set();
      set.add(onOps);
      subs.set(tripId, set);
      return () => {
        set.delete(onOps);
      };
    },
    online: () => isOnline,
    setOnline(v) {
      isOnline = v;
    },
    async lookupInvite(code): Promise<InviteLookup> {
      assertOnline();
      await load();
      return lookupInviteInLogs(Object.values(state.trips), code, clock.now());
    },
    async reset() {
      await load();
      state = { v: 1, seq: 0, trips: {} };
      try {
        await kv.remove(INDEX_KEY);
      } catch {
        // 지우기 실패는 무시한다(메모리는 비었다).
      }
    },
  };
}
