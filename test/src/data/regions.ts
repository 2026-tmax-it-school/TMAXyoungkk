import type { LatLng, RegionId } from '../types';
import type { Region } from '../core/ports';
import { haversineKm } from '../core/util';

/**
 * 국내 여행 지역 목록(FR-201: 국내 지역만 선택 가능). 중심 좌표와 반경은 프로토타입 근사값이다.
 * 목적지 밖 판정(FR-202·401)은 이 반경으로만 한다. 자동 추출은 밖을 버리고, 수동 등록은 확인 뒤 담는다.
 * 해외는 로드맵이라 넣지 않는다.
 */
export const REGIONS: Region[] = [
  { id: 'seoul', name: '서울', label: '서울특별시', center: { latitude: 37.5665, longitude: 126.978 }, radiusKm: 25 },
  { id: 'incheon', name: '인천', label: '인천광역시', center: { latitude: 37.4563, longitude: 126.7052 }, radiusKm: 25 },
  { id: 'suwon', name: '수원', label: '경기도 수원시', center: { latitude: 37.2636, longitude: 127.0286 }, radiusKm: 15 },
  { id: 'gapyeong', name: '가평', label: '경기도 가평군', center: { latitude: 37.8315, longitude: 127.5105 }, radiusKm: 25 },
  { id: 'chuncheon', name: '춘천', label: '강원특별자치도 춘천시', center: { latitude: 37.8813, longitude: 127.7298 }, radiusKm: 20 },
  { id: 'gangneung', name: '강릉', label: '강원특별자치도 강릉시', center: { latitude: 37.7519, longitude: 128.8761 }, radiusKm: 25 },
  { id: 'sokcho', name: '속초', label: '강원특별자치도 속초시', center: { latitude: 38.207, longitude: 128.5918 }, radiusKm: 15 },
  { id: 'danyang', name: '단양', label: '충청북도 단양군', center: { latitude: 36.9846, longitude: 128.3656 }, radiusKm: 20 },
  { id: 'daejeon', name: '대전', label: '대전광역시', center: { latitude: 36.3504, longitude: 127.3845 }, radiusKm: 20 },
  { id: 'jeonju', name: '전주', label: '전북특별자치도 전주시', center: { latitude: 35.8242, longitude: 127.148 }, radiusKm: 15 },
  { id: 'gunsan', name: '군산', label: '전북특별자치도 군산시', center: { latitude: 35.9676, longitude: 126.7366 }, radiusKm: 15 },
  { id: 'gwangju', name: '광주', label: '광주광역시', center: { latitude: 35.1595, longitude: 126.8526 }, radiusKm: 20 },
  { id: 'yeosu', name: '여수', label: '전라남도 여수시', center: { latitude: 34.7604, longitude: 127.6622 }, radiusKm: 25 },
  { id: 'andong', name: '안동', label: '경상북도 안동시', center: { latitude: 36.5684, longitude: 128.7294 }, radiusKm: 25 },
  { id: 'gyeongju', name: '경주', label: '경상북도 경주시', center: { latitude: 35.8562, longitude: 129.2247 }, radiusKm: 30 },
  { id: 'pohang', name: '포항', label: '경상북도 포항시', center: { latitude: 36.019, longitude: 129.3435 }, radiusKm: 25 },
  { id: 'daegu', name: '대구', label: '대구광역시', center: { latitude: 35.8714, longitude: 128.6014 }, radiusKm: 25 },
  { id: 'busan', name: '부산', label: '부산광역시', center: { latitude: 35.1796, longitude: 129.0756 }, radiusKm: 25 },
  { id: 'tongyeong', name: '통영', label: '경상남도 통영시', center: { latitude: 34.8544, longitude: 128.4331 }, radiusKm: 20 },
  { id: 'geoje', name: '거제', label: '경상남도 거제시', center: { latitude: 34.8806, longitude: 128.6211 }, radiusKm: 25 },
  { id: 'namhae', name: '남해', label: '경상남도 남해군', center: { latitude: 34.8376, longitude: 127.8924 }, radiusKm: 20 },
  { id: 'jeju', name: '제주', label: '제주특별자치도', center: { latitude: 33.3846, longitude: 126.5535 }, radiusKm: 45 },
];

export function regionById(id: RegionId): Region | undefined {
  return REGIONS.find((r) => r.id === id);
}

/** 지역 중심에서 반경 안인지. region은 Region이나 id를 받는다. 모르는 id면 false. */
export function isInRegion(region: Region | RegionId, coord: LatLng): boolean {
  const r = typeof region === 'string' ? regionById(region) : region;
  if (!r) return false;
  return haversineKm(r.center, coord) <= r.radiusKm;
}
