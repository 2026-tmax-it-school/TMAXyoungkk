import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  inRange,
  monthGrid,
  monthLabel,
  shiftMonth,
  tapRange,
  type DateRangeSel,
} from '../../../core/trip/create';
import { IconBtn, lineC, R, SP, surfaceC, Txt } from '../../../ui';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const CELL = 40;

/**
 * 달력 범위 선택(FR-201, 의존성 없음). 처음 누른 날이 시작, 다음에 누른 날이 종료다.
 * 앞 날짜를 누르면 거기서 새로 시작하므로 종료일 < 시작일을 만들 수 없다(판정은 core/trip/create.tapRange).
 * 텍스트 입력은 없다. 켜진 끝 날짜는 로즈 면, 사이 날짜는 틴트 면이다.
 */
export function CalendarRange({
  value,
  onChange,
  initialMonth,
  minDate,
}: {
  value: DateRangeSel;
  onChange: (v: DateRangeSel) => void;
  /** 'YYYY-MM' */
  initialMonth: string;
  /** 이 날짜 앞은 누를 수 없다(오늘) */
  minDate?: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const rows = monthGrid(month);
  return (
    <View style={{ gap: SP.m }}>
      {/* 월 제목은 왼쪽, 이전·다음은 오른쪽에 모은다(가운데 정렬은 01 화면만, HANDOFF). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.m }}>
        <View style={{ flex: 1 }}>
          <Txt v="nm">{monthLabel(month)}</Txt>
        </View>
        <IconBtn icon="back" label="이전 달" onPress={() => setMonth(shiftMonth(month, -1))} />
        <IconBtn icon="right" label="다음 달" onPress={() => setMonth(shiftMonth(month, 1))} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {WEEK.map((w) => (
          <View key={w} style={{ flex: 1, alignItems: 'center', paddingVertical: SP.xs }}>
            <Txt v="mtTight">{w}</Txt>
          </View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row' }}>
          {row.map((date, ci) => {
            if (!date) return <View key={ci} style={{ flex: 1, height: CELL }} />;
            const blocked = minDate != null && date < minDate;
            const end = date === value.start || date === value.end;
            const mid = !end && inRange(value, date);
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityLabel={date}
                accessibilityState={{ selected: end || mid, disabled: blocked }}
                disabled={blocked}
                onPress={() => onChange(tapRange(value, date))}
                style={{ flex: 1, height: CELL, padding: 2 }}
              >
                <View
                  style={{
                    flex: 1,
                    borderRadius: R.btnSm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: end ? surfaceC.accent : mid ? surfaceC.soft : 'transparent',
                    borderWidth: end ? 1 : 0,
                    borderColor: lineC.accent,
                  }}
                >
                  <Txt v="time" c={end ? 'onAccent' : blocked ? 'muted' : mid ? 'accentStrong' : 'ink'}>
                    {String(Number(date.slice(8)))}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
