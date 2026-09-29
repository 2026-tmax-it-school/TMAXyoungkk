import type { DiaryWriter, FetchLike } from '../../core/ports';
import { createAiDiary } from './ai';
import { createTemplateDiary } from './template';

/** 일기 문장 작성기 팩토리(WP6 소유). AI 프록시 주소가 있으면 ai, 없으면 템플릿. */
export function createDiaryWriter(opts: { aiProxyUrl?: string; fetch: FetchLike }): DiaryWriter {
  if (opts.aiProxyUrl) return createAiDiary({ url: opts.aiProxyUrl, fetch: opts.fetch });
  return createTemplateDiary();
}
