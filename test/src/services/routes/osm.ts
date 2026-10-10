import type { LatLng, Transport } from '../../types';
import { coordKey, sameCoord } from '../../core/planner/estimate';
import type { Clock, FetchLike, RouteLeg, RouteProvider } from '../../core/ports';
import { SCENARIO_PLACES } from '../../data/scenario';
import { SCENARIO_ROUTE_TABLE } from '../../data/scenario-tuning';
import type { RouteMatrix } from './cache';
import { createPlaceIndex, lookupTable, type RouteTable } from './local';

/**
 * 실제 길 어댑터(OpenStreetMap OSRM, 키 불필요, 순수). 도보·자동차 구간의 시간과 선 모양을 실제 길에서 받는다.
 * 2026-10-09 결정: 계획(matrix)도 실제 길 시간을 쓴다. 도로 경로 서버를 켜면(roadShapes) 도보 시간도 OSRM에서 받는다.
 * - 예시 구간표(src/data/scenario-tuning.ts)에 있는 구간은 구간표가 우선이다(시연 수치 유지). 묻지 않는다
 * - 행렬은 표에 없는 구간을 OSRM table로 한 번에 묻는다. 호출 수(calls)는 요청 수가 아니라 구간 수다(계약 A11)
 * - 경로(route)는 선 모양·거리·안내 줄과 그 경로의 시간을 함께 받는다. 같은 구간이면 행렬과 같은 분이 되게
 *   경로 캐시(cache.ts)가 맞춘다(OSRM의 table과 route는 같은 길 그래프라 보통 같은 초다)
 * - 자동차는 교통 정보가 없어 OSRM_CAR_TIME_FACTOR를 곱한다. 도보는 OSRM 그대로다
 * - 대중교통은 여기서 다루지 않는다(transit.ts 모의 모델)
 * 자동차는 카카오(서버 경유 또는 키)가 있으면 카카오가 먼저다(kakao.ts가 이 어댑터를 대체로 쓴다).
 *
 * 서버: FOSSGIS가 운영하는 공개 OSRM(routing.openstreetmap.de, 2026-10 확인). EXPO_PUBLIC_API_URL이 있으면 기본 주소가
 * 키 숨기는 서버의 /osrm(osmProxyBase)이다. 그 서버가 같은 경로 꼴 그대로 OSRM_URL(기본 공개 서버)에 묻고 24시간 캐시한다
 * (server/proxy.mjs). 앱이 만드는 주소는 기본 주소만 다르고 같다.
 * - GET {base}/routed-foot/route/v1/foot/{경도,위도};{경도,위도}?overview=full&geometries=geojson&steps=true
 * - 자동차는 routed-car/route/v1/driving. 응답 code 'Ok'가 성공, routes[0].distance는 미터, duration은 초,
 *   geometry.coordinates는 [경도, 위도]
 * - steps[].maneuver는 type·modifier·bearing_after·exit, steps[].distance는 그 안내부터 다음 안내까지 미터
 * - GET {base}/routed-foot/table/v1/foot/{좌표들}?sources=0;1&destinations=2;3&annotations=duration,distance
 *   (자동차는 routed-car/table/v1/driving, 2026-10 확인: routed-foot에서 동작). durations[i][j]는 초, 길로 못 이으면 null.
 *   좌표는 한 번에 OSM_TABLE_MAX_COORDS개까지(서버 중계의 상한과 같다). 넘으면 상한 안에서 출발지 여럿씩 묶어 나눠 묻는다
 * - CORS 허용(Access-Control-Allow-Origin: *). 사용 정책상 가벼운 사용만 된다. 그래서 묻고 나면 24시간 캐시에 둔다.
 * 길 데이터는 OpenStreetMap 기여자(ODbL)다. 선을 보여 주는 화면에 출처를 적는다(저작권 기호는 이모지 규칙에 걸려 글로 적는다).
 *
 * 요청이 실패하거나 시간이 넘으면 fallback(로컬 모델) 결과에 provisional을 달아 돌려준다. 시간은 직선 추정이라 estimated다.
 * 시간 제한은 응답 머리만이 아니라 본문을 다 받을 때까지다. 성공(200) 응답인데 본문을 JSON으로 읽지 못하거나 표가 요청과
 * 다르면 그것도 실패다(netClock이 있으면 쉬는 시간도 시작한다). 행렬은 칸마다 추정인지(estimatedCells)도 낸다.
 * 캐시는 그 결과를 두지 않아 다음에 다시 묻는다(일시 장애 한 번으로 하루 내내 직선 추정이 되지 않게).
 * OSRM이 길로 이을 수 없다고 답하면(HTTP 400과 code NoRoute·NoSegment, 섬이나 길에서 먼 점, table은 그 칸이 null)
 * 실패가 아니라 경로 없음이다. 직선 추정을 그대로 돌려주고 캐시에 둔다(같은 구간을 서버·공개 OSRM에 되묻지 않게).
 * 다만 여러 구간을 한 table로 물었는데 400이면 어느 점 때문인지 몰라 임시 결과로 둔다.
 * 시간 제한은 직접 부를 때 8초, 키 숨기는 서버를 거칠 때 15초다(서버가 OSRM 차례를 6초까지 기다리고 상류를 8초까지 기다린다).
 */

