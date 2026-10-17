import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, LinkingOptions, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { INVITE_BASE_URL } from '../config';
import { APP_SCHEME, INVITE_HOST } from '../core/constants';

/**
 * 라우트 계약(A8). 화면 파일은 src/screens/<라우트>Screen.tsx다.
 * - InviteAccept, Login, Signup, SocialConsent는 세션 유무와 상관없이 등록한다.
 * - Onboarding은 세션이 없을 때만, Main과 나머지 스택은 세션이 있을 때만 등록한다.
 * - 01 스플래시는 라우트가 아니다. App이 bootstrap 동안 SplashScreen({progress,label})을 그린다.
 * - 24 동명 장소 선택·목적지 밖 확인은 시트라 라우트가 아니다.
 */

export type MainTabParamList = {
  Home: undefined;
  /** add: 채팅방 '장소 검색해서 담기'에서 열면 검색 칸을 펼친 채로 연다 */
  Candidates: { add?: boolean } | undefined;
  Schedule: { date?: string } | undefined;
  Map: { date?: string } | undefined;
  /** 채팅방 목록(내 여행방마다 하나). 하단 탭 '채팅' 칸이다. 방을 누르면 스택 화면 Chat */
  ChatList: undefined;
  /** 사진·일기 글을 앱 사용자 모두와 나누는 곳(서버 저장) */
  Community: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  /** nickname: 온보딩에서 적어 둔 닉네임을 이어 받는다 */
  InviteAccept: { code?: string; nickname?: string } | undefined;
  Login: undefined;
  Signup: undefined;
  SocialConsent: { provider: 'kakao' | 'google'; intent: 'login' | 'link' };
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  /** regionId: 추천 여행지 등에서 고른 지역을 처음 값으로 채운다 */
  /** regionId: 처음 채울 지역. sample: 예시 일정으로 만든다(그 지역의 예시 2박 3일이 후보로 담긴다) */
  CreateTrip: { regionId?: string; sample?: boolean; shared?: boolean } | undefined;
  TripSettings: { tripId: string };
  /** fromCreate: 여행방 만들기에서 넘어왔을 때만 '2 / 2 단계'를 보인다 */
  Members: { tripId: string; fromCreate?: boolean };
  Chat: { tripId: string };
  SpotDetail: { tripId: string; spotId: string };
  Recommend: { tripId: string };
  Planning: { tripId: string; date?: string };
  ScheduleEdit: { tripId: string; date: string };
  /** legIndex 0은 기점 → 첫 스팟 */
  LegTransport: { tripId: string; date: string; legIndex: number };
  Navigate: { tripId: string; date: string; legIndex: number };
  /** 자유 길찾기. 여행방 없이도 연다(검색·지도 선택만). fromSpotId·toSpotId는 처음 채울 스팟 */
  Directions: { tripId?: string; fromSpotId?: string; toSpotId?: string } | undefined;
  LiveTrip: { tripId: string; date?: string };
  /** date가 없으면 '전체'(날짜별 묶음)로 연다 */
  /** 여행일지: 일기와 사진을 한 화면에서. date가 없으면 기록이 있는 날, 'all'이면 사진 모아 보기 */
  Journal: { tripId: string; date?: string };
  Profile: undefined;
  /** 추천 여행지 예시 2박 3일 일정(홈 추천 여행지에서). 누르면 이 일정으로 여행방 만들기로 간다 */
  SampleTrip: { regionId: string };
  /** 일정 공유: 올라온 여행 일정 둘러보기(인기·최신·조회순, 검색). region을 주면 그 지역만 */
  Itineraries: { region?: string } | undefined;
  /** 올라온 일정 하나. 보면 조회수가 오르고, 좋아요·이 일정으로 여행방 만들기를 할 수 있다 */
  ItineraryDetail: { itineraryId: string };
  /** 내 여행방의 일정을 올린다 */
  ShareItinerary: { tripId: string };
  /** 커뮤니티 글쓰기. tripId·date를 주면 그 날짜 일기로 본문을 채운다. editPostId를 주면 그 내 글을 고친다(임시 저장은 쓰지 않는다) */
  CommunityCompose: { tripId?: string; date?: string; editPostId?: string } | undefined;
};

export type RootRouteName = keyof RootStackParamList;
export type TabRouteName = keyof MainTabParamList;

