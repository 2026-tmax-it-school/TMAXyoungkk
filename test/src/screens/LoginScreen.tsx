import React, { useState } from 'react';

import { isEmailLike } from '../core/auth';
import { signInFlow } from '../features/account/flows';
import { authFailText } from '../features/account/messages';
import { useAuthDone } from '../features/account/useAuthDone';
import type { RootScreenProps } from '../navigation/routes';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Body, Btn, Col, Field, Foot, Header, Notice, Row, Screen, ScopeBadge, Txt } from '../ui';

/**
 * 15 로그인 · 소셜 로그인(FR-102·103, WP1 소유, 2차).
 * - 계정 5회 연속 실패 시 10분 잠금 + 기기 토큰 기준 10분 20회 제한(모의 인증은 IP 대신 기기 토큰, 계정 서버는 IP 기준).
 * - 미인증 계정은 막고 인증 메일 재발송으로 이어 준다.
 * - 로그아웃 뒤 같은 계정으로 로그인하면 이 기기의 여행방을 그대로 이어 쓴다(userId가 같다).
 * - 소셜은 26 모의 동의 화면으로 간다.
 * - 게스트가 다른 계정으로 로그인하면 그 게스트 세션은 복구할 수 없다. 시작 전에 앰버로 알린다.
 * 주 버튼 '로그인'은 아래 고정(목업 .foot)이고 회원가입은 quiet로 낮춘다.
 */
export default function LoginScreen({ navigation }: RootScreenProps<'Login'>) {
  const session = useSession((s) => s.session);
  const showToast = useUi((s) => s.showToast);
  const [email, setEmail] = useState(session?.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<{ title: string; text: string; unverified?: boolean } | null>(null);
  const finish = useAuthDone(navigation);

  const canSubmit = isEmailLike(email) && password.length > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    setFail(null);
    const r = await signInFlow({ email, password });
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
    const r = await getServices().auth.resendVerification(email);
    if (r.ok) {
      showToast('인증 메일을 다시 보냈습니다. 이전 메일의 링크는 쓸 수 없습니다');
      navigation.navigate('Signup');
    } else {
      setFail({ ...authFailText(r) });
    }
  };

  return (
    <Screen>
      <Header
        back={navigation.canGoBack() ? navigation.goBack : undefined}
        eyebrow={session ? `${session.kind === 'guest' ? '게스트' : '계정'} · ${session.nickname}` : 'Young Trip 계정'}
        title="계정으로 로그인"
        sub="로그인하면 같은 계정의 여행방을 이어 씁니다."
        right={<ScopeBadge phase="2차" />}
      />
      <Body scroll>
        {session?.kind === 'guest' ? (
          <Notice
            tone="warn"
            icon="alert"
            title={`지금은 게스트 ${session.nickname}입니다`}
            text="다른 계정으로 로그인하면 이 게스트 세션은 복구할 수 없고, 게스트 여행방은 이 기기에서 보이지 않습니다. 게스트 여행방을 계정으로 옮기려면 먼저 이메일로 승격해 주세요."
          />
        ) : null}
        <Field label="이메일" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
        <Field label="비밀번호" value={password} onChangeText={setPassword} secure placeholder="8자 이상, 영문과 숫자" />
        {fail ? <Notice tone="warn" icon="alert" title={fail.title} text={fail.text} /> : null}
        {fail?.unverified ? <Btn title="인증 메일 다시 받기" variant="ghost" size="sm" onPress={() => void resend()} /> : null}

        <Txt v="label" style={{ marginTop: 6 }}>
          소셜 계정으로 계속하기
        </Txt>
        <Row gap={9}>
          <Col grow>
            <Btn
              title="카카오"
              variant="quiet"
              onPress={() => navigation.navigate('SocialConsent', { provider: 'kakao', intent: 'login' })}
            />
          </Col>
          <Col grow>
            <Btn
              title="구글"
              variant="quiet"
              onPress={() => navigation.navigate('SocialConsent', { provider: 'google', intent: 'login' })}
            />
          </Col>
        </Row>

        <Notice
          icon="pinlock"
          title="로그인 시도 제한"
          text="비밀번호를 5번 연속 틀리면 10분 동안 잠겨요."
        />
        <Notice
          text={
            getServices().auth.id === 'server'
              ? '계정은 계정 서버에 저장돼요. 비밀번호는 원문을 남기지 않아요.'
              : '계정은 이 기기에만 저장돼요. 비밀번호는 원문을 남기지 않아요.'
          }
        />
      </Body>
      <Foot>
        <Btn title={busy ? '확인 중' : '로그인'} disabled={!canSubmit} onPress={() => void submit()} />
        <Btn title="처음이면 회원가입" variant="quiet" size="sm" onPress={() => navigation.navigate('Signup')} />
      </Foot>
    </Screen>
  );
}
