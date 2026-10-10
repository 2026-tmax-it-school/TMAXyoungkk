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
  return REGIONS.find((r) => r.id === id) ?? decodeRegionId(id);
}

/* ---------- 목록 밖 지역(검색·지도 선택, 2026-10-10) ---------- */

/**
 * 목록에 없는 시·군(예: 익산)은 이름·중심·반경을 id 문자열에 담는다. 여행방 문서의 region은 문자열 하나라
 * 서버·동기화·다른 멤버의 앱이 따로 지역표를 몰라도 regionById로 그대로 풀린다.
 * 꼴: geo:{위도},{경도},{반경km}:{짧은 이름}:{긴 이름} (이름은 encodeURIComponent)
 */
export const GEO_REGION_PREFIX = 'geo:';
/** 받는 범위(국내). 서버 중계의 KOREA_BOUNDS와 같다 */
const KOREA = { minLat: 33, maxLat: 39, minLng: 124, maxLng: 132 };

export function encodeRegionId(r: { name: string; label: string; center: LatLng; radiusKm: number }): RegionId {
  const lat = r.center.latitude.toFixed(4);
  const lng = r.center.longitude.toFixed(4);
  return `${GEO_REGION_PREFIX}${lat},${lng},${Math.round(r.radiusKm)}:${encodeURIComponent(r.name)}:${encodeURIComponent(r.label)}`;
}

/** geo: id → Region. 꼴이 틀리거나 국외 좌표·이상한 반경이면 undefined(목록 지역과 같이 '모르는 지역'이다) */
export function decodeRegionId(id: RegionId): Region | undefined {
  if (typeof id !== 'string' || !id.startsWith(GEO_REGION_PREFIX) || id.length > 300) return undefined;
  const parts = id.slice(GEO_REGION_PREFIX.length).split(':');
  if (parts.length !== 3) return undefined;
  const nums = parts[0].split(',').map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return undefined;
  const [lat, lng, radiusKm] = nums;
  if (lat < KOREA.minLat || lat > KOREA.maxLat || lng < KOREA.minLng || lng > KOREA.maxLng) return undefined;
  if (radiusKm < 1 || radiusKm > 60) return undefined;
  let name: string;
  let label: string;
  try {
    name = decodeURIComponent(parts[1]).trim();
    label = decodeURIComponent(parts[2]).trim();
  } catch {
    return undefined;
  }
  if (!name || !label || name.length > 30 || label.length > 60) return undefined;
  return { id, name, label, center: { latitude: lat, longitude: lng }, radiusKm };
}

/** 카카오 시·도 이름(짧은 꼴 포함) → 정식 이름. 목록의 label과 같은 꼴로 맞춘다 */
const PROVINCE_FULL: Record<string, string> = {
  서울: '서울특별시', 서울특별시: '서울특별시',
  부산: '부산광역시', 부산광역시: '부산광역시',
  대구: '대구광역시', 대구광역시: '대구광역시',
  인천: '인천광역시', 인천광역시: '인천광역시',
  광주: '광주광역시', 광주광역시: '광주광역시',
  대전: '대전광역시', 대전광역시: '대전광역시',
  울산: '울산광역시', 울산광역시: '울산광역시',
  세종: '세종특별자치시', 세종특별자치시: '세종특별자치시',
  경기: '경기도', 경기도: '경기도',
  강원: '강원특별자치도', 강원도: '강원특별자치도', 강원특별자치도: '강원특별자치도',
  충북: '충청북도', 충청북도: '충청북도',
  충남: '충청남도', 충청남도: '충청남도',
  전북: '전북특별자치도', 전라북도: '전북특별자치도', 전북특별자치도: '전북특별자치도',
  전남: '전라남도', 전라남도: '전라남도',
  경북: '경상북도', 경상북도: '경상북도',
  경남: '경상남도', 경상남도: '경상남도',
  제주: '제주특별자치도', 제주특별자치도: '제주특별자치도',
};
/** 시·도 전체를 한 지역으로 보는 곳(특별·광역시, 세종, 제주) */
const WHOLE_PROVINCE = new Set(['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '제주특별자치도']);

/** '익산시' → '익산', '가평군' → '가평', '서울특별시' → '서울' */
export function shortRegionName(full: string): string {
  const n = full.trim();
  const m = n.match(/^(.+?)(특별자치시|특별자치도|특별시|광역시)$/);
  if (m) return m[1];
  const city = n.match(/^(.{2,}?)(시|군)$/);
  return city ? city[1] : n;
}

/**
 * 행정구역 이름 → 여행 지역. 특별·광역시와 제주는 시·도 전체, 나머지는 시·군(구가 있는 시는 시까지).
 * 목록에 같은 지역이 있으면 목록 지역(id가 짧고 반경이 조정돼 있다), 없으면 geo: 지역이다.
 * 반경은 가정: 시·도 전체 25km, 시 15km, 군 20km.
 */
export function regionFromAdmin(depth1: string, depth2: string | undefined, center: LatLng): Region | undefined {
  const province = PROVINCE_FULL[depth1.trim()] ?? depth1.trim();
  if (!province) return undefined;
  const whole = WHOLE_PROVINCE.has(province) || !depth2?.trim();
  // '수원시 장안구'처럼 구가 붙은 시는 시까지만
  const city = whole ? '' : (depth2 ?? '').trim().split(/\s+/)[0];
  const name = shortRegionName(whole ? province : city);
  const label = whole ? province : `${province} ${city}`;
  const known = REGIONS.find((r) => r.name === name && haversineKm(r.center, center) <= Math.max(r.radiusKm, 30));
  if (known) return known;
  const radiusKm = whole ? (province === '제주특별자치도' ? 45 : 25) : city.endsWith('군') ? 20 : 15;
  const r = { name, label, center, radiusKm };
  return { id: encodeRegionId(r), ...r };
}

/** 목록 지역 검색(카카오를 못 쓸 때). 짧은 이름·긴 이름에 검색어가 들어 있으면 */
export function searchRegionsLocal(query: string): Region[] {
  const q = query.trim();
  if (!q) return [];
  return REGIONS.filter((r) => r.name.includes(q) || r.label.includes(q) || q.includes(r.name));
}

/** 목록 지역 중 이 지점을 품은 가장 가까운 지역(카카오를 못 쓸 때 지도 누르기) */
export function nearestRegionLocal(coord: LatLng): Region | undefined {
  let best: Region | undefined;
  let bestKm = Infinity;
  for (const r of REGIONS) {
    const km = haversineKm(r.center, coord);
    if (km <= r.radiusKm && km < bestKm) {
      best = r;
      bestKm = km;
    }
  }
  return best;
}

/** 지역 중심에서 반경 안인지. region은 Region이나 id를 받는다. 모르는 id면 false. */
export function isInRegion(region: Region | RegionId, coord: LatLng): boolean {
  const r = typeof region === 'string' ? regionById(region) : region;
  if (!r) return false;
  return haversineKm(r.center, coord) <= r.radiusKm;
}
