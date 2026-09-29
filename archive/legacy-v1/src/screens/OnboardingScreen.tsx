import React, { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { useTrip } from '../store/useTrip';
import { Btn, C, S } from '../ui';
import { providerStatus } from '../services';

/** FR-105 게스트 세션 생성. 회원가입·로그인은 2차라 여기 없다. */
export default function OnboardingScreen() {
  const createGuest = useTrip((s) => s.createGuest);
  const [nickname, setNickname] = useState('민지');

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Text style={S.h1}>여정</Text>
      <Text style={S.muted}>기능명세서 v0.2 · 1단계 MVP 프로토타입</Text>

      <View style={[S.card, { marginTop: 12 }]}>
        <Text style={S.label}>이 기기에서 쓸 이름</Text>
        <TextInput
          style={S.input}
          value={nickname}
          onChangeText={setNickname}
          placeholder="닉네임"
          placeholderTextColor={C.muted}
        />
        <Text style={S.muted}>
          가입 없이 기기 토큰으로 30일 동안 유지됩니다. 기기를 바꾸면 복구할 수 없습니다.
        </Text>
      </View>

      <Btn title="게스트로 시작" onPress={() => createGuest(nickname)} />

      <View style={[S.card, { backgroundColor: C.tint, borderColor: C.tint }]}>
        <Text style={S.label}>지도·경로 제공자</Text>
        <Text style={S.body}>{providerStatus()}</Text>
        <Text style={S.muted}>
          test/.env 에 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY 를 넣으면 구글 Places·Routes API를 씁니다.
          키가 없어도 내장 경주 사전과 직선거리 추정으로 전 기능이 동작합니다.
        </Text>
      </View>
    </ScrollView>
  );
}
