import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';

import type { Photo } from '../types';
import { formatBytes, isDateAssigned, isPlaceEstimated, stillOverLimit } from '../core/journal/photo';
import { dateRange, kstDate, kstHHMM } from '../core/util';
import { DateSeg } from '../features/journal/components/DateSeg';
import { photoBadge, PhotoTile } from '../features/journal/components/PhotoTile';
import { RecordTabs } from '../features/journal/components/RecordTabs';
import { pickAndImport, pruneSessionPhotos, removePhoto, useSessionPhotosVersion } from '../features/journal/api';
import { daySegLabel } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { myMemberId, useTripDoc } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Chip,
  Col,
  ConfirmSheet,
  Empty,
  Foot,
  Header,
  IconBtn,
  ListRow,
  NotFound,
  Notice,
  Row,
  Screen,
  Sheet,
  SP,
  TextLink,
  Txt,
} from '../ui';

/**
 * 20 사진(FR-701, 3차). 여행 기록 공통 탭(사진 · 일기 · 지도) 아래 날짜 탭, 3열 격자(라운드 12).
 * - 처음 날짜는 넘겨받은 date, 없으면 '전체'. '전체'는 날짜별로 묶고(묶음 머리와 '이 날 일기'), 기간 밖 사진은 맨 아래 '여행 기간 밖' 묶음이다.
 * - 주 행동은 Foot의 '사진 올리기' 하나다. 예시 사진(시연)은 머리말 dots 시트와 빈 화면 아래 quiet로 둔다.
 * - 타일 배지는 하나(날짜 지정 > 추정 > 장소 추정), 압축 여부는 사진 정보 시트에만 보인다.
 * - '모의 사진'은 여행 시뮬레이터 시각과 위치로 만든 사진이다(3장 중 1장은 EXIF 없음). 웹 사진은 이 세션에서만 보인다.
 * - 여행이 끝나도 사진을 올릴 수 있다(종료 잠금 예외). 촬영 정보 없이 기간 밖에서 올리면 고른 날짜 탭(전체면 가까운 끝 날)에 넣는다.
 * - 사진은 올린 사람만 지운다(남의 사진 삭제는 명세 미결정). 나간 멤버는 볼 수만 있다.
 * - 뒤로는 useBack('Home'), 없는 여행방은 NotFound('홈으로').
 */

const GAP = SP.s;

interface PhotoGroup {
  key: string;
  title: string;
  /** 여행 기간 안의 날짜(기간 밖 묶음은 없음) */
  date?: string;
  photos: Photo[];
}

