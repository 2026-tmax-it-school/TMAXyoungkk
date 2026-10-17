/**
 * itineraries.mjs의 타입 선언(WP2 소유). 테스트가 '../server/itineraries.mjs'를 확장자까지 적어 import할 때 쓴다.
 */
export const TITLE_MAX: number;
export const NOTE_MAX: number;
export const DAYS_MAX: number;
export const PLACES_PER_DAY_MAX: number;
export const SEARCH_MAX: number;
export const RATE_LIMIT: number;
export const RATE_WINDOW_MS: number;
export const BODY_MAX: number;
export const SORTS: readonly ['popular', 'new', 'views'];

export interface StoredItinerary {
  id: string;
  accountId: string;
  userId: string;
  nickname: string;
  title: string;
  regionId: string;
  regionLabel: string;
  note: string;
  tags: string[];
  dayCount: number;
  placeCount: number;
  plan: { days: unknown[]; base: unknown };
  views: number;
  likes: number;
  imports: number;
  createdAt: number;
}

export interface ItineraryStore {
  readonly kind: 'memory' | 'postgres';
  insert(rec: Omit<StoredItinerary, 'views' | 'likes' | 'imports'>): Promise<void>;
  get(id: string): Promise<StoredItinerary | null>;
  list(q: { sort: string; q: string | null; region: string | null; tag: string | null; offset: number; limit: number }): Promise<StoredItinerary[]>;
  likedSet(accountId: string, ids: string[]): Promise<Set<string>>;
  setLike(id: string, accountId: string, on: boolean): Promise<StoredItinerary | null>;
  countView(id: string, viewerKey: string, day: string): Promise<StoredItinerary | null>;
  countImport(id: string): Promise<StoredItinerary | null>;
  remove(id: string, accountId: string): Promise<boolean>;
  removeByAccount(accountId: string): Promise<number>;
  countSince(accountId: string, since: number): Promise<number>;
  reset(): Promise<void>;
}

export function popularity(it: { imports: number; likes: number; views: number }): number;
export function parseItineraryInput(body: unknown): Record<string, any>;
export function normalizeQuery(raw: unknown): string | null;
export function matches(rec: { title: string; regionLabel: string; tags: string[] }, q: string): boolean;
export function createMemoryItineraryStore(): ItineraryStore;
export function createItineraryService(opts?: Record<string, unknown>): {
  handle(req: Record<string, unknown>): Promise<{ status: number; body: any }>;
  reset(): Promise<void>;
  removeByAccount(accountId: string): Promise<number>;
};
export function isItineraryPath(pathname: string): boolean;
