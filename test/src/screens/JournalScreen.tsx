import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';

import type { DiaryBlock, Photo, Trip } from '../types';
import { datesWithRecords, diaryBlocks, diaryStaleness } from '../core/journal/diary';
import { formatBytes, isDateAssigned, isPlaceEstimated, photosOutsideTrip, stillOverLimit } from '../core/journal/photo';
import { isEnded } from '../core/tripStatus';
import { dateRange, kstDate, kstHHMM } from '../core/util';
import { DateSeg, initialDate } from '../features/journal/components/DateSeg';
import { photoBadge, PhotoTile } from '../features/journal/components/PhotoTile';
import {
  addDiaryNote,
  editDiaryBlock,
  generateDiary,
  pickAndImport,
  pruneSessionPhotos,
  removePhoto,
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
  ConfirmSheet,
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
  TextLink,
  Txt,
} from '../ui';

/**
 * 여행일지(FR-701·702·703, 3차, 2026-10-17 사용자 요청: 일기와 사진을 한 화면으로, 기록 지도는 없앴다).
 * 날짜 탭 아래에 그날의 일기와 사진이 같이 나온다. '전체' 탭은 사진을 날짜별로 묶어 보여 준다(기간 밖 사진은 맨 아래 묶음).
 * - 일기가 있는 날: 사진·도착 기록·장소를 시간순 블록으로 묶은 일기(블록 안 사진을 누르면 사진 정보). 일기가 없는 날: 그날 사진
 *   격자와 '일기 만들기'(만들 기록이 있을 때). 기록이 없으면 '이 날은 기록이 없어요'.
 * - 아래 고정 줄: '사진 올리기'와(일기가 있으면) '공유하기'. 시트에서 '메시지·메모로 보내기'와 '커뮤니티에 올리기'를 고른다.
 * - 머리말 dots 시트: '다시 만들기'(기록이 뒤처졌을 때의 안내에도 있다), 시연용 '예시 사진 3장 넣기'.
 * - 사진은 올린 사람만 지운다. 타일 배지는 하나(날짜 지정 > 추정 > 장소 추정), 압축 여부는 사진 정보 시트에만 보인다.
 * - 문장 편집은 나중 저장 우선(FR-503과 같은 정책). 고친 채로 시트를 닫으려 하면 저장할지 한 번 묻는다.
 * - 여행이 끝나도 만들고 고치고 사진을 올리고 볼 수 있다(종료 잠금 예외). 끝난 뒤 처음 연 날짜에 기록이 있고 일기가 없으면 자동으로 만든다.
 * - 블록 행은 09 시간표 문법(카드 밖 52px 시각 열 + 축 점 + 오른쪽 카드)을 따른다. 나간 멤버는 볼 수만 있다.
 * - 뒤로는 useBack('Home'), 없는 여행방은 NotFound('홈으로').
 */

const THUMB = 56;
const GRID_GAP = SP.s;
const AXIS_W = 18;
const DOT = 10;

interface PhotoGroup {
  key: string;
  title: string;
  /** 여행 기간 안의 날짜(기간 밖 묶음은 없음) */
  date?: string;
  photos: Photo[];
}

