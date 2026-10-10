import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { CommunityPhotoInput } from '../../core/ports';
import { PHOTOS_MAX } from '../../core/community';

/**
 * 커뮤니티 글에 올릴 사진 고르기(WP6 소유, 2026-10-10). 사용자가 버튼을 누른 뒤에만 연다.
 * 서버로 보내므로 base64로 받고 화질을 낮춰(quality 0.45) 한 장을 1.5MB 아래로 맞춘다. 위치·촬영 정보(EXIF)는 받지 않는다.
 * 네이티브에서 사진 권한이 없으면 denied다. 고른 장수는 남은 칸(PHOTOS_MAX - have)까지만 받는다.
 */
export type PickPhotosResult = { ok: true; photos: CommunityPhotoInput[] } | { ok: false; reason: 'denied' | 'failed' };

const JPEG_LIKE = /^image\/(jpeg|png|webp)$/;

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
      photos.push({ mime, data: a.base64 });
    }
    return { ok: true, photos };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
