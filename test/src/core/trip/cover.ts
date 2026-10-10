import type { TripCover } from '../../types';

/**
 * 여행방 표지 이미지(2026-10-10). 여행방 문서에 그대로 실려 동기화되므로 작게 둔다.
 * 고르는 쪽(services/tripCover)이 긴 변 COVER_SIDE_MAX로 줄이고 화질을 낮춰 COVER_BYTES_MAX 아래로 맞춘다.
 */

export const COVER_BYTES_MAX = 300_000;
export const COVER_SIDE_MAX = 1000;
const COVER_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** base64 글자 수 → 바이트(대략, 끝 '=' 반영) */
export function base64Size(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** 표지로 쓸 수 없으면 까닭, 쓸 수 있으면 null */
export function coverProblem(c: unknown): string | null {
  const v = c as Partial<TripCover> | null;
  if (!v || typeof v !== 'object' || typeof v.mime !== 'string' || typeof v.data !== 'string') return '표지 이미지 값이 올바르지 않습니다';
  if (!COVER_MIMES.has(v.mime)) return '표지는 JPEG, PNG, WebP 이미지만 쓸 수 있습니다';
  if (v.data.length === 0 || !BASE64.test(v.data)) return '표지 이미지 값이 올바르지 않습니다';
  if (base64Size(v.data) > COVER_BYTES_MAX) return '표지 이미지가 너무 큽니다. 다른 사진을 골라 주세요';
  return null;
}

/** 화면에 그릴 주소(data URI) */
export function coverUri(c: TripCover | undefined): string | undefined {
  return c ? `data:${c.mime};base64,${c.data}` : undefined;
}