export default function JournalScreen({ navigation, route }: RootScreenProps<'Journal'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const now = useNow();
  useSessionPhotosVersion();
  const back = useBack('Home');
  const [picked, setDate] = useState(() =>
    trip ? (route.params.date === 'all' ? 'all' : initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip))) : '',
  );
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<Photo | undefined>();
  const [confirmPhoto, setConfirmPhoto] = useState<Photo | undefined>();
  const [editing, setEditing] = useState<DiaryBlock | undefined>();
  const [draft, setDraft] = useState('');
  const [askSave, setAskSave] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  /** 직접 일기 쓰기 시트와 그 글 */
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState('');
  const toast = useUi((s) => s.showToast);
  const autoTried = useRef(new Set<string>());

  useEffect(() => {
    if (trip) pruneSessionPhotos(trip.photos.map((p) => p.id));
  }, [trip, trip?.photos]);

  // 여행이 끝난 뒤 기록이 있는데 일기가 없는 날짜를 처음 열면 자동으로 만든다(FR-700 자동 정리). 날짜마다 한 번만 시도한다.
  const autoDate = trip ? (picked === 'all' ? '' : picked || initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip))) : '';
  const needsAuto =
    !!trip &&
    !!autoDate &&
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

  const sorted = useMemo(() => [...(trip?.photos ?? [])].sort((a, b) => a.takenAt - b.takenAt), [trip?.photos]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sorted.length };
    for (const p of sorted) c[kstDate(p.takenAt)] = (c[kstDate(p.takenAt)] ?? 0) + 1;
    return c;
  }, [sorted]);

  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="여행일지" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  // 첫 화면에서 여행방이 아직 없었으면 여기서 날짜를 정한다. 기간 밖 날짜는 전체로 본다.
  const days = dateRange(trip.startDate, trip.endDate);
  const raw = picked || initialDate(trip, kstDate(now), route.params.date, datesWithRecords(trip));
  const date = raw === 'all' || days.includes(raw) ? raw : 'all';
  const isAll = date === 'all';
  const entry = isAll ? undefined : trip.diaries[date];
  const pending = isAll ? [] : diaryBlocks(trip, date);
  const pendingPhotos = pending.reduce((n, d) => n + d.block.photoIds.length, 0);
  const me = myMemberId(trip);
  const left = !!me && trip.members.find((m) => m.id === me)?.leftAt != null;
  const canWrite = !!me && !left;
  // 머리 보조 줄은 보이는 일기 기준이다(일기가 없으면 만들 기록 기준).
  const visits = entry
    ? entry.blocks.filter((b) => b.spotId && trip.visits.some((v) => v.date === date && v.spotId === b.spotId && v.status === 'arrived')).length
    : new Set(trip.visits.filter((v) => v.date === date && v.status === 'arrived').map((v) => v.spotId)).size;
  const photoCount = entry ? entry.blocks.reduce((n, b) => n + b.photoIds.length, 0) : pendingPhotos;
  const dayNo = isAll ? 0 : days.indexOf(date) + 1;
  const sub = isAll ? `사진 ${trip.photos.length}장` : `${dayNo}일차 · ${daySegLabel(date)} · 방문 ${visits}곳 · 사진 ${photoCount}장${entry?.sharedAt != null ? ' · 공유함' : ''}`;
  const dayPhotos = isAll ? [] : sorted.filter((p) => kstDate(p.takenAt) === date);
  const size = width > 0 ? Math.floor((width - GRID_GAP * 2) / 3) : 0;
  const spotName = (id?: string) => (id ? trip.spots.find((s) => s.id === id)?.name : undefined);
  const memberOf = (id: string) => trip.members.find((m) => m.id === id);
  const selDate = selected ? kstDate(selected.takenAt) : '';
  const selMine = !!selected && !!me && selected.memberId === me;
  const shareable = !!entry && entry.blocks.length > 0;
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

  const addPhotos = async (source: 'device' | 'sim') => {
    if (adding) return;
    setAdding(true);
    const fallbackDate = isAll ? undefined : date;
    const r = await pickAndImport(tripId, source, fallbackDate);
    setAdding(false);
    if (!r.ok) {
      toast(r.message, 'warn');
      return;
    }
    // 고르지 않았거나 한 장도 올라가지 않았으면(저장 거부는 스토어가 이유를 알린다) 성공 토스트를 띄우지 않는다.
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

  const groups: PhotoGroup[] = [];
  if (isAll) {
    for (const d of days) {
      const ps = sorted.filter((p) => kstDate(p.takenAt) === d);
      if (ps.length > 0) groups.push({ key: d, title: daySegLabel(d), date: d, photos: ps });
    }
    const out = sorted.filter((p) => !days.includes(kstDate(p.takenAt)));
    if (out.length > 0) groups.push({ key: 'outside', title: '여행 기간 밖', photos: out });
  }

  const grid = (photos: Photo[]) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
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

  const share = async () => {
    const r = await shareDiary(tripId, date);
    if (r === 'shared') toast('일기를 공유했어요');
    else if (r === 'copied') toast('공유를 쓸 수 없어 일기 글을 복사했어요');
    else if (r === 'failed') toast('공유와 복사가 모두 안 돼요. 이 브라우저에서는 글을 직접 옮겨 주세요', 'warn');
  };

  const saveNote = () => {
    const text = note.trim();
    if (!text || isAll) return;
    const r = addDiaryNote(tripId, date, text);
    if (r.ok) {
      setNote('');
      setWriting(false);
      toast(`${dayNo}일차 일기를 저장했어요`);
    }
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
        title="여행일지"
        sub={sub}
        right={canWrite ? <IconBtn icon="dots" label="일지 메뉴" onPress={() => setMenu(true)} /> : undefined}
      />
      <View style={{ paddingHorizontal: SP.gutter, paddingBottom: SP.m }}>
        <DateSeg trip={trip} value={date} onChange={setDate} all photoCounts={counts} showCount />
      </View>
      <Body scroll>
        {left ? <Notice icon="users" text="나간 멤버는 일지를 볼 수만 있어요" /> : null}
        {busy ? <Notice icon="clock" title="일기 만드는 중" text="사진과 도착 기록을 시간순으로 묶어 문장을 쓰고 있어요" /> : null}
        {!busy && canWrite && staleParts.length > 0 ? (
          <Notice icon="plus" text={staleParts.join(' · ')} action={{ label: '다시 만들기', onPress: () => void make() }} />
        ) : null}

        <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ gap: SP.xl }}>
          {isAll ? (
            groups.length === 0 ? (
              <Empty
                icon="camera"
                title="아직 올린 사진이 없어요"
                text={canWrite ? '찍은 시각과 장소로 날짜와 일기에 저절로 들어가요' : undefined}
              />
            ) : size === 0 ? null : (
              groups.map((g) => (
                <Col key={g.key} gap={SP.m}>
                  <Row>
                    <Col grow>
                      <Txt v="nm">{g.title}</Txt>
                      <Txt v="mtTight">{g.date ? `사진 ${g.photos.length}장` : `사진 ${g.photos.length}장 · 일기에는 들어가지 않아요`}</Txt>
                    </Col>
                    {g.date ? <TextLink title="이 날 일지" onPress={() => setDate(g.date!)} /> : null}
                  </Row>
                  {grid(g.photos)}
                </Col>
              ))
            )
          ) : !entry ? (
            busy ? null : (
              <>
                {dayPhotos.length > 0 && size > 0 ? (
                  <Col gap={SP.m}>
                    <Txt v="eyebrow">{`사진 ${dayPhotos.length}장`}</Txt>
                    {grid(dayPhotos)}
                  </Col>
                ) : null}
                {pending.length > 0 ? (
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
                ) : dayPhotos.length === 0 ? (
                  <Empty
                    icon="book"
                    title="이 날은 기록이 없어요"
                    text={canWrite ? '아래 \'일기 쓰기\'로 직접 적거나, 사진을 올리면 일기를 만들 수 있어요' : undefined}
                    action={canWrite ? { label: '일기 쓰기', onPress: () => setWriting(true) } : undefined}
                  />
                ) : null}
              </>
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
                onPhoto={setSelected}
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
        </View>

        {aiText || outside > 0 ? (
          <Col gap={SP.xs}>
            {aiText ? <Txt v="mtTight">{canWrite ? 'AI가 쓴 문장이 들어 있어요. 문단을 눌러 고칠 수 있어요' : 'AI가 쓴 문장이 들어 있어요'}</Txt> : null}
            {outside > 0 ? <Txt v="mtTight">{`여행 기간 밖에 찍은 사진 ${outside}장은 일기에 넣지 않았어요`}</Txt> : null}
          </Col>
        ) : null}
      </Body>
      {canWrite ? (
        <Foot>
          <Row gap={SP.m}>
            {!isAll ? (
              <View style={{ flex: 1 }}>
                <Btn title="일기 쓰기" icon="pen" onPress={() => setWriting(true)} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Btn
                title={adding ? '올리는 중' : '사진 추가'}
                icon="camera"
                variant={isAll ? 'primary' : 'quiet'}
                onPress={() => void addPhotos('device')}
                disabled={adding}
              />
            </View>
          </Row>
        </Foot>
      ) : null}

      <Sheet visible={writing} onClose={() => setWriting(false)} title={`${dayNo}일차 일기 쓰기`}>
        <Field
          label="일기"
          value={note}
          onChangeText={setNote}
          maxLength={1000}
          multiline
          minLines={5}
          placeholder="오늘 어디를 가고 무엇을 느꼈는지 적어 주세요"
        />
        <Col gap={SP.m}>
          <Btn title="저장" onPress={saveNote} disabled={note.trim().length === 0} />
          <Btn title="취소" variant="quiet" onPress={() => setWriting(false)} />
        </Col>
      </Sheet>

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

      <Sheet visible={menu} onClose={() => setMenu(false)} title="일지 메뉴">
        <View>
          {shareable ? (
            <ListRow
              first
              icon="share"
              label="일기 공유하기"
              sub="메시지·메모나 커뮤니티로 보내요"
              onPress={() => {
                setMenu(false);
                setShareOpen(true);
              }}
            />
          ) : null}
          {entry ? (
            <ListRow
              first={!shareable}
              icon="undo"
              label="다시 만들기"
              sub="고친 문장은 그대로 두고 새 기록을 넣어요"
              disabled={busy}
              onPress={() => {
                setMenu(false);
                void make();
              }}
            />
          ) : null}
        </View>
        <Txt v="eyebrow">시연</Txt>
        <View>
          <ListRow
            first
            icon="camera"
            label="예시 사진 3장 넣기"
            sub="여행 시뮬레이터의 시각과 위치로 만든 사진이에요"
            disabled={adding}
            onPress={() => {
              setMenu(false);
              void addPhotos('sim');
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
            {days.includes(selDate) && date !== selDate ? (
              <Btn
                title="이 날 일지 보기"
                icon="book"
                variant="quiet"
                onPress={() => {
                  setSelected(undefined);
                  setDate(selDate);
                }}
              />
            ) : null}
            {selMine && canWrite ? (
              <Btn
                title="사진 지우기"
                icon="trash"
                variant="quiet"
                onPress={() => {
                  setConfirmPhoto(selected);
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
        visible={!!confirmPhoto}
        title="사진을 지울까요"
        text="여행방과 일기에서 이 사진이 빠져요. 되돌릴 수 없어요."
        confirmLabel="지우기"
        onCancel={() => setConfirmPhoto(undefined)}
        onConfirm={() => {
          if (confirmPhoto) removePhoto(tripId, confirmPhoto.id);
          setConfirmPhoto(undefined);
        }}
      />

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
  onPhoto,
}: {
  trip: Trip;
  block: DiaryBlock;
  first: boolean;
  last: boolean;
  /** 없으면(나간 멤버) 고칠 수 없다 */
  onPress?: () => void;
  /** 블록 안 사진을 누르면 사진 정보 */
  onPhoto?: (p: Photo) => void;
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
                  <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${kstHHMM(p.takenAt)} 사진 정보`} onPress={() => onPhoto?.(p)}>
                    <PhotoTile photo={p} size={THUMB} />
                  </Pressable>
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
