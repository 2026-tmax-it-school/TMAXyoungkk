import type { Clock, CommunityProvider, FetchLike, IdGen } from '../../core/ports';
import { createHttpCommunity } from './http';
import { createLocalCommunity } from './local';

export { createHttpCommunity } from './http';
export { createLocalCommunity } from './local';

/** 서버 주소(EXPO_PUBLIC_API_URL 또는 EXPO_PUBLIC_SYNC_URL)가 있으면 커뮤니티 서버, 없으면 이 기기 모의 */
export function createCommunityProvider(opts: { serverUrl?: string; fetch?: FetchLike; clock: Clock; ids: IdGen }): CommunityProvider {
  if (opts.serverUrl && opts.fetch) return createHttpCommunity({ url: opts.serverUrl, fetch: opts.fetch });
  return createLocalCommunity({ clock: opts.clock, ids: opts.ids });
}
