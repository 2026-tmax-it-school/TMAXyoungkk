import type { LatLng } from '../types';

/** 'HH:MM' → 자정부터의 분 */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 분 → 'HH:MM' */
export function toHHMM(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 90 → '1시간 30분' */
export function humanMin(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}시간` : `${h}시간 ${rest}분`;
}

/** 'YYYY-MM-DD' → '10/18 (토)' */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${week})`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 시작일부터 종료일까지의 날짜 배열. 종료일 포함. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < 60; i += 1) {
    out.push(cur);
    if (cur === end) break;
    cur = addDays(cur, 1);
  }
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

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}
