import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { activeMembers, canIssueInvite, isHost } from '../core/group';
import { dateLongShort } from '../core/trip/format';
import { INVITE_BASE_URL } from '../config';
import { inviteStatus, inviteUrlShort, seatsLeft, INVITE_ERROR_TEXT } from '../core/trip/invite';
import { memberRows, type MemberRow } from '../core/trip/members';
import { copyInvite, copyInviteCode, issueAndShare, issueInvite } from '../features/trip/actions';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useNow } from '../services/clock';
import { getUserId } from '../store/session';
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
  Foot,
  Header,
  Icon,
  IconBtn,
  lineC,
  ListRow,
  Notice,
  NotFound,
  R,
  Row,
  Screen,
  Sheet,
  SP,
  surfaceC,
  Txt,
} from '../ui';

/**
 * 14 멤버 초대 · 링크 공유(FR-301·303, WP2 소유).
 * - 주 행동은 Foot의 버튼 하나다. 쓸 수 있는 링크가 없거나 무효면 '링크 만들고 공유하기', 있으면 '링크 공유하기'(둘 다 issueAndShare).
 *   만들기에서 왔으면(fromCreate) quiet '나중에 초대하기'로 그 방을 현재 여행방으로 두고 후보 화면으로 간다.
 * - 초대 링크 카드: youngtrip.app/j/코드, 복사(expo-clipboard), 그 아래 초대 코드(링크를 못 여는 사람에게 말로 알려 주는 용, 복사 따로), 만료일·남은 자리, '새 링크 만들기'(재발급하면 이전 링크는 무효, 확인 1회).
 *   발급·재발급은 방장 또는 초대 권한이 있는 멤버만. 초대 권한이 없는 그룹원에게는 링크·복사·공유·시연 합류를 보이지 않는다
 *   (권한표 '멤버 초대' 그룹원 X). 링크를 건네는 것도 초대다.
 * - 멤버 행: 보조 줄 뒤에 ' · 후보 N곳'(0곳도 표시, 제안자 규칙, core의 sub 문자열은 그대로), 칩은 '전송 대기'만.
 *   나간 멤버는 뒤에 '나간 멤버'로 남는다.
 * - 방장은 행 오른쪽 메뉴 시트에서 '초대 권한' 스위치와 '{이름}님 내보내기'(확인 1회). 로즈를 위험 신호로 쓰지 않는다.
 * - 시연 합류(같은 기기에서 다른 사람으로 합류)는 맨 아래 '시연' 구역에 둔다. 머리말 오른쪽 톱니는 여행방 설정이다.
 */
