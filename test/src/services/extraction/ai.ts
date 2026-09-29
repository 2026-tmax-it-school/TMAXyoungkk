import type { ExtractedPhrase, ExtractionProvider, FetchLike } from '../../core/ports';
import { anchorPhrases } from '../../core/extract/text';
import { createAiProxyClient } from '../aiProxy';

/**
 * AI 프록시 추출(WP3 소유, 순수). AI 키는 프록시 서버에만 있다. 브라우저에서 AI 제공자를 직접 부르지 않는다.
 *
 * 규약: POST {프록시}/extract, 본문 {text, region:{id,name}}, 응답 {phrases:[{phrase,start?,end?}]}.
 * 응답은 믿지 않고 원문 부분 문자열로 다시 맞춘다(anchorPhrases). 원문에 없는 표현, 조사가 붙은 표현은 바로잡거나 버린다.
 * 프록시가 실패하거나 모양이 틀리면 규칙 기반(fallback)으로 대체한다.
 */
export function createAiExtraction(opts: {
  url: string;
  fetch: FetchLike;
  fallback: ExtractionProvider;
}): ExtractionProvider {
  const client = createAiProxyClient({ url: opts.url, fetch: opts.fetch });
  return {
    id: 'ai',
    async phrases(text, ctx): Promise<ExtractedPhrase[]> {
      try {
        const res = await client.call<{ phrases?: unknown }>('/extract', {
          text,
          region: { id: ctx.region.id, name: ctx.region.name },
        });
        if (!res || !Array.isArray(res.phrases)) throw new Error('추출 응답 형식이 다르다');
        return anchorPhrases(text, res.phrases as Partial<ExtractedPhrase>[]);
      } catch {
        return opts.fallback.phrases(text, ctx);
      }
    },
  };
}
