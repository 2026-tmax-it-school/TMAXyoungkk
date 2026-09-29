import type { Category, Place, RegionId } from '../types';
import { SCENARIO_PLACES } from './scenario';

/**
 * 로컬 장소 사전(WP3 소유). 로컬 PlaceProvider, 규칙 기반 추출의 어휘, 로컬 추천이 쓴다. 예시 데이터다.
 *
 * 시나리오 14곳과 기점은 동결 파일 data/scenario.ts의 SCENARIO_PLACES를 그대로 가져온다.
 * 여기서는 별칭·태그·인기도와 주변 장소·동명 장소·목적지 밖 예시만 더한다.
 * 14곳의 placeId·좌표·카테고리·영업시간·체류는 바꾸지 않는다(wp3-candidates 테스트가 확인한다).
 * 좌표는 프로토타입 근사값이고 영업시간은 예시 데이터다.
 *
 * 별칭 규칙: 사람들이 채팅에서 실제로 부르는 이름만 넣는다. 띄어쓰기 차이는 추출이 알아서 무시하므로
 * '대릉원돌담길' 같은 붙여 쓴 형태는 넣지 않는다. 한 글자 별칭과 지역 이름('경주')은 넣지 않는다(오탐).
 */

export type DictPlace = Place & { aliases?: string[]; region: RegionId };

/** 시나리오 장소에 붙이는 별칭·태그·인기도 */
const SCENARIO_EXTRA: Record<string, { aliases?: string[]; tags: string[]; popularity: number }> = {
  'gj-bulguksa': { tags: ['역사'], popularity: 98 },
  'gj-seokguram': { tags: ['역사', '자연'], popularity: 92 },
  'gj-gyochon-hanjeongsik': { aliases: ['교촌 한정식'], tags: ['맛집'], popularity: 60 },
  'gj-hwangnidan': { aliases: ['황리단'], tags: ['맛집', '카페'], popularity: 95 },
  'gj-museum': { aliases: ['경주박물관', '경주 국립박물관'], tags: ['역사'], popularity: 85 },
  'gj-daereungwon': { aliases: ['천마총'], tags: ['역사', '자연'], popularity: 88 },
  'gj-cheomseongdae': { tags: ['역사'], popularity: 90 },
  'gj-cheomseongdae-cafe': { tags: ['카페'], popularity: 55 },
  'gj-woljeonggyo': { tags: ['역사'], popularity: 78 },
  'gj-bomunho': { aliases: ['보문호수'], tags: ['자연', '휴식'], popularity: 80 },
  'gj-gyeongjuworld': { tags: ['액티비티'], popularity: 82 },
  'gj-daereungwon-wall': { tags: ['자연', '휴식'], popularity: 50 },
  'gj-gameunsaji': { aliases: ['감은사지', '감은사', '감은사지 석탑'], tags: ['역사'], popularity: 45 },
  'gj-donggung': { aliases: ['동궁', '월지', '안압지'], tags: ['역사', '휴식'], popularity: 93 },
  'gj-lahan-select': { aliases: ['라한셀렉트', '라한호텔'], tags: ['휴식'], popularity: 40 },
  'gj-station': { aliases: ['신경주역'], tags: [], popularity: 30 },
};

function extra(
  placeId: string,
  name: string,
  latitude: number,
  longitude: number,
  category: Category,
  kind: string,
  region: RegionId,
  more: Partial<DictPlace> = {},
): DictPlace {
  return { placeId, name, coord: { latitude, longitude }, category, kind, region, ...more };
}

