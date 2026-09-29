import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { activeMembers, canIssueInvite, isHost, tripMode } from '../core/group';
import { dateLongShort } from '../core/trip/format';
import { inviteStatus, inviteUrlShort, seatsLeft, INVITE_ERROR_TEXT } from '../core/trip/invite';
import { memberRows, type MemberRow } from '../core/trip/members';
import { copyInvite, issueInvite, shareInvite } from '../features/trip/actions';
import type { RootScreenProps } from '../navigation/routes';
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
  Empty,
  Header,
  Icon,
  IconBtn,
  lineC,
  Notice,
  R,
  Row,
  ScopeBadge,
  Screen,
  Sheet,
  SP,
  surfaceC,
  Tag,
  Txt,
} from '../ui';

/**
 * 14 멤버 초대 · 링크 공유(FR-301·303, WP2 소유).
 * - 초대 링크: youngtrip.app/j/코드, 복사(expo-clipboard), 공유(공유 시트가 안 되면 복사로 대체하고 토스트), 만료일·남은 자리.
 *   발급·재발급은 방장 또는 초대 권한이 있는 멤버만. 재발급하면 이전 링크는 무효다(확인 1회).
 *   초대 권한이 없는 그룹원에게는 링크·복사·공유·시연 합류를 보이지 않는다(권한표 '멤버 초대' 그룹원 X). 링크를 건네는 것도 초대다.
 * - 멤버 행: 후보 N곳(0곳도 표시, 제안자 규칙), 전송 대기 칩, 나간 멤버는 뒤에 '나간 멤버'로 남는다. 초대 가능은 보조 줄에 붙인다.
 * - 방장은 행 오른쪽 메뉴에서 초대 권한 토글과 내보내기(ScopeBadge 2차, 프로토타입 가정). 로즈를 위험 신호로 쓰지 않는다.
 */
