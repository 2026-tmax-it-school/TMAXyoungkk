import React, { useState } from 'react';

import { NICKNAME_MAX } from '../core/constants';
import { nicknameProblem } from '../core/auth';
import type { RootScreenProps } from '../navigation/routes';
import { useSession } from '../store/session';
import { Body, Btn, Col, Field, Foot, Header, Row, Screen } from '../ui';

/**
 * 온보딩 · 게스트로 시작(FR-105, WP1 소유). 방장이 처음 여는 화면이다.
 * 02 초대 수락과 같은 틀(머리말 → 닉네임 → 게스트 한계 안내 → 아래 버튼)을 ui 컴포넌트로만 만든다.
 * 게스트 한계(30일·이 기기 한정·복구 불가)는 시작 버튼 앞에 보여준다. 나중에 알면 일정을 다 짜고 잃는다.
 */
export default function OnboardingScreen({ navigation }: RootScreenProps<'Onboarding'>) {
  const [nickname, setNickname] = useState('');
  const [touched, setTouched] = useState(false);
  const createGuest = useSession((s) => s.createGuest);
  const problem = nicknameProblem(nickname);

  return (
    <Screen>
      <Header eyebrow="Young Trip 시작하기" title="채팅에서 나온 곳을 여행 루트로" />
      <Body scroll>
        <Field
          label="내 닉네임"
          value={nickname}
          onChangeText={(v) => {
            setNickname(v);
            setTouched(true);
          }}
          maxLength={NICKNAME_MAX}
          error={touched && problem ? problem : undefined}
        />
      </Body>
      <Foot>
        <Btn title="게스트로 시작하기" disabled={problem != null} onPress={() => createGuest(nickname.trim())} />
        <Row gap={9}>
          <Col grow>
            <Btn title="초대 코드로 합류" variant="ghost" size="sm" onPress={() => navigation.navigate('InviteAccept')} />
          </Col>
          <Col grow>
            <Btn title="계정으로 로그인" variant="quiet" size="sm" onPress={() => navigation.navigate('Login')} />
          </Col>
        </Row>
      </Foot>
    </Screen>
  );
}
