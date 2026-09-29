import type { PhotoProvider } from '../../core/ports';
import { createImagePickerPhotos } from './device';

/** 기기 사진 제공자(WP6 소유). 시뮬레이터 사진 이벤트는 sim.ts의 createSimPhotoProvider를 쓴다. */
export function createDevicePhotoProvider(): PhotoProvider {
  return createImagePickerPhotos();
}
