/**
 * community.mjs의 타입 선언(WP2 소유). 테스트가 '../server/community.mjs'를 확장자까지 적어 import할 때 쓴다.
 */
type Awaitable<T> = T | Promise<T>;

export const KINDS: readonly ['photo', 'diary'];
export const TITLE_MAX: number;
export const BODY_MAX: number;
export const PHOTOS_MAX: number;
export const PHOTO_BYTES_MAX: number;
export const PAGE_DEFAULT: number;
export const PAGE_MAX: number;
export const RATE_LIMIT: number;
export const RATE_WINDOW_MS: number;
export const EDIT_LIMIT: number;
export const POST_BODY_MAX: number;
export const TAGS_MAX: number;
export const TAG_LEN_MAX: number;

export interface StoredPhoto {
  id: string;
  mime: string;
  bytes: Buffer;
}

export interface StoredPost {
  id: string;
  accountId: string;
  userId: string;
  nickname: string;
  kind: 'photo' | 'diary';
  title: string;
  body: string;
  /** 맞춘 태그(normalizeTag). 없으면 [] */
  tags: string[];
  createdAt: number;
  /** 고친 시각(ms). 고친 적이 없으면 없음(null) */
  editedAt?: number | null;
  /** 조회수·좋아요 수(2026-10-17) */
  views?: number;
  likes?: number;
  photos: { id: string; mime: string; bytes?: Buffer }[];
}

/** 고치기: 보낸 순서대로의 사진(bytes가 있으면 새 사진, 없으면 남기는 예전 사진) */
export interface PostPatch {
  kind: 'photo' | 'diary';
  title: string;
  body: string;
  tags: string[];
  editedAt: number;
  photos: { id: string; mime: string; bytes?: Buffer }[];
}

/** 메모리와 PostgreSQL 저장소가 같이 따르는 모양 */
export interface CommunityStore {
  readonly kind: 'memory' | 'postgres';
  insertPost(rec: Omit<StoredPost, 'photos'> & { photos: StoredPhoto[] }): Awaitable<void>;
  getPost(id: string): Awaitable<StoredPost | null>;
  /** 본인 글이 아니거나 없으면 null. 빠진 사진은 지운다 */
  updatePost(id: string, accountId: string, patch: PostPatch): Awaitable<StoredPost | null>;
  list(q: { before: { createdAt: number; id: string } | null; limit: number; kind: string | null; tag?: string | null; q?: string | null }): Awaitable<StoredPost[]>;
  /** 이 계정이 좋아요를 누른 글 id들(ids 중에서) */
  likedSet(accountId: string, ids: string[]): Awaitable<Set<string>>;
  /** 좋아요 켜기·끄기(계정당 한 번). 없는 글이면 null */
  setLike(id: string, accountId: string, on: boolean): Awaitable<StoredPost | null>;
  /** 같은 보는 사람은 하루 한 번만 센다. 돌려주는 값은 조회수, 없는 글이면 null */
  countView(id: string, viewerKey: string, day: string): Awaitable<number | null>;
  removePost(id: string, accountId: string): Awaitable<boolean>;
  removeByAccount(accountId: string): Awaitable<number>;
  photo(id: string): Awaitable<{ mime: string; bytes: Buffer } | null>;
  countSince(accountId: string, since: number): Awaitable<number>;
  reset(): Awaitable<void>;
}

export function sniffImage(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null;
export function normalizeTag(raw: unknown): string | null;
export const SEARCH_MAX: number;
/** 검색어 맞추기. 비면 null, 너무 길면 'long' */
export function normalizeSearch(raw: unknown): string | 'long' | null;
export function searchTagPart(q: string): string | null;
export function matchesSearch(post: { title: string; tags: string[] }, q: string): boolean;
export function parseTags(raw: unknown): { error: string; detail: string } | { tags: string[] };
export function parsePostInput(
  body: unknown,
): { error: string; detail: string } | { kind: 'photo' | 'diary'; title: string; body: string; tags: string[]; photos: StoredPhoto[] };
export function parsePostUpdate(
  body: unknown,
  existing: readonly { id: string; mime: string }[],
): { error: string; detail: string } | { kind: 'photo' | 'diary'; title: string; body: string; tags: string[]; photos: { id: string; mime: string; bytes?: Buffer }[] };
export function parseCursor(raw: unknown): { createdAt: number; id: string } | null;
export function createMemoryCommunityStore(): CommunityStore;
export function parseHiddenIds(raw: string | undefined): Set<string>;
export function withHiddenPosts(store: CommunityStore, hidden: Set<string> | undefined): CommunityStore;

export interface CommunityService {
  handle(req: {
    method: string | undefined;
    path: string;
    url: URL;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    ip?: string;
  }): Promise<{ status: number; body?: unknown; raw?: { mime: string; bytes: Buffer } }>;
  reset(): Promise<void>;
  removeByAccount(accountId: string): Promise<number>;
}

export function createCommunityService(opts?: {
  store?: CommunityStore;
  authenticate?: (headers: Record<string, string | string[] | undefined>) => Promise<{ account: { accountId: string; userId: string; nickname: string | null } } | null>;
  now?: () => number;
  log?: (message: string) => void;
}): CommunityService;
export function isCommunityPath(pathname: string): boolean;
