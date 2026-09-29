import type {
  Category,
  GpsSample,
  LatLng,
  Op,
  Place,
  RegionId,
  Transport,
  Trip,
} from '../types';

/**
 * 중립 인터페이스(포트). 동결 계약 A4.
 *
 * 외부 의존(지도·경로·AI·위치·사진·인증·동기화)은 전부 이 뒤에 숨는다.
 * 기본은 로컬 모의 제공자이고, 키가 있으면 services/registry가 실제 제공자로 바꾼다.
 * 명세: 국내 전용, 지도 SDK 1종, 두 벌을 유지하지 않는다. 구글은 장소·경로 ProviderId에 없다.
 * 구글 지도는 바탕 지도로만 쓴다(components/map, 국내 도보·자동차 길찾기를 주지 않음).
 */

export interface Clock {
  now(): number;
}

export interface IdGen {
  next(prefix: string): string;
}

export interface Rng {
  bytes(n: number): Uint8Array;
}

export interface Hasher {
  /** 16진수 소문자 SHA-256 */
  sha256(text: string): Promise<string>;
}

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type ProviderId = 'local' | 'kakao' | 'naver';

export interface Region {
  id: RegionId;
  /** 짧은 이름. 예: '경주' */
  name: string;
  /** 긴 이름. 예: '경상북도 경주시' */
  label: string;
  center: LatLng;
  radiusKm: number;
}

/* ---------- 장소 ---------- */

export interface PlaceProvider {
  id: ProviderId;
  /** 동명 장소가 여러 건이면 그대로 여러 건을 돌려준다. 결과가 없으면 빈 배열. */
  search(query: string, region: Region, bias?: LatLng): Promise<Place[]>;
  nearby(
    coord: LatLng,
    radiusM: number,
    opts?: { excludePlaceIds?: string[]; limit?: number },
  ): Promise<Place[]>;
  /** 지도에서 누른 지점 근처의 장소(FR-202 지도 선택) */
  at(coord: LatLng, radiusM: number): Promise<Place | null>;
}

/* ---------- 경로 ---------- */

export interface TravelMatrix {
  /** minutes[i][j] = origins[i] → destinations[j] 이동 시간(분). null이면 그 수단 경로 없음 */
  minutes: (number | null)[][];
  /** 캐시에서 나오지 않은 구간 수. 비기능 요구사항의 호출 수는 이 값이다. */
  calls: number;
  cacheHits: number;
  /** 직선거리로 때운 값이 섞였는지 */
  estimated: boolean;
}

export interface RouteLeg {
  transport: Transport;
  minutes: number;
  meters: number;
  polyline: LatLng[];
  steps: { text: string; meters: number }[];
  note?: string;
  estimated: boolean;
}

export interface RouteProvider {
  id: ProviderId;
  matrix(origins: LatLng[], destinations: LatLng[], transport: Transport): Promise<TravelMatrix>;
  route(a: LatLng, b: LatLng, transport: Transport): Promise<RouteLeg | null>;
  clearCache(): Promise<void>;
}

/* ---------- 추출·추천·일기 ---------- */

export interface ExtractedPhrase {
  /** 원문 부분 문자열. 조사를 넣지 않는다. */
  phrase: string;
  start: number;
  end: number;
}

export interface ExtractionProvider {
  id: 'rules' | 'ai';
  phrases(text: string, ctx: { region: Region }): Promise<ExtractedPhrase[]>;
}

export interface RecommendRequest {
  region: Region;
  dates: string[];
  tags: string[];
  existing: Place[];
  limit: number;
  /** 추천 기준점. 확정 스팟 좌표(통합 때 추가). 없으면 지역 안 기존 후보, 그것도 없으면 지역 중심 */
  anchor?: LatLng[];
}

export interface RecommendResult {
  items: { place: Place; reason: string }[];
  /** 태그가 부족해 인기 장소로 대체했는지 */
  fallback: boolean;
  /** 결과를 만든 쪽. AI 프록시가 실패해 로컬 점수로 대체했으면 'local'(23 '예시 데이터' 칩) */
  source?: 'ai' | 'local';
}

export interface RecommendProvider {
  id: 'local' | 'ai';
  recommend(req: RecommendRequest): Promise<RecommendResult>;
}

export interface DiaryWriteBlock {
  time: string;
  placeName: string;
  category?: Category;
  photoCount: number;
  memberNames: string[];
}

export interface DiaryWriter {
  id: 'template' | 'ai';
  /** 블록마다 설명문 한 개. 실패하면 던진다(호출 쪽이 빈 일기로 대체). */
  write(input: { date: string; blocks: DiaryWriteBlock[] }): Promise<string[]>;
}

/* ---------- 계정 (2차) ---------- */

export interface Profile {
  nickname: string;
  imageUri?: string;
  imageBytes?: number;
  imageCompressed?: boolean;
  /** FR-104 성향 태그 → FR-404 입력 */
  tags: string[];
}

export type AuthProviderKind = 'email' | 'kakao' | 'google';

