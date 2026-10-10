/**
 * 키 숨기는 중계(WP2 소유). 앱이 카카오 키 없이 이 서버를 거쳐 카카오 장소·자동차 길찾기와 OSRM 길을 받는다.
 * 앱은 EXPO_PUBLIC_API_URL로 붙는다(src/services/kakaoHttp.ts의 KAKAO_PROXY_PATHS, src/services/routes/osm.ts의 osmProxyBase).
 * sync-server.mjs가 /kakao/…와 /osrm/… 요청을 여기로 넘긴다.
 *
 *   GET /kakao/local/keyword?query&x&y&radius&page&size&sort&category_group_code   카카오 로컬 키워드 검색
 *   GET /kakao/local/category?category_group_code&x&y&radius&page&size&sort        카카오 로컬 카테고리 검색
 *   GET /kakao/navi/directions?origin&destination&priority&summary                 카카오모빌리티 자동차 길찾기
 *   GET /osrm/routed-foot/route/v1/foot/{경도,위도;경도,위도}?overview&geometries&steps
 *   GET /osrm/routed-car/route/v1/driving/{…}                                       (osm.ts가 만드는 주소 꼴 그대로)
 *   GET /osrm/routed-{foot,car}/table/v1/{foot,driving}/{…}?sources&destinations&annotations
 *
 * 열린 중계가 되지 않게 한다.
 * - 위 경로와 매개변수만 받는다. 모르는 매개변수, 같은 이름 두 번, 범위를 벗어난 좌표·숫자는 400이다. 상류에는 서버가
 *   새로 만든 주소와 헤더만 보낸다(앱이 보낸 헤더·쿠키는 넘기지 않는다). GET만 받는다(그 밖은 405)
 * - 좌표는 국내 범위(KOREA_BOUNDS, 경도 124~132 · 위도 33~39)만 받는다(앱은 국내 전용, 카카오도 국내만 된다)
 * - 좌표 수 상한(route 2개: 앱은 구간마다 두 점만 묻는다, table 50개), 요청 줄 길이 상한(4KB, 넘으면 414)
 * - IP별 1분 요청 수 상한(기본 300, 넘으면 429와 Retry-After). 캐시에서 나간 응답도 센다. IP는 소켓 주소다
 *   (역방향 프록시 뒤에 두면 모두 한 IP로 센다)
 * - 상류 시간 초과(기본 8초)는 504, 상류에 닿지 못하면 502, 상류가 실패하면 그 상태 코드와 본문을 그대로 준다
 *   (카카오가 서버 키를 거부하면(401·403) 키와 서비스 사용 설정을 확인하라고 한 번 기록한다)
 * - 카카오 키(KAKAO_REST_KEY)는 서버 환경 변수에서만 읽어 Authorization: KakaoAK 헤더로 붙인다. 키가 없으면 카카오 경로는
 *   503 kakaoDisabled와 이유를 준다(앱은 서버 경유에서 실패하면 로컬 장소 사전·추정 경로로 넘어간다). 상류 응답에 키 글자가
 *   섞여 있으면 가린다
 * OSRM·카카오 길찾기의 성공 응답(200)은 저장소의 경로 캐시(PostgreSQL route_cache 또는 메모리)에 24시간 둔다. 장소 검색은 두지 않는다.
 * 메모리 경로 캐시는 개수·크기 상한이 있다(sync-server.mjs createSyncStore, 넘으면 오래된 것부터 버린다).
 * OSRM에는 동시에 OSRM_CONCURRENCY개(기본 2)까지만 보낸다. 공개 서버 routing.openstreetmap.de에는 사용 정책상 설정과 상관없이
 * 2개를 넘기지 않는다. 차례를 기다리는 요청이 100개를 넘거나 6초(queueWaitMs) 안에 차례가 오지 않으면 503 busy와
 * Retry-After다(앱 osm.ts는 서버를 거칠 때 15초까지 기다린다). 같은 요청이 겹치면 상류에는 한 번만 묻는다.
 * 요청 내용(좌표·검색어)은 기록하지 않고 장소 검색은 캐시에도 두지 않는다.
 * 길(OSRM·길찾기)에는 스팟·기점 좌표만 온다. 앱의 지연 조정안(core/planner/replan.ts)은 지금 위치에서 출발하는 구간을
 * 기기 안에서 직선거리로 추정하고 묻지 않는다. 주변 장소 검색(local/category)은 앱의 빈 시간 추천
 * (core/live/freetime.ts, store/live.ts)이 지금 위치로 부른다(남은 문제. 이 서버는 넘기기만 하고 기록·캐시하지 않는다).
 */
