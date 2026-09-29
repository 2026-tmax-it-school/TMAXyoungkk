import type { ExtractionProvider, FetchLike } from '../../core/ports';
import { createAiExtraction } from './ai';
import { createRulesExtraction } from './rules';

/** 추출 제공자 팩토리(WP3 소유, 순수). AI 프록시 주소가 있으면 ai(실패 시 규칙 기반 대체), 없으면 규칙 기반. */
export function createExtractionProvider(opts: { aiProxyUrl?: string; fetch: FetchLike }): ExtractionProvider {
  if (opts.aiProxyUrl) {
    return createAiExtraction({ url: opts.aiProxyUrl, fetch: opts.fetch, fallback: createRulesExtraction() });
  }
  return createRulesExtraction();
}
