/**
 * 커뮤니티 글 한도(WP6 소유). 서버(server/community.mjs)와 같은 값이다. index·draft·tags가 같이 쓴다(순환 import를 피하려고 따로 둔다).
 */
export const TITLE_MAX = 60;
export const BODY_MAX = 4000;
export const PHOTOS_MAX = 4;
/** 한 장 상한(바이트). 앱은 줄여서 올리고 서버는 이 값을 넘으면 거절한다 */
export const PHOTO_BYTES_MAX = 1_500_000;
