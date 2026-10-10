import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import type { DiaryBlock, Trip } from '../types';
import { datesWithRecords, diaryBlocks, diaryStaleness } from '../core/journal/diary';
import { photosOutsideTrip } from '../core/journal/photo';
import { isEnded } from '../core/tripStatus';
import { dayLabel, dayShort, kstDate, kstHHMM } from '../core/util';
import { DateSeg, initialDate } from '../features/journal/components/DateSeg';
import { PhotoTile } from '../features/journal/components/PhotoTile';
import {
  editDiaryBlock,
  generateDiary,
  pruneSessionPhotos,
  shareDiary,
  useSessionPhotosVersion,
} from '../features/journal/api';
import type { RootScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { getServices } from '../services/registry';
import { myMemberId, useTripDoc } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Card,
  Chip,
  Col,
  Empty,
  Field,
  Foot,
  H,
  Header,
  lineC,
  Notice,
  Row,
  Screen,
 
  Sheet,
  SP,
  surfaceC,
  Txt,
} from '../ui';

/**
 * 21 일기 · 편집 · 공유(FR-702·703, 3차).
 * 그날 사진·도착 기록·장소를 시간순 블록으로 묶어 설명문을 붙인다(템플릿 기본, AI는 프록시).
 * 문장 편집은 나중 저장 우선(FR-503과 같은 정책), 공유는 공유 시트가 안 되면 복사로 대체한다.
 * 여행이 끝나도 만들고 고치고 볼 수 있다(종료 잠금 예외). 끝난 뒤 처음 연 날짜에 기록이 있고 일기가 없으면 자동으로 만든다.
 * 만든 뒤 새 기록이 들어오거나 사진이 지워져 문장이 빠지면 '다시 만들기'를 안내한다.
 * 블록 행은 09 시간표 문법(카드 밖 52px 시각 열 + 축 점 + 오른쪽 카드)을 따른다.
 */

const THUMB = 56;
const AXIS_W = 18;
const DOT = 10;

