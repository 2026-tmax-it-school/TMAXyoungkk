import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { isEmailLike, normalizeEmail, passwordViolations } from '../../core/auth';
import type { MockMail } from '../../core/ports';
import { kstHHMM } from '../../core/util';
import { getServices } from '../../services/registry';
import { AuthBtn, Card, Col, Field, H, Notice, Row, Sheet, SP, Txt } from '../../ui';
import { confirmPasswordResetFlow, requestPasswordResetFlow } from './flows';
import { authFailText } from './messages';

/**
 * 15 로그인 '계정찾기' 시트(WP1 소유). 비밀번호 재설정 메일을 받아 새 비밀번호를 정한다.
 * - 1단계: 가입한 이메일로 재설정 메일 요청. 가입 여부와 상관없이 같은 안내다(제공자 규칙).
 * - 2단계: 실제 메일 발송이 없어 재설정 메일은 모의 메일함(이 기기 또는 개발 서버 보낸편지함)에 온다. 메일을 고르면
 *   그 링크를 연 것과 같다. 개발 서버가 아니면 메일함이 비어 있다고 알린다.
 * - 3단계: 새 비밀번호(8자 이상·영문·숫자). 성공하면 로그인하지 않고 닫는다(새 비밀번호로 로그인한다). 다른 기기 세션은 끊긴다.
 * 소셜 전용 계정은 비밀번호가 없어 재설정 메일이 오지 않는다(카카오·구글로 로그인).
 */
export function FindAccountSheet({
  visible,
  initialEmail,
  onClose,
  onDone,
}: {
  visible: boolean;
  initialEmail: string;
  onClose: () => void;
  /** 새 비밀번호를 정했다. 로그인 칸에 이 이메일을 넣는다 */
  onDone: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mails, setMails] = useState<MockMail[]>([]);
  const [picked, setPicked] = useState<MockMail | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<{ title: string; text: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setEmail(isEmailLike(initialEmail) ? initialEmail.trim() : '');
    setSentTo(null);
    setMails([]);
    setPicked(null);
    setPassword('');
    setFail(null);
  }, [visible, initialEmail]);

  const refresh = useCallback(async (to: string) => {
    const all = await getServices().auth.outbox();
    setMails(all.filter((m) => m.kind === 'reset' && m.to.toLowerCase() === to));
  }, []);

  const request = async () => {
    setBusy(true);
    setFail(null);
    const r = await requestPasswordResetFlow(email);
    setBusy(false);
    if (!r.ok) {
      setFail(authFailText(r));
      return;
    }
    const to = normalizeEmail(email);
    setSentTo(to);
    setPicked(null);
    await refresh(to);
  };

  const save = async () => {
    if (!picked) return;
    setBusy(true);
    setFail(null);
    const r = await confirmPasswordResetFlow(picked.token, password);
    setBusy(false);
    if (!r.ok) {
      setFail(authFailText(r));
      if (r.code === 'invalidToken' && sentTo) await refresh(sentTo);
      return;
    }
    onDone(picked.to);
  };

  const violations = password.length > 0 ? passwordViolations(password) : [];

  return (
    <Sheet visible={visible} onClose={onClose} title="계정찾기">
      <ScrollView style={{ maxHeight: H.sheetList + 120 }} contentContainerStyle={{ gap: SP.xl }}>
        {picked ? (
          <>
            <Txt v="body" c="muted">{`${picked.to} 계정의 새 비밀번호를 정해 주세요.`}</Txt>
            <Field
              look="auth"
              label="새 비밀번호"
              hideLabel
              value={password}
              onChangeText={setPassword}
              secure
              placeholder="새 비밀번호(8자 이상, 영문과 숫자)"
              error={violations.length > 0 ? `빠진 조건: ${violations.join(', ')}` : undefined}
              onSubmitEditing={() => void save()}
            />
            {fail ? <Notice tone="warn" icon="alert" title={fail.title} text={fail.text} /> : null}
            <AuthBtn
              title={busy ? '저장 중' : '새 비밀번호 저장'}
              disabled={busy || password.length === 0 || violations.length > 0}
              onPress={() => void save()}
            />
            <AuthBtn title="다른 메일 고르기" variant="outline" onPress={() => setPicked(null)} />
          </>
        ) : (
          <>
            <Txt v="body" c="muted">가입한 이메일로 비밀번호 재설정 메일을 보내 드려요. 아이디(닉네임)를 잊었다면 이메일로 로그인할 수 있어요.</Txt>
            <Field
              look="auth"
              label="가입한 이메일"
              hideLabel
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setFail(null);
              }}
              placeholder="가입한 이메일"
              keyboardType="email-address"
              onSubmitEditing={() => void request()}
            />
            {fail ? <Notice tone="warn" icon="alert" title={fail.title} text={fail.text} /> : null}
            <AuthBtn
              title={busy ? '보내는 중' : sentTo ? '재설정 메일 다시 받기' : '재설정 메일 받기'}
              disabled={busy || !isEmailLike(email)}
              onPress={() => void request()}
            />
            {sentTo ? (
              <Notice
                icon="mail"
                title="가입한 이메일이면 재설정 메일을 보냈어요"
                text="30분 안에 메일의 링크로 새 비밀번호를 정해 주세요. 소셜 로그인으로 만든 계정은 카카오·구글로 로그인해 주세요."
              />
            ) : null}
            {sentTo ? (
              <Col gap={SP.m}>
                <Txt v="label">모의 메일함</Txt>
                {mails.length === 0 ? (
                  <Txt v="mt">
                    받은 재설정 메일이 없습니다. 메일 발송이 없어 개발용 메일함에서만 볼 수 있어요(계정 서버는 AUTH_DEV_OUTBOX=1일 때).
                  </Txt>
                ) : (
                  mails.map((m) => (
                    <Card key={m.id} variant={m.invalidated ? 'excluded' : 'default'}>
                      <Row top>
                        <Col gap={2} grow>
                          <Txt v="nm" c={m.invalidated ? 'muted' : 'ink'}>
                            {m.subject}
                          </Txt>
                          <Txt v="mt">{`${m.to} · ${kstHHMM(m.sentAt)} · 링크 끝 ${m.token.slice(-4)}`}</Txt>
                        </Col>
                      </Row>
                      {m.invalidated ? (
                        <Txt v="mtTight">다시 받았거나 이미 쓴 메일이라 이 링크로는 바꿀 수 없습니다.</Txt>
                      ) : (
                        <AuthBtn title="이 메일로 재설정" variant="outline" onPress={() => setPicked(m)} />
                      )}
                    </Card>
                  ))
                )}
              </Col>
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
