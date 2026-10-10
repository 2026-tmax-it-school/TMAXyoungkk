import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { hoursLabel, stepTime } from '../../../core/trip/create';
import { Btn, H, Icon, lineC, R, Row, SP, Sheet, surfaceC, Txt } from '../../../ui';

/**
 * 하루 활동시간(목업 04 '09:00 – 21:00 · 하루 12시간'). 값 상자 한 줄이고, 누르면 시트에서 30분 단위로 시작·끝을 옮긴다.
 * 스테퍼를 한 줄에 두면 25 카드 안(316px)에서 넘쳐서 값 상자와 시트로 나눴다(04 코드리뷰 회의).
 * 시작이 끝과 같거나 늦어지는 쪽, 05:00~24:00 밖으로는 옮기지 않는다. 값이 그대로면 onChange를 부르지 않는다
 * (같은 값의 op가 로그에 쌓이지 않게). 판정은 core/trip/create.
 */
export function TimeRange({
  start,
  end,
  onChange,
  disabled,
  title = '활동시간',
}: {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
  disabled?: boolean;
  /** 시트 제목 */
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  const nextOf = (which: 'start' | 'end', delta: number) =>
    which === 'start' ? { start: stepTime(start, delta), end } : { start, end: stepTime(end, delta) };
  const canMove = (which: 'start' | 'end', delta: number) => {
    const next = nextOf(which, delta);
    if (next.start === start && next.end === end) return false;
    return next.start < next.end;
  };
  const move = (which: 'start' | 'end', delta: number) => {
    if (disabled || !canMove(which, delta)) return;
    onChange(nextOf(which, delta));
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} ${start}부터 ${end}까지`}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{
          minHeight: H.field,
          paddingHorizontal: 13,
          paddingVertical: SP.m,
          borderWidth: 1,
          borderColor: lineC.line,
          borderRadius: R.field,
          backgroundColor: disabled ? surfaceC.off : surfaceC.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP.m,
        }}
      >
        <Icon name="clock" size={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="body" c="ink" numberOfLines={1}>
            {`${start} – ${end}`}
          </Txt>
        </View>
        <Txt v="mtTight">{hoursLabel(start, end)}</Txt>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        <StepRow label="시작" value={start} minus={canMove('start', -30)} plus={canMove('start', 30)} onMove={(d) => move('start', d)} />
        <StepRow label="끝" value={end} minus={canMove('end', -30)} plus={canMove('end', 30)} onMove={(d) => move('end', d)} />
        <Txt v="mtTight">{hoursLabel(start, end)}</Txt>
        <Btn title="완료" onPress={() => setOpen(false)} />
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
