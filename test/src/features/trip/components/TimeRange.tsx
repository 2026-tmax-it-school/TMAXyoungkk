import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { hoursLabel, parseTimeInput, TIME_OPTIONS } from '../../../core/trip/create';
import { Btn, Col, Field, SP, Sheet, Tag, Txt } from '../../../ui';
import { PickerBox } from './PickerBox';

/**
 * 하루 활동시간(목업 04 '09:00 – 21:00 · 하루 12시간'). PickerBox와 같은 상자(라벨이 상자 안 위쪽)이고, 누르면 시트가 열린다.
 * 시트의 시작·끝은 두 가지로 정한다(2026-10-17 사용자 요청).
 *  - 목록: 05:00~24:00 30분 간격 시각 칩을 옆으로 밀어 고른다. 시작은 끝보다 이른 시각만, 끝은 시작보다 늦은 시각만 누를 수 있다.
 *  - 직접 입력: 칸에 '9', '9:30', '0930', '9시 30분'처럼 적는다(core/trip/create parseTimeInput, 분은 아무 값이나 가능).
 *    잘못 적으면 칸 아래에 이유를 보이고 '완료'를 막는다. 칸을 벗어나면 읽은 시각('09:30')으로 고쳐 적는다.
 * 시트 안에서는 초안만 바꾸고, '완료'를 누를 때 onChange를 한 번만 부른다(같은 값이면 부르지 않는다,
 * 같은 값의 op가 로그에 쌓이지 않게). 닫기·바깥 누르기는 초안을 버린다.
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
  /** 직접 입력 칸에 적고 있는 글자(없으면 초안 값을 보인다) */
  const [typed, setTyped] = useState<{ start?: string; end?: string }>({});
  const cur = draft ?? { start, end };

  /** 칸에 적은 글자의 문제(없으면 undefined) */
  const problemOf = (which: 'start' | 'end'): string | undefined => {
    const text = typed[which];
    if (text == null) return undefined;
    const t = parseTimeInput(text);
    if (t == null) return '05:00~24:00 사이 시각으로 적어 주세요(예: 9:30)';
    const other = which === 'start' ? cur.end : cur.start;
    if (which === 'start' ? t >= other : t <= other) return which === 'start' ? '시작은 끝보다 이르게 해 주세요' : '끝은 시작보다 늦게 해 주세요';
    return undefined;
  };
  const startProblem = problemOf('start');
  const endProblem = problemOf('end');

  const pick = (which: 'start' | 'end', value: string) => {
    if (disabled) return;
    const next = which === 'start' ? { start: value, end: cur.end } : { start: cur.start, end: value };
    if (next.start >= next.end) return;
    setDraft(next);
    setTyped((t) => ({ ...t, [which]: undefined }));
  };
  const type = (which: 'start' | 'end', text: string) => {
    setTyped((t) => ({ ...t, [which]: text }));
    const v = parseTimeInput(text);
    if (v == null) return;
    const next = which === 'start' ? { start: v, end: cur.end } : { start: cur.start, end: v };
    if (next.start < next.end) setDraft(next);
  };
  /** 칸을 벗어나면 읽은 시각으로 고쳐 적는다(문제가 있으면 그대로 두어 이유가 보이게) */
  const settle = (which: 'start' | 'end') => {
    if (typed[which] != null && problemOf(which) == null) setTyped((t) => ({ ...t, [which]: undefined }));
  };
  const close = () => {
    setDraft(undefined);
    setTyped({});
  };
  const done = () => {
    if (startProblem || endProblem) return;
    if (draft && !disabled && (draft.start !== start || draft.end !== end)) onChange(draft);
    close();
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
        onPress={() => {
          setTyped({});
          setDraft({ start, end });
        }}
      />
      <Sheet visible={draft != null} onClose={close} title={title ?? label} scroll>
        <TimeField
          label="시작"
          value={cur.start}
          text={typed.start}
          problem={startProblem}
          options={TIME_OPTIONS.filter((t) => t < cur.end)}
          onPick={(t) => pick('start', t)}
          onType={(t) => type('start', t)}
          onBlur={() => settle('start')}
          disabled={disabled}
        />
        <TimeField
          label="끝"
          value={cur.end}
          text={typed.end}
          problem={endProblem}
          options={TIME_OPTIONS.filter((t) => t > cur.start)}
          onPick={(t) => pick('end', t)}
          onType={(t) => type('end', t)}
          onBlur={() => settle('end')}
          disabled={disabled}
        />
        <Txt v="mtTight">{hoursLabel(cur.start, cur.end)}</Txt>
        <Btn title="완료" disabled={!!startProblem || !!endProblem} onPress={done} />
      </Sheet>
    </>
  );
}

/** 고른 칩 앞에 남겨 둘 가로(앞 칩이 조금 보이게) */
const CHIP_LEAD = 90;

/** 시각 하나: 목록(옆으로 미는 칩) + 직접 입력 칸 */
function TimeField({
  label,
  value,
  text,
  problem,
  options,
  onPick,
  onType,
  onBlur,
  disabled,
}: {
  label: string;
  value: string;
  /** 직접 입력 칸에 적고 있는 글자. 없으면 value를 보인다 */
  text: string | undefined;
  problem: string | undefined;
  options: readonly string[];
  onPick: (t: string) => void;
  onType: (t: string) => void;
  onBlur: () => void;
  disabled?: boolean;
}) {
  // 고른 칩이 보이게 옆으로 민다. 칩이 그려진 자리(onLayout x)를 쓴다(폭이 칩마다 달라 어림하면 어긋난다)
  const scroller = useRef<ScrollView>(null);
  const selectedX = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (selectedX.current != null) scroller.current?.scrollTo({ x: Math.max(0, selectedX.current - CHIP_LEAD), animated: false });
  }, [value]);
  return (
    <Col gap={SP.m}>
      <Txt v="label">{label}</Txt>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP.m, paddingVertical: SP.xs }}>
        {options.map((t) => (
          <View
            key={t}
            onLayout={
              t === value
                ? (e) => {
                    selectedX.current = e.nativeEvent.layout.x;
                    scroller.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - CHIP_LEAD), animated: false });
                  }
                : undefined
            }
          >
            <Tag label={t} on={t === value} onPress={() => onPick(t)} />
          </View>
        ))}
      </ScrollView>
      <View>
        <Field
          label={`${label} 시각 직접 입력`}
          size="sm"
          value={text ?? value}
          onChangeText={onType}
          onBlur={onBlur}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          placeholder="예: 9:30"
          error={problem}
        />
      </View>
    </Col>
  );
}