export default function MembersScreen({ navigation, route }: RootScreenProps<'Members'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const pending = useTrips((s) => s.pending);
  const dispatch = useTrips((s) => s.dispatch);
  const now = useNow(60_000);
  useUi((s) => s.actingAs[tripId]);

  const [menuFor, setMenuFor] = useState<MemberRow | undefined>(undefined);
  const [confirm, setConfirm] = useState<'reissue' | 'remove' | undefined>(undefined);

  const me = trip ? myMemberId(trip) : undefined;
  const rows = useMemo(() => (trip ? memberRows(trip, { meId: me, pending }) : []), [trip, me, pending]);

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Home' }));

  if (!trip || trip.deletedAt != null || !me) {
    return (
      <Screen>
        <Header back={back} title="멤버 초대" size="sm" />
        <Body>
          <Card>
            <Empty title="여행방을 찾을 수 없습니다" text="삭제됐거나 이 여행방에서 나갔습니다." action={{ label: '홈으로', onPress: () => navigation.navigate('Main', { screen: 'Home' }) }} />
          </Card>
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

  return (
    <Screen>
      <Header
        back={back}
        title="멤버 초대"
        size="sm"
        sub="링크를 받은 사람은 가입 없이 게스트로 들어옵니다."
      />
      <Body scroll>
        {tripMode(trip) === 'personal' ? (
          <Notice icon="users" text="지금은 개인 모드입니다. 첫 멤버가 합류하면 그룹방으로 바뀌고 채팅이 열립니다. 이미 담은 후보는 그대로입니다." />
        ) : null}

        {actingOther && own ? (
          <Card variant="tinted">
            <Txt v="mtTight" c="accentStrong">{`이 기기에서 ${actingName ?? '다른 멤버'}님으로 행동하는 중입니다(시연).`}</Txt>
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
              <>
                <Notice icon="link" text="초대는 방장 또는 초대 권한이 있는 멤버만 할 수 있습니다. 함께 갈 사람이 있으면 방장에게 알려 주세요." />
                {inv && usable ? <Txt v="mtTight">{`남은 자리 ${seatsLeft(trip)} · 방장 포함 6명까지`}</Txt> : null}
              </>
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
                      {inviteUrlShort(inv.code)}
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
                <Row>
                  <View style={{ flex: 1 }}>
                    <Txt v="mtTight">{`${dateLongShort(inv.expiresAt)} 만료 · 남은 자리 ${seatsLeft(trip)}`}</Txt>
                  </View>
                  <Pressable accessibilityRole="button" hitSlop={HIT} onPress={() => setConfirm('reissue')}>
                    <Txt v="mtTight">새 링크 만들기</Txt>
                  </Pressable>
                </Row>
                {status === 'full' ? <Notice tone="warn" icon="alert" text={INVITE_ERROR_TEXT.full} /> : null}
              </>
            ) : (
              <>
                <Txt v="mt">
                  {!inv
                    ? '아직 초대 링크가 없습니다.'
                    : status === 'expired'
                      ? '초대 링크가 만료되었습니다(7일). 새 링크를 만들어 주세요.'
                      : '이 링크는 더 이상 쓸 수 없습니다. 새 링크를 만들어 주세요.'}
                </Txt>
                <Btn title="초대 링크 만들기" size="sm" variant="ghost" icon="link" onPress={() => issueInvite(trip.id)} />
                <Txt v="mtTight">링크는 7일 동안 쓸 수 있고 방장 포함 6명까지 들어옵니다.</Txt>
              </>
            )}
          </Col>
        </Card>

        {mayInvite && inv && usable ? <Btn title="링크 공유하기" icon="share" onPress={() => void shareInvite(trip)} /> : null}
        {mayInvite && inv && status === 'ok' ? (
          <Btn
            title="이 기기에서 다른 사람으로 합류해 보기(시연)"
            variant="quiet"
            size="sm"
            icon="users"
            onPress={() => navigation.navigate('InviteAccept', { code: inv.code })}
          />
        ) : null}

        <Txt v="eyebrow">{`멤버 ${active}명`}</Txt>
        <Col gap={SP.m}>
          {rows.map((r, i) => (
            <MemberLine key={r.id} row={r} index={i} canManage={host && !r.isMe && !r.left && r.role !== 'host'} onMenu={() => setMenuFor(r)} />
          ))}
        </Col>

        <Card variant="tinted">
          <Txt v="mtTight" c="accentStrong">
            {'게스트 세션은 '}
            <Txt v="chip" c="accentStrong">
              30일
            </Txt>
            {' 동안 쓰지 않으면 끊깁니다. 만료 3일 전에 앱 안에서 본인에게 알립니다.'}
          </Txt>
        </Card>
      </Body>

      <Sheet visible={menuFor != null && confirm == null} onClose={() => setMenuFor(undefined)} title={menuFor?.nickname}>
        {menuFor ? (
          <>
            <Row>
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={SP.s}>
                  <Txt v="nm">초대 권한</Txt>
                  <ScopeBadge phase="2차" />
                </Row>
                <Txt v="mtTight">켜면 이 멤버도 초대 링크를 만들고 공유할 수 있습니다. 권한 조정은 초대 권한 한 가지 · 프로토타입 가정</Txt>
              </View>
              <Tag
                label={menuFor.canInvite ? '켜짐' : '꺼짐'}
                on={menuFor.canInvite}
                onPress={() => {
                  const r = dispatch(trip.id, { type: 'member/setCanInvite', memberId: menuFor.id, canInvite: !menuFor.canInvite });
                  if (r.ok) setMenuFor({ ...menuFor, canInvite: !menuFor.canInvite });
                }}
              />
            </Row>
            <View style={{ height: 1, backgroundColor: lineC.line }} />
            <Row>
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={SP.s}>
                  <Txt v="nm">내보내기</Txt>
                  <ScopeBadge phase="2차" />
                </Row>
                <Txt v="mtTight">제안한 후보와 채팅은 '나간 멤버'로 남습니다 · 정책 미결정</Txt>
              </View>
              <Btn title="내보내기" variant="quiet" size="sm" onPress={() => setConfirm('remove')} />
            </Row>
          </>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={confirm === 'reissue'}
        title="새 초대 링크를 만들까요"
        text="지금 링크는 바로 쓸 수 없게 됩니다. 이미 합류한 멤버는 그대로입니다."
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
        text="이 멤버는 더 이상 여행방을 보거나 편집할 수 없습니다. 제안한 후보와 채팅은 남습니다."
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
    <Row gap={SP.l}>
      <Avatar name={row.nickname} index={row.left ? 3 : index} />
      <Col gap={4} grow>
        <Txt v="nm" c={row.left ? 'muted' : 'ink'} numberOfLines={1}>
          {row.nickname}
        </Txt>
        <Txt v="mtTight" numberOfLines={2}>
          {row.sub}
        </Txt>
      </Col>
      {row.waiting ? <Chip text="전송 대기" tone="warn" /> : null}
      <Chip text={`후보 ${row.candidates}곳`} tone="line" />
      {canManage ? <IconBtn icon="dots" label={`${row.nickname} 메뉴`} onPress={onMenu} /> : null}
    </Row>
  );
}
