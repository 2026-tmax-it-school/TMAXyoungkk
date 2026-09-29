import type { FetchLike } from '../core/ports';

/**
 * AI 프록시 클라이언트(순수). 추출·추천·일기 문장이 EXPO_PUBLIC_AI_PROXY_URL 프록시를 거친다.
 * AI 키는 프록시 서버에만 둔다. 브라우저에서 AI 제공자를 직접 부르지 않는다.
 * 호출 규약: POST {url}{path}, JSON 본문, JSON 응답. 실패하면 던지고, 호출 쪽이 로컬 구현으로 대체한다.
 */
export interface AiProxyClient {
  call<T>(path: string, body: unknown): Promise<T>;
}

export function createAiProxyClient(opts: { url: string; fetch: FetchLike }): AiProxyClient {
  const base = opts.url.replace(/\/+$/, '');
  return {
    async call<T>(path: string, body: unknown): Promise<T> {
      const res = await opts.fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`AI 프록시 실패 ${res.status}`);
      return JSON.parse(text) as T;
    },
  };
}
