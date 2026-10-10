import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { orderedMessages } from '../core/chatOrder';
import { pickOptions } from '../core/extract/manual';
import { activeMembers, tripMode } from '../core/group';
import { PERSONAL_MODE_REASON } from '../core/ops/chat';
import { josa, kstHHMM } from '../core/util';
import { regionById } from '../data/regions';
import { SCENARIO_CHAT, SCENARIO_LATE_JOIN, SCENARIO_MEMBERS } from '../data/scenario';
import { PlacePickSheet } from '../features/candidates/components/PlacePickSheet';
import { Bubble } from '../features/chat/components/Bubble';
import { ExtractionCardView } from '../features/chat/components/ExtractionCardView';
import { SendButton } from '../features/chat/components/SendButton';
import { playScenarioChat } from '../features/chat/scenario';
import { resolvePick, sendChatMessage, undoExtraction } from '../features/chat/send';
import { extractionCard, memberIndex, senderName, undoLosesEdits } from '../features/chat/view';
import type { RootScreenProps } from '../navigation/routes';
import { myMemberId, useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Avatar,
  Body,
  Btn,
  Card,
  Chip,
  Col,
  ConfirmSheet,
  Empty,
  Field,
  IconBtn,
  Notice,
  Row,
  Screen,
  Sheet,
  SP,
  Txt,
} from '../ui';

/**
 * 05 그룹 채팅 · 장소 자동 추출(FR-304·401, WP3 소유).
 * - 말풍선 안 장소는 연핑크 면으로 강조한다(밑줄 없음). 추출 결과는 메시지마다 묶음 카드 하나, 같은 줄에 되돌리기.
 * - 메시지 순서는 공유 orderedMessages(서버 순번 순, 전송 대기는 보낸 시각 순으로 뒤). 전송 대기는 칩으로 표시한다.
 * - 인식 실패 시 후보도 안내도 없다(카드를 그리지 않는다).
 * - 보내는 사람 전환(같은 기기 시연)과 시나리오 대화 재생은 헤더 메뉴에 둔다.
 * - 개인 모드(활성 멤버 1명)면 입력을 막고 이유를 적는다.
 * - 헤더는 목업처럼 한 줄(뒤로 / 방 이름 + 보조 줄 / 메뉴)이라 대화 영역을 넓게 남긴다. 보내는 사람은 헤더 보조 줄에만 적는다.
 * - 메시지 줄은 아바타를 말풍선 아래 끝에 붙인다(목업 .msg align-items: flex-end). 시각은 전송 대기와 마지막 메시지에만 적는다.
 */