export const OSM_ROUTING_URL = 'https://routing.openstreetmap.de';
/** 키 숨기는 서버의 OSRM 중계 경로(server/proxy.mjs) */
export const OSM_PROXY_PATH = '/osrm';
export const OSM_ATTRIBUTION = '길 데이터 OpenStreetMap 기여자';
const TIMEOUT_MS = 8000;
/** 키 숨기는 서버를 거칠 때의 시간 제한. 서버 차례 대기(6초) + 상류(8초)보다 길게 둔다 */
export const OSM_PROXY_TIMEOUT_MS = 15_000;
/** OSRM이 길로 이을 수 없다고 답하는 code(HTTP 400과 같이 온다) */
const NO_ROUTE_CODES = new Set(['NoRoute', 'NoSegment']);
/** table 요청 하나의 좌표 수 상한. 서버 중계(server/proxy.mjs PROXY_DEFAULTS.tableMaxCoords)와 같다 */
export const OSM_TABLE_MAX_COORDS = 50;

/**
 * 쉬는 시간(실제 시각 ms). 경로 서버가 막거나(429, 5xx) 닿지 않거나(연결 실패) 시간이 넘거나 성공 응답을 읽지 못하면 이만큼 묻지 않고 곧바로
 * 대체(구간표 · 직선 추정, 캐시하지 않음)로 간다. 공개 서버는 요청이 몰리면 429를 주다가 연결을 끊는다(2026-10-09 웹 실행에서
 * 100구간 계산이 90초 걸림). 쉬는 동안 다시 두드리지 않아 계산이 몇 초 안에 끝나고 서버 차단도 길어지지 않는다.
 * netClock을 넘길 때만 켠다(앱은 registry가 실제 시계를 넘긴다. 시뮬레이터 가상 시각으로 재면 300배속에서 바로 풀린다).
 */
export const OSM_COOLDOWN_MS = 60_000;
/** 공개 서버에 직접 묻는 table 시간 제한. 계획 재계산이 오래 멈추지 않게 경로(8초)보다 짧게 둔다. 서버 중계는 OSM_PROXY_TIMEOUT_MS */
export const OSM_TABLE_TIMEOUT_MS = 4000;