export default function DiaryScreen({ navigation, route }: RootScreenProps<'Diary'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const now = useNow();
  useSessionPhotosVersion();
  const [picked, setDate] = useState(() =>
    trip ? initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip)) : '',
  );
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DiaryBlock | undefined>();
  const [draft, setDraft] = useState('');
  const toast = useUi((s) => s.showToast);
  const autoTried = useRef(new Set<string>());

  useEffect(() => {
    if (trip) pruneSessionPhotos(trip.photos.map((p) => p.id));
  }, [trip, trip?.photos]);

  // 여행이 끝난 뒤 기록이 있는데 일기가 없는 날짜를 처음 열면 자동으로 만든다(FR-700 자동 정리). 날짜마다 한 번만 시도한다.
  const autoDate = trip ? picked || initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip)) : '';
  const needsAuto =
    !!trip &&
    isEnded(trip, now) &&
    !!myMemberId(trip) &&
    trip.members.find((m) => m.id === myMemberId(trip))?.leftAt == null &&
    !trip.diaries[autoDate] &&
    diaryBlocks(trip, autoDate).length > 0;
  useEffect(() => {
    if (!needsAuto || autoTried.current.has(autoDate)) return;
    autoTried.current.add(autoDate);
    setBusy(true);
    void generateDiary(tripId, autoDate, { quiet: true }).finally(() => setBusy(false));
  }, [needsAuto, autoDate, tripId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of trip ? datesWithRecords(trip) : []) c[d] = trip ? diaryBlocks(trip, d).length : 0;
    return c;
  }, [trip]);

  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="일기" />
        <Body>
          <Empty title="여행방을 찾을 수 없습니다" />
        </Body>
      </Screen>
    );
  }

  // 첫 화면에서 여행방이 아직 없었으면 여기서 날짜를 정한다.
  const date = picked || initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip));
  const entry = trip.diaries[date];
  const pending = diaryBlocks(trip, date);
  const pendingPhotos = pending.reduce((n, d) => n + d.block.photoIds.length, 0);
  // 머리 칩은 보이는 일기 기준이다(일기가 없으면 만들 기록 기준).
  const visits = entry
    ? entry.blocks.filter((b) => b.spotId && trip.visits.some((v) => v.date === date && v.spotId === b.spotId && v.status === 'arrived')).length
    : new Set(trip.visits.filter((v) => v.date === date && v.status === 'arrived').map((v) => v.spotId)).size;
  const photoCount = entry ? entry.blocks.reduce((n, b) => n + b.photoIds.length, 0) : pendingPhotos;
  const ai = getServices().diary.id === 'ai';
  const stale = entry ? diaryStaleness(trip, entry) : undefined;
  const outside = photosOutsideTrip(trip).length;

  const make = async () => {
    setBusy(true);
    const r = await generateDiary(tripId, date);
    setBusy(false);
    // 저장 거부는 스토어가 이유를 토스트로 띄운다.
    if (!r.ok) return;
    if (r.entry.status === 'empty') {
      toast(r.entry.blocks.length ? '문장을 만들지 못해 빈 일기를 두었습니다' : '이 날은 기록이 없어 빈 일기입니다', 'warn');
    }
  };

  const share = async () => {
    const r = await shareDiary(tripId, date);
    if (r === 'shared') toast('일기를 공유했습니다');
    else if (r === 'copied') toast('공유를 쓸 수 없어 일기 글을 복사했습니다');
    else if (r === 'failed') toast('공유와 복사가 모두 안 됩니다. 이 브라우저에서는 글을 직접 옮겨 주세요', 'warn');
  };

  const save = () => {
    if (!editing) return;
    const text = draft.trim();
    // 바꾸지 않고 저장하면 보내지 않는다(고친 문장으로 표시되어 다시 만들기에서 고정되지 않게).
    if (text !== editing.text.trim()) editDiaryBlock(tripId, date, editing.id, text);
    setEditing(undefined);
  };

  return (
    <Screen>
      <Header back={back} eyebrow={trip.title} title="일기" sub={dayLabel(date)} />
      <Body scroll>
        <DateSeg trip={trip} value={date} onChange={setDate} counts={counts} />
        <Row gap={SP.s} wrap>
          <Chip text={`방문 ${visits}곳`} tone="line" />
          <Chip text={`사진 ${photoCount}장`} tone="line" />
          {ai ? <Chip text="AI가 쓴 문장" tone="line" /> : null}
          {entry?.sharedAt != null ? <Chip text={`공유 ${dayShort(kstDate(entry.sharedAt))} ${kstHHMM(entry.sharedAt)}`} tone="ok" /> : null}
        </Row>
        {stale && stale.newRecords > 0 ? (
          <Notice icon="plus" text={`새 기록 ${stale.newRecords}건이 일기에 없습니다`} />
        ) : null}
        {stale && stale.blankBlocks > 0 ? (
          <Notice text={`사진이 지워져 문장을 비운 문단 ${stale.blankBlocks}개`} />
        ) : null}
        {outside > 0 ? <Notice tone="warn" text={`여행 기간 밖에 찍은 사진 ${outside}장은 일기에 들어가지 않습니다.`} /> : null}

        {!entry ? (
          <Card>
            <Txt v="nm">{`${dayLabel(date)} 일기가 아직 없습니다`}</Txt>
          </Card>
        ) : (
          <>
            {entry.status === 'empty' ? (
              <Notice
                tone="warn"
                title="빈 일기"
                text={
                  entry.blocks.length > 0
                    ? '문장을 만들지 못했습니다. 문단을 눌러 직접 쓸 수 있습니다.'
                    : '이 날은 기록이 없어 빈 일기입니다.'
                }
              />
            ) : null}
            {entry.blocks.map((b, i) => (
              <BlockCard
                key={b.id}
                trip={trip}
                block={b}
                first={i === 0}
                last={i === entry.blocks.length - 1}
                onPress={() => {
                  setEditing(b);
                  setDraft(b.text);
                }}
              />
            ))}
          </>
        )}
      </Body>
      <Foot>
        <Row>
          <View style={{ flex: 1 }}>
            <Btn
              title={entry ? '다시 만들기' : '일기 만들기'}
              variant={entry ? 'quiet' : 'primary'}
              onPress={() => void make()}
              disabled={busy}
            />
          </View>
          {entry ? (
            <View style={{ flex: 1 }}>
              <Btn title="공유" icon="share" onPress={() => void share()} disabled={entry.blocks.length === 0} />
            </View>
          ) : null}
        </Row>
        {/* 이 날의 일기를 커뮤니티 글로 올린다(글쓰기 화면이 본문을 채워 연다) */}
        {entry && entry.blocks.length > 0 ? (
          <Btn
            title="커뮤니티에 올리기"
            icon="users"
            variant="ghost"
            onPress={() => navigation.navigate('CommunityCompose', { tripId, date })}
          />
        ) : null}
      </Foot>

      <Sheet visible={!!editing} onClose={() => setEditing(undefined)} title={editing ? `${editing.time} ${editing.placeName}` : ''}>
        <Field
          label="문장"
          value={draft}
          onChangeText={setDraft}
          maxLength={1000}
          multiline
          minLines={4}
          placeholder="이 곳에서의 하루를 적어 주세요"
        />
        <Col gap={9}>
          <Btn title="저장" onPress={save} />
          <Btn title="취소" variant="quiet" onPress={() => setEditing(undefined)} />
        </Col>
      </Sheet>
    </Screen>
  );
}

