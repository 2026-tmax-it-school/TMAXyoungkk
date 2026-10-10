/**
 * 도메인 타입. 기능명세서 v0.2의 용어 정의를 그대로 따른다.
 * 용어: 여행방 / 그룹방 / 게스트 / 스팟 / 후보 / 확정 스팟 / 제외 스팟 / 고정 / 제안자 / 기점 / 수용량 / 조정안
 *
 * 이 파일은 동결 계약이다(02 설계 리뷰 A2·A3). 기반 작업과 통합 담당만 고친다.
 * 패키지가 새 필드가 필요하면 기존 필드 안에서 표현하고, 안 되면 최종 보고의 변경 요청에 적는다.
 *
 * 시각은 ms(appClock().now())다. 날짜는 KST 'YYYY-MM-DD', 시각은 'HH:MM'이다.
 */

export type Category = '식당' | '카페' | '관광지' | '쇼핑' | '공원' | '기타';

/** FR-504. 1단계는 도보와 자동차, 대중교통은 2차 확장이다. */
export type Transport = 'car' | 'walk' | 'transit';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** src/data/regions.ts의 지역 id. 국내 목록에서만 고른다(FR-201). */
export type RegionId = string;

/** 'HH:MM'. closedWeekdays는 0=일요일. 예시 데이터다. */
export interface OpeningHours {
  open: string;
  close: string;
  closedWeekdays?: number[];
}

/** 장소 제공자가 돌려주는 장소. placeId는 제공자 안에서 유일하다. */
export interface Place {
  placeId: string;
  name: string;
  coord: LatLng;
  category: Category;
  /** 표시용 세부 종류. 예: '거리', '전시', '산책', '숙소' */
  kind?: string;
  address?: string;
  hours?: OpeningHours;
  /** FR-404 추천 입력. 맛집·자연·액티비티·휴식·역사·카페 */
  tags?: string[];
  /** FR-404 대체 추천용 인기도. 0~100 */
  popularity?: number;
}

/** 제안 한 건. 같은 사람이 여러 번 말해도 제안자 수는 한 명이다(spotUtil.proposerIds). */
export interface Proposal {
  memberId: string;
  source: 'chat' | 'manual';
  messageId?: string;
  at: number;
}

/** 필드별 나중 저장 우선(LWW) 대상. edited 맵의 키다. */
export type SpotField =
  | 'pinned'
  | 'stayMin'
  | 'fixedDate'
  | 'manualOrder'
  | 'arriveOverride'
  | 'removedByUser';

/** 후보. 확정/제외는 계산 결과(Plan)이지 후보의 속성이 아니다(FR-403). */
export interface Spot {
  id: string;
  placeId: string;
  name: string;
  category: Category;
  kind?: string;
  coord: LatLng;
  address?: string;
  hours?: OpeningHours;
  /** FR-402. 같은 장소는 하나로 합치고 제안만 누적한다. */
  proposals: Proposal[];
  /** 고정. 자동 제외 대상에서 빠진다. */
  pinned: boolean;
  /** 체류 시간(분). 기본값은 카테고리에서 온다. 사용자 값이 우선이다. */
  stayMin: number;
  createdAt: number;
  /** 채팅에서 뽑은 경우 원문. FR-803에서 보여준다. */
  sourceText?: string;
  sourceMessageId?: string;
  /** 사용자가 날짜를 직접 지정하면 고정 취급한다(FR-505). */
  fixedDate?: string;
  /** 사용자가 직접 뺀 후보(또는 지연 조정안으로 뺀 후보). 자동 제외와 구분한다. */
  removedByUser?: boolean;
  removedReason?: 'user' | 'delay';
  /** 목적지 밖이지만 수동 등록에서 확인 후 담은 후보(FR-202). */
  outsideRegion?: boolean;
  /** FR-503 수동 순서. 그날 안에서의 자리다. */
  manualOrder?: { date: string; index: number };
  /** FR-503 도착 시각 직접 지정 'HH:MM'. */
  arriveOverride?: string;
  /** 필드별 마지막 편집 op.at. patchSpot이 갱신한다. */
  edited: Partial<Record<SpotField, number>>;
}

export type Role = 'host' | 'member';

export interface Member {
  /** 여행방 안의 멤버 id. op.actorId가 이 값이다. */
  id: string;
  /** 사람(게스트 또는 계정)의 id. 승격해도 바뀌지 않는다. */
  userId: string;
  nickname: string;
  role: Role;
  isGuest: boolean;
  /** FR-303 초대 권한(프로토타입 가정). 기본 false. */
  canInvite: boolean;
  joinedAt: number;
  leftAt?: number;
  leftReason?: 'left' | 'removed' | 'deleted';
  /** 계정 탈퇴로 익명 처리됨. 닉네임은 '탈퇴한 멤버'. */
  anonymized?: boolean;
}

