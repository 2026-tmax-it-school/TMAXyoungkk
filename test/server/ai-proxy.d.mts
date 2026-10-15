export const DEFAULT_GEMINI_MODEL: string;

export interface AiProxyOptions {
  apiKey: string;
  model?: string;
  kakaoKey?: string;
  fetch?: typeof fetch;
}

export function createAiHandlers(opts: AiProxyOptions): {
  extract(body: unknown): Promise<{ phrases: { phrase: string }[] }>;
  recommend(body: unknown): Promise<{ items: { place: unknown; reason: string }[]; fallback: boolean }>;
  diary(body: unknown): Promise<{ texts: string[] }>;
};

export function startAiProxy(
  opts: AiProxyOptions & { port?: number; host?: string; allowOrigin?: string; ratePerMin?: number },
): Promise<{ url: string; close: () => Promise<void> }>;
