import type { FetchLike } from '../core/ports';

/**
 * 카카오 REST 공용 클라이언트(순수). 장소(카카오 로컬)와 자동차 경로(카카오모빌리티)가 같이 쓴다.
 * 프로토타입 가정 · 국내 SDK 선정 미결정. 두 갈래다.
 * - 서버 경유(apiUrl, EXPO_PUBLIC_API_URL): 키 숨기는 서버(server/proxy.mjs)로 보낸다. 키도 인증 헤더도 보내지 않는다.
 *   카카오 주소는 KAKAO_PROXY_PATHS로 서버 경로에 옮기고 매개변수는 그대로 붙인다. 서버가 중계하지 않는 주소와 POST는 던진다.
 *   서버에 카카오 키가 없으면 503 {error:'kakaoDisabled'}다. 부르는 쪽(places/kakao, routes/kakao)은 서버 경유에서
 *   어떤 실패든(서버에 닿지 못함, 시간 초과, 503·429·5xx) 로컬 대체로 넘기고 그 결과를 캐시에 두지 않는다.
 *   다만 routes/kakao는 키 없음(isKakaoDisabled)이면 잠시 카카오에 묻지 않고 실제 대체 값을 짧게 캐시한다.
 * - 직접 호출(key, EXPO_PUBLIC_KAKAO_REST_KEY): 시연 한정. REST 키가 번들에 들어간다.
 *   인증 헤더는 'Authorization: KakaoAK {REST 키}'다. 웹 CORS 동작은 실키로 확인하지 못했다(추적표).
 * 둘 다 있으면 서버 경유다(키를 쓰지 않는다).
 * 요청마다 시간 제한(KAKAO_TIMEOUT_MS)을 둔다. 서버 주소가 LAN이라 닿지 못할 때 OS 연결 시간 초과까지 멈추지 않게 한다.
 * 서버 경유에서 서버에 닿지 못하면(네트워크 오류·시간 초과) 다음 요청 하나만 다시 확인하고, 확인하는 동안 다른 요청은
 * 묻지 않고 바로 실패한다(상태 0, code 'unreachable'). 계획 재계산이 구간마다 시간 제한을 다 기다리지 않게 한다.
 */

/** 카카오 주소 → 서버 중계 경로. server/proxy.mjs의 KAKAO_ROUTES와 짝이다 */
export const KAKAO_PROXY_PATHS: Readonly<Record<string, string>> = {
  'https://dapi.kakao.com/v2/local/search/keyword.json': '/kakao/local/keyword',
  'https://dapi.kakao.com/v2/local/search/category.json': '/kakao/local/category',
  'https://apis-navi.kakaomobility.com/v1/directions': '/kakao/navi/directions',
};
const PROXY_PATH = new Map(Object.entries(KAKAO_PROXY_PATHS));

/** 요청 하나를 기다리는 시간. 서버 상류 시간 제한(8초)보다 길게 둔다 */
export const KAKAO_TIMEOUT_MS = 10_000;

export interface KakaoClient {
  /** 키 숨기는 서버를 거치는지 */
  readonly viaServer: boolean;
  get(url: string, params: Record<string, string | number | undefined>): Promise<unknown>;
  /** JSON 본문 POST(카카오모빌리티 다중 목적지 길찾기 등). 서버 경유에서는 던진다 */
  post(url: string, body: unknown): Promise<unknown>;
  lastError(): string;
}

/**
 * 카카오 요청이 끝나지 못했다. status는 HTTP 상태 코드(서버·카카오에 닿지 못했거나 시간이 넘으면 0),
 * code는 서버 중계가 준 본문 error 값(kakaoDisabled, busy 등. 없으면 undefined)
 */
export class KakaoHttpError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'KakaoHttpError';
    this.status = status;
    if (code) this.code = code;
  }
}

/** 서버에 카카오 키가 없다(서버 중계의 503 kakaoDisabled). 일시 장애(카카오 503, 429 등)와 가른다 */
export function isKakaoDisabled(e: unknown): boolean {
  return e instanceof KakaoHttpError && e.status === 503 && e.code === 'kakaoDisabled';
}

function errorCode(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { error?: unknown } | null;
    return typeof j?.error === 'string' ? j.error : undefined;
  } catch {
    return undefined;
  }
}

export function createKakaoClient(opts: { key?: string; apiUrl?: string; fetch: FetchLike; timeoutMs?: number }): KakaoClient {
  const base = opts.apiUrl ? opts.apiUrl.replace(/\/+$/, '') : undefined;
  const timeoutMs = opts.timeoutMs ?? KAKAO_TIMEOUT_MS;
  let last = '';

  /** fetch와 본문 읽기를 시간 제한 안에 끝낸다. 넘으면 기다리지 않고 상태 0으로 던진다(osm.ts와 같은 방식) */
  async function fetchText(url: string, init: { method: string; headers?: Record<string, string>; body?: string }) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      const res = await opts.fetch(url, init);
      return { ok: res.ok, status: res.status, text: await res.text() };
    })();
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new KakaoHttpError('카카오 요청 시간 초과', 0, 'timeout')), timeoutMs);
    });
    work.catch(() => {}); // 시간 초과 뒤 늦게 온 실패는 버린다
    try {
      return await Promise.race([work, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 서버 경유: 마지막으로 서버에 닿지 못했는지, 다시 확인하는 요청이 나가 있는지 */
  let unreachable = false;
  let probing = false;

  async function send(url: string, init: { method: string; headers?: Record<string, string>; body?: string }) {
    if (base !== undefined && unreachable && probing) {
      last = '서버에 닿지 못함';
      throw new KakaoHttpError('키 숨기는 서버에 닿지 못함(다시 확인 중)', 0, 'unreachable');
    }
    const probe = base !== undefined && unreachable;
    if (probe) probing = true;
    let res: { ok: boolean; status: number; text: string };
    try {
      res = await fetchText(url, init);
    } catch (e) {
      unreachable = true;
      if (e instanceof KakaoHttpError) {
        last = '시간 초과';
        throw e;
      }
      last = `네트워크 오류: ${String(e)}`;
      throw new KakaoHttpError(`카카오 요청 실패(닿지 못함): ${String(e)}`, 0, 'network');
    } finally {
      if (probe) probing = false;
    }
    unreachable = false;
    if (!res.ok) {
      const code = errorCode(res.text);
      last = code ? `HTTP ${res.status} ${code}` : `HTTP ${res.status}`;
      throw new KakaoHttpError(`카카오 요청 실패 ${res.status}`, res.status, code);
    }
    last = '';
    return JSON.parse(res.text) as unknown;
  }
  const auth = { Authorization: `KakaoAK ${opts.key ?? ''}` };
  return {
    viaServer: base !== undefined,
    async post(url, body) {
      if (base !== undefined) throw new Error('서버 경유는 카카오 POST를 중계하지 않는다');
      return send(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    },
    async get(url, params) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (base !== undefined) {
        const path = PROXY_PATH.get(url);
        if (!path) throw new Error(`서버가 중계하지 않는 카카오 주소: ${url}`);
        return send(qs ? `${base}${path}?${qs}` : `${base}${path}`, { method: 'GET' });
      }
      const full = qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
      return send(full, { method: 'GET', headers: auth });
    },
    lastError: () => last,
  };
}
