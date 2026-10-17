import type { ChatSummary, ChatSummaryProvider, ChatSummaryRequest, FetchLike } from '../../core/ports';
import { localSummary, parseSummary } from '../../core/chatSummary';
import { createAiProxyClient } from '../aiProxy';

/** 앱이 요약 응답을 기다리는 시간(ms). 서버 Gemini 마감 9초 + 여유 */
export const SUMMARY_TIMEOUT_MS = 14_000;

/** 규칙 요약만 하는 제공자(AI 서버 주소가 없을 때) */
export function createLocalSummary(): ChatSummaryProvider {
  return { id: 'local', async summarize(req) { return localSummary(req); } };
}

/** 대화 요약 제공자(WP3 소유). AI 서버(/ai/summary)가 있으면 ai(실패하면 규칙 요약 + aiUnavailable), 없으면 규칙 요약 */
export function createSummaryProvider(opts: { aiProxyUrl?: string; fetch: FetchLike; timeoutMs?: number }): ChatSummaryProvider {
  if (!opts.aiProxyUrl) return createLocalSummary();
  const client = createAiProxyClient({ url: opts.aiProxyUrl, fetch: opts.fetch });
  return {
    id: 'ai',
    async summarize(req: ChatSummaryRequest): Promise<ChatSummary> {
      try {
        const res = await client.call(
          '/summary',
          { title: req.title, region: req.region, start: req.start, end: req.end, messages: req.messages, spots: req.spots },
          { timeoutMs: opts.timeoutMs ?? SUMMARY_TIMEOUT_MS, signal: req.signal },
        );
        const s = parseSummary(res);
        if (!s) throw new Error('요약 모양이 틀리다');
        return s;
      } catch (e) {
        if (req.signal?.aborted) throw e;
        return { ...localSummary(req), aiUnavailable: true };
      }
    },
  };
}
