import { create } from 'zustand';

import type { CommunityCtx, CommunityDraft, CommunityPost, CommunityResult } from '../core/ports';
import { failText, normalizeTag, popularTags } from '../core/community';
import { getServices } from '../services/registry';
import { useSession } from './session';

/**
 * 커뮤니티 피드(WP6 소유, 2026-10-10). 서버에 있는 글을 앱 사용자 모두가 본다. 저장하지 않는다(화면에 열 때 받는다).
 * 로그인한 계정만 올리고 지운다. 서버 계정이면 이 기기에 둔 세션 토큰(Bearer)을 같이 보낸다.
 * 요청이 겹치면 가장 나중에 시작한 것만 반영한다(태그를 바꾸거나 새로 고칠 때 늦은 응답이 덮지 않게).
 *
 * 2026-10-11: 사진·일기 거르기를 없애고 태그 하나로 거른다(tag, 없으면 전체). 전체를 받을 때 많이 쓴 태그(popular)를
 * 모아 피드 위 태그 줄에 보인다. 이어 받기(more) 실패는 moreError로 따로 둔다(목록은 그대로 보인다).
 */

interface CommunityState {
  posts: CommunityPost[];
  next: string | null;
  /** 지금 거르는 태그(맞춘 값). null이면 전체 */
  tag: string | null;
  /** 전체 피드에서 많이 쓴 태그 */
  popular: string[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error?: string;
  moreError?: string;
  setTag: (tag: string | null) => void;
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
  tag: null,
  popular: [],
  status: 'idle',
  loadingMore: false,

  setTag: (raw) => {
    const tag = raw == null ? null : normalizeTag(raw);
    if (tag === get().tag) return;
    set({ tag, posts: [], next: null });
    void get().refresh();
  },

  refresh: async () => {
    const mine = (ticket += 1);
    set({ status: 'loading', error: undefined, moreError: undefined, loadingMore: false });
    const tag = get().tag;
    const r = await getServices().community.list({ tag }, await ctxNow());
    if (mine !== ticket) return;
    if (r.ok) {
      set({
        posts: r.value.posts,
        next: r.value.next,
        status: 'ready',
        ...(tag == null ? { popular: popularTags(r.value.posts) } : {}),
      });
    } else set({ status: 'error', error: failText(r.code, r.detail) });
  },

  more: async () => {
    const { next, loadingMore, status, tag } = get();
    if (!next || loadingMore || status !== 'ready') return;
    const mine = ticket;
    set({ loadingMore: true, moreError: undefined });
    const r = await getServices().community.list({ before: next, tag }, await ctxNow());
    if (mine !== ticket) return;
    if (r.ok) {
      const seen = new Set(get().posts.map((p) => p.id));
      const posts = [...get().posts, ...r.value.posts.filter((p) => !seen.has(p.id))];
      set({ posts, next: r.value.next, loadingMore: false, ...(tag == null ? { popular: popularTags(posts) } : {}) });
    } else set({ loadingMore: false, moreError: failText(r.code, r.detail) });
  },

  publish: async (draft) => {
    const r = await getServices().community.create(draft, await ctxNow());
    if (r.ok) {
      const tag = get().tag;
      if (tag == null || r.value.tags.includes(tag)) set({ posts: [r.value, ...get().posts.filter((p) => p.id !== r.value.id)] });
    }
    return r;
  },

  remove: async (postId) => {
    const r = await getServices().community.remove(postId, await ctxNow());
    if (r.ok) set({ posts: get().posts.filter((p) => p.id !== postId) });
    return r;
  },
}));