import { createHash } from 'node:crypto';

/** 공개 OSRM(FOSSGIS). 앱 osm.ts의 OSM_ROUTING_URL과 같다 */
export const OSRM_PUBLIC_URL = 'https://routing.openstreetmap.de';

export const PROXY_DEFAULTS = Object.freeze({
  /** IP별 1분 요청 수. 0이면 끈다. 계획 재계산 1회가 100구간까지 묻는다(비기능 요구사항) */
  ratePerMin: 300,
  /** 상류 한 번을 기다리는 시간 */
  timeoutMs: 8000,
  /** OSRM 동시 요청 수 */
  osrmConcurrency: 2,
  /** 공개 OSRM 동시 요청 수 상한(사용 정책) */
  publicOsrmConcurrency: 2,
  /** OSRM 차례를 기다리는 요청 수 상한 */
  queueMax: 100,
  /** OSRM 차례를 기다리는 시간 상한. 넘으면 상류에 묻지 않고 503 busy다(앱이 먼저 포기하기 전에 답한다) */
  queueWaitMs: 6000,
  /** 요청 줄(경로+쿼리) 길이 상한 */
  maxUrlLength: 4096,
  /** 상류 응답 길이 상한(글자) */
  maxResponseLength: 5 * 1024 * 1024,
  /** route 좌표 수. 앱(osm.ts)은 구간마다 두 점만 묻는다 */
  routeMaxCoords: 2,
  tableMaxCoords: 50,
});

/** 받는 좌표 범위(국내). 앱은 국내 전용이고 카카오 로컬·길찾기도 국내만 된다. 제주·울릉·독도·백령도까지 들어간다 */
export const KOREA_BOUNDS = Object.freeze({ minLng: 124, maxLng: 132, minLat: 33, maxLat: 39 });

const RATE_WINDOW_MS = 60_000;
/** IP 기록이 이보다 많으면 지난 창을 지운다 */
const RATE_SWEEP_AT = 5000;
const MASK = '[숨김]';

/* ---------- 매개변수 검사 ---------- */

const NUM_RE = /^-?\d{1,3}(\.\d{1,17})?$/;
const num = (min, max) => (v) => NUM_RE.test(v) && Number(v) >= min && Number(v) <= max;
const int = (min, max) => (v) => /^\d{1,6}$/.test(v) && Number(v) >= min && Number(v) <= max;
const oneOf = (...xs) => (v) => xs.includes(v);
const text = (max) => (v) => v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const lng = num(KOREA_BOUNDS.minLng, KOREA_BOUNDS.maxLng);
const lat = num(KOREA_BOUNDS.minLat, KOREA_BOUNDS.maxLat);
/** 카카오 '경도,위도' */
const xy = (v) => {
  const p = v.split(',');
  return p.length === 2 && lng(p[0]) && lat(p[1]);
};

/** 카카오 로컬 업종 코드(category_group_code) */
const KAKAO_CATEGORY_CODES = [
  'MT1', 'CS2', 'PS3', 'SC4', 'AC5', 'PK6', 'OL7', 'SW8', 'BK9',
  'CT1', 'AG2', 'PO3', 'AT4', 'AD5', 'FD6', 'CE7', 'HP8', 'PM9',
];

const LOCAL_PARAMS = {
  category_group_code: oneOf(...KAKAO_CATEGORY_CODES),
  x: lng,
  y: lat,
  radius: int(0, 20000),
  page: int(1, 45),
  size: int(1, 15),
  sort: oneOf('accuracy', 'distance'),
};

