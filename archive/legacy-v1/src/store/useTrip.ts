import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Category, ChatMessage, Member, Spot, Transport, Trip } from '../types';
import {
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  DEFAULT_STAY_MIN,
  GUEST_TOKEN_TTL_MS,
  INVITE_TTL_MS,
  MEMBER_CAPACITY,
} from '../core/constants';
import { extractPlaces } from '../core/extract';
import { buildPlan, recalcDay } from '../core/planner';
import { newId } from '../core/util';
import { provider } from '../services';

/** FR-105 게스트 세션. 기기 토큰 + 닉네임, 30일, 쓸 때마다 갱신. */
export interface GuestSession {
  deviceToken: string;
  nickname: string;
  issuedAt: number;
  expiresAt: number;
}

interface State {
  session?: GuestSession;
  trips: Trip[];
  currentTripId?: string;
  /** 채팅에서 "누가 말하는지". 프로토타입에서 제안자 수 규칙을 시험해 보려고 둔다. */
  speakingAs?: string;
  busy: boolean;
  lastNotice?: string;

  createGuest: (nickname: string) => void;
  touchSession: () => void;

  createTrip: (input: {
    title: string;
    region: string;
    startDate: string;
    endDate: string;
    baseName: string;
    baseCoord: { latitude: number; longitude: number };
    transport: Transport;
  }) => Promise<string>;
  openTrip: (tripId: string) => void;
  current: () => Trip | undefined;

  sendMessage: (text: string) => Promise<number>;
  undoExtraction: (messageId: string) => void;
  setSpeakingAs: (memberId: string) => void;

  addSpotBySearch: (query: string) => Promise<number>;
  togglePin: (spotId: string) => Promise<void>;
  setStay: (spotId: string, stayMin: number) => Promise<void>;
  setFixedDate: (spotId: string, date?: string) => Promise<void>;
  removeSpot: (spotId: string) => Promise<void>;
  restoreSpot: (spotId: string) => Promise<void>;

  setTransport: (transport: Transport) => Promise<void>;
  recompute: () => Promise<void>;
  reorderDay: (date: string, spotIds: string[]) => Promise<void>;

  issueInvite: () => void;
  joinAsMember: (nickname: string) => void;
  leaveMember: (memberId: string) => void;
}

function stayFor(category: Category): number {
  return DEFAULT_STAY_MIN[category] ?? DEFAULT_STAY_MIN.기타;
}

