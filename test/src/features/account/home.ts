import type { Plan, Trip } from '../../types';
import { TRANSPORT_LABEL } from '../../core/constants';
import { activeMembers, tripMode } from '../../core/group';
import { daysUntil, tripStatus, type TripStatus } from '../../core/tripStatus';
import { daysBetween, kstDate, weekday } from '../../core/util';

/**
 * 03 홈 · 메인 메뉴 판정(FR-203, WP1 소유). 순수 함수라 wp1-home 테스트가 node로 부른다.
 * 상태는 공유 tripStatus(KST, appClock)이므로 시뮬레이터 시각이 바뀌면 세그먼트도 같이 바뀐다.
 */

export const STATUS_LABEL: Record<TripStatus, string> = { upcoming: '예정', ongoing: '진행중', done: '완료' };
/** 목업 03 순서: 진행중, 예정, 완료 */
export const SEGMENT_ORDER: TripStatus[] = ['ongoing', 'upcoming', 'done'];

export interface HomeSegments {
  groups: Record<TripStatus, Trip[]>;
  counts: Record<TripStatus, number>;
}

export function homeSegments(trips: Trip[], now: number): HomeSegments {
  const groups: Record<TripStatus, Trip[]> = { upcoming: [], ongoing: [], done: [] };
  for (const t of trips) {
    if (t.deletedAt != null) continue;
    groups[tripStatus(t, now)].push(t);
  }
  // 진행중·예정은 가까운 시작일 순, 완료는 최근에 끝난 순
  groups.ongoing.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt - b.createdAt);
  groups.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt - b.createdAt);
  groups.done.sort((a, b) => b.endDate.localeCompare(a.endDate) || b.createdAt - a.createdAt);
  return {
    groups,
    counts: { upcoming: groups.upcoming.length, ongoing: groups.ongoing.length, done: groups.done.length },
  };
}

