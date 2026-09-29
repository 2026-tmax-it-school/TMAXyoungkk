import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { PhotoProvider, PickedPhoto } from '../../core/ports';
import { parseExif } from '../../core/journal/exif';

/**
 * expo-image-picker 어댑터(WP6 소유). 사용자 조작 뒤에만 열린다.
 * - 네이티브: EXIF(촬영 시각·GPS)를 core/journal/exif로 읽는다. 원본 화질(quality 1)로 받아 크기를 그대로 판정한다.
 * - 웹: 브라우저가 EXIF와 파일 크기를 주지 않을 수 있고 uri가 blob:·data:라, 저장하지 않고 이 세션에서만 보인다(sessionOnly).
 *   웹 압축은 판정·표시만 한다.
 * 네이티브에서 사진 권한이 거부되면 PhotoPermissionDenied를 던지고 화면이 안내한다.
 */

export class PhotoPermissionDenied extends Error {
  constructor() {
    super('사진 접근 권한이 없습니다');
  }
}

export function createImagePickerPhotos(): PhotoProvider {
  return {
    id: 'device',
    async pick({ multiple }): Promise<PickedPhoto[]> {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) throw new PhotoPermissionDenied();
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: multiple,
        quality: 1,
        exif: true,
      });
      if (res.canceled) return [];
      const web = Platform.OS === 'web';
      return res.assets.map((a) => {
        const picked: PickedPhoto = {
          uri: a.uri,
          // 크기를 못 받으면 0(모름)이다. 압축 판정을 하지 않고 20은 '크기 알 수 없음'으로 보여준다.
          bytes: a.fileSize ?? 0,
          width: a.width,
          height: a.height,
        };
        const exif = web ? undefined : parseExif(a.exif);
        if (exif) picked.exif = exif;
        if (web) picked.sessionOnly = true;
        return picked;
      });
    },
  };
}