/**
 * 자동차 OSRM 시간 보정 계수(프로토타입 가정). OSRM 자동차 프로필은 도로 종류별 속도로 달리는 자유 흐름 시간이라
 * 막힘·신호 대기가 거의 들어가지 않아 실제보다 짧게 나온다. 낮 시간 시내 주행이 자유 흐름보다 30% 더 걸린다고 보고 1.3을 곱한다.
 * 카카오 길찾기(실시간 교통)가 있으면 카카오가 먼저라 이 값은 카카오가 없을 때만 쓴다. 실키로 같은 구간의 카카오 시간과 견줘 고친다.
 * 도보는 교통 영향이 없어 보정하지 않는다.
 */
export const OSRM_CAR_TIME_FACTOR = 1.3;

const PROFILE: Partial<Record<Transport, string>> = {
  walk: 'routed-foot/route/v1/foot',
  car: 'routed-car/route/v1/driving',
};

const TABLE_PROFILE: Partial<Record<Transport, string>> = {
  walk: 'routed-foot/table/v1/foot',
  car: 'routed-car/table/v1/driving',
};

interface OsrmStep {
  distance?: number;
  name?: string;
  maneuver?: { type?: string; modifier?: string; bearing_after?: number; exit?: number };
}
interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: number[][] };
  legs?: { steps?: OsrmStep[] }[];
}

