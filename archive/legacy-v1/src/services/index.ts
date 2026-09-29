import { HAS_GOOGLE_KEY } from '../config';
import { googleProvider, getLastGoogleError } from './google';
import { localProvider } from './local';
import type { MapProvider } from './maps';

/** 키가 있으면 구글, 없으면 로컬 추정. 화면 코드는 어느 쪽인지 알 필요가 없다. */
export const provider: MapProvider = HAS_GOOGLE_KEY ? googleProvider : localProvider;

export function providerStatus(): string {
  if (!HAS_GOOGLE_KEY) return '로컬 추정 (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY 없음)';
  const err = getLastGoogleError();
  return err ? `구글 API · ${err}` : '구글 API';
}

export * from './maps';
export { localProvider } from './local';
export { googleProvider } from './google';
