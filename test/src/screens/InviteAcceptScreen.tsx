import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import type { Trip } from '../types';
import { NICKNAME_MAX } from '../core/constants';
import { activeMembers, REMOVED_TEXT, REMOVED_TITLE, wasRemoved } from '../core/group';
import { periodLabel, effectiveBase } from '../core/trip/create';
import { normalizeInviteCode } from '../core/trip/invite';
import { cleanNickname, JOIN_ERROR_TEXT } from '../core/trip/join';
import { GUEST_LIMIT_HELP } from '../features/account/messages';
import type { RootScreenProps } from '../navigation/routes';
import { getServices } from '../services/registry';
import { canUseDemoTools } from '../config';
import { useSession } from '../store/session';
import { useTrips, type InvitePreview } from '../store/trips';
import { useUi } from '../store/ui';
import {
  AvatarStack,
  Body,
  Btn,
  Card,
  Chip,
  CodeCells,
  Col,
  Field,
  Foot,
  Header,
  Icon,
  lineC,
  Notice,
  R,
  RegionArt,
  Row,
  Screen,
  SP,
  TextLink,
  Txt,
} from '../ui';

/**
 * 02 초대 수락 · 게스트 합류(FR-105·302, WP2 소유. 02의 시각 기준도 WP2다).
 * 세션 유무와 상관없이 열린다. 딥링크 youngtrip://j/코드, https://youngtrip.app/j/코드가 여기로 온다.
 * - 코드 없이 열면 코드 입력 칸을 보여준다(정적 웹 export의 /j/ 폴백 대신).
 * - 세션이 없으면 이 방에서 쓸 닉네임(12자)을 받아 게스트로 합류한다. 게스트 한계는 이름 칸 help로 합류 버튼 앞에 보여준다.
 *   온보딩에서 적은 닉네임(route.params.nickname)으로 이름 칸을 미리 채우고, 그 값은 경로에서 바로 지운다(웹 주소에 남지 않게).
 * - 코드 칸과 이름 칸은 Enter로 바로 확인·합류한다. 제목은 '{방장}님이 여행방에 초대했어요'로 고정한다(입력에 따라 줄이 바뀌지 않게).
 * - 이미 참여한 사람은 중복 멤버 없이 방으로 들어간다.
 * - 같은 기기 '다른 사람으로 합류(시연)': 새 userId로 합류하고 그 방에서 그 멤버로 행동한다(actingAs).
 *   시연 전용이라 Foot(합류, 초대 거절)이 아니라 이름 칸 아래 글자 링크로 둔다. 켜면 line 칩으로 시연 중임을 보인다.
 * - 만료·무효·정원·없음·종료·오프라인은 앰버 안내(JOIN_ERROR_TEXT)와 다른 코드 입력으로 돌려보낸다.
 * - 게스트 세션은 합류 직전에 초대를 다시 확인한 뒤 만들고, 합류가 실패하면 되돌린다(방 없이 게스트만 남지 않게).
 */
