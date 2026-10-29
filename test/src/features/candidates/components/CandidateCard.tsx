import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Spot, Trip } from '../../../types';
import { hasVote } from '../../../core/chatmap/votes';
import { myMemberId } from '../../../store/trips';
import { Avatar, AvatarStack, Card, Chip, Col, H, Icon, R, Row, SP, TourTarget, Txt, lineC, surfaceC } from '../../../ui';
import { toggleVote } from '../../chat/map/actions';
import { spotHintLabel, spotWho, voterNames } from '../talk';

/**
 * 06 후보 카드(2026-10-23 피그마 최종안 17). 위에서부터 이름과 시간 힌트 배지, 보조 줄, 누가 꺼냈는지, 좋아요 줄이다.
 * 카드를 통째로 버튼으로 두면 좋아요가 버튼 속 버튼이 된다. 상세 열기(위 칸)와 좋아요(아래 알약)를 따로 둔다.
 * 좋아요는 채팅방 지도와 같은 한 표(features/chat/map/actions.toggleVote, 표 수 제한·끝난 여행 막기 포함)다.
 * 2026-10-24: 좋아요를 이름 투표로 바꿨다. 버튼은 '투표 N'(내가 했으면 '투표함 N'), 왼쪽에 누가 투표했는지 이름을 쓴다.
 */
export function CandidateCard({
  trip,
  spot,
  name,
  sub,
  pinLabel,
  warn,
  tourLike,
  onOpen,
}: {
  trip: Trip;
  spot: Spot;
  name: string;
  sub: string;
  pinLabel: string | null;
  warn?: string;
  /** 앱 둘러보기가 이 카드의 좋아요 버튼을 비출 수 있게 표시한다(첫 카드만) */
  tourLike?: boolean;
  onOpen: () => void;
}) {
  const who = spotWho(trip, spot);
  const hint = spotHintLabel(trip, spot);
  const voters = voterNames(trip, spot);
  const me = myMemberId(trip);
  const mine = me ? hasVote(spot, me) : false;
  const label = mine ? `투표함 ${voters.length}` : `투표 ${voters.length}`;
  const likeBtn = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: mine }}
      accessibilityLabel={`${name} ${mine ? '투표 취소' : '투표'}, 지금 ${voters.length}표${voters.length ? `: ${voters.join(', ')}` : ''}`}
      onPress={() => toggleVote(trip.id, spot)}
      hitSlop={(H.touch - H.btnSm) / 2}
      style={[styles.like, mine ? styles.likeOn : styles.likeOff]}
    >
      <Icon name="check" size={16} color={mine ? 'onAccent' : 'ink'} stroke={2} />
      <Txt v="chip" c={mine ? 'onAccent' : 'ink'}>
        {label}
      </Txt>
    </Pressable>
  );
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name} 상세 보기`} onPress={onOpen} style={styles.open}>
        <Col gap={SP.xs}>
          <Row gap={SP.s} wrap>
            <Txt v="nm">{name}</Txt>
            {hint ? <Chip text={hint} tone="warn" /> : null}
            {pinLabel ? <Chip text={pinLabel} icon="pinlock" /> : null}
            {warn ? <Chip text={warn} tone="warn" /> : null}
          </Row>
          <Txt v="mtTight">{sub}</Txt>
          {who ? (
            <Row gap={SP.s}>
              <Avatar name={who.name} index={who.index} />
              <Txt v="mtTight">{who.text}</Txt>
            </Row>
          ) : null}
        </Col>
      </Pressable>
      <Row>
        <View style={styles.grow}>
          {voters.length > 0 ? (
            <Row gap={SP.s}>
              <AvatarStack names={voters} max={4} />
              <Txt v="mtTight" numberOfLines={2} style={styles.grow}>
                {votedText(voters)}
              </Txt>
            </Row>
          ) : (
            <Txt v="mtTight">아직 표가 없어요</Txt>
          )}
        </View>
        {tourLike ? <TourTarget id="cand-like">{likeBtn}</TourTarget> : likeBtn}
      </Row>
    </Card>
  );
}

/** 투표한 사람 이름 줄. 셋까지 이름을 다 쓰고 넘치면 '외 N명'이다('민지, 준호 투표', '민지, 준호, 수아 외 2명 투표') */
export function votedText(voters: readonly string[]): string {
  const shown = voters.slice(0, 3).join(', ');
  const rest = voters.length - 3;
  return rest > 0 ? `${shown} 외 ${rest}명 투표` : `${shown} 투표`;
}

const styles = StyleSheet.create({
  open: { minHeight: H.touch },
  grow: { flex: 1 },
  like: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.s,
    height: H.btnSm,
    paddingHorizontal: SP.xxl,
    borderRadius: R.iconBtn,
  },
  likeOn: { backgroundColor: surfaceC.accent },
  likeOff: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.line },
});