/** 카카오 중계 경로. 키는 '/kakao/' 뒤 경로 */
export const KAKAO_ROUTES = Object.freeze({
  'local/keyword': {
    upstream: 'https://dapi.kakao.com/v2/local/search/keyword.json',
    required: ['query'],
    params: { query: text(100), ...LOCAL_PARAMS },
    cache: false,
  },
  'local/category': {
    upstream: 'https://dapi.kakao.com/v2/local/search/category.json',
    // 사각형(rect) 검색은 받지 않는다. 중심·반경이 있어야 한다
    required: ['category_group_code', 'x', 'y', 'radius'],
    params: LOCAL_PARAMS,
    cache: false,
  },
  'navi/directions': {
    upstream: 'https://apis-navi.kakaomobility.com/v1/directions',
    required: ['origin', 'destination'],
    params: { origin: xy, destination: xy, priority: oneOf('RECOMMEND', 'TIME', 'DISTANCE'), summary: oneOf('true', 'false') },
    cache: true,
  },
});

/** OSRM 서버 이름 → 프로필(공개 서버의 경로 꼴) */
const OSRM_PROFILES = { 'routed-foot': 'foot', 'routed-car': 'driving' };

/** OSRM 'all' 또는 '0;2;5'(좌표 수보다 작은 번호) */
const indexList = (v, n) => v === 'all' || (v.length <= 400 && v.split(';').every((s) => /^\d{1,3}$/.test(s) && Number(s) < n));

function osrmServices(limits) {
  return {
    route: {
      maxCoords: limits.routeMaxCoords,
      params: {
        overview: oneOf('full', 'simplified', 'false'),
        geometries: oneOf('geojson', 'polyline', 'polyline6'),
        steps: oneOf('true', 'false'),
        // 대안 경로(alternatives)는 앱이 쓰지 않아 받지 않는다(응답이 몇 배로 커진다)
      },
    },
    table: {
      maxCoords: limits.tableMaxCoords,
      params: {
        sources: indexList,
        destinations: indexList,
        annotations: oneOf('duration', 'distance', 'duration,distance', 'distance,duration'),
      },
    },
  };
}

/**
 * 쿼리 검사. 허용한 이름만, 한 번씩만, 값이 규칙에 맞아야 한다. 맞으면 이름 순으로 정렬한 [이름, 값] 목록, 아니면 이유(문자열)
 * @param {URLSearchParams} search
 */
function checkParams(search, spec, required, ctx) {
  const seen = new Map();
  for (const [k, v] of search) {
    if (!Object.hasOwn(spec, k)) return `모르는 매개변수 ${k}`;
    if (seen.has(k)) return `같은 매개변수 두 번 ${k}`;
    if (!spec[k](v, ctx)) return `값이 맞지 않는 매개변수 ${k}`;
    seen.set(k, v);
  }
  for (const k of required) if (!seen.has(k)) return `빠진 매개변수 ${k}`;
  return [...seen].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 쿼리 글. OSRM 값은 허용 목록을 거친 글자(영숫자·';'·',')뿐이라 그대로 둔다(OSRM 주소 꼴 그대로) */
function queryString(pairs, raw = false) {
  return pairs.map(([k, v]) => (raw ? `${k}=${v}` : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)).join('&');
}

/* ---------- 속도 제한·동시 요청 ---------- */

/** IP별 고정 창(1분) 요청 수. take는 받을 수 있으면 0, 아니면 다시 시도할 초 */
function rateLimiter(limit, now) {
  const hits = new Map();
  return {
    take(ip) {
      if (!(limit > 0)) return 0;
      const t = now();
      if (hits.size > RATE_SWEEP_AT) for (const [k, h] of hits) if (t - h.start >= RATE_WINDOW_MS) hits.delete(k);
      let h = hits.get(ip);
      if (!h || t - h.start >= RATE_WINDOW_MS || t < h.start) {
        h = { start: t, count: 0 };
        hits.set(ip, h);
      }
      if (h.count >= limit) return Math.max(1, Math.ceil((h.start + RATE_WINDOW_MS - t) / 1000));
      h.count += 1;
      return 0;
    },
  };
}

class BusyError extends Error {}
class TimeoutError extends Error {}

/**
 * 동시에 max개까지만 돌린다. 끝난 자리는 기다리던 요청에 바로 넘긴다(새로 온 요청이 끼어들지 않게).
 * 기다리는 요청이 queueMax개를 넘거나 waitMs 안에 차례가 오지 않으면 BusyError다(대기열에서 빠지고 fn은 돌지 않는다).
 */
function semaphore(max, queueMax, waitMs) {
  let active = 0;
  /** 기다리는 요청의 go(차례를 넘겨받으면 부른다) */
  const waiting = [];
  return {
    async run(fn) {
      if (active < max) active += 1;
      else {
        if (waiting.length >= queueMax) throw new BusyError('busy');
        await new Promise((resolve, reject) => {
          let timer;
          const go = () => {
            clearTimeout(timer);
            resolve();
          };
          if (Number.isFinite(waitMs) && waitMs > 0) {
            timer = setTimeout(() => {
              const i = waiting.indexOf(go);
              if (i >= 0) waiting.splice(i, 1);
              reject(new BusyError('busy'));
            }, waitMs);
          }
          waiting.push(go);
        });
      }
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      }
    },
  };
}

