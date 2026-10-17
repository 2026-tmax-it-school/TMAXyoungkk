import type { NavigationAction } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { DayBase, Transport, TripCover } from '../types';
import {
  buildDays,
  checkTripForm,
  nightsLabel,
  periodLabel,
  suggestTitle,
  TITLE_MAX,
  type DateRangeSel,
} from '../core/trip/create';
import { kstDate } from '../core/util';
import { regionById } from '../data/regions';
import { BaseSearchSheet } from '../features/trip/components/BaseSearchSheet';
import { CalendarRange } from '../features/trip/components/CalendarRange';
import { CoverPicker } from '../features/trip/components/CoverPicker';
import { PickerBox } from '../features/trip/components/PickerBox';
import { RegionSheet } from '../features/trip/components/RegionSheet';
import { TimeRange } from '../features/trip/components/TimeRange';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { appClock } from '../services/clock';
import { useSession } from '../store/session';
import { useTrips } from '../store/trips';
import {
  Body,
  Btn,
  Chip,
  Choice,
  Col,
  ConfirmSheet,
  Field,
  Foot,
  Header,
  Notice,
  Screen,
  Sheet,
  SP,
  Txt,
} from '../ui';

/** 지역 시트가 내려간 뒤 날짜 시트를 올리는 간격(모달 두 개가 한꺼번에 오가면 iOS가 뒤의 것을 띄우지 못한다) */
const SHEET_SWAP_MS = 350;

/**
 * 04 여행방 만들기(FR-201·205·504, WP2 소유). 칸 순서: 지역, 날짜, 여행방 이름, 주 이동수단, '선택' 아래 기점과 하루 활동시간.
 * - 지역을 먼저 고르게 해서 이름(suggestTitle)이 미리 채워진다. 이름을 직접 고치면(titleTouched) 그 뒤로는 제안을 덮어쓰지 않는다.
 *   지역을 고른 뒤 날짜가 비어 있으면 날짜 시트를 바로 연다. route.params.regionId가 있으면 그 지역으로 시작한다.
 * - 지역은 국내 목록에서만, 날짜는 달력 범위 선택(텍스트 입력 없음)이다. 종료일 < 시작일은 달력에서 만들 수 없고 판정도 거부한다.
 * - 15일 이상이면 확인 창을 한 번 띄우고 확인하면 만든다.
 * - 기점은 선택 입력이다. 검색 0건이면 '결과 없음'을 알리고 기점 없이(base null) 만들 수 있다. 그날 첫 스팟이 기점이 된다.
 * - 대중교통은 2차 기능이다. 칸이 좁아(110px) 아이콘을 뺀다.
 * 주 버튼 '만들고 멤버 초대하기'는 14 멤버 초대로 간다(replace). 단계 표시는 '1 / 2 단계'다(여행방 만들기 → 멤버 초대).
 * 무엇이든 입력한 뒤 만들기 전에 나가면(뒤로, 하드웨어 뒤로, 다른 화면) beforeRemove에서 확인 시트를 한 번 띄운다.
 * 만든 뒤의 replace('Members')는 made.current로 통과시킨다. 판정은 core/trip/create(wp2-trip 테스트).
 */
