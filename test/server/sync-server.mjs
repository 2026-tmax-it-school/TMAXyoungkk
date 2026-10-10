/**
 * 그룹 동기화 서버(WP2 소유, 마지막 순위). node:http만 쓴다. WebSocket은 쓰지 않는다.
 * EXPO_PUBLIC_SYNC_URL이 있을 때 앱의 HTTP 폴링 전송(src/services/sync/http.ts)이 여기에 붙는다.
 * 테스트는 확장자까지 적어 import하고('../server/sync-server.mjs') 포트 0으로 띄웠다가 닫는다.
 *
 * 저장소는 둘이다. 결과 모양과 seq·멱등 규칙이 같다.
 * - 메모리(createSyncStore): DATABASE_URL이 없을 때. 서버를 끄면 사라진다
 * - PostgreSQL(server/db/postgres-store.mjs): DATABASE_URL이 있을 때. 붙지 못하면 서버가 시작하지 않는다(메모리로 바꾸지 않는다)
 * 여행방마다 받은 순서대로 seq를 매기고 같은 op.id는 한 번만 받는다.
 *
 *   POST /trips/:id/ops        본문 {ops}           → {acks:[{opId,seq}]}
 *   GET  /trips/:id/ops?after=N                     → {ops}(seq > N)
 *   GET  /invites/:code                             → {tripId, status} | {tripId, error:'revoked'} | {error:'notFound'}
 *   GET  /health                                    → {ok, db:'postgres'|'memory'}(DB에 못 닿으면 503)
 *   POST /reset                                     → 204(시연 리셋) | 403 {error:'resetDisabled'}
 *   GET  /kakao/…, /osrm/…                          → 키 숨기는 중계(server/proxy.mjs). 카카오 장소·자동차 길찾기, OSRM 길
 *   /auth/…                                         → 계정·로그인(server/auth.mjs. 가입·인증·로그인·세션·프로필·탈퇴·재설정·모의 소셜·
 *                                                      구글·카카오 OAuth(server/oauth.mjs))
 *   OPTIONS *                                       → 204(CORS 사전 요청)
 *
 * 시연 리셋은 서버의 여행방을 모두 지운다. 메모리 저장소는 늘 허용하고, PostgreSQL은 SYNC_ALLOW_RESET=1일 때만 허용한다
 * (같은 DB를 쓰는 모든 사람의 데이터가 지워지므로 기본은 막는다. 앱 시연 리셋은 실패를 무시하고 이 기기만 비운다).
 * 초대 코드 판정은 server/invites.mjs에 있다(최종 판정은 앱 core가 로그로 한다).
 * 보관 기한 정리: 시작 때 한 번, 그 뒤 하루 한 번 종료일 다음 날 00:00 KST + 365일이 지난 여행방을 지운다(server/retention.mjs).
 * 생성 op를 받지 못한 방은 마지막으로 받은 뒤 365일이 지나면 지운다.
 * 계정 탈퇴(member/anonymize)·사진 삭제(journal/photoRemoved)를 받으면 로그 본문에서 그 닉네임과 사진 주소·위치를 가린다(server/redact.mjs).
 * 요청 본문이 잘못되면 400, 저장소 오류는 500이다. 앱은 둘 다 실패로 보고 다음 차례에 다시 보낸다.
 * 경로의 tripId가 키로 못 쓰는 값(NUL, 짝 없는 서로게이트, 200자 초과)이면 400, 그런 초대 코드는 notFound다(server/ids.mjs).
 *
 * 중계: 앱(EXPO_PUBLIC_API_URL)이 카카오·ODsay 키 없이 여기를 거친다. 카카오 키는 서버 변수 KAKAO_REST_KEY,
 * 대중교통(ODsay) 키는 ODSAY_API_KEY에만 두고,
 * OSRM 상류는 OSRM_URL(기본 공개 서버)이다. 허용 목록·속도 제한·캐시·동시 요청 규칙은 server/proxy.mjs에 있다.
 * 중계 응답 캐시는 저장소의 routeCache다(PostgreSQL route_cache, 메모리면 MEMORY_ROUTE_CACHE_LIMIT까지).
 *
 * 실행: npm run server (server/.env가 있으면 읽는다. PORT 기본 8787, DATABASE_URL 없으면 메모리)
 */
import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createAuthService, createMemoryAuthStore, devOutboxFromEnv, isAuthPath } from './auth.mjs';
import { projectOps } from './db/projection.mjs';
import { storableId } from './ids.mjs';
import { judgeInvite, lookupInTrips } from './invites.mjs';
import { describeOAuth, oauthOptionsFromEnv } from './oauth.mjs';
import { createApiProxy, isProxyPath, proxyOptionsFromEnv } from './proxy.mjs';
import { REDACT_TRIGGER_TYPES, redactLog } from './redact.mjs';
import { ORPHAN_RETENTION_MS, PURGE_EVERY_MS, ROUTE_CACHE_TTL_MS, retentionUntil } from './retention.mjs';

