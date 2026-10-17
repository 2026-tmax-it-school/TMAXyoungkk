import React, { useState } from 'react';

import type { DaySetting, Trip } from '../../../types';
import type { Region } from '../../../core/ports';
import { baseModeOf, dateLong, dayHours, effectiveBase, type BaseMode } from '../../../core/trip/create';
import { Choice, Col, ListRow, SP, Sheet, Txt } from '../../../ui';
import { DAY_SUB } from '../dayRows';
import { BaseSearchSheet } from './BaseSearchSheet';
import { PickerBox } from './PickerBox';
import { TimeRange } from './TimeRange';

export type DayPatch = Partial<Pick<DaySetting, 'base' | 'noReturn' | 'dayStart' | 'dayEnd'>>;

/**
 * 25 여행방 설정 · 날짜 하루의 기점 시트(WP2). 날짜별 기점 목록(ListRow)에서 줄을 누르면 열린다.
 * 안에는 기점 방식 3칸(지정 · 직전과 같음 · 기점 없음, 첫날은 직전 칸이 없다), 기점 칸, '복귀 없음' 스위치 줄,
 * '이날 활동시간'이 있다. 바꾸면 바로 trip/setDay로 보낸다(전 멤버가 바꿀 수 있다). 활동시간은 TimeRange의 '완료'에서 한 번 보낸다.
 * 시트 안에 검색 목록이 없어 Sheet scroll을 켠다. 기점 검색(BaseSearchSheet)은 이 시트의 자식으로 그려 이 시트 위에 열린다
 * (TimeRange의 시트와 같다). 화면에 형제 Modal로 두면 iOS는 이미 DaySheet를 띄운 화면 컨트롤러에서 또 띄우지 못해 열리지 않는다.
 */
export function DaySheet({
  visible,
  trip,
  date,
  region,
  locked,
  onClose,
  onSet,
}: {
  visible: boolean;
  trip: Trip;
  date: string | undefined;
  /** 기점 검색 지역(여행방 지역) */
  region: Region | undefined;
  locked: boolean;
  onClose: () => void;
  onSet: (patch: DayPatch) => void;
}) {
  /** 기점 검색 시트가 열려 있는지 */
  const [searching, setSearching] = useState(false);
  const d = date ?? trip.startDate;
  const first = d === trip.startDate;
  const day = trip.days.find((x) => x.date === d);
  const mode = baseModeOf(day, first);
  const own = day && day.base && day.base !== 'inherit' ? day.base : null;
  const inherited = mode === 'inherit' ? effectiveBase(trip.days, d) : null;
  const hours = dayHours(trip, d);
  const options: { key: BaseMode; label: string; disabled?: boolean }[] = [
    { key: 'set', label: '지정', disabled: locked },
    ...(first ? [] : [{ key: 'inherit' as const, label: '직전과 같음', disabled: locked }]),
    { key: 'none', label: '기점 없음', disabled: locked },
  ];

  const pickMode = (m: BaseMode) => {
    if (m === mode) return;
    if (m === 'set') setSearching(true);
    else onSet({ base: m === 'inherit' ? 'inherit' : null });
  };

  const close = () => {
    setSearching(false);
    onClose();
  };

  return (
    <Sheet visible={visible && date != null} onClose={close} title={dateLong(d)} scroll>
      <Col gap={SP.m}>
        <Txt v="label">기점</Txt>
        <Choice<BaseMode> options={options} value={mode} onChange={pickMode} />
        {mode === 'set' ? (
          <PickerBox label="기점" icon="search" value={own?.name} placeholder="장소 찾기" onPress={() => setSearching(true)} disabled={locked} />
        ) : mode === 'inherit' ? (
          <Txt v="mtTight">{`${DAY_SUB.inherit} · ${inherited ? inherited.name : DAY_SUB.firstSpot}`}</Txt>
        ) : (
          <Txt v="mtTight">{DAY_SUB.none}</Txt>
        )}
      </Col>
      <ListRow
        first
        label="복귀 없음"
        sub="마지막 장소에서 하루를 끝내요"
        disabled={locked}
        switch={{ value: !!day?.noReturn, onChange: (v) => onSet({ noReturn: v }) }}
      />
      <TimeRange
        label="이날 활동시간"
        title={`${dateLong(d)} 활동시간`}
        start={hours.dayStart}
        end={hours.dayEnd}
        disabled={locked}
        onChange={(v) => onSet({ dayStart: v.start, dayEnd: v.end })}
      />
      {hours.custom ? null : <Txt v="mtTight">여행방 기본 활동시간을 써요</Txt>}
      <BaseSearchSheet
        visible={searching && visible && date != null}
        region={region}
        onClose={() => setSearching(false)}
        onPick={(base) => onSet({ base })}
        noneLabel="기점 없음(첫 스팟 사용)"
      />
    </Sheet>
  );
}