export default function MembersScreen({ navigation, route }: RootScreenProps<'Members'>) {
  const { tripId, fromCreate } = route.params;
  const trip = useTripDoc(tripId);
  const pending = useTrips((s) => s.pending);
  const dispatch = useTrips((s) => s.dispatch);
  const now = useNow(60_000);
  useUi((s) => s.actingAs[tripId]);

  const [menuFor, setMenuFor] = useState<MemberRow | undefined>(undefined);
  const [confirm, setConfirm] = useState<'reissue' | 'remove' | undefined>(undefined);

  const me = trip ? myMemberId(trip) : undefined;
  const rows = useMemo(() => (trip ? memberRows(trip, { meId: me, pending }) : []), [trip, me, pending]);

  const back = useBack('Home');

  if (!trip || trip.deletedAt != null || !me) {
    return (
      <Screen>
        <Header back={back} title="멤버 초대" size="sm" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const host = isHost(trip, me);
  const mayInvite = canIssueInvite(trip, me);
  const inv = trip.invite;
  const status = inv ? inviteStatus(trip, inv.code, now) : 'notFound';
  const usable = status === 'ok' || status === 'full';
  const active = activeMembers(trip).length;
  // 같은 기기 시연으로 다른 멤버가 되어 있으면 원래 나로 돌아갈 수 있게 한다.
  const own = activeMembers(trip).find((m) => m.userId === getUserId());
  const actingOther = own != null && own.id !== me;
  const actingName = trip.members.find((m) => m.id === me)?.nickname;
  // 나중에 초대하기: 이 방을 현재 여행방으로 두고 후보 화면부터 시작한다(만들기 → 멤버 초대 스택은 남기지 않는다).
  const later = () => {
    useUi.getState().setCurrentTrip(trip.id);
    navigation.reset({ index: 0, routes: [{ name: 'Main', params: { screen: 'Candidates' } }] });
  };

  return (
    <Screen>
      <Header
        back={back}
        step={fromCreate ? '2 / 2 단계' : undefined}
        title="멤버 초대"
        size="sm"
        right={<IconBtn icon="gear" label="여행방 설정" onPress={() => navigation.navigate('TripSettings', { tripId: trip.id }, { pop: true })} />}
      />
      <Body scroll>
        {actingOther && own ? (
          <Card variant="tinted">
            <Txt v="mtTight" c="accentStrong">{`이 기기에서 ${actingName ?? '다른 멤버'}님으로 행동하는 중이에요(시연).`}</Txt>
            <Btn
              title={`${own.nickname}(나)로 돌아가기`}
              variant="ghost"
              size="sm"
              onPress={() => useUi.getState().setActingAs(trip.id, own.id)}
            />
          </Card>
        ) : null}

        <Card>
          <Col gap={9}>
            <Txt v="eyebrow">초대 링크</Txt>
            {!mayInvite ? (
              inv && usable ? (
                <Txt v="mtTight">{`남은 자리 ${seatsLeft(trip)} · 방장 포함 6명까지`}</Txt>
              ) : null
            ) : inv && usable ? (
              <>
                <Row
                  gap={8}
                  style={{
                    paddingVertical: 11,
                    paddingHorizontal: SP.xl,
                    backgroundColor: surfaceC.bg,
                    borderWidth: 1,
                    borderColor: lineC.line,
                    borderRadius: R.iconBtn,
                  }}
                >
                  <Icon name="link" size={16} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt v="body" numberOfLines={1}>
                      {inviteUrlShort(inv.code, INVITE_BASE_URL)}
                    </Txt>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="초대 링크 복사"
                    hitSlop={HIT}
                    onPress={() => void copyInvite(trip)}
                  >
                    <Txt v="btnSm" c="accent">
                      복사
                    </Txt>
                  </Pressable>
                </Row>
                {/* 링크를 못 여는 사람에게는 코드를 말로 알려 준다. 받는 쪽은 '초대 코드로 합류'에 입력한다 */}
                {/* 피그마 최종안 15: 연회색 상자 안 큰 초대 코드와 복사 버튼 */}
                <Row
                  gap={SP.l}
                  style={{ paddingVertical: SP.xxl, paddingHorizontal: SP.xxl, borderRadius: R.sheet, backgroundColor: surfaceC.soft }}
                >
                  <Col grow gap={2}>
                    <Txt v="label">초대 코드</Txt>
                    <Txt v="hero">{inv.code}</Txt>
                  </Col>
                  <Btn title="복사" size="sm" variant="ghost" a11yLabel="초대 코드 복사" onPress={() => void copyInviteCode(trip)} />
                </Row>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Txt v="mtTight">{`${dateLongShort(inv.expiresAt)} 만료 · 남은 자리 ${seatsLeft(trip)}`}</Txt>
                  </View>
                  <Btn title="새 링크 만들기" variant="quiet" size="sm" onPress={() => setConfirm('reissue')} />
                </Row>
                {status === 'full' ? <Notice tone="warn" icon="alert" text={INVITE_ERROR_TEXT.full} /> : null}
              </>
            ) : (
              <Txt v="mt">
                {!inv
                  ? '아직 초대 링크가 없어요. 아래 버튼으로 만들고 바로 공유해요.'
                  : status === 'expired'
                    ? '초대 링크가 만료됐어요(7일). 새 링크를 만들어 공유해 주세요.'
                    : '이 링크는 더 이상 쓸 수 없어요. 새 링크를 만들어 공유해 주세요.'}
              </Txt>
            )}
          </Col>
        </Card>

        <Txt v="eyebrow">{`멤버 ${active}명`}</Txt>
        <Col gap={SP.m}>
          {rows.map((r, i) => (
            <MemberLine key={r.id} row={r} index={i} canManage={host && !r.isMe && !r.left && r.role !== 'host'} onMenu={() => setMenuFor(r)} />
          ))}
        </Col>

        {mayInvite && inv && status === 'ok' ? (
          <Col gap={SP.s}>
            <Txt v="eyebrow">시연</Txt>
            <Btn
              title="이 기기에서 다른 사람으로 합류해 보기"
              variant="quiet"
              size="sm"
              icon="users"
              onPress={() => navigation.navigate('InviteAccept', { code: inv.code })}
            />
          </Col>
        ) : null}
      </Body>
      {mayInvite || fromCreate ? (
        <Foot>
          {mayInvite ? (
            <Btn title={usable ? '링크 공유하기' : '링크 만들고 공유하기'} icon="share" onPress={() => void issueAndShare(trip.id)} />
          ) : null}
          {fromCreate ? <Btn title="나중에 초대하기" variant="quiet" onPress={later} /> : null}
        </Foot>
      ) : null}

      <Sheet visible={menuFor != null && confirm == null} onClose={() => setMenuFor(undefined)} title={menuFor?.nickname}>
        {menuFor ? (
          <Col>
            <ListRow
              first
              icon="link"
              label="초대 권한"
              sub="이 멤버도 초대 링크를 만들고 공유할 수 있어요"
              switch={{
                value: menuFor.canInvite,
                onChange: (next) => {
                  const r = dispatch(trip.id, { type: 'member/setCanInvite', memberId: menuFor.id, canInvite: next });
                  if (r.ok) setMenuFor({ ...menuFor, canInvite: next });
                },
              }}
            />
            <ListRow icon="user" label={`${menuFor.nickname}님 내보내기`} onPress={() => setConfirm('remove')} />
          </Col>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={confirm === 'reissue'}
        title="새 초대 링크를 만들까요"
        text="지금 링크는 바로 쓸 수 없게 돼요. 이미 합류한 멤버는 그대로예요."
        confirmLabel="새 링크 만들기"
        onConfirm={() => {
          setConfirm(undefined);
          issueInvite(trip.id);
        }}
        onCancel={() => setConfirm(undefined)}
      />
      <ConfirmSheet
        visible={confirm === 'remove' && menuFor != null}
        title={`${menuFor?.nickname ?? ''}님을 내보낼까요`}
        text="이 멤버는 더 이상 여행방을 보거나 편집할 수 없어요. 제안한 후보와 채팅은 남아요."
        confirmLabel="내보내기"
        onConfirm={() => {
          if (menuFor) dispatch(trip.id, { type: 'member/remove', memberId: menuFor.id });
          setConfirm(undefined);
          setMenuFor(undefined);
        }}
        onCancel={() => setConfirm(undefined)}
      />
    </Screen>
  );
}

/** 글자만 있는 버튼의 터치 영역(상하 14, 44pt 가까이) */
const HIT = { top: 14, bottom: 14, left: 10, right: 10 };

function MemberLine({
  row,
  index,
  canManage,
  onMenu,
}: {
  row: MemberRow;
  index: number;
  canManage: boolean;
  onMenu: () => void;
}) {
  return (
    // 피그마 최종안 16: 큰 아바타, 이름 옆 '방장' 잉크 배지
    <Row gap={SP.xl}>
      <Avatar name={row.nickname} index={row.left ? 3 : index} size="lg" />
      <Col gap={4} grow>
        <Row gap={SP.s}>
          <Txt v="nm" c={row.left ? 'muted' : 'ink'} numberOfLines={1}>
            {row.nickname}
          </Txt>
          {row.role === 'host' ? <Chip text="방장" tone="ink" /> : null}
          {row.isMe && row.role !== 'host' ? <Chip text="나" tone="ok" /> : null}
        </Row>
        <Txt v="mtTight" numberOfLines={2}>
          {`${row.sub} · 후보 ${row.candidates}곳`}
        </Txt>
      </Col>
      {row.waiting ? <Chip text="전송 대기" tone="warn" /> : null}
      {canManage ? <IconBtn icon="dots" label={`${row.nickname} 메뉴`} onPress={onMenu} /> : null}
    </Row>
  );
}
