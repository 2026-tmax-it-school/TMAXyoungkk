import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { TripCover } from '../types';
import { COVER_BYTES_MAX, COVER_SIDE_MAX, coverProblem } from '../core/trip/cover';
import { shrinkImageOnWeb } from './community/picker';

/**
 * 여행방 표지 고르기(2026-10-10). 여행방 만들기·설정·빠른 수정이 쓴다. 사용자가 버튼을 누른 뒤에만 연다.
 * 표지는 여행방 문서에 실려 동기화되므로 긴 변 COVER_SIDE_MAX, COVER_BYTES_MAX 아래로 줄인다.
 * - 웹: 캔버스로 줄인다(shrinkImageOnWeb).
 * - 네이티브: 4:3으로 자르기(allowsEditing)와 낮은 화질로 받는다. 그래도 크면 tooBig.
 * 위치·촬영 정보(EXIF)는 받지 않는다.
 */
export type PickCoverResult =
  | { ok: true; cover?: TripCover }
  | { ok: false; reason: 'denied' | 'failed' | 'tooBig' };

const JPEG_LIKE = /^image\/(jpeg|png|webp)$/;

export const COVER_PICK_TEXT: Record<'denied' | 'failed' | 'tooBig', string> = {
  denied: '사진 권한이 없어 표지를 고를 수 없어요. 설정에서 사진 접근을 허용해 주세요.',
  failed: '사진을 불러오지 못했어요. 다시 골라 주세요.',
  tooBig: '사진이 너무 커서 표지로 쓸 수 없어요. 다른 사진을 골라 주세요.',
};

export async function pickTripCover(): Promise<PickCoverResult> {
  try {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied' };
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: Platform.OS !== 'web',
      aspect: [4, 3],
      quality: 0.3,
      base64: true,
      exif: false,
    });
    if (res.canceled) return { ok: true };
    const a = res.assets[0];
    if (!a?.base64) return { ok: false, reason: 'failed' };
    const raw = { mime: a.mimeType && JPEG_LIKE.test(a.mimeType) ? a.mimeType : 'image/jpeg', data: a.base64 };
    const cover = Platform.OS === 'web' ? await shrinkImageOnWeb(raw, COVER_SIDE_MAX, COVER_BYTES_MAX) : raw;
    if (coverProblem(cover)) return { ok: false, reason: 'tooBig' };
    return { ok: true, cover };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
