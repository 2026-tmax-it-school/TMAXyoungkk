import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native';

import type { Photo } from '../types';
import {
  formatBytes,
  isDateAssigned,
  isPlaceEstimated,
  photosOutsideTrip,
  stillOverLimit,
  uploadDateFor,
} from '../core/journal/photo';
import { dayLabel, kstDate, kstHHMM } from '../core/util';
import { DateSeg } from '../features/journal/components/DateSeg';
import { PhotoTile } from '../features/journal/components/PhotoTile';
import { pickAndImport, pruneSessionPhotos, removePhoto, useSessionPhotosVersion } from '../features/journal/api';
import type { RootScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { getServices } from '../services/registry';
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
  Notice,
  Row,
  Screen,
  ScopeBadge,
  Sheet,
  SP,
  Txt,
} from '../ui';

/**
 * 20 사진(FR-701, 3차). 3열 격자(라운드 12), EXIF·추정 칩, 10MB 압축 표시, 웹 사진은 이 세션에서만 보임.
 * '모의 사진'은 여행 시뮬레이터 시각과 위치로 만든 사진이다(3장 중 1장은 EXIF 없음).
 * 여행이 끝나도 사진을 올릴 수 있다(종료 잠금 예외). 촬영 정보 없이 기간 밖에서 올리면 고른 날짜 탭(전체면 가까운 끝 날)에 넣는다.
 * 사진은 올린 사람만 지운다(남의 사진 삭제는 명세 미결정).
 */

const GAP = SP.s;

