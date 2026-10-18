import type { Plan, Trip } from '../../types';
import { sampleTripFor } from '../../data/sampleTrips';
import { TRANSPORT_LABEL } from '../../core/constants';
import { activeMembers, tripMode } from '../../core/group';
import { daysUntil, tripStatus, type TripStatus } from '../../core/tripStatus';
import { daysBetween, kstDate, weekday } from '../../core/util';

/**
 * 03 홈 판정(FR-203, WP1 소유). 순수 함수라 wp1-home 테스트가 node로 부른다.
 * 상태는 공유 tripStatus(KST, appClock)이므로 시뮬레이터 시각이 바뀌면 세그먼트도 같이 바뀐다.
 * 홈은 여행 표지 카드 줄(다음 할 일 버튼 tripNextStep)과 선택한 여행방의 빠른 메뉴 4칸(homeActions)으로 이뤄진다.
 * tripBadge와 homeSegments는 TripBar(features/trip)도 쓴다. 이름과 모양을 바꾸지 않는다.
 */

export const STATUS_LABEL: Record<TripStatus, string> = { upcoming: '예정', ongoing: '진행 중', done: '완료' };
/** 목업 03 순서: 진행 중, 예정, 완료 */
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
  // 진행 중·예정은 가까운 시작일 순, 완료는 최근에 끝난 순
  groups.ongoing.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt - b.createdAt);
  groups.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt - b.createdAt);
  groups.done.sort((a, b) => b.endDate.localeCompare(a.endDate) || b.createdAt - a.createdAt);
  return {
    groups,
    counts: { upcoming: groups.upcoming.length, ongoing: groups.ongoing.length, done: groups.done.length },
  };
}

/** 처음 여는 세그먼트. 진행 중이 있으면 진행 중, 없으면 예정, 그다음 완료 */
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

/** 카드 머리 칩. 예정은 'D-일', 진행 중은 'N일째', 완료는 '여행 끝' */
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

/* ---------- 다음 할 일(여행 표지 카드 버튼) ---------- */

/** 오늘(KST 'YYYY-MM-DD') 기준 상태. tripStatus와 같은 규칙을 날짜 문자열로 판정한다 */
function statusOn(trip: Pick<Trip, 'startDate' | 'endDate'>, today: string): TripStatus {
  if (today < trip.startDate) return 'upcoming';
  if (today > trip.endDate) return 'done';
  return 'ongoing';
}

export type TripNextStep =
  | { key: 'records'; label: '여행일지 보기'; route: 'Journal' }
  | { key: 'live'; label: '오늘 여행 진행'; route: 'LiveTrip'; date: string }
  | { key: 'collect'; label: '후보 모으기'; route: 'Candidates' }
  | { key: 'plan'; label: '루트 계산하기'; route: 'Planning' }
  | { key: 'schedule'; label: '시간표 보기'; route: 'Schedule' };

/**
 * 여행 표지 카드의 버튼(다음 할 일). 상태에서 계산해 앞에 둔다.
 * 완료면 여행일지, 진행 중이면 오늘 여행 진행, 후보가 0곳이면 후보 모으기, 계획이 없으면 루트 계산, 그 밖에는 시간표다.
 */
export function tripNextStep(trip: Trip, plan: Plan | undefined, today: string): TripNextStep {
  const s = statusOn(trip, today);
  if (s === 'done') return { key: 'records', label: '여행일지 보기', route: 'Journal' };
  if (s === 'ongoing') return { key: 'live', label: '오늘 여행 진행', route: 'LiveTrip', date: today };
  if (trip.spots.length === 0) return { key: 'collect', label: '후보 모으기', route: 'Candidates' };
  if (!plan) return { key: 'plan', label: '루트 계산하기', route: 'Planning' };
  return { key: 'schedule', label: '시간표 보기', route: 'Schedule' };
}

/* ---------- 세그먼트(여행방이 많을 때만) ---------- */

