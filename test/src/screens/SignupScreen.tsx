import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { NICKNAME_MAX, PASSWORD_MIN_LENGTH } from '../core/constants';
import { isEmailLike, nicknameProblem, normalizeEmail, passwordViolations } from '../core/auth';
import type { MockMail } from '../core/ports';
import { kstHHMM } from '../core/util';
import { signUpFlow, verifyFlow } from '../features/account/flows';
import { authFailText, signUpFailText } from '../features/account/messages';
import { useAuthDone } from '../features/account/useAuthDone';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { AuthBtn, AuthTitle, Body, Btn, Card, Chip, Col, Field, Icon, IconBtn, Notice, Row, Screen, SP, TextLink, Txt } from '../ui';

const RULES = [`${PASSWORD_MIN_LENGTH}자 이상`, '영문 포함', '숫자 포함'];

/** 다음 칸 포커스용 ref(react-native 입력 칸 타입은 ui 밖에서 쓰지 않는다) */
type Focusable = { focus: () => void };

/**
 * 16 회원가입 · 이메일 인증(FR-101, WP1 소유, 2차).
 * 두 단계다(sentTo로 나눈다).
 * - 1단계(입력): 이메일 → 비밀번호 → 닉네임. Enter로 다음 칸으로 가고, 닉네임 칸 Enter는 낼 수 있을 때 가입이다.
 *   중복 이메일 거부, 비밀번호 규칙(8자 이상·영문·숫자) 위반 항목 표시. 주 동작은 '가입하고 인증 메일 받기'.
 *   전에 받은 인증 메일이 있으면(로그인에서 '인증 메일 다시 받기'로 온 경우 등) 입력 칸보다 위에 안내 한 줄과
 *   '메일 확인하기'를 두어 2단계 메일함을 연다(빈 가입 양식만 보고 같은 이메일로 다시 가입하다 막히지 않게).
 * - 2단계(메일 확인): 보낸 주소, '이메일 바꾸기'(1단계로), 메일 카드(보낸 시각만), '인증 메일 다시 받기'(이전 토큰 무효).
 *   세션 없이 보낸 가입은 인증 전에도 닉네임을 잡고 있어, 이메일만 고쳐 같은 닉네임으로 다시 내면 거부된다
 *   (인증 제공자는 같은 게스트의 인증 전 가입만 대체한다). 그때는 signUpFailText로 이유를 알리고 앞서 보낸 메일함으로 돌아가게 한다.
 *   서버가 없어 인증 메일은 이 화면의 모의 메일함에 온다. 메일의 '인증하기'가 인증 링크를 누르는 것과 같다.
 * - 게스트로 쓰는 중이면 그 userId로 가입해 승격한다(userId 유지 · 이 기기 데이터 유지). 승격은 보조 줄 한 줄로만 알린다.
 * - 규칙 칩: 입력 전은 line, 지킨 규칙은 ok, 어긴 규칙은 앰버(warn). 제출은 막지 않고, 인증 제공자가 돌려준
 *   violations를 칩과 앰버 Notice에 그대로 반영한다(제공자 규칙이 기준이다).
 * - 모양은 15 로그인과 같다(2026-10-10 사용자 시안): 가운데 큰 제목, 높이 48·라운드 6 입력 칸과 잉크 버튼.
 * - 닉네임은 로그인 아이디로도 쓴다(계정마다 하나, @ 불가).
 * - 뒤로는 쌓인 화면이 있으면 그 화면, 없으면 홈(세션이 없으면 온보딩)으로 간다.
 */
