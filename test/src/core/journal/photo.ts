import type { LatLng, Photo, Plan, Trip } from '../../types';
import { PHOTO_MAX_BYTES } from '../constants';
import type { PickedPhoto } from '../ports';
import { atKst, haversineKm, kstDate, kstHHMM, toMin } from '../util';

/**
 * 사진 업로드 판정(FR-701, WP6 소유, 순수).
 * - EXIF가 있으면 촬영 시각과 위치를 그대로 쓴다.
 * - EXIF가 없으면 업로드 시각과 그 시각의 일정(실제 도착 기록 우선, 없으면 계획)으로 스팟을 추정한다.
 * - coord는 EXIF GPS 위치에만 둔다. EXIF에 시각만 있고 GPS가 없으면 스팟은 시각으로 추정하되 coord는 비운다
 *   (22 실제 경로에 계획 좌표가 실제 이동 지점으로 섞이지 않게).
 * - EXIF가 없고 업로드 시각이 여행 기간 밖이면(끝난 뒤 몰아서 올리기, 웹 사진) 날짜를 기간 안으로 정한다.
 *   화면에서 고른 날짜(fallbackDate)가 있으면 그날, 없으면 가까운 끝 날이다. 시각은 올린 시각의 시:분을 두고,
 *   그 시각에 그곳에 있었다는 근거가 없으니 스팟은 추정하지 않는다.
 * - 장당 10MB를 넘으면 압축 대상이다. 웹은 판정·표시만 하고, 실제 압축은 네이티브 image-picker quality로 한다.
 * - blob:·data: 주소는 문서에 넣지 않는다(새로고침 뒤 깨지고, data URL은 저장 한도를 넘긴다).
 */

/** EXIF 위치로 스팟을 고르는 반경(m). 프로토타입 가정 */
export const PHOTO_SPOT_RADIUS_M = 300;
/** 압축 목표 크기. 한도의 80%(프로토타입 가정) */
export const PHOTO_COMPRESS_TARGET_BYTES = Math.round(PHOTO_MAX_BYTES * 0.8);
/** quality 하한(프로토타입 가정). 원본이 약 27MB를 넘으면 압축해도 한도를 넘을 수 있다(stillOverLimit). */
const MIN_QUALITY = 0.3;

/** 문서에 넣으면 안 되는 브라우저 임시 주소 */
export function isForbiddenUri(uri: string | undefined): boolean {
  return !!uri && /^\s*(blob|data):/i.test(uri);
}

export interface CompressionPlan {
  compressed: boolean;
  /** 압축 뒤 크기(압축 대상이 아니면 원본 그대로). 웹에서는 추정값이다. */
  bytes: number;
  originalBytes: number;
  /** image-picker quality(0~1). 압축 대상이 아니면 1 */
  quality: number;
}

/** 크기를 모르면(웹에서 fileSize 없음) bytes 0으로 받고 압축 판정을 하지 않는다. */
export function compressionFor(bytes: number): CompressionPlan {
  const original = Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0;
  if (original <= PHOTO_MAX_BYTES) return { compressed: false, bytes: original, originalBytes: original, quality: 1 };
  const quality = Math.max(MIN_QUALITY, Math.floor((PHOTO_COMPRESS_TARGET_BYTES / original) * 100) / 100);
  return { compressed: true, bytes: Math.round(original * quality), originalBytes: original, quality };
}

/** 압축 대상인데 압축 뒤 추정 크기도 한도를 넘는지 */
export function stillOverLimit(p: Pick<Photo, 'compressed' | 'bytes'>): boolean {
  return p.compressed && p.bytes > PHOTO_MAX_BYTES;
}

/** 12_582_912 → '12.0MB', 850_000 → '830KB', 0(모름) → '크기 알 수 없음' */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '크기 알 수 없음';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 좌표에서 반경 안 가장 가까운 스팟 */
export function nearestSpot(trip: Trip, coord: LatLng, radiusM = PHOTO_SPOT_RADIUS_M): string | undefined {
  let best: { id: string; d: number } | undefined;
  for (const s of trip.spots) {
    const d = haversineKm(coord, s.coord) * 1000;
    if (d <= radiusM && (!best || d < best.d)) best = { id: s.id, d };
  }
  return best?.id;
}

/**
 * 그 시각의 스팟 추정. 실제 도착 기록이 그날 있으면 그 시각 직전에 도착한 스팟,
 * 없으면 계획에서 그 시각에 머무는 스팟(이동 중이면 직전에 떠난 스팟). 첫 도착 전이면 없음.
 */
export function spotAt(trip: Trip, plan: Plan | undefined, t: number): string | undefined {
  const date = kstDate(t);
  const arrived = trip.visits
    .filter((v) => v.date === date && v.status === 'arrived' && v.arrivedAt != null && v.arrivedAt <= t)
    .sort((a, b) => (a.arrivedAt as number) - (b.arrivedAt as number));
  if (arrived.length > 0) return arrived[arrived.length - 1].spotId;

  const day = plan?.days.find((d) => d.date === date);
  if (!day || day.items.length === 0) return undefined;
  const m = toMin(kstHHMM(t));
  let last: string | undefined;
  for (const it of day.items) {
    const a = toMin(it.arrive);
    const d = toMin(it.depart);
    if (m >= a && m < d) return it.spotId;
    if (m >= d) last = it.spotId;
  }
  return last;
}

