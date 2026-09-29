import type { LatLng } from '../types';
import type { Clock, IdGen, Rng } from './ports';

/**
 * 순수 유틸. 날짜는 KST 'YYYY-MM-DD', 시각은 'HH:MM', 시점은 ms다.
 * 기기 시간대에 기대지 않는다. KST는 UTC+9 고정(서머타임 없음)이라 UTC 계산에 9시간을 더해 쓴다.
 * 1단계 코드가 오늘 날짜를 UTC로 구해 KST 오전 9시 전에 하루 어긋났던 결함을 여기서 막는다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' → UTC 자정 ms (날짜 계산 전용) */
function dateToUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 시점(ms) → KST 날짜 */
export function kstDate(ms: number): string {
  return utcMsToDate(ms + KST_OFFSET_MS);
}

/** 시점(ms) → KST 'HH:MM' */
export function kstHHMM(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** KST 날짜와 'HH:MM' → 시점(ms). hhmm을 빼면 그날 00:00이다. */
export function atKst(date: string, hhmm = '00:00'): number {
  return dateToUtcMs(date) + toMin(hhmm) * 60 * 1000 - KST_OFFSET_MS;
}

/** 'HH:MM' → 자정부터의 분 */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 분 → 'HH:MM'. 24시를 넘으면 24:30처럼 그대로 적는다(하루 넘김을 숨기지 않는다). */
export function toHHMM(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 70 → '1시간 10분', 45 → '45분', 120 → '2시간' */
export function humanMin(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}시간` : `${h}시간 ${rest}분`;
}

/** 0=일요일 */
export function weekday(date: string): number {
  return new Date(dateToUtcMs(date)).getUTCDay();
}

/** '2026-10-18' → '10/18 (일)' */
export function dayLabel(date: string): string {
  return `${dayShort(date)} (${WEEK[weekday(date)]})`;
}

/** '2026-10-18' → '10/18' */
export function dayShort(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

export function addDays(date: string, n: number): string {
  return utcMsToDate(dateToUtcMs(date) + n * DAY_MS);
}

/** 두 날짜 사이 일수(b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / DAY_MS);
}

/** 시작일부터 종료일까지의 날짜 배열. 종료일 포함. 종료일이 앞이면 빈 배열. */
export function dateRange(start: string, end: string): string[] {
  const n = daysBetween(start, end);
  if (n < 0) return [];
  const out: string[] = [];
  for (let i = 0; i <= n; i += 1) out.push(addDays(start, i));
  return out;
}

/** 하버사인 거리(km) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 받침에 맞는 조사를 붙여 돌려준다. pair는 '이/가', '을/를', '은/는', '과/와', '으로/로'.
 * 한글이 아닌 글자로 끝나면 받침 없음으로 본다. 숫자로 끝나는 '10/18'은 읽는 소리(팔)로 판정한다.
 */
export function josa(word: string, pair: '이/가' | '을/를' | '은/는' | '과/와' | '으로/로'): string {
  const [withBatchim, without] = pair.split('/');
  const last = word.trim().slice(-1);
  let hasBatchim = false;
  let rieul = false;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    hasBatchim = jong !== 0;
    rieul = jong === 8;
  } else if (/[0-9]/.test(last)) {
    // 0 영, 1 일, 2 이, 3 삼, 4 사, 5 오, 6 육, 7 칠, 8 팔, 9 구
    hasBatchim = '013678'.includes(last);
    rieul = '178'.includes(last);
  }
  if (pair === '으로/로' && rieul) return word + without;
  return word + (hasBatchim ? withBatchim : without);
}

/* ---------- 인코딩 ---------- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford base32(패딩 없음). 5바이트 → 8자. */
export function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(buffer << (5 - bits)) & 31];
  return out;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url(패딩 없음). 16바이트 → 22자. */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64URL[(n >>> 18) & 63] + B64URL[(n >>> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >>> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

/** 토큰 끝 4자리만 보여준다. '····AbC1' */
export function maskToken(token: string, tail = 4): string {
  return `····${token.slice(-tail)}`;
}

/** 주입 난수로 만드는 ID. prefix_ + base32 10바이트(16자). 시각을 넣지 않아 추측할 수 없다. */
export function makeIdGen(rng: Rng): IdGen {
  return {
    next(prefix: string): string {
      return `${prefix}_${base32(rng.bytes(10)).toLowerCase()}`;
    },
  };
}

/* ---------- 시계 도우미(순수) ---------- */

/** startAt에서 시작해 base와 같은 속도로 가는 시계. 시연 시나리오를 실제 날짜와 무관하게 돌릴 때 쓴다. */
export function offsetClock(startAt: number, base: Clock): Clock {
  const origin = base.now();
  return { now: () => startAt + (base.now() - origin) };
}

/** 손으로 옮기는 시계. 시나리오 단계마다 정해진 시각을 찍을 때 쓴다. */
export interface ManualClock extends Clock {
  set(t: number): void;
  advance(ms: number): void;
}

export function manualClock(t0: number): ManualClock {
  let t = t0;
  return {
    now: () => t,
    set: (v) => {
      t = v;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}