export default function CreateTripScreen({ navigation, route }: RootScreenProps<'CreateTrip'>) {
  const createTrip = useTrips((s) => s.createTrip);
  const session = useSession((s) => s.session);
  const profileName = useSession((s) => s.profile.nickname);
  const today = kstDate(appClock().now());
  const back = useBack('Home');

  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<TripCover | undefined>(undefined);
  const [titleTouched, setTitleTouched] = useState(false);
  /** 들어올 때 받은 지역(route.params.regionId). 목록에 없는 값은 버린다. 나가기 확인은 이 값에서 바뀌었는지로 본다 */
  const [startRegion] = useState(() => {
    const id = route.params?.regionId ?? '';
    return regionById(id) ? id : '';
  });
  const [regionId, setRegionId] = useState(startRegion);
  const [range, setRange] = useState<DateRangeSel>({});
  const [base, setBase] = useState<DayBase | null | undefined>(undefined);
  const [transport, setTransport] = useState<Transport>('car');
  const [hours, setHours] = useState({ start: '09:00', end: '21:00' });
  const [sheet, setSheet] = useState<'region' | 'dates' | 'base' | 'long' | 'leave' | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);
  const [baseCategory, setBaseCategory] = useState<string | undefined>(undefined);
  /** 만들기는 한 번만(빠르게 두 번 누르면 여행방이 두 개 생기지 않게). 만든 뒤의 화면 전환은 나가기 확인을 건너뛴다 */
  const made = useRef(false);
  /** 지역을 고른 뒤 날짜 시트를 이어서 열지 */
  const datesNext = useRef(false);
  /** 나가기 확인에서 '그만 만들기'를 누른 뒤 다시 보내는 이동 */
  const leaveAction = useRef<NavigationAction | undefined>(undefined);

  const region = regionById(regionId);
  const suggested = suggestTitle(regionId, range.start, range.end);
  const shownTitle = titleTouched ? title : suggested;
  const check = useMemo(
    () =>
      checkTripForm({
        title: shownTitle,
        regionId,
        startDate: range.start,
        endDate: range.end,
        dayStart: hours.start,
        dayEnd: hours.end,
      }),
    [shownTitle, regionId, range.start, range.end, hours.start, hours.end],
  );
  const err = submitted ? check.errors : {};
  const touched =
    titleTouched || regionId !== startRegion || !!range.start || base !== undefined || transport !== 'car' || hours.start !== '09:00' || hours.end !== '21:00';

  // 만들기 전에 나가면 확인 1회. 확인하면 막았던 이동(e.data.action)을 그대로 보낸다.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (made.current || !touched || leaveAction.current) return;
        e.preventDefault();
        leaveAction.current = e.data.action;
        setSheet('leave');
      }),
    [navigation, touched],
  );
  const leave = () => {
    const action = leaveAction.current;
    setSheet(undefined);
    if (action) navigation.dispatch(action);
  };

  const make = () => {
    if (!range.start || !range.end || made.current) return;
    made.current = true;
    const tripId = createTrip({
      title: shownTitle.trim(),
      region: regionId,
      startDate: range.start,
      endDate: range.end,
      transport,
      dayStart: hours.start,
      dayEnd: hours.end,
      days: buildDays(range.start, range.end, base ?? null),
      hostNickname: session?.nickname || profileName || '나',
      cover,
    });
    navigation.replace('Members', { tripId, fromCreate: true });
  };

  const next = () => {
    setSubmitted(true);
    if (!check.ok) return;
    if (check.needsLongConfirm) {
      setSheet('long');
      return;
    }
    make();
  };

  const baseValue = base ? base.name : base === null ? '기점 없음 · 그날 첫 스팟 사용' : undefined;

  return (
    <Screen keyboard>
      <Header back={back} step="1 / 2 단계" title="여행방 만들기" />
      <Body scroll>
        <CoverPicker value={cover} onChange={(c) => setCover(c ?? undefined)} />
        <PickerBox
          label="지역"
          icon="pin"
          value={region?.label}
          placeholder="지역 검색 또는 지도에서 고르기"
          onPress={() => setSheet('region')}
          error={err.region}
        />
        <PickerBox
          label="날짜"
          icon="cal"
          value={range.start && range.end ? periodLabel(range.start, range.end) : undefined}
          placeholder="달력에서 시작일과 종료일 고르기"
          trailing={range.start && range.end ? <Chip text={nightsLabel(range.start, range.end)} tone="line" /> : null}
          onPress={() => setSheet('dates')}
          error={err.order ?? err.dates}
        />
        <Field
          label="여행방 이름"
          value={shownTitle}
          onChangeText={(v) => {
            setTitle(v);
            setTitleTouched(true);
          }}
          maxLength={TITLE_MAX}
          returnKeyType="done"
          error={err.title}
        />
        <Col gap={SP.s}>
          <Txt v="label">주 이동수단</Txt>
          <Choice<Transport>
            options={[
              { key: 'car', label: '자동차', icon: 'car' },
              { key: 'walk', label: '도보', icon: 'walk' },
              { key: 'transit', label: '대중교통' },
            ]}
            value={transport}
            onChange={setTransport}
          />
        </Col>
        <Txt v="eyebrow">선택</Txt>
        <PickerBox
          label="기점"
          icon="search"
          value={baseValue}
          placeholder="숙소나 출발할 곳 찾기"
          trailing={base && baseCategory ? <Txt v="mtTight">{baseCategory}</Txt> : null}
          help={region ? undefined : '지역을 고르면 찾을 수 있어요'}
          onPress={() => setSheet('base')}
          disabled={!region}
        />
        <TimeRange label="하루 활동시간" start={hours.start} end={hours.end} error={err.hours} onChange={(v) => setHours(v)} />
      </Body>
      <Foot>
        {submitted && !check.ok ? <Notice tone="warn" icon="alert" text="빠진 값을 채워 주세요." /> : null}
        <Btn title="만들고 멤버 초대하기" disabled={made.current} onPress={next} />
      </Foot>

      <RegionSheet
        visible={sheet === 'region'}
        value={regionId}
        onClose={() => {
          setSheet((s) => (s === 'region' ? undefined : s));
          if (!datesNext.current) return;
          datesNext.current = false;
          setTimeout(() => setSheet((s) => s ?? 'dates'), SHEET_SWAP_MS);
        }}
        onPick={(id) => {
          if (id !== regionId) {
            setBase(undefined);
            setBaseCategory(undefined);
          }
          setRegionId(id);
          if (!range.start || !range.end) datesNext.current = true;
        }}
      />
      <Sheet visible={sheet === 'dates'} onClose={() => setSheet(undefined)} title="날짜 고르기">
        <CalendarRange value={range} onChange={setRange} initialMonth={(range.start ?? today).slice(0, 7)} minDate={today} />
        {range.start && range.end ? (
          <Txt v="mtTight">{`${periodLabel(range.start, range.end)} · ${nightsLabel(range.start, range.end)}`}</Txt>
        ) : null}
        <Btn title="이 날짜로" disabled={!range.start || !range.end} onPress={() => setSheet(undefined)} />
      </Sheet>
      <BaseSearchSheet
        visible={sheet === 'base'}
        region={region}
        onClose={() => setSheet((s) => (s === 'base' ? undefined : s))}
        onPick={(b, place) => {
          setBase(b);
          setBaseCategory(b ? place?.category || undefined : undefined);
        }}
        noneLabel="기점 없이 만들기(첫 스팟 사용)"
      />
      <ConfirmSheet
        visible={sheet === 'long'}
        title={`${check.days}일 여행방을 만들까요`}
        text="15일 이상인 여행이에요. 날짜가 많으면 계산과 편집이 길어질 수 있어요. 기간이 맞으면 그대로 만들어요."
        confirmLabel="이대로 만들기"
        onConfirm={() => {
          setSheet(undefined);
          make();
        }}
        onCancel={() => setSheet(undefined)}
      />
      <ConfirmSheet
        visible={sheet === 'leave'}
        title="여행방 만들기를 그만할까요"
        text="고른 지역과 날짜, 적은 이름은 남지 않아요."
        confirmLabel="그만 만들기"
        cancelLabel="계속 만들기"
        onConfirm={leave}
        onCancel={() => {
          leaveAction.current = undefined;
          setSheet(undefined);
        }}
      />
    </Screen>
  );
}