export interface AccountPublic {
  accountId: string;
  userId: string;
  email: string;
  nickname: string;
  verified: boolean;
  providers: AuthProviderKind[];
  profile: Profile;
}

export type AuthFail =
  | 'duplicateEmail'
  | 'weakPassword'
  | 'locked'
  | 'deviceLimited'
  | 'unverified'
  | 'badCredentials'
  | 'providerFailed'
  | 'linkRequired'
  | 'nicknameTaken'
  | 'invalidToken'
  | 'notFound';

export type AuthResult =
  | { ok: true; account: AccountPublic }
  | {
      ok: false;
      code: AuthFail;
      detail?: string;
      /** 잠금이 풀리는 시각(ms) */
      retryAt?: number;
      /** 동일 이메일 연동 확인용 토큰(FR-103) */
      linkToken?: string;
      /** 비밀번호 규칙 위반 항목(FR-101) */
      violations?: string[];
    };

export type AuthAck = { ok: true } | { ok: false; code: AuthFail; detail?: string };

/** 모의 메일함의 메일 한 통 */
export interface MockMail {
  id: string;
  to: string;
  subject: string;
  token: string;
  sentAt: number;
  /** 재발송으로 무효가 된 인증 메일 */
  invalidated: boolean;
}

export interface AuthProvider {
  signUp(input: {
    email: string;
    password: string;
    nickname: string;
    userId?: string;
  }): Promise<AuthResult>;
  resendVerification(email: string): Promise<AuthAck>;
  verifyEmail(token: string): Promise<AuthResult>;
  signIn(input: { email: string; password: string; deviceToken: string }): Promise<AuthResult>;
  social(input: {
    provider: 'kakao' | 'google';
    deviceToken: string;
    scenario: 'ok' | 'fail' | 'sameEmail';
    /** 17 연결: 지금 로그인한 계정 id. 있으면 이 계정에만 연결하고 다른 계정으로 바뀌지 않는다 */
    linkToAccountId?: string;
    /** sameEmail: 제공자가 돌려준 이메일(모의는 26에서 입력). 이 이메일과 같은 계정만 연결 대상이다 */
    providerEmail?: string;
  }): Promise<AuthResult>;
  confirmLink(input: { linkToken: string; accept: boolean }): Promise<AuthResult>;
  isNicknameTaken(nickname: string, exceptAccountId?: string): Promise<boolean>;
  updateProfile(accountId: string, profile: Partial<Profile>): Promise<AuthResult>;
  /** 계정 공개 정보 조회(17 연결된 제공자 표시). 없으면 notFound */
  getAccount(accountId: string): Promise<AuthResult>;
  deleteAccount(accountId: string): Promise<{ ok: true } | { ok: false; code: AuthFail }>;
  outbox(): Promise<MockMail[]>;
  reset(): Promise<void>;
}

/* ---------- 그룹 동기화 ---------- */

/**
 * 초대 조회. 에러에도 방을 찾았으면 tripId를 싣는다(이미 참여한 사람이 만료·정원 초과 코드로 들어와도
 * 로컬 문서와 맞춰 already로 보낼 수 있게, 04-코드리뷰-WP2 결정 D-2).
 */
export type InviteLookup =
  | { trip: Trip }
  | { error: 'notFound' | 'expired' | 'revoked' | 'full'; tripId?: string };

export interface SyncTransport {
  id: 'loopback' | 'http';
  /** 서버가 매긴 seq를 돌려준다. 같은 op.id는 한 번만 받는다. */
  push(ops: Op[]): Promise<{ opId: string; seq: number }[]>;
  pull(tripId: string, afterSeq: number): Promise<Op[]>;
  subscribe(tripId: string, onOps: (ops: Op[]) => void): () => void;
  online(): boolean;
  setOnline(v: boolean): void;
  lookupInvite(code: string): Promise<InviteLookup>;
  /** 시연 리셋. 저장한 op를 전부 지운다. */
  reset(): Promise<void>;
}

/* ---------- 위치 (2차) ---------- */

export type LocationPermission = 'granted' | 'denied' | 'undetermined';

export interface LocationProvider {
  id: 'sim' | 'device';
  permission(): Promise<LocationPermission>;
  request(): Promise<'granted' | 'denied'>;
  /** 반환값을 부르면 감시를 멈춘다. */
  watch(onSample: (s: GpsSample) => void, opts: { intervalMs: number }): () => void;
}

/* ---------- 사진 (3차) ---------- */

export interface PickedPhoto {
  uri: string;
  bytes: number;
  width: number;
  height: number;
  exif?: { takenAt?: number; coord?: LatLng };
  /** 웹 기기 사진. 저장하지 않고 이 세션에서만 보인다. */
  sessionOnly?: boolean;
  /** 모의 사진 타일 메타(Photo.sim으로 옮긴다) */
  sim?: { label: string; tone: number };
}

export interface PhotoProvider {
  id: 'sim' | 'device';
  pick(opts: { multiple: boolean }): Promise<PickedPhoto[]>;
}
