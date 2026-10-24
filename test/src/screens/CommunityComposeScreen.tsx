import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, Pressable, ScrollView, View } from 'react-native';

import type { CommunityPhoto, CommunityPhotoInput } from '../core/ports';
import {
  addTag,
  BODY_MAX,
  checkDraft,
  diaryAsText,
  EDIT_SAVED_TEXT,
  editContentOf,
  editDraftOf,
  editLeaveDecision,
  failText,
  isEditDirty,
  leaveDecision,
  openPlan,
  PHOTOS_MAX,
  restoredText,
  splitTagInput,
  TAGS_MAX,
  timeAgo,
  TITLE_MAX,
  withPendingTag,
  type ComposeContent,
  type DraftOrigin,
  type EditContent,
  type LeaveDecision,
  type SavedDraft,
} from '../core/community';
import { dayLabel } from '../core/util';
import { communityDrafts } from '../features/community/drafts';
import type { RootScreenProps } from '../navigation/routes';
import { appClock } from '../services/clock';
import { pickCommunityPhotos } from '../services/community/picker';
import { getServices } from '../services/registry';
import { useCommunity } from '../store/community';
import { useSession } from '../store/session';
import { useTripDoc } from '../store/trips';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Col, ConfirmSheet, Empty, Field, Foot, Header, Icon, IconBtn, KeyboardAvoid, lineC, Notice, R, Row, Screen, Sheet, SP, surfaceC, Tag, TextLink, Txt } from '../ui';

/**
 * 29 커뮤니티 글쓰기(WP6 소유, 2026-10-10, 2026-10-11 v2). 글은 서버에 올라가 앱 사용자 모두가 본다.
 * - 글은 한 가지다(사진·일기 고르기 없음). 사진 0~4장·본문·태그 0~5개·제목(선택). 본문이나 사진 하나면 올린다(core/community checkDraft).
 * - 배치(2026-10-17): 사진 줄을 맨 위에 크게, 그 아래 제목(선택), 본문(글자 수는 Field가 보인다), 태그 줄(직접 입력만, 추천 없음). '올리기'는 아래에 늘 있고
 *   못 올리면 그 이유를 버튼 위에 적는다. iOS는 키보드가 버튼을 가리지 않게 밀어 올린다.
 * - 태그: 띄어쓰기·쉼표·Enter로 하나씩 넣는다(한글 조합 중에는 끊지 않는다: 조합 글자에는 구분 기호가 없다).
 *   추천 태그 줄은 두지 않는다(사용자가 직접 적는다). 사진 안내 문구도 뺐다.
 * - 임시 저장(features/community/drafts, 사람마다 하나, 앱을 껐다 켜도 남는다): 앱이 뒤로 가면 저장한다. 다시 열면 이어 쓰고
 *   '새로 쓰기'로 지울 수 있다(확인 1회). 일기에서 열었는데 다른 곳에서 쓰던 글이 있으면 둘 중 고른다(core/community openPlan).
 *   사진 저장이 실패해도 글은 남고 '사진은 임시 저장하지 못했어요'를 한 번 알린다.
 * - 나가기 확인: 저장하지 않은 바뀐 내용이 있으면 beforeRemove로 막고 '나가시겠습니까?' 시트에 '저장하고 나가기'·'취소' 두 버튼만 둔다.
 *   뒤로 버튼·안드로이드 뒤로·iOS 밀기·웹 뒤로가 모두 beforeRemove를 지난다. 올린 직후·빈 글·안 바뀐 글은 묻지 않는다(leaveDecision).
 * - 로그인한 계정만. 사진 고르기는 버튼을 누른 뒤에만 연다. 올리기는 한 번만 보낸다.
 * - 고치기(2026-10-17, route editPostId): 피드에 있는 내 글로 제목·본문·태그·사진을 채운다. 예전 사진(kept)은 서버 주소로 보이고 뺄 수 있고,
 *   새 사진은 합쳐 4장까지 더한다. 머리 제목 '글 수정', 버튼 '저장하기'(바뀐 것이 없으면 못 누른다), 저장하면 '글을 고쳤어요'.
 *   임시 저장은 쓰지 않는다(draftUser가 없다): 새 글 임시 저장을 읽지도, 덮지도, 지우지도 않는다. 나가기 확인은 처음 연 글과 비교해
 *   바뀐 것이 있으면 묻는다(core/community editLeaveDecision, '나가기'를 누르면 고친 내용은 버린다).
 */