/* ---------- 설정 ---------- */

/** http(s) 주소면 끝 '/'를 뗀 값, 아니면 던진다 */
function baseUrl(raw, name) {
  const v = String(raw ?? '').trim();
  if (!/^https?:\/\/[^\s/?#]+/.test(v)) throw new Error(`${name}이 http(s) 주소가 아니다`);
  return v.replace(/\/+$/, '');
}

function isPublicOsrm(url) {
  try {
    return new URL(url).hostname === new URL(OSRM_PUBLIC_URL).hostname;
  } catch {
    return false;
  }
}

/**
 * 서버 환경 변수 → 중계 설정. KAKAO_REST_KEY(없으면 카카오 503), OSRM_URL(없으면 공개 서버),
 * OSRM_CONCURRENCY(기본 2), PROXY_RATE_PER_MIN(기본 300, 0이면 끔). OSRM_URL이 http(s) 주소가 아니면 던진다(시작하지 않는다).
 */
export function proxyOptionsFromEnv(env) {
  const count = (raw, fallback) => {
    const v = String(raw ?? '').trim();
    if (v === '') return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`정수가 아닌 설정 값 ${v}`);
    return n;
  };
  const osrm = String(env.OSRM_URL ?? '').trim();
  return {
    kakaoKey: String(env.KAKAO_REST_KEY ?? '').trim(),
    osrmUrl: osrm ? baseUrl(osrm, 'OSRM_URL') : OSRM_PUBLIC_URL,
    osrmConcurrency: Math.max(1, count(env.OSRM_CONCURRENCY, PROXY_DEFAULTS.osrmConcurrency)),
    ratePerMin: count(env.PROXY_RATE_PER_MIN, PROXY_DEFAULTS.ratePerMin),
  };
}

/** 이 경로를 중계가 맡는지 */
export function isProxyPath(pathname) {
  return /^\/(kakao|osrm)(\/|$)/.test(pathname);
}

/**
 * 중계를 만든다. cache는 저장소의 routeCache(get·put, 동기·비동기 둘 다), now는 속도 제한·캐시 시각이다.
 * fetch는 상류 호출(테스트는 가짜를 넣는다). handle은 {status, body, headers}를 돌려주고 던지지 않는다.
 */
export function createApiProxy({
  kakaoKey = '',
  osrmUrl = OSRM_PUBLIC_URL,
  fetch: fetchImpl = globalThis.fetch,
  cache,
  now = () => Date.now(),
  ratePerMin = PROXY_DEFAULTS.ratePerMin,
  timeoutMs = PROXY_DEFAULTS.timeoutMs,
  osrmConcurrency = PROXY_DEFAULTS.osrmConcurrency,
  queueMax = PROXY_DEFAULTS.queueMax,
  queueWaitMs = PROXY_DEFAULTS.queueWaitMs,
  limits: limitsIn = {},
  log = () => {},
} = {}) {
  const key = String(kakaoKey ?? '').trim();
  const osrmBase = baseUrl(osrmUrl, 'OSRM_URL');
  const limits = { ...PROXY_DEFAULTS, ...limitsIn };
  const osrmMax = Math.max(1, isPublicOsrm(osrmBase) ? Math.min(osrmConcurrency, limits.publicOsrmConcurrency) : osrmConcurrency);
  const services = osrmServices(limits);
  const rate = rateLimiter(ratePerMin, now);
  const osrmGate = semaphore(osrmMax, queueMax, queueWaitMs);
  /** 캐시 키 → 진행 중인 상류 호출(같은 요청이 겹치면 한 번만 묻는다) */
  const inflight = new Map();
  /** 카카오 키 거부(401·403)를 이미 기록한 상태 코드(한 번만 기록한다) */
  const rejectedLogged = new Set();

  const json = (status, body, headers) => ({ status, body, headers: headers ?? {} });
  const bad = (reason) => json(400, { error: 'badRequest', reason });

  /** 상류 한 번. 시간 제한 안에 본문까지 받는다 */
  async function upstream(url, headers) {
    const ac = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timer;
    const work = (async () => {
      const res = await fetchImpl(url, { method: 'GET', headers, signal: ac?.signal });
      return { status: res.status, text: await res.text() };
    })();
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ac?.abort();
        reject(new TimeoutError('timeout'));
      }, timeoutMs);
    });
    work.catch(() => {}); // 시간 초과 뒤 늦게 온 실패는 버린다
    try {
      return await Promise.race([work, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 상류 응답 → 내보낼 결과. 키 글자는 가린다. JSON이 아니면 502(성공) 또는 그 상태 코드(실패) */
  function toResult(r) {
    let t = r.text;
    if (t.length > limits.maxResponseLength) return json(502, { error: 'upstreamTooLarge' });
    if (key && t.includes(key)) t = t.split(key).join(MASK);
    let body;
    try {
      body = JSON.parse(t);
    } catch {
      return r.status >= 200 && r.status < 300 ? json(502, { error: 'badUpstream' }) : json(r.status, { error: 'upstream', status: r.status });
    }
    return json(r.status, body);
  }

  async function cacheGet(k) {
    if (!cache) return null;
    try {
      return (await cache.get(k, now())) ?? null;
    } catch (e) {
      log(`경로 캐시 읽기 실패: ${e?.message ?? e}`);
      return null;
    }
  }

  async function cachePut(k, body) {
    if (!cache) return;
    try {
      await cache.put(k, body, now());
    } catch (e) {
      log(`경로 캐시 쓰기 실패: ${e?.message ?? e}`);
    }
  }

  /**
   * 상류에 묻는다. kind는 기록용 이름, gate는 동시 요청 제한(OSRM). cacheable이면 성공 응답을 24시간 두고 겹치는 요청을 합친다.
   */
  async function relay({ kind, url, headers, cacheable, gate }) {
    const ck = cacheable ? `${kind}:${createHash('sha256').update(url).digest('hex')}` : undefined;
    if (ck) {
      const hit = await cacheGet(ck);
      if (hit != null) return json(200, hit, { 'X-Cache': 'hit' });
      const pending = inflight.get(ck);
      if (pending) return pending;
    }
    const call = (async () => {
      let r;
      try {
        r = await (gate ? gate.run(() => upstream(url, headers)) : upstream(url, headers));
      } catch (e) {
        if (e instanceof BusyError) return json(503, { error: 'busy', reason: '경로 서버 차례를 기다리는 요청이 많다' }, { 'Retry-After': '1' });
        if (e instanceof TimeoutError) {
          log(`중계 상류 시간 초과(${kind})`);
          return json(504, { error: 'upstreamTimeout' });
        }
        log(`중계 상류 실패(${kind}): ${e?.message ?? e}`);
        return json(502, { error: 'upstreamFailed' });
      }
      const out = toResult(r);
      if (kind.startsWith('kakao') && (r.status === 401 || r.status === 403) && !rejectedLogged.has(r.status)) {
        rejectedLogged.add(r.status);
        log(`카카오가 서버 키를 거부했다(${r.status}). KAKAO_REST_KEY와 카카오 개발자 콘솔의 서비스 사용 설정(카카오맵·카카오모빌리티)을 확인한다`);
      }
      if (ck && out.status === 200) {
        await cachePut(ck, out.body);
        out.headers = { 'X-Cache': 'miss' };
      }
      return out;
    })();
    if (!ck) return call;
    inflight.set(ck, call);
    try {
      return await call;
    } finally {
      inflight.delete(ck);
    }
  }

  function kakao(route, search) {
    if (!Object.hasOwn(KAKAO_ROUTES, route)) return json(404, { error: 'notFound' });
    const spec = KAKAO_ROUTES[route];
    const pairs = checkParams(search, spec.params, spec.required);
    if (typeof pairs === 'string') return bad(pairs);
    if (!key) {
      return json(503, { error: 'kakaoDisabled', reason: '서버에 KAKAO_REST_KEY가 없어 카카오를 중계하지 않는다' });
    }
    return relay({
      kind: `kakao-${route.replace('/', '-')}`,
      url: `${spec.upstream}?${queryString(pairs)}`,
      headers: { Authorization: `KakaoAK ${key}` },
      cacheable: spec.cache,
    });
  }

  function osrm(segments, search) {
    // routed-foot / route / v1 / foot / 좌표
    if (segments.length !== 5 || segments[2] !== 'v1') return json(404, { error: 'notFound' });
    const [server, service, , profile, rawCoords] = segments;
    if (!Object.hasOwn(OSRM_PROFILES, server) || !Object.hasOwn(services, service)) return json(404, { error: 'notFound' });
    if (OSRM_PROFILES[server] !== profile) return bad('서버와 프로필이 맞지 않는다');
    let coordsText;
    try {
      coordsText = decodeURIComponent(rawCoords);
    } catch {
      return bad('좌표를 읽지 못했다');
    }
    const coords = coordsText.split(';');
    const spec = services[service];
    if (coords.length < 2 || coords.length > spec.maxCoords) return bad(`좌표는 2~${spec.maxCoords}개`);
    for (const c of coords) {
      const [x, y, ...rest] = c.split(',');
      if (rest.length > 0 || y === undefined || !lng(x) || !lat(y)) return bad('좌표가 맞지 않는다');
    }
    const pairs = checkParams(search, spec.params, [], coords.length);
    if (typeof pairs === 'string') return bad(pairs);
    const qs = queryString(pairs, true);
    return relay({
      kind: `osrm-${service}`,
      url: `${osrmBase}/${server}/${service}/v1/${profile}/${coords.join(';')}${qs ? `?${qs}` : ''}`,
      headers: {},
      cacheable: true,
      gate: osrmGate,
    });
  }

  return {
    /** 카카오 중계가 켜졌는지와 OSRM 상류(로그·점검용. 키는 담지 않는다) */
    info() {
      return { kakao: key.length > 0, osrm: osrmBase, osrmConcurrency: osrmMax, ratePerMin };
    },
    /**
     * 요청 하나. method·URL·요청 줄 길이·IP를 받는다. 결과는 {status, body, headers}
     * @param {{ method?: string; url: URL; rawLength?: number; ip?: string }} req
     */
    async handle({ method, url, rawLength = 0, ip = '' }) {
      try {
        const wait = rate.take(ip || 'unknown');
        if (wait > 0) return json(429, { error: 'rateLimited' }, { 'Retry-After': String(wait) });
        if (method !== 'GET') return json(405, { error: 'methodNotAllowed' }, { Allow: 'GET, OPTIONS' });
        if (rawLength > limits.maxUrlLength || url.pathname.length + url.search.length > limits.maxUrlLength) {
          return json(414, { error: 'uriTooLong' });
        }
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0] === 'kakao') return await kakao(segments.slice(1).join('/'), url.searchParams);
        if (segments[0] === 'osrm') return await osrm(segments.slice(1), url.searchParams);
        return json(404, { error: 'notFound' });
      } catch (e) {
        log(`중계 처리 실패: ${e?.message ?? e}`);
        return json(500, { error: 'serverError' });
      }
    },
  };
}