export default function PhotosScreen({ navigation, route }: RootScreenProps<'Photos'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  useSessionPhotosVersion();
  const back = useBack('Home');
  const [picked, setDate] = useState(route.params.date ?? 'all');
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [selected, setSelected] = useState<Photo | undefined>();
  const [confirm, setConfirm] = useState<Photo | undefined>();
  const toast = useUi((s) => s.showToast);

  // 다른 기기의 삭제나 계정 탈퇴로 문서에서 빠진 사진의 세션 원본을 메모리에서 지운다.
  useEffect(() => {
    if (trip) pruneSessionPhotos(trip.photos.map((p) => p.id));
  }, [trip, trip?.photos]);

  const sorted = useMemo(() => [...(trip?.photos ?? [])].sort((a, b) => a.takenAt - b.takenAt), [trip?.photos]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sorted.length };
    for (const p of sorted) c[kstDate(p.takenAt)] = (c[kstDate(p.takenAt)] ?? 0) + 1;
    return c;
  }, [sorted]);

  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="여행 기록" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const days = dateRange(trip.startDate, trip.endDate);
  // 넘겨받은 날짜가 여행 기간 밖이면 전체로 본다.
  const date = picked === 'all' || days.includes(picked) ? picked : 'all';
  const me = myMemberId(trip);
  const memberOf = (id: string) => trip.members.find((m) => m.id === id);
  const left = !!me && memberOf(me)?.leftAt != null;
  const canWrite = !!me && !left;
  const size = width > 0 ? Math.floor((width - GAP * 2) / 3) : 0;
  const fallbackDate = date === 'all' ? undefined : date;
  const list = date === 'all' ? sorted : sorted.filter((p) => kstDate(p.takenAt) === date);
  const spotName = (id?: string) => (id ? trip.spots.find((s) => s.id === id)?.name : undefined);

  const add = async (source: 'device' | 'sim') => {
    if (busy) return;
    setBusy(true);
    const r = await pickAndImport(tripId, source, fallbackDate);
    setBusy(false);
    if (!r.ok) {
      toast(r.message, 'warn');
      return;
    }
    // 고르지 않았거나, 골랐는데 한 장도 올라가지 않았으면(저장 거부는 스토어가 이유를 알린다) 성공 토스트를 띄우지 않는다.
    if (r.picked === 0 || r.photos.length === 0) return;
    const assigned = r.photos.filter(isDateAssigned);
    const est = r.photos.filter((p) => p.source === 'estimated' && !isDateAssigned(p)).length;
    const comp = r.photos.filter((p) => p.compressed).length;
    const parts = [`사진 ${r.photos.length}장을 올렸어요`];
    if (assigned.length > 0) parts.push(`${assigned.length}장은 촬영 정보가 없어 ${daySegLabel(kstDate(assigned[0].takenAt))}에 넣었어요`);
    if (est > 0) parts.push(`${est}장은 촬영 정보가 없어 시각과 장소를 추정했어요`);
    if (comp > 0) parts.push(`${comp}장은 10MB를 넘어 압축해요`);
    toast(parts.join(' · '));
  };

  const openDiary = (d: string) => navigation.replace('Diary', { tripId, date: d });
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const groups: PhotoGroup[] = [];
  if (date === 'all') {
    for (const d of days) {
      const ps = sorted.filter((p) => kstDate(p.takenAt) === d);
      if (ps.length > 0) groups.push({ key: d, title: daySegLabel(d), date: d, photos: ps });
    }
    const outside = sorted.filter((p) => !days.includes(kstDate(p.takenAt)));
    if (outside.length > 0) groups.push({ key: 'outside', title: '여행 기간 밖', photos: outside });
  }

  const grid = (photos: Photo[]) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {photos.map((p) => {
        const badge = photoBadge(p);
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${spotName(p.spotId) ?? '장소 모름'} ${kstHHMM(p.takenAt)} 사진${badge ? `, ${badge}` : ''}`}
            onPress={() => setSelected(p)}
          >
            <PhotoTile photo={p} size={size} badge={badge} />
          </Pressable>
        );
      })}
    </View>
  );

  const selDate = selected ? kstDate(selected.takenAt) : '';
  const selMine = !!selected && !!me && selected.memberId === me;

  return (
    <Screen>
      <Header
        back={back}
        eyebrow={trip.title}
        title="여행 기록"
        sub={`사진 ${trip.photos.length}장`}
        right={canWrite ? <IconBtn icon="dots" label="사진 메뉴" onPress={() => setMenu(true)} /> : undefined}
      />
      <View style={{ paddingHorizontal: SP.gutter, paddingBottom: SP.m, gap: SP.m }}>
        <RecordTabs current="Photos" tripId={tripId} date={date === 'all' ? undefined : date} />
        <DateSeg trip={trip} value={date} onChange={setDate} all photoCounts={counts} showCount />
      </View>
      <Body scroll>
        {left ? <Notice icon="users" text="나간 멤버는 사진을 볼 수만 있어요" /> : null}
        <View onLayout={onLayout} style={{ gap: SP.section - SP.xl }}>
          {list.length === 0 ? (
            <Col gap={SP.m}>
              <Empty
                icon="camera"
                title={date === 'all' ? '아직 올린 사진이 없어요' : `${daySegLabel(date)}에 찍은 사진이 없어요`}
                text={canWrite ? '찍은 시각과 장소로 날짜와 일기에 저절로 들어가요' : undefined}
              />
              {canWrite ? (
                <Btn title="예시 사진 3장 넣기" variant="quiet" size="sm" onPress={() => void add('sim')} disabled={busy} />
              ) : null}
            </Col>
          ) : size === 0 ? null : date === 'all' ? (
            groups.map((g) => (
              <Col key={g.key} gap={SP.m}>
                <Row>
                  <Col grow>
                    <Txt v="nm">{g.title}</Txt>
                    <Txt v="mtTight">{g.date ? `사진 ${g.photos.length}장` : `사진 ${g.photos.length}장 · 일기에는 들어가지 않아요`}</Txt>
                  </Col>
                  {g.date ? <TextLink title="이 날 일기" onPress={() => openDiary(g.date!)} /> : null}
                </Row>
                {grid(g.photos)}
              </Col>
            ))
          ) : (
            grid(list)
          )}
        </View>
      </Body>
      {canWrite ? (
        <Foot>
          <Btn title={busy ? '올리는 중' : '사진 올리기'} icon="camera" onPress={() => void add('device')} disabled={busy} />
        </Foot>
      ) : null}

      <Sheet visible={menu} onClose={() => setMenu(false)} title="사진 메뉴">
        <Txt v="eyebrow">시연</Txt>
        <View>
          <ListRow
            first
            icon="camera"
            label="예시 사진 3장 넣기"
            sub="여행 시뮬레이터의 시각과 위치로 만든 사진이에요"
            disabled={busy}
            onPress={() => {
              setMenu(false);
              void add('sim');
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={!!selected} onClose={() => setSelected(undefined)} title="사진 정보">
        {selected ? (
          <Col gap={SP.l}>
            <Row top>
              <PhotoTile photo={selected} size={96} />
              <Col gap={SP.s} grow>
                <InfoLine
                  label="찍은 때"
                  value={`${daySegLabel(selDate)} ${kstHHMM(selected.takenAt)}`}
                  chip={selected.source === 'estimated' ? (isDateAssigned(selected) ? '날짜 지정' : '추정') : undefined}
                />
                <InfoLine
                  label="장소"
                  value={spotName(selected.spotId) ?? '장소 모름'}
                  chip={selected.spotId && (selected.source === 'estimated' || isPlaceEstimated(selected)) ? '추정' : undefined}
                />
                <InfoLine
                  label="올린 사람"
                  value={memberOf(selected.memberId)?.nickname ?? '알 수 없음'}
                  chip={memberOf(selected.memberId)?.leftAt != null ? '나간 멤버' : undefined}
                />
                {selected.sim ? (
                  <Row>
                    <Chip text="예시 사진" tone="line" />
                  </Row>
                ) : null}
              </Col>
            </Row>
            {selected.compressed ? (
              <Txt v="mt">
                {`원본 ${formatBytes(selected.originalBytes)}(10MB 초과) · 압축 뒤 약 ${formatBytes(selected.bytes)}${
                  stillOverLimit(selected) ? ' · 압축해도 10MB를 넘을 수 있어요' : ''
                }`}
              </Txt>
            ) : null}
            {selected.sessionOnly ? <Txt v="mt">이 세션에서만 보여요. 새로고침하거나 다른 기기에서는 보이지 않아요</Txt> : null}
            {days.includes(selDate) ? (
              <Btn
                title="이 날 일기 보기"
                icon="book"
                variant="quiet"
                onPress={() => {
                  setSelected(undefined);
                  openDiary(selDate);
                }}
              />
            ) : null}
            {selMine && canWrite ? (
              <Btn
                title="사진 지우기"
                icon="trash"
                variant="quiet"
                onPress={() => {
                  setConfirm(selected);
                  setSelected(undefined);
                }}
              />
            ) : (
              <Txt v="mt">{selMine ? '나간 멤버는 사진을 지울 수 없어요' : '올린 사람만 지울 수 있어요'}</Txt>
            )}
          </Col>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={!!confirm}
        title="사진을 지울까요"
        text="여행방과 일기에서 이 사진이 빠져요. 되돌릴 수 없어요."
        confirmLabel="지우기"
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          if (confirm) removePhoto(tripId, confirm.id);
          setConfirm(undefined);
        }}
      />
    </Screen>
  );
}

/** 사진 정보 한 줄: 이름(muted) · 값 · 추정 칩 */
function InfoLine({ label, value, chip }: { label: string; value: string; chip?: string }) {
  return (
    <Row gap={SP.s} wrap>
      <Txt v="mtTight">{label}</Txt>
      <Txt v="nmSm">{value}</Txt>
      {chip ? <Chip text={chip} tone="line" /> : null}
    </Row>
  );
}