export type RootScreenProps<K extends RootRouteName> = NativeStackScreenProps<RootStackParamList, K>;
export type TabScreenProps<K extends TabRouteName> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, K>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  // useNavigation()이 루트 스택 타입을 알게 한다(react-navigation 권장 방식).
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

/** 세션과 상관없이 등록하는 라우트 */
export const ALWAYS_ROUTES = ['InviteAccept', 'Login', 'Signup', 'SocialConsent'] as const;

/** 딥링크. youngtrip://j/코드, https://youngtrip.app/j/코드 → 02 초대 수락 */
export const linking: LinkingOptions<RootStackParamList> = {
  // 초대 링크 주소(INVITE_BASE_URL)로 열려도 초대 수락으로 간다(웹은 지금 앱 주소, 설정하면 그 주소)
  prefixes: [`${APP_SCHEME}://`, `https://${INVITE_HOST}`, ...(INVITE_BASE_URL ? [INVITE_BASE_URL] : [])],
  config: {
    screens: {
      InviteAccept: 'j/:code',
      Main: {
        screens: {
          Home: '',
          Candidates: 'candidates',
          Schedule: 'schedule',
          Map: 'map',
          ChatList: 'chats',
          Community: 'community',
          More: 'more',
        },
      },
    },
  },
};

/** 하단 탭 칸 키(탭 라우트). 채팅 칸은 채팅방 목록(ChatList) 탭이다 */
export type TabItemKey = TabRouteName;

/**
 * 하단 탭 다섯 칸(홈/지도/그룹 채팅/커뮤니티/프로필 고정, 아이콘만). '일정' 칸 대신 그룹 채팅을 두고 지도 다음(셋째)에 놓는다(2026-10-17 사용자 요청).
 * 채팅 칸은 채팅방 목록(ChatList) 탭이다. 목록에서도 하단 탭이 보이고 채팅 칸이 켜진다. 방을 누르면 스택 화면 Chat으로 간다.
 * 일정(Schedule)·후보(Candidates)는 탭 라우트로 남지만 칸이 없다. 홈 카드·빠른 메뉴, 지도의 시간표 링크 등으로 열고,
 * '시간표 | 후보' 나누기(PlanSwitch)로 오간다. 딥링크 'schedule'·'candidates'도 그대로 연다.
 * 마지막 탭(More)은 숙박 앱처럼 '프로필'로 보이고, 안에 계정·설정·시연 도구를 모은다.
 */
export const TAB_ITEMS: { key: TabItemKey; label: string; icon: 'home' | 'chat' | 'map' | 'users' | 'user' }[] = [
  { key: 'Home', label: '홈', icon: 'home' },
  { key: 'Map', label: '지도', icon: 'map' },
  { key: 'ChatList', label: '그룹 채팅', icon: 'chat' },
  { key: 'Community', label: '커뮤니티', icon: 'users' },
  { key: 'More', label: '프로필', icon: 'user' },
];

/** 칸이 없는 탭 라우트를 볼 때 켜 둘 칸 */
export const TAB_HIGHLIGHT: Partial<Record<TabRouteName, TabRouteName>> = {};

/** 지금 탭 라우트에서 켜 둘 하단 탭 칸(순수) */
export function activeTabKey(route: TabRouteName): TabRouteName {
  return TAB_HIGHLIGHT[route] ?? route;
}

/**
 * 뒤로 가기의 목적지(순수, navigation/useBack이 쓴다). 쌓인 화면이 있으면 그 화면으로,
 * 없으면(딥링크·새로고침으로 바로 연 화면) 대체 탭으로 간다. 막다른 화면을 만들지 않는다.
 */
export type BackTarget = { kind: 'back' } | { kind: 'tab'; screen: TabRouteName };

export function backTarget(canGoBack: boolean, fallback: TabRouteName): BackTarget {
  return canGoBack ? { kind: 'back' } : { kind: 'tab', screen: fallback };
}

export interface ScreenMeta {
  no: string;
  title: string;
  fr: string;
  wp: 'WP1' | 'WP2' | 'WP3' | 'WP4' | 'WP5' | 'WP6';
}

