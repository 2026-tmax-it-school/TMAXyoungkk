/**
 * ai.mjs의 타입 선언(WP2 소유). 테스트가 '../server/ai.mjs'를 확장자까지 적어 import할 때 쓴다.
 */
import type { UpstreamFetch } from './proxy.mjs';

export type AiFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Awaited<ReturnType<UpstreamFetch>> & { headers?: { get(name: string): string | null } }>;

export const GEMINI_BASE_URL: string;
export const KAKAO_KEYWORD_URL: string;

export const AI_DEFAULTS: Readonly<{
  model: string;
  fallbackModel: string;
  timeoutMs: number;
  kakaoTimeoutMs: number;
  retries: number;
  cacheTtlMs: number;
  cacheMax: number;
  ratePerMin: number;
  maxBody: number;
}>;

export const AI_LIMITS: Readonly<{
  dates: number;
  tags: number;
  existing: number;
  candidates: number;
  freeSlots: number;
  ideasMin: number;
  ideasMax: number;
  limitMin: number;
  limitMax: number;
  reasonMax: number;
  keywordMax: number;
  nameMax: number;
  radiusKmMax: number;
}>;

export const AI_CATEGORIES: readonly string[];
export const IDEA_SCHEMA: Readonly<Record<string, unknown>>;
export const NEUTRAL_REASON: string;

export interface AiPlace {
  placeId: string;
  name: string;
  coord: { latitude: number; longitude: number };
  category: string;
  kind?: string;
  address?: string;
}

export interface AiRecommendRequest {
  region: { id: string; name: string; center: { latitude: number; longitude: number }; radiusKm: number };
  dates: string[];
  tags: string[];
  existing: string[];
  candidates: string[];
  freeSlots: string[];
  limit: number;
}

export interface AiIdea {
  keyword: string;
  category?: string;
  reason: string;
}

export interface AiEnvOptions {
  geminiKey: string;
  model: string;
  fallbackModel: string;
  trustProxy: boolean;
}

export function aiOptionsFromEnv(env: Record<string, string | undefined>): AiEnvOptions;
export function clientIp(remote: string | undefined, forwardedFor?: string | string[], trustProxy?: boolean): string;
export function usesThinkingBudget(model: string): boolean;
export function safeReason(text: string): string;
export function isAiPath(pathname: string): boolean;
export function parseRecommendBody(body: unknown): AiRecommendRequest;
export function mapKakaoCategory(code: string | undefined, name: string | undefined): string;
export function placeFromKakao(d: unknown): AiPlace | null;
export function buildPrompt(req: AiRecommendRequest): string;
export function ideasFromGemini(json: unknown): AiIdea[] | null;
export function cacheKeyOf(req: AiRecommendRequest): string;

export interface AiRecommenderOptions {
  geminiKey?: string;
  model?: string;
  fallbackModel?: string;
  kakaoKey?: string;
  fetch?: AiFetch;
  now?: () => number;
  /** Gemini 마감 시계(기본 Date.now) */
  clock?: () => number;
  /** 재시도 사이 쉬기 */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  kakaoTimeoutMs?: number;
  retries?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
  ratePerMin?: number;
  trustProxy?: boolean;
  log?: (message: string) => void;
}

export interface AiResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface AiRecommender {
  info(): { gemini: boolean; kakao: boolean; model: string; fallbackModel: string; ratePerMin: number; trustProxy: boolean };
  handle(req: { method?: string; path: string; body?: unknown; ip?: string; forwardedFor?: string | string[] }): Promise<AiResult>;
}

export function createAiRecommender(opts?: AiRecommenderOptions): AiRecommender;

/** 채팅 요약(POST /ai/summary, 2026-10-17) */
export const SUMMARY_LIMITS: Readonly<{ messages: number; textMax: number; whoMax: number; spots: number; titleMax: number; itemMax: number; decidedMax: number; openMax: number }>;
export function parseSummaryBody(body: unknown): {
  title: string;
  region: string;
  start: string;
  end: string;
  messages: { who: string; text: string }[];
  spots: { name: string; category: string }[];
};
export function buildSummaryPrompt(req: ReturnType<typeof parseSummaryBody>): string;
export function summaryFromGemini(json: unknown): { overview: string; decided: string[]; open: string[] } | null;
