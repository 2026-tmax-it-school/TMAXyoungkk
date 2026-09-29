import { AI_PROXY_URL, GOOGLE_MAPS_API_KEY, HAS_KAKAO_KEY, KAKAO_REST_KEY, MAP_PROVIDER, SYNC_URL } from '../config';
import { pickMapEngine } from '../core/map/engine';
import { SERVICE_KV_PREFIX, type ServiceKvArea } from '../core/constants';
import type {
  AuthProvider,
  Clock,
  DiaryWriter,
  ExtractionProvider,
  FetchLike,
  Hasher,
  IdGen,
  KV,
  LocationProvider,
  PhotoProvider,
  PlaceProvider,
  RecommendProvider,
  Rng,
  RouteProvider,
  SyncTransport,
} from '../core/ports';
import { createAuthProvider } from './auth';
import { isClockOverridden, liveClock } from './clock';
import { createDiaryWriter } from './diary';
import { createExtractionProvider } from './extraction';
import { asyncStorageKV } from './kv';
import { createDeviceLocation } from './location';
import { createDevicePhotoProvider } from './photos';
import { createPlaceProvider } from './places';
import { hasher, ids, secureRng } from './random';
import { createRecommendProvider } from './recommend';
import { createRouteProvider } from './routes';
import { createSyncTransport } from './sync';

/**
 * 서비스 레지스트리(계약 A5). 화면·스토어는 여기서만 제공자를 얻는다. 어느 구현인지 알 필요가 없다.
 *
 * 선택 규칙
 * - EXPO_PUBLIC_KAKAO_REST_KEY가 있으면 장소·경로가 카카오(자동차만 실제, 도보·대중교통은 로컬 모델). 없으면 로컬.
 *   구글은 바탕 지도로만 쓴다(EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, components/map). 장소·경로 제공자에는 없다.
 *   구글 길찾기가 국내 도보·자동차 경로를 주지 않아서다. 프로토타입 가정 · 국내 SDK 선정 미결정.
 * - EXPO_PUBLIC_AI_PROXY_URL이 있으면 추출·추천·일기가 AI 프록시, 없으면 규칙·로컬·템플릿.
 * - EXPO_PUBLIC_SYNC_URL이 있으면 동기화가 HTTP 폴링, 없으면 루프백.
 * - 위치·사진 기본은 기기. 여행 시뮬레이터가 overrideServices로 sim을 덮는다.
 *
 * 조립은 패키지 팩토리(services/<영역>/index.ts)가 맡고 여기서는 팩토리만 부른다.
 */

export interface Services {
  places: PlaceProvider;
  routes: RouteProvider;
  extraction: ExtractionProvider;
  recommend: RecommendProvider;
  diary: DiaryWriter;
  auth: AuthProvider;
  sync: SyncTransport;
  location: LocationProvider;
  photos: PhotoProvider;
  clock: Clock;
  ids: IdGen;
  rng: Rng;
  hasher: Hasher;
  kv: KV;
}

const appFetch: FetchLike = (url, init) => fetch(url, init);

/** 영역별 접두사 KV. 스토어 persist 키와도, 다른 영역과도 겹치지 않는다. */
function kvFor(area: ServiceKvArea): KV {
  return asyncStorageKV(`${SERVICE_KV_PREFIX}${area}/`);
}

function build(): Services {
  const kv = kvFor('app');
  const kakaoKey = HAS_KAKAO_KEY ? KAKAO_REST_KEY : undefined;
  const aiProxyUrl = AI_PROXY_URL || undefined;
  const places = createPlaceProvider({ kakaoKey, fetch: appFetch });
  return {
    places,
    routes: createRouteProvider({ kakaoKey, fetch: appFetch, clock: liveClock, kv: kvFor('routes') }),
    extraction: createExtractionProvider({ aiProxyUrl, fetch: appFetch }),
    recommend: createRecommendProvider({ aiProxyUrl, fetch: appFetch, places }),
    diary: createDiaryWriter({ aiProxyUrl, fetch: appFetch }),
    auth: createAuthProvider({ clock: liveClock, rng: secureRng, hasher, kv: kvFor('auth') }),
    sync: createSyncTransport({ syncUrl: SYNC_URL || undefined, fetch: appFetch, clock: liveClock, kv: kvFor('sync') }),
    location: createDeviceLocation(),
    photos: createDevicePhotoProvider(),
    clock: liveClock,
    ids,
    rng: secureRng,
    hasher,
    kv,
  };
}

let base: Services | undefined;
let overrides: { id: number; partial: Partial<Services> }[] = [];
let nextOverrideId = 1;

function baseServices(): Services {
  if (!base) base = build();
  return base;
}

export function getServices(): Services {
  let s = baseServices();
  for (const o of overrides) s = { ...s, ...o.partial };
  return s;
}

