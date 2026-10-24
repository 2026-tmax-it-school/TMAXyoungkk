import type { TourRect } from '../../ui/tourStore';

/**
 * 앱 둘러보기 — 스포트라이트 안내(2026-10-24). 실제 화면에서 기능 하나만 밝게 비추고 나머지는 그림자로 덮은 채,
 * 짧은 설명 풍선과 함께 다음 화면으로 넘긴다. 이 파일은 단계 목록과 위치 계산(순수)이다. 그리는 일은 TourOverlay가 한다.
 * - 단계마다: 어느 화면(screen)에서 어느 자리(target)를 비출지, 제목('○○ 기능이에요'), 한두 줄 설명.
 * - when: 'trip'은 여행방이 있을 때만, 'noTrip'은 없을 때만, 'always'는 늘.
 * - 문구는 앱 용어(후보 · 시간표 · 좋아요 · 여행방)를 따른다. '투표' 같은 금지 용어는 쓰지 않는다.
 */

export type TourScreen = 'Home' | 'Candidates' | 'Schedule' | 'Chat' | 'Map' | 'Community' | 'More';

export interface TourStep {
  id: string;
  screen: TourScreen;
  /** TourTarget id */
  target: string;
  title: string;
  text: string;
  /** 컴퓨터 폭(채팅과 지도가 나란히, 여행방 카드가 격자)에서는 화면 모양이 달라 이 문구를 쓴다. 없으면 text */
  wideText?: string;
  when: 'always' | 'trip' | 'noTrip';
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'home-empty',
    screen: 'Home',
    target: 'home-empty',
    title: '여행방 만들기',
    text: '여행지와 날짜만 정하면 여행방이 생겨요. 친구가 보낸 코드가 있으면 "초대 코드로 합류"를 눌러요.',
    when: 'noTrip',
  },
  {
    id: 'home-now',
    screen: 'Home',
    target: 'home-now',
    title: '지금 할 일',
    text: '여행방의 다음 할 일 한 가지를 알려 줘요. 큰 버튼을 누르면 바로 그 일로 가요.',
    when: 'trip',
  },
  {
    id: 'home-cards',
    screen: 'Home',
    target: 'home-cards',
    title: '내 여행',
    text: '여행방 카드를 누르면 그 방의 다음 할 일로 가요. 줄 맨 끝의 +는 새 여행방, 왼쪽 끝은 초대 코드 합류예요.',
    wideText: '여행방 카드를 누르면 그 방의 다음 할 일로 가요. 새 여행방 만들기와 초대 코드 합류 카드도 여기 있어요.',
    when: 'trip',
  },
  {
    id: 'cand-search',
    screen: 'Candidates',
    target: 'cand-search',
    title: '후보 모으기',
    text: '가고 싶은 곳을 검색해서 후보로 담아요. 채팅에서 말한 장소도 자동으로 여기에 쌓여요.',
    when: 'trip',
  },
  {
    id: 'cand-like',
    screen: 'Candidates',
    target: 'cand-like',
    title: '좋아요',
    text: '가고 싶은 곳에 좋아요를 눌러요. 좋아요가 많은 곳이 먼저 일정에 들어가요. 누가 꺼냈는지도 카드에 보여요.',
    when: 'trip',
  },
  {
    id: 'sched-days',
    screen: 'Schedule',
    target: 'sched-days',
    title: '날짜별 시간표',
    text: '후보와 영업시간, 이동 거리로 하루 일정을 자동으로 짜 줘요. 날짜를 눌러 그날 시간표를 봐요.',
    when: 'trip',
  },
  {
    id: 'sched-edit',
    screen: 'Schedule',
    target: 'sched-edit',
    title: '시간표 고치기',
    text: '순서를 바꾸고 머무는 시간을 줄이거나 늘려요. 하루가 넘치면 조정안도 알려 줘요.',
    when: 'trip',
  },
  {
    id: 'chat-seg',
    screen: 'Chat',
    target: 'chat-seg',
    title: '채팅과 지도',
    text: '채팅에서 장소 이름을 쓰면 후보에 담겨요. 위 버튼으로 채팅과 지도를 오가며, 지도에서는 가고 싶은 곳에 좋아요를 눌러요.',
    wideText: '채팅에서 장소 이름을 쓰면 후보에 담겨요. 넓은 화면에서는 채팅과 지도가 나란히 보이고, 지도에서는 가고 싶은 곳에 좋아요를 눌러요.',
    when: 'trip',
  },
  {
    id: 'tab-Map',
    screen: 'Map',
    target: 'tab-Map',
    title: '지도',
    text: '날짜별 루트를 순번 핀과 선으로 봐요. 장소를 누르면 길찾기와 상세로 이어져요.',
    when: 'always',
  },
  {
    id: 'tab-Community',
    screen: 'Community',
    target: 'tab-Community',
    title: '커뮤니티',
    text: '다른 여행자의 사진·이야기와 공유된 여행 일정을 봐요. 마음에 드는 일정은 내 여행방으로 가져올 수 있어요.',
    when: 'always',
  },
  {
    id: 'tab-More',
    screen: 'More',
    target: 'tab-More',
    title: '프로필',
    text: '알림·위치·계정을 관리해요. 게스트는 여기서 계정을 만들면 여행방이 그대로 이어져요.',
    when: 'always',
  },
  {
    id: 'more-guide',
    screen: 'More',
    target: 'more-guide',
    title: '더 알고 싶다면',
    text: '이 안내는 언제든 다시 볼 수 있어요. "기능 설명 모아 보기"에서 모든 기능을 글로도 읽을 수 있어요.',
    when: 'always',
  },
];

