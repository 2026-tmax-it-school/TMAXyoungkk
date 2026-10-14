/**
 * 화면 안 하단 시트(ui/PeekSheet)의 스냅 계산(순수). 지도 탭 시트와 채팅방 지도 시트가 같이 쓴다.
 * - mini: 한 줄(64). 채팅방 지도처럼 시트를 거의 접어 지도를 넓게 볼 때
 * - peek: 영역 높이의 42%(180~320, 영역 − 64를 넘지 않음)
 * - full: 영역 − 16까지(maxRatio로 줄일 수 있음). peek보다 작지 않다
 * 끌기 속도(vy)는 PanResponder의 gesture.vy(px/ms)이고 양수가 아래(시트가 작아지는 쪽)다.
 */

export type SheetSnap = 'mini' | 'peek' | 'full';
export type SheetHeights = Record<SheetSnap, number>;

/** 작은 것부터 큰 것 순서 */
export const SNAP_ORDER: readonly SheetSnap[] = ['mini', 'peek', 'full'];

export const SHEET_MINI_H = 64;
const PEEK_RATIO = 0.42;
const PEEK_MIN = 180;
const PEEK_MAX = 320;
const FULL_GAP = 16;
/** 이보다 빠르게 놓으면 가까운 스냅이 아니라 끈 방향의 다음 스냅으로 간다 */
export const FLING_VY = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sheetHeights(areaH: number, maxRatio = 1): SheetHeights {
  const area = Math.max(0, areaH);
  const peek = Math.max(0, Math.min(clamp(Math.round(area * PEEK_RATIO), PEEK_MIN, PEEK_MAX), area - SHEET_MINI_H));
  const full = Math.max(peek, Math.min(area - FULL_GAP, Math.round(area * maxRatio)));
  return { mini: SHEET_MINI_H, peek, full };
}

/** snaps 안의 스냅을 높이 오름차순으로(같은 높이면 SNAP_ORDER 순) */
function ordered(heights: SheetHeights, snaps: readonly SheetSnap[]): SheetSnap[] {
  const have = SNAP_ORDER.filter((s) => snaps.includes(s));
  return have.sort((a, b) => heights[a] - heights[b] || SNAP_ORDER.indexOf(a) - SNAP_ORDER.indexOf(b));
}

/**
 * 손을 뗀 높이 h와 속도 vy로 붙을 스냅을 고른다.
 * |vy| > 0.5면 끈 방향(vy < 0 위로 → 더 큰 스냅, vy > 0 아래로 → 더 작은 스냅)의 다음 스냅, 아니면 가장 가까운 스냅.
 * 결과는 늘 snaps 안이다.
 */
export function snapAfterDrag(
  h: number,
  vyPxPerMs: number,
  heights: SheetHeights,
  snaps: readonly SheetSnap[],
): SheetSnap {
  const list = ordered(heights, snaps);
  if (list.length === 0) return 'peek';
  if (Math.abs(vyPxPerMs) > FLING_VY) {
    if (vyPxPerMs < 0) return list.find((s) => heights[s] > h) ?? list[list.length - 1];
    return [...list].reverse().find((s) => heights[s] < h) ?? list[0];
  }
  let best = list[0];
  for (const s of list) if (Math.abs(heights[s] - h) < Math.abs(heights[best] - h)) best = s;
  return best;
}

/**
 * 손잡이를 눌렀을 때 다음 스냅. mini → peek → full → peek 순으로 돌고 snaps에 없는 단계는 건너뛴다.
 * 맨 위 스냅에서는 한 단계 내려가고, 지금 스냅이 snaps에 없으면 그보다 큰 첫 스냅(없으면 맨 위)으로 간다.
 */
export function nextOnTap(snap: SheetSnap, snaps: readonly SheetSnap[]): SheetSnap {
  const have = SNAP_ORDER.filter((s) => snaps.includes(s));
  if (have.length === 0) return snap;
  const i = have.indexOf(snap);
  if (i < 0) {
    const at = SNAP_ORDER.indexOf(snap);
    return have.find((s) => SNAP_ORDER.indexOf(s) > at) ?? have[have.length - 1];
  }
  if (have.length === 1) return have[0];
  if (i === have.length - 1) return have[i - 1];
  return have[i + 1];
}

/** 스크린리더 조절(increment 펼치기 / decrement 접기). 양 끝에서는 그대로 둔다 */
export function stepA11y(snap: SheetSnap, dir: 'increment' | 'decrement', snaps: readonly SheetSnap[]): SheetSnap {
  const have = SNAP_ORDER.filter((s) => snaps.includes(s));
  if (have.length === 0) return snap;
  const i = have.indexOf(snap);
  if (i < 0) return nextOnTap(snap, snaps);
  const j = dir === 'increment' ? Math.min(have.length - 1, i + 1) : Math.max(0, i - 1);
  return have[j];
}

/** 스냅을 사람 말로(손잡이 accessibilityValue) */
export const SNAP_LABEL: Record<SheetSnap, string> = { mini: '접힘', peek: '반쯤 펼침', full: '모두 펼침' };
