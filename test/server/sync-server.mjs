/**
 * 그룹 동기화 서버(WP2 소유, 마지막 순위). node:http만 쓴다. WebSocket은 쓰지 않는다.
 * EXPO_PUBLIC_SYNC_URL이 있을 때 앱의 HTTP 폴링 전송(src/services/sync/http.ts)이 여기에 붙는다.
 * 테스트는 확장자까지 적어 import하고('../server/sync-server.mjs') 포트 0으로 띄웠다가 닫는다.
 *
 * 저장은 메모리뿐이다(프로토타입). 여행방마다 받은 순서대로 seq를 매기고 같은 op.id는 한 번만 받는다.
 *
 *   POST /trips/:id/ops        본문 {ops}           → {acks:[{opId,seq}]}
 *   GET  /trips/:id/ops?after=N                     → {ops}(seq > N)
 *   GET  /invites/:code                             → {tripId, status} | {tripId, error:'revoked'} | {error:'notFound'}
 *   POST /reset                                     → 204(시연 리셋)
 *   OPTIONS *                                       → 204(CORS 사전 요청)
 *
 * 서버는 코드가 어느 방 것인지만 알려 주고, 최종 판정은 앱이 로그를 내려받아 core(lookupInviteInLogs)로 한다
 * (판정 로직을 core 하나에 모은다. 04 코드리뷰 회의). 합류할 수 없는 코드도 tripId를 준다. 이미 참여한 사람은
 * 만료·정원과 상관없이 방으로 들어가야 해서다. status는 로그를 훑은 간이 판정이고 참고용이다.
 * 간이 판정도 리듀서와 같은 뜻으로 센다. 합류는 그 시각(op.at)에 초대가 유효하고 자리가 있을 때만 활성으로 세고,
 * 나가기·내보내기·탈퇴(anonymize)는 방장이든 그룹원이든 활성에서 뺀다.
 *
 * 실행: node server/sync-server.mjs (PORT 기본 8787)
 */
import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

