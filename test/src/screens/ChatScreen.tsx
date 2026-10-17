import React, { useMemo, useReducer, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { orderedMessages } from '../core/chatOrder';
import { areaIndex, groupAreas } from '../core/chatmap/areas';
import { CHAT_MAP_INITIAL, chatMapStep } from '../core/chatmap/mapView';
import { pickOptions } from '../core/extract/manual';
import { activeMembers, isHost, tripMode } from '../core/group';
import { josa } from '../core/util';
import { regionById } from '../data/regions';
import { buildSummaryRequest, localSummary, SUMMARY_MIN_MESSAGES } from '../core/chatSummary';
import { TRANSPORT_LABEL } from '../core/constants';
import { getServices } from '../services/registry';
import type { ChatSummary } from '../core/ports';
import { nightsLabel, periodLabel } from '../core/trip/create';
import { PlacePickSheet } from '../features/candidates/components/PlacePickSheet';
import { Bubble } from '../features/chat/components/Bubble';
import { CandidateBar } from '../features/chat/components/CandidateBar';
import { ExtractionCardView } from '../features/chat/components/ExtractionCardView';
import { SendButton } from '../features/chat/components/SendButton';
import { AreaChips } from '../features/chat/map/AreaChips';
import { ChatMapView } from '../features/chat/map/ChatMapView';
import { resolvePick, sendChatMessage, undoExtraction } from '../features/chat/send';
import {
  extractionCard,
  memberIndex,
  messageA11yLabel,
  messageMeta,
  nearEnd,
  senderName,
  undoLosesEdits,
} from '../features/chat/view';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { myMemberId, usePlan, useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Avatar,
  Btn,
  Card,
  Chip,
  Col,
  ConfirmSheet,
  Empty,
  Field,
  H,
  Header,
  IconBtn,
  lineC,
  ListRow,
  NotFound,
  Notice,
  Row,
  Screen,
  Seg,
  Sheet,
  SP,
  Txt,
  useBottomInset,
} from '../ui';

/**
 * 05 그룹 채팅 · 장소 자동 추출(FR-304·401, WP3 소유)과 채팅방 지도(FR-405, 명세 밖 추가).
 * - 머리말은 한 줄(Header size 'row'): 뒤로 / 방 이름 + 보조 줄 / [채팅 | 지도](그룹이고 좁은 화면만) / 메뉴.
 * - 말풍선 안 장소는 면색으로 강조한다. 추출 결과는 메시지마다 묶음 카드 하나, 같은 줄에 되돌리기.
 * - 메시지 순서는 공유 orderedMessages. 같은 사람이 같은 분에 보낸 메시지는 묶고 시각은 묶음 끝에만, KST 날짜가 바뀌면 구분 줄.
 *   메시지 한 줄은 accessible View 하나로 묶어 스크린리더가 한 번에 읽는다(messageA11yLabel).
 * - 입력줄: Enter로 보내고(returnKeyType send, 포커스 유지), 키보드가 가리지 않게 Screen keyboard, 아래 안전 영역을 더한다.
 *   바닥 근처(80px)에 있었거나 방금 보냈을 때만 바닥으로 내린다. 입력줄 바로 위에 후보 요약 줄(CandidateBar)이 있다.
 * - 오프라인 안내는 앱 전체 OfflineBar가 맡는다. 여기서는 '전송 대기' 칩만 남긴다.
 * - 메뉴: 여행방 설정, 멤버·초대, 그리고 '시연'(보내는 사람 바꾸기, 시나리오 재생).
 * - 그룹 모드에만 지역 칩 줄과 지도가 있다. 좁은 화면(< 900)은 채팅을 늘 마운트해 스크롤을 지키고, 지도는 처음 '지도'로
 *   바꿀 때 마운트한 뒤 숨긴 채 유지한다(카메라·SDK 보존). 들어가면 '지도'가 먼저 보인다(그룹·좁은 화면). 넓은 화면(웹 900 이상)은 왼쪽 채팅 열(400)과 오른쪽 지도 열로 나눈다.
 *   '지도'로 바꿀 때(머리말·칩) 키보드를 내린다. 숨은 채팅 층은 웹에서 inert라 Tab 포커스도 들어가지 않는다.
 *   고른 지역은 지금 지역 목록에 있는 키만 칩에 보인다(데이터가 바뀌어 사라진 키는 고르지 않은 것으로 본다).
 * - 개인 모드(활성 멤버 1명)면 입력을 막고 이유를 적는다. 칩·지도·나누기는 없다.
 */

const IS_WEB = Platform.OS === 'web';
/** 웹에서 숨은 채팅 층을 Tab 순서·포커스에서 뺀다(RNW 0.21은 inert를 DOM에 넘긴다). 마운트는 그대로라 스크롤이 남는다 */
const INERT = { inert: true } as object;

/** 이 폭 이상이면 채팅과 지도를 나란히 둔다 */
const WIDE_MIN = 900;
/** 넓은 화면의 채팅 열 폭 */
const CHAT_COL_W = 400;

type ChatView = 'chat' | 'map';

/** KST 날짜 구분 줄(선 · 글자 · 선) */
function DayDivider({ label }: { label: string }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={label} style={styles.divider}>
      <View style={styles.dividerLine} />
      <Txt v="mtTight">{label}</Txt>
      <View style={styles.dividerLine} />
    </View>
  );
}

