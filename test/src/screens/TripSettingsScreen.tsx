import React, { useEffect, useRef, useState } from 'react';

import type { DaySetting, Transport } from '../types';
import { TRANSPORT_LABEL } from '../core/constants';
import { isHost, tripMode } from '../core/group';
import { isEditLocked, LOCKED_REASON } from '../core/ops';
import { dateLong, dayHours, nightsLabel, periodLabel, TITLE_MAX, type DateRangeSel } from '../core/trip/create';
import { basesToClear, datesBrief, droppedDates } from '../core/trip/edit';
import { dateWithYear } from '../core/trip/format';
import { retentionUntil } from '../core/tripStatus';
import { dateRange, josa } from '../core/util';
import { regionById } from '../data/regions';
import { CalendarRange } from '../features/trip/components/CalendarRange';
import { DaySheet } from '../features/trip/components/DaySheet';
import { CoverPicker } from '../features/trip/components/CoverPicker';
import { PickerBox } from '../features/trip/components/PickerBox';
import { RegionSheet } from '../features/trip/components/RegionSheet';
import { TimeRange } from '../features/trip/components/TimeRange';
import { dayRowSub } from '../features/trip/dayRows';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useNow } from '../services/clock';
import { myMemberId, useTripDoc, useTrips } from '../store/trips';
import {
  Body,
  Btn,
  Card,
  Chip,
  Choice,
  Col,
  ConfirmSheet,
  Field,
  Header,
  ListRow,
  Notice,
  NotFound,
  Row,
  Screen,
  Sheet,
  SP,
  Txt,
} from '../ui';

/**
 * 25 여행방 설정(FR-201·204·205, 데이터 보존, WP2 소유).
 * - 머리말은 제목 '여행방 설정'과 보조 줄 '지역 · 기간'이다. 이름은 방장이 칸에서 바로 고치고, Enter·칸 벗어나기·뒤로에서 저장한다
 *   (따로 '저장' 버튼이 없다. 빈 이름은 저장하지 않고 원래 이름으로 돌린다).
 * - 날짜별 기점: 날짜마다 한 줄(ListRow, 제목 '10월 17일 (금)', 보조 줄 dayRowSub)이고, 그날만 바꾼 활동시간이 있으면 '이날만' 칩.
 *   줄을 누르면 DaySheet에서 지정(장소 검색), 직전 날짜와 같음('inherit'), 기점 없음(첫 스팟 사용, null), 복귀 없음, 이날 활동시간을 바꾼다.
 *   전부 trip/setDay{date,patch}이고 전 멤버가 바꿀 수 있다. 하루 이동수단(transport)은 건드리지 않는다(시간표 12 화면).
 * - 멤버 초대 · 관리, 보관 기한은 ListRow 두 줄이다. 오프라인 안내는 앱 공용 OfflineBar 한 줄이 맡는다(화면 Notice 없음).
 *   멤버 화면(머리말 gear)과 서로 오갈 때는 화면을 쌓지 않고 스택에 이미 있는 화면으로 돌아간다(navigate pop, 멤버는 merge로 fromCreate 유지).
 * - 이름·지역·날짜·주 이동수단·기본 활동시간은 trip/update라 방장만(프로토타입 가정). 만든 뒤에도 방장이 바꿀 수 있다(2026-10-10).
 * - 표지 이미지도 방장이 바꾼다. 이름·표지는 여행이 끝난 뒤에도 바꿀 수 있다(core/ops TRIP_PATCH_KEYS_AFTER_END).
 *   지역을 바꾸면 장소로 정한 날짜별 기점을 비운다(확인 1회). 기간이 줄어 빠지는 날짜가 있으면 확인 1회 뒤 바꾼다.
 *   바꾸면 루트를 다시 계산한다(needsRecompute). 그룹원에게는 값만 보인다.
 * - 방장은 삭제(확인 1회), 그룹원은 나가기(확인 1회). 방장에게는 나가기 버튼 없이 '나갈 수 없어요' 한 줄만 처음부터 보인다
 *   (validate 거부 경로는 core에 그대로 있다).
 * - 삭제는 모든 멤버 목록에서 바로 사라지는 삭제 표시(deletedAt)다. 내용은 보관 기한까지 각 기기에 남았다가 지워진다(확인 문구에 적는다).
 * - 종료된 방은 입력 칸을 읽기 전용 모양(off 면 또는 글자)으로 바꾼다.
 * - 보관 기한(종료 다음 날 00:00 KST + 1년) 표시. 종료된 방은 편집이 잠긴다(일기·사진은 계속).
 */
