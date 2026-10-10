import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { OAUTH_CLIENT_IDS, pickOAuthClientId } from '../../config';
import type { OAuthProviderKind } from '../../core/ports';
import { systemClock } from '../../services/clock';
import { getServices } from '../../services/registry';
import { oauthSignInFlow, oauthStateFlow, type SocialFlowResult } from './flows';
import {
  judgePrompt,
  OAUTH_DISCOVERY,
  OAUTH_EXTRA_PARAMS,
  OAUTH_SCOPES,
  oauthReadiness,
  stateNeedsRefresh,
  type OAuthReadiness,
} from './oauth';

// 웹: 제공자 로그인 창(팝업)이 우리 주소로 돌아오면 이 모듈이 그 창에서 결과를 원래 창으로 넘기고 닫는다.
// 로그인 화면이 앱 시작 때 import되므로 팝업 창에서도 가장 먼저 돈다
WebBrowser.maybeCompleteAuthSession();

/** 앱 딥링크 스킴(app.config.js scheme). 웹에서는 지금 주소의 origin(http://localhost:8090)이 돌아올 주소다 */
const APP_SCHEME = 'youngtrip';

export type OAuthOutcome =
  | SocialFlowResult
  | { kind: 'cancel' }
  /** 지금은 실제 로그인을 할 수 없다. mockFallback이면 시연용 동의 화면으로 이어 갈 수 있다 */
  | { kind: 'unavailable'; text: string; mockFallback: boolean };

/**
 * 실제 소셜 로그인 훅(WP1 소유). 15 로그인의 카카오·구글 버튼이 쓴다.
 * 1) 쓸 수 있으면(계정 서버 + 앱 클라이언트 ID) 계정 서버에서 일회용 state를 미리 받아 둔다(만료 1분 전에 새로 받는다).
 *    웹 팝업은 누른 순간에 열어야 막히지 않아서, 누른 뒤에 서버를 기다리지 않게 미리 받는다.
 * 2) 누르면 expo-auth-session으로 제공자 로그인 창(인가 코드 + PKCE)을 연다.
 * 3) 돌아온 코드·code_verifier·state를 계정 서버로 넘긴다(oauthSignInFlow). 서버가 제공자와 바꾸고 세션을 준다.
 * 서버에 키가 없으면(503) 버튼을 누를 때 그 이유를 알리고 시연용 동의 화면으로 이어 갈 수 있게 한다.
 */
export function useOAuthLogin(provider: OAuthProviderKind): {
  start: () => Promise<OAuthOutcome>;
  busy: boolean;
  readiness: OAuthReadiness;
} {
  const auth = getServices().auth;
  const clientId = pickOAuthClientId(provider, Platform.OS, OAUTH_CLIENT_IDS);
  const readiness = oauthReadiness({
    provider,
    authId: auth.id,
    hasOAuth: !!auth.oauthState && !!auth.oauthSignIn,
    clientId,
    platform: Platform.OS,
  });
  const ready = readiness.kind === 'ready';
  const redirectUri = useMemo(() => AuthSession.makeRedirectUri({ scheme: APP_SCHEME }), []);
  const [serverState, setServerState] = useState<{ state: string; expiresAt: number } | null>(null);
  const [stateFail, setStateFail] = useState<{ text: string; unconfigured: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const loadState = useCallback(async () => {
    if (!ready) return;
    const r = await oauthStateFlow(provider, redirectUri);
    if (!alive.current) return;
    if (r.ok) {
      setServerState({ state: r.state, expiresAt: r.expiresAt });
      setStateFail(null);
    } else {
      setServerState(null);
      setStateFail({ text: r.detail ?? '계정 서버에 닿지 못했습니다. 잠시 뒤 다시 시도해 주세요', unconfigured: r.unconfigured === true });
    }
  }, [ready, provider, redirectUri]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // 만료 1분 전에 새로 받는다(서버 state는 10분)
  useEffect(() => {
    if (!serverState) return undefined;
    const wait = Math.max(5_000, serverState.expiresAt - systemClock.now() - 60_000);
    const t = setTimeout(() => void loadState(), wait);
    return () => clearTimeout(t);
  }, [serverState, loadState]);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: clientId || 'unset',
      redirectUri,
      scopes: OAUTH_SCOPES[provider],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // 서버 state가 오기 전에는 쓰지 않는 자리값이다(이 값으로는 창을 열지 않는다)
      state: serverState?.state ?? 'pending',
      extraParams: OAUTH_EXTRA_PARAMS[provider],
    },
    OAUTH_DISCOVERY[provider],
  );

  const start = useCallback(async (): Promise<OAuthOutcome> => {
    if (readiness.kind !== 'ready') return { kind: 'unavailable', text: readiness.text, mockFallback: true };
    if (stateFail) {
      void loadState();
      return { kind: 'unavailable', text: stateFail.text, mockFallback: stateFail.unconfigured };
    }
    if (!serverState || !request || request.state !== serverState.state || stateNeedsRefresh(serverState, systemClock.now())) {
      void loadState();
      return { kind: 'unavailable', text: '로그인을 준비하고 있습니다. 잠시 뒤 다시 눌러 주세요', mockFallback: false };
    }
    setBusy(true);
    try {
      const r = await promptAsync();
      const j = judgePrompt(provider, r, serverState.state);
      if (j.kind === 'cancel') return { kind: 'cancel' };
      if (j.kind === 'fail') return { kind: 'fail', result: { ok: false, code: 'providerFailed', detail: j.text } };
      return await oauthSignInFlow({
        provider,
        code: j.code,
        state: j.state,
        redirectUri,
        ...(request.codeVerifier ? { codeVerifier: request.codeVerifier } : {}),
        ...(provider === 'google' && Platform.OS !== 'web' ? { clientId } : {}),
      });
    } finally {
      // state는 한 번 쓰면 끝이다. 다음 시도를 위해 새로 받는다
      if (alive.current) {
        setBusy(false);
        setServerState(null);
        void loadState();
      }
    }
  }, [readiness, stateFail, serverState, request, promptAsync, provider, redirectUri, clientId, loadState]);

  return { start, busy, readiness };
}
