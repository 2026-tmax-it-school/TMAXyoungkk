/**
 * proxy.mjs의 타입 선언(WP2 소유). 테스트가 '../server/proxy.mjs'를 확장자까지 적어 import할 때 쓴다.
 */

/** 상류 호출. node fetch와 앱 FetchLike 둘 다 이 모양이다 */
export type UpstreamFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok?: boolean; status: number; text(): Promise<string> }>;

type Awaitable<T> = T | Promise<T>;

/** 저장소의 경로 캐시(SyncStore.routeCache) */
export interface ProxyCache {
  get(key: string, now?: number): Awaitable<unknown>;
  put(key: string, response: unknown, now?: number): Awaitable<void>;
}

export const OSRM_PUBLIC_URL: string;

export const PROXY_DEFAULTS: Readonly<{
  ratePerMin: number;
  timeoutMs: number;
  osrmConcurrency: number;
  publicOsrmConcurrency: number;
  queueMax: number;
  queueWaitMs: number;
  maxUrlLength: number;
  maxResponseLength: number;
  routeMaxCoords: number;
  tableMaxCoords: number;
}>;

/** 받는 좌표 범위(국내) */
export const KOREA_BOUNDS: Readonly<{ minLng: number; maxLng: number; minLat: number; maxLat: number }>;

export const KAKAO_ROUTES: Readonly<
  Record<string, { upstream: string; required: string[]; params: Record<string, (v: string) => boolean>; cache: boolean }>
>;

export const ODSAY_ROUTES: Readonly<
  Record<string, { upstream: string; required: string[]; params: Record<string, (v: string) => boolean>; cache: boolean }>
>;

export interface ApiProxyOptions {
  /** 카카오 REST 키. 비우면 카카오 경로는 503 */
  kakaoKey?: string;
  /** ODsay 서버 키. 비우면 ODsay 경로는 503 */
  odsayKey?: string;
  /** OSRM 상류(기본 공개 서버) */
  osrmUrl?: string;
  fetch?: UpstreamFetch;
  cache?: ProxyCache;
  now?: () => number;
  /** IP별 1분 요청 수(0이면 끈다) */
  ratePerMin?: number;
  timeoutMs?: number;
  /** OSRM 동시 요청 수. 공개 서버는 2개를 넘기지 않는다 */
  osrmConcurrency?: number;
  queueMax?: number;
  /** OSRM 차례를 기다리는 시간 상한(넘으면 503 busy) */
  queueWaitMs?: number;
  limits?: Partial<typeof PROXY_DEFAULTS>;
  log?: (message: string) => void;
}

export interface ProxyResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface ApiProxy {
  info(): { kakao: boolean; odsay: boolean; osrm: string; osrmConcurrency: number; ratePerMin: number };
  handle(req: { method?: string; url: URL; rawLength?: number; ip?: string }): Promise<ProxyResult>;
}

export function proxyOptionsFromEnv(env: Record<string, string | undefined>): {
  kakaoKey: string;
  odsayKey: string;
  osrmUrl: string;
  osrmConcurrency: number;
  ratePerMin: number;
};

export function isProxyPath(pathname: string): boolean;

export function createApiProxy(opts?: ApiProxyOptions): ApiProxy;
