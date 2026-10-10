import type { LatLng } from '../../types';
import type { Clock, FetchLike, TransitStepKind } from '../../core/ports';
import type { RouteLegOut } from './cache';

/**
 * ODsay 대중교통 길찾기(WP4, 순수). 키 숨기는 서버(EXPO_PUBLIC_API_URL)의 /odsay/…를 거친다. 키는 서버의 ODSAY_API_KEY에만 있다.
 *
 * 문서(lab.odsay.com, searchPubTransPathT · loadLane):
 * - /odsay/search?SX&SY&EX&EY(경도·위도) → result.path[]. 탑승 시간(도보 구간을 뺀 sectionTime 합)이 가장 짧은 경로를 쓴다
 *   (2026-10-10 결정: 버스 12분 · 지하철 2분이면 지하철 경로만). 같으면 환승이 적은 것, 그다음 앞 순서
 * - 시간은 탑승 시간만이다(걷기·대기·환승 시간을 넣지 않는다). 안내 줄도 타는 구간과 도착만 적는다
 * - path.info: totalTime(분), totalDistance(m), payment(원), busTransitCount, subwayTransitCount, mapObj
 * - path.subPath[]: trafficType 1 지하철 · 2 버스 · 3 도보, 도시 사이 4 열차 · 5 고속버스 · 6 시외버스 · 7 항공(그 밖은 '대중교통')
 *   sectionTime(분), distance(m), stationCount, lane[](지하철 name, 버스 busNo), startName·endName, startX·startY·endX·endY,
 *   way(방면), passStopList.stations[](stationName, x, y)
 * - 실패도 HTTP 200에 {error: {code, msg}} 또는 {error: [{code, message}]}다. 경로를 못 찾은 경우(-98 너무 가까움, -99 결과 없음,
 *   3~6 정류장 없음)는 경로 없음(null)이다
 * - /odsay/lane?mapObject=0:0@{info.mapObj} → result.lane[](교통 구간 순서).section[].graphPos[]{x,y}: 노선을 따라가는 선
 *
 * 선 모양은 노선 모양(loadLane)이 있으면 그것, 없으면 승차 정류장 → 지나는 정류장 → 하차 정류장 좌표를 잇는다. 도보 구간은 그 사이를 곧게 잇는다.
 * 찻길 모양을 빌리지 않는다(버스·지하철·열차가 실제로 지나는 곳을 그린다).
 *
 * 서버를 못 쓰면(키 없음 503 odsayDisabled, 닿지 못함, 시간 초과, 5xx) 'unavailable'을 돌려주고 transit.ts가 추정 모델로 넘어간다.
 * 키 없음은 서버 설정이라 netClock이 있으면 ODSAY_DISABLED_COOLDOWN_MS 동안 다시 묻지 않는다.
 */

export const ODSAY_PROXY_PATH = '/odsay';
/** 서버가 ODsay 키 없음(503)이라고 한 뒤 묻지 않는 시간 */
export const ODSAY_DISABLED_COOLDOWN_MS = 5 * 60_000;
/** 서버 경유 요청 하나를 기다리는 시간(서버가 상류를 8초 기다린다) */
export const ODSAY_TIMEOUT_MS = 12_000;
/** 출처 표시(ODsay 이용 조건) */
export const ODSAY_ATTRIBUTION = '대중교통 정보 ODsay';

export type OdsayOutcome =
  /** 경로 */
  | { kind: 'leg'; leg: RouteLegOut }
  /** ODsay가 대중교통 경로가 없다고 했다(너무 가까움 등) */
  | { kind: 'none'; reason?: string }
  /** 서버·ODsay를 쓸 수 없다(추정 모델로 넘어간다). disabled는 서버에 키가 없다 */
  | { kind: 'unavailable'; disabled: boolean };