/** 목업 05 한 줄 헤더. 공용 Header는 아이콘 줄과 제목 줄을 세로로 쌓아서 여기서는 쓰지 않는다. */
function ChatHeader({ back, title, sub, onMenu }: { back?: () => void; title: string; sub: string; onMenu?: () => void }) {
  return (
    <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter, paddingBottom: SP.l }}>
      <Row gap={SP.l}>
        {back ? <IconBtn icon="back" label="뒤로" onPress={back} /> : null}
        <Col grow gap={2}>
          <Txt v="nm" numberOfLines={1}>
            {title}
          </Txt>
          <Txt v="mtTight" numberOfLines={1}>
            {sub}
          </Txt>
        </Col>
        {onMenu ? <IconBtn icon="dots" label="채팅 메뉴" onPress={onMenu} /> : null}
      </Row>
    </View>
  );
}
export default function ChatScreen({ navigation, route }: RootScreenProps<'Chat'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const online = useTrips((s) => s.online);
  const actingAs = useUi((s) => s.actingAs[tripId]);
  const setActingAs = useUi((s) => s.setActingAs);
  const toast = useUi((s) => s.showToast);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pick, setPick] = useState<{ messageId: string; phrase: string } | undefined>();
  const [undoAsk, setUndoAsk] = useState<{ messageId: string; names: string[] } | undefined>();
  const scroll = useRef<ScrollView>(null);

  const messages = useMemo(() => (trip ? orderedMessages(trip) : []), [trip]);
  const back = navigation.canGoBack() ? navigation.goBack : undefined;

  if (!trip) {
    return (
      <Screen>
        <ChatHeader back={back} title="그룹 채팅" sub="여행방 없음" />
        <Body>
          <Empty title="여행방을 찾을 수 없습니다" />
        </Body>
      </Screen>
    );
  }

  void actingAs; // actingAs가 바뀌면 다시 그려서 보내는 사람을 새로 계산한다
  const me = myMemberId(trip);
  const meMember = trip.members.find((m) => m.id === me);
  const group = tripMode(trip) === 'group';
  const active = activeMembers(trip);
  const region = regionById(trip.region);

  const send = async () => {
    const body = text.trim();
    if (!body || !me) return;
    setText('');
    const r = await sendChatMessage(tripId, body, { actorId: me });
    if (!r.ok) setText(body);
  };

  const play = async (fromLine: number, toLine: number) => {
    setMenu(false);
    if (playing) return;
    setPlaying(true);
    const sent = await playScenarioChat(tripId, { fromLine, toLine });
    setPlaying(false);
    const joined = new Set(activeMembers(useTrips.getState().docs[tripId] ?? trip).map((m) => m.nickname));
    const speakers = new Set(SCENARIO_CHAT.filter((l) => l.line >= fromLine && l.line <= toLine).map((l) => l.from));
    const skipped = SCENARIO_MEMBERS.filter((m) => speakers.has(m.key) && !joined.has(m.nickname)).map((m) => m.nickname);
    toast(
      skipped.length
        ? `시나리오 ${sent}줄을 보냈습니다. 합류하지 않은 ${skipped.join('·')}의 줄은 건너뛰었습니다`
        : `시나리오 ${sent}줄을 보냈습니다`,
    );
  };

  const askUndo = (messageId: string) => {
    const msg = trip.messages.find((x) => x.id === messageId);
    const names = msg ? undoLosesEdits(trip, msg) : [];
    if (names.length > 0) setUndoAsk({ messageId, names });
    else undoExtraction(tripId, messageId);
  };

  const pickMsg = pick ? trip.messages.find((m) => m.id === pick.messageId) : undefined;
  const pickEntry = pickMsg?.extraction?.ambiguous.find((a) => a.phrase === pick?.phrase);
  const options = pickEntry && region ? pickOptions(pickEntry.options, region, trip).filter((o) => !o.outside) : [];

  return (
    <Screen>
      <ChatHeader
        back={back}
        title={trip.title}
        sub={group ? `멤버 ${active.length}명 · 보내는 사람 ${meMember?.nickname ?? '없음'}` : '개인 모드 · 채팅 꺼짐'}
        onMenu={() => setMenu(true)}
      />
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: SP.gutter, paddingBottom: SP.l, gap: SP.l, flexGrow: 1, justifyContent: 'flex-end' }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 ? <Empty title="아직 대화가 없습니다" /> : null}
        {messages.map((m, i) => {
          const mine = m.memberId === me;
          const showTime = m.status === 'pending' || i === messages.length - 1;
          const card = extractionCard(trip, m);
          const name = senderName(trip.members, m.memberId);
          return (
            <View key={m.id} style={{ gap: SP.m }}>
              <Row gap={SP.m} style={{ alignItems: 'flex-end', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                {mine ? null : <Avatar name={name} index={memberIndex(trip.members, m.memberId)} />}
                <Col gap={SP.xs} style={{ flexShrink: 1, maxWidth: '70%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                  {mine ? null : <Txt v="mtTight">{name}</Txt>}
                  <Bubble text={m.text} highlights={m.extraction?.highlights ?? []} mine={mine} />
                  {showTime ? (
                    <Row gap={SP.s}>
                      {m.status === 'pending' ? <Chip text="전송 대기" tone="line" icon="clock" /> : null}
                      <Txt v="mtTight">{kstHHMM(m.sentAt)}</Txt>
                    </Row>
                  ) : null}
                </Col>
              </Row>
              {card ? (
                <ExtractionCardView
                  card={card}
                  onUndo={() => askUndo(m.id)}
                  onOpen={(spotId) => navigation.navigate('SpotDetail', { tripId, spotId })}
                  onPick={(phrase) => setPick({ messageId: m.id, phrase })}
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: SP.gutter, paddingTop: SP.l, paddingBottom: SP.section, gap: SP.m }}>
        {!online ? (
          <Notice icon="alert" text="오프라인입니다. 보낸 메시지는 전송 대기로 남고, 연결되면 순서대로 보냅니다." />
        ) : null}
        {group && me ? (
          <Row gap={SP.m} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label="메시지" hideLabel size="sm" value={text} onChangeText={setText} placeholder="메시지 입력" />
            </View>
            <SendButton onPress={send} disabled={text.trim() === ''} />
          </Row>
        ) : (
          <Card variant="tinted">
            <Txt v="mt" c="ink">
              {group ? '이 여행방의 멤버가 아니라 보낼 수 없습니다.' : PERSONAL_MODE_REASON}
            </Txt>
            {!group ? (
              <Btn title="멤버 초대하기" size="sm" variant="ghost" icon="users" onPress={() => navigation.navigate('Members', { tripId })} />
            ) : null}
          </Card>
        )}
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)} title="채팅 메뉴">
        {/* 여행방 설정(이름·지역·날짜·이동수단·날짜별 기점)은 여기서 연다. 방장만 바꿀 수 있고 그룹원에게는 값만 보인다 */}
        <Btn
          title="여행방 설정"
          variant="ghost"
          icon="gear"
          onPress={() => {
            setMenu(false);
            navigation.navigate('TripSettings', { tripId });
          }}
        />
        <Txt v="label">보내는 사람 바꾸기 · 같은 기기 시연</Txt>
        <Row wrap gap={SP.s}>
          {active.map((m) => (
            <Btn
              key={m.id}
              title={m.nickname}
              size="sm"
              variant={m.id === me ? 'primary' : 'quiet'}
              onPress={() => {
                setActingAs(tripId, m.id);
                setMenu(false);
              }}
            />
          ))}
        </Row>
        <Txt v="label">시연</Txt>
        <Btn
          title={playing ? '재생 중' : '시나리오 1~11줄 재생'}
          variant="ghost"
          icon="play"
          onPress={() => play(1, SCENARIO_LATE_JOIN.afterLine)}
          disabled={playing || !group}
        />
        <Btn
          title={`시나리오 ${SCENARIO_LATE_JOIN.afterLine + 1}~${SCENARIO_CHAT.length}줄 재생`}
          variant="quiet"
          icon="play"
          onPress={() => play(SCENARIO_LATE_JOIN.afterLine + 1, SCENARIO_CHAT.length)}
          disabled={playing || !group}
        />
        <Btn
          title="후보 보기"
          variant="quiet"
          icon="list"
          onPress={() => {
            setMenu(false);
            navigation.navigate('Main', { screen: 'Candidates' });
          }}
        />
      </Sheet>

      <ConfirmSheet
        visible={!!undoAsk}
        title="손본 후보도 지워집니다"
        text={
          undoAsk
            ? `${josa(undoAsk.names.join(', '), '은/는')} 이 메시지로만 담긴 후보인데 고정·날짜·체류 같은 편집 기록이 있습니다. 되돌리면 편집 내용과 함께 후보에서 지워집니다.`
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
