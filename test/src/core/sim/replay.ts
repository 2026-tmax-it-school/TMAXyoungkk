import type { NotifyPrefs } from '../../types';
import { DEFAULT_NOTIFY_PREFS } from '../constants';
import type { LiveDay } from '../live/context';
import { acknowledgeDelay, ingestSample, initialEngine, type EngineEffect, type EngineState } from '../live/engine';
import type { SimEvent, SimTrack } from './track';

/**
 * 궤적 한 벌을 처음부터 끝까지 엔진에 흘려 이벤트 열을 만든다(WP5 소유, 순수).
 * 테스트(같은 시드면 같은 이벤트 열, 10/18 종합 재생 순서)와 19 화면의 '이 프리셋에서 일어날 일' 미리보기가 쓴다.
 * 앱의 실제 재생은 스토어가 같은 엔진을 시계에 맞춰 조금씩 부른다. 결과는 같다.
 * 조정안은 만들지 않는다. 지연 효과가 나오면 거절한 것으로 치고(acknowledge) 계속 간다.
 */

export type TimelineEntry =
  | { t: number; kind: 'arrived' | 'skipped'; spotId: string }
  | { t: number; kind: 'delay'; spotId: string; delayMin: number }
  | { t: number; kind: 'freeTime'; spotId: string; gapMin: number }
  | { t: number; kind: 'shadowOn' | 'shadowOff' }
  | { t: number; kind: 'photo'; spotId?: string; multiple: boolean };

export interface ReplayResult {
  timeline: TimelineEntry[];
  effects: EngineEffect[];
  state: EngineState;
}

function toEntry(e: EngineEffect): TimelineEntry | null {
  switch (e.kind) {
    case 'visit':
      return { t: e.at, kind: e.status, spotId: e.spotId };
    case 'delay':
      return { t: e.at, kind: 'delay', spotId: e.spotId, delayMin: e.delayMin };
    case 'freeTime':
      return { t: e.at, kind: 'freeTime', spotId: e.spotId, gapMin: e.gapMin };
    case 'shadow':
      return { t: e.at, kind: e.on ? 'shadowOn' : 'shadowOff' };
    default:
      return null;
  }
}

export function replayTrack(input: {
  track: SimTrack;
  day: LiveDay;
  tripId?: string;
  prefs?: NotifyPrefs;
}): ReplayResult {
  const ctx = {
    tripId: input.tripId ?? input.day.tripId,
    day: input.day,
    prefs: input.prefs ?? DEFAULT_NOTIFY_PREFS,
    source: 'sim' as const,
  };
  let st = initialEngine();
  const effects: EngineEffect[] = [];
  const timeline: TimelineEntry[] = [];
  for (const s of input.track.samples) {
    const r = ingestSample(st, s, ctx);
    st = r.state;
    for (const e of r.effects) {
      effects.push(e);
      if (e.kind === 'delay') st = acknowledgeDelay(st, e.delayMin);
      const entry = toEntry(e);
      if (entry) timeline.push(entry);
    }
  }
  for (const ev of input.track.events) timeline.push(photoEntry(ev));
  timeline.sort((a, b) => a.t - b.t);
  return { timeline, effects, state: st };
}

function photoEntry(ev: SimEvent): TimelineEntry {
  return { t: ev.t, kind: 'photo', spotId: ev.spotId, multiple: ev.multiple };
}