interface OdsayLane {
  name?: string;
  busNo?: string;
  type?: number;
}
interface OdsayStation {
  stationName?: string;
  x?: number | string;
  y?: number | string;
}
interface OdsaySubPath {
  trafficType?: number;
  distance?: number;
  sectionTime?: number;
  stationCount?: number;
  lane?: OdsayLane[];
  startName?: string;
  endName?: string;
  startX?: number | string;
  startY?: number | string;
  endX?: number | string;
  endY?: number | string;
  way?: string;
  trainType?: string;
  passStopList?: { stations?: OdsayStation[] };
}
export interface OdsayPath {
  pathType?: number;
  info?: {
    totalTime?: number;
    totalDistance?: number;
    payment?: number;
    busTransitCount?: number;
    subwayTransitCount?: number;
    mapObj?: string;
  };
  subPath?: OdsaySubPath[];
}

/** ODsay가 '찾았지만 대중교통 경로가 없다'고 하는 오류 코드 */
const NO_ROUTE_CODES = new Set(['-98', '-99', '3', '4', '5', '6']);

function toNum(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function point(x: unknown, y: unknown): LatLng | undefined {
  const lng = toNum(x);
  const lat = toNum(y);
  return lng !== undefined && lat !== undefined ? { latitude: lat, longitude: lng } : undefined;
}

/** {error: {code}} · {error: [{code}]} → 오류 코드 문자열(없으면 undefined) */
export function odsayErrorCode(json: unknown): string | undefined {
  const e = (json as { error?: unknown } | null)?.error;
  if (!e) return undefined;
  const first = Array.isArray(e) ? e[0] : e;
  const code = (first as { code?: unknown } | undefined)?.code;
  return code === undefined ? 'unknown' : String(code);
}

/** 역 이름 뒤에 '역'을 붙인다(이미 '역'으로 끝나면 그대로) */
function station(name: string | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return '역';
  return n.endsWith('역') ? n : `${n}역`;
}

const INTERCITY_LABEL: Record<number, string> = { 4: '열차', 5: '고속버스', 6: '시외버스', 7: '항공' };

function stepKind(trafficType: number | undefined): TransitStepKind {
  switch (trafficType) {
    case 1:
      return 'subway';
    case 2:
      return 'bus';
    case 4:
      return 'train';
    case 5:
    case 6:
      return 'intercityBus';
    case 7:
      return 'air';
    default:
      return 'bus';
  }
}

/** 교통 구간 한 줄. 사용자가 그대로 따라 탈 수 있게 노선·승하차·정류장 수·시간을 적는다 */
export function odsayStepText(sp: OdsaySubPath): string {
  const min = Math.round(sp.sectionTime ?? 0);
  const lanes = sp.lane ?? [];
  const count = sp.stationCount;
  if (sp.trafficType === 2) {
    const nos = [...new Set(lanes.map((l) => (l.busNo ?? '').trim()).filter(Boolean))];
    const bus = nos.length === 0 ? '버스' : nos.length === 1 ? `${nos[0]}번 버스` : `${nos.join(', ')}번 버스 중 하나`;
    const stops = count != null ? `${count}개 정류장, ` : '';
    return `${bus} · ${sp.startName ?? '출발 정류장'}에서 승차 · ${sp.endName ?? '도착 정류장'}에서 하차 (${stops}${min}분)`;
  }
  if (sp.trafficType === 1) {
    const line = (lanes[0]?.name ?? '지하철').trim();
    const way = sp.way ? ` · ${sp.way} 방면` : '';
    const stops = count != null ? `${count}개 역, ` : '';
    return `${line}${way} · ${station(sp.startName)}에서 승차 · ${station(sp.endName)}에서 하차 (${stops}${min}분)`;
  }
  const kind = INTERCITY_LABEL[sp.trafficType ?? -1] ?? '대중교통';
  const name = (sp.trainType ?? lanes[0]?.name ?? '').trim();
  const label = name && !name.includes(kind) ? `${kind}(${name})` : name || kind;
  return `${label} · ${sp.startName ?? '출발'}에서 승차 · ${sp.endName ?? '도착'}에서 하차 (${min}분)`;
}

/** 경로의 탑승 시간(분): 도보가 아닌 구간의 sectionTime 합 */
export function odsayRideMinutes(path: OdsayPath): number {
  return (path.subPath ?? []).reduce((s, sp) => (sp.trafficType === 3 ? s : s + (sp.sectionTime ?? 0)), 0);
}

/** 탑승 구간 수(환승 비교용) */
function rideCount(path: OdsayPath): number {
  return (path.subPath ?? []).filter((sp) => sp.trafficType !== 3).length;
}

/** 탑승 시간이 가장 짧은 경로의 번호. 같으면 탑승 구간이 적은 것, 그다음 앞 순서. 경로가 없으면 -1 */
export function fastestOdsayPath(paths: readonly OdsayPath[]): number {
  let best = -1;
  paths.forEach((p, i) => {
    if (!p?.info || !Array.isArray(p.subPath) || rideCount(p) === 0) return;
    if (best < 0) {
      best = i;
      return;
    }
    const a = odsayRideMinutes(p);
    const b = odsayRideMinutes(paths[best]);
    if (a < b || (a === b && rideCount(p) < rideCount(paths[best]))) best = i;
  });
  return best;
}

/** loadLane 응답 → 교통 구간 순서대로의 노선 모양(구간마다 좌표 목록) */
export function parseOdsayLanes(json: unknown): LatLng[][] {
  const lanes = (json as { result?: { lane?: { section?: { graphPos?: { x?: unknown; y?: unknown }[] }[] }[] } } | null)?.result?.lane;
  if (!Array.isArray(lanes)) return [];
  return lanes.map((lane) => {
    const out: LatLng[] = [];
    for (const sec of lane.section ?? []) for (const g of sec.graphPos ?? []) {
      const p = point(g.x, g.y);
      if (p) out.push(p);
    }
    return out;
  });
}

/**
 * searchPubTransPathT 응답 → 경로. 경로를 못 찾았다는 오류면 'none', 알 수 없는 꼴이면 undefined.
 * lanes(loadLane 결과)가 있으면 교통 구간의 선을 그 모양으로 바꾼다.
 */
export function parseOdsayRoute(
  json: unknown,
  a: LatLng,
  b: LatLng,
  opts: { toName?: string; lanes?: LatLng[][] } = {},
): { kind: 'leg'; leg: RouteLegOut } | { kind: 'none'; reason?: string } | undefined {
  const code = odsayErrorCode(json);
  if (code !== undefined) return NO_ROUTE_CODES.has(code) ? { kind: 'none', reason: code } : undefined;
  const paths = (json as { result?: { path?: OdsayPath[] } } | null)?.result?.path ?? [];
  const pick = fastestOdsayPath(paths);
  if (pick < 0) return undefined;
  const path = paths[pick];
  const subs = path.subPath ?? [];
  const toName = opts.toName ?? '도착지';
  const steps: { text: string; meters: number; kind: TransitStepKind }[] = [];
  const polyline: LatLng[] = [a];
  let transitIndex = 0;
  let rideMeters = 0;
  subs.forEach((sp) => {
    // 걷기 구간은 시간·안내에 넣지 않는다(선은 앞뒤 탑승 구간을 곧게 잇는다)
    if (sp.trafficType === 3) return;
    rideMeters += sp.distance ?? 0;
    steps.push({ text: odsayStepText(sp), meters: Math.round(sp.distance ?? 0), kind: stepKind(sp.trafficType) });
    const lane = opts.lanes?.[transitIndex];
    transitIndex += 1;
    if (lane && lane.length >= 2) {
      polyline.push(...lane);
      return;
    }
    const start = point(sp.startX, sp.startY);
    if (start) polyline.push(start);
    for (const st of sp.passStopList?.stations ?? []) {
      const p = point(st.x, st.y);
      if (p) polyline.push(p);
    }
    const end = point(sp.endX, sp.endY);
    if (end) polyline.push(end);
  });
  polyline.push(b);
  const info = path.info ?? {};
  const transfers = Math.max(0, rideCount(path) - 1);
  const parts = [ODSAY_ATTRIBUTION, '탑승 시간'];
  if (info.payment) parts.push(`요금 ${info.payment.toLocaleString('ko-KR')}원`);
  parts.push(transfers > 0 ? `환승 ${transfers}회` : '환승 없음');
  steps.push({ text: `${toName} 도착`, meters: 0, kind: 'arrive' });
  return {
    kind: 'leg',
    leg: {
      transport: 'transit',
      minutes: Math.max(1, Math.round(odsayRideMinutes(path))),
      meters: Math.round(rideMeters || info.totalDistance || 0),
      polyline,
      steps,
      note: parts.join(' · '),
      estimated: false,
      road: 'odsay',
    },
  };
}

function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** 서버 주소 + /odsay */
export function odsayBase(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}${ODSAY_PROXY_PATH}`;
}

export function odsaySearchUrl(apiUrl: string, a: LatLng, b: LatLng): string {
  const q = `SX=${fmt(a.longitude)}&SY=${fmt(a.latitude)}&EX=${fmt(b.longitude)}&EY=${fmt(b.latitude)}&OPT=0`;
  return `${odsayBase(apiUrl)}/search?${q}`;
}

export function odsayLaneUrl(apiUrl: string, mapObj: string): string {
  return `${odsayBase(apiUrl)}/lane?mapObject=${encodeURIComponent(`0:0@${mapObj}`)}`;
}

/**
 * 서버 경유 ODsay 대중교통. route는 던지지 않는다(결과 종류로 알린다).
 */
export function createOdsayTransit(opts: { apiUrl: string; fetch: FetchLike; netClock?: Clock; timeoutMs?: number }) {
  const timeoutMs = opts.timeoutMs ?? ODSAY_TIMEOUT_MS;
  let disabledUntil = 0;

  async function get(url: string): Promise<{ status: number; json: unknown }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    try {
      const res = await Promise.race([opts.fetch(url), limit]);
      const text = await Promise.race([res.text(), limit]);
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    async route(a: LatLng, b: LatLng, toName?: string): Promise<OdsayOutcome> {
      if (opts.netClock && opts.netClock.now() < disabledUntil) return { kind: 'unavailable', disabled: true };
      let res: { status: number; json: unknown };
      try {
        res = await get(odsaySearchUrl(opts.apiUrl, a, b));
      } catch {
        return { kind: 'unavailable', disabled: false };
      }
      if (res.status === 503 && (res.json as { error?: unknown } | null)?.error === 'odsayDisabled') {
        if (opts.netClock) disabledUntil = opts.netClock.now() + ODSAY_DISABLED_COOLDOWN_MS;
        return { kind: 'unavailable', disabled: true };
      }
      if (res.status !== 200) return { kind: 'unavailable', disabled: false };
      const code = odsayErrorCode(res.json);
      // 경로 없음이 아닌 오류(키 거부, 호출 한도 등)는 쓸 수 없음으로 본다
      if (code !== undefined && !NO_ROUTE_CODES.has(code)) return { kind: 'unavailable', disabled: false };
      // 노선 모양은 있으면 쓰고, 못 받아도 정류장 좌표로 그린다
      let lanes: LatLng[][] | undefined;
      const paths = (res.json as { result?: { path?: OdsayPath[] } } | null)?.result?.path ?? [];
      const mapObj = paths[fastestOdsayPath(paths)]?.info?.mapObj;
      if (code === undefined && mapObj) {
        try {
          const lr = await get(odsayLaneUrl(opts.apiUrl, mapObj));
          if (lr.status === 200 && odsayErrorCode(lr.json) === undefined) lanes = parseOdsayLanes(lr.json);
        } catch {
          lanes = undefined;
        }
      }
      const parsed = parseOdsayRoute(res.json, a, b, { toName, lanes });
      return parsed ?? { kind: 'unavailable', disabled: false };
    },
  };
}