export default function TripSettingsScreen({ navigation, route }: RootScreenProps<'TripSettings'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const dispatch = useTrips((s) => s.dispatch);
  const now = useNow(60_000);
  const goBack = useBack('Home');

  const [dayFor, setDayFor] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<'delete' | 'leave' | 'region' | 'dates' | undefined>(undefined);
  const [edit, setEdit] = useState<'region' | 'dates' | undefined>(undefined);
  const [range, setRange] = useState<DateRangeSel>({});
  const [nextRegion, setNextRegion] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState<string | undefined>(undefined);
  /** 마지막으로 보낸 이름. Enter 뒤 칸 벗어나기, 칸 벗어나기 뒤 뒤로처럼 연달아 불려도 같은 op를 두 번 보내지 않는다 */
  const sentTitle = useRef<string | undefined>(undefined);
  /** 하드웨어 뒤로·몸짓 뒤로처럼 back()을 거치지 않고 나갈 때도 고친 이름을 저장한다(마지막 렌더의 saveTitle) */
  const saveOnLeave = useRef<() => void>(() => undefined);
  useEffect(() => navigation.addListener('beforeRemove', () => saveOnLeave.current()), [navigation]);

  const home = () => navigation.reset({ index: 0, routes: [{ name: 'Main', params: { screen: 'Home' } }] });
  const me = trip ? myMemberId(trip) : undefined;

  if (!trip || trip.deletedAt != null || !me) {
    return (
      <Screen>
        <Header back={goBack} title="여행방 설정" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={home} />
        </Body>
      </Screen>
    );
  }

  const host = isHost(trip, me);
  const locked = isEditLocked(trip, now);
  const region = regionById(trip.region);
  const dates = dateRange(trip.startDate, trip.endDate);

  const setDay = (date: string, patch: Partial<Pick<DaySetting, 'base' | 'noReturn' | 'dayStart' | 'dayEnd'>>) =>
    dispatch(trip.id, { type: 'trip/setDay', date, patch });

  const applyRegion = (id: string) => {
    const r = dispatch(trip.id, { type: 'trip/update', patch: { region: id } });
    if (!r.ok) return;
    for (const date of basesToClear(trip.days)) setDay(date, { base: null });
  };
  const pickRegion = (id: string) => {
    setEdit(undefined);
    if (id === trip.region) return;
    if (basesToClear(trip.days).length > 0) {
      setNextRegion(id);
      setConfirm('region');
      return;
    }
    applyRegion(id);
  };

  const openDates = () => {
    setRange({ start: trip.startDate, end: trip.endDate });
    setEdit('dates');
  };
  const applyDates = (start: string, end: string) => dispatch(trip.id, { type: 'trip/update', patch: { startDate: start, endDate: end } });
  const pickDates = () => {
    setEdit(undefined);
    const { start, end } = range;
    if (!start || !end || (start === trip.startDate && end === trip.endDate)) return;
    if (droppedDates(trip, start, end).length > 0) {
      setConfirm('dates');
      return;
    }
    applyDates(start, end);
  };
  const dropped = range.start && range.end ? droppedDates(trip, range.start, range.end) : [];

  const saveTitle = () => {
    if (title == null) return;
    const t = title.trim();
    if (!host || locked || !t || t === trip.title || t === sentTitle.current) return setTitle(undefined);
    const r = dispatch(trip.id, { type: 'trip/update', patch: { title: t } });
    if (r.ok) {
      sentTitle.current = t;
      setTitle(undefined);
    }
  };
  saveOnLeave.current = saveTitle;
  const back = () => {
    saveTitle();
    goBack();
  };

  return (
    <Screen>
      <Header back={back} title="여행방 설정" sub={`${region?.label ?? trip.region} · ${periodLabel(trip.startDate, trip.endDate)}`} />
      <Body scroll>
        {locked ? <Notice icon="alert" title="여행이 끝났어요" text={LOCKED_REASON} /> : null}

        <Txt v="eyebrow">기본 정보</Txt>
        <Card>
          {host ? (
            <CoverPicker value={trip.cover} onChange={(cover) => dispatch(trip.id, { type: 'trip/update', patch: { cover } })} />
          ) : null}
          {host ? (
            <Field
              label="여행방 이름"
              value={title ?? trip.title}
              onChangeText={setTitle}
              maxLength={TITLE_MAX}
              returnKeyType="done"
              onSubmitEditing={saveTitle}
              onBlur={saveTitle}
            />
          ) : (
            <Txt v="nm">{trip.title}</Txt>
          )}
          {host && !locked ? (
            <Col gap={SP.m}>
              <PickerBox label="지역" icon="pin" value={region?.label ?? trip.region} onPress={() => setEdit('region')} />
              <PickerBox
                label="날짜"
                icon="cal"
                value={periodLabel(trip.startDate, trip.endDate)}
                trailing={<Chip text={nightsLabel(trip.startDate, trip.endDate)} tone="line" />}
                onPress={openDates}
              />
              <Col gap={SP.s}>
                <Txt v="label">주 이동수단</Txt>
                <Choice<Transport>
                  options={[
                    { key: 'car', label: '자동차', icon: 'car' },
                    { key: 'walk', label: '도보', icon: 'walk' },
                    { key: 'transit', label: '대중교통' },
                  ]}
                  value={trip.transport}
                  onChange={(t) => {
                    if (t !== trip.transport) dispatch(trip.id, { type: 'trip/update', patch: { transport: t } });
                  }}
                />
              </Col>
            </Col>
          ) : (
            <Txt v="mt">{`${region?.label ?? trip.region} · ${periodLabel(trip.startDate, trip.endDate)} · ${TRANSPORT_LABEL[trip.transport]}`}</Txt>
          )}
          <TimeRange
            label="기본 활동시간"
            start={trip.dayStart}
            end={trip.dayEnd}
            disabled={!host || locked}
            onChange={(v) => dispatch(trip.id, { type: 'trip/update', patch: { dayStart: v.start, dayEnd: v.end } })}
          />
          <Row gap={SP.s}>
            <Chip text={tripMode(trip) === 'group' ? '그룹방' : '개인 모드'} tone="line" />
          </Row>
        </Card>

        <Txt v="eyebrow">날짜별 기점</Txt>
        <Col>
          {dates.map((date, i) => (
            <ListRow
              key={date}
              first={i === 0}
              label={dateLong(date)}
              sub={dayRowSub(trip, date)}
              right={dayHours(trip, date).custom ? <Chip text="이날만" tone="soft" /> : null}
              onPress={locked ? undefined : () => setDayFor(date)}
            />
          ))}
        </Col>

        <Txt v="eyebrow">멤버 · 보관</Txt>
        <Col>
          <ListRow
            first
            icon="users"
            label="멤버 초대 · 관리"
            sub="초대 링크, 초대 권한, 내보내기"
            onPress={() => navigation.navigate('Members', { tripId: trip.id }, { pop: true, merge: true })}
          />
          <ListRow icon="clock" label="보관 기한" value={`${dateWithYear(retentionUntil(trip))}까지`} />
        </Col>

        <Txt v="eyebrow">{host ? '삭제 · 나가기' : '나가기'}</Txt>
        {host ? (
          <Col gap={SP.m}>
            <Btn title="여행방 삭제" variant="quiet" icon="trash" onPress={() => setConfirm('delete')} />
            <Txt v="mtTight">방장은 여행방을 나갈 수 없어요 · 방장 위임은 아직 지원하지 않아요</Txt>
          </Col>
        ) : (
          <Btn title="여행방 나가기" variant="quiet" onPress={() => setConfirm('leave')} />
        )}
      </Body>

      <DaySheet
        visible={dayFor != null}
        trip={trip}
        date={dayFor}
        region={region}
        locked={locked}
        onClose={() => setDayFor(undefined)}
        onSet={(patch) => {
          if (dayFor) setDay(dayFor, patch);
        }}
      />
      <RegionSheet visible={edit === 'region'} value={trip.region} onClose={() => setEdit(undefined)} onPick={pickRegion} />
      <Sheet visible={edit === 'dates'} onClose={() => setEdit(undefined)} title="날짜 바꾸기">
        <CalendarRange value={range} onChange={setRange} initialMonth={(range.start ?? trip.startDate).slice(0, 7)} />
        {dropped.length > 0 ? (
          <Txt v="mtTight" c="warn">{`${josa(datesBrief(dropped), '이/가')} 기간에서 빠져요`}</Txt>
        ) : null}
        <Btn title="이 날짜로" disabled={!range.start || !range.end} onPress={pickDates} />
      </Sheet>
      <ConfirmSheet
        visible={confirm === 'region'}
        title="지역을 바꿀까요"
        text={`${josa(regionById(nextRegion ?? '')?.label ?? '', '으로/로')} 바꾸면 날짜별로 정한 기점(숙소)을 비워요. 후보와 시간표는 그대로 남으니 이전 지역의 장소는 직접 정리해 주세요. 루트는 다시 계산해요.`}
        confirmLabel="바꾸기"
        onConfirm={() => {
          setConfirm(undefined);
          if (nextRegion) applyRegion(nextRegion);
          setNextRegion(undefined);
        }}
        onCancel={() => {
          setConfirm(undefined);
          setNextRegion(undefined);
        }}
      />
      <ConfirmSheet
        visible={confirm === 'dates'}
        title="날짜를 바꿀까요"
        text={`${josa(datesBrief(dropped), '이/가')} 기간에서 빠져요. 그날의 기점·활동시간 설정은 사라지고, 그날로 날짜를 정한 스팟은 '여행 기간 밖'으로 제외돼요. 루트는 다시 계산해요.`}
        confirmLabel="바꾸기"
        onConfirm={() => {
          setConfirm(undefined);
          if (range.start && range.end) applyDates(range.start, range.end);
        }}
        onCancel={() => setConfirm(undefined)}
      />
      <RegionSheet visible={edit === 'region'} value={trip.region} onClose={() => setEdit(undefined)} onPick={pickRegion} />
      <Sheet visible={edit === 'dates'} onClose={() => setEdit(undefined)} title="날짜 바꾸기">
        <CalendarRange value={range} onChange={setRange} initialMonth={(range.start ?? trip.startDate).slice(0, 7)} />
        {dropped.length > 0 ? (
          <Txt v="mtTight" c="warn">{`${josa(datesBrief(dropped), '이/가')} 기간에서 빠집니다`}</Txt>
        ) : null}
        <Btn title="이 날짜로" disabled={!range.start || !range.end} onPress={pickDates} />
      </Sheet>
      <ConfirmSheet
        visible={confirm === 'region'}
        title="지역을 바꿀까요"
        text={`${josa(regionById(nextRegion ?? '')?.label ?? '', '으로/로')} 바꾸면 날짜별로 정한 기점(숙소)을 비웁니다. 후보와 시간표는 그대로 남으니 이전 지역의 장소는 직접 정리해 주세요. 루트는 다시 계산합니다.`}
        confirmLabel="바꾸기"
        onConfirm={() => {
          setConfirm(undefined);
          if (nextRegion) applyRegion(nextRegion);
          setNextRegion(undefined);
        }}
        onCancel={() => {
          setConfirm(undefined);
          setNextRegion(undefined);
        }}
      />
      <ConfirmSheet
        visible={confirm === 'dates'}
        title="날짜를 바꿀까요"
        text={`${josa(datesBrief(dropped), '이/가')} 기간에서 빠집니다. 그날의 기점·활동시간 설정은 사라지고, 그날로 날짜를 정한 스팟은 '여행 기간 밖'으로 제외됩니다. 루트는 다시 계산합니다.`}
        confirmLabel="바꾸기"
        onConfirm={() => {
          setConfirm(undefined);
          if (range.start && range.end) applyDates(range.start, range.end);
        }}
        onCancel={() => setConfirm(undefined)}
      />
      <ConfirmSheet
        visible={confirm === 'delete'}
        title="여행방을 삭제할까요"
        text="모든 멤버의 목록에서 바로 사라지고 되돌릴 수 없어요. 후보, 시간표, 채팅, 사진과 일기는 더 이상 볼 수 없고, 각 기기에 남은 사본은 보관 기한이 지나면 지워져요."
        confirmLabel="삭제"
        onConfirm={() => {
          setConfirm(undefined);
          const r = dispatch(trip.id, { type: 'trip/delete' });
          if (r.ok) home();
        }}
        onCancel={() => setConfirm(undefined)}
      />
      <ConfirmSheet
        visible={confirm === 'leave'}
        title="여행방에서 나갈까요"
        text="내가 제안한 후보와 채팅은 '나간 멤버'로 남아요. 다시 들어오려면 초대 링크가 필요해요."
        confirmLabel="나가기"
        onConfirm={() => {
          setConfirm(undefined);
          const r = dispatch(trip.id, { type: 'member/leave', memberId: me });
          if (r.ok) home();
        }}
        onCancel={() => setConfirm(undefined)}
      />
    </Screen>
  );
}
