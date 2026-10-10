import { create } from 'zustand';

import type { CommunityCtx, CommunityDraft, CommunityKind, CommunityPost, CommunityResult } from '../core/ports';
import { failText } from '../core/community';
import { getServices } from '../services/registry';
import { useSession } from './session';

/**
 * 커뮤니티 피드(WP6 소유, 2026-10-10). 서버에 있는 글을 앱 사용자 모두가 본다. 저장하지 않는다(화면에 열 때 받는다).
 * 로그인한 계정만 올리고 지운다. 서버 계정이면 이 기기에 둔 세션 토큰(Bearer)을 같이 보낸다.
 * 요청이 겹치면 가장 나중에 시작한 것만 반영한다(종류를 바꾸거나 새로 고칠 때 늦은 응답이 덮지 않게).
 */
export type CommunityFilter = 'all' | CommunityKind;

interface CommunityState {
  posts: CommunityPost[];
  next: string | null;
  filter: CommunityFilter;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error?: string;
  setFilter: (f: CommunityFilter) => void;
  refresh: () => Promise<void>;
  more: () => Promise<void>;
  publish: (draft: CommunityDraft) => Promise<CommunityResult<CommunityPost>>;
  remove: (postId: string) => Promise<CommunityResult<true>>;
}

/** 지금 부르는 사람. 서버 계정이면 세션 토큰을 붙인다 */
async function ctxNow(): Promise<CommunityCtx> {
  const session = useSession.getState().session;
  if (!session) return {};
  const bearer = session.kind === 'account' && session.accountId ? await getServices().auth.bearer?.(session.accountId) : undefined;
  return { userId: session.userId, nickname: session.nickname, ...(bearer ? { token: bearer } : {}) };
}

let ticket = 0;

export const useCommunity = create<CommunityState>()((set, get) => ({
  posts: [],
  next: null,
  filter: 'all',
  status: 'idle',
  loadingMore: false,

  setFilter: (filter) => {
    if (filter === get().filter) return;
    set({ filter, posts: [], next: null });
    void get().refresh();
  },

  refresh: async () => {
    const mine = (ticket += 1);
    set({ status: 'loading', error: undefined, loadingMore: false });
    const kind = get().filter === 'all' ? null : (get().filter as CommunityKind);
    const r = await getServices().community.list({ kind }, await ctxNow());
    if (mine !== ticket) return;
    if (r.ok) set({ posts: r.value.posts, next: r.value.next, status: 'ready' });
    else set({ status: 'error', error: failText(r.code, r.detail) });
  },

  more: async () => {
    const { next, loadingMore, status } = get();
    if (!next || loadingMore || status !== 'ready') return;
    const mine = ticket;
    set({ loadingMore: true });
    const kind = get().filter === 'all' ? null : (get().filter as CommunityKind);
    const r = await getServices().community.list({ before: next, kind }, await ctxNow());
    if (mine !== ticket) return;
    if (r.ok) {
      const seen = new Set(get().posts.map((p) => p.id));
      set({ posts: [...get().posts, ...r.value.posts.filter((p) => !seen.has(p.id))], next: r.value.next, loadingMore: false });
    } else set({ loadingMore: false, error: failText(r.code, r.detail) });
  },

  publish: async (draft) => {
    const r = await getServices().community.create(draft, await ctxNow());
    if (r.ok) {
      const f = get().filter;
      if (f === 'all' || f === r.value.kind) set({ posts: [r.value, ...get().posts] });
    }
    return r;
  },

  remove: async (postId) => {
    const r = await getServices().community.remove(postId, await ctxNow());
    if (r.ok) set({ posts: get().posts.filter((p) => p.id !== postId) });
    return r;
  },
}));