/** 동명 장소가 여러 곳이라 사용자가 골라야 하는 추출 결과(FR-401). */
export interface AmbiguousPick {
  phrase: string;
  options: Place[];
  /** 고른 placeId 또는 'dismissed' */
  resolved?: string | 'dismissed';
}

/** 말풍선 안 장소 강조 구간. start·end는 원문 text의 문자 위치다. */
export interface ChatHighlight {
  start: number;
  end: number;
  placeId: string;
}

export interface ChatExtraction {
  createdSpotIds: string[];
  mergedSpotIds: string[];
  ambiguous: AmbiguousPick[];
  highlights: ChatHighlight[];
}

export interface ChatMessage {
  id: string;
  memberId: string;
  text: string;
  sentAt: number;
  /** 동기화 서버가 매긴 순번. 없으면 아직 전송 대기다. */
  seq?: number;
  status: 'pending' | 'sent';
  extraction?: ChatExtraction;
}

export interface DayBase {
  name: string;
  coord: LatLng;
  placeId?: string;
}

export type DayField = 'base' | 'noReturn' | 'dayStart' | 'dayEnd' | 'transport';

/**
 * 날짜별 설정(FR-205).
 * base: DayBase면 지정, null이면 그날 첫 스팟을 기점으로, 'inherit'이면 직전 날짜 승계.
 * 첫날의 'inherit'는 null과 같다.
 */
export interface DaySetting {
  date: string;
  base: DayBase | null | 'inherit';
  noReturn: boolean;
  dayStart?: string;
  dayEnd?: string;
  /** 하루 전체 이동수단. 없으면 Trip.transport. schedule/setDayTransport만 바꾼다. */
  transport?: Transport;
  edited?: Partial<Record<DayField, number>>;
}

/**
 * 구간별 이동수단(FR-504). fromId/toId는 spotId 또는 'base'.
 * at은 이 구간의 마지막 편집 op.at(LWW), cleared는 해제 묘비다(늦게 온 예전 지정이 나중 해제를 이기지 못하게).
 * cleared면 transport는 해제 전 값이고 계산에 쓰지 않는다. 읽는 쪽은 core/ops/schedule의 liveLegs()를 쓴다.
 */
export interface LegOverride {
  date: string;
  fromId: string;
  toId: string;
  transport: Transport;
  at?: number;
  cleared?: boolean;
}

export interface Invite {
  code: string;
  issuedAt: number;
  expiresAt: number;
  capacity: number;
  revokedAt?: number;
}

/**
 * 사진(FR-701). uri에는 기기 파일 경로만 넣는다. blob:·data:는 넣지 않는다.
 * 모의 사진은 sim 메타로 SVG 타일을 그린다. 웹 기기 사진은 sessionOnly다.
 */
export interface Photo {
  id: string;
  memberId: string;
  uri?: string;
  sim?: { label: string; tone: number };
  sessionOnly?: boolean;
  bytes: number;
  originalBytes: number;
  compressed: boolean;
  takenAt: number;
  coord?: LatLng;
  source: 'exif' | 'estimated';
  spotId?: string;
  uploadedAt: number;
}

/** 방문 기록(FR-602·704). 같은 id는 at이 늦은 쪽이 남는다. */
export interface Visit {
  id: string;
  spotId: string;
  date: string;
  memberId: string;
  arrivedAt?: number;
  status: 'arrived' | 'skipped' | 'cancelled';
  source: 'gps' | 'manual' | 'sim';
  at: number;
}

export interface DiaryBlock {
  id: string;
  /** 'HH:MM' */
  time: string;
  spotId?: string;
  placeName: string;
  photoIds: string[];
  text: string;
  editedAt?: number;
  editedBy?: string;
}

export interface DiaryEntry {
  date: string;
  status: 'auto' | 'empty';
  blocks: DiaryBlock[];
  generatedAt: number;
  sharedAt?: number;
}

export interface Trip {
  id: string;
  title: string;
  region: RegionId;
  startDate: string;
  endDate: string;
  /** 여행방 기본 이동수단 */
  transport: Transport;
  /** 'HH:MM'. 하루 기본 활동시간. 날짜별 값이 있으면 그것이 우선이다. */
  dayStart: string;
  dayEnd: string;
  /** 표지 이미지(여행방을 알아보게). 줄인 JPEG 등 base64. 없으면 지역 이름 표지 */
  cover?: TripCover;
  days: DaySetting[];
  legs: LegOverride[];
  members: Member[];
  spots: Spot[];
  messages: ChatMessage[];
  invite?: Invite;
  photos: Photo[];
  visits: Visit[];
  /** 날짜('YYYY-MM-DD')별 일기 */
  diaries: Record<string, DiaryEntry>;
  createdAt: number;
  /** 방장의 userId */
  createdBy: string;
  deletedAt?: number;
  /** 이 문서에 반영된 가장 큰 op.seq. applyOp가 올린다. */
  lastSeq: number;
}

