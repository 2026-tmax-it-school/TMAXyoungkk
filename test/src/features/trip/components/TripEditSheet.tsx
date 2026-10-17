import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import type { TripCover } from '../../../types';
import { isHost } from '../../../core/group';
import { isEditLocked } from '../../../core/ops';
import { nightsLabel, periodLabel, TITLE_MAX, type DateRangeSel } from '../../../core/trip/create';
import { datesBrief, droppedDates, quickEditPatch } from '../../../core/trip/edit';
import { josa } from '../../../core/util';
import { useNow } from '../../../services/clock';
import { myMemberId, useTripDoc, useTrips } from '../../../store/trips';
import { useUi } from '../../../store/ui';
import { Btn, Chip, Field, SP, Sheet, Txt } from '../../../ui';
import { CalendarRange } from './CalendarRange';
import { CoverPicker } from './CoverPicker';
import { PickerBox } from './PickerBox';

/**
 * 여행방 빠른 수정(2026-10-10). 홈 여행 카드의 '수정'에서 연다. 표지·이름·날짜를 한 번에 바꾼다(trip/update 하나).
 * 방장만 바꾼다(trip/update 권한). 여행이 끝난 방은 이름·표지만 바꿀 수 있다(날짜는 잠금).
 * 지역·이동수단·기점 같은 나머지는 여행방 설정(25)에서 바꾼다.
 */
const SHEET_BODY_MAX_H = 520;

export function TripEditSheet({ tripId, onClose, onMore }: { tripId?: string; onClose: () => void; onMore?: (tripId: string) => void }) {
  const trip = useTripDoc(tripId);
  const dispatch = useTrips((s) => s.dispatch);
  const now = useNow(60_000);
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<TripCover | null | undefined>(undefined);
  const [range, setRange] = useState<DateRangeSel>({});
  const [calendar, setCalendar] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // 열 때마다 지금 값에서 시작한다
  useEffect(() => {
    if (!trip) return;
    setTitle(trip.title);
    setCover(undefined);
    setRange({ start: trip.startDate, end: trip.endDate });
    setCalendar(false);
    setProblem(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  if (!trip) return null;
  const me = myMemberId(trip);
  const host = !!me && isHost(trip, me);
  const locked = isEditLocked(trip, now);
  const shownCover = cover === null ? undefined : (cover ?? trip.cover);
  const patch = quickEditPatch(trip, { title, cover, startDate: range.start, endDate: range.end }, locked);
  const changed = Object.keys(patch).length > 0;
  const dropped = !locked && range.start && range.end ? droppedDates(trip, range.start, range.end) : [];

  const save = () => {
    if (!changed) return onClose();
    const r = dispatch(trip.id, { type: 'trip/update', patch });
    if (!r.ok) return setProblem(r.reason);
    useUi.getState().showToast('여행방을 고쳤어요');
    onClose();
  };

  return (
    <Sheet visible={tripId != null} onClose={onClose} title="여행방 수정">
      {!host ? (
        <Txt v="mt">방장만 표지, 이름, 날짜를 바꿀 수 있어요.</Txt>
      ) : (
        <ScrollView style={{ maxHeight: SHEET_BODY_MAX_H }} contentContainerStyle={{ gap: SP.xl }} keyboardShouldPersistTaps="handled">
          <CoverPicker value={shownCover} onChange={setCover} />
          <Field label="여행방 이름" value={title} onChangeText={setTitle} maxLength={TITLE_MAX} />
          <PickerBox
            label="날짜"
            icon="cal"
            value={range.start && range.end ? periodLabel(range.start, range.end) : undefined}
            placeholder="달력에서 시작일과 종료일 고르기"
            trailing={range.start && range.end ? <Chip text={nightsLabel(range.start, range.end)} tone="line" /> : undefined}
            help={locked ? '끝난 여행은 날짜를 바꿀 수 없어요' : undefined}
            disabled={locked}
            onPress={() => setCalendar((v) => !v)}
          />
          {calendar && !locked ? (
            <CalendarRange value={range} onChange={setRange} initialMonth={(range.start ?? trip.startDate).slice(0, 7)} />
          ) : null}
          {dropped.length > 0 ? (
            <Txt v="mtTight" c="warn">{`${josa(datesBrief(dropped), '이/가')} 기간에서 빠집니다. 그날로 정한 스팟은 기간 밖으로 제외돼요.`}</Txt>
          ) : null}
          {problem ? (
            <Txt v="mtTight" c="warn">
              {problem}
            </Txt>
          ) : null}
        </ScrollView>
      )}
      {host ? (
        <Btn title="저장" disabled={!changed || !title.trim() || !range.start || !range.end} onPress={save} />
      ) : null}
      {onMore ? <Btn title="여행방 설정 열기" variant="quiet" size="sm" onPress={() => onMore(trip.id)} /> : null}
    </Sheet>
  );
}
