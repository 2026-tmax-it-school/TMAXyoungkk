import { useState } from 'react';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

import type { OAuthProviderKind } from '../../core/ports';
import { useUi } from '../../store/ui';
import { confirmLinkFlow } from './flows';
import { authFailText, mailCodeFailText } from './messages';
import { OAUTH_LABEL } from './oauth';
import { needsMailCode } from './social';
import { useAuthDone } from './useAuthDone';
import { useOAuthLogin, type OAuthOutcome } from './useOAuthLogin';

/**
 * 카카오·구글 로그인 버튼 뒤의 흐름(WP1 소유, 2026-10-17). 온보딩 화면이 로그인 화면과 같은 방식으로 소셜 로그인을 바로 연다.
 * 15 로그인 화면의 흐름과 같다: 로그인되면 토스트 뒤 이어서(useAuthDone), 같은 이메일 계정이 있으면 연결을 묻고(link),
 * 실패면 오류 문장(fail), 쓸 수 없으면 안내(unavailable, 시연용 동의 화면으로 갈 수 있으면 mockFallback).
 * 버튼을 누른 그 순간 start를 불러야 한다(웹 팝업 차단을 피한다).
 */
export function useSocialSignIn(navigation: NavigationProp<ParamListBase>) {
  const showToast = useUi((s) => s.showToast);
  const finish = useAuthDone(navigation);
  const kakao = useOAuthLogin('kakao');
  const google = useOAuthLogin('google');
  const [fail, setFail] = useState<{ title: string; text: string } | null>(null);
  const [unavailable, setUnavailable] = useState<{ provider: OAuthProviderKind; text: string; mockFallback: boolean } | null>(null);
  const [link, setLink] = useState<{ provider: OAuthProviderKind; token: string; text: string } | null>(null);
  const [answering, setAnswering] = useState(false);
  // 실제 서버는 연결 확인 코드를 메일로만 보낸다(응답에 linkToken이 없다). 그 코드를 붙여 넣을 칸을 띄운다
  const [mailLink, setMailLink] = useState<OAuthProviderKind | null>(null);
  const [mailBusy, setMailBusy] = useState(false);

  const handle = (provider: OAuthProviderKind, r: OAuthOutcome) => {
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
        setFail(authFailText(r.result));
        if (needsMailCode(r.result)) setMailLink(provider);
        return;
      case 'unavailable':
        setUnavailable({ provider, text: r.text, mockFallback: r.mockFallback });
        return;
      case 'cancel':
      case 'linked':
        return;
    }
  };

  const start = async (provider: OAuthProviderKind) => {
    setFail(null);
    setUnavailable(null);
    setLink(null);
    setMailLink(null);
    const r = await (provider === 'kakao' ? kakao : google).start();
    handle(provider, r);
  };

  const answer = async (accept: boolean) => {
    if (!link || answering) return;
    setAnswering(true);
    const r = await confirmLinkFlow(link.token, accept);
    setAnswering(false);
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

  /** 메일로 받은 연결 코드를 붙여 넣어 구글·카카오 로그인을 기존 계정에 연결한다 */
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

  return {
    kakao,
    google,
    busy: kakao.busy || google.busy,
    start,
    fail,
    unavailable,
    link,
    answer,
    answering,
    mailLink,
    mailBusy,
    submitMailCode,
  };
}
