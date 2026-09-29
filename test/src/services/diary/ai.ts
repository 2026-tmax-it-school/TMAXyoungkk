import type { DiaryWriter, FetchLike } from '../../core/ports';
import { createAiProxyClient } from '../aiProxy';

/**
 * AI 프록시 일기 문장(WP6 소유, 순수). POST {url}/diary {date, blocks} → {texts: string[]}.
 * 응답 모양이 틀리거나 개수가 맞지 않거나 timeoutMs 안에 답이 없으면 던지고,
 * 호출 쪽(core/journal composeDiary)이 빈 일기로 대체한다. AI 키는 프록시 서버에만 있다.
 */

/** 프록시 응답을 기다리는 한도(프로토타입 가정). 넘으면 빈 일기로 대체해 21 화면이 멈추지 않는다. */
export const AI_DIARY_TIMEOUT_MS = 15_000;

export function createAiDiary(opts: { url: string; fetch: FetchLike; timeoutMs?: number }): DiaryWriter {
  const client = createAiProxyClient({ url: opts.url, fetch: opts.fetch });
  const timeoutMs = opts.timeoutMs ?? AI_DIARY_TIMEOUT_MS;
  return {
    id: 'ai',
    async write(input) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI 프록시 일기 응답 시간 초과')), timeoutMs);
      });
      let res: { texts?: unknown } | undefined;
      try {
        res = await Promise.race([client.call<{ texts?: unknown }>('/diary', input), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      const texts = res?.texts;
      if (!Array.isArray(texts) || texts.length !== input.blocks.length || texts.some((t) => typeof t !== 'string')) {
        throw new Error('AI 프록시 일기 응답 형식 오류');
      }
      return texts as string[];
    },
  };
}
