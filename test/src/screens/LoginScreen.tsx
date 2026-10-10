import React, { useState } from 'react';
import { View } from 'react-native';

import type { OAuthProviderKind } from '../core/ports';
import { FindAccountSheet } from '../features/account/FindAccountSheet';
import { confirmLinkFlow, signInFlow } from '../features/account/flows';
import { authFailText } from '../features/account/messages';
import { OAUTH_LABEL } from '../features/account/oauth';
import { useAuthDone } from '../features/account/useAuthDone';
import { useOAuthLogin, type OAuthOutcome } from '../features/account/useOAuthLogin';
import type { RootScreenProps } from '../navigation/routes';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { AuthBtn, AuthTitle, Body, Btn, Card, Col, Divider, Field, IconBtn, Notice, Row, Screen, SP, TextLink, Txt } from '../ui';

/**
 * 15 로그인 · 소셜 로그인(FR-102·103, WP1 소유, 2026-10-10 사용자 시안으로 개편).
 * 위에서부터: 가운데 큰 제목 '로그인', 아이디 또는 이메일, 비밀번호, 로그인(잉크), 회원가입(흰 테두리), 오른쪽 '계정찾기',
 * 구분선, 카카오 로그인(노란 면·말풍선), 구글 로그인(흰 면·네 색 G). 소셜 버튼은 이 둘뿐이다.
 * - 아이디는 이메일 또는 닉네임이다(닉네임은 계정마다 하나). 없는 아이디도 같은 오류 문구다.
 * - 계정 5회 연속 실패 시 10분 잠금 + 기기 토큰 기준 10분 20회 제한(모의 인증은 기기 토큰, 계정 서버는 IP 기준).
 * - 미인증 계정은 막고 인증 메일 재발송으로 이어 준다.
 * - 계정찾기: 비밀번호 재설정 메일을 받아 새 비밀번호를 정한다(FindAccountSheet).
 * - 카카오·구글: 계정 서버와 키가 있으면 실제 OAuth(useOAuthLogin, 인가 코드 + PKCE, 서버가 코드를 바꾼다).
 *   쓸 수 없으면 누를 때 이유를 알리고 시연용 동의 화면(26)으로 이어 갈 수 있다. 같은 이메일 계정이 있으면
 *   연결 확인을 받는다(자동 병합 없음).
 * - 게스트가 다른 계정으로 로그인하면 그 게스트 세션은 복구할 수 없다. 시작 전에 앰버로 알린다.
 */
