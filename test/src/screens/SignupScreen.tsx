import React, { useCallback, useEffect, useState } from 'react';

import { NICKNAME_MAX, PASSWORD_MIN_LENGTH } from '../core/constants';
import { isEmailLike, nicknameProblem, normalizeEmail, passwordViolations } from '../core/auth';
import type { MockMail } from '../core/ports';
import { kstHHMM } from '../core/util';
import { signUpFlow, verifyFlow } from '../features/account/flows';
import { authFailText } from '../features/account/messages';
import { useAuthDone } from '../features/account/useAuthDone';
import type { RootScreenProps } from '../navigation/routes';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Chip, Col, Field, Header, Icon, Notice, Row, Screen, ScopeBadge, Txt } from '../ui';

const RULES = [`${PASSWORD_MIN_LENGTH}자 이상`, '영문 포함', '숫자 포함'];

/**
 * 16 회원가입 · 이메일 인증(FR-101, WP1 소유, 2차).
 * - 중복 이메일 거부, 비밀번호 규칙(8자 이상·영문·숫자) 위반 항목 표시, 인증 메일 재발송(이전 토큰 무효).
 * - 서버가 없어 인증 메일은 이 화면 아래 모의 메일함에 온다. 메일의 '인증하기'가 인증 링크를 누르는 것과 같다.
 * - 게스트로 쓰는 중이면 그 userId로 가입해 승격한다(userId 유지 · 이관 범위 미결정 · 이 기기 데이터 유지).
 * - 규칙 칩: 입력 전은 line, 지킨 규칙은 ok, 어긴 규칙은 앰버(warn). 제출은 막지 않고, 인증 제공자가 돌려준
 *   violations를 칩과 앰버 Notice에 그대로 반영한다(제공자 규칙이 기준이다).
 */