/** 빈 시간·추천용 주변 장소, 동명 예시(황남빵 2곳), 목적지 밖 예시(포항 호미곶) */
const OTHER_PLACES: DictPlace[] = [
  extra('gj-gyerim', '계림', 35.8339, 129.2176, '공원', '숲', 'gyeongju', { tags: ['자연', '역사'], popularity: 70 }),
  extra('gj-hyanggyo', '경주향교', 35.8303, 129.2139, '관광지', '유적', 'gyeongju', { tags: ['역사'], popularity: 55 }),
  extra('gj-choi-house', '경주 교동 최씨 고택', 35.8299, 129.2154, '관광지', '고택', 'gyeongju', {
    aliases: ['최부자댁', '최씨 고택'],
    tags: ['역사'],
    popularity: 65,
  }),
  extra('gj-gyochon-village', '경주 교촌마을', 35.8298, 129.2145, '관광지', '한옥마을', 'gyeongju', {
    aliases: ['교촌마을', '교촌 한옥마을'],
    address: '경상북도 경주시 교촌길 39-2',
    hours: { open: '09:00', close: '18:00' },
    tags: ['역사', '휴식'],
    popularity: 74,
  }),
  extra('gj-gyori-gimbap', '교리김밥', 35.8295, 129.2151, '식당', '분식', 'gyeongju', {
    hours: { open: '08:30', close: '17:00', closedWeekdays: [3] },
    tags: ['맛집'],
    popularity: 77,
  }),
  extra('gj-hwangseong-park', '황성공원', 35.8565, 129.2115, '공원', '산책', 'gyeongju', { tags: ['자연', '휴식'], popularity: 50 }),
  extra('gj-yangdong', '양동마을', 36.0012, 129.2572, '관광지', '민속마을', 'gyeongju', {
    aliases: ['양동민속마을'],
    tags: ['역사'],
    popularity: 72,
  }),
  extra('gj-munmu', '문무대왕릉', 35.7385, 129.487, '관광지', '유적', 'gyeongju', {
    aliases: ['대왕암'],
    tags: ['역사', '자연'],
    popularity: 68,
  }),
  extra('gj-tongiljeon', '통일전', 35.7826, 129.2807, '관광지', '사당', 'gyeongju', { tags: ['역사'], popularity: 40 }),
  extra('gj-bunhwangsa', '분황사', 35.8397, 129.2338, '관광지', '사찰', 'gyeongju', {
    hours: { open: '08:00', close: '18:00' },
    tags: ['역사'],
    popularity: 58,
  }),
  extra('gj-hwangnyongsa', '황룡사지', 35.8364, 129.2342, '관광지', '유적', 'gyeongju', {
    aliases: ['황룡사 터', '황룡사'],
    tags: ['역사', '자연'],
    popularity: 52,
  }),
  extra('gj-poseokjeong', '포석정', 35.8074, 129.213, '관광지', '유적', 'gyeongju', {
    hours: { open: '09:00', close: '18:00' },
    tags: ['역사'],
    popularity: 54,
  }),
  extra('gj-oreung', '오릉', 35.8246, 129.2104, '관광지', '고분', 'gyeongju', { tags: ['역사', '자연'], popularity: 42 }),
  extra('gj-muyeol', '태종무열왕릉', 35.8469, 129.1884, '관광지', '고분', 'gyeongju', {
    aliases: ['무열왕릉'],
    tags: ['역사'],
    popularity: 44,
  }),
  extra('gj-expo', '경주엑스포대공원', 35.833, 129.287, '공원', '테마공원', 'gyeongju', {
    aliases: ['엑스포공원', '경주타워'],
    hours: { open: '10:00', close: '18:00' },
    tags: ['액티비티', '자연'],
    popularity: 63,
  }),
  extra('gj-oksan', '옥산서원', 35.9981, 129.1604, '관광지', '서원', 'gyeongju', { tags: ['역사', '자연'], popularity: 46 }),
  extra('gj-bomun-cafe', '보문 호숫가 카페', 35.8421, 129.2851, '카페', '카페', 'gyeongju', {
    tags: ['카페', '휴식'],
    popularity: 48,
  }),
  extra('gj-hwangnam-bread-a', '황남빵', 35.8371, 129.2104, '카페', '제과', 'gyeongju', {
    address: '경상북도 경주시 태종로 (예시 본점)',
    tags: ['맛집'],
    popularity: 75,
  }),
  extra('gj-hwangnam-bread-b', '황남빵', 35.8398, 129.2869, '카페', '제과', 'gyeongju', {
    address: '경상북도 경주시 보문로 (예시 보문점)',
    tags: ['맛집'],
    popularity: 60,
  }),
  extra('ph-homigot', '호미곶', 36.0766, 129.5695, '관광지', '해안', 'pohang', {
    aliases: ['호미곶 해맞이광장'],
    tags: ['자연'],
    popularity: 80,
  }),
];

export const PLACES: DictPlace[] = [
  ...SCENARIO_PLACES.map(({ stayMin: _stay, role: _role, ...place }): DictPlace => ({
    ...place,
    region: 'gyeongju',
    ...SCENARIO_EXTRA[place.placeId],
  })),
  ...OTHER_PLACES,
];

/** 기점 후보(숙소·역). 추천 대상에서 뺀다. */
export const BASE_PLACE_IDS: ReadonlySet<string> = new Set(
  SCENARIO_PLACES.filter((p) => p.role === 'base').map((p) => p.placeId),
);

/** 사전에서 이름과 별칭 */
export function surfacesOf(p: DictPlace): string[] {
  return [p.name, ...(p.aliases ?? [])];
}
