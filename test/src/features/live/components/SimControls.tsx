import React from 'react';
import { View } from 'react-native';

import type { SimPresetId } from '../../../types';
import type { JumpTarget } from '../../../core/live/session';
import { presetById, SIM_PRESETS, SIM_SPEEDS } from '../../../core/sim/presets';
import { dayShort, kstDate, kstHHMM } from '../../../core/util';
import type { SimSpeed } from '../../../store/live';
import { Btn, Card, Col, ProgressBar, Row, Seg, SP, Tag, Txt } from '../../../ui';

/**
 * 여행 시뮬레이터 조작(WP5 소유). 프리셋 9종, 배속 1·10·60·300배, 재생·일시정지, 시각 점프.
 * 실제로 경주를 돌아다닐 수 없어 2·3차 실시간 기능을 시각 가속 재생으로 보여준다. 실제 위치가 아니다.
 */
export function SimControls({
  preset,
  speed,
  playing,
  virtualNow,
  window,
  jumps,
  onPreset,
  onSpeed,
  onPlay,
  onPause,
  onJump,
}: {
  preset: SimPresetId;
  speed: SimSpeed;
  playing: boolean;
  virtualNow?: number;
  window?: { startAt: number; endAt: number };
  jumps: JumpTarget[];
  onPreset: (p: SimPresetId) => void;
  onSpeed: (s: SimSpeed) => void;
  onPlay: () => void;
  onPause: () => void;
  onJump: (t: number) => void;
}) {
  const p = presetById(preset);
  const progress =
    window && virtualNow != null && window.endAt > window.startAt
      ? Math.min(1, Math.max(0, (virtualNow - window.startAt) / (window.endAt - window.startAt)))
      : 0;
  return (
    <Card>
      <Col gap={SP.xl}>
        <Row>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="eyebrow" c="muted">
              여행 시뮬레이터
            </Txt>
            <Txt v="nm">{virtualNow != null ? `가상 시각 ${dayShort(kstDate(virtualNow))} ${kstHHMM(virtualNow)}` : '재생 전'}</Txt>
          </View>
          {playing ? (
            <Btn title="일시정지" icon="pause" size="sm" variant="ghost" onPress={onPause} />
          ) : (
            <Btn title="재생" icon="play" size="sm" onPress={onPlay} />
          )}
        </Row>
        {window ? <ProgressBar value={progress} /> : null}
        <Seg
          items={SIM_SPEEDS.map((s) => ({ key: String(s), label: `${s}배` }))}
          value={String(speed)}
          onChange={(k) => onSpeed(Number(k) as SimSpeed)}
        />
        <Col gap={SP.s}>
          <Txt v="label">프리셋</Txt>
          <Row gap={SP.s} wrap>
            {SIM_PRESETS.map((x) => (
              <Tag key={x.id} label={x.label} on={x.id === preset} onPress={() => onPreset(x.id)} />
            ))}
          </Row>
          <Txt v="mt">{p.text}</Txt>
        </Col>
        {jumps.length > 0 ? (
          <Col gap={SP.s}>
            <Txt v="label">시각 점프</Txt>
            <Row gap={SP.s} wrap>
              {jumps.map((j) => (
                <Btn key={j.key} title={j.label} icon="clock" size="sm" variant="quiet" onPress={() => onJump(j.t)} />
              ))}
            </Row>
          </Col>
        ) : null}
      </Col>
    </Card>
  );
}