export default function SignupScreen({ navigation }: RootScreenProps<'Signup'>) {
  const session = useSession((s) => s.session);
  const profileNick = useSession((s) => s.profile.nickname);
  const showToast = useUi((s) => s.showToast);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(session?.kind === 'guest' ? profileNick || session.nickname : '');
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);
  const [fail, setFail] = useState<{ title: string; text: string } | null>(null);
  const [mails, setMails] = useState<MockMail[]>([]);
  const [busy, setBusy] = useState(false);
  /** 마지막 제출에서 제공자가 돌려준 위반 항목. 비밀번호를 고치면 지운다 */
  const [serverViolations, setServerViolations] = useState<string[] | null>(null);
  const finish = useAuthDone(navigation);

  const refresh = useCallback(async () => {
    setMails(await getServices().auth.outbox());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const violations = serverViolations ?? passwordViolations(password);
  const nickProblem = nicknameProblem(nickname);
  const canSubmit = isEmailLike(email) && password.length > 0 && nickProblem == null && !busy;
  const promoting = session?.kind === 'guest';

  const submit = async () => {
    setBusy(true);
    setFail(null);
    const r = await signUpFlow({ email, password, nickname });
    setBusy(false);
    if (!r.ok) {
      setServerViolations(r.code === 'weakPassword' && r.violations ? r.violations : null);
      setFail(authFailText(r));
      return;
    }
    setServerViolations(null);
    setPassword('');
    setSentTo(r.account.email);
    await refresh();
  };

  const resend = async () => {
    if (!sentTo && !isEmailLike(email)) return;
    const r = await getServices().auth.resendVerification(sentTo ?? email);
    if (!r.ok) setFail(authFailText(r));
    else {
      setFail(null);
      setSentTo(normalizeEmail(sentTo ?? email));
      showToast('인증 메일을 다시 보냈습니다. 이전 메일의 링크는 쓸 수 없습니다');
    }
    await refresh();
  };

  const verify = async (mail: MockMail) => {
    if (busy) return;
    setBusy(true);
    const r = await verifyFlow(mail.token);
    setBusy(false);
    await refresh();
    if (!r.result.ok) {
      setFail(authFailText(r.result));
      return;
    }
    if (r.promoted) {
      const failed = r.report?.failed ?? [];
      showToast(
        failed.length > 0
          ? `계정으로 승격했지만 일부 여행방 연결에 실패했습니다: ${failed.join(' / ')}`
          : `계정으로 승격했습니다. 참여한 여행방 ${r.report?.linked ?? 0}곳을 그대로 씁니다`,
        failed.length > 0 ? 'warn' : 'soft',
      );
    } else {
      showToast(`${r.result.account.email} 인증을 마쳤습니다. 이 기기에서 로그인했습니다`);
    }
    finish();
  };

  const shown = sentTo ? mails.filter((m) => m.to === sentTo) : mails;

  return (
    <Screen>
      <Header
        back={navigation.canGoBack() ? navigation.goBack : undefined}
        eyebrow={promoting ? `게스트 · ${session?.nickname ?? ''} · 계정으로` : 'Young Trip 계정'}
        title={promoting ? '게스트를 계정으로' : '이메일로 가입'}
        sub={promoting ? '지금 쓰던 여행방을 그대로 두고 계정으로 바꿉니다.' : '인증 메일을 확인하면 가입이 끝납니다.'}
        right={<ScopeBadge phase="2차" />}
      />
      <Body scroll>
        {promoting ? (
          <Notice
            icon="user"
            title={`게스트 ${session?.nickname ?? ''} 승격`}
            text="지금 쓰던 여행방과 채팅, 제안은 그대로 이 계정으로 옮겨져요."
          />
        ) : null}
        <Field label="이메일" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
        <Col gap={6}>
          <Field
            label="비밀번호"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setServerViolations(null);
            }}
            secure
            placeholder="8자 이상, 영문과 숫자"
          />
          <Row gap={6} wrap>
            {RULES.map((rule) => {
              if (password.length === 0) return <Chip key={rule} text={rule} tone="line" />;
              const bad = violations.includes(rule);
              return <Chip key={rule} text={rule} tone={bad ? 'warn' : 'ok'} icon={bad ? 'alert' : 'check'} />;
            })}
          </Row>
        </Col>
        <Field
          label="닉네임"
          value={nickname}
          onChangeText={setNickname}
          maxLength={NICKNAME_MAX}
          placeholder="예: 민지"
          error={nickname.length > 0 && nickProblem ? nickProblem : undefined}
        />
        {fail ? <Notice tone="warn" icon="alert" title={fail.title} text={fail.text} /> : null}
        <Btn title={busy ? '보내는 중' : '가입하고 인증 메일 받기'} disabled={!canSubmit} onPress={() => void submit()} />
        {sentTo ? (
          <Notice icon="mail" title="인증 메일을 보냈어요" text={`${sentTo}로 보냈어요. 아래 메일함에서 인증하기를 눌러 주세요.`} />
        ) : null}

        <Row style={{ marginTop: 6 }}>
          <Txt v="label" style={{ flex: 1 }}>
            모의 메일함
          </Txt>
          <Btn
            title="인증 메일 다시 받기"
            size="sm"
            variant="quiet"
            disabled={!sentTo && !isEmailLike(email)}
            onPress={() => void resend()}
          />
        </Row>
        {shown.length === 0 ? (
          <Txt v="mt">아직 받은 메일이 없습니다. 서버가 없어 인증 메일은 이 기기 안 모의 메일함으로 옵니다.</Txt>
        ) : (
          shown.map((m) => (
            <Card key={m.id} variant={m.invalidated ? 'excluded' : 'default'}>
              <Row top>
                <Icon name="mail" size={18} color={m.invalidated ? 'faint' : 'accent'} />
                <Col gap={2} grow>
                  <Txt v="nm" c={m.invalidated ? 'muted' : 'ink'}>
                    {m.subject}
                  </Txt>
                  <Txt v="mt">{`${m.to} · ${kstHHMM(m.sentAt)} · 링크 끝 ${m.token.slice(-4)}`}</Txt>
                </Col>
                {m.invalidated ? <Chip text="쓸 수 없음" tone="line" /> : null}
              </Row>
              {m.invalidated ? (
                <Txt v="mtTight">다시 보냈거나 이미 쓴 메일이라 이 링크로는 인증할 수 없습니다.</Txt>
              ) : (
                <Btn title="인증하기" size="sm" disabled={busy} onPress={() => void verify(m)} />
              )}
            </Card>
          ))
        )}
        <Notice text="비밀번호는 암호화해서 이 기기에만 저장해요." />
      </Body>
    </Screen>
  );
}
