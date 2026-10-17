import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { DiaryBlock, Trip } from '../types';
import { datesWithRecords, diaryBlocks, diaryStaleness } from '../core/journal/diary';
import { photosOutsideTrip } from '../core/journal/photo';
import { isEnded } from '../core/tripStatus';
import { kstDate, kstHHMM } from '../core/util';
import { DateSeg, initialDate } from '../features/journal/components/DateSeg';
import { PhotoTile } from '../features/journal/components/PhotoTile';
import { RecordTabs } from '../features/journal/components/RecordTabs';
import {
  editDiaryBlock,
  generateDiary,
  pruneSessionPhotos,
  shareDiary,
  useSessionPhotosVersion,
} from '../features/journal/api';
import { daySegLabel } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
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
  IconBtn,
  lineC,
  ListRow,
  NotFound,
  Notice,
  Row,
  Screen,
  Sheet,
  SP,
  surfaceC,
  Txt,
} from '../ui';

/**
 * 21 일기 · 편집 · 공유(FR-702·703, 3차). 여행 기록 공통 탭(사진 · 일기 · 지도) 아래 날짜 탭.
 * 그날 사진·도착 기록·장소를 시간순 블록으로 묶어 설명문을 붙인다(템플릿 기본, AI는 프록시).
 * - 머리 보조 줄은 '방문 N곳 · 사진 N장'(공유했으면 ' · 공유함')이다. 칩 줄을 따로 두지 않는다.
 * - 일기가 없는 날: 만들 기록이 있으면 '일기 만들기', 없으면 '이 날은 기록이 없어요'와 '사진 올리기'(만들기 버튼 없음).
 *   만드는 동안은 '일기 만드는 중' 안내(clock)를 보인다. 나간 멤버는 만들기와 고치기가 없다.
 * - 주 행동은 Foot의 '공유하기' 하나다. 시트에서 '메시지·메모로 보내기'(공유 시트, 안 되면 복사)와 '커뮤니티에 올리기'를 고른다.
 * - '다시 만들기'는 기록이 뒤처졌을 때의 안내(새 기록·비운 문단을 한 안내로 합침) action과 머리말 dots 시트에 있다.
 * - 문장 편집은 나중 저장 우선(FR-503과 같은 정책). 고친 채로 시트를 닫으려 하면 저장할지 한 번 묻는다.
 * - 여행이 끝나도 만들고 고치고 볼 수 있다(종료 잠금 예외). 끝난 뒤 처음 연 날짜에 기록이 있고 일기가 없으면 자동으로 만든다.
 * - 블록 행은 09 시간표 문법(카드 밖 52px 시각 열 + 축 점 + 오른쪽 카드)을 따른다.
 * - 뒤로는 useBack('Home'), 없는 여행방은 NotFound('홈으로').
 */

const THUMB = 56;
const AXIS_W = 18;
const DOT = 10;