export interface ItemNotice {
  kind: 'outsideHours' | 'estimated' | 'fallbackTransport' | 'noRoute' | 'overrideLate';
  text: string;
}

export interface TimetableItem {
  spotId: string;
  name: string;
  /** 직전 지점에서 이 스팟까지 이동 시간(분) */
  travelMin: number;
  legTransport: Transport;
  legEstimated: boolean;
  /** 'HH:MM' */
  arrive: string;
  depart: string;
  stayMin: number;
  pinned: boolean;
  proposerCount: number;
  /** 수동 순서나 도착 시각 지정이 걸린 항목 */
  manual: boolean;
  notices: ItemNotice[];
}

export interface DayPlan {
  date: string;
  base: DayBase | null;
  baseSource: 'set' | 'inherited' | 'firstSpot';
  noReturn: boolean;
  /** 자정부터의 분 */
  startMin: number;
  endLimitMin: number;
  items: TimetableItem[];
  /** 마지막 스팟에서 기점으로 돌아오는 시간(분). 복귀 없음이면 0 */
  returnMin: number;
  usedMin: number;
  capacityMin: number;
  overMin: number;
  /** 활동시간을 넘겨 다음 날 이월을 제안하는 spotId */
  carryOver: string[];
  orderMethod: 'exact' | 'approx' | 'manual';
  /** 복귀 구간(마지막 스팟 → 기점)의 실제 수단·추정·안내. 복귀 없음이거나 예전 계획이면 없다 */
  returnLeg?: ReturnLeg;
}

/** 복귀 구간 값(FR-502). 09 복귀 줄과 12 복귀 구간 대체 안내가 쓴다. */
export interface ReturnLeg {
  transport: Transport;
  estimated: boolean;
  notices: ItemNotice[];
}

export type ExcludeReasonCode = 'dayFull' | 'tooFar' | 'userRemoved' | 'outOfPeriod';

/** 제외 스팟. 조용한 제외는 없다(비기능 요구사항: 제외 이유 100% 표시). */
export interface ExcludedSpot {
  spotId: string;
  name: string;
  reasonCode: ExcludeReasonCode;
  reason: string;
  nearestDate?: string;
  proposerCount: number;
}

export interface PlanStep {
  key: 'locate' | 'matrix' | 'allocate' | 'reasons';
  label: string;
  done: number;
  total: number;
  ms: number;
}

export interface Plan {
  tripId: string;
  days: DayPlan[];
  excluded: ExcludedSpot[];
  /** 고정만으로 수용량을 넘긴 날짜와 초과분(분). 사용자가 직접 뺀다(FR-403). */
  overCapacity: { date: string; overMin: number }[];
  computedAt: number;
  /** 캐시에서 나오지 않은 구간 수(비기능 요구사항: 재계산 1회당 100 이하) */
  routeCalls: number;
  cacheHits: number;
  /** 직선거리로 때운 구간이 있는지 */
  estimated: boolean;
  steps: PlanStep[];
}

/** 조정안 하나. 누르면 ops를 dispatchMany로 적용한다. */
export interface Adjustment {
  id: string;
  kind: 'reorder' | 'shortenStay' | 'moveToDate' | 'exclude';
  label: string;
  savedMin: number;
  ops: OpDraft[];
}

/** previewOps 결과. 문서를 바꾸지 않고 바뀔 결과만 알려준다. */
export interface PlanDiff {
  newlyExcluded: string[];
  newlyConfirmed: string[];
  dayDelta: { date: string; usedMinDelta: number; overMin: number }[];
}

export type NotifyKind = 'delay' | 'freeTime' | 'arrival' | 'sessionExpiry';
export type NotifyPrefs = Record<NotifyKind, boolean>;
export interface NotifyLogEntry {
  kind: NotifyKind;
  key: string;
  at: number;
}

export interface GpsSample {
  t: number;
  coord: LatLng;
  /** 미터. 웹에서는 null일 수 있다. */
  accuracyM: number | null;
}
export type TrackPoint = GpsSample & { source: 'sim' | 'device' };

export type SimPresetId =
  | 'normal'
  | 'delay25'
  | 'closed'
  | 'gpsShadow'
  | 'passBy'
  | 'nextDoor'
  | 'denied'
  | 'freeTime'
  | 'full1018';

export interface ArrivalState {
  spotId?: string;
  enteredAt?: number;
  visitId?: string;
}