/** 처음 여는 세그먼트. 진행중이 있으면 진행중, 없으면 예정, 그다음 완료 */
export function defaultSegment(counts: Record<TripStatus, number>): TripStatus {
  return SEGMENT_ORDER.find((k) => counts[k] > 0) ?? 'ongoing';
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** '10월 17일(금) – 19일(일)'. 달이 바뀌면 끝에도 달을 적는다 */
export function tripDateText(trip: Pick<Trip, 'startDate' | 'endDate'>, withWeekday = false): string {
  const [, sm, sd] = trip.startDate.split('-').map(Number);
  const [, em, ed] = trip.endDate.split('-').map(Number);
  const w = (date: string) => (withWeekday ? `(${WEEK[weekday(date)]})` : '');
  const start = `${sm}월 ${sd}일${w(trip.startDate)}`;
  if (trip.startDate === trip.endDate) return start;
  const end = sm === em ? `${ed}일${w(trip.endDate)}` : `${em}월 ${ed}일${w(trip.endDate)}`;
  return `${start} – ${end}`;
}

/** 카드 머리 칩. 예정은 'D-일', 진행중은 'N일째', 완료는 '여행 끝' */
export function tripBadge(trip: Trip, now: number): string {
  const s = tripStatus(trip, now);
  if (s === 'upcoming') {
    const d = daysUntil(trip, now);
    return d === 1 ? '여행 하루 전 · D-1' : `여행 ${d}일 전 · D-${d}`;
  }
  if (s === 'ongoing') return `여행 중 · ${daysBetween(trip.startDate, kstDate(now)) + 1}일째`;
  return '여행 끝';
}

export interface TripCounts {
  candidates: number;
  confirmed?: number;
  excluded?: number;
}

/** 후보·확정·제외 수. 계획이 아직 없으면 확정·제외는 비운다 */
export function tripCounts(trip: Trip, plan?: Plan): TripCounts {
  const candidates = trip.spots.length;
  if (!plan) return { candidates };
  const confirmed = plan.days.reduce((n, d) => n + d.items.length, 0);
  return { candidates, confirmed, excluded: plan.excluded.length };
}

export function countsText(c: TripCounts): string {
  if (c.candidates === 0) return '후보 없음 · 채팅이나 검색으로 모아 주세요';
  if (c.confirmed == null) return `후보 ${c.candidates}곳 · 계산 전`;
  return `후보 ${c.candidates}곳 · 확정 ${c.confirmed} · 제외 ${c.excluded ?? 0}`;
}

export interface TripCardInfo {
  badge: string;
  title: string;
  dateText: string;
  memberNames: string[];
  counts: TripCounts;
  countsText: string;
}

export function tripCardInfo(trip: Trip, plan: Plan | undefined, now: number): TripCardInfo {
  const counts = tripCounts(trip, plan);
  return {
    badge: tripBadge(trip, now),
    title: trip.title,
    dateText: `${tripDateText(trip)} · ${TRANSPORT_LABEL[trip.transport]}`,
    memberNames: activeMembers(trip).map((m) => m.nickname),
    counts,
    countsText: countsText(counts),
  };
}

/* ---------- 메뉴 6칸 ---------- */

export type HomeMenuKey = 'create' | 'chat' | 'candidates' | 'map' | 'members' | 'navigate';
export type HomeMenuIcon = 'plus' | 'chat' | 'list' | 'map' | 'link' | 'nav';

export interface HomeMenuCell {
  key: HomeMenuKey;
  label: string;
  sub: string;
  icon: HomeMenuIcon;
  disabled: boolean;
  /** 비활성 이유(칸 안에 적는다) */
  reason?: string;
  /** 2·3차 기능 표시 */
  scope?: '2차' | '3차';
}

/**
 * 메뉴 6칸(목업 03). 여행방이 없으면 만들기만 열린다. 개인 모드면 채팅 칸이 비활성이고 이유를 적는다.
 * 길찾기는 2차 기능이지만 여행 시뮬레이터로 동작하므로 활성에 ScopeBadge '2차'를 단다.
 */
export function homeMenu(trip: Trip | undefined, plan?: Plan): HomeMenuCell[] {
  const noTrip = '여행방을 먼저 골라 주세요';
  const c = trip ? tripCounts(trip, plan) : undefined;
  const personal = trip ? tripMode(trip) === 'personal' : false;
  const cells: HomeMenuCell[] = [
    { key: 'create', label: '여행방 만들기', sub: '날짜와 기점부터', icon: 'plus', disabled: false },
    trip
      ? personal
        ? {
            key: 'chat',
            label: '그룹 채팅',
            sub: '혼자인 여행방',
            icon: 'chat',
            disabled: true,
            reason: '멤버를 초대하면 채팅과 대화 인식이 열립니다',
          }
        : {
            key: 'chat',
            label: '그룹 채팅',
            sub: `메시지 ${trip.messages.length}개`,
            icon: 'chat',
            disabled: false,
          }
      : { key: 'chat', label: '그룹 채팅', sub: '', icon: 'chat', disabled: true, reason: noTrip },
    {
      key: 'candidates',
      label: '후보',
      sub: c ? (c.excluded != null ? `${c.candidates}곳 · 제외 ${c.excluded}` : `${c.candidates}곳`) : '',
      icon: 'list',
      disabled: !trip,
      reason: trip ? undefined : noTrip,
    },
    { key: 'map', label: '지도 · 루트', sub: '하루 단위로', icon: 'map', disabled: !trip, reason: trip ? undefined : noTrip },
    { key: 'members', label: '멤버 초대', sub: '링크 공유', icon: 'link', disabled: !trip, reason: trip ? undefined : noTrip },
    {
      key: 'navigate',
      label: '길찾기',
      sub: '여행 시뮬레이터로 시연',
      icon: 'nav',
      disabled: !trip,
      reason: trip ? undefined : noTrip,
      scope: '2차',
    },
  ];
  return cells;
}

/* ---------- 추천 여행지 줄(2026-10-10 리디자인) ---------- */

export interface HomePick {
  id: string;
  name: string;
  blurb: string;
}

/** 홈 '추천 여행지' 가로 줄. 누르면 여행방 만들기로 간다(지역은 거기서 고른다) */
export const HOME_PICKS: HomePick[] = [
  { id: 'busan', name: '부산', blurb: '바다와 야경이 있는 항구 도시' },
  { id: 'gyeongju', name: '경주', blurb: '천년 고도를 걷는 산책' },
  { id: 'jeju', name: '제주', blurb: '자연을 만끽하기 좋은 섬' },
  { id: 'gangneung', name: '강릉', blurb: '커피 거리와 동해 바다' },
  { id: 'jeonju', name: '전주', blurb: '한옥마을과 골목 맛집' },
  { id: 'yeosu', name: '여수', blurb: '밤바다가 예쁜 남해 도시' },
];
