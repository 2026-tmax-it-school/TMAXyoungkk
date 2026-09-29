import type { Category, LatLng, Transport } from '../types';
import { DETOUR_FACTOR, FALLBACK_SPEED_KMH } from '../core/constants';
import { haversineKm } from '../core/util';
import type { MapProvider, PlaceHit, TravelMatrix } from './maps';

/**
 * API 키가 없을 때 쓰는 대체 제공자.
 * 장소는 아래 경주 사전에서만 찾고, 이동 시간은 직선거리에 우회 계수를 곱해 추정한다.
 * 키 없이도 후보 추출 → 자동 선별 → 시간표 생성까지 전부 돌려볼 수 있게 하려고 둔다.
 * 좌표는 프로토타입용 근사값이다.
 */
const GAZETTEER: Array<{ name: string; alias?: string[]; coord: LatLng; category: Category }> = [
  { name: '불국사', coord: { latitude: 35.79, longitude: 129.332 }, category: '관광지' },
  { name: '석굴암', coord: { latitude: 35.795, longitude: 129.349 }, category: '관광지' },
  {
    name: '황리단길',
    alias: ['황리단'],
    coord: { latitude: 35.836, longitude: 129.211 },
    category: '쇼핑',
  },
  { name: '대릉원', coord: { latitude: 35.838, longitude: 129.21 }, category: '관광지' },
  {
    name: '동궁과 월지',
    alias: ['동궁', '월지', '안압지'],
    coord: { latitude: 35.8348, longitude: 129.2265 },
    category: '관광지',
  },
  { name: '첨성대', coord: { latitude: 35.8347, longitude: 129.219 }, category: '관광지' },
  {
    name: '국립경주박물관',
    alias: ['경주박물관'],
    coord: { latitude: 35.829, longitude: 129.2275 },
    category: '관광지',
  },
  {
    name: '교촌마을',
    alias: ['교촌한옥마을', '교촌마을 한정식'],
    coord: { latitude: 35.83, longitude: 129.211 },
    category: '식당',
  },
  { name: '월정교', coord: { latitude: 35.8305, longitude: 129.2168 }, category: '관광지' },
  {
    name: '보문호',
    alias: ['보문호수', '보문단지'],
    coord: { latitude: 35.839, longitude: 129.283 },
    category: '공원',
  },
  { name: '경주월드', coord: { latitude: 35.8386, longitude: 129.2867 }, category: '관광지' },
  {
    name: '라한셀렉트 경주',
    alias: ['라한셀렉트', '라한'],
    coord: { latitude: 35.835, longitude: 129.287 },
    category: '기타',
  },
  {
    name: '감은사지 삼층석탑',
    alias: ['감은사지', '감은사'],
    coord: { latitude: 35.735, longitude: 129.478 },
    category: '관광지',
  },
  { name: '문무대왕릉', coord: { latitude: 35.728, longitude: 129.493 }, category: '관광지' },
  { name: '양동마을', coord: { latitude: 36.001, longitude: 129.257 }, category: '관광지' },
  { name: '황성공원', coord: { latitude: 35.856, longitude: 129.211 }, category: '공원' },
  { name: '통일전', coord: { latitude: 35.781, longitude: 129.279 }, category: '관광지' },
  {
    name: '경주역',
    alias: ['신경주역'],
    coord: { latitude: 35.796, longitude: 129.133 },
    category: '기타',
  },
  {
    name: '첨성대 카페거리',
    alias: ['카페거리'],
    coord: { latitude: 35.8355, longitude: 129.2145 },
    category: '카페',
  },
];

function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

export function lookupGazetteer(query: string): PlaceHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const out: PlaceHit[] = [];
  for (const entry of GAZETTEER) {
    const names = [entry.name, ...(entry.alias ?? [])].map(normalize);
    if (names.some((n) => n === q || n.includes(q) || q.includes(n))) {
      out.push({ name: entry.name, coord: entry.coord, category: entry.category });
    }
  }
  return out;
}

export function estimateMinutes(a: LatLng, b: LatLng, transport: Transport): number {
  const km = haversineKm(a, b) * DETOUR_FACTOR[transport];
  const minutes = (km / FALLBACK_SPEED_KMH[transport]) * 60;
  // 주차, 신호, 진입 도보 같은 고정 비용
  const overhead = transport === 'car' ? 4 : 1;
  return Math.max(1, Math.round(minutes + overhead));
}

export const localProvider: MapProvider = {
  id: 'local',
  label: '로컬 추정 (API 키 없음)',

  async searchPlaces(query: string): Promise<PlaceHit[]> {
    return lookupGazetteer(query);
  },

  async travelMatrix(
    origins: LatLng[],
    destinations: LatLng[],
    transport: Transport,
  ): Promise<TravelMatrix> {
    const minutes = origins.map((o) => destinations.map((d) => estimateMinutes(o, d, transport)));
    return { minutes, calls: 0, estimated: true };
  },
};
