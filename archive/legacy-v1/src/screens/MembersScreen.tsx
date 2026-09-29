import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { MEMBER_CAPACITY } from '../core/constants';
import { useTrip } from '../store/useTrip';
import { Btn, C, Chip, S, Section } from '../ui';

/** FR-301 초대 링크 발급 + FR-302 초대 수락 + FR-303 멤버 관리(일부) */
export default function MembersScreen() {
  const { current, issueInvite, joinAsMember, leaveMember, session, lastNotice } = useTrip();
  const trip = current();
  const [nickname, setNickname] = useState('');

  if (!trip) return null;

  const invite = trip.invite;
  const expired = invite ? Date.now() > invite.expiresAt : false;

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Text style={S.h1}>멤버 초대</Text>
      <Text style={S.muted}>링크를 받은 사람은 가입 없이 게스트로 들어옵니다.</Text>

      <Section title="초대 링크" />
      {invite ? (
        <View style={S.card}>
          <Text style={S.h2}>yeojeong.app/j/{invite.code}</Text>
          <Text style={S.muted}>
            {new Date(invite.expiresAt).toLocaleDateString('ko-KR')} 만료 · 남은 자리{' '}
            {Math.max(0, invite.capacity - trip.members.length)}
            {expired ? ' · 만료됨' : ''}
          </Text>
        </View>
      ) : (
        <Text style={S.muted}>아직 발급하지 않았습니다.</Text>
      )}
      <Btn title={invite ? '새 링크 만들기' : '초대 링크 발급'} onPress={issueInvite} />

      <Section title="이 기기에서 합류 시뮬레이션" />
      <Text style={S.muted}>
        서버가 없는 프로토타입이라, 다른 사람 대신 이 기기에서 멤버를 더합니다. 제안자 수 규칙을
        혼자서도 시험해 볼 수 있습니다.
      </Text>
      <View style={S.row}>
        <TextInput
          style={[S.input, S.grow]}
          value={nickname}
          onChangeText={setNickname}
          placeholder="닉네임"
          placeholderTextColor={C.muted}
        />
        <Btn
          title="합류"
          onPress={() => {
            joinAsMember(nickname);
            setNickname('');
          }}
        />
      </View>
      {lastNotice ? <Text style={S.muted}>{lastNotice}</Text> : null}

      <Section title={`멤버 ${trip.members.length} / ${MEMBER_CAPACITY}`} />
      {trip.members.map((m) => {
        const proposed = trip.spots.filter((s) => s.proposerIds.includes(m.id)).length;
        return (
          <View key={m.id} style={S.card}>
            <View style={S.row}>
              <Text style={[S.h2, S.grow]}>{m.nickname}</Text>
              {m.isHost ? <Chip text="방장" /> : null}
              <Chip text={`후보 ${proposed}곳`} tone="line" />
            </View>
            <Text style={S.muted}>
              {m.isGuest ? '게스트' : '계정'} · {new Date(m.joinedAt).toLocaleDateString('ko-KR')}{' '}
              합류
            </Text>
            {!m.isHost ? (
              <Pressable onPress={() => leaveMember(m.id)}>
                <Text style={{ color: C.rose, fontSize: 12, fontWeight: '700' }}>내보내기</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Section title="게스트 세션" />
      <View style={[S.card, { backgroundColor: C.tint, borderColor: C.tint }]}>
        <Text style={S.body}>기기 토큰 {session?.deviceToken}</Text>
        <Text style={S.muted}>
          {session ? new Date(session.expiresAt).toLocaleDateString('ko-KR') : '-'} 만료 · 앱을 열
          때마다 30일로 갱신됩니다.
        </Text>
      </View>
    </ScrollView>
  );
}