export { judgeInvite };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '600',
};

const MAX_BODY = 2 * 1024 * 1024;

function send(res, status, body, headers = {}) {
  if (body === undefined) {
    res.writeHead(status, { ...CORS, ...headers });
    res.end();
    return;
  }
  res.writeHead(status, { ...CORS, ...headers, 'Content-Type': 'application/json; charset=utf-8' });
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

/** 메모리 경로 캐시 상한. 넘으면 오래 둔 것부터 버린다(중계가 서로 다른 요청으로 서버 메모리를 키우지 못하게) */
export const MEMORY_ROUTE_CACHE_LIMIT = Object.freeze({ entries: 2000, chars: 20 * 1024 * 1024 });

/**
 * 메모리 저장소. 메서드는 동기로 돌려준다(서버는 await로 두 저장소를 같이 다룬다).
 * 받을 op가 하나도 없으면 방을 만들지 않는다(PostgreSQL 저장소와 같다). warn은 보관 기한 정리에서 건너뛴 방을 받는다.
 * 경로 캐시는 routeCacheLimit(개수, JSON 글자 수 합)까지 두고, 넣을 때 24시간 지난 것과 상한을 넘는 오래된 것을 지운다.
 */
export function createSyncStore({ warn = (m) => console.warn(m), routeCacheLimit = MEMORY_ROUTE_CACHE_LIMIT } = {}) {
  /** tripId → {ops(seq 순), lastAt(마지막으로 받은 시각)}. Map 순서가 처음 받은 순서다 */
  const trips = new Map();
  /** key → {response, at, size(JSON 글자 수)}. Map 순서가 넣은 순서다(다시 넣으면 뒤로 간다) */
  const routes = new Map();
  let routeChars = 0;
  const dropRoute = (key) => {
    const v = routes.get(key);
    if (!v) return;
    routeChars -= v.size;
    routes.delete(key);
  };
  return {
    kind: 'memory',
    push(tripId, ops, now = Date.now()) {
      if (!storableId(tripId)) return [];
      const list = (Array.isArray(ops) ? ops : []).filter((op) => op && storableId(op.id) && op.tripId === tripId);
      if (list.length === 0) return [];
      const room = trips.get(tripId) ?? { ops: [], lastAt: now };
      room.lastAt = now;
      const acks = [];
      let redact = false;
      for (const op of list) {
        const existing = room.ops.find((o) => o.id === op.id);
        if (existing) {
          acks.push({ opId: op.id, seq: existing.seq });
          continue;
        }
        const seq = room.ops.length === 0 ? 1 : room.ops[room.ops.length - 1].seq + 1;
        room.ops.push({ ...op, seq });
        acks.push({ opId: op.id, seq });
        if (REDACT_TRIGGER_TYPES.includes(op.type)) redact = true;
      }
      // 계정 탈퇴 가리기(server/redact.mjs). 탈퇴·사진 삭제·닉네임 op를 새로 받았을 때만 로그를 다시 본다
      if (redact) for (const [i, masked] of redactLog(room.ops)) room.ops[i] = masked;
      trips.set(tripId, room);
      return acks;
    },
    pull(tripId, after) {
      return (trips.get(tripId)?.ops ?? []).filter((o) => o.seq > after);
    },
    lookup(code, now) {
      if (!storableId(code)) return { error: 'notFound' };
      return lookupInTrips([...trips].map(([id, room]) => [id, room.ops]), code, now);
    },
    reset() {
      trips.clear();
    },
    /**
     * 종료일(로그를 접은 값) 다음 날 00:00 KST + 365일이 지난 방, 생성 op 없이 마지막으로 받은 뒤 365일이 지난 방,
     * 24시간 지난 경로 캐시를 지운다. 로그를 접다 실패한 방은 건너뛰고 알린다(다른 방 정리를 막지 않는다).
     */
    purgeExpired(now) {
      for (const [key, v] of routes) if (v.at <= now - ROUTE_CACHE_TTL_MS) dropRoute(key);
      const removed = [];
      for (const [tripId, room] of trips) {
        try {
          const { trip } = projectOps(room.ops);
          const until = trip ? retentionUntil(trip.endDate) : null;
          if (trip ? until != null && now >= until : room.lastAt <= now - ORPHAN_RETENTION_MS) removed.push(tripId);
        } catch (e) {
          warn(`보관 기한 판정 실패(${tripId}). 이 방은 건너뛴다: ${e?.message ?? e}`);
        }
      }
      for (const id of removed) trips.delete(id);
      return removed.sort();
    },
    health() {
      return true;
    },
    routeCache: {
      get(key, now = Date.now()) {
        const v = routes.get(key);
        return v && v.at > now - ROUTE_CACHE_TTL_MS ? v.response : null;
      },
      put(key, response, now = Date.now()) {
        const size = JSON.stringify(response ?? null).length;
        dropRoute(key);
        if (size > routeCacheLimit.chars) return; // 상한보다 큰 응답 하나는 두지 않는다
        // 앞쪽(먼저 넣은 것)부터: 24시간 지난 것을 지우고, 상한을 넘으면 오래된 것부터 버린다
        for (const [k, v] of routes) {
          const expired = v.at <= now - ROUTE_CACHE_TTL_MS;
          if (!expired && routes.size < routeCacheLimit.entries && routeChars + size <= routeCacheLimit.chars) break;
          dropRoute(k);
        }
        routes.set(key, { response, at: now, size });
        routeChars += size;
      },
    },
    close() {},
  };
}

/**
 * 시연 리셋(POST /reset) 허용 여부. 메모리 저장소는 늘 허용한다(원래 서버를 끄면 사라진다).
 * PostgreSQL은 서버 변수 SYNC_ALLOW_RESET=1일 때만 허용한다(한 기기의 시연 리셋이 공유 DB 전체를 지우지 않게).
 */
export function allowResetFromEnv(env, kind) {
  return kind === 'memory' || (env.SYNC_ALLOW_RESET ?? '').trim() === '1';
}

/**
 * 서버를 띄운다. now는 초대 만료 판정·받은 시각·보관 기한 정리의 시계다(테스트 주입용, 기본은 기기 시각).
 * store를 주지 않으면 메모리 저장소다. 시작 전에 보관 기한 정리를 한 번 하고(실패하면 시작하지 않는다),
 * purgeEveryMs마다 다시 한다(0이면 끈다). log는 정리 결과와 요청 처리 오류를 받는다.
 * allowReset이 거짓이면 POST /reset은 아무것도 지우지 않고 403이다(기본: 메모리 저장소만 허용).
 * proxy는 중계 설정(server/proxy.mjs createApiProxy)이다. 캐시는 저장소의 경로 캐시, 시계는 now를 기본으로 쓴다.
 * 기본은 카카오 키 없음(카카오 503)·공개 OSRM이다. false면 중계 경로도 404다.
 * auth는 계정·로그인 설정(server/auth.mjs)이다. 저장소는 store.authStore(PostgreSQL 저장소가 준다)가 있으면 그것, 없으면 메모리다.
 * auth.devOutbox(개발용 보낸편지함 GET /auth/outbox)와 auth.mockSocial(모의 소셜, 기본 devOutbox와 같다)은 기본이 꺼짐이다.
 * 메모리 저장소라고 열리지 않는다. 닫혀 있으면 그 경로는 404다. auth가 false면 /auth 경로 전체가 404다.
 * 돌려주는 close()로 닫는다. 저장소는 닫지 않는다(만든 쪽이 닫는다).
 */
export async function startSyncServer({
  port = 0,
  host = '127.0.0.1',
  now = () => Date.now(),
  store = createSyncStore(),
  allowReset = store.kind === 'memory',
  purgeEveryMs = PURGE_EVERY_MS,
  log = () => {},
  proxy = {},
  auth = {},
} = {}) {
  const api = proxy === false ? null : createApiProxy({ cache: store.routeCache, now, log, ...proxy });
  const accounts =
    auth === false
      ? null
      : createAuthService({ store: store.authStore ?? createMemoryAuthStore(), now, log, ...auth });
  const purge = async () => {
    await accounts?.purge();
    const removed = await store.purgeExpired(now());
    if (removed.length > 0) log(`보관 기한 정리: 여행방 ${removed.length}개 삭제`);
    return removed;
  };

  async function handle(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (api && isProxyPath(url.pathname)) {
      const r = await api.handle({ method: req.method, url, rawLength: (req.url ?? '').length, ip: req.socket.remoteAddress ?? '' });
      return send(res, r.status, r.body, r.headers);
    }
    if (accounts && isAuthPath(url.pathname)) {
      let body = {};
      if (req.method === 'POST') {
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {
          return send(res, 400, { ok: false, code: 'badCredentials', detail: '요청을 읽지 못했습니다' });
        }
      }
      const r = await accounts.handle({
        method: req.method,
        path: url.pathname.slice('/auth/'.length),
        url,
        headers: req.headers,
        body,
        ip: req.socket.remoteAddress ?? '',
      });
      return send(res, r.status, r.body, { 'Cache-Control': 'no-store' });
    }
    let parts;
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return send(res, 400, { error: 'badRequest' });
    }

    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'health') {
      const ok = await store.health();
      return send(res, ok ? 200 : 503, { ok, db: store.kind });
    }
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'reset') {
      if (!allowReset) {
        log('시연 리셋 거부: 이 서버는 시연 리셋을 막아 두었다(PostgreSQL은 SYNC_ALLOW_RESET=1일 때만 허용)');
        return send(res, 403, { error: 'resetDisabled' });
      }
      await store.reset();
      return send(res, 204);
    }
    if (parts[0] === 'trips' && parts.length === 3 && parts[2] === 'ops') {
      const tripId = parts[1];
      if (!storableId(tripId)) return send(res, 400, { error: 'badRequest' });
      if (req.method === 'POST') {
        let body;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch (e) {
          return send(res, 400, { error: 'badRequest', detail: String(e?.message ?? e) });
        }
        if (!body || !Array.isArray(body.ops)) return send(res, 400, { error: 'badRequest' });
        return send(res, 200, { acks: await store.push(tripId, body.ops, now()) });
      }
      if (req.method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? 0) || 0;
        return send(res, 200, { ops: await store.pull(tripId, after) });
      }
    }
    if (req.method === 'GET' && parts[0] === 'invites' && parts.length === 2) {
      if (!storableId(parts[1])) return send(res, 200, { error: 'notFound' });
      return send(res, 200, await store.lookup(parts[1], now()));
    }
    return send(res, 404, { error: 'notFound' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log(`요청 처리 실패: ${e?.message ?? e}`);
      if (!res.headersSent) send(res, 500, { error: 'serverError' });
      else res.destroy();
    });
  });

  await purge();
  await new Promise((resolve, reject) => {
    server.once('error', reject); // 포트가 이미 쓰이는 경우 등은 시작 실패로 알린다
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const timer =
    purgeEveryMs > 0
      ? setInterval(() => {
          purge().catch((e) => log(`보관 기한 정리 실패: ${e?.message ?? e}`));
        }, purgeEveryMs)
      : undefined;
  timer?.unref?.();
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  return {
    url: `http://${host}:${actual}`,
    close: () =>
      new Promise((done) => {
        clearInterval(timer);
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}

/**
 * 환경 변수로 저장소를 고른다. DATABASE_URL이 있으면 PostgreSQL이고, 붙지 못하면 던진다(메모리로 바꾸지 않는다).
 * openPostgres는 테스트 주입용이다.
 */
export async function storeFromEnv(env, { openPostgres } = {}) {
  const url = (env.DATABASE_URL ?? '').trim();
  if (!url) return createSyncStore();
  const open = openPostgres ?? (await import('./db/postgres-store.mjs')).openPostgresStore;
  return open(url);
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

async function main() {
  const port = Number(process.env.PORT ?? 8787);
  const store = await storeFromEnv(process.env);
  const allowReset = allowResetFromEnv(process.env, store.kind);
  // 보낸편지함·모의 소셜은 서버 변수(SYNC_ALLOW_RESET=1 또는 AUTH_DEV_OUTBOX=1)로만 연다. 메모리 저장소라고 열지 않는다
  const devOutbox = devOutboxFromEnv(process.env);
  const proxy = proxyOptionsFromEnv(process.env);
  // 실제 소셜 로그인 키(GOOGLE_OAUTH_*, KAKAO_OAUTH_*)와 돌아올 주소 허용 목록(OAUTH_REDIRECT_URIS). 값은 로그에 남기지 않는다
  const oauth = oauthOptionsFromEnv(process.env);
  const server = await startSyncServer({
    port,
    host: '0.0.0.0',
    store,
    allowReset,
    proxy,
    auth: { devOutbox, oauth },
    log: (m) => console.log(m),
  });
  console.log(
    `sync-server ${server.url} (저장: ${store.kind === 'postgres' ? 'PostgreSQL' : '메모리'}, 시연 리셋: ${allowReset ? '허용' : '막음'})`,
  );
  console.log(`계정: 메일 발송 없음, 개발용 보낸편지함·모의 소셜 ${devOutbox ? '열림(GET /auth/outbox, /auth/social)' : '닫힘(AUTH_DEV_OUTBOX=1로 연다)'}`);
  console.log(`소셜 로그인(OAuth): ${describeOAuth(oauth)}`);
  console.log(
    `중계: 카카오 ${proxy.kakaoKey ? '켜짐' : '꺼짐(KAKAO_REST_KEY 없음, 503)'}, 대중교통 ODsay ${proxy.odsayKey ? '켜짐' : '꺼짐(ODSAY_API_KEY 없음, 503)'}, OSRM ${new URL(proxy.osrmUrl).host}`,
  );
  const stop = () => {
    server
      .close()
      .then(() => store.close())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((e) => {
    console.error(`sync-server 시작 실패: ${e?.message ?? e}`);
    process.exit(1);
  });
}