/** 이 앱 실행 중에 대화를 AI로 보내는 것에 동의했는지 */
let summaryConsented = false;

export default function ChatScreen({ navigation, route }: RootScreenProps<'Chat'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const online = useTrips((s) => s.online);
  const actingAs = useUi((s) => s.actingAs[tripId]);
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  const back = useBack('Home');
  const toast = useUi((s) => s.showToast);
  const bottom = useBottomInset();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_MIN;
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  /** 멤버 시트(방장은 여기서 내보낸다) */
  const [membersOpen, setMembersOpen] = useState(false);
  /** AI 대화 요약: 동의 확인 → 요약 시트 */
  const [sumStep, setSumStep] = useState<'closed' | 'consent' | 'view'>('closed');
  const [summary, setSummary] = useState<ChatSummary | undefined>();
  const [sumBusy, setSumBusy] = useState(false);
  const sumTicket = useRef(0);
  const [removing, setRemoving] = useState<{ id: string; nickname: string } | undefined>();
  const [pick, setPick] = useState<{ messageId: string; phrase: string } | undefined>();
  const [undoAsk, setUndoAsk] = useState<{ messageId: string; names: string[] } | undefined>();
  // 좁은 화면은 '지도'로 연다(2026-10-17 사용자 요청: 채팅방에 들어가면 지도를 바로 보여 주기)
  // 혼자 여행(채팅 메모)은 입력이 먼저라 '채팅'으로 열고, 지도는 위 탭으로 본다
  const [view, setView] = useState<ChatView>(trip && tripMode(trip) === 'personal' ? 'chat' : 'map');
  const [mapMounted, setMapMounted] = useState(true);
  const [sel, act] = useReducer(chatMapStep, CHAT_MAP_INITIAL);
  const scroll = useRef<ScrollView>(null);
  /** 바닥 근처에 있는지(새 메시지가 오면 따라 내려갈지) */
  const stick = useRef(true);
  const justSent = useRef(false);

  void actingAs; // actingAs가 바뀌면 다시 그려서 보내는 사람을 새로 계산한다
  const me = trip ? myMemberId(trip) : undefined;
  const messages = useMemo(() => (trip ? orderedMessages(trip) : []), [trip]);
  const metas = useMemo(() => messageMeta(messages, me), [messages, me]);
  const areas = useMemo(
    () => (trip ? groupAreas(trip.spots, regionById(trip.region), activeMembers(trip)) : []),
    [trip],
  );
  const areaBySpot = useMemo(() => areaIndex(areas), [areas]);

  if (!trip) {
    return (
      <Screen>
        <Header size="row" back={back} title="그룹 채팅" />
        <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
      </Screen>
    );
  }

  const meMember = trip.members.find((m) => m.id === me);
  const group = tripMode(trip) === 'group';
  const active = activeMembers(trip);
  const region = regionById(trip.region);
  const mapOn = !wide && view === 'map';
  const selArea = sel.selArea && areas.some((a) => a.key === sel.selArea) ? sel.selArea : null;

  const send = async () => {
    const body = text.trim();
    if (!body || !me) return;
    setText('');
    justSent.current = true;
    const r = await sendChatMessage(tripId, body, { actorId: me });
    if (!r.ok) setText(body);
  };

  const askUndo = (messageId: string) => {
    const msg = trip.messages.find((x) => x.id === messageId);
    const names = msg ? undoLosesEdits(trip, msg) : [];
    if (names.length > 0) setUndoAsk({ messageId, names });
    else undoExtraction(tripId, messageId);
  };

  const optionsOf = (messageId: string, phrase: string) => {
    const entry = trip.messages.find((m) => m.id === messageId)?.extraction?.ambiguous.find((a) => a.phrase === phrase);
    return entry && region ? pickOptions(entry.options, region, trip).filter((o) => !o.outside) : [];
  };
  const options = pick ? optionsOf(pick.messageId, pick.phrase) : [];

  /** 지도로 바꿀 때 입력 칸 포커스와 키보드를 내린다(숨은 입력 칸에 글자가 들어가거나 키보드가 지도를 가리지 않게) */
  const leaveComposer = () => {
    if (!wide) Keyboard.dismiss();
  };
  const switchView = (v: ChatView) => {
    if (v === 'map') {
      leaveComposer();
      setMapMounted(true);
    } else act({ t: 'toChat' });
    setView(v);
  };
  const pickArea = (key: string) => {
    leaveComposer();
    act({ t: 'area', key });
    setMapMounted(true);
    setView('map');
  };
  /** 채팅에서 말하지 않고 검색해서 바로 후보로 담는다(후보 탭의 검색 칸을 펼쳐 연다) */
  const openSearchAdd = () => {
    setCurrentTrip(trip.id);
    navigation.navigate('Main', { screen: 'Candidates', params: { add: true } });
  };
  /** 요약 만들기. 늦게 끝난 앞 요청은 버린다 */
  const runSummary = async () => {
    const t = (sumTicket.current += 1);
    setSumStep('view');
    setSummary(undefined);
    setSumBusy(true);
    try {
      const s = await getServices().summary.summarize(buildSummaryRequest(trip));
      if (t === sumTicket.current) setSummary(s);
    } catch {
      if (t === sumTicket.current) setSummary({ ...localSummary(buildSummaryRequest(trip)), aiUnavailable: true });
    } finally {
      if (t === sumTicket.current) setSumBusy(false);
    }
  };
  /** AI에 대화가 가므로 앱을 켠 뒤 처음 한 번은 동의를 받는다(AI 서버가 없어 규칙 요약만 하면 묻지 않는다) */
  const startSummary = () => {
    setMenu(false);
    if (trip.messages.filter((m) => m.text.trim() !== '').length < SUMMARY_MIN_MESSAGES) {
      toast('요약할 대화가 아직 없어요');
      return;
    }
    if (getServices().summary.id === 'ai' && !summaryConsented) setSumStep('consent');
    else void runSummary();
  };
  const openTripSettings = () => {
    setMenu(false);
    navigation.navigate('TripSettings', { tripId });
  };
  const openCandidates = () => {
    setCurrentTrip(trip.id);
    navigation.navigate('Main', { screen: 'Candidates' });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentSize, contentOffset, layoutMeasurement } = e.nativeEvent;
    stick.current = nearEnd(contentSize.height, contentOffset.y, layoutMeasurement.height);
  };
  const onContentSize = () => {
    if (!stick.current && !justSent.current) return;
    justSent.current = false;
    scroll.current?.scrollToEnd({ animated: false });
  };

  const chatColumn = (
    <>
      <ScrollView
        ref={scroll}
        style={styles.fill}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={onContentSize}
      >
        {messages.length === 0 ? (
          <Empty
            title="아직 대화가 없어요"
            text={"가고 싶은 곳 이름을 적으면 후보로 담겨요. 예: '불국사 가자, 황리단길에서 점심'\n이름이 헷갈리면 아래 '장소 검색해서 담기'를 눌러 보세요"}
          />
        ) : null}
        {messages.map((m, i) => {
          const meta = metas[i];
          const mine = m.memberId === me;
          const card = extractionCard(trip, m);
          const name = senderName(trip.members, m.memberId);
          const showMeta = meta.groupEnd || m.status === 'pending';
          return (
            <View key={m.id} style={[styles.message, meta.groupStart ? styles.groupStart : null]}>
              {meta.dayLabel ? <DayDivider label={meta.dayLabel} /> : null}
              <View
                accessible
                accessibilityLabel={messageA11yLabel(m, mine ? '나' : name, meta.time)}
                style={[styles.line, mine ? styles.lineMine : null]}
              >
                {mine ? null : meta.groupEnd ? (
                  <Avatar name={name} index={memberIndex(trip.members, m.memberId)} />
                ) : (
                  <View style={styles.avatarGap} />
                )}
                <Col gap={SP.xs} style={[styles.bubbleCol, mine ? styles.bubbleColMine : null]}>
                  {mine || !meta.groupStart ? null : <Txt v="mtTight">{name}</Txt>}
                  <Bubble text={m.text} highlights={m.extraction?.highlights ?? []} mine={mine} />
                  {showMeta ? (
                    <Row gap={SP.s}>
                      {m.status === 'pending' ? <Chip text="전송 대기" tone="line" icon="clock" /> : null}
                      {meta.groupEnd ? <Txt v="mtTight">{meta.time}</Txt> : null}
                    </Row>
                  ) : null}
                </Col>
              </View>
              {card ? (
                <ExtractionCardView
                  card={card}
                  onUndo={() => askUndo(m.id)}
                  onOpen={(spotId) => navigation.navigate('SpotDetail', { tripId, spotId })}
                  onPick={(phrase) => setPick({ messageId: m.id, phrase })}
                  optionsFor={(phrase) => optionsOf(m.id, phrase)}
                  onChoose={(phrase, o) => resolvePick(tripId, m.id, phrase, { place: o.place, existingSpotId: o.existingSpotId })}
                  onNone={(phrase) => resolvePick(tripId, m.id, phrase, null)}
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: SP.l + bottom }]}>
        <CandidateBar trip={trip} plan={plan} onPress={openCandidates} />
        {me ? (
          <Row gap={SP.s} wrap>
            <Btn title="장소 검색해서 담기" icon="search" size="sm" variant="quiet" onPress={openSearchAdd} />
            <Btn title="AI 요약" icon="book" size="sm" variant="quiet" onPress={startSummary} />
          </Row>
        ) : null}
        {me ? (
          <Row gap={SP.m} style={styles.inputRow}>
            <View style={styles.fill}>
              <Field
                label="메시지"
                hideLabel
                size="sm"
                value={text}
                onChangeText={setText}
                placeholder={group ? '가고 싶은 곳을 말해 보세요' : '메모처럼 가고 싶은 곳을 적어 보세요'}
                returnKeyType="send"
                keepFocusOnSubmit
                onSubmitEditing={send}
              />
            </View>
            <SendButton onPress={send} disabled={text.trim() === ''} />
          </Row>
        ) : (
          <Card variant="tinted">
            <Txt v="mt" c="ink">
              이 여행방의 멤버가 아니라 보낼 수 없어요.
            </Txt>
          </Card>
        )}
      </View>
    </>
  );

  const mapPane = (visible: boolean) => (
    <ChatMapView
      trip={trip}
      areas={areas}
      areaBySpot={areaBySpot}
      state={sel}
      send={act}
      online={online}
      visible={visible}
      wide={wide}
      solo={!group}
    />
  );

  let body: React.ReactNode;
  if (wide) {
    body = (
      <View style={styles.split}>
        <View style={styles.chatCol}>{chatColumn}</View>
        <View style={styles.fill}>
          {group ? <AreaChips areas={areas} selected={selArea} onPick={pickArea} /> : null}
          {mapPane(true)}
        </View>
      </View>
    );
  } else {
    body = (
      <>
        {group ? <AreaChips areas={areas} selected={selArea} onPick={pickArea} /> : null}
        <View style={styles.fill}>
          <View
            style={[styles.layer, mapOn ? styles.offstage : null]}
            aria-hidden={mapOn}
            importantForAccessibility={mapOn ? 'no-hide-descendants' : 'auto'}
            {...(IS_WEB && mapOn ? INERT : null)}
          >
            {chatColumn}
          </View>
          {mapMounted ? <View style={[styles.layer, mapOn ? null : styles.gone]}>{mapPane(mapOn)}</View> : null}
        </View>
      </>
    );
  }

  return (
    <Screen keyboard>
      <Header
        size="row"
        back={back}
        title={trip.title}
        sub={group ? `멤버 ${active.length}명 · 보내는 사람 ${meMember?.nickname ?? '없음'}` : '혼자 여행 · 채팅 메모'}
        right={
          <>
            {!wide ? (
              <Seg<ChatView>
                compact
                items={[
                  { key: 'chat', label: '채팅' },
                  { key: 'map', label: '지도' },
                ]}
                value={view}
                onChange={switchView}
              />
            ) : null}
            <IconBtn icon="gear" label="채팅 설정" onPress={() => setMenu(true)} />
          </>
        }
      />
      {body}

      <Sheet visible={menu} onClose={() => setMenu(false)} title="채팅 설정">
        {/* 여행방 설정 값(지역·날짜·이동수단·활동시간)을 여기서 바로 보고, 누르면 여행방 설정에서 고친다(방장만 바꿀 수 있고 그룹원에게는 값만 보인다) */}
        <View>
          <ListRow first icon="pin" label="지역" value={region?.name ?? '-'} onPress={openTripSettings} />
          <ListRow icon="cal" label="날짜" value={`${periodLabel(trip.startDate, trip.endDate)} · ${nightsLabel(trip.startDate, trip.endDate)}`} onPress={openTripSettings} />
          <ListRow icon={trip.transport === 'car' ? 'car' : trip.transport === 'walk' ? 'walk' : 'bus'} label="이동수단" value={TRANSPORT_LABEL[trip.transport]} onPress={openTripSettings} />
          <ListRow icon="clock" label="하루 활동시간" value={`${trip.dayStart} – ${trip.dayEnd}`} onPress={openTripSettings} />
          <ListRow icon="book" label="AI 대화 요약" sub="지금까지 이야기를 정리해 줘요" onPress={startSummary} />
          <ListRow
            icon="users"
            label={`멤버 ${active.length}명 보기`}
            sub={me && isHost(trip, me) ? '방장은 여기서 내보낼 수 있어요' : undefined}
            onPress={() => {
              setMenu(false);
              setMembersOpen(true);
            }}
          />
          <ListRow
            icon="users"
            label="멤버·초대"
            onPress={() => {
              setMenu(false);
              navigation.navigate('Members', { tripId });
            }}
          />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={sumStep === 'consent'}
        title="대화를 AI로 요약할까요"
        text="이 여행방의 최근 대화(80줄까지)와 후보 이름이 AI 서비스(Gemini)로 전송돼요. 요약에만 쓰고 서버에 저장하지 않아요."
        confirmLabel="요약하기"
        onConfirm={() => {
          summaryConsented = true;
          void runSummary();
        }}
        onCancel={() => setSumStep('closed')}
      />
      <Sheet visible={sumStep === 'view'} onClose={() => { sumTicket.current += 1; setSumStep('closed'); }} title="AI 대화 요약" scroll>
        {sumBusy || !summary ? (
          <Notice icon="clock" title="대화를 정리하는 중이에요" text="잠시만 기다려 주세요" />
        ) : (
          <Col gap={SP.l}>
            {summary.aiUnavailable ? <Notice tone="warn" icon="alert" text="AI를 지금 쓸 수 없어서 간단히 정리했어요. 잠시 뒤 다시 요약해 보세요" /> : null}
            <Txt v="body">{summary.overview}</Txt>
            {summary.decided.length > 0 ? (
              <Col gap={SP.s}>
                <Txt v="eyebrow">정해진 것</Txt>
                {summary.decided.map((d, i) => (
                  <Txt key={`d${i}`} v="mt" c="ink">{`· ${d}`}</Txt>
                ))}
              </Col>
            ) : null}
            {summary.open.length > 0 ? (
              <Col gap={SP.s}>
                <Txt v="eyebrow">더 정해야 할 것</Txt>
                {summary.open.map((d, i) => (
                  <Txt key={`o${i}`} v="mt" c="ink">{`· ${d}`}</Txt>
                ))}
              </Col>
            ) : null}
            <Txt v="mtTight">{summary.source === 'ai' ? 'AI가 대화를 읽고 정리했어요. 틀릴 수 있으니 중요한 건 확인해 주세요' : '대화 줄 수와 후보로 만든 간단한 정리예요'}</Txt>
            <Btn title="다시 요약하기" variant="quiet" icon="refresh" onPress={() => void runSummary()} disabled={sumBusy} />
          </Col>
        )}
      </Sheet>

      {/* 멤버 시트: 방장은 방장 아닌 멤버를 내보낼 수 있다(member/remove, 확인 1회). 규칙은 core/ops/members.validate */}
      <Sheet visible={membersOpen} onClose={() => setMembersOpen(false)} title={`멤버 ${active.length}명`}>
        <Col gap={SP.m}>
          {active.map((m) => (
            <Row key={m.id} gap={SP.l}>
              <Avatar name={m.nickname} index={memberIndex(trip.members, m.id)} />
              <Col grow gap={SP.xs}>
                <Txt v="nm">{m.nickname}</Txt>
                <Row gap={SP.s}>
                  {m.role === 'host' ? <Chip text="방장" tone="soft" /> : null}
                  {m.id === me ? <Chip text="나" tone="line" /> : null}
                </Row>
              </Col>
              {me && isHost(trip, me) && m.role !== 'host' ? (
                <Btn title="내보내기" size="sm" variant="quiet" onPress={() => setRemoving({ id: m.id, nickname: m.nickname })} />
              ) : null}
            </Row>
          ))}
          {me && isHost(trip, me) ? <Txt v="mtTight">방장만 멤버를 내보낼 수 있어요. 내보내도 제안한 후보와 채팅은 남아요.</Txt> : null}
        </Col>
      </Sheet>
      <ConfirmSheet
        visible={removing != null}
        title={`${removing?.nickname ?? ''}님을 내보낼까요`}
        text="이 멤버는 더 이상 여행방을 보거나 편집할 수 없어요. 제안한 후보와 채팅은 남아요."
        confirmLabel="내보내기"
        onConfirm={() => {
          if (removing) useTrips.getState().dispatch(tripId, { type: 'member/remove', memberId: removing.id });
          setRemoving(undefined);
        }}
        onCancel={() => setRemoving(undefined)}
      />
      <ConfirmSheet
        visible={!!undoAsk}
        title="손본 후보도 지워져요"
        text={
          undoAsk
            ? `${josa(undoAsk.names.join(', '), '은/는')} 이 메시지로만 담긴 후보인데 고정·날짜·체류 같은 편집 기록이 있어요. 되돌리면 편집 내용과 함께 후보에서 지워져요.`
            : ''
        }
        confirmLabel="되돌리기"
        onConfirm={() => {
          if (undoAsk) undoExtraction(tripId, undoAsk.messageId);
          setUndoAsk(undefined);
        }}
        onCancel={() => setUndoAsk(undefined)}
      />

      <PlacePickSheet
        visible={!!pick && options.length > 0}
        title={`${josa(pick?.phrase ?? '', '은/는')} 어느 곳인가요?`}
        options={options}
        onPick={(o) => {
          if (pick) resolvePick(tripId, pick.messageId, pick.phrase, { place: o.place, existingSpotId: o.existingSpotId });
          setPick(undefined);
        }}
        onDismiss={() => {
          if (pick) resolvePick(tripId, pick.messageId, pick.phrase, null);
          setPick(undefined);
        }}
        onClose={() => setPick(undefined)}
        dismissLabel="해당 없음"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  messages: {
    paddingHorizontal: SP.gutter,
    paddingBottom: SP.l,
    gap: SP.s,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  message: {
    gap: SP.m,
  },
  groupStart: {
    marginTop: SP.s,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP.m,
    justifyContent: 'flex-start',
  },
  lineMine: {
    justifyContent: 'flex-end',
  },
  avatarGap: {
    width: H.avatar,
  },
  bubbleCol: {
    flexShrink: 1,
    maxWidth: '70%',
    alignItems: 'flex-start',
  },
  bubbleColMine: {
    alignItems: 'flex-end',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
    paddingVertical: SP.s,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: lineC.line,
  },
  composer: {
    paddingHorizontal: SP.gutter,
    paddingTop: SP.m,
    gap: SP.m,
  },
  inputRow: {
    alignItems: 'flex-end',
  },
  split: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
  },
  chatCol: {
    width: CHAT_COL_W,
    borderRightWidth: 1,
    borderRightColor: lineC.line,
  },
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  offstage: {
    opacity: 0,
    pointerEvents: 'none',
  },
  gone: {
    display: 'none',
  },
});
