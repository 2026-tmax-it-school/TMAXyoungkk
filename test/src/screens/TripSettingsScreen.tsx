import React, { useState } from 'react';
import { View } from 'react-native';

import type { DayBase, DaySetting, Trip } from '../types';
import { isHost, tripMode } from '../core/group';
import { isEditLocked, LOCKED_REASON } from '../core/ops';
import { MEMBER_REASON } from '../core/ops/members';
import { baseModeOf, dayHours, effectiveBase, periodLabel, TITLE_MAX, type BaseMode } from '../core/trip/create';
import { dateWithYear } from '../core/trip/format';
import { retentionUntil } from '../core/tripStatus';
import { dateRange, dayLabel } from '../core/util';
import { regionById } from '../data/regions';
import { BaseSearchSheet } from '../features/trip/components/BaseSearchSheet';
import { PickerBox } from '../features/trip/components/PickerBox';
import { TimeRange } from '../features/trip/components/TimeRange';
import type { RootScreenProps } from '../navigation/routes';
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
  Empty,
  Field,
  Header,
  Icon,
  Notice,
  Row,
  Screen,
  SP,
  Tag,
  Txt,
} from '../ui';

/**
 * 25 여행방 설정(FR-201·204·205, 데이터 보존, WP2 소유).
 * - 날짜별 기점: 지정(장소 검색), 직전 날짜와 같음('inherit'), 기점 없음(첫 스팟 사용, null), 복귀 없음, 날짜별 활동시간.
 *   전부 trip/setDay{date,patch}이고 전 멤버가 바꿀 수 있다. 하루 이동수단(transport)은 건드리지 않는다(시간표 12 화면).
 * - 이름·기본 활동시간은 trip/update라 방장만(프로토타입 가정).
 * - 방장은 삭제(확인 1회), 그룹원은 나가기(확인 1회). 방장에게는 나가기 버튼 없이 '방장 위임 미결정' 안내만 처음부터 보인다
 *   (validate 거부 경로는 core에 그대로 있다).
 * - 삭제는 모든 멤버 목록에서 바로 사라지는 삭제 표시(deletedAt)다. 내용은 보관 기한까지 각 기기에 남았다가 지워진다(확인 문구에 적는다).
 * - 종료된 방은 입력 칸을 읽기 전용 모양(off 면 또는 글자)으로 바꾼다.
 * - 보관 기한(종료 다음 날 00:00 KST + 1년) 표시. 종료된 방은 편집이 잠긴다(일기·사진은 계속).
 */