/** 개수가 0보다 큰 칸만 진행 중 → 예정 → 완료 순으로 */
export function visibleSegments(counts: Record<TripStatus, number>): TripStatus[] {
  return SEGMENT_ORDER.filter((k) => counts[k] > 0);
}

/** 세그먼트 줄은 여행방이 4개 이상이고 보이는 칸이 2개 이상일 때만 그린다. 아니면 한 줄에 전부 놓는다 */
export function showsSegmentBar(tripCount: number, visible: readonly TripStatus[]): boolean {
  return tripCount >= 4 && visible.length >= 2;
}

/* ---------- 선택한 여행방의 빠른 메뉴 4칸 ---------- */

export type HomeMenuKey =
  | 'create'
  | 'chat'
  | 'candidates'
  | 'map'
  | 'members'
  | 'navigate'
  | 'recommend'
  | 'settings'
  | 'share'
  | 'itineraries'
  | 'diary';
export type HomeMenuIcon = 'plus' | 'chat' | 'list' | 'map' | 'link' | 'nav' | 'compass' | 'gear' | 'camera' | 'book' | 'users' | 'share';

export interface HomeMenuCell {
  key: HomeMenuKey;
  label: string;
  icon: HomeMenuIcon;
  disabled: boolean;
  /** 꺼진 이유(칸 아래 한 줄로 적는다) */
  reason?: string;
  /** 칸이 여는 날짜(구간 안내·사진은 오늘) */
  date?: string;
}


/** 여행일지 칸(일기·사진 한 화면). 홈의 '여행일지' 구역에서 옮겨 채팅 칸 오른쪽에 둔다(2026-10-17) */
const JOURNAL_CELL: HomeMenuCell = { key: 'diary', label: '여행일지', icon: 'book', disabled: false };

/** 공유된 여행 일정(다른 사람의 일정 둘러보기·가져오기). 홈 '공유된 여행 일정' 줄과 같은 곳으로 간다(2026-10-17) */
const SHARED_CELL: HomeMenuCell = { key: 'itineraries', label: '공유된 일정', icon: 'share', disabled: false };

/** 채팅 칸(2026-10-17 여행 이름 줄 아이콘에서 옮김). 혼자 여행은 혼자 쓰는 '채팅 메모' */
function chatCell(trip: Trip): HomeMenuCell {
  return { key: 'chat', label: tripMode(trip) === 'personal' ? '채팅 메모' : '그룹 채팅', icon: 'chat', disabled: false };
}

/**
 * 여행방 빠른 메뉴 칸(features/trip/components/TripActions가 후보·시간표 화면 위에 그린다, 2026-10-17 홈에서 옮김).
 * 단계(예정·진행 중·완료)마다 그때 자주 쓰는 일부터 놓는다(2026-10-17 사용자 요청: 우선도 순). 여행방 설정은 늘 끝 칸이다.
 * - 예정(그룹): 채팅 → 멤버 초대 → AI 여행지 추천 → 공유된 일정 → 여행일지 → 여행방 설정
 *   예정(혼자): 채팅 메모 → AI 여행지 추천 → 공유된 일정 → 여행일지 → 멤버 초대 → 여행방 설정(혼자는 초대가 뒤로)
 * - 진행 중: 구간 안내(오늘 첫 구간) → 일기 쓰기(오늘) → 채팅 → AI 여행지 추천 → 공유된 일정 → 여행방 설정
 * - 완료: 여행일지 → 일정 공유하기 → 채팅 → 공유된 일정 → 여행방 설정
 * 꺼지는 칸은 없다. 여행방이 없으면 빈 목록이다. plan은 호출 모양을 지키려고 받는다(구간 안내 칸은 시간표가 없어도 켜 둔다).
 */