/** 09 DayTimeline과 같은 축(카드 밖 시각 열 옆). 스팟 블록은 채운 점, 스팟 없는 사진 묶음은 속 빈 점 */
function Axis({ hollow, top, bottom }: { hollow: boolean; top: boolean; bottom: boolean }) {
  return (
    <View style={{ width: AXIS_W, alignItems: 'center', alignSelf: 'stretch' }}>
      <View style={{ width: 1.5, height: SP.xl + 3, backgroundColor: top ? lineC.line : 'transparent' }} />
      <View
        style={{
          width: DOT,
          height: DOT,
          borderRadius: DOT / 2,
          backgroundColor: hollow ? surfaceC.card : surfaceC.accent,
          borderWidth: 2,
          borderColor: lineC.accent,
        }}
      />
      <View style={{ width: 1.5, flex: 1, backgroundColor: bottom ? lineC.line : 'transparent' }} />
    </View>
  );
}

function BlockCard({
  trip,
  block,
  first,
  last,
  onPress,
}: {
  trip: Trip;
  block: DiaryBlock;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const photos = block.photoIds
    .map((id) => trip.photos.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const leftPhoto = photos.some((p) => trip.members.find((m) => m.id === p.memberId)?.leftAt != null);
  const editor = block.editedBy ? trip.members.find((m) => m.id === block.editedBy)?.nickname : undefined;
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: H.timeCol, paddingTop: SP.xl }}>
        <Txt v="time">{block.time}</Txt>
      </View>
      <Axis hollow={!block.spotId} top={!first} bottom={!last} />
      <View style={{ flex: 1, minWidth: 0, paddingLeft: SP.l, paddingBottom: last ? 0 : SP.m }}>
        <Card onPress={onPress}>
          <Col gap={SP.s}>
            <Row top>
              <Col grow>
                <Txt v="nm">{block.placeName}</Txt>
              </Col>
              <Txt v="mtTight" c="accent">
                고치기
              </Txt>
            </Row>
            {photos.length > 0 ? (
              <Row gap={SP.s} wrap>
                {photos.map((p) => (
                  <PhotoTile key={p.id} photo={p} size={THUMB} />
                ))}
              </Row>
            ) : null}
            {block.text ? <Txt v="body">{block.text}</Txt> : <Txt v="mt">문장 없음 · 눌러서 쓰기</Txt>}
            {(editor && block.editedAt != null) || leftPhoto ? (
              <Row gap={SP.s} wrap>
                {editor && block.editedAt != null ? <Txt v="mtTight">{`${editor} 고침 · ${kstHHMM(block.editedAt)}`}</Txt> : null}
                {leftPhoto ? <Chip text="나간 멤버 사진" tone="line" /> : null}
              </Row>
            ) : null}
          </Col>
        </Card>
      </View>
    </View>
  );
}