export default function LoginScreen({ navigation }: RootScreenProps<'Login'>) {
  const session = useSession((s) => s.session);
  const showToast = useUi((s) => s.showToast);
  const [ident, setIdent] = useState(session?.kind === 'account' ? (session.email ?? '') : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<{ title: string; text: string; unverified?: boolean } | null>(null);
  const [social, setSocial] = useState<{ provider: OAuthProviderKind; text: string; mockFallback: boolean } | null>(null);
  const [link, setLink] = useState<{ provider: OAuthProviderKind; token: string; text: string } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const finish = useAuthDone(navigation);
  const kakao = useOAuthLogin('kakao');
  const google = useOAuthLogin('google');

  const canSubmit = ident.trim().length > 0 && password.length > 0 && !busy;
  const serverAuth = getServices().auth.id === 'server';

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setFail(null);
    setSocial(null);
    const r = await signInFlow({ email: ident, password });
    setBusy(false);
    if (!r.ok) {
      setFail({ ...authFailText(r), unverified: r.code === 'unverified' });
      return;
    }
    setPassword('');
    showToast(
      r.promoted
        ? '게스트를 계정으로 승격했습니다. 참여한 여행방을 그대로 씁니다'
        : `${r.account.nickname}님으로 로그인했습니다. 이 기기의 여행방을 이어 씁니다`,
    );
    finish();
  };

  const resend = async () => {
    const r = await getServices().auth.resendVerification(ident);
    if (r.ok) {
      showToast('인증 메일을 다시 보냈습니다. 이전 메일의 링크는 쓸 수 없습니다');
      navigation.navigate('Signup');
    } else {
      setFail({ ...authFailText(r) });
    }
  };

  const handleSocial = (provider: OAuthProviderKind, r: OAuthOutcome) => {
    const label = OAUTH_LABEL[provider];
    switch (r.kind) {
      case 'signIn':
        showToast(`${label} 계정(${r.account?.nickname ?? ''})으로 로그인했습니다`);
        finish();
        return;
      case 'confirm':
        setLink({ provider, token: r.linkToken, text: r.text });
        return;
      case 'fail':
        setSocial(null);
        setFail(authFailText(r.result));
        return;
      case 'unavailable':
        setSocial({ provider, text: r.text, mockFallback: r.mockFallback });
        return;
      case 'cancel':
      case 'linked':
        return;
    }
  };

  const startSocial = async (provider: OAuthProviderKind) => {
    setFail(null);
    setSocial(null);
    setLink(null);
    const r = await (provider === 'kakao' ? kakao : google).start();
    handleSocial(provider, r);
  };

  const answer = async (accept: boolean) => {
    if (!link) return;
    setBusy(true);
    const r = await confirmLinkFlow(link.token, accept);
    setBusy(false);
    const label = OAUTH_LABEL[link.provider];
    setLink(null);
    if (r.ok) {
      showToast(`${label} 로그인을 ${r.account.email} 계정에 연결했습니다`);
      finish();
      return;
    }
    if (!accept) {
      showToast('연결하지 않았습니다. 기존 계정은 이메일로 로그인할 수 있습니다');
      return;
    }
    setFail(authFailText(r));
  };

  return (
    <Screen>
      {navigation.canGoBack() ? (
        <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter }}>
          <Row>
            <IconBtn icon="back" label="뒤로" onPress={navigation.goBack} />
          </Row>
        </View>
      ) : null}
      <Body scroll>
        <AuthTitle title="로그인" />
        {session?.kind === 'guest' ? (
          <Notice
            tone="warn"
            icon="alert"
            title={`지금은 게스트 ${session.nickname}입니다`}
            text="다른 계정으로 로그인하면 이 게스트 세션은 복구할 수 없고, 게스트 여행방은 이 기기에서 보이지 않습니다. 게스트 여행방을 계정으로 옮기려면 먼저 회원가입으로 승격해 주세요."
          />
        ) : null}
        <Field
          look="auth"
          label="아이디 또는 이메일"
          hideLabel
          value={ident}
          onChangeText={(v) => {
            setIdent(v);
            setFail(null);
          }}
          placeholder="아이디 또는 이메일"
        />
        <Field
          look="auth"
          label="비밀번호"
          hideLabel
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setFail(null);
          }}
          secure
          placeholder="비밀번호"
          onSubmitEditing={() => void submit()}
        />
        {fail ? <Notice tone="warn" icon="alert" title={fail.title} text={fail.text} /> : null}
        {fail?.unverified ? <Btn title="인증 메일 다시 받기" variant="ghost" size="sm" onPress={() => void resend()} /> : null}

        <AuthBtn title={busy ? '확인 중' : '로그인'} disabled={!canSubmit} onPress={() => void submit()} />
        <AuthBtn title="회원가입" variant="outline" onPress={() => navigation.navigate('Signup')} />
        <TextLink title="계정찾기" align="right" onPress={() => setFindOpen(true)} />

        <Divider />

        <AuthBtn
          title={kakao.busy ? '카카오 확인 중' : '카카오 로그인'}
          variant="kakao"
          disabled={kakao.busy || google.busy}
          onPress={() => void startSocial('kakao')}
        />
        <AuthBtn
          title={google.busy ? '구글 확인 중' : '구글 로그인'}
          variant="google"
          disabled={kakao.busy || google.busy}
          onPress={() => void startSocial('google')}
        />

        {social ? (
          <Col gap={SP.m}>
            <Notice icon="alert" title={`${OAUTH_LABEL[social.provider]} 로그인을 지금은 쓸 수 없어요`} text={social.text} />
            {social.mockFallback ? (
              <Btn
                title="시연용 동의 화면으로 계속"
                variant="quiet"
                size="sm"
                onPress={() => navigation.navigate('SocialConsent', { provider: social.provider, intent: 'login' })}
              />
            ) : null}
          </Col>
        ) : null}

        {link ? (
          <Card variant="tinted">
            <Txt v="nm" c="accentStrong">
              기존 계정에 연결할까요
            </Txt>
            <Txt v="mt" c="accentStrong">
              {`${link.text} 연결하면 두 로그인 방법이 같은 여행방을 봅니다. 연결하지 않으면 아무것도 바뀌지 않습니다.`}
            </Txt>
            <Row gap={9}>
              <Col grow>
                <Btn title="연결하기" size="sm" disabled={busy} onPress={() => void answer(true)} />
              </Col>
              <Col grow>
                <Btn title="연결하지 않기" size="sm" variant="quiet" disabled={busy} onPress={() => void answer(false)} />
              </Col>
            </Row>
          </Card>
        ) : null}

        <Txt v="mtTight" style={{ marginTop: SP.s }}>
          {`비밀번호를 5번 연속 틀리면 10분 동안 잠겨요. ${serverAuth ? '계정은 계정 서버에' : '계정은 이 기기에만'} 저장되고 비밀번호는 원문을 남기지 않아요.`}
        </Txt>
      </Body>
      <FindAccountSheet
        visible={findOpen}
        initialEmail={ident}
        onClose={() => setFindOpen(false)}
        onDone={(email) => {
          setFindOpen(false);
          setIdent(email);
          setPassword('');
          setFail(null);
          showToast('새 비밀번호를 저장했습니다. 새 비밀번호로 로그인해 주세요');
        }}
      />
    </Screen>
  );
}
