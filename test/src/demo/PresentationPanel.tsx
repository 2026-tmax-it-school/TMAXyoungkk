import React, { useState } from 'react';

import { useLive } from '../store/live';
import { useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import { Col, ListRow, ProgressBar, SP, Txt } from '../ui';
import {
  PRESENTATION_LIVE_DATE,
  PRESENTATION_LIVE_PRESET,
  PRESENTATION_LIVE_SPEED,
  PRESENTATION_STEPS,
  seedsNeeded,
  type PresentationStepKey,
} from './presentation';
import { scenarioTripId, seedScenario, type SeedProgress } from './tools';

/**
 * 발표 시나리오 패널(시연 도구 안, 관리자 전용). 발표 슬라이드 4단계를 순서대로 누른다.
 * 누를 때마다 그 단계를 실제로 실행하고 onOpen으로 해당 화면을 연다. 어느 단계든 바로 누를 수 있고(4단계만 눌러도 1~3단계가 채워진다),
 * 1단계를 다시 누르면 처음부터 다시 한다.
 */
export function PresentationPanel({ onOpen, busy }: { onOpen: (step: PresentationStepKey, tripId: string) => void; busy: boolean }) {
  const showToast = useUi((s) => s.showToast);
  const [done, setDone] = useState(0);
  /** 시나리오를 어디까지 채웠는지(0 없음, 1 담기까지, 2 선별까지) */
  const [seeded, setSeeded] = useState(0);
  const [running, setRunning] = useState<number | null>(null);
  const [progress, setProgress] = useState<SeedProgress | null>(null);

  const run = async (index: number) => {
    if (running != null) return;
    const step = PRESENTATION_STEPS[index];
    setRunning(index);
    try {
      // 방이 지워졌으면 처음부터 다시 채운다
      const have = scenarioTripId() ? seeded : 0;
      let now = have;
      for (const phase of seedsNeeded(index, have)) {
        const seed = PRESENTATION_STEPS.find((s) => s.key === phase)?.seed;
        if (seed) await seedScenario(seed.until, { onProgress: setProgress, after: seed.after });
        now = phase === 'collect' ? 1 : 2;
        setSeeded(now);
      }
      const tripId = scenarioTripId();
      if (!tripId) throw new Error('시나리오 여행방이 없어요. 1단계부터 눌러 주세요');
      if (step.key === 'live') {
        const L = useLive.getState();
        if (!(L.mode !== 'off' && L.tripId === tripId)) {
          // 방금 채운 방은 계획이 아직 없을 수 있다. 먼저 계산을 끝내야 시뮬레이터가 시작된다
          await useTrips.getState().recompute(tripId);
          L.setPreset(PRESENTATION_LIVE_PRESET);
          L.setSpeed(PRESENTATION_LIVE_SPEED);
          L.start(tripId, PRESENTATION_LIVE_DATE, 'sim');
          L.play();
        }
      }
      setDone(index + 1);
      onOpen(step.key, tripId);
    } catch (e) {
      showToast(`${step.title} 단계를 실행하지 못했어요: ${e instanceof Error ? e.message : String(e)}`, 'warn');
    } finally {
      setRunning(null);
      setProgress(null);
    }
  };

  return (
    <Col gap={SP.m}>
      <Txt v="nm">발표 시나리오</Txt>
      <Txt v="mtTight">단계를 누르면 앞 단계를 알아서 채우고 그 화면을 열어요. 4단계만 눌러도 돼요. 1단계를 누르면 처음부터 해요.</Txt>
      {progress ? (
        <Col gap={SP.s}>
          <ProgressBar value={progress.total > 0 ? progress.done / progress.total : 0} />
          <Txt v="mtTight">{`${progress.label} · ${progress.done} / ${progress.total}`}</Txt>
        </Col>
      ) : null}
      <Col>
        {PRESENTATION_STEPS.map((s, i) => (
          <ListRow
            key={s.key}
            first={i === 0}
            icon={i < done ? 'check' : 'play'}
            label={`${i + 1}. ${running === i ? '실행 중' : s.title}`}
            sub={s.sub}
            disabled={busy || running != null}
            onPress={() => void run(i)}
          />
        ))}
      </Col>
    </Col>
  );
}
