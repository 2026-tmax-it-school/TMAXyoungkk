/**
 * 서버 쪽 날짜 계산과 보관 기한(WP2 소유). 앱의 src/core/util.ts·tripStatus.ts와 같은 규칙이다
 * (서버는 앱 코드를 불러오지 않는다. 같은 값인지는 tests/wp2-db.test.ts가 맞춰 본다).
 *
 * - 날짜는 KST 'YYYY-MM-DD', 시각은 ms
 * - 여행방·채팅·사진은 종료일 다음 날 00:00 KST + 365일부터 지운다(README 보관 정책, DATA_RETENTION_MS)
 * - 경로 캐시는 24시간 보관한다(비기능 요구사항: 경로 API 24시간 캐시)
 * - 생성 op를 받지 못한 방은 종료일을 몰라, 마지막으로 op를 받은 뒤 365일부터 지운다
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 여행 종료 뒤 보관 기간. 앱 DATA_RETENTION_MS와 같다. */
export const DATA_RETENTION_MS = 365 * DAY_MS;
/** 경로 캐시 보관 기간 */
export const ROUTE_CACHE_TTL_MS = DAY_MS;
/** 생성 op 없는 방 보관 기간(마지막으로 받은 시각부터) */
export const ORPHAN_RETENTION_MS = 365 * DAY_MS;
/** 보관 기한 정리 주기(시작 때 한 번, 그 뒤 하루 한 번) */
export const PURGE_EVERY_MS = DAY_MS;

/**
 * 서버가 다루는 가장 늦은 시각(KST 9999-12-31 23:59:59.999). 이보다 늦으면 Postgres timestamptz가
 * 확장 연도('+010000-…')를 받지 않고 kstDate가 날짜를 만들지 못한다. 이런 시각은 없는 값(null)으로 본다.
 */
export const MAX_TIME_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999) - KST_OFFSET_MS;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 실제로 있는 'YYYY-MM-DD'인지. 1000년 이전은 받지 않는다(Postgres date에 0년이 없다). */
export function isDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v) || v < '1000-01-01') return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(v);
}

/** 시점(ms) → KST 'YYYY-MM-DD' */
export function kstDate(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * 이 시각(ms)부터 여행방을 지운다. 종료일이 올바르지 않거나 기한이 MAX_TIME_MS를 넘으면 null(종료일로는 지우지 않는다).
 * 다음 날 00:00 KST는 날짜 글자를 거치지 않고 ms로 더한다(9999-12-31 다음 날은 'YYYY-MM-DD'로 쓸 수 없다).
 */
export function retentionUntil(endDate) {
  if (!isDate(endDate)) return null;
  const until = Date.parse(`${endDate}T00:00:00+09:00`) + DAY_MS + DATA_RETENTION_MS;
  return until <= MAX_TIME_MS ? until : null;
}
