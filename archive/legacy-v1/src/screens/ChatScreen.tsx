import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useTrip } from '../store/useTrip';
import { Btn, C, Chip, S } from '../ui';

/** 프로토타입 시연용 대화. 멤버 4명이 장소를 언급하는 흐름을 그대로 재현한다. */
const SCENARIO: Array<{ who: string; text: string }> = [
  { who: '준호', text: '둘째 날 오전은 불국사 갔다가 석굴암 올라가자' },
  { who: '수아', text: '점심은 교촌마을 예약해뒀어. 여긴 시간 못 바꿔' },
  { who: '민지', text: '좋다. 첫날 저녁은 황리단길 어때?' },
  { who: '수아', text: '대릉원이랑 첨성대도 보고 싶어' },
  { who: '준호', text: '감은사지 삼층석탑도 가보고 싶은데 멀려나' },
  { who: '지우', text: '동궁과 월지 야경 유명하대' },
];

/** FR-304 그룹 채팅 + FR-401 장소 추출 */
export default function ChatScreen() {
  const {
    current,
    sendMessage,
    undoExtraction,
    speakingAs,
    setSpeakingAs,
    joinAsMember,
    busy,
  } = useTrip();
  const trip = current();
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const scroller = useRef<ScrollView>(null);

  if (!trip) return null;

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    const added = await sendMessage(value);
    setNotice(added > 0 ? `장소 ${added}곳을 후보에 담았습니다.` : '장소를 찾지 못했습니다.');
  };

  const runScenario = async () => {
    for (const line of SCENARIO) {
      let member = useTrip.getState().current()?.members.find((m) => m.nickname === line.who);
      if (!member) {
        joinAsMember(line.who);
        member = useTrip.getState().current()?.members.find((m) => m.nickname === line.who);
      }
      if (member) setSpeakingAs(member.id);
      // eslint-disable-next-line no-await-in-loop
      await sendMessage(line.text);
    }
    setNotice('시나리오 대화를 넣었습니다. 후보 탭에서 자동 선별 결과를 보세요.');
  };

  return (
    <KeyboardAvoidingView
      style={S.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={{ padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <View style={S.row}>
          <Text style={[S.label, S.grow]}>보내는 사람</Text>
          <Pressable onPress={runScenario}>
            <Text style={{ color: C.rose, fontWeight: '700', fontSize: 12 }}>시나리오 넣기</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={S.row}>
            {trip.members.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setSpeakingAs(m.id)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  marginRight: 6,
                  backgroundColor: speakingAs === m.id ? C.rose : C.card,
                  borderWidth: 1,
                  borderColor: speakingAs === m.id ? C.rose : C.line,
                }}
              >
                <Text
                  style={{
                    color: speakingAs === m.id ? '#FFFFFF' : C.muted,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {m.nickname}
                  {m.isHost ? ' (방장)' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView
        ref={scroller}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {trip.messages.length === 0 ? (
          <Text style={S.muted}>
            대화에서 장소를 찾아 후보로 담습니다. "시나리오 넣기"로 한 번에 시험해 볼 수 있습니다.
          </Text>
        ) : null}
        {trip.messages.map((m) => {
          const who = trip.members.find((x) => x.id === m.memberId);
          const mine = m.memberId === speakingAs;
          return (
            <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 4 }}>
              <Text style={S.muted}>{who?.nickname ?? '알 수 없음'}</Text>
              <View
                style={{
                  maxWidth: '85%',
                  backgroundColor: mine ? C.rose : C.card,
                  borderColor: mine ? C.rose : C.line,
                  borderWidth: 1,
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <Text style={{ color: mine ? '#FFFFFF' : C.ink, fontSize: 14 }}>{m.text}</Text>
              </View>
              {m.extractedSpotIds.length > 0 ? (
                <View style={S.row}>
                  <Chip text={`후보 ${m.extractedSpotIds.length}곳 추가`} tone="ok" />
                  <Pressable onPress={() => undoExtraction(m.id)}>
                    <Text style={{ color: C.rose, fontSize: 11, fontWeight: '700' }}>되돌리기</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {notice ? (
        <Text style={[S.muted, { paddingHorizontal: 12 }]}>{notice}</Text>
      ) : null}
      {busy ? <ActivityIndicator color={C.rose} style={{ marginBottom: 4 }} /> : null}

      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: C.line,
        }}
      >
        <TextInput
          style={[S.input, S.grow]}
          value={text}
          onChangeText={setText}
          placeholder="메시지 입력"
          placeholderTextColor={C.muted}
          onSubmitEditing={send}
        />
        <Btn title="보내기" onPress={send} />
      </View>
    </KeyboardAvoidingView>
  );
}
