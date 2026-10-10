import type { LatLng, Transport } from '../../types';
import { legGeometryKey } from '../map/model';

/**
 * 구간 길 위 진행(WP5 소유, 순수). 시뮬레이터 점이 따라가는 길(core/sim/track)과 지연 판정의 남은 이동 시간(delay)이
 * 같은 선·같은 거리로 잰다. 선은 지도 선과 같은 구간 모양(legGeometryKey → 길 모양)의 끝점을 핀에 이은 것이다
 * (core/map/model.legShape와 같은 원리). 짧은 구간이라 첫 점 위도 기준 평면 근사로 누적 거리(m)를 잰다.
 *
 * 지금 위치를 선에 붙일 때 가장 가까운 한 점만 보면 길이 겹치는 구간(유턴해 반대 차선으로 출발지 옆을 다시 지나는 길,
 * 산길 굽이)에서 뒤쪽 길로 건너뛴다. 그래서 선을 따라 거리가 가장 작아지는 곳(극소점) 가운데 가장 가까운 것과
 * SNAP_TOLERANCE_M 안쪽인 후보를 모으고, 그중 앞(누적 거리가 작은 쪽)을 고른다(이어서 만들기는 대개 스팟에서 시작한다).
 * 직전 진행을 알면 그보다 BACK_SLACK_M 넘게 뒤가 아닌 후보 가운데 앞을 고른다(돌아오는 차선을 지나는 중이면 그쪽).
 * 그런 후보가 없으면(크게 되돌아감) 다시 앞쪽 후보다. 직전 진행은 엔진 판정(Timing.along)이 남기고 이어서 만들기가 받는다.
 */

export const M_PER_DEG_LAT = 111_320;

/** 지금 위치가 길에서 이만큼(m) 안이면 그 길 위에 있다고 본다. 멀면(다른 길) 길 모양을 쓰지 않는다 */
export const ON_ROAD_M = 150;
/** 가장 가까운 지점보다 이만큼(m)까지 먼 극소점도 후보로 본다(겹친 차선 사이, 흔들림 포함) */
export const SNAP_TOLERANCE_M = 20;
/** 직전 진행보다 이만큼(m)까지 뒤인 후보는 같은 자리로 본다(흔들림) */
export const BACK_SLACK_M = 50;

/** 이동 경로. pts[i]까지 누적 거리(m)가 cum[i]다 */
export interface LegPath {
  pts: LatLng[];
  cum: number[];
  cos: number;
}

/** 구간 길 위 진행. 구간 키와 출발에서 누적 거리(m). 다음 판정이 직전 진행으로 쓴다 */
export interface LegAlong {
  key: string;
  alongM: number;
}

export const sameSpot = (a: LatLng, b: LatLng) =>
  a.latitude.toFixed(5) === b.latitude.toFixed(5) && a.longitude.toFixed(5) === b.longitude.toFixed(5);

/** 길 모양의 끝점을 핀에 잇는다. 길 경로가 핀에서 떨어져 시작·끝나면 핀까지 짧게 잇는다(legShape와 같은 원리) */
export function pinnedShape(shape: LatLng[], from: LatLng, to: LatLng): LatLng[] {
  const out = sameSpot(shape[0], from) ? [...shape] : [from, ...shape];
  if (!sameSpot(out[out.length - 1], to)) out.push(to);
  return out;
}

export function makePath(pts: LatLng[]): LegPath {
  const cos = Math.cos((pts[0].latitude * Math.PI) / 180);
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    const dy = (pts[i].latitude - pts[i - 1].latitude) * M_PER_DEG_LAT;
    const dx = (pts[i].longitude - pts[i - 1].longitude) * M_PER_DEG_LAT * cos;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { pts, cum, cos };
}

export const pathLength = (p: LegPath) => p.cum[p.cum.length - 1];

function lerp(a: LatLng, b: LatLng, f: number): LatLng {
  return { latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f };
}

