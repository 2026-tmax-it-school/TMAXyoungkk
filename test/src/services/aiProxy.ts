import type { FetchLike } from '../core/ports';

/**
 * AI 프록시 클라이언트(순수). 추출·추천·일기 문장이 EXPO_PUBLIC_AI_PROXY_URL 프록시를 거친다.
 * AI 키는 프록시 서버에만 둔다. 브라우저에서 AI 제공자를 직접 부르지 않는다.
 * 호출 규약: POST {url}{path}, JSON 본문, JSON 응답. 실패하면 던지고, 호출 쪽이 로컬 구현으로 대체한다.
 * timeoutMs가 있으면 그 시간이 지나 요청을 끊고 던진다. signal이 끊기면 바로 던진다.
 */
export interface AiProxyCallOptions {
  /** 이 시간(ms)이 지나면 요청을 끊고 던진다. 없으면 기다린다 */
  timeoutMs?: number;
  /** 호출 쪽이 끊을 때(새 요청이 앞 요청을 대신할 때) */
  signal?: AbortSignal;
}

export interface AiProxyClient {
  call<T>(path: string, body: unknown, opts?: AiProxyCallOptions): Promise<T>;
}

export function createAiProxyClient(opts: { url: string; fetch: FetchLike }): AiProxyClient {
  const base = opts.url.replace(/\/+$/, '');
  return {
    async call<T>(path: string, body: unknown, callOpts: AiProxyCallOptions = {}): Promise<T> {
      const outer = callOpts.signal;
      if (outer?.aborted) throw new Error('AI 프록시 요청을 끊었다');
      const ac = typeof AbortController === 'function' ? new AbortController() : undefined;
      // signal은 FetchLike 틀 밖이라 따로 얹는다(실제 fetch는 받고, 테스트 가짜는 무시한다)
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(ac ? { signal: ac.signal } : {}),
      };
      const work = (async () => {
        const res = await opts.fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, init);
        const text = await res.text();
        if (!res.ok) throw new Error(`AI 프록시 실패 ${res.status}`);
        return JSON.parse(text) as T;
      })();
      work.catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const stop = new Promise<never>((_, reject) => {
        const end = (why: string) => {
          ac?.abort();
          reject(new Error(why));
        };
        if (callOpts.timeoutMs != null && callOpts.timeoutMs > 0) {
          timer = setTimeout(() => end('AI 프록시 시간 초과'), callOpts.timeoutMs);
        }
        if (outer) {
          onAbort = () => end('AI 프록시 요청을 끊었다');
          outer.addEventListener('abort', onAbort);
        }
      });
      stop.catch(() => {});
      try {
        return await Promise.race([work, stop]);
      } finally {
        if (timer) clearTimeout(timer);
        if (outer && onAbort) outer.removeEventListener('abort', onAbort);
      }
    },
  };
}
