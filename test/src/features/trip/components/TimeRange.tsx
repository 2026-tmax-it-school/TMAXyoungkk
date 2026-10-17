import React, { useState } from 'react';
import { View } from 'react-native';

import { hoursLabel, stepTime } from '../../../core/trip/create';
import { Btn, Row, SP, Sheet, Txt } from '../../../ui';
import { PickerBox } from './PickerBox';

/**
 * 하루 활동시간(목업 04 '09:00 – 21:00 · 하루 12시간'). PickerBox와 같은 상자(라벨이 상자 안 위쪽)이고,
 * 누르면 시트에서 30분 단위로 시작·끝을 옮긴다.
 * 시트 안에서는 초안만 바꾸고, '완료'를 누를 때 onChange를 한 번만 부른다(같은 값이면 부르지 않는다,
 * 같은 값의 op가 로그에 쌓이지 않게). 닫기·바깥 누르기는 초안을 버린다.
 * 시작이 끝과 같거나 늦어지는 쪽, 05:00~24:00 밖으로는 옮기지 않는다. 판정은 core/trip/create.
 */
export function TimeRange({
  label,
  start,
  end,
  onChange,
  disabled,
  error,
  title,
}: {
  /** 상자 안 라벨('하루 활동시간', '이날 활동시간') */
  label: string;
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
  disabled?: boolean;
  error?: string;
  /** 시트 제목. 없으면 label */
  title?: string;
}) {
  const [draft, setDraft] = useState<{ start: string; end: string } | undefined>(undefined);
  const cur = draft ?? { start, end };

  const nextOf = (which: 'start' | 'end', delta: number) =>
    which === 'start' ? { start: stepTime(cur.start, delta), end: cur.end } : { start: cur.start, end: stepTime(cur.end, delta) };
  const canMove = (which: 'start' | 'end', delta: number) => {
    const next = nextOf(which, delta);
    if (next.start === cur.start && next.end === cur.end) return false;
    return next.start < next.end;
  };
  const move = (which: 'start' | 'end', delta: number) => {
    if (disabled || !canMove(which, delta)) return;
    setDraft(nextOf(which, delta));
  };
  const done = () => {
    if (draft && !disabled && (draft.start !== start || draft.end !== end)) onChange(draft);
    setDraft(undefined);
  };

  return (
    <>
      <PickerBox
        label={label}
        icon="clock"
        value={`${start} – ${end}`}
        trailing={<Txt v="mtTight">{hoursLabel(start, end)}</Txt>}
        a11yLabel={`${label} ${start}부터 ${end}까지`}
        disabled={disabled}
        error={error}
        onPress={() => setDraft({ start, end })}
      />
      <Sheet visible={draft != null} onClose={() => setDraft(undefined)} title={title ?? label}>
        <StepRow label="시작" value={cur.start} minus={canMove('start', -30)} plus={canMove('start', 30)} onMove={(d) => move('start', d)} />
        <StepRow label="끝" value={cur.end} minus={canMove('end', -30)} plus={canMove('end', 30)} onMove={(d) => move('end', d)} />
        <Txt v="mtTight">{hoursLabel(cur.start, cur.end)}</Txt>
        <Btn title="완료" onPress={done} />
      </Sheet>
    </>
  );
}

function StepRow({
  label,
  value,
  minus,
  plus,
  onMove,
}: {
  label: string;
  value: string;
  minus: boolean;
  plus: boolean;
  onMove: (delta: number) => void;
}) {
  return (
    <Row gap={SP.m}>
      <View style={{ flex: 1 }}>
        <Txt v="label">{label}</Txt>
      </View>
      <Btn title="- 30분" variant="quiet" size="sm" disabled={!minus} onPress={() => onMove(-30)} />
      <View style={{ minWidth: 52, alignItems: 'center' }}>
        <Txt v="nm">{value}</Txt>
      </View>
      <Btn title="+ 30분" variant="quiet" size="sm" disabled={!plus} onPress={() => onMove(30)} />
    </Row>
  );
}