/** 지금 상황(여행방 유무)에 맞는 단계만 */
export function tourSteps(hasTrip: boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => s.when === 'always' || (hasTrip ? s.when === 'trip' : s.when === 'noTrip'));
}

/** 이 폭부터 컴퓨터 화면으로 본다(채팅 화면의 나란히 보기와 같은 기준) */
export const TOUR_WIDE_MIN = 900;
/** 풍선이 넓은 화면에서 길게 늘어나지 않게 막는 폭 */
export const TOUR_TIP_MAX_W = 440;

/** 컴퓨터 폭이면 wideText가 있는 단계는 그 문구를 쓴다 */
export function tourText(step: TourStep, screenW: number): string {
  return screenW >= TOUR_WIDE_MIN && step.wideText ? step.wideText : step.text;
}

/** 풍선 가로 자리: 폭은 화면 안(양쪽 margin)에서 maxW까지, 대상이 보이면 대상 가운데 쪽으로 붙이고 아니면 화면 가운데 */
export function tooltipBox(
  rect: TourRect | undefined,
  screen: { w: number; h: number },
  margin = 16,
  maxW = TOUR_TIP_MAX_W,
): { left: number; width: number } {
  const width = Math.max(0, Math.min(screen.w - margin * 2, maxW));
  const center = rectVisible(rect, screen) && rect ? rect.x + rect.w / 2 : screen.w / 2;
  const left = Math.min(Math.max(center - width / 2, margin), Math.max(margin, screen.w - margin - width));
  return { left, width };
}

/** 'n / N' */
export function tourCounter(index: number, total: number): string {
  return `${index + 1} / ${total}`;
}

export interface HoleLayout {
  /** 비추는 구멍(여백 포함, 화면 안으로 자른다) */
  hole: TourRect;
  /** 구멍 밖을 덮는 네 장 */
  top: TourRect;
  bottom: TourRect;
  left: TourRect;
  right: TourRect;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 대상 칸을 pad만큼 넓혀 화면 안으로 자르고, 그 밖을 덮는 네 장을 계산한다(순수). */
export function holeLayout(rect: TourRect, screen: { w: number; h: number }, pad = 6): HoleLayout {
  const x0 = clamp(rect.x - pad, 0, screen.w);
  const y0 = clamp(rect.y - pad, 0, screen.h);
  const x1 = clamp(rect.x + rect.w + pad, 0, screen.w);
  const y1 = clamp(rect.y + rect.h + pad, 0, screen.h);
  const hole = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return {
    hole,
    top: { x: 0, y: 0, w: screen.w, h: y0 },
    bottom: { x: 0, y: y1, w: screen.w, h: screen.h - y1 },
    left: { x: 0, y: y0, w: x0, h: y1 - y0 },
    right: { x: x1, y: y0, w: screen.w - x1, h: y1 - y0 },
  };
}

/** 대상이 화면에 충분히 보이는지(안 보이면 풍선만 가운데에 보인다) */
export function rectVisible(rect: TourRect | undefined, screen: { w: number; h: number }): boolean {
  if (!rect) return false;
  const visibleH = Math.min(rect.y + rect.h, screen.h) - Math.max(rect.y, 0);
  const visibleW = Math.min(rect.x + rect.w, screen.w) - Math.max(rect.x, 0);
  return visibleH >= Math.min(rect.h, 24) && visibleW >= Math.min(rect.w, 24);
}

/** 풍선 위치: 대상 아래에 자리가 있으면 아래, 아니면 위. 둘 다 없으면 화면 가운데 */
export function tooltipTop(rect: TourRect | undefined, screen: { w: number; h: number }, tipH: number, gap = 14, margin = 12): number {
  const mid = Math.max(margin, (screen.h - tipH) / 2);
  if (!rectVisible(rect, screen) || !rect) return mid;
  const below = rect.y + rect.h + gap;
  if (below + tipH <= screen.h - margin) return below;
  const above = rect.y - gap - tipH;
  if (above >= margin) return above;
  return mid;
}
