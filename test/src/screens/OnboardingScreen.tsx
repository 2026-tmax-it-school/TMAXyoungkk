import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NICKNAME_MAX } from '../core/constants';
import { nicknameProblem } from '../core/auth';
import { GUEST_LIMIT_HELP } from '../features/account/messages';
import { OAUTH_LABEL } from '../features/account/oauth';
import { MailLinkCode } from '../features/account/components/MailLinkCode';
import { useSocialSignIn } from '../features/account/useSocialSignIn';
import type { RootScreenProps } from '../navigation/routes';
import { useSession } from '../store/session';
import { AuthBtn, Body, Btn, Col, ConfirmSheet, Divider, Field, Foot, Notice, R, RegionArt, Screen, SP, Txt } from '../ui';

/**
 * 온보딩 · 로그인 또는 게스트로 시작(FR-105, WP1 소유). 방장이 처음 여는 화면이다.
 * 2026-10-17 사용자 요청: 로그인을 이 화면에 같이 띄운다. 위에서부터 카카오 로그인, 구글 로그인, 이메일로 로그인,
 * 구분선, 닉네임(게스트), 아래 버튼(게스트로 시작하기 · 초대 코드로 합류)이다.
 * - 카카오·구글은 15 로그인 화면과 같은 흐름이다(features/account/useSocialSignIn: 같은 이메일 계정 연결 확인, 실패·쓸 수 없음 안내).
 * - 이메일 로그인과 회원가입은 15 로그인 화면으로 간다.
 * 게스트 한계(30일·이 기기 한정·복구 불가)는 닉네임 칸 help로 시작 버튼 앞에 보여준다. 나중에 알면 일정을 다 짜고 잃는다.
 * - 돌아온 사용자(계정 세션이 만료돼 이 화면으로 온 경우)는 위에 안내가 보이고 '다시 로그인하기'가 주 버튼, 게스트 시작은 ghost다.
 * - 닉네임 칸에서 Enter를 누르면 게스트로 시작한다. '초대 코드로 합류'는 적어 둔 닉네임을 초대 수락의 이름 칸으로 넘긴다.
 */
export default function OnboardingScreen({ navigation }: RootScreenProps<'Onboarding'>) {
  const [nickname, setNickname] = useState('');
  const [touched, setTouched] = useState(false);
  const createGuest = useSession((s) => s.createGuest);
  const returning = useSession((s) => s.expiredKind === 'account');
  const social = useSocialSignIn(navigation);
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
      <Body scroll>
        {/* 피그마 최종안 02(2026-10-23): 위에 지역 그림과 한 줄 소개, 그 아래 로그인 버튼 */}
        <View style={styles.hero}>
          <RegionArt regionId="busan" />
        </View>
        <View accessibilityRole="header">
          <Txt v="authTitle">
            {'친구들이 고른 곳으로\n하루가 짜여요'}
          </Txt>
        </View>
        <Col gap={SP.s}>
          <Txt v="mt">채팅에서 나온 장소를 모아 후보로 올리고, 좋아요를 모으면 동선과 시간표를 알아서 맞춰요.</Txt>
        </Col>
        {returning ? <Notice icon="user" text="로그인이 끝났어요. 다시 로그인하면 여행방을 이어 써요" /> : null}

        <Col gap={SP.m}>
          <AuthBtn
            title={social.kakao.busy ? '카카오 확인 중' : '카카오 로그인'}
            variant="kakao"
            disabled={social.busy}
            onPress={() => void social.start('kakao')}
          />
          <AuthBtn
            title={social.google.busy ? '구글 확인 중' : '구글 로그인'}
            variant="google"
            disabled={social.busy}
            onPress={() => void social.start('google')}
          />
          <AuthBtn title="이메일로 로그인 · 회원가입" variant="outline" onPress={login} />
        </Col>
        {social.fail ? <Notice tone="warn" icon="alert" title={social.fail.title} text={social.fail.text} /> : null}
        {social.mailLink ? <MailLinkCode busy={social.mailBusy} onSubmit={(c) => void social.submitMailCode(c)} /> : null}
        {social.unavailable ? (
          <Notice
            icon="alert"
            title={`${OAUTH_LABEL[social.unavailable.provider]} 로그인을 지금은 쓸 수 없어요`}
            text={social.unavailable.text}
            action={
              social.unavailable.mockFallback
                ? {
                    label: '시연용 동의 화면으로 계속',
                    onPress: () =>
                      navigation.navigate('SocialConsent', { provider: social.unavailable!.provider, intent: 'login' }),
                  }
                : undefined
            }
          />
        ) : null}

        <Divider />
        <Txt v="label">계정 없이 게스트로 시작</Txt>
        <Field
          label="내 닉네임"
          kind="nickname"
          value={nickname}
          onChangeText={(v) => {
            setNickname(v);
            setTouched(true);
          }}
          maxLength={NICKNAME_MAX}
          help={GUEST_LIMIT_HELP}
          error={touched && problem ? problem : undefined}
          onSubmitEditing={start}
        />
      </Body>
      <Foot>
        {returning ? <Btn title="다시 로그인하기" onPress={login} /> : null}
        {/* 막지 않는다: 닉네임 없이 누르면 start가 칸 아래 이유를 보인다(막아 두면 눌러도 아무 반응이 없었다) */}
        <Btn title="게스트로 시작하기" variant={returning ? 'ghost' : 'primary'} onPress={start} />
        <Btn title="초대 코드로 합류" variant="quiet" size="sm" onPress={invite} />
      </Foot>
      <ConfirmSheet
        visible={social.link != null}
        title="기존 계정에 연결할까요"
        text={`${social.link?.text ?? ''} 연결하면 두 로그인 방법이 같은 여행방을 봐요`}
        confirmLabel="연결하기"
        cancelLabel="연결하지 않기"
        confirmDisabled={social.answering}
        onConfirm={() => void social.answer(true)}
        onCancel={() => void social.answer(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 180, borderRadius: R.photo, overflow: 'hidden', marginTop: SP.xl },
});
