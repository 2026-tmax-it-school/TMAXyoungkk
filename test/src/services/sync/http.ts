import type { Op } from '../../types';
import type { Clock, FetchLike, InviteLookup, SyncTransport } from '../../core/ports';
import { lookupInviteInLogs } from '../../core/trip/lookup';
import { OFFLINE_ERROR } from './loopback';

/**
 * HTTP 폴링 전송(WP2 소유, 마지막 순위). server/sync-server.mjs와 짝이다.
 * EXPO_PUBLIC_SYNC_URL이 있을 때만 쓴다. WebSocket은 쓰지 않고, 구독은 pollMs마다 pull한다.
 *
 * - push: 여행방별로 POST /trips/:id/ops
 * - pull: GET /trips/:id/ops?after=N
 * - lookupInvite: GET /invites/:code로 tripId를 받고, 로그를 내려받아 core/trip 판정(lookupInviteInLogs)으로 최종 판정한다.
 *   서버의 status는 참고용이라 쓰지 않는다. 합류할 수 없는 코드도 tripId를 실어 돌려준다(이미 참여한 사람 확인용)
 * - 오프라인(setOnline(false))이면 push·pull·lookupInvite가 던지고 폴링을 쉰다
 * 웹에서는 서버가 CORS 헤더와 OPTIONS 응답을 준다. 비보안 출처(LAN http) 시연은 추적표 한계 항목이다.
 */
export function createHttpTransport(opts: {
  url: string;
  fetch: FetchLike;
  clock: Clock;
  pollMs?: number;
  /** 요청 하나를 기다리는 최대 시간. 넘으면 실패로 보고 스토어가 다음 차례에 다시 보낸다 */
  timeoutMs?: number;
}): SyncTransport {
  const base = opts.url.replace(/\/+$/, '');
  const pollMs = opts.pollMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let isOnline = true;

  async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    if (!isOnline) throw new Error(OFFLINE_ERROR);
    // FetchLike에는 중단 신호가 없어 시간 제한으로만 끊는다. 걸린 요청 하나가 재연결 흐름 전체를 붙잡지 않게 한다.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      opts.fetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('동기화 서버 응답 시간 초과')), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    const text = await res.text();
    if (!res.ok) throw new Error(`동기화 서버 오류 ${res.status}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function pull(tripId: string, afterSeq: number): Promise<Op[]> {
    const r = await call<{ ops?: Op[] }>(`/trips/${encodeURIComponent(tripId)}/ops?after=${afterSeq}`);
    return r.ops ?? [];
  }

  return {
    id: 'http',
    async push(ops) {
      const byTrip = new Map<string, Op[]>();
      for (const op of ops) byTrip.set(op.tripId, [...(byTrip.get(op.tripId) ?? []), op]);
      const acks: { opId: string; seq: number }[] = [];
      for (const [tripId, list] of byTrip) {
        const r = await call<{ acks?: { opId: string; seq: number }[] }>(`/trips/${encodeURIComponent(tripId)}/ops`, {
          method: 'POST',
          body: { ops: list },
        });
        acks.push(...(r.acks ?? []));
      }
      return acks;
    },
    pull,
    subscribe(tripId, onOps) {
      let after = 0;
      let busy = false;
      let stopped = false;
      const tick = async () => {
        if (busy || stopped || !isOnline) return;
        busy = true;
        try {
          const ops = await pull(tripId, after);
          for (const o of ops) if ((o.seq ?? 0) > after) after = o.seq as number;
          if (ops.length > 0 && !stopped) onOps(ops);
        } catch {
          // 폴링 실패는 다음 차례에 다시 한다.
        } finally {
          busy = false;
        }
      };
      void tick();
      const timer = setInterval(() => void tick(), pollMs);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
    online: () => isOnline,
    setOnline(v) {
      isOnline = v;
    },
    async lookupInvite(code): Promise<InviteLookup> {
      const r = await call<{ tripId?: string }>(`/invites/${encodeURIComponent(code)}`);
      if (!r.tripId) return { error: 'notFound' };
      const ops = await pull(r.tripId, 0);
      return lookupInviteInLogs([ops], code, opts.clock.now());
    },
    async reset() {
      try {
        await call('/reset', { method: 'POST', body: {} });
      } catch {
        // 서버가 없거나 오프라인이면 건너뛴다.
      }
    },
  };
}
