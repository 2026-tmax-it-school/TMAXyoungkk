import type { LatLng } from '../../types';

/**
 * EXIF 해석(FR-701, WP6 소유, 순수). expo-image-picker가 돌려주는 exif 사전에서 촬영 시각과 GPS를 읽는다.
 * iOS는 '{Exif}'·'{GPS}' 안쪽 사전, 안드로이드는 평평한 키에 유리수 문자열('35/1,51/1,2230/100')을 준다.
 * 촬영 시각에 시간대가 없으면 KST(+09:00)로 본다(국내 전용, 프로토타입 가정).
 */

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : undefined;
}

function pick(dicts: (Dict | undefined)[], keys: string[]): unknown {
  for (const d of dicts) {
    if (!d) continue;
    for (const k of keys) if (d[k] != null && d[k] !== '') return d[k];
  }
  return undefined;
}

function rational(s: string): number {
  const [a, b] = s.split('/').map((x) => Number(x.trim()));
  if (b === undefined) return a;
  return b === 0 ? NaN : a / b;
}

/** 35.85 | '35.85' | '35/1,51/1,2230/100' | [35, 51, 22.3] → 도 */
export function parseDegrees(v: unknown): number | undefined {
  let parts: number[];
  if (typeof v === 'number') parts = [v];
  else if (Array.isArray(v)) parts = v.map((x) => (typeof x === 'number' ? x : rational(String(x))));
  else if (typeof v === 'string') parts = v.split(',').map(rational);
  else return undefined;
  if (parts.length === 0 || parts.some((x) => !Number.isFinite(x))) return undefined;
  const [d, m = 0, s = 0] = parts;
  return d + m / 60 + s / 3600;
}

/** 촬영 시각으로 믿는 연도 범위. 밖이면(시계 미설정 기기의 '0000:00:00' 등) EXIF 시각이 없는 것으로 본다. */
const EXIF_YEAR_MIN = 1970;
const EXIF_YEAR_MAX = 2100;

/** '2026:10:18 10:12:05' (+ '+09:00') → ms. 범위를 벗어나거나 없는 날짜('2026:13:40', '02:30')면 undefined */
export function parseExifDate(v: unknown, offset?: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  if (y < EXIF_YEAR_MIN || y > EXIF_YEAR_MAX) return undefined;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(utc);
  // 2월 30일처럼 넘어가 다른 날이 되면 버린다.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined;
  let offMin = 9 * 60;
  if (typeof offset === 'string') {
    const o = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
    if (o) offMin = (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3]));
  }
  return utc - offMin * 60_000;
}

export function parseExif(raw: unknown): { takenAt?: number; coord?: LatLng } | undefined {
  const root = asDict(raw);
  if (!root) return undefined;
  const exif = asDict(root['{Exif}']);
  const gps = asDict(root['{GPS}']);
  const dicts = [root, exif, gps];

  const takenAt = parseExifDate(
    pick(dicts, ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']),
    pick(dicts, ['OffsetTimeOriginal', 'OffsetTime']),
  );

  const lat = parseDegrees(pick(dicts, ['GPSLatitude', 'Latitude']));
  const lng = parseDegrees(pick(dicts, ['GPSLongitude', 'Longitude']));
  const latRef = String(pick(dicts, ['GPSLatitudeRef', 'LatitudeRef']) ?? 'N').toUpperCase();
  const lngRef = String(pick(dicts, ['GPSLongitudeRef', 'LongitudeRef']) ?? 'E').toUpperCase();
  let coord: LatLng | undefined;
  if (lat != null && lng != null && !(lat === 0 && lng === 0)) {
    coord = { latitude: latRef === 'S' ? -lat : lat, longitude: lngRef === 'W' ? -lng : lng };
  }

  if (takenAt == null && !coord) return undefined;
  const out: { takenAt?: number; coord?: LatLng } = {};
  if (takenAt != null) out.takenAt = takenAt;
  if (coord) out.coord = coord;
  return out;
}