export default function DiaryScreen({ navigation, route }: RootScreenProps<'Diary'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const now = useNow();
  useSessionPhotosVersion();
  const back = useBack('Home');
  const [picked, setDate] = useState(() =>
    trip ? initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip)) : '',
  );
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DiaryBlock | undefined>();
  const [draft, setDraft] = useState('');
  const [askSave, setAskSave] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menu, setMenu] = useState(false);
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

  // 첫 화면에서 여행방이 아직 없었으면 여기서 날짜를 정한다.
  const date = picked || initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip));
  const entry = trip.diaries[date];
  const pending = diaryBlocks(trip, date);
  const pendingPhotos = pending.reduce((n, d) => n + d.block.photoIds.length, 0);
  const me = myMemberId(trip);
  const left = !!me && trip.members.find((m) => m.id === me)?.leftAt != null;
  const canWrite = !!me && !left;
  // 머리 보조 줄은 보이는 일기 기준이다(일기가 없으면 만들 기록 기준).
  const visits = entry
    ? entry.blocks.filter((b) => b.spotId && trip.visits.some((v) => v.date === date && v.spotId === b.spotId && v.status === 'arrived')).length
    : new Set(trip.visits.filter((v) => v.date === date && v.status === 'arrived').map((v) => v.spotId)).size;
  const photoCount = entry ? entry.blocks.reduce((n, b) => n + b.photoIds.length, 0) : pendingPhotos;
  const sub = `방문 ${visits}곳 · 사진 ${photoCount}장${entry?.sharedAt != null ? ' · 공유함' : ''}`;
  // 'AI가 쓴 문장'은 아직 고치지 않은 문장이 남아 있을 때만 맨 아래 한 줄로 알린다.
  const aiText = getServices().diary.id === 'ai' && !!entry && entry.blocks.some((b) => b.text && b.editedAt == null);
  const stale = entry ? diaryStaleness(trip, entry) : undefined;
  const staleParts: string[] = [];
  if (stale && stale.newRecords > 0) staleParts.push(`새 기록 ${stale.newRecords}건이 일기에 없어요`);
  if (stale && stale.blankBlocks > 0) staleParts.push(`사진이 지워져 비운 문단이 ${stale.blankBlocks}개 있어요`);
  const outside = photosOutsideTrip(trip).length;

  const make = async () => {
    if (busy) return;
    setBusy(true);
    const r = await generateDiary(tripId, date);
    setBusy(false);
    // 저장 거부는 스토어가 이유를 토스트로 띄운다.
    if (!r.ok) return;
    if (r.entry.status === 'empty') {
      toast(r.entry.blocks.length ? '문장을 만들지 못해 빈 일기를 두었어요' : '이 날은 기록이 없어 빈 일기예요', 'warn');
    }
  };

  const share = async () => {
    const r = await shareDiary(tripId, date);
    if (r === 'shared') toast('일기를 공유했어요');
    else if (r === 'copied') toast('공유를 쓸 수 없어 일기 글을 복사했어요');
    else if (r === 'failed') toast('공유와 복사가 모두 안 돼요. 이 브라우저에서는 글을 직접 옮겨 주세요', 'warn');
  };

  const closeEdit = () => {
    setAskSave(false);
    setEditing(undefined);
  };
  const dirty = !!editing && draft.trim() !== editing.text.trim();
  // 고친 내용이 있으면 닫기를 가로채 저장할지 묻는다(입력을 잃지 않는다).
  const requestClose = () => {
    if (dirty) setAskSave(true);
    else closeEdit();
  };
  const save = () => {
    if (!editing) return;
    const text = draft.trim();
    // 바꾸지 않고 저장하면 보내지 않는다(고친 문장으로 표시되어 다시 만들기에서 고정되지 않게).
    if (text !== editing.text.trim()) editDiaryBlock(tripId, date, editing.id, text);
    closeEdit();
  };

  return (
    <Screen keyboard>
      <Header
        back={back}
        eyebrow={trip.title}
        title="여행 기록"
        sub={sub}
        right={entry && canWrite ? <IconBtn icon="dots" label="일기 메뉴" onPress={() => setMenu(true)} /> : undefined}
      />
      <View style={{ paddingHorizontal: SP.gutter, paddingBottom: SP.m, gap: SP.m }}>
        <RecordTabs current="Diary" tripId={tripId} date={date} />
        <DateSeg trip={trip} value={date} onChange={setDate} />
      </View>
      <Body scroll>
        {left ? <Notice icon="users" text="나간 멤버는 일기를 볼 수만 있어요" /> : null}
        {busy ? <Notice icon="clock" title="일기 만드는 중" text="사진과 도착 기록을 시간순으로 묶어 문장을 쓰고 있어요" /> : null}
        {!busy && canWrite && staleParts.length > 0 ? (
          <Notice icon="plus" text={staleParts.join(' · ')} action={{ label: '다시 만들기', onPress: () => void make() }} />
        ) : null}

        {!entry ? (
          busy ? null : pending.length > 0 ? (
            canWrite ? (
              <Empty
                icon="book"
                title={`${daySegLabel(date)} 일기를 만들 수 있어요`}
                text={`방문 ${visits}곳 · 사진 ${pendingPhotos}장을 시간순으로 묶어요`}
                action={{ label: '일기 만들기', onPress: () => void make() }}
              />
            ) : (
              <Empty
                icon="book"
                title={`${daySegLabel(date)} 일기가 아직 없어요`}
                text={`방문 ${visits}곳 · 사진 ${pendingPhotos}장 기록이 있어요`}
              />
            )
          ) : (
            <Empty
              icon="book"
              title="이 날은 기록이 없어요"
              text={canWrite ? '사진을 올리거나 장소에 도착하면 일기를 만들 수 있어요' : undefined}
              action={canWrite ? { label: '사진 올리기', onPress: () => navigation.replace('Photos', { tripId, date }) } : undefined}
            />
          )
        ) : (
          <>
            {entry.status === 'empty' ? (
              <Notice
                tone="warn"
                title="빈 일기"
                text={
                  entry.blocks.length > 0
                    ? canWrite
                      ? '문장을 만들지 못했어요. 문단을 눌러 직접 쓸 수 있어요.'
                      : '문장을 만들지 못했어요.'
                    : '이 날은 기록이 없어 빈 일기예요.'
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
                onPress={
                  canWrite
                    ? () => {
                        setEditing(b);
                        setDraft(b.text);
                        setAskSave(false);
                      }
                    : undefined
                }
              />
            ))}
          </>
        )}

        {aiText || outside > 0 ? (
          <Col gap={SP.xs}>
            {aiText ? <Txt v="mtTight">{canWrite ? 'AI가 쓴 문장이 들어 있어요. 문단을 눌러 고칠 수 있어요' : 'AI가 쓴 문장이 들어 있어요'}</Txt> : null}
            {outside > 0 ? <Txt v="mtTight">{`여행 기간 밖에 찍은 사진 ${outside}장은 일기에 넣지 않았어요`}</Txt> : null}
          </Col>
        ) : null}
      </Body>
      {entry && entry.blocks.length > 0 ? (
        <Foot>
          <Btn title="공유하기" icon="share" onPress={() => setShareOpen(true)} />
        </Foot>
      ) : null}

      <Sheet visible={shareOpen} onClose={() => setShareOpen(false)} title="일기 공유하기">
        <View>
          <ListRow
            first
            icon="share"
            label="메시지·메모로 보내기"
            sub="공유를 쓸 수 없으면 일기 글을 복사해요"
            onPress={() => void share().finally(() => setShareOpen(false))}
          />
          {/* 이 날의 일기를 커뮤니티 글로 올린다(글쓰기 화면이 본문을 채워 연다) */}
          {entry && entry.blocks.length > 0 ? (
            <ListRow
              icon="users"
              label="커뮤니티에 올리기"
              sub="일기 글과 사진으로 글쓰기를 열어요"
              onPress={() => {
                setShareOpen(false);
                navigation.navigate('CommunityCompose', { tripId, date });
              }}
            />
          ) : null}
        </View>
      </Sheet>

      <Sheet visible={menu} onClose={() => setMenu(false)} title="일기 메뉴">
        <View>
          <ListRow
            first
            icon="undo"
            label="다시 만들기"
            sub="고친 문장은 그대로 두고 새 기록을 넣어요"
            disabled={busy}
            onPress={() => {
              setMenu(false);
              void make();
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={!!editing}
        onClose={askSave ? () => setAskSave(false) : requestClose}
        title={askSave ? '고친 문장을 저장할까요' : editing ? `${editing.time} ${editing.placeName}` : ''}
      >
        {askSave ? (
          <>
            <Txt v="body" c="muted">
              저장하지 않으면 고친 내용이 사라져요.
            </Txt>
            <Col gap={SP.m}>
              <Btn title="저장하고 닫기" onPress={save} />
              <Btn title="저장하지 않고 닫기" variant="quiet" onPress={closeEdit} />
              <Btn title="계속 고치기" variant="quiet" onPress={() => setAskSave(false)} />
            </Col>
          </>
        ) : (
          <>
            <Field
              label="문장"
              value={draft}
              onChangeText={setDraft}
              maxLength={1000}
              multiline
              minLines={4}
              placeholder="이 곳에서의 하루를 적어 주세요"
            />
            <Col gap={SP.m}>
              <Btn title="저장" onPress={save} />
              <Btn title="취소" variant="quiet" onPress={requestClose} />
            </Col>
          </>
        )}
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
  /** 없으면(나간 멤버) 고칠 수 없다 */
  onPress?: () => void;
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
              {onPress ? (
                <Txt v="mtTight" c="accent">
                  고치기
                </Txt>
              ) : null}
            </Row>
            {photos.length > 0 ? (
              <Row gap={SP.s} wrap>
                {photos.map((p) => (
                  <PhotoTile key={p.id} photo={p} size={THUMB} />
                ))}
              </Row>
            ) : null}
            {block.text ? <Txt v="body">{block.text}</Txt> : <Txt v="mt">{onPress ? '문장 없음 · 눌러서 쓰기' : '문장 없음'}</Txt>}
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
