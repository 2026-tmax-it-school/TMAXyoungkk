import { create } from 'zustand';

import type { CommunityCtx, CommunityDraft, CommunityEditDraft, CommunityPost, CommunityResult } from '../core/ports';
import { failText, matchesSearch, normalizeSearch, normalizeTag, popularTags } from '../core/community';
import { getServices } from '../services/registry';
import { useSession } from './session';

/**
 * 커뮤니티 피드(WP6 소유, 2026-10-10). 서버에 있는 글을 앱 사용자 모두가 본다. 저장하지 않는다(화면에 열 때 받는다).
 * 로그인한 계정만 올리고 지운다. 서버 계정이면 이 기기에 둔 세션 토큰(Bearer)을 같이 보낸다.
 * 요청이 겹치면 가장 나중에 시작한 것만 반영한다(태그를 바꾸거나 새로 고칠 때 늦은 응답이 덮지 않게).
 *
 * 2026-10-11: 사진·일기 거르기를 없애고 태그 하나로 거른다(tag, 없으면 전체). 전체를 받을 때 많이 쓴 태그(popular)를
 * 모아 피드 위 태그 줄에 보인다. 이어 받기(more) 실패는 moreError로 따로 둔다(목록은 그대로 보인다).
 * 2026-10-17: 제목·태그 검색(query). 검색어가 있으면 제목이나 태그에 들어 있는 글만 보이고(서버가 거른다) 많이 쓴 태그 줄은
 * 전체 피드에서만 모은다. 검색 중에 올린 글·고친 글은 검색어에 맞을 때만 목록에 둔다.
 * 2026-10-17: 내 글 고치기(edit). 성공하면 피드의 그 글을 제자리에서 바꾼다(거르는 태그가 빠졌으면 목록에서 뺀다).
 */

interface CommunityState {
  posts: CommunityPost[];
  next: string | null;
  /** 지금 거르는 태그(맞춘 값). null이면 전체 */
  tag: string | null;
  /** 지금 검색어(맞춘 값). 빈 문자열이면 검색 안 함 */
  query: string;
  /** 전체 피드에서 많이 쓴 태그 */
  popular: string[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error?: string;
  moreError?: string;
  setTag: (tag: string | null) => void;
  setQuery: (raw: string) => void;
  refresh: () => Promise<void>;
  more: () => Promise<void>;
  publish: (draft: CommunityDraft) => Promise<CommunityResult<CommunityPost>>;
  edit: (postId: string, draft: CommunityEditDraft) => Promise<CommunityResult<CommunityPost>>;
  remove: (postId: string) => Promise<CommunityResult<true>>;
  /** 좋아요 켜기·끄기. 누르는 즉시 숫자를 바꾸고(낙관), 서버 값으로 맞춘다. 실패하면 되돌린다 */
  like: (postId: string) => Promise<CommunityResult<CommunityPost>>;
  /** 화면에 보인 글의 조회수를 한 번 올린다(이 실행에서 글마다 한 번만 부른다) */
  view: (postId: string) => void;
}

/** 지금 부르는 사람. 서버 계정이면 세션 토큰을 붙인다 */
async function ctxNow(): Promise<CommunityCtx> {
  const session = useSession.getState().session;
  if (!session) return {};
  const bearer = session.kind === 'account' && session.accountId ? await getServices().auth.bearer?.(session.accountId) : undefined;
  return { userId: session.userId, nickname: session.nickname, ...(bearer ? { token: bearer } : {}) };
}

let ticket = 0;
/** 이 실행에서 조회를 이미 보낸 글 */
const viewSent = new Set<string>();

export const useCommunity = create<CommunityState>()((set, get) => ({
  posts: [],
  next: null,
  tag: null,
  query: '',
  popular: [],
  status: 'idle',
  loadingMore: false,

  setTag: (raw) => {
    const tag = raw == null ? null : normalizeTag(raw);
    if (tag === get().tag) return;
    set({ tag, posts: [], next: null });
    void get().refresh();
  },

  setQuery: (raw) => {
    const query = normalizeSearch(raw);
    if (query === get().query) return;
    set({ query, posts: [], next: null });
    void get().refresh();
  },

  refresh: async () => {
    const mine = (ticket += 1);
    set({ status: 'loading', error: undefined, moreError: undefined, loadingMore: false });
    const { tag, query } = get();
    const r = await getServices().community.list({ tag, q: query || null }, await ctxNow());
    if (mine !== ticket) return;
    if (r.ok) {
      set({
        posts: r.value.posts,
        next: r.value.next,
        status: 'ready',
        ...(tag == null && !query ? { popular: popularTags(r.value.posts) } : {}),
      });
    } else set({ status: 'error', error: failText(r.code, r.detail) });
  },

  more: async () => {
    const { next, loadingMore, status, tag, query } = get();
    if (!next || loadingMore || status !== 'ready') return;
    const mine = ticket;
    set({ loadingMore: true, moreError: undefined });
    const r = await getServices().community.list({ before: next, tag, q: query || null }, await ctxNow());
    if (mine !== ticket) return;
    if (r.ok) {
      const seen = new Set(get().posts.map((p) => p.id));
      const posts = [...get().posts, ...r.value.posts.filter((p) => !seen.has(p.id))];
      set({ posts, next: r.value.next, loadingMore: false, ...(tag == null && !query ? { popular: popularTags(posts) } : {}) });
    } else set({ loadingMore: false, moreError: failText(r.code, r.detail) });
  },

  publish: async (draft) => {
    const r = await getServices().community.create(draft, await ctxNow());
    if (r.ok) {
      const { tag, query } = get();
      const fits = (tag == null || r.value.tags.includes(tag)) && (!query || matchesSearch(r.value, query));
      if (fits) set({ posts: [r.value, ...get().posts.filter((p) => p.id !== r.value.id)] });
    }
    return r;
  },

  edit: async (postId, draft) => {
    const r = await getServices().community.update(postId, draft, await ctxNow());
    if (r.ok) {
      const { tag, query } = get();
      const fits = (tag == null || r.value.tags.includes(tag)) && (!query || matchesSearch(r.value, query));
      const posts = fits ? get().posts.map((p) => (p.id === postId ? r.value : p)) : get().posts.filter((p) => p.id !== postId);
      set({ posts, ...(tag == null && !query ? { popular: popularTags(posts) } : {}) });
    }
    return r;
  },

  remove: async (postId) => {
    const r = await getServices().community.remove(postId, await ctxNow());
    if (r.ok) set({ posts: get().posts.filter((p) => p.id !== postId) });
    return r;
  },

  like: async (postId) => {
    const cur = get().posts.find((p) => p.id === postId);
    const on = !(cur?.liked ?? false);
    const patch = (liked: boolean, likes: number) => set({ posts: get().posts.map((p) => (p.id === postId ? { ...p, liked, likes } : p)) });
    if (cur) patch(on, Math.max(0, (cur.likes ?? 0) + (on ? 1 : -1)));
    const r = await getServices().community.like(postId, on, await ctxNow());
    if (r.ok) patch(r.value.liked === true, r.value.likes ?? 0);
    else if (cur) patch(cur.liked ?? false, cur.likes ?? 0);
    return r;
  },

  view: (postId) => {
    if (viewSent.has(postId)) return;
    viewSent.add(postId);
    void (async () => {
      const r = await getServices().community.view(postId, await ctxNow());
      if (r.ok) set({ posts: get().posts.map((p) => (p.id === postId ? { ...p, views: r.value } : p)) });
      else viewSent.delete(postId);
    })();
  },
}));