/** 일부 서비스를 덮는다(시뮬레이터, 테스트). 돌려받은 함수를 부르면 되돌린다. */
export function overrideServices(partial: Partial<Services>): () => void {
  const id = nextOverrideId;
  nextOverrideId += 1;
  overrides = [...overrides, { id, partial }];
  return () => {
    overrides = overrides.filter((o) => o.id !== id);
  };
}

export interface ServiceStatus {
  key: string;
  label: string;
  mode: 'mock' | 'real';
  note?: string;
}

const KAKAO_NOTE = '프로토타입 가정 · 국내 SDK 선정 미결정 · 키가 번들에 들어가므로 시연 한정';

/** 18 더보기 설정의 제공자 상태. 실제 구현 id를 보고 적는다(덮어쓴 것도 반영). */
export function describeServices(): ServiceStatus[] {
  const s = getServices();
  const out: ServiceStatus[] = [];
  if (pickMapEngine({ key: GOOGLE_MAPS_API_KEY, override: MAP_PROVIDER }) === 'google') {
    out.push({
      key: 'map',
      label: '지도 · 구글 지도',
      mode: 'real',
      note: '웹 월 1만 회 무료 · 앱 무제한 · 못 불러오면 기본 지도',
    });
  } else {
    out.push({ key: 'map', label: '지도 · 기본 지도', mode: 'mock', note: '구글 키를 넣으면 구글 지도' });
  }
  out.push(
    s.places.id === 'kakao'
      ? { key: 'places', label: '장소 검색 · 카카오 로컬', mode: 'real', note: KAKAO_NOTE }
      : { key: 'places', label: '장소 검색 · 로컬 장소 사전', mode: 'mock', note: '예시 데이터' },
  );
  out.push(
    s.routes.id === 'kakao'
      ? {
          key: 'routes',
          label: '경로 · 카카오모빌리티 자동차',
          mode: 'real',
          note: `도보·대중교통은 로컬 모델 추정 · ${KAKAO_NOTE}`,
        }
      : { key: 'routes', label: '경로 · 직선거리 추정', mode: 'mock', note: '예시 데이터' },
  );
  out.push(
    s.extraction.id === 'ai'
      ? { key: 'extraction', label: '대화 인식 · AI 프록시', mode: 'real' }
      : { key: 'extraction', label: '대화 인식 · 규칙 기반', mode: 'mock' },
  );
  out.push(
    s.recommend.id === 'ai'
      ? { key: 'recommend', label: '추천 · AI 프록시', mode: 'real' }
      : { key: 'recommend', label: '추천 · 로컬 점수', mode: 'mock' },
  );
  out.push(
    s.diary.id === 'ai'
      ? { key: 'diary', label: '일기 문장 · AI 프록시', mode: 'real' }
      : { key: 'diary', label: '일기 문장 · 템플릿', mode: 'mock' },
  );
  out.push({ key: 'auth', label: '계정 · 모의 인증', mode: 'mock', note: '프로토타입 · 단말 저장' });
  out.push(
    s.sync.id === 'http'
      ? { key: 'sync', label: '그룹 동기화 · HTTP 폴링 서버', mode: 'real' }
      : { key: 'sync', label: '그룹 동기화 · 이 기기 안 루프백', mode: 'mock' },
  );
  out.push(
    s.location.id === 'device'
      ? { key: 'location', label: '위치 · 기기 GPS', mode: 'real', note: '웹은 HTTPS에서만 동작' }
      : { key: 'location', label: '위치 · 여행 시뮬레이터', mode: 'mock', note: '실제 위치 아님' },
  );
  out.push(
    s.photos.id === 'device'
      ? { key: 'photos', label: '사진 · 기기 앨범', mode: 'real', note: '웹은 EXIF 없음 · 이 세션에서만 보임' }
      : { key: 'photos', label: '사진 · 모의 사진', mode: 'mock' },
  );
  out.push(
    isClockOverridden()
      ? { key: 'clock', label: '시각 · 여행 시뮬레이터 가상 시각', mode: 'mock' }
      : { key: 'clock', label: '시각 · 기기 시각', mode: 'real' },
  );
  return out;
}

/** 시연 리셋. 동기화 저장분·경로 캐시·모의 계정을 비우고 덮어쓴 서비스를 해제한다. */
export async function resetServices(): Promise<void> {
  const effective = getServices();
  const b = baseServices();
  const targets = {
    sync: new Set([effective.sync, b.sync]),
    routes: new Set([effective.routes, b.routes]),
    auth: new Set([effective.auth, b.auth]),
  };
  for (const s of targets.sync) await s.reset();
  for (const r of targets.routes) await r.clearCache();
  for (const a of targets.auth) await a.reset();
  overrides = [];
}