export default function TripSettingsScreen({ navigation, route }: RootScreenProps<'TripSettings'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const online = useTrips((s) => s.online);
  const dirty = useTrips((s) => !!s.dirty[tripId]);
  const dispatch = useTrips((s) => s.dispatch);
  const now = useNow(60_000);

  const [baseFor, setBaseFor] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<'delete' | 'leave' | undefined>(undefined);
  const [title, setTitle] = useState<string | undefined>(undefined);

  const home = () => navigation.reset({ index: 0, routes: [{ name: 'Main', params: { screen: 'Home' } }] });
  const back = () => (navigation.canGoBack() ? navigation.goBack() : home());
  const me = trip ? myMemberId(trip) : undefined;

  if (!trip || trip.deletedAt != null || !me) {
    return (
      <Screen>
        <Header back={back} title="여행방 설정" />
        <Body>
          <Card>
            <Empty title="여행방을 찾을 수 없습니다" action={{ label: '홈으로', onPress: home }} />
          </Card>
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

  const saveTitle = () => {
    const t = (title ?? '').trim();
    if (!t || t === trip.title) return setTitle(undefined);
    const r = dispatch(trip.id, { type: 'trip/update', patch: { title: t } });
    if (r.ok) setTitle(undefined);
  };

  return (
    <Screen>
      <Header back={back} eyebrow={trip.title} title="여행방 설정" sub={`${region?.label ?? trip.region} · ${periodLabel(trip.startDate, trip.endDate)}`} />
      <Body scroll>
        {locked ? <Notice icon="alert" title="여행이 끝났습니다" text={LOCKED_REASON} /> : null}
        {!online ? (
          <Notice
            icon="alert"
            title="오프라인"
            text={`저장된 일정과 좌표로 보고 있습니다. 바꾼 내용은 이 기기에 먼저 남고 연결되면 보냅니다.${dirty ? ' 루트 재계산은 재연결 뒤에 합니다.' : ''}`}
          />
        ) : null}

        <Txt v="eyebrow">기본 정보</Txt>
        <Card>
          {host && !locked ? (
            <Col gap={SP.m}>
              <Field label="여행방 이름" value={title ?? trip.title} onChangeText={setTitle} maxLength={TITLE_MAX} />
              {title != null && title.trim() !== trip.title ? (
                <Btn title="이름 저장" size="sm" variant="ghost" disabled={!title.trim()} onPress={saveTitle} />
              ) : null}
            </Col>
          ) : (
            <Txt v="nm">{trip.title}</Txt>
          )}
          <Col gap={SP.s}>
            <Txt v="label">기본 활동시간</Txt>
            <TimeRange
              start={trip.dayStart}
              end={trip.dayEnd}
              title="기본 활동시간"
              disabled={!host || locked}
              onChange={(v) => dispatch(trip.id, { type: 'trip/update', patch: { dayStart: v.start, dayEnd: v.end } })}
            />
          </Col>
          <Row gap={SP.s}>
            <Chip text={tripMode(trip) === 'group' ? '그룹방' : '개인 모드'} tone="line" />
          </Row>
        </Card>

        <Txt v="eyebrow">날짜별 기점</Txt>
        {dates.map((date, i) => (
          <DayCard
            key={date}
            trip={trip}
            date={date}
            first={i === 0}
            locked={locked}
            onPickBase={() => setBaseFor(date)}
            onSet={(patch) => setDay(date, patch)}
          />
        ))}

        <Txt v="eyebrow">멤버</Txt>
        <Card onPress={() => navigation.navigate('Members', { tripId: trip.id })}>
          <Row>
            <Icon name="users" size={18} />
            <Col grow gap={2}>
              <Txt v="nm">멤버 초대 · 관리</Txt>
              <Txt v="mtTight">초대 링크, 초대 권한, 내보내기</Txt>
            </Col>
            <Icon name="right" size={16} />
          </Row>
        </Card>

        <Txt v="eyebrow">데이터 보존</Txt>
        <Card>
          <Row gap={SP.m}>
            <Icon name="clock" size={17} />
            <Txt v="nm" style={{ flex: 1 }}>{`${dateWithYear(retentionUntil(trip))}까지 보관`}</Txt>
          </Row>
        </Card>

        <Txt v="eyebrow">{host ? '삭제 · 나가기' : '나가기'}</Txt>
        {host ? (
          <Col gap={SP.m}>
            <Btn title="여행방 삭제" variant="quiet" icon="trash" onPress={() => setConfirm('delete')} />
            <Notice icon="user" title="방장은 나갈 수 없습니다" text={MEMBER_REASON.hostLeave} />
          </Col>
        ) : (
          <Btn title="여행방 나가기" variant="quiet" onPress={() => setConfirm('leave')} />
        )}
      </Body>

      <BaseSearchSheet
        visible={baseFor != null}
        region={region}
        onClose={() => setBaseFor(undefined)}
        onPick={(base: DayBase | null) => {
          if (baseFor) setDay(baseFor, { base });
        }}
        noneLabel="기점 없음(첫 스팟 사용)"
      />
      <ConfirmSheet
        visible={confirm === 'delete'}
        title="여행방을 삭제할까요"
        text="모든 멤버의 목록에서 바로 사라지고 되돌릴 수 없습니다. 후보, 시간표, 채팅, 사진과 일기는 더 이상 볼 수 없고, 각 기기에 남은 사본은 보관 기한이 지나면 지워집니다."
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
        text="내가 제안한 후보와 채팅은 '나간 멤버'로 남습니다. 다시 들어오려면 초대 링크가 필요합니다."
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

function DayCard({
  trip,
  date,
  first,
  locked,
  onPickBase,
  onSet,
}: {
  trip: Trip;
  date: string;
  first: boolean;
  locked: boolean;
  onPickBase: () => void;
  onSet: (patch: Partial<Pick<DaySetting, 'base' | 'noReturn' | 'dayStart' | 'dayEnd'>>) => void;
}) {
  const day = trip.days.find((d) => d.date === date);
  const mode = baseModeOf(day, first);
  const own = day && day.base && day.base !== 'inherit' ? day.base : null;
  const inherited = mode === 'inherit' ? effectiveBase(trip.days, date) : null;
  const hours = dayHours(trip, date);
  const options: { key: BaseMode; label: string; disabled?: boolean }[] = [
    { key: 'set', label: '지정', disabled: locked },
    // 칸이 좁아(카드 안 3칸, 한 칸 100px) 줄인 이름을 쓰고, 아래 설명 줄에 인수 기준 이름을 그대로 적는다.
    ...(first ? [] : [{ key: 'inherit' as const, label: '직전과 같음', disabled: locked }]),
    { key: 'none', label: '기점 없음', disabled: locked },
  ];

  const pickMode = (m: BaseMode) => {
    if (m === mode) return;
    if (m === 'set') onPickBase();
    else onSet({ base: m === 'inherit' ? 'inherit' : null });
  };

  return (
    <Card>
      <Row>
        <View style={{ flex: 1 }}>
          <Txt v="nm">{dayLabel(date)}</Txt>
        </View>
        {day?.noReturn ? <Chip text="복귀 없음" tone="line" /> : null}
      </Row>
      <Choice<BaseMode> options={options} value={mode} onChange={pickMode} />
      {mode === 'set' ? (
        <PickerBox label="기점" icon="pin" value={own?.name} placeholder="장소 찾기" onPress={onPickBase} disabled={locked} />
      ) : mode === 'inherit' && inherited ? (
        <Txt v="mtTight">{`직전 날짜와 같음 · ${inherited.name}`}</Txt>
      ) : null}
      <Row>
        <View style={{ flex: 1 }}>
          <Txt v="mt" c="ink">
            복귀 없음
          </Txt>
        </View>
        {locked ? (
          <Chip text={day?.noReturn ? '켜짐' : '꺼짐'} tone="line" />
        ) : (
          <Tag label={day?.noReturn ? '켜짐' : '꺼짐'} on={!!day?.noReturn} onPress={() => onSet({ noReturn: !day?.noReturn })} />
        )}
      </Row>
      <Col gap={SP.s}>
        <Row>
          <View style={{ flex: 1 }}>
            <Txt v="label">이날 활동시간</Txt>
          </View>
          {hours.custom ? <Chip text="이날만" tone="soft" /> : <Txt v="mtTight">기본값</Txt>}
        </Row>
        <TimeRange
          start={hours.dayStart}
          end={hours.dayEnd}
          title={`${dayLabel(date)} 활동시간`}
          disabled={locked}
          onChange={(v) => onSet({ dayStart: v.start, dayEnd: v.end })}
        />
      </Col>
    </Card>
  );
}
