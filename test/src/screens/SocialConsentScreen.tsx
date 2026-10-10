import React, { useState } from 'react';
import { View } from 'react-native';

import { confirmLinkFlow, socialFlow } from '../features/account/flows';
import { authFailText } from '../features/account/messages';
import { useAuthDone } from '../features/account/useAuthDone';
import type { RootScreenProps } from '../navigation/routes';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Choice, Col, Field, Foot, Header, lineC, Notice, Row, Screen, Txt } from '../ui';

type Scenario = 'ok' | 'fail' | 'sameEmail';

const LABEL = { kakao: '카카오', google: '구글' } as const;
/** 주격 조사까지 붙인 이름(카카오가, 구글이) */
const SUBJECT = { kakao: '카카오가', google: '구글이' } as const;
const SCOPES = ['닉네임', '이메일 주소', '서비스 이용 동의'];

/**
 * 26 모의 소셜 동의(FR-103, WP1 소유, 2차). 실제 OAuth가 없어 동의 화면을 흉내 낸다.
 * 제공자 로고는 쓰지 않고 텍스트와 선으로만 그린다. 시연용으로 결과를 고른다:
 * - 정상: 소셜 계정으로 가입·로그인
 * - 제공자 실패: 앰버 Notice와 다시 시도
 * - 같은 이메일: 모의 제공자가 돌려줄 이메일을 입력받는다. 그 이메일로 가입한 계정이 있으면 연결 여부를 묻는다
 *   (linkRequired). 확인해야만 연결하고 자동 병합하지 않는다.
 * intent 'link'(17 '카카오 연결')는 지금 계정에 로그인 방법만 붙인다. 세션을 바꾸지 않고, 결과 계정이 지금 계정과
 * 다르면 거부한다(flows.socialFlow → judgeSocial). 그래서 연결 모드에는 '같은 이메일' 선택지가 없다.
 * 게스트가 소셜로 로그인하면 게스트 세션은 복구할 수 없다(소셜 승격은 미지원). 시작 전에 경고한다.
 */
export default function SocialConsentScreen({ navigation, route }: RootScreenProps<'SocialConsent'>) {
  const { provider, intent } = route.params;
  const linking = intent === 'link';
  const label = LABEL[provider];
  const session = useSession((s) => s.session);
  const showToast = useUi((s) => s.showToast);
  const [scenario, setScenario] = useState<Scenario>('ok');
  const [providerEmail, setProviderEmail] = useState(session?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<{ title: string; text: string } | null>(null);
  const [link, setLink] = useState<{ token: string; text: string } | null>(null);
  const finish = useAuthDone(navigation);

  const run = async () => {
    setBusy(true);
    setFail(null);
    const r = await socialFlow(provider, scenario, { intent, providerEmail });
    setBusy(false);
    switch (r.kind) {
      case 'signIn':
        showToast(`${label} 계정(${r.account?.nickname ?? ''})으로 로그인했습니다`);
        finish();
        return;
      case 'linked':
        showToast(`${label} 로그인을 지금 계정에 연결했습니다. 어느 쪽으로 로그인해도 같은 여행방을 봅니다`);
        navigation.goBack();
        return;
      case 'confirm':
        setLink({ token: r.linkToken, text: r.text });
        return;
      case 'fail':
        setFail(authFailText(r.result));
    }
  };

  const answer = async (accept: boolean) => {
    if (!link) return;
    setBusy(true);
    const r = await confirmLinkFlow(link.token, accept);
    setBusy(false);
    setLink(null);
    if (r.ok) {
      showToast(`${label} 로그인을 ${r.account.email} 계정에 연결했습니다`);
      finish();
      return;
    }
    if (!accept) {
      showToast('연결하지 않았습니다. 기존 계정은 이메일로 로그인할 수 있습니다');
      navigation.goBack();
      return;
    }
    setFail(authFailText(r));
  };

  return (
    <Screen>
      <Header
        close={navigation.canGoBack() ? navigation.goBack : undefined}
        eyebrow={linking ? `내 계정 · ${label} 연결` : `${label} 로그인`}
        title={linking ? `${label} 로그인을 연결할까요` : `${label} 계정으로 계속할까요`}
      />
      <Body scroll>
        {!linking && session?.kind === 'guest' ? (
          <Notice
            tone="warn"
            icon="alert"
            title={`지금은 게스트 ${session.nickname}입니다`}
            text={`${label}로 로그인하면 이 게스트 세션은 복구할 수 없고, 게스트 여행방은 이 기기에서 보이지 않습니다. 소셜 승격은 지원하지 않습니다. 여행방을 계정으로 옮기려면 이메일로 승격해 주세요.`}
          />
        ) : null}
        <Card>
          <Txt v="label">Young Trip이 받는 정보</Txt>
          {SCOPES.map((s, i) => (
            <View
              key={s}
              style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: lineC.line }}
            >
              <Txt v="body">{s}</Txt>
            </View>
          ))}
        </Card>

        <Col gap={6}>
          <Txt v="label">시연 결과 고르기</Txt>
          <Choice<Scenario>
            options={
              linking
                ? [
                    { key: 'ok', label: '정상' },
                    { key: 'fail', label: '제공자 실패' },
                  ]
                : [
                    { key: 'ok', label: '정상' },
                    { key: 'fail', label: '제공자 실패' },
                    { key: 'sameEmail', label: '같은 이메일' },
                  ]
            }
            value={scenario}
            onChange={(k) => {
              setScenario(k);
              setFail(null);
              setLink(null);
            }}
          />
        </Col>

        {!linking && scenario === 'sameEmail' ? (
          <Field
            label={`${SUBJECT[provider]} 알려줄 이메일`}
            value={providerEmail}
            onChangeText={(v) => {
              setProviderEmail(v);
              setFail(null);
              setLink(null);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
          />
        ) : null}

        {fail ? <Notice tone="warn" icon="alert" title={fail.title} text={fail.text} /> : null}

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

      </Body>
      <Foot>
        <Btn
          title={fail ? '다시 시도' : busy ? '확인 중' : linking ? '동의하고 연결하기' : '동의하고 계속하기'}
          disabled={busy || link != null}
          onPress={() => void run()}
        />
        <Btn title="취소" variant="quiet" size="sm" onPress={() => navigation.goBack()} />
      </Foot>
    </Screen>
  );
}
