/**
 * 서버가 키로 쓰는 문자열 판정(WP2 소유). 메모리 저장소와 PostgreSQL 저장소, HTTP 경로가 같은 규칙을 쓴다.
 *
 * tripId·op.id·초대 코드·스팟 id는 Postgres에서 text 매개변수와 btree 키로 들어간다. NUL 문자는 text가 받지 않고,
 * 짝 없는 서로게이트는 UTF-8로 바꿀 수 없고, 너무 긴 값은 btree 한 행 상한(약 2.7KB)을 넘는다. 셋 다 그 배치 전체를
 * 실패시키고 다시 보내도 영원히 실패하므로, 이런 값은 받지 않고 건너뛴다(id 없는 op와 같다).
 * 앱 id는 'prefix_' + 16자라 상한에 한참 못 미친다.
 */

/** id 최대 길이(UTF-16 단위). 한 글자가 UTF-8 4바이트여도 btree 상한 안에 든다. */
export const MAX_ID_LEN = 200;

/** 키로 저장할 수 있는 id인지 */
export function storableId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN && v.isWellFormed() && !v.includes('\u0000');
}
