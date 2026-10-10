import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import type { DayBase, Transport } from '../types';
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
import { PickerBox } from '../features/trip/components/PickerBox';
import { RegionSheet } from '../features/trip/components/RegionSheet';
import { TimeRange } from '../features/trip/components/TimeRange';
import type { RootScreenProps } from '../navigation/routes';
import { appClock } from '../services/clock';
import { useSession } from '../store/session';
import { useTrips } from '../store/trips';
import {
  Body,
  Btn,
  Chip,
  Choice,
  ConfirmSheet,
  Field,
  Foot,
  Header,
  Notice,
  Row,
 
  Screen,
  Sheet,
  SP,
  Txt,
} from '../ui';

/**
 * 04 여행방 만들기(FR-201·205·504, WP2 소유). 목업 04 순서: 이름, 지역, 날짜, 기점, 주 이동수단, 하루 활동시간.
 * - 지역은 국내 목록에서만, 날짜는 달력 범위 선택(텍스트 입력 없음)이다. 종료일 < 시작일은 달력에서 만들 수 없고 판정도 거부한다.
 * - 15일 이상이면 확인 창을 한 번 띄우고 확인하면 만든다.
 * - 기점은 선택 입력이다. 검색 0건이면 '결과 없음'을 알리고 기점 없이(base null) 만들 수 있다. 그날 첫 스팟이 기점이 된다.
 * - 대중교통은 2차 기능이다. 칸이 좁아(110px) 아이콘을 빼고 ScopeBadge는 '주 이동수단' 라벨 줄에 둔다.
 * 다음 버튼은 14 멤버 초대로 간다. 단계 표시는 '1 / 2 단계'다(여행방 만들기 → 멤버 초대). 목업 04의 '2 / 3 단계'는
 * 앞 단계가 있던 시안의 숫자라 첫 화면에서 2로 시작해 어색했다(2026-10-09 웹 실행). 판정은 core/trip/create(wp2-trip 테스트).
 */
export default function CreateTripScreen({ navigation }: RootScreenProps<'CreateTrip'>) {
  const createTrip = useTrips((s) => s.createTrip);
  const session = useSession((s) => s.session);
  const profileName = useSession((s) => s.profile.nickname);
  const today = kstDate(appClock().now());

  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [regionId, setRegionId] = useState('');
  const [range, setRange] = useState<DateRangeSel>({});
  const [base, setBase] = useState<DayBase | null | undefined>(undefined);
  const [transport, setTransport] = useState<Transport>('car');
  const [hours, setHours] = useState({ start: '09:00', end: '21:00' });
  const [sheet, setSheet] = useState<'region' | 'dates' | 'base' | 'long' | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);
  const [baseCategory, setBaseCategory] = useState<string | undefined>(undefined);
  /** 만들기는 한 번만(빠르게 두 번 누르면 여행방이 두 개 생기지 않게) */
  const made = useRef(false);

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
    <Screen>
      <Header
        back={navigation.canGoBack() ? navigation.goBack : undefined}
        step="1 / 2 단계"
        title="여행방 만들기"
      />
      <Body scroll>
        <Field
          label="여행방 이름"
          value={shownTitle}
          onChangeText={(v) => {
            setTitle(v);
            setTitleTouched(true);
          }}
          maxLength={TITLE_MAX}
          placeholder="예: 경주 2박 3일"
          error={err.title}
        />
        <PickerBox
          label="지역"
          icon="pin"
          value={region?.label}
          placeholder="국내 지역 목록에서 고르기"
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
        <PickerBox
          label="기점 · 선택"
          icon="pin"
          value={baseValue}
          placeholder="숙소나 출발할 곳 찾기"
          trailing={base && baseCategory ? <Txt v="mt">{baseCategory}</Txt> : null}
          onPress={() => setSheet('base')}
          disabled={!region}
        />
        <View style={{ gap: SP.s }}>
          <Row gap={SP.s}>
            <Txt v="label">주 이동수단</Txt>
            <View style={{ flex: 1 }} />
            <Txt v="mtTight">대중교통</Txt>
          </Row>
          <Choice<Transport>
            options={[
              { key: 'car', label: '자동차', icon: 'car' },
              { key: 'walk', label: '도보', icon: 'walk' },
              { key: 'transit', label: '대중교통' },
            ]}
            value={transport}
            onChange={setTransport}
          />
        </View>
        <View style={{ gap: SP.s }}>
          <Txt v="label">하루 활동시간</Txt>
          <TimeRange start={hours.start} end={hours.end} title="하루 활동시간" onChange={(v) => setHours(v)} />
          {err.hours ? (
            <Txt v="mtTight" c="warn">
              {err.hours}
            </Txt>
          ) : null}
        </View>
      </Body>
      <Foot>
        {submitted && !check.ok ? <Notice tone="warn" icon="alert" text="빠진 값을 채워 주세요." /> : null}
        <Btn title="다음 · 멤버 초대" disabled={made.current} onPress={next} />
      </Foot>

      <RegionSheet
        visible={sheet === 'region'}
        value={regionId}
        onClose={() => setSheet(undefined)}
        onPick={(id) => {
          if (id !== regionId) {
            setBase(undefined);
            setBaseCategory(undefined);
          }
          setRegionId(id);
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
        text="15일 이상인 여행입니다. 날짜가 많으면 계산과 편집이 길어질 수 있습니다. 기간이 맞으면 그대로 만듭니다."
        confirmLabel="이대로 만들기"
        onConfirm={() => {
          setSheet(undefined);
          make();
        }}
        onCancel={() => setSheet(undefined)}
      />
    </Screen>
  );
}