/** 화면 번호표(01 회의록 쟁점 15). 18 시연 도구의 화면 목록이 쓴다(사용자 화면 문구에는 번호를 쓰지 않는다). */
export const SCREEN_META: Record<Exclude<RootRouteName, 'Main'> | TabRouteName | 'Splash', ScreenMeta> = {
  Splash: { no: '01', title: '스플래시 · 로딩', fr: '앱 진입', wp: 'WP1' },
  Onboarding: { no: '02', title: '게스트로 시작', fr: 'FR-105', wp: 'WP1' },
  InviteAccept: { no: '02', title: '초대 수락 · 게스트 합류', fr: 'FR-105·302', wp: 'WP2' },
  Home: { no: '03', title: '홈 · 메인 메뉴', fr: 'FR-203', wp: 'WP1' },
  SampleTrip: { no: '30', title: '추천 여행 일정 · 예시 2박 3일', fr: 'FR-201', wp: 'WP2' },
  Itineraries: { no: '31', title: '공유된 여행 일정 · 인기순', fr: 'FR-201·801', wp: 'WP2' },
  ItineraryDetail: { no: '32', title: '공유된 일정 상세 · 가져오기', fr: 'FR-201·801', wp: 'WP2' },
  ShareItinerary: { no: '33', title: '내 일정 공유하기', fr: 'FR-801', wp: 'WP2' },
  CreateTrip: { no: '04', title: '여행방 만들기', fr: 'FR-201·205·504', wp: 'WP2' },
  ChatList: { no: '05-0', title: '채팅방 목록', fr: 'FR-304', wp: 'WP3' },
  Chat: { no: '05', title: '그룹 채팅 · 장소 자동 추출', fr: 'FR-304·401', wp: 'WP3' },
  Candidates: { no: '06', title: '후보 · 자동 선별', fr: 'FR-402·403·202', wp: 'WP3' },
  SpotDetail: { no: '07', title: '스팟 상세', fr: 'FR-803', wp: 'WP3' },
  Planning: { no: '08', title: '루트 계산 중', fr: 'FR-505·501', wp: 'WP4' },
  Schedule: { no: '09', title: '날짜별 시간표', fr: 'FR-505·502', wp: 'WP4' },
  ScheduleEdit: { no: '10', title: '일정 편집', fr: 'FR-503', wp: 'WP4' },
  Map: { no: '11', title: '지도 · 루트', fr: 'FR-801~803', wp: 'WP5' },
  LegTransport: { no: '12', title: '이동수단 · 경로 비교', fr: 'FR-504', wp: 'WP4' },
  Navigate: { no: '13', title: '구간 안내', fr: 'FR-601~603', wp: 'WP5' },
  Members: { no: '14', title: '멤버 초대 · 링크 공유', fr: 'FR-301·303', wp: 'WP2' },
  Login: { no: '15', title: '로그인 · 소셜 로그인', fr: 'FR-102·103', wp: 'WP1' },
  Signup: { no: '16', title: '회원가입 · 이메일 인증', fr: 'FR-101', wp: 'WP1' },
  Profile: { no: '17', title: '프로필 · 성향 태그 · 게스트 승격', fr: 'FR-104', wp: 'WP1' },
  More: { no: '18', title: '더보기 · 설정 · 시연 도구', fr: 'FR-204 · 알림 · 세션', wp: 'WP1' },
  LiveTrip: { no: '19', title: '여행 진행 · 시뮬레이터', fr: 'FR-601~604', wp: 'WP5' },
  Journal: { no: '21', title: '여행일지 · 일기와 사진', fr: 'FR-701~703', wp: 'WP6' },
  Recommend: { no: '23', title: 'AI 여행지 추천', fr: 'FR-404', wp: 'WP3' },
  TripSettings: { no: '25', title: '여행방 설정 · 날짜별 기점', fr: 'FR-201·205·204', wp: 'WP2' },
  SocialConsent: { no: '26', title: '소셜 로그인 동의', fr: 'FR-103', wp: 'WP1' },
  Directions: { no: '27', title: '길찾기', fr: 'FR-601~603', wp: 'WP5' },
  Community: { no: '28', title: '커뮤니티 · 사진과 일기', fr: 'FR-705', wp: 'WP6' },
  CommunityCompose: { no: '29', title: '커뮤니티 글쓰기', fr: 'FR-705', wp: 'WP6' },
};