export default function InviteAcceptScreen({ navigation, route }: RootScreenProps<'InviteAccept'>) {
  const session = useSession((s) => s.session);
  const profileName = useSession((s) => s.profile.nickname);
  // '다른 사람으로 합류(시연)'은 관리자 계정에만 보인다
  const demoAllowed = canUseDemoTools(session);
  const previewInvite = useTrips((s) => s.previewInvite);
  const acceptInvite = useTrips((s) => s.acceptInvite);
  const online = useTrips((s) => s.online);

  const [code, setCode] = useState<string | undefined>(route.params?.code);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<InvitePreview | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [demoOther, setDemoOther] = useState(false);
  const [nickname, setNickname] = useState(session?.nickname ?? (route.params?.nickname || profileName || ''));
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (c: string) => {
      setLoading(true);
      setJoinError(undefined);
      const r = await previewInvite(c, useSession.getState().session?.userId);
      setPreview(r);
      setLoading(false);
    },
    [previewInvite],
  );

  // 온보딩이 넘긴 닉네임은 이름 칸에 한 번 담고 경로에서 지운다. 웹에서는 경로 값이 주소(?nickname=)로 남아,
  // 그 주소를 초대 링크로 퍼뜨리면 받은 사람 이름 칸이 내 닉네임으로 차고 방문 기록에도 남는다.
  // 같은 화면이 열린 채로 다른 초대 링크가 들어오면 새 코드로 다시 확인한다
  const paramCode = route.params?.code;
  useEffect(() => {
    if (paramCode) setCode(paramCode);
  }, [paramCode]);
  const passedNick = route.params?.nickname;
  useEffect(() => {
    if (passedNick) navigation.setParams({ nickname: undefined });
  }, [navigation, passedNick]);

  useEffect(() => {
    if (code) void load(code);
  }, [code, load]);

  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else if (session) navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    else navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

  const goTrip = (tripId: string) => {
    useUi.getState().setCurrentTrip(tripId);
    // 세션이 막 생겼으면 루트 스택이 Main을 등록할 때까지 한 번 양보한다.
    setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Main', params: { screen: 'Home' } }] }), 0);
  };

  const submitCode = () => {
    const c = normalizeInviteCode(codeInput);
    if (!c) {
      setCodeError('초대 코드는 8자(XXXX-XXXX)예요. 링크를 그대로 붙여 넣어도 돼요.');
      return;
    }
    setCodeError(undefined);
    setPreview(undefined);
    setCode(c);
    navigation.setParams({ code: c });
  };

  const join = async () => {
    if (!preview?.ok) return;
    const name = cleanNickname(nickname);
    if (!name) {
      setJoinError('이 여행방에서 쓸 이름을 적어 주세요.');
      return;
    }
    setJoining(true);
    setJoinError(undefined);
    let userId: string;
    let isGuest: boolean;
    let madeGuest = false;
    if (demoOther) {
      // 시연 합류는 세션을 바꾸지 않고 새 userId만 쓴다.
      userId = getServices().ids.next('u');
      isGuest = true;
    } else if (!session) {
      // 미리보기와 합류 사이에 만료·정원·재발급·종료가 끼었으면 게스트 세션을 만들지 않는다.
      const again = await previewInvite(preview.code);
      if (!again.ok) {
        setJoining(false);
        setPreview(again);
        return;
      }
      userId = useSession.getState().createGuest(name).userId;
      isGuest = true;
      madeGuest = true;
    } else {
      userId = session.userId;
      isGuest = session.kind === 'guest';
    }
    const r = await acceptInvite(preview.code, { userId, nickname: name, isGuest });
    setJoining(false);
    if (!r.ok) {
      // 방금 만든 게스트 세션은 되돌린다(세션이 없던 상태로). 루트 스택도 온보딩으로 돌아간다.
      if (madeGuest) useSession.getState().signOut();
      setJoinError(JOIN_ERROR_TEXT[r.reason]);
      return;
    }
    if (demoOther) useUi.getState().setActingAs(r.tripId, r.memberId);
    useUi.getState().showToast(r.already ? '이미 참여 중인 여행방이에요' : `${name}님으로 합류했어요`);
    goTrip(r.tripId);
  };

  /** 이미 참여 중인 방. 이 기기에 없던 방이면 로그를 받고 구독을 붙이는 합류 경로(already)를 거쳐 들어간다. */
  const enter = async () => {
    if (!preview?.ok) return;
    if (preview.local || !session) {
      goTrip(preview.trip.id);
      return;
    }
    setJoining(true);
    const r = await acceptInvite(preview.code, {
      userId: session.userId,
      nickname: cleanNickname(nickname) || session.nickname,
      isGuest: session.kind === 'guest',
    });
    setJoining(false);
    if (!r.ok) {
      setJoinError(JOIN_ERROR_TEXT[r.reason]);
      return;
    }
    goTrip(r.tripId);
  };

  /* ---------- 코드 입력 ---------- */
  if (!code) {
    return (
      <Screen keyboard>
        <Header back={leave} eyebrow="초대 코드로 합류" title="받은 초대 코드를 적어 주세요" />
        <Body scroll>
          {/* 피그마 최종안 06: 글자마다 칸. 링크를 붙여 넣어도 코드만 칸에 보인다 */}
          <CodeCells label="초대 코드" value={codeInput} onChangeText={setCodeInput} error={codeError} onSubmitEditing={submitCode} />
          <Txt v="mtTight">친구가 보낸 8자리 코드나 초대 링크를 붙여 넣어도 돼요.</Txt>
          {!online ? <Notice tone="warn" icon="alert" text="오프라인이에요. 이 기기에 없는 여행방은 연결된 뒤에 확인할 수 있어요." /> : null}
        </Body>
        <Foot>
          <Btn title="초대 확인" disabled={!codeInput.trim()} onPress={submitCode} />
        </Foot>
      </Screen>
    );
  }

  /* ---------- 확인 중 / 실패 ---------- */
  if (loading || !preview) {
    return (
      <Screen>
        <Header back={leave} eyebrow="초대 링크로 들어옴" title="초대를 확인하고 있어요" />
        <Body>
          <Notice icon="link" text={`초대 코드 ${code}`} />
        </Body>
      </Screen>
    );
  }

  if (!preview.ok) {
    const text = JOIN_ERROR_TEXT[preview.reason];
    return (
      <Screen>
        <Header back={leave} eyebrow="초대 링크로 들어옴" title="이 초대로는 합류할 수 없어요" />
        <Body scroll>
          <Notice tone="warn" icon="alert" title={`초대 코드 ${preview.code}`} text={text} />
        </Body>
        <Foot>
          {preview.reason === 'offline' ? <Btn title="다시 확인" onPress={() => void load(preview.code)} /> : null}
          <Btn
            title="다른 코드 입력"
            variant={preview.reason === 'offline' ? 'quiet' : 'primary'}
            onPress={() => {
              setCode(undefined);
              setPreview(undefined);
              setCodeInput('');
              navigation.setParams({ code: undefined });
            }}
          />
        </Foot>
      </Screen>
    );
  }

  /* ---------- 미리보기와 합류 ---------- */
  const trip = preview.trip;
  const host = trip.members.find((m) => m.role === 'host');
  const already = preview.already && !demoOther;
  // 방장이 내보낸 사람은 이 링크로 다시 합류할 수 없다(코어 member/join이 막는다). 눌러 보기 전에 알린다
  const removed = !already && !demoOther && wasRemoved(trip, session?.userId);
  const guest = demoOther || !session || session.kind === 'guest';
  const who = cleanNickname(nickname);
  const toggleDemo = () => {
    if (!session) return;
    setDemoOther(!demoOther);
    setNickname(demoOther ? session.nickname : '');
    setJoinError(undefined);
  };

  return (
    <Screen keyboard>
      <Header
        back={leave}
        eyebrow="초대 링크로 들어옴"
        title={already ? '이미 참여 중인 여행방이에요' : `${host?.nickname ?? '방장'}님이 여행방에 초대했어요`}
      />
      <Body scroll>
        <TripSummary trip={trip} />
        {already ? (
          joinError ? <Notice tone="warn" icon="alert" text={joinError} /> : null
        ) : (
          <Field
            label="이 여행방에서 쓸 이름"
            kind="nickname"
            value={nickname}
            onChangeText={setNickname}
            maxLength={NICKNAME_MAX}
            help={!session ? GUEST_LIMIT_HELP : undefined}
            error={joinError}
            onSubmitEditing={() => {
              if (!joining && who) void join();
            }}
          />
        )}
        {session && demoAllowed ? (
          // 시연 전용(같은 기기 다른 멤버). 합류·거절과 같은 무게로 두지 않고 이름 칸 아래 글자 링크로 둔다.
          <Row gap={SP.m} wrap>
            <TextLink title={demoOther ? '나로 합류하기' : '다른 사람으로 합류(시연)'} onPress={toggleDemo} />
            {demoOther ? <Chip text="시연 · 새 멤버로 합류" tone="line" /> : null}
          </Row>
        ) : null}
        {removed ? <Notice tone="warn" icon="alert" title={REMOVED_TITLE} text={REMOVED_TEXT} /> : null}
        {!online ? <Notice tone="warn" icon="alert" text="오프라인이에요. 합류는 이 기기에 먼저 반영되고 연결되면 보내요." /> : null}
      </Body>
      <Foot>
        {already ? (
          <Btn title={joining ? '들어가는 중' : '여행방으로 가기'} disabled={joining} onPress={() => void enter()} />
        ) : (
          <Btn title={joining ? '합류하는 중' : guest ? '게스트로 합류하기' : '합류하기'} disabled={joining || !who || removed} onPress={join} />
        )}
        <Btn title="초대 거절" variant="quiet" size="sm" onPress={leave} />
      </Foot>
    </Screen>
  );
}

const TRANSPORT_LABEL = { car: '자동차', walk: '도보', transit: '대중교통' } as const;

/** 목업 02 카드: 이름, 기간·수단, 멤버 아바타, 기점 */
function TripSummary({ trip }: { trip: Trip }) {
  const base = effectiveBase(trip.days, trip.startDate);
  const names = activeMembers(trip).map((m) => m.nickname);
  return (
    <Card>
      <Row top>
        <View style={{ width: 56, height: 56, borderRadius: R.field, overflow: 'hidden' }}>
          <RegionArt regionId={trip.region} />
        </View>
        <Col gap={4} grow>
          <Txt v="nmLg">{trip.title}</Txt>
          <Txt v="mt">{`${periodLabel(trip.startDate, trip.endDate)} · ${TRANSPORT_LABEL[trip.transport]}`}</Txt>
        </Col>
        <AvatarStack names={names} />
      </Row>
      <View style={{ height: 1, backgroundColor: lineC.line, marginVertical: SP.xs }} />
      <Row gap={8}>
        <Icon name="pin" size={16} />
        <Txt v="mt">{base ? `기점 · ${base.name}` : '기점 없음 · 그날 첫 스팟 기준'}</Txt>
      </Row>
    </Card>
  );
}