export interface LiveProposal {
  id: string;
  createdAt: number;
  delayMin: number;
  adjustments: Adjustment[];
}

export interface FreeTime {
  /** 다음 일정 시작 시각(ms) */
  until: number;
  places: Place[];
}

/** FR-105 게스트 세션과 2차 계정 세션. 둘 다 30일, 사용할 때마다 갱신. */
export interface Session {
  userId: string;
  /** 128비트 base64url. 화면에는 끝 4자리만 보인다. */
  deviceToken: string;
  nickname: string;
  kind: 'guest' | 'account';
  accountId?: string;
  email?: string;
  issuedAt: number;
  expiresAt: number;
}

/* ------------------------------------------------------------------ */
/* Op (A3). OpBody 유니온 전체는 여기에만 있고 동결한다.               */
/* ------------------------------------------------------------------ */

/** 여행방 표지 이미지. 크기·형식 규칙은 core/trip/cover */
export interface TripCover {
  mime: string;
  /** base64(머리 'data:' 없이) */
  data: string;
}

/** cover: null이면 표지를 뺀다 */
export type TripPatch = Partial<
  Pick<Trip, 'title' | 'region' | 'startDate' | 'endDate' | 'transport' | 'dayStart' | 'dayEnd'>
> & { cover?: TripCover | null };
export type DayPatch = Partial<Pick<DaySetting, 'base' | 'noReturn' | 'dayStart' | 'dayEnd'>>;

export type OpBody =
  // ops/trip.ts (WP2)
  | { type: 'trip/create'; trip: Omit<Trip, 'lastSeq'> }
  | { type: 'trip/update'; patch: TripPatch }
  | { type: 'trip/setDay'; date: string; patch: DayPatch }
  | { type: 'trip/delete' }
  | { type: 'trip/issueInvite'; invite: Invite }
  | { type: 'trip/revokeInvite' }
  // ops/members.ts (WP2)
  | { type: 'member/join'; member: Member; inviteCode: string }
  | { type: 'member/leave'; memberId: string }
  | { type: 'member/remove'; memberId: string }
  | { type: 'member/setCanInvite'; memberId: string; canInvite: boolean }
  | { type: 'member/rename'; memberId: string; nickname: string }
  | { type: 'member/accountLinked'; userId: string }
  | { type: 'member/anonymize'; memberId: string }
  // ops/chat.ts (WP3)
  | { type: 'chat/send'; message: { id: string; text: string } }
  // ops/spots.ts (WP3)
  | {
      type: 'spot/extracted';
      messageId: string;
      created: Spot[];
      mergedSpotIds: string[];
      ambiguous: AmbiguousPick[];
      highlights: ChatHighlight[];
    }
  | {
      type: 'spot/resolveAmbiguous';
      messageId: string;
      phrase: string;
      spot: Spot | null;
      mergeIntoSpotId?: string;
    }
  | { type: 'spot/add'; spot: Spot }
  | { type: 'spot/undoExtraction'; messageId: string }
  | { type: 'spot/pin'; spotId: string; pinned: boolean }
  | { type: 'spot/remove'; spotId: string; reason?: 'user' | 'delay' }
  | { type: 'spot/restore'; spotId: string }
  | { type: 'spot/delete'; spotId: string }
  // ops/schedule.ts (WP4)
  | { type: 'schedule/reorder'; date: string; spotIds: string[] }
  | { type: 'schedule/setStay'; spotId: string; stayMin: number }
  | { type: 'schedule/setArrive'; spotId: string; arrive: string | null }
  | { type: 'schedule/setDate'; spotId: string; date: string | null }
  | { type: 'schedule/setDayTransport'; date: string; transport: Transport | null }
  | {
      type: 'schedule/setLegTransport';
      date: string;
      fromId: string;
      toId: string;
      transport: Transport | null;
    }
  // ops/journal.ts (WP6)
  | { type: 'journal/photoAdded'; photo: Photo }
  | { type: 'journal/photoRemoved'; photoId: string }
  | { type: 'journal/visit'; visit: Visit }
  | { type: 'journal/diaryGenerated'; entry: DiaryEntry }
  | { type: 'journal/diaryEdited'; date: string; blockId: string; text: string }
  | { type: 'journal/diaryShared'; date: string };

export interface OpMeta {
  id: string;
  tripId: string;
  /** 그 여행방의 memberId */
  actorId: string;
  at: number;
  /** 동기화 서버가 매긴 순번. 없으면 pending이다. */
  seq?: number;
}

export type Op = OpMeta & OpBody;
/** 스토어가 id·tripId·actorId·at을 채운다. */
export type OpDraft = OpBody;
export type OpType = Op['type'];
export type OpOf<T extends OpType> = OpMeta & Extract<OpBody, { type: T }>;
