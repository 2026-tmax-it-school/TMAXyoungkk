import {
  AI_PROXY_URL,
  API_URL,
  AUTH_URL,
  GOOGLE_MAPS_API_KEY,
  HAS_KAKAO_KEY,
  KAKAO_KEY_IGNORED,
  KAKAO_REST_KEY,
  MAP_PROVIDER,
  ROAD_SHAPES,
  roadShapeSource,
  SYNC_URL,
} from '../config';
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
import { isClockOverridden, liveClock, systemClock } from './clock';
import { createDiaryWriter } from './diary';
import { createExtractionProvider } from './extraction';
import { asyncStorageKV } from './kv';
import { createDeviceLocation } from './location';
import { createDevicePhotoProvider } from './photos';
import { createPlaceProvider } from './places';
import { createKakaoPlaces } from './places/kakao';
import { createLocalPlaces } from './places/local';
import { hasher, ids, secureRng } from './random';
import { createRecommendProvider } from './recommend';
import { createRouteProvider, OSM_ATTRIBUTION, OSRM_CAR_TIME_FACTOR } from './routes';
import { createSyncTransport } from './sync';

/**
 * 서비스 레지스트리(계약 A5). 화면·스토어는 여기서만 제공자를 얻는다. 어느 구현인지 알 필요가 없다.
 *
 * 선택 규칙
 * - EXPO_PUBLIC_API_URL이 있으면 장소·경로가 키 없이 키 숨기는 서버를 거쳐 카카오(자동차만 실제, 도보·대중교통은 로컬 모델)다.
 *   서버·카카오를 못 쓰면(서버에 카카오 키 없음, 닿지 못함, 시간 초과 등) 장소는 로컬 장소 사전, 자동차는 도로 모양 · 로컬 모델로
 *   넘어가고 그 결과는 캐시에 두지 않는다. 그동안 제공자 id는 'local'이다(마지막 응답 출처. 화면의 예시 데이터 표시와 아래 상태).
 *   서버 경유 장소는 카카오 어댑터에 로컬 장소 사전을 대체로 붙여 여기서 만든다(places 팩토리는 직접 키만 받는다).
 * - 아니고 EXPO_PUBLIC_KAKAO_REST_KEY가 있으면 장소·경로가 앱에서 바로 카카오(시연 한정, 키가 번들에 들어간다). 없으면 로컬.
 *   구글은 바탕 지도로만 쓴다(EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, components/map). 장소·경로 제공자에는 없다.
 *   구글 길찾기가 국내 도보·자동차 경로를 주지 않아서다. 프로토타입 가정 · 국내 SDK 선정 미결정.
 * - 도보·자동차 선 모양과 시간은 기본으로 OpenStreetMap 경로 서버(OSRM)에서 받는다(키 불필요). 시연 구간은 예시 구간표가
 *   우선이고, 자동차는 카카오가 있으면 카카오가 먼저다. 경로 캐시는 실제 시계(systemClock)로 24시간 둔다.
 *   EXPO_PUBLIC_API_URL이 있으면 그 서버의 /osrm을 거친다. EXPO_PUBLIC_ROAD_SHAPE=off면 두 점 직선이다.
 * - EXPO_PUBLIC_AI_PROXY_URL이 있으면 추출·추천·일기가 AI 프록시, 없으면 규칙·로컬·템플릿.
 * - EXPO_PUBLIC_SYNC_URL이 있으면 동기화가 HTTP 폴링, 없으면 루프백.
 * - 계정은 EXPO_PUBLIC_API_URL(없으면 EXPO_PUBLIC_SYNC_URL)의 서버 /auth를 쓴다(config AUTH_URL). 둘 다 없으면 이 기기 모의 인증.
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

/** 키 숨기는 서버(EXPO_PUBLIC_API_URL)를 거치는 제공자. describeServices가 본다(덮어쓴 제공자는 여기 없다) */
const viaServer = new WeakSet<object>();