export default function PhotosScreen({ navigation, route }: RootScreenProps<'Photos'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const now = useNow();
  useSessionPhotosVersion();
  const [date, setDate] = useState('all');
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Photo | undefined>();
  const [confirm, setConfirm] = useState<Photo | undefined>();
  const toast = useUi((s) => s.showToast);

  // 다른 기기의 삭제나 계정 탈퇴로 문서에서 빠진 사진의 세션 원본을 메모리에서 지운다.
  useEffect(() => {
    if (trip) pruneSessionPhotos(trip.photos.map((p) => p.id));
  }, [trip, trip?.photos]);

  const photos = useMemo(() => {
    const list = [...(trip?.photos ?? [])].sort((a, b) => a.takenAt - b.takenAt);
    return date === 'all' ? list : list.filter((p) => kstDate(p.takenAt) === date);
  }, [trip?.photos, date]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: trip?.photos.length ?? 0 };
    for (const p of trip?.photos ?? []) c[kstDate(p.takenAt)] = (c[kstDate(p.takenAt)] ?? 0) + 1;
    return c;
  }, [trip?.photos]);

  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="사진" />
        <Body>
          <Empty title="여행방을 찾을 수 없습니다" text="홈에서 여행방을 다시 골라 주세요" />
        </Body>
      </Screen>
    );
  }

  const me = myMemberId(trip);
  const size = width > 0 ? Math.floor((width - GAP * 2) / 3) : 0;
  const deviceIsSim = getServices().photos.id === 'sim';
  const fallbackDate = date === 'all' ? undefined : date;
  const today = kstDate(now);
  const outOfTrip = today < trip.startDate || today > trip.endDate;
  const assignDate = uploadDateFor(trip, now, fallbackDate);
  const outside = photosOutsideTrip(trip).length;

  const add = async (source: 'device' | 'sim') => {
    if (busy) return;
    setBusy(true);
    const r = await pickAndImport(tripId, source, fallbackDate);
    setBusy(false);
    if (!r.ok) {
      toast(r.message, 'warn');
      return;
    }
    if (r.picked === 0) return;
    const assigned = r.photos.filter(isDateAssigned);
    const est = r.photos.filter((p) => p.source === 'estimated' && !isDateAssigned(p)).length;
    const comp = r.photos.filter((p) => p.compressed).length;
    const parts = [`사진 ${r.photos.length}장을 올렸습니다`];
    if (assigned.length > 0) parts.push(`${assigned.length}장은 촬영 정보가 없어 ${dayLabel(kstDate(assigned[0].takenAt))}에 넣었습니다`);
    if (est > 0) parts.push(`${est}장은 촬영 정보가 없어 시각과 장소를 추정했습니다`);
    if (comp > 0) parts.push(`${comp}장은 10MB를 넘어 압축 대상입니다`);
    toast(parts.join(' · '));
  };

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const memberOf = (id: string) => trip.members.find((m) => m.id === id);
  const spotName = (id?: string) => (id ? trip.spots.find((s) => s.id === id)?.name : undefined);

  return (
    <Screen>
      <Header
        back={back}
        eyebrow={trip.title}
        title="사진"
        sub={`사진 ${trip.photos.length}장`}
        right={<ScopeBadge phase="3차" />}
      />
      <Body scroll>
        <Row>
          <View style={{ flex: 1 }}>
            <Btn title="일기" icon="book" variant="quiet" size="sm" onPress={() => navigation.navigate('Diary', { tripId })} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="기록 지도" icon="map" variant="quiet" size="sm" onPress={() => navigation.navigate('RecordMap', { tripId })} />
          </View>
        </Row>
        <DateSeg trip={trip} value={date} onChange={setDate} all counts={counts} />
        {Platform.OS === 'web' && !deviceIsSim ? (
          <Notice
            icon="camera"
            text="웹에서 고른 사진은 촬영 정보(EXIF)가 없어 올린 시각과 그때 일정으로 추정합니다. 저장하지 않고 이 세션에서만 보입니다."
          />
        ) : null}
        {outOfTrip ? (
          <Notice
            icon="cal"
            text={`여행 기간 밖이라 촬영 정보가 없는 사진은 ${dayLabel(assignDate)}에 넣습니다. 다른 날에 넣으려면 날짜 탭을 먼저 고르세요.`}
          />
        ) : null}
        {outside > 0 ? (
          <Notice tone="warn" text={`여행 기간 밖에 찍은 사진 ${outside}장 · 전체에만 보이고 일기에는 들어가지 않습니다.`} />
        ) : null}
        <View onLayout={onLayout}>
          {photos.length === 0 ? (
            <Empty
              title={date === 'all' ? '아직 올린 사진이 없습니다' : `${dayLabel(date)}에 찍은 사진이 없습니다`}
              text="여행 중 찍은 사진을 올리면 날짜별 일기에 들어갑니다"
            />
          ) : size > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
              {photos.map((p) => (
                <Pressable key={p.id} accessibilityRole="button" onPress={() => setSelected(p)}>
                  <PhotoTile
                    photo={p}
                    size={size}
                    badge={
                      <>
                        {p.source === 'estimated' ? <Chip text={isDateAssigned(p) ? '날짜 지정' : '추정'} tone="line" /> : null}
                        {isPlaceEstimated(p) ? <Chip text="장소 추정" tone="line" /> : null}
                        {p.compressed ? <Chip text="압축" tone="line" /> : null}
                      </>
                    }
                  />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        <Txt v="mtTight">
          프로토타입 · 사진은 이 기기에만 저장합니다. 장당 10MB를 넘으면 압축 대상으로 표시하고, 실제 압축은 앱(iOS·안드로이드)에서
          합니다.
        </Txt>
      </Body>
      <Foot>
        <Btn title="사진 올리기" icon="camera" onPress={() => void add('device')} disabled={busy} />
        <Btn title="예시 사진 3장 넣기" variant="ghost" onPress={() => void add('sim')} disabled={busy} />
      </Foot>

      <Sheet visible={!!selected} onClose={() => setSelected(undefined)} title="사진 정보">
        {selected ? (
          <Col gap={SP.l}>
            <Row top>
              <PhotoTile photo={selected} size={96} />
              <Col gap={SP.xs} grow>
                <Txt v="nm">{spotName(selected.spotId) ?? (isDateAssigned(selected) ? '장소 모름' : '장소를 추정하지 못함')}</Txt>
                <Txt v="mt">{`${dayLabel(kstDate(selected.takenAt))} ${kstHHMM(selected.takenAt)}`}</Txt>
                <Row gap={SP.s} wrap>
                  <SourceChips photo={selected} />
                  {selected.sim ? <Chip text="예시 사진" tone="line" /> : null}
                  {selected.sessionOnly ? <Chip text="이 세션에서만 보임" tone="line" /> : null}
                </Row>
              </Col>
            </Row>
            <SourceNote photo={selected} />
            <Txt v="mt">
              {selected.compressed
                ? `원본 ${formatBytes(selected.originalBytes)}(10MB 초과) · 압축 뒤 약 ${formatBytes(selected.bytes)}${
                    stillOverLimit(selected) ? ' · 압축해도 10MB를 넘을 수 있습니다' : ''
                  }`
                : `크기 ${formatBytes(selected.bytes)}`}
            </Txt>
            <Uploader name={memberOf(selected.memberId)?.nickname} left={memberOf(selected.memberId)?.leftAt != null} />
            {me && selected.memberId !== me ? <Txt v="mtTight">사진은 올린 사람만 지울 수 있습니다.</Txt> : null}
            <Btn
              title="사진 지우기"
              icon="trash"
              variant="quiet"
              disabled={!me || selected.memberId !== me}
              onPress={() => {
                setConfirm(selected);
                setSelected(undefined);
              }}
            />
          </Col>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={!!confirm}
        title="사진을 지울까요"
        text="여행방과 일기에서 이 사진이 빠집니다. 되돌릴 수 없습니다."
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

function SourceChips({ photo }: { photo: Photo }) {
  if (photo.source === 'estimated') return <Chip text={isDateAssigned(photo) ? '날짜 지정' : '추정'} tone="line" />;
  if (!photo.coord) {
    return (
      <>
        <Chip text="촬영 시각(EXIF)" tone="ok" />
        {photo.spotId ? <Chip text="장소 추정" tone="line" /> : null}
      </>
    );
  }
  return <Chip text="촬영 정보(EXIF)" tone="ok" />;
}

function SourceNote({ photo }: { photo: Photo }) {
  if (isDateAssigned(photo)) {
    return <Txt v="mt">촬영 정보 없이 여행 기간 밖에서 올려 날짜만 정해 넣었습니다. 시각은 올린 시각이고 장소는 모릅니다.</Txt>;
  }
  if (photo.source === 'estimated') return <Txt v="mt">촬영 정보가 없어 올린 시각과 그때 일정으로 시각과 장소를 정했습니다.</Txt>;
  if (isPlaceEstimated(photo)) return <Txt v="mt">촬영 위치가 없어 촬영 시각의 일정으로 장소를 정했습니다. 기록 지도에는 찍지 않습니다.</Txt>;
  return null;
}

function Uploader({ name, left }: { name?: string; left: boolean }) {
  return (
    <Row gap={SP.s} wrap>
      <Txt v="mt">{`올린 사람 ${name ?? '알 수 없음'}`}</Txt>
      {left ? <Chip text="나간 멤버" tone="line" /> : null}
    </Row>
  );
}
