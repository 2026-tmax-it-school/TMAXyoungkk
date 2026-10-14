import React, { useState } from 'react';

import { NICKNAME_MAX } from '../core/constants';
import { nicknameProblem } from '../core/auth';
import { GUEST_LIMIT_HELP } from '../features/account/messages';
import type { RootScreenProps } from '../navigation/routes';
import { useSession } from '../store/session';
import { Body, Btn, Field, Foot, Header, Notice, Screen, TextLink } from '../ui';

/**
 * 온보딩 · 게스트로 시작(FR-105, WP1 소유). 방장이 처음 여는 화면이다.
 * 02 초대 수락과 같은 틀(머리말 → 닉네임 → 게스트 한계 안내 → 아래 버튼)을 ui 컴포넌트로만 만든다.
 * 게스트 한계(30일·이 기기 한정·복구 불가)는 닉네임 칸 help로 시작 버튼 앞에 보여준다. 나중에 알면 일정을 다 짜고 잃는다.
 * - 평소: 주 버튼은 '게스트로 시작하기'이고, 계정이 있는 사람은 이름 칸 아래 글자 링크로 로그인한다.
 * - 돌아온 사용자(계정 세션이 만료돼 이 화면으로 온 경우): 다시 로그인하면 여행방을 그대로 이어 쓰므로 '다시 로그인하기'가
 *   주 버튼이고, 게스트 시작은 ghost로 내린다.
 * - 닉네임 칸에서 Enter를 누르면 게스트로 시작한다. '초대 코드로 합류'는 적어 둔 닉네임을 초대 수락의 이름 칸으로 넘긴다.
 */
export default function OnboardingScreen({ navigation }: RootScreenProps<'Onboarding'>) {
  const [nickname, setNickname] = useState('');
  const [touched, setTouched] = useState(false);
  const createGuest = useSession((s) => s.createGuest);
  const returning = useSession((s) => s.expiredKind === 'account');
  const problem = nicknameProblem(nickname);

  const start = () => {
    setTouched(true);
    if (problem == null) createGuest(nickname.trim());
  };
  const login = () => navigation.navigate('Login');
  const invite = () => {
    const name = nickname.trim();
    navigation.navigate('InviteAccept', name ? { nickname: name } : undefined);
  };

  return (
    <Screen keyboard>
      <Header eyebrow="Young Trip 시작하기" title="채팅에서 나온 곳을 여행 루트로" />
      <Body scroll>
        {returning ? <Notice icon="user" text="로그인이 끝났어요. 다시 로그인하면 여행방을 이어 써요" /> : null}
        <Field
          label="내 닉네임"
          kind="nickname"
          value={nickname}
          onChangeText={(v) => {
            setNickname(v);
            setTouched(true);
          }}
          maxLength={NICKNAME_MAX}
          placeholder="예: 민지"
          help={GUEST_LIMIT_HELP}
          error={touched && problem ? problem : undefined}
          onSubmitEditing={start}
        />
        {returning ? null : <TextLink title="이미 계정이 있어요 · 로그인" onPress={login} />}
      </Body>
      <Foot>
        {returning ? <Btn title="다시 로그인하기" onPress={login} /> : null}
        <Btn title="게스트로 시작하기" variant={returning ? 'ghost' : 'primary'} disabled={problem != null} onPress={start} />
        <Btn title="초대 코드로 합류" variant="quiet" size="sm" onPress={invite} />
      </Foot>
    </Screen>
  );
}