function build(): Services {
  const kv = kvFor('app');
  const kakaoKey = HAS_KAKAO_KEY ? KAKAO_REST_KEY : undefined;
  const apiUrl = API_URL || undefined;
  const aiProxyUrl = AI_PROXY_URL || undefined;
  const places = apiUrl
    ? createKakaoPlaces({ apiUrl, fetch: appFetch, fallback: createLocalPlaces() })
    : createPlaceProvider({ kakaoKey, fetch: appFetch });
  // 경로 캐시 24시간은 실제 시각으로 잰다(시뮬레이터 가상 시각이면 300배속에서 몇 분 만에 지나고, 시연을 되돌리면 미래 항목이 남는다)
  const routes = createRouteProvider({ kakaoKey, apiUrl, fetch: appFetch, clock: systemClock, kv: kvFor('routes'), roadShapes: ROAD_SHAPES, netClock: systemClock });
  if (apiUrl) {
    viaServer.add(places);
    viaServer.add(routes);
  }
  return {
    places,
    routes,
    extraction: createExtractionProvider({ aiProxyUrl, fetch: appFetch }),
    recommend: createRecommendProvider({ aiProxyUrl, fetch: appFetch, places }),
    diary: createDiaryWriter({ aiProxyUrl, fetch: appFetch }),
    auth: createAuthProvider({
      clock: liveClock,
      rng: secureRng,
      hasher,
      kv: kvFor('auth'),
      serverUrl: AUTH_URL || undefined,
      fetch: appFetch,
    }),
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
  /** 외부 제공자를 어디서 부르는지. server면 키 숨기는 서버를 거치고(키는 서버에만), app이면 앱이 바로 부른다 */
  via?: 'server' | 'app';
  /** 경로 줄만: 도보·자동차 시간과 선을 실제 길(OSRM)에서 받는지. 카카오가 대체로 떨어져 mode가 mock이어도 참일 수 있다 */
  road?: boolean;
  /** 장소 줄만: 서버 경유인데 앱 .env에 카카오 키가 남아 번들에 들어가는지(KAKAO_KEY_IGNORED) */
  appKeyInBundle?: boolean;
}

const KAKAO_NOTE = '프로토타입 가정 · 국내 SDK 선정 미결정 · 키가 번들에 들어가므로 시연 한정';
/** 서버 경유 카카오. 앱 .env에 직접 호출 키가 남아 있으면 쓰지 않아도 번들에 들어가므로 그렇게 적는다 */
const KAKAO_SERVER_NOTE = KAKAO_KEY_IGNORED
  ? '프로토타입 가정 · 국내 SDK 선정 미결정 · 앱 .env의 카카오 키는 쓰지 않지만 번들에 들어감(비워 두기)'
  : '프로토타입 가정 · 국내 SDK 선정 미결정 · 키는 서버에만';

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
  if (viaServer.has(s.places)) {
    // 서버 경유의 id는 마지막 응답 출처다. 서버가 카카오를 못 쓰면(키 없음·실패) 'local'이다
    out.push(
      s.places.id === 'kakao'
        ? {
            key: 'places',
            label: '장소 검색 · 카카오 로컬 · 서버 경유',
            mode: 'real',
            note: KAKAO_SERVER_NOTE,
            via: 'server',
            appKeyInBundle: KAKAO_KEY_IGNORED,
          }
        : {
            key: 'places',
            label: '장소 검색 · 로컬 장소 사전 · 서버 경유',
            mode: 'mock',
            note: '서버가 카카오를 못 써서(키 없음·실패) 예시 데이터 · 다시 되면 카카오',
            via: 'server',
          },
    );
  } else if (s.places.id === 'kakao') {
    out.push({ key: 'places', label: '장소 검색 · 카카오 로컬', mode: 'real', note: KAKAO_NOTE, via: 'app' });
  } else {
    out.push({ key: 'places', label: '장소 검색 · 로컬 장소 사전', mode: 'mock', note: '예시 데이터' });
  }
  const road = roadShapeSource(ROAD_SHAPES, API_URL);
  const roadWhere = road === 'server' ? ', 서버 경유' : road === 'custom' ? ', 지정한 경로 서버' : '';
  if (s.routes.id === 'kakao') {
    const server = viaServer.has(s.routes);
    out.push({
      key: 'routes',
      label: server ? '경로 · 카카오모빌리티 자동차 · 서버 경유' : '경로 · 카카오모빌리티 자동차',
      mode: 'real',
      note: [
        road
          ? `도보 시간과 선은 실제 길(${OSM_ATTRIBUTION}${roadWhere}) · 대중교통은 모의 모델 추정`
          : '도보·대중교통은 로컬 모델 추정',
        server ? KAKAO_SERVER_NOTE : KAKAO_NOTE,
      ].join(' · '),
      via: server ? 'server' : 'app',
      road: !!road,
    });
  } else if (viaServer.has(s.routes)) {
    // 서버 경유인데 마지막 자동차 응답이 대체였다(서버가 카카오를 못 씀)
    out.push({
      key: 'routes',
      label: '경로 · 로컬 모델 추정 · 서버 경유',
      mode: 'mock',
      note: road
        ? `서버가 카카오를 못 써서(키 없음·실패) 자동차는 실제 길 시간에 교통 보정 ${OSRM_CAR_TIME_FACTOR}배 · 다시 되면 카카오 · 도보 시간과 선은 실제 길(${OSM_ATTRIBUTION}${roadWhere})`
        : '서버가 카카오를 못 써서(키 없음·실패) 자동차도 예시 데이터 추정 · 다시 되면 카카오',
      via: 'server',
      road: !!road,
    });
  } else if (road) {
    out.push({
      key: 'routes',
      label: '경로 · 실제 길 OpenStreetMap',
      mode: 'real',
      note: `도보·자동차 시간과 선은 실제 길(${OSM_ATTRIBUTION}) · 자동차는 교통 보정 ${OSRM_CAR_TIME_FACTOR}배 · 시연 구간은 예시 구간표 · 대중교통은 모의 모델 추정 · ${
        road === 'server' ? '서버 경유(서버가 24시간 캐시)' : road === 'custom' ? '지정한 경로 서버' : '공개 서버라 시연 한정'
      }`,
      via: road === 'server' ? 'server' : 'app',
      road: true,
    });
  } else {
    out.push({ key: 'routes', label: '경로 · 직선거리 추정', mode: 'mock', note: '예시 데이터', road: false });
  }
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
  out.push(
    s.auth.id === 'server'
      ? { key: 'auth', label: '계정 · 계정 서버', mode: 'real', note: '메일 발송 없음(개발 서버 보낸편지함) · 세션 토큰은 앱 저장소', via: 'server' }
      : { key: 'auth', label: '계정 · 모의 인증', mode: 'mock', note: '프로토타입 · 단말 저장' },
  );
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
