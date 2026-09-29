import type { Category, GpsSample, LatLng, SimPresetId } from '../../types';
import { LOCATION_INTERVAL_MS } from '../constants';
import { minuteOfDay, type LiveDay } from '../live/context';
import { remainingTravelMin, straightTravelMin } from '../live/delay';
import { PRESET_SEED } from './presets';

/**
 * 결정적 궤적 생성(WP5 소유, 순수). 그날 시간표(LiveDay)와 프리셋으로 30초 간격 GPS 샘플열을 만든다.
 * 같은 시드·같은 시간표면 같은 샘플과 같은 이벤트가 나온다(Math.random을 쓰지 않는다).
 *
 * 움직임 규칙(프리셋 수정이 없을 때): 구간은 예정 이동 시간만큼 직선으로 가고, 스팟에서는
 * max(예정 출발, 도착 + 예정 체류의 75%)에 떠난다. 늦으면 체류를 조금 줄여 따라잡는 사람을 흉내 낸다.
 */

export interface SimEvent {
  t: number;
  kind: 'photo';
  spotId?: string;
  /** true면 3장(1장은 EXIF 없음), false면 1장 */
  multiple: boolean;
}

export interface SimTrack {
  preset: SimPresetId;
  seed: number;
  permission: 'granted' | 'denied';
  startAt: number;
  endAt: number;
  samples: GpsSample[];
  events: SimEvent[];
}

export interface GenerateTrackInput {
  day: LiveDay;
  preset: SimPresetId;
  seed?: number;
  intervalMs?: number;
  /** 출발 전 기점에서 머무는 시간(분) */
  leadMin?: number;
  /** 점심(식당) 찾기용 카테고리 */
  categories?: Record<string, Category>;
  /** 스팟별 영업 종료(자정부터 분). '영업 종료' 프리셋이 마감이 가장 가까운 스팟을 고를 때 쓴다 */
  closeMin?: Record<string, number>;
  /**
   * 이어서 만들기. 조정안을 적용해 계획이 바뀌면 지금 위치·시각에서 남은 스팟으로 궤적을 다시 만든다.
   * 이미 도착·건너뜀인 스팟은 뺀다. 프리셋 수정은 원래 시간표 순서(spotId) 기준으로 남은 스팟에만 건다.
   */
  resume?: { t: number; coord: LatLng; doneSpotIds: string[] };
}

/* ---------- 시드 난수(mulberry32) ---------- */