const TILE = 112;

export default function CommunityComposeScreen({ navigation, route }: RootScreenProps<'CommunityCompose'>) {
  const session = useSession((s) => s.session);
  const userId = session?.kind === 'account' ? session.userId : undefined;
  const publish = useCommunity((s) => s.publish);
  const edit = useCommunity((s) => s.edit);
  const editPostId = route.params?.editPostId;
  const editing = editPostId != null;
  const editPost = useCommunity((s) => (editPostId ? s.posts.find((p) => p.id === editPostId) : undefined));
  /** 임시 저장을 쓰는 사람. 고치기에서는 없다(새 글 임시 저장을 건드리지 않는다) */
  const draftUser = editing ? undefined : userId;
  const routeTripId = editing ? undefined : route.params?.tripId;
  const routeDate = editing ? undefined : route.params?.date;
  const trip = useTripDoc(routeTripId);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState('');
  const [photos, setPhotos] = useState<CommunityPhotoInput[]>([]);
  const [kept, setKept] = useState<CommunityPhoto[]>([]);
  const [origin, setOrigin] = useState<DraftOrigin | null>(null);
  // 최근 태그는 불러 두기만 한다(추천 태그 줄은 2026-10-17에 뺐다. 태그는 사용자가 직접 적는다)
  const [, setRecent] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [choice, setChoice] = useState<SavedDraft | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [freshAsk, setFreshAsk] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [tagProblem, setTagProblem] = useState<string | undefined>(undefined);
  const [pickErr, setPickErr] = useState<string | undefined>(undefined);

  const sending = useRef(false);
  const published = useRef(false);
  const bypass = useRef(false);
  const savedRef = useRef<ComposeContent | null>(null);
  const originalRef = useRef<EditContent | null>(null);
  const pendingAction = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const pendingDiary = useRef<string | null>(null);
  const photoWarned = useRef(false);

  const content: ComposeContent = { title, body, tags: withPendingTag(tags, tagText), photos };
  const contentRef = useRef(content);
  contentRef.current = content;
  const originRef = useRef(origin);
  originRef.current = origin;
  const keptRef = useRef(kept);
  keptRef.current = kept;

  const setContent = (c: ComposeContent) => {
    setTitle(c.title);
    setBody(c.body);
    setTags(c.tags);
    setTagText('');
    setPhotos(c.photos);
  };

  const fillFromDiary = useCallback(
    (date: string) => {
      const entry = trip?.diaries[date];
      if (!trip || !entry) return;
      setBody(diaryAsText(entry));
      setTitle(`${trip.title} · ${dayLabel(date)}`.slice(0, TITLE_MAX));
      setOrigin({ tripId: trip.id, date });
    },
    [trip],
  );

  // 고치기로 열 때: 피드의 내 글로 한 번만 채운다(임시 저장은 읽지 않는다)
  useEffect(() => {
    if (!editing || !userId || !editPost || originalRef.current) return;
    const o = editContentOf(editPost);
    originalRef.current = o;
    setContent(o);
    setKept(o.kept);
    setReady(true);
    let live = true;
    void communityDrafts()
      .recentTags(userId)
      .then((rec) => {
        if (live) setRecent(rec);
      });
    return () => {
      live = false;
    };
  }, [editing, userId, editPost]);

  // 열 때: 저장한 글과 어디서 열었는지 보고 새 글·일기·이어 쓰기·고르기 중 하나
  useEffect(() => {
    if (!draftUser) return;
    let live = true;
    const from: DraftOrigin | null = routeTripId && routeDate ? { tripId: routeTripId, date: routeDate } : null;
    void (async () => {
      const store = communityDrafts();
      const [saved, rec] = await Promise.all([store.load(draftUser), store.recentTags(draftUser)]);
      if (!live) return;
      setRecent(rec);
      const plan = openPlan({ saved, origin: from });
      if (plan === 'restore' && saved) {
        setContent(saved);
        setOrigin(saved.origin);
        savedRef.current = { title: saved.title, body: saved.body, tags: saved.tags, photos: saved.photos };
        setRestoredAt(saved.updatedAt);
      } else if (plan === 'ask' && saved) setChoice(saved);
      else if (plan === 'diary' && from) pendingDiary.current = from.date;
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [draftUser, routeTripId, routeDate]);

  // 일기로 채우기는 여행방 문서가 있어야 한다(늦게 올 수 있다)
  useEffect(() => {
    if (!ready || !trip || !pendingDiary.current) return;
    const date = pendingDiary.current;
    pendingDiary.current = null;
    fillFromDiary(date);
  }, [ready, trip, fillFromDiary]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!draftUser) return true;
    const c = contentRef.current;
    const r = await communityDrafts().save(draftUser, { ...c, origin: originRef.current, updatedAt: appClock().now() });
    if (r.ok) savedRef.current = c;
    if (r.photos === 'failed' && !photoWarned.current) {
      photoWarned.current = true;
      useUi.getState().showToast('사진은 임시 저장하지 못했어요', 'warn');
    }
    return r.ok;
  }, [draftUser]);

  /** 떠날 때 할 일. 고치기는 처음 연 글과, 새 글은 임시 저장한 글과 비교한다 */
  const decide = (): LeaveDecision => {
    if (editing) {
      const original = originalRef.current;
      return original ? editLeaveDecision({ current: { ...contentRef.current, kept: keptRef.current }, original, published: published.current }) : 'leave';
    }
    return leaveDecision({ current: contentRef.current, saved: savedRef.current, published: published.current });
  };

  const isDirtyNow = () => decide() === 'ask';

  // 앱이 뒤로 가거나(홈 버튼·다른 앱) 웹 탭이 가려지면 저장한다
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && isDirtyNow()) void saveNow();
    });
    return () => sub.remove();
  }, [saveNow]);

  // 웹: 탭을 닫거나 새로 고칠 때 바뀐 내용이 있으면 저장하고 브라우저 확인을 띄운다
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!isDirtyNow()) return;
      void saveNow();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [saveNow]);

  // 나가기 확인. 뒤로 버튼·안드로이드 뒤로·iOS 밀기·웹 뒤로 모두 여기를 지난다
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (bypass.current) return;
        // 다른 화면(가입·로그인)이 위에 열려 있다가 그 화면이 스택을 정리하는 경우는 묻지 않는다
        if (!navigation.isFocused()) return;
        const d = decide();
        if (d === 'leave') return;
        if (d === 'clear') {
          if (draftUser) void communityDrafts().clear(draftUser);
          return;
        }
        e.preventDefault();
        pendingAction.current = e.data.action;
        setLeaving(true);
      }),
    [navigation, draftUser, editing],
  );

  const goOut = () => {
    bypass.current = true;
    const a = pendingAction.current;
    pendingAction.current = null;
    if (a) navigation.dispatch(a);
    else if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };

  /** 화면 위 뒤로. 뒤로 갈 곳이 없으면(바로 연 주소) beforeRemove가 돌지 않으니 여기서 같은 확인을 한다 */
  const back = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    const d = decide();
    if (d === 'ask') {
      pendingAction.current = null;
      setLeaving(true);
      return;
    }
    if (d === 'clear' && draftUser) void communityDrafts().clear(draftUser);
    goOut();
  };

  const saveAndLeave = async () => {
    setLeaving(false);
    await saveNow();
    goOut();
  };

  if (session?.kind !== 'account') {
    return (
      <Screen>
        <Header back={back} title={editing ? '글 수정' : '글쓰기'} />
        <Body>
          <Empty
            icon="user"
            title="로그인하면 글을 올릴 수 있어요"
            text="글은 계정 이름으로 올라가요"
            action={{ label: '로그인', onPress: () => navigation.navigate('Login') }}
          />
        </Body>
      </Screen>
    );
  }

  if (editing && !editPost && !originalRef.current) {
    return (
      <Screen>
        <Header back={back} title="글 수정" />
        <Body>
          <Empty
            icon="alert"
            title="고칠 글을 찾지 못했어요"
            text="커뮤니티에서 내 글의 수정을 다시 눌러 주세요"
            action={{ label: '커뮤니티로', onPress: goOut }}
          />
        </Body>
      </Screen>
    );
  }

  const check = checkDraft(content, kept.length);
  const original = originalRef.current;
  const unchanged = original != null && !isEditDirty({ ...content, kept }, original);

  const addPhotos = async () => {
    setPickErr(undefined);
    const r = await pickCommunityPhotos(photos.length + kept.length);
    if (!r.ok) {
      setPickErr(r.reason === 'denied' ? '사진 접근 권한이 없어요. 설정에서 허용해 주세요' : '사진을 불러오지 못했어요');
      return;
    }
    if (r.photos.length > 0) setPhotos([...photos, ...r.photos].slice(0, PHOTOS_MAX - kept.length));
  };

  /** 태그 칸 글자: 구분 기호로 끝난 것은 태그로 넣고, 치는 중인 글자는 칸에 둔다 */
  const onTagText = (text: string) => {
    const { done, rest } = splitTagInput(text);
    let next = tags;
    let issue: string | undefined;
    for (const d of done) {
      const r = addTag(next, d);
      next = r.tags;
      issue = r.problem ?? issue;
    }
    if (next !== tags) setTags(next);
    setTagText(rest);
    setTagProblem(issue);
  };

  const commitTag = () => {
    if (!tagText.trim()) return;
    const r = addTag(tags, tagText);
    setTags(r.tags);
    setTagProblem(r.problem);
    if (!r.problem) setTagText('');
  };

  const submit = async () => {
    if (sending.current) return;
    const c = contentRef.current;
    const draft = { title: c.title.trim(), body: c.body.trim(), tags: c.tags, photos: c.photos };
    const ck = checkDraft(draft, editing ? keptRef.current.length : 0);
    if (!ck.ok) {
      setProblem(ck.problem);
      return;
    }
    sending.current = true;
    setBusy(true);
    setProblem(undefined);
    if (editPostId) {
      // 고치기: 임시 저장은 건드리지 않는다
      const er = await edit(editPostId, editDraftOf({ ...c, kept: keptRef.current }));
      if (er.ok) {
        published.current = true;
        useUi.getState().showToast(EDIT_SAVED_TEXT);
        goOut();
        return;
      }
      sending.current = false;
      setBusy(false);
      setProblem(failText(er.code, er.detail));
      return;
    }
    const r = await publish(draft);
    if (r.ok) {
      published.current = true;
      const store = communityDrafts();
      await store.clear(session.userId);
      await store.rememberTags(session.userId, draft.tags);
      useUi.getState().showToast('글을 올렸어요');
      goOut();
      return;
    }
    sending.current = false;
    setBusy(false);
    setProblem(failText(r.code, r.detail));
  };

  const startFresh = async () => {
    setFreshAsk(false);
    await communityDrafts().clear(session.userId);
    savedRef.current = null;
    setRestoredAt(null);
    setContent({ title: '', body: '', tags: [], photos: [] });
    setOrigin(null);
  };

  const diaries = trip ? Object.values(trip.diaries).filter((d) => diaryAsText(d).length > 0).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const now = appClock().now();

  return (
    <Screen>
      <Header back={back} eyebrow="여행 이야기" title={editing ? '글 수정' : '글쓰기'} />
      <KeyboardAvoid>
        <Body scroll>
          {restoredAt != null ? (
            <Row gap={SP.m}>
              <Icon name="clock" size={14} color="muted" />
              <Txt v="mtTight" style={{ flex: 1 }}>
                {restoredText(timeAgo(restoredAt, now))}
              </Txt>
              <TextLink title="새로 쓰기" onPress={() => setFreshAsk(true)} />
            </Row>
          ) : null}

          <Col gap={SP.m}>
            <Row>
              <Txt v="label" style={{ flex: 1 }}>
                사진
              </Txt>
              <Txt v="mtTight">{`${kept.length + photos.length} / ${PHOTOS_MAX}`}</Txt>
            </Row>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.m }}>
              {kept.map((p, i) => (
                <View key={p.id} style={{ width: TILE, height: TILE }}>
                  <Image
                    source={{ uri: getServices().community.photoUri(p) }}
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`올린 사진 ${i + 1}`}
                    style={{ width: TILE, height: TILE, borderRadius: R.photo, backgroundColor: surfaceC.off }}
                  />
                  <View style={{ position: 'absolute', top: SP.xs, right: SP.xs, borderRadius: R.iconBtn, backgroundColor: surfaceC.photoScrim }}>
                    <IconBtn icon="x" color="onInk" label={`올린 사진 ${i + 1} 빼기`} onPress={() => setKept(kept.filter((x) => x.id !== p.id))} />
                  </View>
                </View>
              ))}
              {photos.map((p, i) => (
                <View key={`${i}-${p.data.length}`} style={{ width: TILE, height: TILE }}>
                  <Image
                    source={{ uri: `data:${p.mime};base64,${p.data}` }}
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`고른 사진 ${i + 1}`}
                    style={{ width: TILE, height: TILE, borderRadius: R.photo, backgroundColor: surfaceC.off }}
                  />
                  <View style={{ position: 'absolute', top: SP.xs, right: SP.xs, borderRadius: R.iconBtn, backgroundColor: surfaceC.photoScrim }}>
                    <IconBtn icon="x" color="onInk" label={`사진 ${i + 1} 빼기`} onPress={() => setPhotos(photos.filter((_, j) => j !== i))} />
                  </View>
                </View>
              ))}
              {photos.length + kept.length < PHOTOS_MAX ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="사진 고르기"
                  disabled={photos.length + kept.length >= PHOTOS_MAX || busy}
                  onPress={() => void addPhotos()}
                  style={{
                    width: TILE,
                    height: TILE,
                    borderRadius: R.photo,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: lineC.strong,
                    backgroundColor: surfaceC.card,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: SP.s,
                  }}
                >
                  <Icon name="camera" size={22} color="muted" />
                  <Txt v="mtTight">사진 고르기</Txt>
                </Pressable>
              ) : null}
            </ScrollView>
            {pickErr ? <Notice tone="warn" icon="alert" text={pickErr} /> : null}
          </Col>

          <Field label="제목 · 선택" value={title} onChangeText={setTitle} maxLength={TITLE_MAX} />

          <Col gap={SP.xs}>
            <Field
              label="내용"
              value={body}
              onChangeText={setBody}
              maxLength={BODY_MAX}
              multiline
              minLines={6}
              placeholder="여행에서 있었던 일을 적어 보세요"
            />
            {diaries.length > 0 ? (
              <Row>
                <TextLink title="내 여행 일기 불러오기" onPress={() => setImporting(true)} />
              </Row>
            ) : null}
          </Col>

          <Col gap={SP.m}>
            <Row>
              <Txt v="label" style={{ flex: 1 }}>
                태그
              </Txt>
              <Txt v="mtTight">{tags.length > 0 ? `누르면 빠져요 · ${tags.length} / ${TAGS_MAX}` : `${tags.length} / ${TAGS_MAX}`}</Txt>
            </Row>
            {tags.length > 0 ? (
              <Row gap={SP.m} wrap>
                {tags.map((t) => (
                  <Tag key={t} label={`#${t}`} on onPress={() => setTags(tags.filter((x) => x !== t))} />
                ))}
              </Row>
            ) : null}
            {tags.length < TAGS_MAX ? (
              <Field
                label="태그 넣기"
                hideLabel
                size="sm"
                value={tagText}
                onChangeText={onTagText}
                onSubmitEditing={commitTag}
                onBlur={commitTag}
                keepFocusOnSubmit
                returnKeyType="done"
                autoCapitalize="none"
                placeholder="#맛집처럼 적고 띄어쓰기"
              />
            ) : null}
            {tagProblem ? <Txt v="mtTight" c="accent">{tagProblem}</Txt> : null}
          </Col>

        </Body>
        <Foot>
          {problem ? <Notice tone="warn" icon="alert" text={problem} /> : null}
          {!problem && !check.ok && check.problem ? (
            <Txt v="mtTight">
              {check.problem}
            </Txt>
          ) : null}
          {!problem && check.ok && unchanged ? <Txt v="mtTight">고친 내용이 없어요</Txt> : null}
          {editing ? (
            <Btn title={busy ? '저장하는 중' : '저장하기'} disabled={busy || !ready || !check.ok || unchanged} onPress={() => void submit()} />
          ) : (
            <Btn title={busy ? '올리는 중' : '올리기'} disabled={busy || !ready || !check.ok} onPress={() => void submit()} />
          )}
        </Foot>
      </KeyboardAvoid>

      <ConfirmSheet
        visible={leaving && !editing}
        title="나가시겠습니까?"
        text="쓰던 글을 임시 저장해 두면 다음에 글쓰기를 열 때 이어서 쓸 수 있어요."
        confirmLabel="저장하고 나가기"
        onConfirm={() => void saveAndLeave()}
        onCancel={() => {
          pendingAction.current = null;
          setLeaving(false);
        }}
      />

      <ConfirmSheet
        visible={leaving && editing}
        title="고치지 않고 나갈까요"
        text="고친 내용은 저장되지 않아요. 글은 고치기 전 그대로 남아요."
        confirmLabel="나가기"
        onConfirm={() => {
          setLeaving(false);
          goOut();
        }}
        onCancel={() => {
          pendingAction.current = null;
          setLeaving(false);
        }}
      />

      <ConfirmSheet
        visible={freshAsk}
        title="새로 쓸까요"
        text="임시 저장한 글을 지우고 빈 글로 시작해요. 지운 글은 되돌릴 수 없어요."
        confirmLabel="새로 쓰기"
        onConfirm={() => void startFresh()}
        onCancel={() => setFreshAsk(false)}
      />

      <Sheet
        visible={choice != null}
        onClose={() => {
          if (choice) {
            setContent(choice);
            setOrigin(choice.origin);
            savedRef.current = { title: choice.title, body: choice.body, tags: choice.tags, photos: choice.photos };
            setRestoredAt(choice.updatedAt);
          }
          setChoice(null);
        }}
        title="쓰던 글이 있어요"
      >
        <Txt v="body" c="muted">
          {choice ? `${timeAgo(choice.updatedAt, now)} 저장한 글이 있어요. 어느 쪽으로 쓸까요?` : ''}
        </Txt>
        <View style={{ gap: 9 }}>
          <Btn
            title="쓰던 글 이어 쓰기"
            onPress={() => {
              if (choice) {
                setContent(choice);
                setOrigin(choice.origin);
                savedRef.current = { title: choice.title, body: choice.body, tags: choice.tags, photos: choice.photos };
                setRestoredAt(choice.updatedAt);
              }
              setChoice(null);
            }}
          />
          <Btn
            title="이 일기로 새로 쓰기"
            variant="quiet"
            onPress={() => {
              setChoice(null);
              if (routeDate) {
                if (trip) fillFromDiary(routeDate);
                else pendingDiary.current = routeDate;
              }
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={importing} onClose={() => setImporting(false)} title="일기 불러오기">
        <Col gap={SP.s}>
          {diaries.map((d) => (
            <Pressable
              key={d.date}
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(d.date)} 일기 불러오기`}
              onPress={() => {
                fillFromDiary(d.date);
                setImporting(false);
              }}
            >
              <Card>
                <Col gap={SP.xs}>
                  <Txt v="nm">{dayLabel(d.date)}</Txt>
                  <Txt v="mtTight" numberOfLines={2}>
                    {diaryAsText(d)}
                  </Txt>
                </Col>
              </Card>
            </Pressable>
          ))}
        </Col>
      </Sheet>
    </Screen>
  );
}
