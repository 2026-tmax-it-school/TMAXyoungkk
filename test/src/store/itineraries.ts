import { create } from 'zustand';

import type { CommunityCtx, ItineraryDraft, ItineraryResult, ItinerarySort, SharedItinerary } from '../core/ports';
import type { SampleTrip } from '../data/sampleTrips';
import { normalizeSearch } from '../core/community';
import { getServices } from '../services/registry';
import { useSession } from './session';

/**
 * 일정 공유 목록(WP2 소유, 2026-10-17). 올라온 일정을 정렬(인기·최신·조회)·검색·지역으로 둘러본다. 저장하지 않는다.
 * 요청이 겹치면 가장 나중에 시작한 것만 반영한다. picked는 '이 일정으로 여행방 만들기'를 눌렀을 때 만들기 화면이 읽는
 * 예시 일정이다(일정 id와 함께 — 방을 만들면 가져오기 수를 올린다).
 */

interface ItinerariesState {
  items: SharedItinerary[];
  next: number | null;
  sort: ItinerarySort;
  query: string;
  region: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error?: string;
  picked: { itineraryId: string; sample: SampleTrip } | null;
  setSort: (sort: ItinerarySort) => void;
  setQuery: (raw: string) => void;
  setRegion: (region: string | null) => void;
  refresh: () => Promise<void>;
  more: () => Promise<void>;
  open: (id: string) => Promise<ItineraryResult<SharedItinerary>>;
  share: (draft: ItineraryDraft) => Promise<ItineraryResult<SharedItinerary>>;
  like: (id: string, on: boolean) => Promise<ItineraryResult<SharedItinerary>>;
  remove: (id: string) => Promise<ItineraryResult<true>>;
  pick: (itineraryId: string, sample: SampleTrip) => void;
  markImported: () => Promise<void>;
}

export async function itineraryCtx(): Promise<CommunityCtx> {
  const session = useSession.getState().session;
  if (!session) return {};
  const bearer = session.kind === 'account' && session.accountId ? await getServices().auth.bearer?.(session.accountId) : undefined;
  return { userId: session.userId, nickname: session.nickname, ...(bearer ? { token: bearer } : {}) };
}

let ticket = 0;

export const useItineraries = create<ItinerariesState>()((set, get) => ({
  items: [],
  next: null,
  sort: 'popular',
  query: '',
  region: null,
  status: 'idle',
  loadingMore: false,
  picked: null,

  setSort(sort) {
    if (get().sort === sort) return;
    set({ sort });
    void get().refresh();
  },
  setQuery(raw) {
    const n = normalizeSearch(raw);
    const q = n && n !== 'long' ? n : n === 'long' ? raw.trim().slice(0, 30) : '';
    if (get().query === q) return;
    set({ query: q });
    void get().refresh();
  },
  setRegion(region) {
    if (get().region === region) return;
    set({ region });
    void get().refresh();
  },

  async refresh() {
    const t = ++ticket;
    set({ status: 'loading', error: undefined });
    const { sort, query, region } = get();
    const r = await getServices().itineraries.list({ sort, q: query || null, region }, await itineraryCtx());
    if (t !== ticket) return;
    if (!r.ok) {
      set({ status: 'error', error: r.code });
      return;
    }
    set({ items: r.value.items, next: r.value.next, status: 'ready' });
  },

  async more() {
    const { next, loadingMore, sort, query, region } = get();
    if (next == null || loadingMore) return;
    const t = ticket;
    set({ loadingMore: true });
    const r = await getServices().itineraries.list({ sort, q: query || null, region, offset: next }, await itineraryCtx());
    if (t !== ticket) return;
    if (!r.ok) {
      set({ loadingMore: false });
      return;
    }
    const seen = new Set(get().items.map((i) => i.id));
    set({ items: [...get().items, ...r.value.items.filter((i) => !seen.has(i.id))], next: r.value.next, loadingMore: false });
  },

  async open(id) {
    return getServices().itineraries.get(id, await itineraryCtx());
  },

  async share(draft) {
    const r = await getServices().itineraries.share(draft, await itineraryCtx());
    if (r.ok) void get().refresh();
    return r;
  },

  async like(id, on) {
    const r = await getServices().itineraries.like(id, on, await itineraryCtx());
    if (r.ok) set({ items: get().items.map((i) => (i.id === id ? { ...i, likes: r.value.likes, liked: r.value.liked, score: r.value.score } : i)) });
    return r;
  },

  async remove(id) {
    const r = await getServices().itineraries.remove(id, await itineraryCtx());
    if (r.ok) set({ items: get().items.filter((i) => i.id !== id) });
    return r;
  },

  pick(itineraryId, sample) {
    set({ picked: { itineraryId, sample } });
  },

  async markImported() {
    const p = get().picked;
    if (!p) return;
    set({ picked: null });
    await getServices().itineraries.countImport(p.itineraryId, await itineraryCtx());
  },
}));