export function homeActions(trip: Trip | undefined, _plan: Plan | undefined, today: string): HomeMenuCell[] {
  if (!trip) return [];
  const settings: HomeMenuCell = { key: 'settings', label: '여행방 설정', icon: 'gear', disabled: false };
  const members: HomeMenuCell = { key: 'members', label: '멤버 초대', icon: 'users', disabled: false };
  const recommend: HomeMenuCell = { key: 'recommend', label: 'AI 여행지 추천', icon: 'compass', disabled: false };
  const s = statusOn(trip, today);
  if (s === 'upcoming') {
    return tripMode(trip) === 'personal'
      ? [chatCell(trip), recommend, SHARED_CELL, JOURNAL_CELL, members, settings]
      : [chatCell(trip), members, recommend, SHARED_CELL, JOURNAL_CELL, settings];
  }
  if (s === 'ongoing') {
    return [
      // 늘 켠다. 오늘 구간이 없으면 구간 안내 화면이 Empty '루트 계산'으로 다음 할 일을 보여 준다(꺼진 칸은 이유가 안 보여 막다른 칸이 된다)
      { key: 'navigate', label: '구간 안내', icon: 'nav', disabled: false, date: today },
      { key: 'diary', label: '일기 쓰기', icon: 'book', disabled: false, date: today },
      chatCell(trip),
      recommend,
      SHARED_CELL,
      settings,
    ];
  }
  return [JOURNAL_CELL, { key: 'share', label: '일정 공유하기', icon: 'share', disabled: false }, chatCell(trip), SHARED_CELL, settings];
}

/* ---------- 카드 줄 끝 '+ 새 여행' 당기기(2026-10-17) ---------- */

/** 카드 줄 끝에 늘 보이는 '+' 손잡이 폭과 높이(내 여행 카드 CoverTile lg 높이와 같다) */
export const NEW_TRIP_PEEK = 52;
export const NEW_TRIP_H = 300;
/**
 * 당김 저항(고무줄). 손가락이 d만큼 끌면 칸은 d·K/(d+K)만큼만 따라온다. K에 가까워질수록 점점 덜 움직여서
 * 끝으로 갈수록 뻑뻑하다(손가락 100 → 64, 200 → 95, 400 → 124).
 */
export const PULL_STIFFNESS = 180;
/** 내 여행 카드 폭(CoverTile lg)과 카드 사이 간격(홈 cardRow gap = SP.xxl) */
const CARD_W = 272;
const CARD_GAP = 16;

/**
 * 카드 줄 내용 폭: 왼쪽 '초대' 잘린 카드 + 카드 n장 + 오른쪽 '+' 잘린 카드, 사이 간격 n+1개(좌우 여백 없이 양쪽 화면 끝에 붙는다). 스크롤 전에도 줄 끝인지 알 수 있게 계산으로 구한다
 * (웹에서 내용 크기 알림이 처음에 오지 않아 '끝'으로 잘못 보고 옆으로 밀기를 가로챈 적이 있다, 2026-10-17)
 */
export function cardRowContentWidth(cards: number): number {
  return NEW_TRIP_PEEK * 2 + cards * (CARD_W + CARD_GAP) + CARD_GAP;
}

/** 지금 스크롤 위치가 카드 줄 처음인지(처음에서만 왼쪽 '초대 코드로 합류' 당기기를 받는다). 화면 폭을 모르면 처음이 아니다 */
export function cardRowAtStart(x: number, viewW: number): boolean {
  return viewW > 0 && x <= 2;
}

/** 지금 스크롤 위치가 카드 줄 끝인지(끝에서만 '+ 새 여행' 당기기를 받는다). 화면 폭을 모르면 끝이 아니다 */
export function cardRowAtEnd(x: number, viewW: number, contentW: number): boolean {
  if (!(viewW > 0) || !(contentW > 0)) return false;
  return x + viewW >= contentW - 2;
}

/* ---------- 카드 줄 양옆 화살표(2026-10-17) ---------- */

