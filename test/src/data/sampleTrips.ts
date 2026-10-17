import type { Category, LatLng, RegionId } from '../types';

/**
 * 추천 여행지 예시 2박 3일 일정(WP2 소유, 2026-10-17). 홈 '추천 여행지' 여섯 곳(부산·경주·제주·강릉·전주·여수)마다 하나.
 * 장소 이름·주소·좌표는 2026-10-17에 카카오 장소 검색(서버 중계)으로 하나씩 확인한 값이다(손으로 옮기지 않았다).
 * 신경주역은 저장소 시나리오 데이터(data/scenario.ts gj-station)의 좌표다.
 * 하루 4곳 안팎(전주 첫날 5곳)이고 같은 날 장소는 가까운 곳끼리 묶었다. 영업시간은 넣지 않는다(휴무·시간은 실제 방문 전 확인).
 * 설명 한 줄은 일반적인 소개이고, 일정은 '예시'다. 여행방을 만들 때 장소가 후보로 담기고 날짜가 정해진다(core/trip/sample.ts).
 */

export interface SamplePlace {
  /** '{지역}-{일차}-{순서}'. 후보의 placeId는 'sample:' 뒤에 붙인다 */
  id: string;
  name: string;
  category: Category;
  /** 표시용 세부 종류(카카오 분류의 마지막 단계) */
  kind: string;
  address: string;
  coord: LatLng;
  /** 한 줄 소개 */
  note: string;
}

export interface SampleDay {
  title: string;
  blurb: string;
  places: SamplePlace[];
}

export interface SampleBase {
  id: string;
  name: string;
  address: string;
  coord: LatLng;
}

export interface SampleTrip {
  regionId: RegionId;
  title: string;
  blurb: string;
  /** 하루의 출발·복귀 기점(역·공항). 숙소는 사용자가 정한다 */
  base: SampleBase;
  days: SampleDay[];
}

