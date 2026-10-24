import React, { useRef, useState } from 'react';
import { View } from 'react-native';

import { isEmailLike, normalizeEmail } from '../core/auth';
import type { OAuthProviderKind } from '../core/ports';
import { MailLinkCode } from '../features/account/components/MailLinkCode';
import { FindAccountSheet } from '../features/account/FindAccountSheet';
import { confirmLinkFlow, signInFlow } from '../features/account/flows';
import { authFailText, guestNowTitle, mailCodeFailText } from '../features/account/messages';
import { OAUTH_LABEL } from '../features/account/oauth';
import { useAuthDone } from '../features/account/useAuthDone';
import { needsMailCode } from '../features/account/social';
import { useOAuthLogin, type OAuthOutcome } from '../features/account/useOAuthLogin';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { AuthBtn, AuthTitle, Body, Btn, Col, ConfirmSheet, Divider, Field, IconBtn, Notice, Row, Screen, SP, TextLink, Txt } from '../ui';

/**
 * 15 로그인 · 소셜 로그인(FR-102·103, WP1 소유, 2026-10-10 사용자 시안으로 개편).
 * 위에서부터: 가운데 큰 제목 '로그인', 아이디 또는 이메일, 비밀번호, 로그인(잉크), 회원가입(흰 테두리), 오른쪽 '계정찾기',
 * 구분선, 카카오 로그인(노란 면·말풍선), 구글 로그인(흰 면·네 색 G). 소셜 버튼은 이 둘뿐이다.
 * - 아이디는 이메일 또는 닉네임이다(닉네임은 계정마다 하나). 없는 아이디도 같은 오류 문구다.
 * - 아이디 칸 Enter는 비밀번호 칸으로, 비밀번호 칸 Enter는 로그인이다. 키보드가 열려도 칸을 가리지 않는다(Screen keyboard).
 * - 계정 5회 연속 실패 시 10분 잠금 + 기기 토큰 기준 10분 20회 제한(모의 인증은 기기 토큰, 계정 서버는 IP 기준).
 * - 미인증 계정은 막고 인증 메일 재발송으로 이어 준다(오류 Notice의 action).
 * - 계정찾기: 비밀번호 재설정 메일을 받아 새 비밀번호를 정한다(FindAccountSheet).
 * - 카카오·구글: 계정 서버와 키가 있으면 실제 OAuth(useOAuthLogin, 인가 코드 + PKCE, 서버가 코드를 바꾼다).
 *   쓸 수 없으면 누를 때 이유를 알리고 시연용 동의 화면(26)으로 이어 갈 수 있다. 같은 이메일 계정이 있으면
 *   연결 확인(ConfirmSheet)을 받는다(자동 병합 없음). 시트를 닫아도 연결하지 않은 것으로 본다.
 * - 게스트가 다른 계정으로 로그인하면 그 게스트 세션은 복구할 수 없다. 시작 전에 앰버 한 줄로 알리고,
 *   여행방을 지키는 길(계정으로 바꾸기 = 회원가입 승격)을 바로 아래에 둔다. 이 버튼 제목은 '회원가입'이 아니다(화면 순서 테스트).
 * - 뒤로는 쌓인 화면이 있으면 그 화면, 없으면 홈(세션이 없으면 온보딩)으로 간다.
 */
