import type { IconName } from '../../ui/Icon';

/**
 * 앱 둘러보기(2026-10-24). 앱의 모든 기능을 순서대로 소개한다. 화면(screens/GuideScreen)은 이 데이터만 그린다(순수).
 * - 5묶음, 단계마다: 제목 · 한 줄 요약 · 이렇게 써요(2~3줄) · 찾는 곳(경로) · '가 보기'로 열 화면(go).
 * - go.trip이 true인 단계는 여행방이 있어야 연다(없으면 화면이 '여행방을 먼저 만들어요'로 안내하고 만들기로 보낸다).
 * - 문구는 앱 용어를 따른다: 후보 · 시간표 · 좋아요 · 여행방. 새 말을 만들지 않는다.
 */

export type GuideRoute =
  | 'Home'
  | 'Map'
  | 'Community'
  | 'More'
  | 'Schedule'
  | 'Candidates'
  | 'CreateTrip'
  | 'InviteAccept'
  | 'Members'
  | 'Chat'
  | 'Recommend'
  | 'ScheduleEdit'
  | 'LegTransport'
  | 'Directions'
  | 'LiveTrip'
  | 'Journal'
  | 'Itineraries'
  | 'ShareItinerary'
  | 'TripSettings'
  | 'SampleTrip';

export interface GuideStep {
  id: string;
  section: string;
  icon: IconName;
  title: string;
  summary: string;
  how: string[];
  where: string;
  go?: { route: GuideRoute; label: string; trip?: boolean };
}

export const GUIDE_SECTIONS = ['시작하기', '함께 정하기', '일정 짜기', '여행 중', '나누기와 내 정보'] as const;

