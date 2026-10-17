import type { Clock, FetchLike, IdGen, ItineraryProvider } from '../../core/ports';
import { createHttpItineraries } from './http';
import { createLocalItineraries } from './local';

export { createHttpItineraries } from './http';
export { createLocalItineraries } from './local';

/** 서버 주소가 있으면 일정 공유 서버, 없으면 이 기기 모의 */
export function createItineraryProvider(opts: { serverUrl?: string; fetch?: FetchLike; clock: Clock; ids: IdGen }): ItineraryProvider {
  if (opts.serverUrl && opts.fetch) return createHttpItineraries({ url: opts.serverUrl, fetch: opts.fetch });
  return createLocalItineraries({ clock: opts.clock, ids: opts.ids });
}
