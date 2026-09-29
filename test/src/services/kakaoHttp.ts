import type { FetchLike } from '../core/ports';

/**
 * 카카오 REST 공용 클라이언트(순수). 장소(카카오 로컬)와 자동차 경로(카카오모빌리티)가 같이 쓴다.
 * 프로토타입 가정 · 국내 SDK 선정 미결정. REST 키가 번들에 들어가므로 시연 한정이다.
 * 인증 헤더는 'Authorization: KakaoAK {REST 키}'다. 웹 CORS 동작은 실키로 확인하지 못했다(추적표).
 */
export interface KakaoClient {
  get(url: string, params: Record<string, string | number | undefined>): Promise<unknown>;
  /** JSON 본문 POST(카카오모빌리티 다중 목적지 길찾기 등) */
  post(url: string, body: unknown): Promise<unknown>;
  lastError(): string;
}

export function createKakaoClient(opts: { key: string; fetch: FetchLike }): KakaoClient {
  let last = '';
  async function send(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await opts.fetch(url, init);
    } catch (e) {
      last = `네트워크 오류: ${String(e)}`;
      throw e;
    }
    const text = await res.text();
    if (!res.ok) {
      last = `HTTP ${res.status}`;
      throw new Error(`카카오 요청 실패 ${res.status}`);
    }
    last = '';
    return JSON.parse(text) as unknown;
  }
  const auth = { Authorization: `KakaoAK ${opts.key}` };
  return {
    async post(url, body) {
      return send(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    },
    async get(url, params) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      const full = qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
      return send(full, { method: 'GET', headers: auth });
    },
    lastError: () => last,
  };
}