export const useTrip = create<State>()(
  persist(
    (set, get) => {
      /** 현재 여행방을 바꾸고 저장한다. */
      const patchTrip = (tripId: string, fn: (t: Trip) => Trip) => {
        set((s) => ({ trips: s.trips.map((t) => (t.id === tripId ? fn(t) : t)) }));
      };

      const withPlan = async (tripId: string) => {
        const trip = get().trips.find((t) => t.id === tripId);
        if (!trip) return;
        set({ busy: true });
        try {
          const plan = await buildPlan(trip);
          patchTrip(tripId, (t) => ({ ...t, plan }));
        } finally {
          set({ busy: false });
        }
      };

      return {
        trips: [],
        busy: false,

        createGuest: (nickname) => {
          const now = Date.now();
          set({
            session: {
              deviceToken: newId('dev'),
              nickname: nickname.trim() || '게스트',
              issuedAt: now,
              expiresAt: now + GUEST_TOKEN_TTL_MS,
            },
          });
        },

        /** 사용할 때마다 만료를 미룬다. 만료된 토큰은 버린다. */
        touchSession: () => {
          const s = get().session;
          if (!s) return;
          if (Date.now() > s.expiresAt) {
            set({ session: undefined, currentTripId: undefined });
            return;
          }
          set({ session: { ...s, expiresAt: Date.now() + GUEST_TOKEN_TTL_MS } });
        },

        createTrip: async (input) => {
          const session = get().session;
          const host: Member = {
            id: newId('mem'),
            nickname: session?.nickname ?? '나',
            isHost: true,
            isGuest: true,
            joinedAt: Date.now(),
          };
          const trip: Trip = {
            id: newId('trip'),
            title: input.title,
            region: input.region,
            startDate: input.startDate,
            endDate: input.endDate,
            base: { name: input.baseName, coord: input.baseCoord },
            transport: input.transport,
            dayStart: DEFAULT_DAY_START,
            dayEnd: DEFAULT_DAY_END,
            members: [host],
            spots: [],
            messages: [],
            createdAt: Date.now(),
          };
          set((s) => ({
            trips: [trip, ...s.trips],
            currentTripId: trip.id,
            speakingAs: host.id,
          }));
          await withPlan(trip.id);
          return trip.id;
        },

        openTrip: (tripId) => {
          const trip = get().trips.find((t) => t.id === tripId);
          set({ currentTripId: tripId, speakingAs: trip?.members[0]?.id });
        },

        current: () => get().trips.find((t) => t.id === get().currentTripId),

        setSpeakingAs: (memberId) => set({ speakingAs: memberId }),

        /** FR-304 채팅 + FR-401 장소 추출 + FR-402 후보 병합 */
        sendMessage: async (text) => {
          const trip = get().current();
          if (!trip) return 0;
          const speaker = get().speakingAs ?? trip.members[0]?.id;
          const message: ChatMessage = {
            id: newId('msg'),
            memberId: speaker,
            text,
            sentAt: Date.now(),
            extractedSpotIds: [],
          };
          patchTrip(trip.id, (t) => ({ ...t, messages: [...t.messages, message] }));

          set({ busy: true });
          let added = 0;
          try {
            const hits = await extractPlaces(text, trip);
            if (hits.length === 0) {
              // 인식 실패 시 후보를 만들지 않고 화면에도 표시하지 않는다.
              return 0;
            }
            const touched: string[] = [];
            patchTrip(trip.id, (t) => {
              const spots = [...t.spots];
              for (const hit of hits) {
                const existing = spots.find((s) => s.name === hit.name);
                if (existing) {
                  // 중복 장소는 하나로 합치고 제안자만 누적한다 (FR-402)
                  if (!existing.proposerIds.includes(speaker)) {
                    const merged = {
                      ...existing,
                      proposerIds: [...existing.proposerIds, speaker],
                    };
                    spots[spots.indexOf(existing)] = merged;
                    touched.push(merged.id);
                  }
                  continue;
                }
                const spot: Spot = {
                  id: newId('spot'),
                  name: hit.name,
                  category: hit.category,
                  coord: hit.coord,
                  address: hit.address,
                  proposerIds: [speaker],
                  pinned: false,
                  stayMin: stayFor(hit.category),
                  createdAt: Date.now() + spots.length,
                  sourceText: text,
                };
                spots.push(spot);
                touched.push(spot.id);
                added += 1;
              }
              return {
                ...t,
                spots,
                messages: t.messages.map((m) =>
                  m.id === message.id ? { ...m, extractedSpotIds: touched } : m,
                ),
              };
            });
          } finally {
            set({ busy: false });
          }
          await withPlan(trip.id);
          return added;
        },

        /** 오인식 되돌리기. 그 메시지로 새로 생긴 후보만 지운다. */
        undoExtraction: (messageId) => {
          const trip = get().current();
          if (!trip) return;
          const message = trip.messages.find((m) => m.id === messageId);
          if (!message) return;
          patchTrip(trip.id, (t) => ({
            ...t,
            spots: t.spots.filter((s) => !message.extractedSpotIds.includes(s.id)),
            messages: t.messages.map((m) =>
              m.id === messageId ? { ...m, extractedSpotIds: [] } : m,
            ),
          }));
          void withPlan(trip.id);
        },

        /** FR-202 스팟 수동 등록 */
        addSpotBySearch: async (query) => {
          const trip = get().current();
          if (!trip) return 0;
          const speaker = get().speakingAs ?? trip.members[0]?.id;
          set({ busy: true });
          try {
            const hits = await provider.searchPlaces(query, trip.region, trip.base.coord);
            if (hits.length === 0) {
              set({ lastNotice: `"${query}" 검색 결과가 없습니다.` });
              return 0;
            }
            const hit = hits[0];
            let added = 0;
            patchTrip(trip.id, (t) => {
              const existing = t.spots.find((s) => s.name === hit.name);
              if (existing) {
                return {
                  ...t,
                  spots: t.spots.map((s) =>
                    s.id === existing.id && !s.proposerIds.includes(speaker)
                      ? { ...s, proposerIds: [...s.proposerIds, speaker], removedByUser: false }
                      : s,
                  ),
                };
              }
              added = 1;
              const spot: Spot = {
                id: newId('spot'),
                name: hit.name,
                category: hit.category,
                coord: hit.coord,
                address: hit.address,
                proposerIds: [speaker],
                pinned: false,
                stayMin: stayFor(hit.category),
                createdAt: Date.now(),
              };
              return { ...t, spots: [...t.spots, spot] };
            });
            set({ lastNotice: added ? `${hit.name} 후보에 담았습니다.` : `${hit.name}에 제안자를 더했습니다.` });
            return added;
          } finally {
            set({ busy: false });
          }
        },

        togglePin: async (spotId) => {
          const trip = get().current();
          if (!trip) return;
          patchTrip(trip.id, (t) => ({
            ...t,
            spots: t.spots.map((s) => (s.id === spotId ? { ...s, pinned: !s.pinned } : s)),
          }));
          await withPlan(trip.id);
        },

        setStay: async (spotId, stayMin) => {
          const trip = get().current();
          if (!trip) return;
          patchTrip(trip.id, (t) => ({
            ...t,
            spots: t.spots.map((s) =>
              s.id === spotId ? { ...s, stayMin: Math.max(10, stayMin) } : s,
            ),
          }));
          await withPlan(trip.id);
        },

        setFixedDate: async (spotId, date) => {
          const trip = get().current();
          if (!trip) return;
          patchTrip(trip.id, (t) => ({
            ...t,
            spots: t.spots.map((s) => (s.id === spotId ? { ...s, fixedDate: date } : s)),
          }));
          await withPlan(trip.id);
        },

        removeSpot: async (spotId) => {
          const trip = get().current();
          if (!trip) return;
          patchTrip(trip.id, (t) => ({
            ...t,
            spots: t.spots.map((s) => (s.id === spotId ? { ...s, removedByUser: true } : s)),
          }));
          await withPlan(trip.id);
        },

        restoreSpot: async (spotId) => {
          const trip = get().current();
          if (!trip) return;
          // 되돌리면 고정으로 올려 다시 빠지지 않게 한다 (FR-402).
          patchTrip(trip.id, (t) => ({
            ...t,
            spots: t.spots.map((s) =>
              s.id === spotId ? { ...s, removedByUser: false, pinned: true } : s,
            ),
          }));
          await withPlan(trip.id);
        },

        setTransport: async (transport) => {
          const trip = get().current();
          if (!trip) return;
          patchTrip(trip.id, (t) => ({ ...t, transport }));
          await withPlan(trip.id);
        },

        recompute: async () => {
          const trip = get().current();
          if (trip) await withPlan(trip.id);
        },

        /** FR-503. 순서는 사용자가 정한 대로 두고 시각만 다시 계산한다. */
        reorderDay: async (date, spotIds) => {
          const trip = get().current();
          if (!trip) return;
          set({ busy: true });
          try {
            const day = await recalcDay(trip, date, spotIds);
            patchTrip(trip.id, (t) => ({
              ...t,
              plan: t.plan
                ? { ...t.plan, days: t.plan.days.map((d) => (d.date === date ? day : d)) }
                : t.plan,
            }));
          } finally {
            set({ busy: false });
          }
        },

        /** FR-301 초대 링크 발급 */
        issueInvite: () => {
          const trip = get().current();
          if (!trip) return;
          const code = Math.random().toString(36).slice(2, 6).toUpperCase() +
            '-' +
            Math.random().toString(36).slice(2, 4).toUpperCase();
          patchTrip(trip.id, (t) => ({
            ...t,
            invite: { code, expiresAt: Date.now() + INVITE_TTL_MS, capacity: MEMBER_CAPACITY },
          }));
        },

        /**
         * FR-302 초대 수락. 프로토타입이라 서버 없이 이 기기에서 멤버를 하나 더 만든다.
         * 제안자 수 규칙을 혼자서도 시험해 볼 수 있게 하려는 장치다.
         */
        joinAsMember: (nickname) => {
          const trip = get().current();
          if (!trip) return;
          if (trip.members.length >= MEMBER_CAPACITY) {
            set({ lastNotice: `정원 ${MEMBER_CAPACITY}명을 넘길 수 없습니다.` });
            return;
          }
          if (trip.invite && Date.now() > trip.invite.expiresAt) {
            set({ lastNotice: '만료된 초대 링크입니다. 새 링크를 만드세요.' });
            return;
          }
          const member: Member = {
            id: newId('mem'),
            nickname: nickname.trim() || `게스트${trip.members.length + 1}`,
            isHost: false,
            isGuest: true,
            joinedAt: Date.now(),
          };
          patchTrip(trip.id, (t) => ({ ...t, members: [...t.members, member] }));
          set({ speakingAs: member.id, lastNotice: `${member.nickname} 합류` });
        },

        leaveMember: (memberId) => {
          const trip = get().current();
          if (!trip) return;
          const member = trip.members.find((m) => m.id === memberId);
          if (member?.isHost) {
            set({ lastNotice: '방장은 나갈 수 없습니다. 위임 정책은 미결정입니다.' });
            return;
          }
          patchTrip(trip.id, (t) => ({
            ...t,
            members: t.members.filter((m) => m.id !== memberId),
          }));
          if (get().speakingAs === memberId) {
            set({ speakingAs: trip.members.find((m) => m.isHost)?.id });
          }
        },
      };
    },
    {
      name: 'yeojeong-proto-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        session: s.session,
        trips: s.trips,
        currentTripId: s.currentTripId,
        speakingAs: s.speakingAs,
      }),
    },
  ),
);