/** 서버 주소 → 도로 모양 기본 주소(서버의 OSRM 중계) */
export function osmProxyBase(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}${OSM_PROXY_PATH}`;
}

export function osmRouteUrl(base: string, t: Transport, a: LatLng, b: LatLng): string | undefined {
  const profile = PROFILE[t];
  if (!profile) return undefined;
  const pts = `${a.longitude},${a.latitude};${b.longitude},${b.latitude}`;
  return `${base.replace(/\/+$/, '')}/${profile}/${pts}?overview=full&geometries=geojson&steps=true`;
}

/** table 주소. sources·destinations는 coords 안 번호다. 대중교통은 묻지 않는다(undefined) */
export function osmTableUrl(
  base: string,
  t: Transport,
  coords: readonly LatLng[],
  sources: readonly number[],
  destinations: readonly number[],
): string | undefined {
  const profile = TABLE_PROFILE[t];
  if (!profile) return undefined;
  const pts = coords.map((c) => `${c.longitude},${c.latitude}`).join(';');
  return `${base.replace(/\/+$/, '')}/${profile}/${pts}?sources=${sources.join(';')}&destinations=${destinations.join(';')}&annotations=duration,distance`;
}

/** OSRM 초 → 계획 분(1분 이상). 자동차는 교통 보정 계수를 곱한다 */
export function osrmMinutes(seconds: number, t: Transport): number {
  const factor = t === 'car' ? OSRM_CAR_TIME_FACTOR : 1;
  return Math.max(1, Math.round((seconds / 60) * factor));
}

export interface OsmTable {
  /** seconds[출발 번호][도착 번호]. 길로 못 이으면 null */
  seconds: (number | null)[][];
  meters: (number | null)[][];
}

function cells(rows: unknown, sources: number, destinations: number): (number | null)[][] | null {
  if (!Array.isArray(rows) || rows.length !== sources) return null;
  const out: (number | null)[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== destinations) return null;
    out.push(row.map((v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)));
  }
  return out;
}

/** OSRM table 응답 → 초·미터 표. code가 Ok가 아니거나 표 크기가 요청과 다르면 null(실패로 본다). 거리는 없어도 된다 */
export function parseOsmTable(json: unknown, sources: number, destinations: number): OsmTable | null {
  const j = json as { code?: string; durations?: unknown; distances?: unknown } | null;
  if (!j || j.code !== 'Ok') return null;
  const seconds = cells(j.durations, sources, destinations);
  if (!seconds) return null;
  const meters = cells(j.distances, sources, destinations) ?? seconds.map((row) => row.map(() => null));
  return { seconds, meters };
}

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

const TURN: Record<string, string> = {
  uturn: '유턴',
  'sharp left': '왼쪽으로 크게 꺾기',
  left: '좌회전',
  'slight left': '왼쪽 방향',
  straight: '직진',
  'slight right': '오른쪽 방향',
  right: '우회전',
  'sharp right': '오른쪽으로 크게 꺾기',
};

const SIDE: Record<string, string> = {
  'sharp left': '왼쪽 길로',
  left: '왼쪽 길로',
  'slight left': '왼쪽 길로',
  straight: '직진',
  'slight right': '오른쪽 길로',
  right: '오른쪽 길로',
  'sharp right': '오른쪽 길로',
};

/** 안내 한 줄의 글. 길 이름이 있으면 '좌회전 · 첨성로'처럼 붙인다(카카오 안내 줄과 같은 꼴) */
export function osmStepText(step: OsrmStep): string {
  const m = step.maneuver ?? {};
  const type = m.type ?? '';
  const mod = m.modifier ?? '';
  const withName = (s: string) => (step.name ? `${s} · ${step.name}` : s);
  if (type === 'depart') {
    const deg = typeof m.bearing_after === 'number' ? m.bearing_after : undefined;
    return withName(deg === undefined ? '출발' : `${DIRS[Math.round(deg / 45) % 8]}쪽으로 출발`);
  }
  if (type === 'arrive') return '목적지 도착';
  if (type === 'roundabout' || type === 'rotary') return withName(m.exit ? `회전교차로에서 ${m.exit}번째 출구` : '회전교차로 통과');
  if (type === 'fork' || type === 'on ramp' || type === 'off ramp' || type === 'merge') return withName(SIDE[mod] ?? '직진');
  return withName(TURN[mod] ?? '직진');
}

/** 따로 할 일이 없는 안내(직진·이름만 바뀜·알림)는 앞 줄에 거리만 더한다 */
function isQuiet(step: OsrmStep): boolean {
  const type = step.maneuver?.type ?? '';
  const mod = step.maneuver?.modifier ?? 'straight';
  if (type === 'notification') return true;
  return (type === 'new name' || type === 'continue') && mod === 'straight';
}

export interface OsmShape {
  polyline: LatLng[];
  meters: number;
  /** 그 경로의 시간(초). 응답에 없으면 undefined */
  seconds?: number;
  steps: { text: string; meters: number }[];
}

/** OSRM 응답 → 선 모양·거리·안내 줄. 경로가 없거나 모양이 두 점 미만이면 null */
export function parseOsmRoute(json: unknown): OsmShape | null {
  const j = json as { code?: string; routes?: OsrmRoute[] } | null;
  if (!j || j.code !== 'Ok') return null;
  const route = j.routes?.[0];
  const coords = route?.geometry?.coordinates ?? [];
  const polyline: LatLng[] = [];
  for (const c of coords) {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') polyline.push({ longitude: c[0], latitude: c[1] });
  }
  if (!route || polyline.length < 2) return null;
  const steps: { text: string; meters: number }[] = [];
  for (const leg of route.legs ?? []) {
    for (const st of leg.steps ?? []) {
      const meters = Math.round(st.distance ?? 0);
      const prev = steps[steps.length - 1];
      if (prev && isQuiet(st)) {
        prev.meters += meters;
        continue;
      }
      steps.push({ text: osmStepText(st), meters });
    }
  }
  const seconds = typeof route.duration === 'number' && Number.isFinite(route.duration) && route.duration >= 0 ? route.duration : undefined;
  return { polyline, meters: Math.round(route.distance ?? 0), seconds, steps };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('경로 서버 응답 시간 초과')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** OSRM 응답 본문의 code. 읽지 못하면 빈 글 */
function osrmCode(text: string): string {
  try {
    const j = JSON.parse(text) as { code?: unknown } | null;
    return typeof j?.code === 'string' ? j.code : '';
  } catch {
    return '';
  }
}

/** table 요청 하나. pairs의 s·d는 sources·destinations 안 번호, i·j는 행렬의 출발·도착 번호다 */
interface TableChunk {
  coords: LatLng[];
  sources: number[];
  destinations: number[];
  pairs: { i: number; j: number; s: number; d: number }[];
}

/** 물을 구간들 → table 요청 하나. 같은 지점은 좌표 하나로 묻는다 */
function tableChunk(origins: readonly LatLng[], destinations: readonly LatLng[], ask: readonly [number, number][]): TableChunk {
  const coords: LatLng[] = [];
  const at = new Map<string, number>();
  const coordIndex = (c: LatLng) => {
    const k = coordKey(c);
    let n = at.get(k);
    if (n === undefined) {
      n = coords.length;
      coords.push(c);
      at.set(k, n);
    }
    return n;
  };
  const sources: number[] = [];
  const dests: number[] = [];
  const sPos = new Map<number, number>();
  const dPos = new Map<number, number>();
  const pos = (list: number[], seen: Map<number, number>, coord: number) => {
    let p = seen.get(coord);
    if (p === undefined) {
      p = list.length;
      list.push(coord);
      seen.set(coord, p);
    }
    return p;
  };
  const sOf = ask.map(([i]) => pos(sources, sPos, coordIndex(origins[i])));
  const dOf = ask.map(([, j]) => pos(dests, dPos, coordIndex(destinations[j])));
  return { coords, sources, destinations: dests, pairs: ask.map(([i, j], k) => ({ i, j, s: sOf[k], d: dOf[k] })) };
}

/**
 * 좌표 수 상한을 넘으면 나눠 묻는다. 출발지 여럿을 좌표 수가 상한을 넘지 않는 만큼 한 요청에 담는다(출발지 순서대로 채운다).
 * 한 출발지의 목적지만으로 상한을 넘으면 그 출발지는 목적지를 (상한 - 1)개씩 나눈다
 */
function tableChunks(origins: readonly LatLng[], destinations: readonly LatLng[], ask: readonly [number, number][]): TableChunk[] {
  const all = tableChunk(origins, destinations, ask);
  if (all.coords.length <= OSM_TABLE_MAX_COORDS) return [all];
  const byOrigin = new Map<number, [number, number][]>();
  for (const p of ask) byOrigin.set(p[0], [...(byOrigin.get(p[0]) ?? []), p]);
  const out: TableChunk[] = [];
  const size = OSM_TABLE_MAX_COORDS - 1;
  let pending: [number, number][] = [];
  let used = new Set<string>();
  const flush = () => {
    if (pending.length > 0) out.push(tableChunk(origins, destinations, pending));
    pending = [];
    used = new Set();
  };
  for (const list of byOrigin.values()) {
    const need = new Set([coordKey(origins[list[0][0]]), ...list.map(([, j]) => coordKey(destinations[j]))]);
    if (need.size > OSM_TABLE_MAX_COORDS) {
      flush();
      for (let k = 0; k < list.length; k += size) out.push(tableChunk(origins, destinations, list.slice(k, k + size)));
      continue;
    }
    const merged = new Set([...used, ...need]);
    if (merged.size > OSM_TABLE_MAX_COORDS) {
      flush();
      used = need;
    } else used = merged;
    pending.push(...list);
  }
  flush();
  return out;
}

export function createOsmRoutes(opts: {
  fetch: FetchLike;
  fallback: RouteProvider;
  baseUrl?: string;
  timeoutMs?: number;
  /** 예시 구간표(기본 SCENARIO_ROUTE_TABLE)와 좌표 색인용 장소(기본 SCENARIO_PLACES). 표에 있는 구간은 묻지 않는다 */
  table?: RouteTable;
  places?: readonly { placeId: string; coord: LatLng }[];
  /** table 요청 시간 제한. 없으면 timeoutMs */
  tableTimeoutMs?: number;
  /** 쉬는 시간을 재는 실제 시계. 없으면 쉬지 않는다(실패해도 다음 요청을 그대로 보낸다) */
  netClock?: Clock;
  cooldownMs?: number;
}): RouteProvider {
  const base = opts.baseUrl || OSM_ROUTING_URL;
  const table = opts.table ?? SCENARIO_ROUTE_TABLE;
  const index = createPlaceIndex(opts.places ?? SCENARIO_PLACES);
  const routeTimeout = opts.timeoutMs ?? TIMEOUT_MS;
  const tableTimeout = opts.tableTimeoutMs ?? routeTimeout;

  /** 이 시각(netClock)까지는 묻지 않는다 */
  let restUntil = Number.NEGATIVE_INFINITY;
  const resting = () => !!opts.netClock && opts.netClock.now() < restUntil;
  const rest = () => {
    if (opts.netClock) restUntil = opts.netClock.now() + (opts.cooldownMs ?? OSM_COOLDOWN_MS);
  };

  async function get(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
    if (resting()) throw new Error('경로 서버 쉬는 중');
    let res: { ok: boolean; status: number; text: string };
    try {
      // 본문 읽기까지 한 시간 제한 안에 둔다(머리만 오고 본문이 멈추면 계획 계산이 끝나지 않는다)
      res = await withTimeout(
        (async () => {
          const r = await opts.fetch(url, { method: 'GET' });
          return { ok: r.ok, status: r.status, text: await r.text() };
        })(),
        timeoutMs,
      );
    } catch (e) {
      // 닿지 못함·시간 초과·본문을 못 읽음: 서버가 막혔거나 밀려 있다
      rest();
      throw e;
    }
    // 요청 제한(429)·서버 오류(5xx)는 쉰다. 400(경로 없음 등)·404는 그 요청만의 문제라 쉬지 않는다
    if (res.status === 429 || res.status >= 500) rest();
    return res;
  }

  /** 성공(200) 응답 본문을 JSON으로 읽는다. 읽지 못하면(중간 장비의 HTML 등) 다른 실패처럼 쉬고 던진다 */
  function okJson(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      rest();
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  async function shape(a: LatLng, b: LatLng, t: Transport): Promise<OsmShape | null> {
    const url = osmRouteUrl(base, t, a, b);
    if (!url) return null;
    const res = await get(url, routeTimeout);
    if (!res.ok) {
      if (res.status === 400 && NO_ROUTE_CODES.has(osrmCode(res.text))) return null;
      throw new Error(`경로 서버 요청 실패 ${res.status}`);
    }
    return parseOsmRoute(okJson(res.text));
  }

  /** 물을 구간마다 초(길로 못 이으면 null). 실패하면 던진다. 키는 'i,j' */
  async function tableSeconds(
    origins: readonly LatLng[],
    destinations: readonly LatLng[],
    ask: readonly [number, number][],
    t: Transport,
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    // 공개 서버 사용 정책상 나눠 묻는 요청도 하나씩 보낸다
    for (const chunk of tableChunks(origins, destinations, ask)) {
      const url = osmTableUrl(base, t, chunk.coords, chunk.sources, chunk.destinations);
      if (!url) throw new Error('표로 묻지 않는 수단');
      const res = await get(url, tableTimeout);
      if (!res.ok) {
        // 한 구간만 물었으면 그 구간이 길로 이어지지 않는 것이다(경로 없음, 캐시된다)
        if (res.status === 400 && chunk.pairs.length === 1 && NO_ROUTE_CODES.has(osrmCode(res.text))) {
          out.set(`${chunk.pairs[0].i},${chunk.pairs[0].j}`, null);
          continue;
        }
        throw new Error(`경로 서버 요청 실패 ${res.status}`);
      }
      const parsed = parseOsmTable(okJson(res.text), chunk.sources.length, chunk.destinations.length);
      if (!parsed) {
        // 성공 응답인데 표가 요청과 다르다(code가 Ok가 아님·크기 다름). 다른 실패처럼 쉰다
        rest();
        throw new Error('경로 서버 응답을 읽지 못함');
      }
      for (const p of chunk.pairs) out.set(`${p.i},${p.j}`, parsed.seconds[p.s][p.d]);
    }
    return out;
  }

  return {
    id: opts.fallback.id,
    async matrix(origins, destinations, t): Promise<RouteMatrix> {
      if (!TABLE_PROFILE[t]) return opts.fallback.matrix(origins, destinations, t);
      const minutes: (number | null)[][] = origins.map(() => destinations.map(() => null));
      const ask: [number, number][] = [];
      let calls = 0;
      origins.forEach((o, i) =>
        destinations.forEach((d, j) => {
          if (sameCoord(o, d)) {
            minutes[i][j] = 0;
            return;
          }
          // 구간 단위로 센다(구간표 구간도, table 한 번에 묻는 여러 구간도 구간 수만큼)
          calls += 1;
          const known = lookupTable(table, index, o, d, t);
          if (known !== undefined) minutes[i][j] = known;
          else ask.push([i, j]);
        }),
      );
      if (ask.length === 0) return { minutes, calls, cacheHits: 0, estimated: false };
      let got: Map<string, number | null>;
      try {
        got = await tableSeconds(origins, destinations, ask, t);
      } catch {
        // 길 서버를 못 쓴다. 이 행렬은 통째로 대체 제공자(구간표 · 직선 추정)로 계산하고 캐시에 두지 않는다
        const fb = await opts.fallback.matrix(origins, destinations, t);
        return { ...fb, provisional: true };
      }
      let estimated = false;
      const estimatedCells = origins.map(() => destinations.map(() => false));
      for (const [i, j] of ask) {
        const sec = got.get(`${i},${j}`);
        if (typeof sec === 'number') {
          minutes[i][j] = osrmMinutes(sec, t);
          continue;
        }
        // 길로 이을 수 없는 구간은 대체 제공자의 직선 추정이다(경로 없음과 같게 캐시된다)
        const fb = await opts.fallback.matrix([origins[i]], [destinations[j]], t);
        minutes[i][j] = fb.minutes[0]?.[0] ?? null;
        estimated = true;
        estimatedCells[i][j] = true;
      }
      return { minutes, calls, cacheHits: 0, estimated, estimatedCells };
    },
    async route(a, b, t): Promise<RouteLeg | null> {
      const leg = await opts.fallback.route(a, b, t);
      if (!leg || !PROFILE[t] || leg.polyline.length < 2) return leg;
      let s: OsmShape | null;
      try {
        s = await shape(a, b, t);
      } catch {
        return { ...leg, provisional: true };
      }
      // 길로 이을 수 없는 구간(섬 등, OSRM NoRoute·NoSegment)은 직선 추정 그대로 둔다(캐시된다)
      if (!s) return leg;
      const out: RouteLeg = { ...leg, polyline: s.polyline, meters: s.meters, steps: s.steps.length > 0 ? s.steps : leg.steps, road: 'osm' };
      // 구간표 구간은 시간이 구간표 값 그대로다(시연 수치). 그 밖에는 경로의 시간(행렬과 같은 식)
      if (lookupTable(table, index, a, b, t) !== undefined) {
        out.note = `실제 길 모양 · ${OSM_ATTRIBUTION} · 시간은 예시 구간표`;
      } else if (s.seconds !== undefined) {
        out.minutes = osrmMinutes(s.seconds, t);
        out.estimated = false;
        out.note = t === 'car' ? `실제 길 기준 · 교통 보정 ${OSRM_CAR_TIME_FACTOR}배 · ${OSM_ATTRIBUTION}` : `실제 길 기준 · ${OSM_ATTRIBUTION}`;
      } else {
        out.note = leg.estimated ? `실제 길 모양 · ${OSM_ATTRIBUTION} · 시간은 추정` : `실제 길 모양 · ${OSM_ATTRIBUTION}`;
      }
      return out;
    },
    clearCache: () => opts.fallback.clearCache(),
  };
}