export function seededFloat(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 111_320;

/** 북쪽·동쪽으로 미터만큼 옮긴 좌표 */
export function offsetCoord(c: LatLng, northM: number, eastM: number): LatLng {
  const cos = Math.cos((c.latitude * Math.PI) / 180);
  return { latitude: c.latitude + northM / M_PER_DEG_LAT, longitude: c.longitude + eastM / (M_PER_DEG_LAT * cos) };
}

function lerp(a: LatLng, b: LatLng, f: number): LatLng {
  return { latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f };
}

/* ---------- 프리셋 수정 ---------- */

interface StopMod {
  /** 예정 출발보다 더 머무는 분 */
  extraStay?: number;
  /** 도착 후 이 분만 머물고 떠난다 */
  leaveAfter?: number;
  /** 도착 전에 이 거리(북쪽) 옆 건물에서 머문다 */
  preStay?: { offsetM: number; min: number };
  /** 이 스팟으로 가는 이동 중 정확도가 떨어진다 */
  shadowMove?: boolean;
  /** 도착 뒤 사진 이벤트(분) */
  photo?: { afterMin: number; multiple: boolean };
}

/** 점심 스팟: 뒤에 스팟이 남은 첫 식당. 없으면 2번째 이후에서 뒤가 남은 곳 */
function lunchIndex(day: LiveDay, categories?: Record<string, Category>): number {
  const n = day.items.length;
  const found = day.items.findIndex((it, i) => i < n - 1 && categories?.[it.spotId] === '식당');
  if (found >= 0) return found;
  return Math.max(0, Math.min(2, n - 2));
}

/**
 * '영업 종료' 프리셋 대상: 예정 도착과 영업 종료 사이 여유가 가장 적은 스팟(첫 스팟 제외, 앞 스팟에서 머물러야 하므로).
 * 앞 스팟에서 여유 + 40분을 더 머물면 도착 예정이 마감을 넘긴다. 조정안은 30분마다 다시 나오므로
 * 마감을 넘긴 뒤 30분 안에 '그 스팟 빼기(영업 종료)'가 1순위인 조정안이 나온다(WP4 replanForDelay 규칙).
 */
export function closingTarget(day: LiveDay, closeMin?: Record<string, number>): { index: number; marginMin: number } | undefined {
  if (!closeMin) return undefined;
  let best: { index: number; marginMin: number } | undefined;
  day.items.forEach((it, i) => {
    if (i === 0) return;
    const close = closeMin[it.spotId];
    if (close == null) return;
    const margin = close - it.arriveMin;
    if (margin <= 0) return;
    if (!best || margin < best.marginMin) best = { index: i, marginMin: margin };
  });
  return best;
}

export const CLOSING_EXTRA_MIN = 40;

function modsFor(
  preset: SimPresetId,
  day: LiveDay,
  categories?: Record<string, Category>,
  closeMin?: Record<string, number>,
): Record<string, StopMod> {
  const n = day.items.length;
  const m: Record<string, StopMod> = {};
  const at = (i: number, mod: StopMod) => {
    if (i < 0 || i >= n) return;
    const id = day.items[i].spotId;
    m[id] = { ...m[id], ...mod };
  };
  switch (preset) {
    case 'delay25':
      at(0, { extraStay: 25 });
      break;
    case 'closed': {
      const target = closingTarget(day, closeMin);
      // 영업시간을 모르면 첫 스팟에서 오래 머문다(지연이 커지는 것까지만 보인다).
      if (target) at(target.index - 1, { extraStay: target.marginMin + CLOSING_EXTRA_MIN });
      else at(0, { extraStay: 150 });
      break;
    }
    case 'gpsShadow':
      at(1, { shadowMove: true });
      break;
    case 'passBy':
      at(0, { leaveAfter: 1 });
      break;
    case 'nextDoor':
      at(0, { preStay: { offsetM: 120, min: 5 } });
      break;
    case 'freeTime':
      at(0, { leaveAfter: 30 });
      break;
    case 'full1018': {
      // 도착(0) → 지연 조정안(0에서 25분 더) → 점심 뒤 빈 시간(일찍 나섬) → 다음 스팟에서 사진 3장
      at(0, { extraStay: 25 });
      const li = lunchIndex(day, categories);
      if (li > 0) {
        at(li, { leaveAfter: 15, photo: { afterMin: 10, multiple: false } });
        at(li + 1, { photo: { afterMin: 10, multiple: true } });
      }
      break;
    }
    default:
      break;
  }
  return m;
}

/* ---------- 구간 ---------- */

type Seg =
  | { kind: 'stay'; from: number; to: number; at: LatLng }
  | { kind: 'move'; from: number; to: number; a: LatLng; b: LatLng; shadow: boolean };

export function generateTrack(input: GenerateTrackInput): SimTrack {
  const { day, preset } = input;
  const seed = input.seed ?? PRESET_SEED[preset];
  const interval = input.intervalMs ?? LOCATION_INTERVAL_MS;
  const lead = input.leadMin ?? 15;
  const ms = (min: number) => day.dayStartMs + min * 60_000;
  const rnd = seededFloat(seed);
  const mods = modsFor(preset, day, input.categories, input.closeMin);
  const segs: Seg[] = [];
  const events: SimEvent[] = [];

  const first = day.items[0];
  const baseCoord = day.base ?? (first ? offsetCoord(first.coord, -300, 0) : { latitude: 35.8562, longitude: 129.2247 });
  const resume = input.resume;
  const done = new Set(resume?.doneSpotIds ?? []);
  let startMin: number;
  let cursor: number;
  let prev: LatLng;
  if (resume) {
    startMin = Math.floor(minuteOfDay(day, resume.t));
    cursor = startMin;
    prev = resume.coord;
  } else {
    const departBase = first ? first.arriveMin - Math.max(1, first.travelMin) : day.startMin;
    startMin = Math.min(day.startMin, departBase) - lead;
    segs.push({ kind: 'stay', from: ms(startMin), to: ms(departBase), at: baseCoord });
    cursor = departBase;
    prev = baseCoord;
  }

  let resumedFirst = !!resume;
  day.items.forEach((it, i) => {
    if (done.has(it.spotId)) return;
    const mod = mods[it.spotId] ?? {};
    let travel = Math.max(1, it.travelMin);
    if (resumedFirst) {
      // 지금 위치에서 첫 남은 스팟까지. 예정 구간이 있으면 남은 거리 비율로 줄인다.
      const from = i > 0 ? day.items[i - 1].coord : day.base;
      travel = Math.max(1, Math.round(remainingTravelMin(prev, it.coord, it.transport, from ? { from, minutes: it.travelMin } : undefined)));
      resumedFirst = false;
    }
    let arrive: number;
    if (mod.preStay) {
      const door = offsetCoord(it.coord, mod.preStay.offsetM, 0);
      segs.push({ kind: 'move', from: ms(cursor), to: ms(cursor + travel), a: prev, b: door, shadow: !!mod.shadowMove });
      segs.push({ kind: 'stay', from: ms(cursor + travel), to: ms(cursor + travel + mod.preStay.min), at: door });
      const t0 = cursor + travel + mod.preStay.min;
      segs.push({ kind: 'move', from: ms(t0), to: ms(t0 + 1), a: door, b: it.coord, shadow: false });
      arrive = t0 + 1;
    } else {
      segs.push({ kind: 'move', from: ms(cursor), to: ms(cursor + travel), a: prev, b: it.coord, shadow: !!mod.shadowMove });
      arrive = cursor + travel;
    }
    const plannedStay = Math.max(1, it.departMin - it.arriveMin);
    let depart: number;
    if (mod.leaveAfter != null) depart = arrive + mod.leaveAfter;
    else if (mod.extraStay != null) depart = Math.max(it.departMin, arrive + plannedStay) + mod.extraStay;
    else depart = Math.max(it.departMin, arrive + Math.round(plannedStay * 0.75));
    segs.push({ kind: 'stay', from: ms(arrive), to: ms(depart), at: it.coord });
    if (mod.photo) events.push({ t: ms(arrive + mod.photo.afterMin), kind: 'photo', spotId: it.spotId, multiple: mod.photo.multiple });
    cursor = depart;
    prev = it.coord;
  });
  // 마지막 스팟 → 기점(복귀 여부와 상관없이 숙소로 간다), 도착 뒤 10분
  const back = Math.max(5, Math.round(straightTravelMin(prev, baseCoord, 'car')));
  segs.push({ kind: 'move', from: ms(cursor), to: ms(cursor + back), a: prev, b: baseCoord, shadow: false });
  segs.push({ kind: 'stay', from: ms(cursor + back), to: ms(cursor + back + 10), at: baseCoord });

  const startAt = resume ? resume.t : ms(startMin);
  const endAt = ms(cursor + back + 10);
  if (preset === 'denied') {
    return { preset, seed, permission: 'denied', startAt, endAt, samples: [], events };
  }

  const samples: GpsSample[] = [];
  let si = 0;
  let shadowLeft = 0;
  let shadowSeg = -1;
  for (let t = startAt; t <= endAt; t += interval) {
    while (si < segs.length - 1 && t >= segs[si].to) si += 1;
    const seg = segs[si];
    let coord: LatLng;
    let accuracy = 8 + Math.round(rnd() * 16);
    if (seg.kind === 'stay') {
      coord = offsetCoord(seg.at, (rnd() - 0.5) * 24, (rnd() - 0.5) * 24);
    } else {
      const f = seg.to > seg.from ? Math.min(1, Math.max(0, (t - seg.from) / (seg.to - seg.from))) : 1;
      coord = offsetCoord(lerp(seg.a, seg.b, f), (rnd() - 0.5) * 16, (rnd() - 0.5) * 16);
      // 음영: 이동 시작 1분 뒤부터 연속 4샘플
      if (seg.shadow && shadowSeg !== si && t - seg.from >= 60_000) {
        shadowSeg = si;
        shadowLeft = 4;
      }
    }
    if (shadowLeft > 0) {
      shadowLeft -= 1;
      accuracy = 90 + Math.round(rnd() * 60);
      coord = offsetCoord(coord, (rnd() - 0.5) * 160, (rnd() - 0.5) * 160);
    }
    samples.push({ t, coord, accuracyM: accuracy });
  }
  return { preset, seed, permission: 'granted', startAt, endAt, samples, events };
}

/**
 * 재생 중 한 번에 넘길 샘플. (fromT, toT] 안의 샘플을 돌려주되, 구간이 maxSpanMs보다 길면(시각 점프)
 * 마지막 하나만 준다. 건너뛴 구간은 채우지 않는다(기록 지도에서 점선).
 */
export function samplesBetween(samples: GpsSample[], fromT: number, toT: number, maxSpanMs = 10 * 60_000): GpsSample[] {
  if (toT <= fromT) return [];
  const out = samples.filter((s) => s.t > fromT && s.t <= toT);
  if (toT - fromT > maxSpanMs && out.length > 1) return [out[out.length - 1]];
  return out;
}

export function eventsBetween(events: SimEvent[], fromT: number, toT: number): SimEvent[] {
  return events.filter((e) => e.t > fromT && e.t <= toT);
}