/** 출발에서 누적 거리 d(m) 지점 */
export function pointAtDistance(p: LegPath, d: number): LatLng {
  const total = pathLength(p);
  if (total <= 0) return p.pts[p.pts.length - 1];
  const x = Math.min(total, Math.max(0, d));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < x) i += 1;
  const seg = p.cum[i] - p.cum[i - 1];
  return lerp(p.pts[i - 1], p.pts[i], seg > 0 ? (x - p.cum[i - 1]) / seg : 1);
}

/**
 * c를 선에 붙인 지점의 누적 거리(along)와 그 거리(distM). 고르는 규칙은 맨 위 설명과 같다.
 * prevAlongM은 같은 선에서 직전에 붙인 누적 거리다(모르면 출발 쪽 후보를 고른다).
 */
export function projectOnPath(p: LegPath, c: LatLng, prevAlongM?: number): { along: number; distM: number } {
  const xy = (q: LatLng) => ({
    x: (q.longitude - c.longitude) * M_PER_DEG_LAT * p.cos,
    y: (q.latitude - c.latitude) * M_PER_DEG_LAT,
  });
  // 선분마다 가장 가까운 점. 길이 0인 선분(겹친 점)은 뺀다(앞뒤 선분으로 극소점을 가린다)
  const near: { along: number; distM: number; t: number }[] = [];
  for (let i = 0; i + 1 < p.pts.length; i += 1) {
    const a = xy(p.pts[i]);
    const b = xy(p.pts[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0) continue;
    // c가 원점이다. 선분 위 가장 가까운 점까지의 비율
    const t = Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2));
    near.push({ along: p.cum[i] + (p.cum[i + 1] - p.cum[i]) * t, distM: Math.hypot(a.x + dx * t, a.y + dy * t), t });
  }
  if (near.length === 0) {
    const a = xy(p.pts[0]);
    return { along: 0, distM: Math.hypot(a.x, a.y) };
  }
  let best = near[0];
  for (const s of near) if (s.distM < best.distM) best = s;
  // 극소점: 선분 안쪽에서 가장 가깝거나, 꼭짓점에서 앞 선분은 끝으로·뒤 선분은 처음으로 가장 가깝다
  const cands = near.filter((s, i) => {
    if (s.distM > best.distM + SNAP_TOLERANCE_M) return false;
    if (s.t <= 0) return i === 0 || near[i - 1].t >= 1;
    if (s.t >= 1) return i === near.length - 1 || near[i + 1].t <= 0;
    return true;
  });
  if (cands.length === 0) cands.push(best);
  const ahead = prevAlongM == null ? cands : cands.filter((s) => s.along >= prevAlongM - BACK_SLACK_M);
  const pool = ahead.length > 0 ? ahead : cands;
  let pick = pool[0];
  for (const s of pool) if (s.along < pick.along) pick = s;
  return { along: pick.along, distM: pick.distM };
}

/**
 * from → to 구간의 길(끝점을 핀에 이음). 모양이 없거나 두 점(직선)이면 undefined다(직선으로 본다).
 * shapes는 legGeometryKey(출발, 도착, 수단) → 그 구간 길 모양이다(지도 선과 같은 키·모양).
 */
export function legPathFor(
  shapes: Record<string, LatLng[]> | undefined,
  from: LatLng,
  to: LatLng,
  transport: Transport,
): LegPath | undefined {
  if (!shapes) return undefined;
  const shape = shapes[legGeometryKey(from, to, transport)];
  if (!shape || shape.length < 2) return undefined;
  const pts = pinnedShape(shape, from, to);
  if (pts.length < 3) return undefined;
  return makePath(pts);
}

/** 길 위 진행 비율(0~1)과 누적 거리. 지금 위치가 길에서 ON_ROAD_M보다 멀면 undefined다 */
export function progressOnPath(p: LegPath, c: LatLng, prevAlongM?: number): { fraction: number; alongM: number } | undefined {
  const on = projectOnPath(p, c, prevAlongM);
  if (on.distM > ON_ROAD_M) return undefined;
  const total = pathLength(p);
  return { fraction: total > 0 ? Math.min(1, Math.max(0, on.along / total)) : 1, alongM: on.along };
}
