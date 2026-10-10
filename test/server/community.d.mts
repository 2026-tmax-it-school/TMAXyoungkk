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
export const POST_BODY_MAX: number;

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
  createdAt: number;
  photos: { id: string; mime: string; bytes?: Buffer }[];
}

/** 메모리와 PostgreSQL 저장소가 같이 따르는 모양 */
export interface CommunityStore {
  readonly kind: 'memory' | 'postgres';
  insertPost(rec: Omit<StoredPost, 'photos'> & { photos: StoredPhoto[] }): Awaitable<void>;
  list(q: { before: { createdAt: number; id: string } | null; limit: number; kind: string | null }): Awaitable<StoredPost[]>;
  removePost(id: string, accountId: string): Awaitable<boolean>;
  removeByAccount(accountId: string): Awaitable<number>;
  photo(id: string): Awaitable<{ mime: string; bytes: Buffer } | null>;
  countSince(accountId: string, since: number): Awaitable<number>;
  reset(): Awaitable<void>;
}

export function sniffImage(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null;
export function parsePostInput(body: unknown): { error: string; detail: string } | { kind: 'photo' | 'diary'; title: string; body: string; photos: StoredPhoto[] };
export function parseCursor(raw: unknown): { createdAt: number; id: string } | null;
export function createMemoryCommunityStore(): CommunityStore;

export interface CommunityService {
  handle(req: {
    method: string | undefined;
    path: string;
    url: URL;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
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
