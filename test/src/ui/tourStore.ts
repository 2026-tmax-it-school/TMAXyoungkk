import { create } from 'zustand';

/**
 * 앱 둘러보기(스포트라이트 안내)의 상태(2026-10-24). 저장하지 않는다.
 * 안내가 켜져 있는 동안 지금 단계의 대상(targetId)만 TourTarget이 화면 좌표(rect)를 재서 올린다.
 */
export interface TourRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TourState {
  active: boolean;
  index: number;
  /** 지금 비추려는 대상 id. 오버레이가 단계마다 정한다 */
  targetId?: string;
  rect?: TourRect;
  start: (index?: number) => void;
  go: (index: number) => void;
  stop: () => void;
  setTarget: (id?: string) => void;
  setRect: (id: string, rect: TourRect) => void;
}

export const useTour = create<TourState>((set, get) => ({
  active: false,
  index: 0,
  targetId: undefined,
  rect: undefined,
  start: (index = 0) => set({ active: true, index, targetId: undefined, rect: undefined }),
  go: (index) => set({ index, targetId: undefined, rect: undefined }),
  stop: () => set({ active: false, index: 0, targetId: undefined, rect: undefined }),
  setTarget: (id) => set({ targetId: id, rect: undefined }),
  setRect: (id, rect) => {
    const cur = get();
    if (!cur.active || cur.targetId !== id) return;
    const old = cur.rect;
    // 같은 값이면 다시 그리지 않는다
    if (old && old.x === rect.x && old.y === rect.y && old.w === rect.w && old.h === rect.h) return;
    set({ rect });
  },
}));
