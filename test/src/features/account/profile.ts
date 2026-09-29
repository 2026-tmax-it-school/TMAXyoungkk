import type { Profile } from '../../core/ports';

/**
 * 17 프로필 이미지 규칙(WP1 소유, 순수).
 * 웹 image-picker는 blob: 주소를 주는데 새로고침하면 깨지고, data: 주소는 저장소 한도를 넘긴다(계약 사진 저장 규칙과 같은 이유).
 * 그래서 기기 파일 경로만 저장하고, 나머지는 이 세션 미리 보기와 크기 판정에만 쓴다.
 */

/** 시연용 예시 이미지 크기. 5MB를 넘겨 압축 판정과 전후 크기를 보여준다 */
export const SAMPLE_PROFILE_IMAGE_BYTES = Math.round(8.4 * 1024 * 1024);

export function isStorableImageUri(uri: string): boolean {
  return !/^(blob|data):/i.test(uri.trim());
}

/**
 * 게스트 승격 때 계정에 올릴 로컬 프로필(이 기기 데이터 유지). 가입 때 계정 프로필은 태그가 비어 있고 이미지가 없어서,
 * 그대로 applyAuth하면 게스트 때 고른 성향 태그(FR-404 입력)와 이미지 정보가 사라진다.
 * 닉네임은 가입 때 정한 계정 것을 쓴다. 로컬 태그가 있으면 태그를, 로컬 이미지 정보가 있으면 이미지 세 필드를 올린다.
 * 올릴 것이 없으면 null.
 */
export function promotionProfilePatch(local: Profile, account: Profile): Partial<Profile> | null {
  const patch: Partial<Profile> = {};
  if (local.tags.length > 0 && account.tags.length === 0) patch.tags = [...local.tags];
  if (local.imageBytes != null && account.imageBytes == null) {
    patch.imageUri = local.imageUri;
    patch.imageBytes = local.imageBytes;
    patch.imageCompressed = local.imageCompressed;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