export const SAMPLE_TRIPS: Record<string, SampleTrip> = {
  busan: {
    regionId: 'busan',
    title: '부산 2박 3일',
    blurb: '바다와 야경, 시장 골목을 걷는 부산 대표 코스',
    base: { id: 'base-busan', name: '부산역', address: '부산 동구 중앙대로 206', coord: { latitude: 35.11520, longitude: 129.04155 } },
    days: [
      {
        title: '원도심과 시장 골목',
        blurb: '감천문화마을에서 시작해 시장과 용두산공원을 도는 날',
        places: [
          { id: 'busan-1-1', name: '감천문화마을', category: '관광지', kind: '관광,명소', address: '부산 사하구 감천동 1-17', coord: { latitude: 35.09741, longitude: 129.01056 }, note: '알록달록한 골목과 벽화를 걸으며 사진을 남겨요' },
          { id: 'busan-1-2', name: '자갈치시장', category: '식당', kind: '시장', address: '부산 중구 자갈치해안로 52', coord: { latitude: 35.09662, longitude: 129.03058 }, note: '바다 앞 시장에서 회와 해산물로 점심을 먹어요' },
          { id: 'busan-1-3', name: '국제시장', category: '쇼핑', kind: '시장', address: '부산 중구 신창동4가 56-4', coord: { latitude: 35.10132, longitude: 129.02819 }, note: '먹거리와 잡화가 모인 시장 골목을 구경해요' },
          { id: 'busan-1-4', name: '용두산공원', category: '공원', kind: '도시근린공원', address: '부산 중구 용두산길 37-55', coord: { latitude: 35.10093, longitude: 129.03244 }, note: '도심 속 공원에서 부산 항구 전경을 내려다봐요' },
        ],
      },
      {
        title: '해운대에서 광안리까지',
        blurb: '해변과 전망대로 이어지는 바다의 날',
        places: [
          { id: 'busan-2-1', name: '해운대해수욕장', category: '관광지', kind: '해수욕장,해변', address: '부산 해운대구 우동', coord: { latitude: 35.15852, longitude: 129.15985 }, note: '부산의 대표 해변에서 아침 산책을 해요' },
          { id: 'busan-2-2', name: '동백섬', category: '공원', kind: '섬(내륙)', address: '부산 해운대구 우동 708-3', coord: { latitude: 35.15394, longitude: 129.15229 }, note: '해변 옆 숲길을 따라 한 바퀴 걸어요' },
          { id: 'busan-2-3', name: '청사포다릿돌전망대', category: '관광지', kind: '전망대', address: '부산 해운대구 중동 산 3-9', coord: { latitude: 35.16419, longitude: 129.19631 }, note: '바다 위로 뻗은 전망대에서 파도를 구경해요' },
          { id: 'busan-2-4', name: '광안리해수욕장', category: '관광지', kind: '해수욕장,해변', address: '부산 수영구 광안해변로 219', coord: { latitude: 35.15319, longitude: 129.11898 }, note: '광안대교 야경을 보며 하루를 마무리해요' },
        ],
      },
      {
        title: '영도와 송도',
        blurb: '절벽 산책길과 케이블카를 즐기는 날',
        places: [
          { id: 'busan-3-1', name: '태종대유원지', category: '공원', kind: '유원지', address: '부산 영도구 동삼동 산 29-1', coord: { latitude: 35.05253, longitude: 129.08778 }, note: '절벽과 등대가 이어진 해안 산책로를 걸어요' },
          { id: 'busan-3-2', name: '흰여울문화마을', category: '관광지', kind: '관광,명소', address: '부산 영도구 영선동4가 605-3', coord: { latitude: 35.07944, longitude: 129.04375 }, note: '바다를 낀 하얀 골목을 천천히 걸어요' },
          { id: 'busan-3-3', name: '송도해상케이블카', category: '관광지', kind: '케이블카', address: '부산 서구 송도해변로 171', coord: { latitude: 35.07664, longitude: 129.02340 }, note: '바다 위를 가로지르는 케이블카를 타요' },
          { id: 'busan-3-4', name: '이재모피자 본점', category: '식당', kind: '피자', address: '부산 중구 광복중앙로 31', coord: { latitude: 35.10204, longitude: 129.03075 }, note: '광복동에서 유명한 피자로 마지막 식사를 해요' },
        ],
      },
    ],
  },
  gyeongju: {
    regionId: 'gyeongju',
    title: '경주 2박 3일',
    blurb: '천년 고도의 유적과 골목을 걷는 산책 코스',
    base: { id: 'base-gyeongju', name: '신경주역', address: '경북 경주시 건천읍 경주역세권로', coord: { latitude: 35.79830, longitude: 129.13950 } },
    days: [
      {
        title: '불국사와 교촌',
        blurb: '신라 불교 유적을 보고 교촌에서 식사하는 날',
        places: [
          { id: 'gyeongju-1-1', name: '불국사', category: '관광지', kind: '절,사찰', address: '경북 경주시 불국로 385', coord: { latitude: 35.78991, longitude: 129.33184 }, note: '석가탑과 다보탑이 있는 신라의 대표 사찰이에요' },
          { id: 'gyeongju-1-2', name: '석굴암', category: '관광지', kind: '절,사찰', address: '경북 경주시 석굴로 238', coord: { latitude: 35.79524, longitude: 129.35052 }, note: '토함산 위에서 석굴 본존불을 만나요' },
          { id: 'gyeongju-1-3', name: '요석궁 1779', category: '식당', kind: '한정식', address: '경북 경주시 교촌안길 19-4', coord: { latitude: 35.83031, longitude: 129.21675 }, note: '교촌에서 한정식으로 점심을 먹어요' },
          { id: 'gyeongju-1-4', name: '첨성대', category: '관광지', kind: '문화유적', address: '경북 경주시 인왕동 839-1', coord: { latitude: 35.83471, longitude: 129.21900 }, note: '동양에서 가장 오래된 천문대를 둘러봐요' },
        ],
      },
      {
        title: '고분과 황리단길',
        blurb: '대릉원 돌담길과 카페 골목, 월지 야경의 날',
        places: [
          { id: 'gyeongju-2-1', name: '대릉원', category: '공원', kind: '릉,묘,총', address: '경북 경주시 황남동 31-1', coord: { latitude: 35.83819, longitude: 129.21333 }, note: '왕릉 사이 돌담길을 걸어요' },
          { id: 'gyeongju-2-2', name: '황리단길', category: '쇼핑', kind: '카페거리', address: '경북 경주시 태종로 746', coord: { latitude: 35.83933, longitude: 129.20965 }, note: '한옥 카페와 가게가 모인 골목을 구경해요' },
          { id: 'gyeongju-2-3', name: '황남빵', category: '카페', kind: '제과,베이커리', address: '경북 경주시 태종로 783', coord: { latitude: 35.84084, longitude: 129.21364 }, note: '경주 대표 빵을 맛보며 쉬어가요' },
          { id: 'gyeongju-2-4', name: '동궁과월지', category: '관광지', kind: '연못', address: '경북 경주시 원화로 102', coord: { latitude: 35.83478, longitude: 129.22698 }, note: '밤에 조명이 켜진 연못 풍경을 봐요' },
        ],
      },
      {
        title: '박물관과 보문호',
        blurb: '박물관과 호숫가에서 천천히 마무리하는 날',
        places: [
          { id: 'gyeongju-3-1', name: '국립경주박물관', category: '관광지', kind: '박물관', address: '경북 경주시 일정로 186', coord: { latitude: 35.82923, longitude: 129.22795 }, note: '신라 금관과 성덕대왕신종을 볼 수 있어요' },
          { id: 'gyeongju-3-2', name: '경주교촌마을', category: '관광지', kind: '전시관', address: '경북 경주시 교촌안길 31', coord: { latitude: 35.82997, longitude: 129.21761 }, note: '한옥이 모인 교촌마을을 걸어요' },
          { id: 'gyeongju-3-3', name: '보문호', category: '공원', kind: '호수', address: '경북 경주시 신평동 719-1', coord: { latitude: 35.84461, longitude: 129.27754 }, note: '호수를 따라 산책하며 쉬어요' },
          { id: 'gyeongju-3-4', name: '경주월드', category: '관광지', kind: '테마파크', address: '경북 경주시 보문로 544', coord: { latitude: 35.83625, longitude: 129.28207 }, note: '놀이기구를 타며 마지막 날을 즐겨요' },
        ],
      },
    ],
  },
  jeju: {
    regionId: 'jeju',
    title: '제주 2박 3일',
    blurb: '제주시, 동쪽 해안, 서귀포 남쪽을 도는 렌터카 코스',
    base: { id: 'base-jeju', name: '제주국제공항', address: '제주특별자치도 제주시 공항로 2', coord: { latitude: 33.50684, longitude: 126.49272 } },
    days: [
      {
        title: '제주시 시내와 해안',
        blurb: '도착해서 시장과 해안을 가볍게 도는 날',
        places: [
          { id: 'jeju-1-1', name: '용두암', category: '관광지', kind: '바위', address: '제주특별자치도 제주시 용담이동', coord: { latitude: 33.51612, longitude: 126.51197 }, note: '용머리를 닮은 바위를 보고 해안을 걸어요' },
          { id: 'jeju-1-2', name: '제주동문시장', category: '쇼핑', kind: '시장', address: '제주특별자치도 제주시 동문로 16', coord: { latitude: 33.51278, longitude: 126.52830 }, note: '제주 먹거리와 기념품을 사요' },
          { id: 'jeju-1-3', name: '흑돼지거리', category: '식당', kind: '먹자골목', address: '제주특별자치도 제주시 일도일동 1492-1', coord: { latitude: 33.51546, longitude: 126.52680 }, note: '제주 흑돼지로 저녁을 먹어요' },
          { id: 'jeju-1-4', name: '이호테우해수욕장', category: '관광지', kind: '해수욕장,해변', address: '제주특별자치도 제주시 이호일동 1665-13', coord: { latitude: 33.49738, longitude: 126.45269 }, note: '말 모양 등대와 석양을 봐요' },
        ],
      },
      {
        title: '동쪽 해안 일주',
        blurb: '동굴과 해변, 일출봉을 잇는 동쪽의 날',
        places: [
          { id: 'jeju-2-1', name: '만장굴', category: '관광지', kind: '동굴', address: '제주특별자치도 제주시 구좌읍 만장굴길 182', coord: { latitude: 33.52838, longitude: 126.77162 }, note: '세계적으로 긴 용암동굴을 걸어요' },
          { id: 'jeju-2-2', name: '김녕해수욕장', category: '관광지', kind: '해수욕장,해변', address: '제주특별자치도 제주시 구좌읍 해맞이해안로 7-6', coord: { latitude: 33.55744, longitude: 126.75931 }, note: '에메랄드빛 바다를 구경해요' },
          { id: 'jeju-2-3', name: '성산일출봉', category: '관광지', kind: '산봉우리', address: '제주특별자치도 서귀포시 성산읍 성산리 78', coord: { latitude: 33.45913, longitude: 126.94054 }, note: '분화구가 있는 봉우리에 올라 바다를 봐요' },
          { id: 'jeju-2-4', name: '섭지코지', category: '관광지', kind: '바위', address: '제주특별자치도 서귀포시 성산읍 섭지코지로 107', coord: { latitude: 33.42394, longitude: 126.93061 }, note: '바다로 튀어나온 언덕을 따라 산책해요' },
        ],
      },
      {
        title: '서귀포 남쪽',
        blurb: '차밭과 폭포, 해안 절벽을 보는 남쪽의 날',
        places: [
          { id: 'jeju-3-1', name: '오설록 티뮤지엄', category: '카페', kind: '오설록 티하우스', address: '제주특별자치도 서귀포시 안덕면 신화역사로 15', coord: { latitude: 33.30592, longitude: 126.28949 }, note: '초록 차밭 옆에서 녹차 디저트를 즐겨요' },
          { id: 'jeju-3-2', name: '중문대포주상절리대', category: '관광지', kind: '바위', address: '제주특별자치도 서귀포시 이어도로 36-30', coord: { latitude: 33.23798, longitude: 126.42601 }, note: '바다로 이어진 기둥 모양 절벽을 봐요' },
          { id: 'jeju-3-3', name: '천지연폭포', category: '관광지', kind: '폭포', address: '제주특별자치도 서귀포시 남성중로 2-15', coord: { latitude: 33.24474, longitude: 126.55970 }, note: '숲길 끝에서 폭포를 만나요' },
          { id: 'jeju-3-4', name: '이중섭거리', category: '관광지', kind: '테마거리', address: '제주특별자치도 서귀포시 이중섭로 4-1', coord: { latitude: 33.24761, longitude: 126.56400 }, note: '예술가의 거리를 걸으며 마무리해요' },
        ],
      },
    ],
  },
  gangneung: {
    regionId: 'gangneung',
    title: '강릉 2박 3일',
    blurb: '커피와 바다, 시장과 항구를 즐기는 동해 코스',
    base: { id: 'base-gangneung', name: '강릉역', address: '강원특별자치도 강릉시 용지로 176', coord: { latitude: 37.76452, longitude: 128.89963 } },
    days: [
      {
        title: '경포 일대',
        blurb: '고택과 호수, 순두부로 시작하는 날',
        places: [
          { id: 'gangneung-1-1', name: '오죽헌', category: '관광지', kind: '유적지', address: '강원특별자치도 강릉시 율곡로3139번길 24', coord: { latitude: 37.77925, longitude: 128.87754 }, note: '율곡 이이가 태어난 고택을 둘러봐요' },
          { id: 'gangneung-1-2', name: '강릉선교장', category: '관광지', kind: '문화유적', address: '강원특별자치도 강릉시 운정길 63', coord: { latitude: 37.78664, longitude: 128.88517 }, note: '전통 한옥 고택의 정원을 걸어요' },
          { id: 'gangneung-1-3', name: '경포대', category: '관광지', kind: '문화유적', address: '강원특별자치도 강릉시 경포로 365', coord: { latitude: 37.79507, longitude: 128.89664 }, note: '경포호수가 내려다보이는 누각에 올라요' },
          { id: 'gangneung-1-4', name: '초당순두부마을', category: '식당', kind: '먹자골목', address: '강원특별자치도 강릉시 강문동 146-35', coord: { latitude: 37.79443, longitude: 128.91537 }, note: '초당순두부로 따뜻한 식사를 해요' },
        ],
      },
      {
        title: '시장과 바다 카페',
        blurb: '시장 구경과 해변 카페, 전시가 있는 날',
        places: [
          { id: 'gangneung-2-1', name: '강릉중앙시장', category: '쇼핑', kind: '시장', address: '강원특별자치도 강릉시 금성로 21', coord: { latitude: 37.75403, longitude: 128.89862 }, note: '닭강정과 먹거리가 모인 시장을 구경해요' },
          { id: 'gangneung-2-2', name: '안목해변 카페거리', category: '카페', kind: '카페거리', address: '강원특별자치도 강릉시 창해로14번길 20', coord: { latitude: 37.77265, longitude: 128.94724 }, note: '바다를 보며 커피 한 잔을 즐겨요' },
          { id: 'gangneung-2-3', name: '경포해수욕장', category: '관광지', kind: '해수욕장,해변', address: '강원특별자치도 강릉시 창해로 514', coord: { latitude: 37.80341, longitude: 128.91021 }, note: '넓은 해변을 따라 산책해요' },
          { id: 'gangneung-2-4', name: '아르떼뮤지엄 강릉', category: '관광지', kind: '전시관', address: '강원특별자치도 강릉시 난설헌로 131', coord: { latitude: 37.79170, longitude: 128.90753 }, note: '빛과 영상으로 꾸민 전시를 봐요' },
        ],
      },
      {
        title: '정동진에서 주문진',
        blurb: '남쪽 바다 기차역에서 북쪽 항구까지 가는 날',
        places: [
          { id: 'gangneung-3-1', name: '정동진역', category: '관광지', kind: 'KTX정차역', address: '강원특별자치도 강릉시 강동면 정동역길 17', coord: { latitude: 37.69143, longitude: 129.03269 }, note: '바다와 가장 가까운 기차역에서 사진을 남겨요' },
          { id: 'gangneung-3-2', name: '테라로사 본점', category: '카페', kind: '테라로사', address: '강원특별자치도 강릉시 구정면 현천길 7', coord: { latitude: 37.69651, longitude: 128.89253 }, note: '강릉 커피의 대표 카페에서 쉬어가요' },
          { id: 'gangneung-3-3', name: '주문진수산시장', category: '쇼핑', kind: '시장', address: '강원특별자치도 강릉시 주문진읍 시장길 38', coord: { latitude: 37.89111, longitude: 128.82774 }, note: '신선한 해산물을 구경하고 맛봐요' },
          { id: 'gangneung-3-4', name: '주문진등대', category: '관광지', kind: '등대', address: '강원특별자치도 강릉시 주문진읍 옛등대길 24-7', coord: { latitude: 37.89758, longitude: 128.83362 }, note: '항구 끝 등대에서 바다를 봐요' },
        ],
      },
    ],
  },
  jeonju: {
    regionId: 'jeonju',
    title: '전주 2박 3일',
    blurb: '한옥마을 골목과 남부시장 먹거리를 걷는 전주 코스',
    base: { id: 'base-jeonju', name: '전주역', address: '전북특별자치도 전주시 덕진구 동부대로 680', coord: { latitude: 35.84985, longitude: 127.16180 } },
    days: [
      {
        title: '한옥마을 산책',
        blurb: '한옥마을 안에서 걸어서 도는 날',
        places: [
          { id: 'jeonju-1-1', name: '전주한옥마을', category: '관광지', kind: '관광,명소', address: '전북특별자치도 전주시 완산구 풍남동3가 63-1', coord: { latitude: 35.81478, longitude: 127.15256 }, note: '한옥이 이어진 골목을 천천히 걸어요' },
          { id: 'jeonju-1-2', name: '경기전', category: '관광지', kind: '사당,제단', address: '전북특별자치도 전주시 완산구 태조로 44', coord: { latitude: 35.81538, longitude: 127.14972 }, note: '조선 태조의 어진을 모신 곳을 둘러봐요' },
          { id: 'jeonju-1-3', name: '전동성당', category: '관광지', kind: '성당', address: '전북특별자치도 전주시 완산구 태조로 51', coord: { latitude: 35.81333, longitude: 127.14922 }, note: '붉은 벽돌의 오래된 성당을 구경해요' },
          { id: 'jeonju-1-4', name: '한국집', category: '식당', kind: '한식', address: '전북특별자치도 전주시 완산구 어진길 119', coord: { latitude: 35.81652, longitude: 127.14823 }, note: '전주비빔밥으로 점심을 먹어요' },
          { id: 'jeonju-1-5', name: '오목대', category: '공원', kind: '문화유적', address: '전북특별자치도 전주시 완산구 기린대로 55', coord: { latitude: 35.81438, longitude: 127.15458 }, note: '한옥마을이 내려다보이는 언덕에 올라요' },
        ],
      },
      {
        title: '시장과 거리',
        blurb: '남부시장 먹거리와 구도심 거리를 도는 날',
        places: [
          { id: 'jeonju-2-1', name: '풍남문', category: '관광지', kind: '문', address: '전북특별자치도 전주시 완산구 풍남문3길 1', coord: { latitude: 35.81352, longitude: 127.14758 }, note: '전주 읍성의 남쪽 문을 둘러봐요' },
          { id: 'jeonju-2-2', name: '전주남부시장', category: '쇼핑', kind: '시장', address: '전북특별자치도 전주시 완산구 풍남문2길 49', coord: { latitude: 35.81298, longitude: 127.14701 }, note: '전통시장에서 길거리 음식을 맛봐요' },
          { id: 'jeonju-2-3', name: '풍년제과 본점', category: '카페', kind: '제과,베이커리', address: '전북특별자치도 전주시 완산구 팔달로 141', coord: { latitude: 35.81502, longitude: 127.14790 }, note: '전주 초코파이로 유명한 빵집에서 쉬어가요' },
          { id: 'jeonju-2-4', name: '전주영화의거리', category: '쇼핑', kind: '테마거리', address: '전북특별자치도 전주시 완산구 고사동', coord: { latitude: 35.82126, longitude: 127.14419 }, note: '영화관과 가게가 이어진 거리를 걸어요' },
        ],
      },
      {
        title: '공원과 예술',
        blurb: '공원과 문화 공간에서 여유롭게 마무리하는 날',
        places: [
          { id: 'jeonju-3-1', name: '국립무형유산원', category: '관광지', kind: '박물관', address: '전북특별자치도 전주시 완산구 서학로 95', coord: { latitude: 35.80965, longitude: 127.15966 }, note: '전통 공연과 전시를 둘러봐요' },
          { id: 'jeonju-3-2', name: '전주덕진공원', category: '공원', kind: '도시근린공원', address: '전북특별자치도 전주시 덕진구 권삼득로 390', coord: { latitude: 35.84749, longitude: 127.12102 }, note: '연꽃이 있는 호수 공원을 산책해요' },
          { id: 'jeonju-3-3', name: '팔복예술공장', category: '관광지', kind: '문화시설', address: '전북특별자치도 전주시 덕진구 구렛들1길 46', coord: { latitude: 35.86038, longitude: 127.10122 }, note: '옛 공장을 고친 예술 공간을 구경해요' },
          { id: 'jeonju-3-4', name: '홍시궁 객리단길본점', category: '카페', kind: '카페', address: '전북특별자치도 전주시 완산구 전주객사1길 94', coord: { latitude: 35.82041, longitude: 127.13823 }, note: '객리단길 카페에서 마지막 휴식을 해요' },
        ],
      },
    ],
  },
  yeosu: {
    regionId: 'yeosu',
    title: '여수 2박 3일',
    blurb: '밤바다와 케이블카, 섬 산책이 있는 남해 코스',
    base: { id: 'base-yeosu', name: '여수엑스포역', address: '전남광주통합특별시 여수시 망양로 2', coord: { latitude: 34.75307, longitude: 127.74864 } },
    days: [
      {
        title: '엑스포 일대와 밤바다',
        blurb: '공원과 수족관, 밤 포차거리로 이어지는 날',
        places: [
          { id: 'yeosu-1-1', name: '오동도', category: '공원', kind: '섬(내륙)', address: '전남광주통합특별시 여수시 수정동 1-2', coord: { latitude: 34.74460, longitude: 127.76629 }, note: '동백나무 숲길을 걸어 등대까지 가요' },
          { id: 'yeosu-1-2', name: '엑스포해양공원 엑스포공원', category: '공원', kind: '공원', address: '전남광주통합특별시 여수시 박람회길 1', coord: { latitude: 34.74212, longitude: 127.75300 }, note: '넓은 바다 공원을 산책해요' },
          { id: 'yeosu-1-3', name: '아쿠아플라넷 여수', category: '관광지', kind: '아쿠아리움', address: '전남광주통합특별시 여수시 오동도로 61-11', coord: { latitude: 34.74622, longitude: 127.74873 }, note: '다양한 바다 생물을 구경해요' },
          { id: 'yeosu-1-4', name: '여수낭만포차거리', category: '식당', kind: '테마거리', address: '전남광주통합특별시 여수시 하멜로 102', coord: { latitude: 34.73649, longitude: 127.74915 }, note: '밤바다 앞 포차에서 저녁을 먹어요' },
        ],
      },
      {
        title: '돌산과 케이블카',
        blurb: '남쪽 암자와 해상 케이블카를 즐기는 날',
        places: [
          { id: 'yeosu-2-1', name: '향일암', category: '관광지', kind: '절,사찰', address: '전남광주통합특별시 여수시 돌산읍 향일암로 1', coord: { latitude: 34.59158, longitude: 127.80382 }, note: '바위 절벽 위 암자에서 일출 명소를 봐요' },
          { id: 'yeosu-2-2', name: '돌산공원', category: '공원', kind: '도시근린공원', address: '전남광주통합특별시 여수시 돌산읍 우두리 799-76', coord: { latitude: 34.73055, longitude: 127.73993 }, note: '돌산대교와 바다가 내려다보여요' },
          { id: 'yeosu-2-3', name: '여수해상케이블카', category: '관광지', kind: '케이블카', address: '전남광주통합특별시 여수시 돌산읍 돌산로 3600-1', coord: { latitude: 34.73059, longitude: 127.74153 }, note: '바다 위를 가로지르는 케이블카를 타요' },
          { id: 'yeosu-2-4', name: '원조두꺼비게장', category: '식당', kind: '게,대게', address: '전남광주통합특별시 여수시 봉산남3길 12', coord: { latitude: 34.73378, longitude: 127.72070 }, note: '여수 대표 게장백반으로 식사를 해요' },
        ],
      },
      {
        title: '구도심 산책',
        blurb: '광장과 벽화마을, 시장을 걷는 날',
        places: [
          { id: 'yeosu-3-1', name: '이순신광장', category: '관광지', kind: '광장', address: '전남광주통합특별시 여수시 중앙동 383', coord: { latitude: 34.73945, longitude: 127.73605 }, note: '이순신 장군 동상이 있는 광장에서 시작해요' },
          { id: 'yeosu-3-2', name: '고소동벽화마을', category: '관광지', kind: '관광,명소', address: '전남광주통합특별시 여수시 고소동 268', coord: { latitude: 34.73903, longitude: 127.74118 }, note: '벽화가 이어진 언덕 마을을 걸어요' },
          { id: 'yeosu-3-3', name: '여수수산시장', category: '쇼핑', kind: '시장', address: '전남광주통합특별시 여수시 여객선터미널길 24', coord: { latitude: 34.73810, longitude: 127.73181 }, note: '싱싱한 해산물을 구경해요' },
          { id: 'yeosu-3-4', name: '만성리검은모래해변', category: '관광지', kind: '해수욕장,해변', address: '전남광주통합특별시 여수시 만성리길 15-1', coord: { latitude: 34.77886, longitude: 127.74548 }, note: '검은 모래 해변에서 여행을 마무리해요' },
        ],
      },
    ],
  },
};

export function sampleTripFor(regionId: RegionId): SampleTrip | undefined {
  return SAMPLE_TRIPS[regionId];
}
