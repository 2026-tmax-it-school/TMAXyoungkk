import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { CommunityPhotoInput } from '../../core/ports';
import { PHOTO_BYTES_MAX, PHOTOS_MAX } from '../../core/community';

/**
 * 커뮤니티 글에 올릴 사진 고르기(WP6 소유, 2026-10-10). 사용자가 버튼을 누른 뒤에만 연다.
 * 서버로 보내므로 base64로 받고 화질을 낮춰(quality 0.45) 한 장을 1.5MB 아래로 맞춘다. 위치·촬영 정보(EXIF)는 받지 않는다.
 * 네이티브에서 사진 권한이 없으면 denied다. 고른 장수는 남은 칸(PHOTOS_MAX - have)까지만 받는다.
 * 웹은 quality를 무시하고 원본(휴대폰 사진은 수 MB)을 주므로, 캔버스로 긴 변 PHOTO_SIDE_MAX까지 줄이고
 * JPEG 화질을 낮춰 가며 PHOTO_BYTES_MAX 아래로 맞춘다(shrinkImageOnWeb). 줄여도 크면 그대로 두고 올리기 검사가 알린다.
 */
export type PickPhotosResult = { ok: true; photos: CommunityPhotoInput[] } | { ok: false; reason: 'denied' | 'failed' };

const JPEG_LIKE = /^image\/(jpeg|png|webp)$/;
export const PHOTO_SIDE_MAX = 1600;
const WEB_QUALITIES = [0.8, 0.65, 0.5, 0.35, 0.2];

/** 긴 변을 max 이하로 줄인 크기(이미 작으면 그대로) */
export function fitSize(w: number, h: number, max = PHOTO_SIDE_MAX): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** base64 글자 수 → 바이트 */
function b64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * 웹에서 이미지를 긴 변 sideMax까지 줄이고 JPEG 화질을 낮춰 가며 bytesMax 아래로 맞춘다(여행방 표지도 쓴다).
 * 줄여도 크면 가장 작게 만든 것을 준다. 문서가 없으면(네이티브) 그대로 준다.
 */
export async function shrinkImageOnWeb(
  photo: CommunityPhotoInput,
  sideMax = PHOTO_SIDE_MAX,
  bytesMax = PHOTO_BYTES_MAX,
): Promise<CommunityPhotoInput> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return photo;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('image'));
    el.src = `data:${photo.mime};base64,${photo.data}`;
  });
  const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, sideMax);
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return photo;
  ctx.drawImage(img, 0, 0, w, h);
  let out = photo;
  for (const q of WEB_QUALITIES) {
    const data = canvas.toDataURL('image/jpeg', q).split(',')[1] ?? '';
    if (data && b64Bytes(data) < b64Bytes(out.data)) out = { mime: 'image/jpeg', data };
    if (b64Bytes(out.data) <= bytesMax) break;
  }
  return out;
}

export async function pickCommunityPhotos(have: number): Promise<PickPhotosResult> {
  const room = PHOTOS_MAX - have;
  if (room <= 0) return { ok: true, photos: [] };
  try {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied' };
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.45,
      base64: true,
      exif: false,
    });
    if (res.canceled) return { ok: true, photos: [] };
    const photos: CommunityPhotoInput[] = [];
    for (const a of res.assets.slice(0, room)) {
      if (!a.base64) continue;
      const mime = a.mimeType && JPEG_LIKE.test(a.mimeType) ? a.mimeType : 'image/jpeg';
      const photo = { mime, data: a.base64 };
      photos.push(Platform.OS === 'web' ? await shrinkImageOnWeb(photo).catch(() => photo) : photo);
    }
    return { ok: true, photos };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
