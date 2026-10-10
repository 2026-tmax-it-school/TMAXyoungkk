import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, LinkingOptions, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

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
  Candidates: undefined;
  Schedule: { date?: string } | undefined;
  Map: { date?: string } | undefined;
  More: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  InviteAccept: { code?: string } | undefined;
  Login: undefined;
  Signup: undefined;
  SocialConsent: { provider: 'kakao' | 'google'; intent: 'login' | 'link' };
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  CreateTrip: undefined;
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
  LiveTrip: { tripId: string; date?: string };
  Photos: { tripId: string };
  Diary: { tripId: string; date?: string };
  RecordMap: { tripId: string; date?: string };
  Profile: undefined;
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
  prefixes: [`${APP_SCHEME}://`, `https://${INVITE_HOST}`],
  config: {
    screens: {
      InviteAccept: 'j/:code',
      Main: {
        screens: {
          Home: '',
          Candidates: 'candidates',
          Schedule: 'schedule',
          Map: 'map',
          More: 'more',
        },
      },
    },
  },
};

/**
 * 하단 탭(홈/후보/시간표/지도/프로필 고정). 채팅은 탭이 아니라 스택 화면이다.
 * 다섯째 탭(More)은 숙박 앱처럼 '프로필'로 보이고, 안에 계정·설정·시연 도구를 모은다.
 */
export const TAB_ITEMS: { key: TabRouteName; label: string; icon: 'home' | 'heart' | 'cal' | 'map' | 'user' }[] = [
  { key: 'Home', label: '홈', icon: 'home' },
  { key: 'Candidates', label: '후보', icon: 'heart' },
  { key: 'Schedule', label: '시간표', icon: 'cal' },
  { key: 'Map', label: '지도', icon: 'map' },
  { key: 'More', label: '프로필', icon: 'user' },
];

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
  CreateTrip: { no: '04', title: '여행방 만들기', fr: 'FR-201·205·504', wp: 'WP2' },
  Chat: { no: '05', title: '그룹 채팅 · 장소 자동 추출', fr: 'FR-304·401', wp: 'WP3' },
  Candidates: { no: '06', title: '후보 · 자동 선별', fr: 'FR-402·403·202', wp: 'WP3' },
  SpotDetail: { no: '07', title: '스팟 상세', fr: 'FR-803', wp: 'WP3' },
  Planning: { no: '08', title: '루트 계산 중', fr: 'FR-505·501', wp: 'WP4' },
  Schedule: { no: '09', title: '날짜별 시간표', fr: 'FR-505·502', wp: 'WP4' },
  ScheduleEdit: { no: '10', title: '일정 편집', fr: 'FR-503', wp: 'WP4' },
  Map: { no: '11', title: '지도 · 루트', fr: 'FR-801~803', wp: 'WP5' },
  LegTransport: { no: '12', title: '이동수단 · 경로 비교', fr: 'FR-504', wp: 'WP4' },
  Navigate: { no: '13', title: '길찾기 · 구간 내비', fr: 'FR-601~603', wp: 'WP5' },
  Members: { no: '14', title: '멤버 초대 · 링크 공유', fr: 'FR-301·303', wp: 'WP2' },
  Login: { no: '15', title: '로그인 · 소셜 로그인', fr: 'FR-102·103', wp: 'WP1' },
  Signup: { no: '16', title: '회원가입 · 이메일 인증', fr: 'FR-101', wp: 'WP1' },
  Profile: { no: '17', title: '프로필 · 성향 태그 · 게스트 승격', fr: 'FR-104', wp: 'WP1' },
  More: { no: '18', title: '더보기 · 설정 · 시연 도구', fr: 'FR-204 · 알림 · 세션', wp: 'WP1' },
  LiveTrip: { no: '19', title: '여행 진행 · 시뮬레이터', fr: 'FR-601~604', wp: 'WP5' },
  Photos: { no: '20', title: '사진', fr: 'FR-701', wp: 'WP6' },
  Diary: { no: '21', title: '일기 · 편집 · 공유', fr: 'FR-702·703', wp: 'WP6' },
  RecordMap: { no: '22', title: '기록 지도 · 실제 경로', fr: 'FR-704·804', wp: 'WP6' },
  Recommend: { no: '23', title: '여행지 추천', fr: 'FR-404', wp: 'WP3' },
  TripSettings: { no: '25', title: '여행방 설정 · 날짜별 기점', fr: 'FR-201·205·204', wp: 'WP2' },
  SocialConsent: { no: '26', title: '소셜 로그인 동의', fr: 'FR-103', wp: 'WP1' },
};
