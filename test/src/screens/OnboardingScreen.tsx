import React, { useState } from 'react';

import { NICKNAME_MAX } from '../core/constants';
import { nicknameProblem } from '../core/auth';
import type { RootScreenProps } from '../navigation/routes';
import { useSession } from '../store/session';
import { Body, Btn, Card, Col, Field, Foot, Header, Icon, Notice, Row, Screen, ScopeBadge, Txt } from '../ui';

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
      <Header eyebrow="Young Trip 시작하기" title="채팅에서 나온 곳을 여행 루트로" sub="닉네임만 있으면 바로 여행방을 만들 수 있습니다." />
      <Body scroll>
        <Field
          label="내 닉네임"
          value={nickname}
          onChangeText={(v) => {
            setNickname(v);
            setTouched(true);
          }}
          maxLength={NICKNAME_MAX}
          placeholder="예: 민지"
          help="여행방마다 따로 바꿀 수 있습니다"
          error={touched && problem ? problem : undefined}
        />
        <Card variant="tinted">
          <Row top gap={8}>
            <Icon name="pinlock" size={17} color="accentStrong" />
            <Col gap={4} grow>
              <Txt v="btnSm" c="accentStrong">
                게스트로 바로 시작합니다
              </Txt>
              <Txt v="mtTight" c="accentStrong">
                가입 없이 이 기기에서 30일 동안 유지되고, 쓸 때마다 30일이 다시 늘어납니다. 기기를 바꾸거나 앱을 지우거나 30일
                동안 쓰지 않으면 복구할 수 없습니다.
              </Txt>
            </Col>
          </Row>
        </Card>
        <Notice
          icon="user"
          title="계정은 나중에"
          text="이메일 계정으로 바꾸면 폰을 바꿔도 여행방을 이어서 쓸 수 있어요."
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