/** 다음 칸 포커스용 ref(react-native 입력 칸 타입은 ui 밖에서 쓰지 않는다) */
type Focusable = { focus: () => void };

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
  // 서버가 연결 확인 코드를 메일로만 보낸 경우: 코드를 붙여 넣을 칸
  const [mailLink, setMailLink] = useState<OAuthProviderKind | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const passwordRef = useRef<Focusable | null>(null);
  const finish = useAuthDone(navigation);
  const kakao = useOAuthLogin('kakao');
  const google = useOAuthLogin('google');
  const toHome = useBack('Home');
  const back = () => {
    if (navigation.canGoBack() || session) toHome();
    else navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

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
    showToast(r.promoted ? '여행방을 그대로 둔 채 계정으로 바꿨어요' : `${r.account.nickname}님으로 로그인했어요`);
    finish();
  };

  const resend = async () => {
    const r = await getServices().auth.resendVerification(ident);
    if (r.ok) {
      showToast('인증 메일을 새로 보냈어요');
      // 그 이메일의 코드 입력 단계로 바로 간다(빈 가입 양식으로 가면 코드를 넣을 곳이 없다). 닉네임으로 로그인한 경우는 이메일을 모른다
      navigation.navigate('Signup', isEmailLike(ident) ? { verifyEmail: normalizeEmail(ident) } : undefined);
    } else {
      setFail({ ...authFailText(r) });
    }
  };

  const handleSocial = (provider: OAuthProviderKind, r: OAuthOutcome) => {
    const label = OAUTH_LABEL[provider];
    switch (r.kind) {
      case 'signIn':
        showToast(`${label} 계정(${r.account?.nickname ?? ''})으로 로그인했어요`);
        finish();
        return;
      case 'confirm':
        setLink({ provider, token: r.linkToken, text: r.text });
        return;
      case 'fail':
        setSocial(null);
        setFail(authFailText(r.result));
        if (needsMailCode(r.result)) setMailLink(provider);
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
    setMailLink(null);
    const r = await (provider === 'kakao' ? kakao : google).start();
    handleSocial(provider, r);
  };

  const submitMailCode = async (code: string) => {
    const token = code.trim();
    if (!mailLink || mailBusy || token.length === 0) return;
    setMailBusy(true);
    const r = await confirmLinkFlow(token, true);
    setMailBusy(false);
    if (r.ok) {
      showToast(`${OAUTH_LABEL[mailLink]} 로그인을 ${r.account.email} 계정에 연결했어요`);
      setMailLink(null);
      setFail(null);
      finish();
      return;
    }
    setFail(mailCodeFailText(r));
  };

  const answer = async (accept: boolean) => {
    if (!link || busy) return;
    setBusy(true);
    const r = await confirmLinkFlow(link.token, accept);
    setBusy(false);
    const label = OAUTH_LABEL[link.provider];
    setLink(null);
    if (r.ok) {
      showToast(`${label} 로그인을 ${r.account.email} 계정에 연결했어요`);
      finish();
      return;
    }
    if (!accept) {
      showToast('연결하지 않았어요. 기존 계정은 이메일로 로그인해 주세요');
      return;
    }
    setFail(authFailText(r));
  };

  return (
    <Screen keyboard>
      <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter }}>
        <Row>
          <IconBtn icon="back" label="뒤로" onPress={back} />
        </Row>
      </View>
      <Body scroll>
        <AuthTitle title="다시 만나서 반가워요" sub="이메일로 로그인하거나 간편 로그인을 쓰세요." />
        {session?.kind === 'guest' ? (
          <Col gap={SP.m}>
            <Notice
              tone="warn"
              icon="alert"
              title={guestNowTitle(session.nickname)}
              text="다른 계정으로 로그인하면 이 게스트의 여행방은 이 기기에서 볼 수 없어요."
            />
            <Btn title="계정으로 바꾸기(여행방 유지)" variant="ghost" size="sm" onPress={() => navigation.navigate('Signup')} />
          </Col>
        ) : null}
        <Field
          look="auth"
          label="아이디 또는 이메일"
          hideLabel
          kind="username"
          value={ident}
          onChangeText={(v) => {
            setIdent(v);
            setFail(null);
          }}
          placeholder="아이디 또는 이메일"
          returnKeyType="next"
          keepFocusOnSubmit
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Field
          look="auth"
          label="비밀번호"
          hideLabel
          kind="password"
          inputRef={(el) => {
            passwordRef.current = el;
          }}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setFail(null);
          }}
          placeholder="비밀번호"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        {fail ? (
          <Notice
            tone="warn"
            icon="alert"
            title={fail.title}
            text={fail.text}
            action={fail.unverified ? { label: '인증 메일 다시 받기', onPress: () => void resend() } : undefined}
          />
        ) : null}
        {mailLink ? <MailLinkCode busy={mailBusy} onSubmit={(c) => void submitMailCode(c)} /> : null}

        <AuthBtn title={busy ? '확인 중' : '로그인'} disabled={!canSubmit} onPress={() => void submit()} />
        <AuthBtn title="회원가입" variant="outline" onPress={() => navigation.navigate('Signup')} />
        <TextLink title="계정찾기" align="right" onPress={() => setFindOpen(true)} />

        <Divider label="또는" />

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
          <Notice
            icon="alert"
            title={`${OAUTH_LABEL[social.provider]} 로그인을 지금은 쓸 수 없어요`}
            text={social.text}
            action={
              social.mockFallback
                ? {
                    label: '시연용 동의 화면으로 계속',
                    onPress: () => navigation.navigate('SocialConsent', { provider: social.provider, intent: 'login' }),
                  }
                : undefined
            }
          />
        ) : null}

        <Txt v="mtTight" style={{ marginTop: SP.s }}>
          {`비밀번호를 5번 연속 틀리면 10분 동안 잠겨요. ${serverAuth ? '계정은 계정 서버에' : '계정은 이 기기에만'} 저장되고 비밀번호는 원문을 남기지 않아요.`}
        </Txt>
      </Body>
      <ConfirmSheet
        visible={link != null}
        title="기존 계정에 연결할까요"
        text={`${link?.text ?? ''} 연결하면 두 로그인 방법이 같은 여행방을 봐요`}
        confirmLabel="연결하기"
        cancelLabel="연결하지 않기"
        confirmDisabled={busy}
        onConfirm={() => void answer(true)}
        onCancel={() => void answer(false)}
      />
      <FindAccountSheet
        visible={findOpen}
        initialEmail={ident}
        onClose={() => setFindOpen(false)}
        onDone={(email) => {
          setFindOpen(false);
          setIdent(email);
          setPassword('');
          setFail(null);
          showToast('새 비밀번호를 저장했어요. 새 비밀번호로 로그인해 주세요');
        }}
      />
    </Screen>
  );
}