/** 여행 카드 i(0부터)의 왼쪽 끝 위치(내용 좌표). 왼쪽 '초대' 잘린 카드와 간격 뒤에서 시작한다 */
export function cardLeft(i: number): number {
  return NEW_TRIP_PEEK + CARD_GAP + i * (CARD_W + CARD_GAP);
}

/**
 * 화살표를 보일지. 지금 화면 밖에 여행 카드가 남아 있는 쪽만 보인다(양 끝의 '초대'·'+' 잘린 카드는 세지 않는다).
 * 카드가 없거나 화면 폭을 모르면 둘 다 숨긴다.
 */
export function cardRowArrows(x: number, viewW: number, cards: number): { left: boolean; right: boolean } {
  if (!(viewW > 0) || cards <= 0) return { left: false, right: false };
  const lastRight = cardLeft(cards - 1) + CARD_W;
  return { left: cardLeft(0) < x - 4, right: lastRight > x + viewW + 4 };
}

/** 화살표를 눌렀을 때 갈 스크롤 위치: 한 장 넘게 떨어진 다음(앞) 카드가 화면 왼쪽에서 조금 안쪽에 오게. 처음 카드로 돌아가면 0 */
export function cardRowStep(x: number, cards: number, dir: 1 | -1, viewW: number): number {
  const PAD = 24;
  const max = Math.max(0, cardRowContentWidth(cards) - viewW);
  if (dir > 0) {
    for (let i = 0; i < cards; i += 1) if (cardLeft(i) - PAD > x + CARD_W / 2) return Math.min(max, cardLeft(i) - PAD);
    return max;
  }
  for (let i = cards - 1; i >= 0; i -= 1) if (cardLeft(i) - PAD < x - CARD_W / 2) return i === 0 ? 0 : Math.max(0, cardLeft(i) - PAD);
  return 0;
}

/** 칸이 이만큼 따라오면(손가락 약 285px) 놓았을 때 여행방 만들기로 간다 */
export const PULL_TRIGGER = 110;

/** 손가락이 끈 거리(왼쪽으로 +) → 칸이 실제로 따라온 거리 */
export function pullOffset(drag: number): number {
  if (!(drag > 0)) return 0;
  return (drag * PULL_STIFFNESS) / (drag + PULL_STIFFNESS);
}

/** 따라온 거리 → 당김 정도(0~1). 1이면 놓았을 때 만든다 */
export function pullProgress(offset: number): number {
  return Math.max(0, Math.min(1, offset / PULL_TRIGGER));
}

/* ---------- 추천 여행지 줄(2026-10-10 리디자인) ---------- */

export interface HomePick {
  id: string;
  name: string;
  blurb: string;
}

/** 추천 여행 일정 타일 제목: 지역 이름 + 예시 일정 기간('부산 2박 3일'). 예시가 없으면 지역 이름만 */
export function pickTitle(regionId: string, name: string): string {
  const days = sampleTripFor(regionId)?.days.length ?? 0;
  if (days <= 0) return name;
  return days === 1 ? `${name} 당일` : `${name} ${days - 1}박 ${days}일`;
}

/** 홈 '추천 여행지' 가로 줄. 누르면 그 지역을 고른 채로 여행방 만들기로 간다(id는 data/regions의 지역 id) */
export const HOME_PICKS: HomePick[] = [
  { id: 'busan', name: '부산', blurb: '바다와 야경이 있는 항구 도시' },
  { id: 'gyeongju', name: '경주', blurb: '천년 고도를 걷는 산책' },
  { id: 'jeju', name: '제주', blurb: '자연을 만끽하기 좋은 섬' },
  { id: 'gangneung', name: '강릉', blurb: '커피 거리와 동해 바다' },
  { id: 'jeonju', name: '전주', blurb: '한옥마을과 골목 맛집' },
  { id: 'yeosu', name: '여수', blurb: '밤바다가 예쁜 남해 도시' },
];