export interface PhotoBuildCtx {
  id: string;
  memberId: string;
  /** 업로드 시각 */
  now: number;
  trip: Trip;
  plan?: Plan;
  /** EXIF가 없고 업로드 시각이 여행 기간 밖일 때 넣을 날짜(화면에서 고른 날짜). 기간 밖 값이면 무시한다. */
  fallbackDate?: string;
}

function inTrip(trip: Pick<Trip, 'startDate' | 'endDate'>, date: string): boolean {
  return date >= trip.startDate && date <= trip.endDate;
}

/** EXIF 없이 올린 사진의 날짜. 업로드 날짜가 기간 안이면 그날, 밖이면 고른 날짜나 가까운 끝 날 */
export function uploadDateFor(trip: Pick<Trip, 'startDate' | 'endDate'>, now: number, fallbackDate?: string): string {
  const today = kstDate(now);
  if (inTrip(trip, today)) return today;
  if (fallbackDate && inTrip(trip, fallbackDate)) return fallbackDate;
  return today < trip.startDate ? trip.startDate : trip.endDate;
}

/** 여행 기간 밖에서 EXIF 없이 올려 날짜를 정해 넣은 사진인지(올린 날짜와 촬영 날짜가 다르다) */
export function isDateAssigned(p: Pick<Photo, 'source' | 'takenAt' | 'uploadedAt'>): boolean {
  return p.source === 'estimated' && kstDate(p.takenAt) !== kstDate(p.uploadedAt);
}

/** EXIF 시각은 있지만 GPS가 없어 장소를 시각으로 추정한 사진인지 */
export function isPlaceEstimated(p: Pick<Photo, 'source' | 'coord' | 'spotId'>): boolean {
  return p.source === 'exif' && !p.coord && !!p.spotId;
}

/** 촬영 날짜가 여행 기간 밖이라 날짜 탭·일기에 들어가지 않는 사진(여행 전에 찍은 EXIF 사진 등) */
export function photosOutsideTrip(trip: Pick<Trip, 'startDate' | 'endDate' | 'photos'>): Photo[] {
  return trip.photos.filter((p) => !inTrip(trip, kstDate(p.takenAt)));
}

/**
 * 고른 사진 한 장 → 문서에 넣을 Photo. sessionUri가 있으면 화면이 메모리에만 들고 있는다.
 * 웹 기기 사진(sessionOnly)이나 blob:·data: 주소는 uri를 비우고 sessionOnly로 둔다.
 */
export function buildPhoto(p: PickedPhoto, ctx: PhotoBuildCtx): { photo: Photo; sessionUri?: string } {
  const sessionOnly = !!p.sessionOnly || isForbiddenUri(p.uri);
  const size = compressionFor(p.bytes);
  const takenFromExif = p.exif?.takenAt;
  const source: Photo['source'] = takenFromExif != null ? 'exif' : 'estimated';
  let takenAt = takenFromExif ?? ctx.now;
  let assigned = false;
  if (takenFromExif == null) {
    const date = uploadDateFor(ctx.trip, ctx.now, ctx.fallbackDate);
    if (date !== kstDate(ctx.now)) {
      takenAt = atKst(date, kstHHMM(ctx.now));
      assigned = true;
    }
  }

  // coord는 EXIF GPS 위치만. 추정한 스팟 좌표를 넣으면 실제 이동 지점처럼 보인다.
  const coord = p.exif?.coord;
  let spotId = coord ? nearestSpot(ctx.trip, coord) : undefined;
  if (!spotId && !assigned) spotId = spotAt(ctx.trip, ctx.plan, takenAt);

  const photo: Photo = {
    id: ctx.id,
    memberId: ctx.memberId,
    bytes: size.bytes,
    originalBytes: size.originalBytes,
    compressed: size.compressed,
    takenAt,
    source,
    uploadedAt: ctx.now,
  };
  if (p.sim) photo.sim = { label: p.sim.label, tone: p.sim.tone };
  else if (!sessionOnly) photo.uri = p.uri;
  if (sessionOnly && !p.sim) photo.sessionOnly = true;
  if (coord) photo.coord = coord;
  if (spotId) photo.spotId = spotId;
  return { photo, sessionUri: sessionOnly && !p.sim ? p.uri : undefined };
}

/** 사진을 그날(촬영 시각 KST) 기준으로 모은다. 촬영 시각 순 */
export function photosOn(trip: Trip, date: string): Photo[] {
  return trip.photos.filter((p) => kstDate(p.takenAt) === date).sort((a, b) => a.takenAt - b.takenAt);
}
