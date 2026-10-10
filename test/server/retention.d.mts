/**
 * retention.mjs의 타입 선언(WP2 소유).
 */

export const DAY_MS: number;
export const DATA_RETENTION_MS: number;
export const ROUTE_CACHE_TTL_MS: number;
export const ORPHAN_RETENTION_MS: number;
export const PURGE_EVERY_MS: number;
/** 서버가 다루는 가장 늦은 시각(KST 9999-12-31 23:59:59.999) */
export const MAX_TIME_MS: number;

export function isDate(v: unknown): v is string;
export function kstDate(ms: number): string;
export function addDays(date: string, n: number): string;
export function daysBetween(a: string, b: string): number;
/** 이 시각(ms)부터 여행방을 지운다. 종료일이 올바르지 않거나 기한이 MAX_TIME_MS를 넘으면 null */
export function retentionUntil(endDate: unknown): number | null;