export default function SignupScreen({ navigation }: RootScreenProps<'Signup'>) {
  const session = useSession((s) => s.session);
  const profileNick = useSession((s) => s.profile.nickname);
  const showToast = useUi((s) => s.showToast);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(session?.kind === 'guest' ? profileNick || session.nickname : '');
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);
  const [fail, setFail] = useState<{ title: string; text: string; heldEmail?: string } | null>(null);
  /** 세션 없이 이 화면에서 앞서 보낸 가입(인증 전). 그 닉네임은 인증 전까지 잡혀 있다 */
  const [held, setHeld] = useState<{ email: string; nickname: string } | undefined>(undefined);
  const [mails, setMails] = useState<MockMail[]>([]);
  const [busy, setBusy] = useState(false);
  /** 마지막 제출에서 제공자가 돌려준 위반 항목. 비밀번호를 고치면 지운다 */
  const [serverViolations, setServerViolations] = useState<string[] | null>(null);
  const passwordRef = useRef<Focusable | null>(null);
  const nicknameRef = useRef<Focusable | null>(null);
  const finish = useAuthDone(navigation);
  const toHome = useBack('Home');
  const back = () => {
    if (navigation.canGoBack() || session) toHome();
    else navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

  const refresh = useCallback(async () => {
    // 비밀번호 재설정·소셜 연결 확인 메일은 여기서 보이지 않는다(인증하기 버튼으로 쓸 수 없다)
    setMails((await getServices().auth.outbox()).filter((m) => (m.kind ?? 'verify') === 'verify'));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const violations = serverViolations ?? passwordViolations(password);
  const nickProblem = nicknameProblem(nickname);
  const canSubmit = isEmailLike(email) && password.length > 0 && nickProblem == null && !busy;
  const promoting = session?.kind === 'guest';

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setFail(null);
    const r = await signUpFlow({ email, password, nickname });
    setBusy(false);
    if (!r.ok) {
      setServerViolations(r.code === 'weakPassword' && r.violations ? r.violations : null);
      setFail(signUpFailText(r, nickname, promoting ? undefined : held));
      return;
    }
    setServerViolations(null);
    setPassword('');
    if (!promoting) setHeld({ email: r.account.email, nickname: r.account.nickname });
    setSentTo(r.account.email);
    await refresh();
  };

  const resend = async () => {
    if (!sentTo) return;
    const r = await getServices().auth.resendVerification(sentTo);
    if (!r.ok) setFail(authFailText(r));
    else {
      setFail(null);
      setSentTo(normalizeEmail(sentTo));
      showToast('인증 메일을 새로 보냈어요');
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
          ? `계정으로 바꿨지만 일부 여행방을 잇지 못했어요: ${failed.join(' / ')}`
          : `계정으로 바꿨어요. 여행방 ${r.report?.linked ?? 0}곳을 그대로 써요`,
        failed.length > 0 ? 'warn' : 'soft',
      );
    } else {
      showToast(`${r.result.account.email} 인증을 마치고 로그인했어요`);
    }
    finish();
  };

  /** 전에 받은 쓸 수 있는 인증 메일 중 가장 최근 것(1단계에서 메일함으로 바로 가는 링크) */
  const pending = mails.filter((m) => !m.invalidated).reduce<MockMail | undefined>((a, m) => (a && a.sentAt >= m.sentAt ? a : m), undefined);

  const backRow = (
    <View style={{ paddingTop: SP.s, paddingHorizontal: SP.gutter }}>
      <Row>
        <IconBtn icon="back" label="뒤로" onPress={back} />
      </Row>
    </View>
  );

  /* ---------- 2단계: 메일 확인 ---------- */
  if (sentTo) {
    const shown = mails.filter((m) => m.to === sentTo);
    return (
      <Screen keyboard>
        {backRow}
        <Body scroll>
          <AuthTitle title="메일을 확인해 주세요" />
          <Col gap={SP.xs}>
            <Txt v="sub">{`${sentTo}로 보냈어요`}</Txt>
            <TextLink
              title="이메일 바꾸기"
              onPress={() => {
                setSentTo(undefined);
                setFail(null);
              }}
            />
          </Col>
          {fail ? <Notice tone="warn" icon="alert" title={fail.title} text={fail.text} /> : null}

          <Txt v="label">모의 메일함</Txt>
          {shown.length === 0 ? (
            <Txt v="mt">아직 받은 메일이 없어요</Txt>
          ) : (
            shown.map((m) => (
              <Card key={m.id} variant={m.invalidated ? 'excluded' : 'default'}>
                <Row top>
                  <Icon name="mail" size={18} color={m.invalidated ? 'faint' : 'accent'} />
                  <Col gap={2} grow>
                    <Txt v="nm" c={m.invalidated ? 'muted' : 'ink'}>
                      {m.subject}
                    </Txt>
                    <Txt v="mt">{`${kstHHMM(m.sentAt)}에 보냄`}</Txt>
                  </Col>
                  {m.invalidated ? <Chip text="쓸 수 없음" tone="line" /> : null}
                </Row>
                {m.invalidated ? null : <Btn title="인증하기" size="sm" disabled={busy} onPress={() => void verify(m)} />}
              </Card>
            ))
          )}
          <Btn title="인증 메일 다시 받기" size="sm" variant="quiet" disabled={busy} onPress={() => void resend()} />
        </Body>
      </Screen>
    );
  }

  /* ---------- 1단계: 입력 ---------- */
  return (
    <Screen keyboard>
      {backRow}
      <Body scroll>
        <AuthTitle title={promoting ? '게스트를 계정으로' : '회원가입'} />
        <Txt v="sub">
          {promoting ? '지금 쓰던 여행방과 채팅, 제안을 그대로 두고 계정으로 바꿔요.' : '인증 메일을 확인하면 가입이 끝나요.'}
        </Txt>
        {pending ? (
          <Notice
            icon="mail"
            text="받은 인증 메일이 있어요. 메일함에서 바로 인증할 수 있어요."
            action={{
              label: '메일 확인하기',
              onPress: () => {
                setFail(null);
                setSentTo(pending.to);
              },
            }}
          />
        ) : null}
        <Field
          look="auth"
          label="이메일"
          kind="email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keepFocusOnSubmit
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Col gap={6}>
          <Field
            look="auth"
            label="비밀번호"
            kind="newPassword"
            inputRef={(el) => {
              passwordRef.current = el;
            }}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setServerViolations(null);
            }}
            placeholder="8자 이상, 영문과 숫자"
            keepFocusOnSubmit
            onSubmitEditing={() => nicknameRef.current?.focus()}
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
          look="auth"
          label="닉네임(로그인 아이디)"
          kind="nickname"
          inputRef={(el) => {
            nicknameRef.current = el;
          }}
          value={nickname}
          onChangeText={setNickname}
          maxLength={NICKNAME_MAX}
          help="로그인할 때 이메일 대신 쓸 수 있어요. 다른 사람과 겹칠 수 없어요."
          error={nickname.length > 0 && nickProblem ? nickProblem : undefined}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (canSubmit) void submit();
          }}
        />
        {fail ? (
          <Notice
            tone="warn"
            icon="alert"
            title={fail.title}
            text={fail.text}
            action={
              fail.heldEmail
                ? {
                    label: '보낸 메일 보기',
                    onPress: () => {
                      const to = fail.heldEmail;
                      setFail(null);
                      setSentTo(to);
                    },
                  }
                : undefined
            }
          />
        ) : null}
        <AuthBtn title={busy ? '보내는 중' : '가입하고 인증 메일 받기'} disabled={!canSubmit} onPress={() => void submit()} />
      </Body>
    </Screen>
  );
}