export const GUIDE_STEPS: GuideStep[] = [
  /* ---------- 시작하기 ---------- */
  {
    id: 'home',
    section: '시작하기',
    icon: 'home',
    title: '홈: 지금 할 일',
    summary: '여행방의 다음 할 일 한 가지를 맨 위에서 알려 줘요.',
    how: [
      '"지금 할 일" 카드의 큰 버튼을 누르면 바로 그 일로 가요(후보 모으기, 시간표 보기 등).',
      '카드 아래 동그란 메뉴로 채팅·초대·추천·설정을 열어요.',
      '내 여행 카드를 누르면 그 방의 다음 할 일로 가요.',
    ],
    where: '하단 탭 홈',
    go: { route: 'Home', label: '홈으로 가기' },
  },
  {
    id: 'create',
    section: '시작하기',
    icon: 'plus',
    title: '여행방 만들기',
    summary: '여행지·날짜·이동수단만 정하면 여행방이 생겨요.',
    how: [
      '지역은 검색하거나 지도에서 골라요. 날짜는 달력에서 시작일과 종료일을 눌러요.',
      '이동수단(자동차·도보·대중교통)과 하루 활동시간을 정해요. 숙소(기점)는 나중에 정해도 돼요.',
      '표지 사진을 안 고르면 지역 그림이 표지가 돼요.',
    ],
    where: '홈 > 내 여행 줄 맨 끝 "새 여행" 칸',
    go: { route: 'CreateTrip', label: '여행방 만들러 가기' },
  },
  {
    id: 'sample',
    section: '시작하기',
    icon: 'list',
    title: '추천 여행 일정으로 시작',
    summary: '막막하면 만들어 둔 예시 2박 3일로 시작해요.',
    how: [
      '홈 아래 "추천 여행 일정"에서 지역을 눌러요.',
      '날짜별 코스와 지도를 보고 "이 일정으로 여행방 만들기"를 눌러요.',
      '예시 장소는 후보로 담겨서 바로 고쳐 쓸 수 있어요.',
    ],
    where: '홈 > 추천 여행 일정',
    go: { route: 'SampleTrip', label: '경주 예시 보기' },
  },
  {
    id: 'invite',
    section: '시작하기',
    icon: 'link',
    title: '친구 초대하고 합류하기',
    summary: '코드나 링크를 보내면 친구가 바로 들어와요.',
    how: [
      '멤버 화면에서 "링크 만들고 공유하기"를 눌러 8자리 코드를 보내요.',
      '받은 사람은 "초대 코드로 합류"에서 코드나 링크를 붙여 넣어요. 칸에 글자가 하나씩 채워져요.',
      '한 여행방에는 방장 포함 6명까지 있어요.',
    ],
    where: '홈 > 메뉴 "멤버 초대" · 처음 화면 "초대 코드로 합류"',
    go: { route: 'Members', label: '멤버 화면 열기', trip: true },
  },

  /* ---------- 함께 정하기 ---------- */
  {
    id: 'chat',
    section: '함께 정하기',
    icon: 'chat',
    title: '채팅으로 가고 싶은 곳 모으기',
    summary: '친구들과 대화하면 말한 장소가 자동으로 후보에 담겨요.',
    how: [
      '장소 이름을 쓰면 연두색 밑줄이 그어지고 "후보에 담김"이 떠요. 잘못 담겼으면 "되돌리기"를 눌러요.',
      '"저녁에", "점심", "아침" 같은 말도 읽어서 시간표에 반영해요.',
      '위 방 이름을 누르면 다른 여행방 채팅으로 바꿔요. 채팅과 지도는 위에서 전환해요.',
    ],
    where: '하단 탭 채팅',
    go: { route: 'Chat', label: '채팅 열기', trip: true },
  },
  {
    id: 'candidates',
    section: '함께 정하기',
    icon: 'heart',
    title: '후보: 좋아요로 모으기',
    summary: '누가 꺼냈는지 보고, 좋아요가 많은 곳이 먼저 들어가요.',
    how: [
      '각 후보 카드에 "누가 채팅에서 꺼냈는지"와 "저녁 추천" 같은 시간 배지가 있어요.',
      '"좋아요"를 누르면 내 표가 들어가요. 표가 적은 곳은 일정이 넘칠 때 먼저 빠져요.',
      '맨 위 검색창으로 장소를 직접 찾아 담을 수도 있어요.',
    ],
    where: '홈 > 메뉴 "후보" · 시간표 위 "후보" 탭',
    go: { route: 'Candidates', label: '후보 보기', trip: true },
  },
  {
    id: 'recommend',
    section: '함께 정하기',
    icon: 'compass',
    title: 'AI 여행지 추천',
    summary: '취향 태그를 고르면 어울리는 장소를 골라 줘요.',
    how: [
      '맛집·자연·역사 같은 성향 태그를 눌러요. 태그가 없으면 많이 찾는 곳을 보여 줘요.',
      '오른쪽 동그라미 +를 누르면 후보에 담겨요(담으면 체크로 바뀌어요).',
      '"다시 추천 받기"로 새로 받을 수 있어요.',
    ],
    where: '홈 > 메뉴 "AI 여행지 추천"',
    go: { route: 'Recommend', label: '추천 받으러 가기', trip: true },
  },

  /* ---------- 일정 짜기 ---------- */
  {
    id: 'schedule',
    section: '일정 짜기',
    icon: 'cal',
    title: '시간표: 자동으로 하루 짜기',
    summary: '후보와 영업시간, 이동 거리로 날짜별 시간표를 만들어 줘요.',
    how: [
      '날짜 탭을 누르면 그날 시간표가 보여요. 칸을 누르면 장소 상세로 가요.',
      '여행 당일에는 맨 위 검은 카드가 "지금 어디 있는지"를 알려 줘요.',
      '후보를 바꾸면 "다시 계산"으로 새로 짜요.',
    ],
    where: '홈 > 메뉴 "시간표"',
    go: { route: 'Schedule', label: '시간표 보기', trip: true },
  },
  {
    id: 'edit',
    section: '일정 짜기',
    icon: 'pen',
    title: '시간표 고치기',
    summary: '순서·머무는 시간·도착 시각을 직접 바꿔요.',
    how: [
      '시간표의 "편집"을 눌러요. 카드의 위·아래 화살표로 순서를 바꿔요.',
      '카드를 펼치면 머무는 시간을 줄이고 늘릴 수 있어요.',
      '하루가 넘치면 "조정안"이 떠서 줄이기·다른 날로 옮기기·빼기를 골라요.',
    ],
    where: '시간표 > 편집',
    go: { route: 'Schedule', label: '시간표로 가기', trip: true },
  },
  {
    id: 'leg',
    section: '일정 짜기',
    icon: 'car',
    title: '구간마다 이동수단 비교',
    summary: '자동차·도보·대중교통 시간을 비교하고 구간별로 바꿔요.',
    how: [
      '시간표의 이동 줄(자동차 15분 같은 줄)을 눌러요.',
      '수단을 고르면 다른 일정에 어떤 영향이 있는지 미리 보여 줘요.',
      '"이 구간만" 또는 "이날 전체"에 적용해요.',
    ],
    where: '시간표 > 이동 줄',
    go: { route: 'Schedule', label: '시간표로 가기', trip: true },
  },
  {
    id: 'map',
    section: '일정 짜기',
    icon: 'map',
    title: '지도: 하루 루트 한눈에',
    summary: '날짜별 순번 핀과 이동 선을 지도로 봐요.',
    how: [
      '아래 시트에서 날짜를 바꾸면 그날 루트만 보여요. "전체"는 모든 날을 겹쳐 봐요.',
      '핀을 누르면 장소 카드가 뜨고, 거기서 길찾기·상세로 가요.',
      '컴퓨터 화면에서는 왼쪽에 패널이 떠요.',
    ],
    where: '하단 탭 지도',
    go: { route: 'Map', label: '지도 보기' },
  },
  {
    id: 'directions',
    section: '일정 짜기',
    icon: 'nav',
    title: '길찾기',
    summary: '출발과 도착을 정해 자동차·대중교통·도보 시간을 봐요.',
    how: [
      '출발은 내 위치나 직접 고른 곳, 도착은 후보나 검색한 곳이에요.',
      '수단 칸을 눌러 시간과 거리를 비교해요.',
      '"카카오맵으로 열기"로 실제 안내를 이어 갈 수 있어요.',
    ],
    where: '지도 위 "길찾기" · 장소 상세 "여기까지 길찾기"',
    go: { route: 'Directions', label: '길찾기 열기' },
  },

  /* ---------- 여행 중 ---------- */
  {
    id: 'live',
    section: '여행 중',
    icon: 'play',
    title: '여행 진행: 도착 기록',
    summary: '여행 당일에 도착한 곳을 기록하고 일정이 밀리면 조정해요.',
    how: [
      '"기기 위치로 진행"은 도착을 자동으로, "수동으로 진행"은 직접 눌러 기록해요.',
      '다음 장소와 예상 도착 시각을 카드로 보여 줘요.',
      '일정이 밀리면 뒤 일정을 줄이거나 빼는 조정안을 제안해요.',
    ],
    where: '지도 > "여행 진행" · 홈 > 지금 할 일',
    go: { route: 'LiveTrip', label: '여행 진행 열기', trip: true },
  },
  {
    id: 'journal',
    section: '여행 중',
    icon: 'book',
    title: '여행일지: 일기와 사진',
    summary: '도착 기록과 사진을 시간순으로 묶어 하루 일기를 만들어 줘요.',
    how: [
      '날짜 탭마다 "오늘 간 곳" 배지와 사진이 모여요.',
      '"일기 쓰기"를 누르면 방문·사진으로 자동 문장을 만들고, 고쳐 쓸 수 있어요.',
      '다 쓴 일기는 커뮤니티에 올릴 수 있어요.',
    ],
    where: '홈 > 메뉴 "여행일지"',
    go: { route: 'Journal', label: '여행일지 열기', trip: true },
  },

  /* ---------- 나누기와 내 정보 ---------- */
  {
    id: 'community',
    section: '나누기와 내 정보',
    icon: 'users',
    title: '커뮤니티: 이야기와 사진',
    summary: '다른 여행자의 이야기와 사진을 보고 내 글도 올려요.',
    how: [
      '"이야기" 탭에서 글을 보고 좋아요·태그로 거를 수 있어요.',
      '"글쓰기"는 로그인한 계정만 쓸 수 있어요(게스트는 보기만).',
      '"여행 일정" 탭은 다른 사람이 공유한 일정이에요.',
    ],
    where: '하단 탭 커뮤니티',
    go: { route: 'Community', label: '커뮤니티 보기' },
  },
  {
    id: 'share',
    section: '나누기와 내 정보',
    icon: 'share',
    title: '일정 공유하고 가져오기',
    summary: '내 일정을 올리거나 남의 일정을 내 여행방으로 가져와요.',
    how: [
      '내 여행방에서 "공유된 일정 > 내 일정 공유하기"로 올려요. 장소 이름·분류·주소만 올라가요.',
      '둘러보기에서 인기순·최신순·조회순으로 찾아요.',
      '마음에 들면 "이 일정으로 여행방 만들기"로 가져와요.',
    ],
    where: '홈 > 메뉴 "공유된 일정" · 커뮤니티 > 여행 일정',
    go: { route: 'Itineraries', label: '공유된 일정 보기' },
  },
  {
    id: 'settings',
    section: '나누기와 내 정보',
    icon: 'gear',
    title: '여행방 설정',
    summary: '이름·날짜·숙소(기점)·활동시간을 바꿔요.',
    how: [
      '날짜별로 숙소를 따로 정할 수 있어요. 안 정하면 전날 숙소를 이어 써요.',
      '하루 활동시간을 바꾸면 시간표가 다시 계산돼요.',
      '방장만 바꿀 수 있어요. 여행이 끝나면 이름·표지만 바꿔요.',
    ],
    where: '홈 > 메뉴 "설정" · 채팅 > 톱니',
    go: { route: 'TripSettings', label: '설정 열기', trip: true },
  },
  {
    id: 'profile',
    section: '나누기와 내 정보',
    icon: 'user',
    title: '프로필과 계정',
    summary: '알림·위치·계정을 관리해요. 게스트는 계정으로 바꿀 수 있어요.',
    how: [
      '게스트는 30일 동안 이 기기에서만 쓸 수 있어요. "계정 만들기"로 바꾸면 여행방이 그대로 이어져요.',
      '비밀번호를 잊으면 로그인 화면의 "계정찾기"로 메일 코드를 받아 새로 정해요.',
      '이메일 외에 카카오·구글로도 로그인해요.',
    ],
    where: '하단 탭 프로필',
    go: { route: 'More', label: '프로필 열기' },
  },
];

/** 묶음별 단계 목록 */
export function stepsBySection(): { section: string; steps: GuideStep[] }[] {
  return GUIDE_SECTIONS.map((section) => ({ section, steps: GUIDE_STEPS.filter((s) => s.section === section) }));
}

/** 이 폭부터 컴퓨터 화면(탭이 왼쪽 메뉴가 된다) */
export const GUIDE_WIDE_MIN = 900;

/** '찾는 곳' 문구. 컴퓨터 폭에서는 하단 탭이 왼쪽 메뉴라 그에 맞춰 바꾼다 */
export function stepWhere(step: GuideStep, screenW: number): string {
  return screenW >= GUIDE_WIDE_MIN ? step.where.replace('하단 탭', '왼쪽 메뉴') : step.where;
}

/** 단계 번호('3 / 19') */
export function stepCounter(index: number): string {
  return `${index + 1} / ${GUIDE_STEPS.length}`;
}