const MAX_BODY = 2 * 1024 * 1024;

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status, CORS);
    res.end();
    return;
  }
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('tooLarge'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 이 시각에 초대 코드로 합류할 수 있는지(리듀서 member/join validate와 같은 순서: 무효 → 만료 → 정원) */
function inviteOpen(invite, code, at, activeCount) {
  if (!invite || invite.code !== code) return false;
  if (invite.revokedAt != null && invite.revokedAt <= at) return false;
  if (at >= invite.expiresAt) return false;
  return activeCount < invite.capacity;
}

/** 로그를 훑어 초대 코드 상태를 판정한다(간이, 참고용). */
export function judgeInvite(ops, code, now) {
  let invite;
  let issued = false;
  let deleted = false;
  /** memberId → userId */
  const active = new Map();
  for (const op of ops) {
    switch (op.type) {
      case 'trip/create':
        for (const m of op.trip?.members ?? []) if (m.leftAt == null) active.set(m.id, m.userId);
        break;
      case 'trip/issueInvite':
        invite = { ...op.invite };
        if (op.invite?.code === code) issued = true;
        break;
      case 'trip/revokeInvite':
        if (invite && invite.revokedAt == null) invite.revokedAt = op.at;
        break;
      case 'trip/delete':
        deleted = true;
        break;
      case 'member/join': {
        const m = op.member;
        if (!m || active.has(m.id) || [...active.values()].includes(m.userId)) break;
        // 그 시각에 초대가 유효하고 자리가 있던 합류만 센다(동시 합류로 정원 초과된 op, 재발급 직전 코드의 op는 뺀다).
        if (inviteOpen(invite, op.inviteCode, op.at, active.size)) active.set(m.id, m.userId);
        break;
      }
      case 'member/leave':
      case 'member/remove':
      case 'member/anonymize':
        active.delete(op.memberId);
        break;
      default:
        break;
    }
  }
  if (!issued || deleted) return 'notFound';
  if (!invite || invite.code !== code) return 'revoked';
  if (invite.revokedAt != null && invite.revokedAt <= now) return 'revoked';
  if (now >= invite.expiresAt) return 'expired';
  if (active.size >= invite.capacity) return 'full';
  return 'ok';
}

/** 이 로그의 마지막 발급 코드가 code인지(무효화만 된 코드와 재발급으로 바뀐 코드를 가른다) */
function isCurrentCode(ops, code) {
  let current;
  for (const op of ops) if (op.type === 'trip/issueInvite') current = op.invite?.code;
  return current === code;
}

export function createSyncStore() {
  /** tripId → op[](seq 순) */
  const trips = new Map();
  return {
    push(tripId, ops) {
      const list = trips.get(tripId) ?? [];
      const acks = [];
      for (const op of ops) {
        if (!op || typeof op.id !== 'string' || op.tripId !== tripId) continue;
        const existing = list.find((o) => o.id === op.id);
        if (existing) {
          acks.push({ opId: op.id, seq: existing.seq });
          continue;
        }
        const seq = list.length === 0 ? 1 : list[list.length - 1].seq + 1;
        list.push({ ...op, seq });
        acks.push({ opId: op.id, seq });
      }
      trips.set(tripId, list);
      return acks;
    },
    pull(tripId, after) {
      return (trips.get(tripId) ?? []).filter((o) => o.seq > after);
    },
    lookup(code, now) {
      let revokedTrip;
      for (const [tripId, ops] of trips) {
        const st = judgeInvite(ops, code, now);
        if (st === 'notFound') continue;
        if (st === 'revoked' && !isCurrentCode(ops, code)) {
          revokedTrip ??= tripId;
          continue;
        }
        return { tripId, status: st };
      }
      return revokedTrip ? { tripId: revokedTrip, error: 'revoked' } : { error: 'notFound' };
    },
    reset() {
      trips.clear();
    },
  };
}

/**
 * 서버를 띄운다. now는 초대 만료 판정 시계다(테스트 주입용, 기본은 기기 시각).
 * 돌려주는 close()로 닫는다.
 */
export function startSyncServer({ port = 0, host = '127.0.0.1', now = () => Date.now() } = {}) {
  const store = createSyncStore();
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'reset') {
        store.reset();
        return send(res, 204);
      }
      if (parts[0] === 'trips' && parts.length === 3 && parts[2] === 'ops') {
        const tripId = parts[1];
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          if (!Array.isArray(body.ops)) return send(res, 400, { error: 'badRequest' });
          return send(res, 200, { acks: store.push(tripId, body.ops) });
        }
        if (req.method === 'GET') {
          const after = Number(url.searchParams.get('after') ?? 0) || 0;
          return send(res, 200, { ops: store.pull(tripId, after) });
        }
      }
      if (req.method === 'GET' && parts[0] === 'invites' && parts.length === 2) {
        return send(res, 200, store.lookup(parts[1], now()));
      }
      return send(res, 404, { error: 'notFound' });
    } catch (e) {
      return send(res, 400, { error: 'badRequest', detail: String(e?.message ?? e) });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        url: `http://${host}:${actual}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * 직접 실행 판정. import.meta.url은 퍼센트 인코딩되므로(공백 %20, 한글) 문자열로 비교하면
 * 이 저장소 경로에서 항상 거짓이다. 파일 경로로 풀고, 심볼릭 링크와 macOS NFD/NFC 차이까지 맞춰 비교한다.
 */
export function isDirectRun(moduleUrl, argv1) {
  if (!argv1) return false;
  const norm = (p) => {
    try {
      return realpathSync(p).normalize('NFC');
    } catch {
      return p.normalize('NFC');
    }
  };
  return norm(fileURLToPath(moduleUrl)) === norm(argv1);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const port = Number(process.env.PORT ?? 8787);
  startSyncServer({ port, host: '0.0.0.0' }).then(({ url }) => console.log(`sync-server ${url}`));
}
